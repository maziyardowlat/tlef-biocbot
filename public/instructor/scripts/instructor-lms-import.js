/**
 * Canvas and Moodle file import for the instructor Course Upload page.
 *
 * Both providers answer the same four questions — who are you, which course,
 * which file, where does it go — so they share one modal wizard driven by the
 * PROVIDERS table below rather than two near-identical panels. The page itself
 * only carries a small launcher button per configured provider.
 */
(function lmsImportModule() {
    const PROVIDERS = {
        canvas: {
            label: 'Canvas',
            apiRoot: '/api/lms/canvas',
            // Canvas uses OAuth (redirect out and back); Moodle uses a pasted token.
            connectStyle: 'oauth',
            courseIdField: 'canvasCourseId',
            fileIdField: 'canvasFileId',
            connectedNote: 'BiocBot is authorized to read your Canvas courses. Logging out of the Canvas website does not revoke this — use Disconnect below.'
        },
        moodle: {
            label: 'Moodle',
            apiRoot: '/api/lms/moodle',
            connectStyle: 'token',
            courseIdField: 'moodleCourseId',
            fileIdField: 'moodleFileId',
            connectedNote: 'BiocBot has a stored Moodle token. It stays valid until you disconnect here or delete the token in Moodle.'
        }
    };

    /** Wizard steps, in order. `progress` is the running import, not a stop. */
    const WIZARD_STEPS = [
        { id: 'connect', title: 'Connect', subtitle: 'Connect your account' },
        { id: 'course', title: 'Course', subtitle: 'Choose the course' },
        { id: 'file', title: 'File', subtitle: 'Choose the file' },
        { id: 'destination', title: 'Destination', subtitle: 'Choose where it lands' }
    ];

    /** Import stages, matching the step ids streamed by the server. */
    const IMPORT_STAGES = [
        { id: 'download', label: 'Download the file from {provider}' },
        { id: 'store', label: 'Store the original in BiocBot' },
        { id: 'extract', label: 'Extract the text (and describe images)' },
        { id: 'save', label: 'Save it and attach it to the unit' },
        { id: 'index', label: 'Build the search index' }
    ];

    const state = {
        provider: null,
        connected: false,
        stepIndex: 0,
        importing: false,
        biocbotCourse: null,
        linkedCourse: null,
        files: [],
        // Providers the deployment has configured at all; unconfigured ones
        // never get a launcher button.
        available: {}
    };

    function element(id) {
        return document.getElementById(id);
    }

    function config() {
        return PROVIDERS[state.provider];
    }

    function setMessage(message, type = '') {
        const target = element('lms-import-message');
        if (!target) return;
        target.textContent = message || '';
        target.className = type ? `lms-import-message ${type}` : 'lms-import-message';
    }

    async function parseResponse(response) {
        const body = await response.json().catch(() => ({}));
        if (!response.ok) {
            const error = new Error(body.message || body.error || `Request failed (${response.status})`);
            error.status = response.status;
            error.body = body;
            throw error;
        }
        return body;
    }

    async function providerRequest(path, options) {
        return parseResponse(await fetch(`${config().apiRoot}${path}`, {
            credentials: 'same-origin',
            headers: { 'Content-Type': 'application/json', ...(options?.headers || {}) },
            ...options
        }));
    }

    function option(select, value, label, { disabled = false, selected = false } = {}) {
        const item = document.createElement('option');
        item.value = value;
        item.textContent = label;
        item.disabled = disabled;
        item.selected = selected;
        select.appendChild(item);
    }

    function fileSizeLabel(bytes) {
        if (!Number.isFinite(bytes) || bytes <= 0) return 'unknown size';
        if (bytes < 1024 * 1024) return `${Math.max(1, Math.round(bytes / 1024))} KB`;
        return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
    }

    function selectedOptionLabel(selectId) {
        const select = element(selectId);
        return select?.selectedOptions?.[0]?.textContent || '';
    }

    // ---------------------------------------------------------------- launcher

    function setChipState(provider, text, stateName) {
        const chip = document.querySelector(`.lms-import-chip[data-lms-provider="${provider}"]`);
        if (!chip) return;
        chip.hidden = false;
        element('lms-import-bar').hidden = false;
        const badge = chip.querySelector('.lms-chip-state');
        badge.textContent = text;
        badge.dataset.state = stateName;
    }

    /**
     * Probes each provider once on page load. A 404 means the deployment has no
     * credentials for that LMS, so its button stays hidden entirely instead of
     * advertising something nobody here can use.
     */
    async function detectProviders() {
        await Promise.all(Object.keys(PROVIDERS).map(async (provider) => {
            const previous = state.provider;
            state.provider = provider;
            try {
                await providerRequest('/status');
                state.available[provider] = true;
                setChipState(provider, 'Connected', 'connected');
            } catch (error) {
                if (error.status === 401) {
                    state.available[provider] = true;
                    setChipState(provider, 'Not connected', 'disconnected');
                } else if (error.status === 404) {
                    state.available[provider] = false;
                } else {
                    state.available[provider] = true;
                    setChipState(provider, 'Unavailable', 'error');
                }
            } finally {
                state.provider = previous;
            }
        }));
    }

    // ------------------------------------------------------------------- steps

    function renderStepper() {
        const stepper = element('lms-stepper');
        if (!stepper) return;
        stepper.replaceChildren();
        WIZARD_STEPS.forEach((step, index) => {
            const item = document.createElement('li');
            item.className = 'lms-stepper-item';
            item.dataset.state = state.importing || index < state.stepIndex
                ? 'complete'
                : (index === state.stepIndex ? 'current' : 'upcoming');
            if (index === state.stepIndex && !state.importing) item.setAttribute('aria-current', 'step');

            const marker = document.createElement('span');
            marker.className = 'lms-stepper-marker';
            marker.textContent = item.dataset.state === 'complete' ? '✓' : String(index + 1);
            const label = document.createElement('span');
            label.className = 'lms-stepper-label';
            label.textContent = step.title;

            item.append(marker, label);
            stepper.appendChild(item);
        });
    }

    function showPanel(stepId) {
        for (const panel of document.querySelectorAll('#lms-import-modal .lms-step-panel')) {
            panel.hidden = panel.dataset.step !== stepId;
        }
    }

    /** Repaints the header, stepper, visible panel, and footer for `stepIndex`. */
    function renderStep() {
        const provider = config();
        const step = WIZARD_STEPS[state.stepIndex];
        element('lms-import-title').textContent = `Import from ${provider.label}`;
        element('lms-import-subtitle').textContent = state.importing
            ? `Importing into ${state.biocbotCourse?.courseName || 'this course'}`
            : `Step ${state.stepIndex + 1} of ${WIZARD_STEPS.length} · ${step.subtitle}`;

        renderStepper();
        showPanel(state.importing ? 'progress' : step.id);

        const back = element('lms-import-back');
        const next = element('lms-import-next');
        back.hidden = state.importing || state.stepIndex === 0;
        next.hidden = state.importing;
        next.textContent = step.id === 'destination' ? `Import into BiocBot` : 'Next';
        next.disabled = !canAdvance();
    }

    function canAdvance() {
        switch (WIZARD_STEPS[state.stepIndex].id) {
            case 'connect':
                return state.connected;
            case 'course':
                return Boolean(element('lms-course-select')?.value);
            case 'file':
                return Boolean(element('lms-file-select')?.value);
            case 'destination':
                return Boolean(element('lms-unit-select')?.value) && Boolean(state.linkedCourse?.courseId);
            default:
                return false;
        }
    }

    function refreshNextButton() {
        const next = element('lms-import-next');
        if (next && !state.importing) next.disabled = !canAdvance();
    }

    // ------------------------------------------------------------ step content

    function renderConnectStep() {
        const provider = config();
        const isOauth = provider.connectStyle === 'oauth';
        element('lms-connect-oauth').hidden = state.connected || !isOauth;
        element('lms-connect-token').hidden = state.connected || isOauth;
        element('lms-connected-state').hidden = !state.connected;
        element('lms-connected-note').textContent = provider.connectedNote;
        element('lms-disconnect-btn').textContent = `Disconnect ${provider.label}`;
    }

    async function loadBiocBotCourse() {
        const courseId = await getCurrentCourseId();
        const response = await fetch(
            `/api/courses/${encodeURIComponent(courseId)}?instructorId=${encodeURIComponent(getCurrentInstructorId())}`
        );
        state.biocbotCourse = (await parseResponse(response)).data;
    }

    function populateUnits() {
        const select = element('lms-unit-select');
        if (!select) return;
        select.replaceChildren();
        option(select, '', 'Select a unit…');
        for (const lecture of state.biocbotCourse?.lectures || []) {
            option(select, lecture.name, lecture.displayName || lecture.name);
        }
    }

    async function loadProviderCourses() {
        const provider = config();
        const select = element('lms-course-select');
        element('lms-course-label').textContent = `${provider.label} course`;
        select.disabled = true;
        select.replaceChildren();
        option(select, '', `Loading ${provider.label} courses…`);

        const linkResult = await providerRequest(`/courses/${encodeURIComponent(state.biocbotCourse.courseId)}/link`);
        state.linkedCourse = linkResult.data.lmsSync || null;
        const linkedId = String(state.linkedCourse?.courseId || '');

        const result = await providerRequest('/courses');
        select.replaceChildren();
        option(select, '', result.data.length
            ? `Select a ${provider.label} course…`
            : `No ${provider.label} courses found for your account`);
        for (const course of result.data) {
            option(select, String(course.id), course.code ? `${course.code} — ${course.name}` : course.name, {
                selected: String(course.id) === linkedId
            });
        }
        select.disabled = result.data.length === 0;

        element('lms-linked-note').textContent = linkedId
            ? `Currently linked to ${state.linkedCourse.code || state.linkedCourse.name || `course ${linkedId}`}. Choosing a different course re-links it.`
            : `This BiocBot course is not linked to ${provider.label} yet.`;
        refreshNextButton();
    }

    /** Links the selected course when it differs from the stored link. */
    async function ensureCourseLinked() {
        const provider = config();
        const selectedId = element('lms-course-select').value;
        if (state.linkedCourse && String(state.linkedCourse.courseId) === String(selectedId)) return;

        setMessage(`Linking the ${provider.label} course…`);
        const result = await providerRequest(
            `/courses/${encodeURIComponent(state.biocbotCourse.courseId)}/link`,
            { method: 'PUT', body: JSON.stringify({ [provider.courseIdField]: selectedId }) }
        );
        state.linkedCourse = result.data.lmsSync;
        setMessage(`Linked to ${state.linkedCourse.code || state.linkedCourse.name}.`, 'success');
    }

    async function loadProviderFiles() {
        const provider = config();
        const select = element('lms-file-select');
        element('lms-file-label').textContent = `${provider.label} file`;
        select.disabled = true;
        select.replaceChildren();
        option(select, '', `Loading ${provider.label} files…`);

        const result = await providerRequest(`/courses/${encodeURIComponent(state.linkedCourse.courseId)}/files`);
        state.files = result.data || [];
        select.replaceChildren();
        option(select, '', state.files.length
            ? `Select a ${provider.label} file…`
            : 'No files BiocBot can read were found in this course');
        for (const file of state.files) {
            const suffix = file.supported ? '' : ' — unsupported type or over 50 MB';
            option(select, file.id, `${file.name} (${fileSizeLabel(file.size)})${suffix}`, { disabled: !file.supported });
        }
        select.disabled = state.files.length === 0;
        refreshNextButton();
    }

    /** A last read-back of the choices, so nothing is imported by surprise. */
    function renderSummary() {
        const provider = config();
        const file = state.files.find((candidate) => candidate.id === element('lms-file-select').value);
        const rows = [
            [`${provider.label} course`, state.linkedCourse?.code || state.linkedCourse?.name || '—'],
            ['File', file ? `${file.name} (${fileSizeLabel(file.size)})` : '—'],
            ['Saved as', element('lms-file-title').value.trim() || file?.name || '—']
        ];

        const summary = element('lms-summary');
        summary.replaceChildren();
        for (const [term, detail] of rows) {
            const dt = document.createElement('dt');
            dt.textContent = term;
            const dd = document.createElement('dd');
            dd.textContent = detail;
            summary.append(dt, dd);
        }
    }

    // ------------------------------------------------------------ import + run

    function renderImportStages(activeStageId, { failed = false } = {}) {
        const list = element('lms-progress-list');
        const activeIndex = IMPORT_STAGES.findIndex((stage) => stage.id === activeStageId);
        list.replaceChildren();

        IMPORT_STAGES.forEach((stage, index) => {
            const item = document.createElement('li');
            const isActive = index === activeIndex;
            item.className = 'lms-progress-item';
            item.dataset.state = activeStageId === 'done' || index < activeIndex
                ? 'complete'
                : (isActive ? (failed ? 'failed' : 'active') : 'pending');

            const icon = document.createElement('span');
            icon.className = 'lms-progress-icon';
            icon.setAttribute('aria-hidden', 'true');
            icon.textContent = item.dataset.state === 'complete'
                ? '✓'
                : (item.dataset.state === 'failed' ? '!' : (isActive ? '●' : '○'));

            const label = document.createElement('span');
            label.className = 'lms-progress-label';
            label.textContent = stage.label.replace('{provider}', config().label);

            const detail = document.createElement('span');
            detail.className = 'lms-progress-detail';
            detail.id = `lms-progress-detail-${stage.id}`;

            item.append(icon, label, detail);
            list.appendChild(item);
        });
    }

    function setStageDetail(stageId, detail) {
        const target = element(`lms-progress-detail-${stageId}`);
        if (target) target.textContent = detail;
    }

    /**
     * Reads the server's newline-delimited progress stream. Each line is one
     * complete JSON event, but a chunk can split mid-line, so the tail is held
     * back until its newline arrives.
     */
    async function readProgressStream(response, onEvent) {
        const reader = response.body.getReader();
        const decoder = new TextDecoder();
        let buffer = '';

        for (;;) {
            const { done, value } = await reader.read();
            if (done) break;
            buffer += decoder.decode(value, { stream: true });
            const lines = buffer.split('\n');
            buffer = lines.pop() || '';
            for (const line of lines) {
                if (line.trim()) onEvent(JSON.parse(line));
            }
        }
        if (buffer.trim()) onEvent(JSON.parse(buffer));
    }

    async function runImport() {
        const provider = config();
        const fileId = element('lms-file-select').value;
        const lectureName = element('lms-unit-select').value;
        const title = element('lms-file-title').value.trim();

        state.importing = true;
        renderStep();
        renderImportStages('download');
        element('lms-progress-result').textContent = '';
        setMessage('');

        let lastStage = 'download';
        try {
            const response = await fetch(
                `${provider.apiRoot}/courses/${encodeURIComponent(state.biocbotCourse.courseId)}/import-file`,
                {
                    method: 'POST',
                    credentials: 'same-origin',
                    headers: {
                        'Content-Type': 'application/json',
                        // Opts into per-stage streaming; without it the server
                        // replies with a single JSON body at the end.
                        Accept: 'application/x-ndjson'
                    },
                    body: JSON.stringify({
                        [provider.fileIdField]: fileId,
                        lectureName,
                        documentType: element('lms-document-type-select').value,
                        ...(title ? { title } : {})
                    })
                }
            );

            if (!response.ok) {
                const body = await response.json().catch(() => ({}));
                const error = new Error(body.message || `Import failed (${response.status})`);
                error.status = response.status;
                throw error;
            }

            let finished = null;
            let failure = null;
            await readProgressStream(response, (event) => {
                if (event.type === 'step') {
                    lastStage = event.step;
                    renderImportStages(event.step);
                    if (event.detail) setStageDetail(event.step, event.detail);
                } else if (event.type === 'detail') {
                    setStageDetail(event.step, event.detail);
                } else if (event.type === 'done') {
                    finished = event.data;
                } else if (event.type === 'error') {
                    failure = Object.assign(new Error(event.message), { code: event.code });
                }
            });
            if (failure) throw failure;
            if (!finished) throw new Error('The import ended without confirming a result.');

            renderImportStages('done');
            const chunkNote = finished.chunksStored
                ? ` ${finished.chunksStored} searchable chunks were created.`
                : ' No searchable chunks were created — the file may have no extractable text.';
            element('lms-progress-result').textContent =
                `Imported “${finished.filename}” into ${finished.lectureName}.${chunkNote}`;
            setMessage('Import complete.', 'success');
            element('lms-import-next').hidden = false;
            element('lms-import-next').disabled = false;
            element('lms-import-next').textContent = 'Done';
            if (typeof loadDocuments === 'function') await loadDocuments();
        } catch (error) {
            renderImportStages(lastStage, { failed: true });
            const message = error.status === 409
                ? `That ${provider.label} file is already in this BiocBot course.`
                : error.message;
            element('lms-progress-result').textContent = message;
            setMessage(message, 'error');
            element('lms-import-back').hidden = false;
            element('lms-import-back').textContent = 'Back to the file list';
        } finally {
            state.importing = false;
        }
    }

    // ---------------------------------------------------------------- movement

    async function goToStep(index) {
        state.stepIndex = index;
        renderStep();
        setMessage('');

        try {
            const stepId = WIZARD_STEPS[index].id;
            if (stepId === 'connect') renderConnectStep();
            if (stepId === 'course') await loadProviderCourses();
            if (stepId === 'file') await loadProviderFiles();
            if (stepId === 'destination') renderSummary();
        } catch (error) {
            setMessage(error.message, 'error');
        }
        refreshNextButton();
    }

    async function advance() {
        const next = element('lms-import-next');
        const stepId = WIZARD_STEPS[state.stepIndex].id;

        if (next.textContent === 'Done') return closeModal();

        next.disabled = true;
        try {
            if (stepId === 'course') await ensureCourseLinked();
            if (stepId === 'destination') return await runImport();
            await goToStep(state.stepIndex + 1);
        } catch (error) {
            setMessage(error.message, 'error');
            next.disabled = false;
        }
    }

    function goBack() {
        element('lms-import-back').textContent = 'Back';
        // A failed import leaves the file step as the useful place to land.
        goToStep(Math.max(0, state.stepIndex === WIZARD_STEPS.length - 1 ? 2 : state.stepIndex - 1));
    }

    // ------------------------------------------------------------------- modal

    let lastFocusedElement = null;

    async function openModal(provider) {
        state.provider = provider;
        state.linkedCourse = null;
        state.files = [];
        state.importing = false;
        lastFocusedElement = document.activeElement;

        const modal = element('lms-import-modal');
        modal.classList.add('show');
        setMessage('');
        element('lms-import-back').textContent = 'Back';

        try {
            await loadBiocBotCourse();
            populateUnits();
        } catch (error) {
            setMessage(`Could not load this BiocBot course: ${error.message}`, 'error');
        }

        try {
            await providerRequest('/status');
            state.connected = true;
            setChipState(provider, 'Connected', 'connected');
        } catch (error) {
            state.connected = false;
            if (error.status !== 401) {
                setMessage(`${config().label} is unavailable: ${error.message}`, 'error');
            }
        }

        // Connecting is a one-time chore, so an already-authorized instructor
        // starts at the first step that actually needs a decision.
        await goToStep(state.connected ? 1 : 0);
        element('lms-import-close').focus();
    }

    function closeModal() {
        element('lms-import-modal').classList.remove('show');
        lastFocusedElement?.focus?.();
    }

    async function connectWithToken() {
        const input = element('lms-token-input');
        const token = input.value.trim();
        if (!token) {
            setMessage('Paste a Moodle web-service token first.', 'error');
            return;
        }

        const button = element('lms-connect-token-btn');
        button.disabled = true;
        setMessage('Checking the token with Moodle…');
        try {
            await providerRequest('/auth/connect', { method: 'POST', body: JSON.stringify({ token }) });
            input.value = '';
            state.connected = true;
            setChipState(state.provider, 'Connected', 'connected');
            setMessage('Moodle connected.', 'success');
            await goToStep(1);
        } catch (error) {
            setMessage(error.message, 'error');
        } finally {
            button.disabled = false;
        }
    }

    function connectWithOauth() {
        // Canvas sends the browser back to this page; the marker reopens the
        // wizard where the instructor left off instead of on a blank page.
        const url = new URL(window.location.href);
        url.searchParams.set('lmsImport', state.provider);
        const returnTo = `${url.pathname}${url.search}`;
        window.location.assign(`${config().apiRoot}/auth/login?returnTo=${encodeURIComponent(returnTo)}`);
    }

    async function disconnect() {
        const provider = config();
        const button = element('lms-disconnect-btn');
        button.disabled = true;
        setMessage(`Removing BiocBot’s ${provider.label} access…`);
        try {
            await providerRequest(provider.connectStyle === 'oauth' ? '/auth/logout' : '/auth/disconnect', { method: 'POST' });
            state.connected = false;
            state.linkedCourse = null;
            setChipState(state.provider, 'Not connected', 'disconnected');
            setMessage(`${provider.label} disconnected.`, 'success');
            await goToStep(0);
        } catch (error) {
            setMessage(`Could not disconnect ${provider.label}: ${error.message}`, 'error');
        } finally {
            button.disabled = false;
        }
    }

    function reopenAfterOauthRedirect() {
        const params = new URLSearchParams(window.location.search);
        const provider = params.get('lmsImport');
        if (!provider || !PROVIDERS[provider]) return;

        params.delete('lmsImport');
        const query = params.toString();
        window.history.replaceState({}, '', `${window.location.pathname}${query ? `?${query}` : ''}`);
        openModal(provider);
    }

    document.addEventListener('DOMContentLoaded', async () => {
        if (!element('lms-import-modal')) return;

        for (const chip of document.querySelectorAll('.lms-import-chip')) {
            chip.addEventListener('click', () => openModal(chip.dataset.lmsProvider));
        }
        element('lms-import-close').addEventListener('click', closeModal);
        element('lms-import-back').addEventListener('click', goBack);
        element('lms-import-next').addEventListener('click', advance);
        element('lms-connect-oauth-btn').addEventListener('click', connectWithOauth);
        element('lms-connect-token-btn').addEventListener('click', connectWithToken);
        element('lms-disconnect-btn').addEventListener('click', disconnect);
        element('lms-course-select').addEventListener('change', refreshNextButton);
        element('lms-file-select').addEventListener('change', refreshNextButton);
        element('lms-unit-select').addEventListener('change', refreshNextButton);
        element('lms-import-modal').addEventListener('click', (event) => {
            if (event.target.id === 'lms-import-modal' && !state.importing) closeModal();
        });
        document.addEventListener('keydown', (event) => {
            if (event.key === 'Escape' && !state.importing) {
                if (element('lms-import-modal').classList.contains('show')) closeModal();
            }
        });

        await detectProviders();
        reopenAfterOauthRedirect();
    });
})();
