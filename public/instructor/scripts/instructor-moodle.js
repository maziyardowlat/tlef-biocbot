/**
 * Moodle course linking and file import for the instructor Course Upload page.
 */
(function moodleImportModule() {
    const API_ROOT = '/api/lms/moodle';
    let currentBiocBotCourse = null;
    let linkedMoodleCourse = null;
    let connected = false;

    function element(id) {
        return document.getElementById(id);
    }

    function setMessage(message, type = '') {
        const target = element('moodle-import-message');
        if (!target) return;
        target.textContent = message;
        target.className = type ? `canvas-import-message ${type}` : 'canvas-import-message';
    }

    function setConnectionStatus(message, state) {
        const target = element('moodle-connection-status');
        if (!target) return;
        target.textContent = message;
        target.dataset.state = state || '';
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

    async function moodleRequest(path, options) {
        return parseResponse(await fetch(`${API_ROOT}${path}`, {
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

    function updateImportButton() {
        const button = element('moodle-import-file-btn');
        if (!button) return;
        button.disabled = !connected
            || !element('moodle-file-select')?.value
            || !element('moodle-unit-select')?.value
            || !linkedMoodleCourse?.courseId;
    }

    function populateUnits() {
        const select = element('moodle-unit-select');
        if (!select) return;
        select.replaceChildren();
        option(select, '', 'Select a unit…');
        for (const lecture of currentBiocBotCourse?.lectures || []) {
            option(select, lecture.name, lecture.displayName || lecture.name);
        }
        updateImportButton();
    }

    async function loadBiocBotCourse() {
        const courseId = await getCurrentCourseId();
        const response = await fetch(`/api/courses/${encodeURIComponent(courseId)}?instructorId=${encodeURIComponent(getCurrentInstructorId())}`);
        const result = await parseResponse(response);
        currentBiocBotCourse = result.data;
        populateUnits();
    }

    async function loadMoodleLink() {
        const result = await moodleRequest(`/courses/${encodeURIComponent(currentBiocBotCourse.courseId)}/link`);
        linkedMoodleCourse = result.data.lmsSync;
    }

    async function loadMoodleFiles(moodleCourseId) {
        const select = element('moodle-file-select');
        select.disabled = true;
        select.replaceChildren();
        option(select, '', 'Loading Moodle files…');
        updateImportButton();

        try {
            const result = await moodleRequest(`/courses/${encodeURIComponent(moodleCourseId)}/files`);
            select.replaceChildren();
            option(select, '', result.data.length ? 'Select a Moodle file…' : 'No course files found');
            for (const file of result.data) {
                const suffix = file.supported ? '' : ' — unsupported or over 50 MB';
                option(
                    select,
                    file.id,
                    `${file.name} (${fileSizeLabel(file.size)})${suffix}`,
                    { disabled: !file.supported }
                );
            }
            select.disabled = result.data.length === 0;
        } catch (error) {
            select.replaceChildren();
            option(select, '', 'Could not load Moodle files');
            setMessage(error.message, 'error');
        }
        updateImportButton();
    }

    async function loadMoodleCourses() {
        const select = element('moodle-course-select');
        select.disabled = true;
        select.replaceChildren();
        option(select, '', 'Loading Moodle courses…');

        const result = await moodleRequest('/courses');
        const linkedId = String(linkedMoodleCourse?.courseId || '');
        select.replaceChildren();
        option(select, '', result.data.length ? 'Select a Moodle course…' : 'No enrolled courses found');
        for (const course of result.data) {
            option(
                select,
                String(course.id),
                course.code ? `${course.code} — ${course.name}` : course.name,
                { selected: String(course.id) === linkedId }
            );
        }
        select.disabled = result.data.length === 0;

        const linkedLabel = element('moodle-linked-course');
        if (linkedId) {
            linkedLabel.textContent = `Linked to ${linkedMoodleCourse.code || linkedMoodleCourse.name || `Moodle course ${linkedId}`}`;
            await loadMoodleFiles(linkedId);
        } else {
            linkedLabel.textContent = 'No Moodle course linked yet.';
        }
    }

    async function linkSelectedCourse() {
        const moodleCourseId = element('moodle-course-select')?.value;
        if (!moodleCourseId) {
            setMessage('Select a Moodle course first.', 'error');
            return;
        }

        const button = element('moodle-link-course-btn');
        button.disabled = true;
        setMessage('Linking course…');
        try {
            const result = await moodleRequest(
                `/courses/${encodeURIComponent(currentBiocBotCourse.courseId)}/link`,
                { method: 'PUT', body: JSON.stringify({ moodleCourseId }) }
            );
            linkedMoodleCourse = result.data.lmsSync;
            element('moodle-linked-course').textContent = `Linked to ${linkedMoodleCourse.code || linkedMoodleCourse.name}`;
            setMessage('Moodle course linked. Choose a file to import.', 'success');
            await loadMoodleFiles(moodleCourseId);
        } catch (error) {
            setMessage(error.message, 'error');
        } finally {
            button.disabled = false;
            updateImportButton();
        }
    }

    async function importSelectedFile() {
        const moodleFileId = element('moodle-file-select')?.value;
        const lectureName = element('moodle-unit-select')?.value;
        if (!moodleFileId || !lectureName) {
            setMessage('Choose both a Moodle file and a BiocBot unit.', 'error');
            return;
        }

        const button = element('moodle-import-file-btn');
        button.disabled = true;
        button.textContent = 'Importing and extracting…';
        setMessage('Downloading the file from Moodle and processing it in BiocBot.');

        try {
            const title = element('moodle-file-title')?.value.trim();
            const result = await moodleRequest(
                `/courses/${encodeURIComponent(currentBiocBotCourse.courseId)}/import-file`,
                {
                    method: 'POST',
                    body: JSON.stringify({
                        moodleFileId,
                        lectureName,
                        documentType: element('moodle-document-type-select').value,
                        ...(title ? { title } : {})
                    })
                }
            );
            const chunkNote = result.data.chunksStored
                ? ` ${result.data.chunksStored} searchable chunks were created.`
                : '';
            setMessage(`Imported ${result.data.filename}.${chunkNote}`, 'success');
            element('moodle-file-select').value = '';
            element('moodle-file-title').value = '';
            if (typeof loadDocuments === 'function') await loadDocuments();
        } catch (error) {
            if (error.status === 409) {
                setMessage('That Moodle file is already in this BiocBot course.', 'error');
            } else {
                setMessage(error.message, 'error');
            }
        } finally {
            button.textContent = 'Import file';
            updateImportButton();
        }
    }

    async function connectMoodle() {
        const token = element('moodle-token-input')?.value.trim();
        if (!token) {
            setMessage('Paste a Moodle web-service token first.', 'error');
            return;
        }
        const button = element('moodle-connect-btn');
        button.disabled = true;
        setMessage('Validating Moodle token…');
        try {
            await moodleRequest('/auth/connect', {
                method: 'POST',
                body: JSON.stringify({ token })
            });
            element('moodle-token-input').value = '';
            connected = true;
            setConnectionStatus('Authorized', 'connected');
            element('moodle-connect-controls').hidden = true;
            element('moodle-import-controls').hidden = false;
            element('moodle-disconnect-btn').hidden = false;
            setMessage('Moodle connected.', 'success');
            await loadMoodleLink();
            await loadMoodleCourses();
        } catch (error) {
            setMessage(error.message, 'error');
        } finally {
            button.disabled = false;
        }
    }

    async function disconnectMoodle() {
        const button = element('moodle-disconnect-btn');
        if (!button || !connected) return;
        button.disabled = true;
        setMessage('Removing BiocBot’s stored Moodle token…');
        try {
            await moodleRequest('/auth/disconnect', { method: 'POST' });
            connected = false;
            linkedMoodleCourse = null;
            setConnectionStatus('Not authorized', 'disconnected');
            element('moodle-import-controls').hidden = true;
            element('moodle-connect-controls').hidden = false;
            button.hidden = true;
            setMessage('Moodle disconnected.', 'success');
        } catch (error) {
            setMessage(`Could not disconnect Moodle: ${error.message}`, 'error');
        } finally {
            button.disabled = false;
            updateImportButton();
        }
    }

    async function initializeMoodleImport() {
        if (!element('moodle-import-panel')) return;
        const connectControls = element('moodle-connect-controls');
        const importControls = element('moodle-import-controls');
        const disconnectButton = element('moodle-disconnect-btn');

        try {
            await loadBiocBotCourse();
            await moodleRequest('/status');
            connected = true;
            setConnectionStatus('Authorized', 'connected');
            connectControls.hidden = true;
            importControls.hidden = false;
            disconnectButton.hidden = false;
            await loadMoodleLink();
            await loadMoodleCourses();
        } catch (error) {
            if (error.status === 401) {
                connected = false;
                setConnectionStatus('Not authorized', 'disconnected');
                connectControls.hidden = false;
                importControls.hidden = true;
                disconnectButton.hidden = true;
                return;
            }
            setConnectionStatus('Unavailable', 'error');
            const connectButton = element('moodle-connect-btn');
            if (connectButton) connectButton.disabled = true;
            setMessage(error.status === 404
                ? 'Moodle integration is not configured for this BiocBot deployment.'
                : `Moodle is temporarily unavailable: ${error.message}`, 'error');
            connectControls.hidden = false;
            importControls.hidden = true;
            disconnectButton.hidden = true;
        }
    }

    document.addEventListener('DOMContentLoaded', () => {
        element('moodle-connect-btn')?.addEventListener('click', connectMoodle);
        element('moodle-disconnect-btn')?.addEventListener('click', disconnectMoodle);
        element('moodle-link-course-btn')?.addEventListener('click', linkSelectedCourse);
        element('moodle-import-file-btn')?.addEventListener('click', importSelectedFile);
        element('moodle-file-select')?.addEventListener('change', updateImportButton);
        element('moodle-unit-select')?.addEventListener('change', updateImportButton);
        initializeMoodleImport();
    });
})();
