/**
 * Canvas course linking and file import for the instructor Course Upload page.
 */
(function canvasImportModule() {
    const API_ROOT = '/api/lms/canvas';
    let currentBiocBotCourse = null;
    let connected = false;

    function element(id) {
        return document.getElementById(id);
    }

    function setMessage(message, type = '') {
        const target = element('canvas-import-message');
        if (!target) return;
        target.textContent = message;
        target.className = type ? `canvas-import-message ${type}` : 'canvas-import-message';
    }

    function setConnectionStatus(message, state) {
        const target = element('canvas-connection-status');
        if (!target) return;
        target.textContent = message;
        target.dataset.state = state || '';
    }

    async function parseResponse(response) {
        const body = await response.json().catch(() => ({}));
        if (!response.ok) {
            const error = new Error(body.message || `Request failed (${response.status})`);
            error.status = response.status;
            error.body = body;
            throw error;
        }
        return body;
    }

    async function canvasRequest(path, options) {
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
        const button = element('canvas-import-file-btn');
        if (!button) return;
        button.disabled = !connected
            || !element('canvas-file-select')?.value
            || !element('canvas-unit-select')?.value
            || !currentBiocBotCourse?.lmsSync?.courseId;
    }

    function populateUnits() {
        const select = element('canvas-unit-select');
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
        return currentBiocBotCourse;
    }

    async function loadCanvasLink() {
        const result = await canvasRequest(`/courses/${encodeURIComponent(currentBiocBotCourse.courseId)}/link`);
        currentBiocBotCourse.lmsSync = result.data.lmsSync;
    }

    async function loadCanvasFiles(canvasCourseId) {
        const select = element('canvas-file-select');
        select.disabled = true;
        select.replaceChildren();
        option(select, '', 'Loading Canvas files…');
        updateImportButton();

        try {
            const result = await canvasRequest(`/courses/${encodeURIComponent(canvasCourseId)}/files`);
            select.replaceChildren();
            option(select, '', result.data.length ? 'Select a Canvas file…' : 'No supported files found');
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
            option(select, '', 'Could not load Canvas files');
            setMessage(error.message, 'error');
        }
        updateImportButton();
    }

    async function loadCanvasCourses() {
        const select = element('canvas-course-select');
        select.disabled = true;
        select.replaceChildren();
        option(select, '', 'Loading Canvas courses…');

        const result = await canvasRequest('/courses');
        const linkedId = String(currentBiocBotCourse?.lmsSync?.provider === 'canvas'
            ? currentBiocBotCourse.lmsSync.courseId
            : '');
        select.replaceChildren();
        option(select, '', result.data.length ? 'Select a Canvas course…' : 'No instructor courses found');
        for (const course of result.data) {
            option(
                select,
                String(course.id),
                course.code ? `${course.code} — ${course.name}` : course.name,
                { selected: String(course.id) === linkedId }
            );
        }
        select.disabled = result.data.length === 0;

        const linkedLabel = element('canvas-linked-course');
        if (linkedId) {
            linkedLabel.textContent = `Linked to ${currentBiocBotCourse.lmsSync.code || currentBiocBotCourse.lmsSync.name || `Canvas course ${linkedId}`}`;
            await loadCanvasFiles(linkedId);
        } else {
            linkedLabel.textContent = 'No Canvas course linked yet.';
        }
    }

    async function linkSelectedCourse() {
        const canvasCourseId = element('canvas-course-select')?.value;
        if (!canvasCourseId) {
            setMessage('Select a Canvas course first.', 'error');
            return;
        }

        const button = element('canvas-link-course-btn');
        button.disabled = true;
        setMessage('Linking course…');
        try {
            const result = await canvasRequest(
                `/courses/${encodeURIComponent(currentBiocBotCourse.courseId)}/link`,
                { method: 'PUT', body: JSON.stringify({ canvasCourseId }) }
            );
            currentBiocBotCourse.lmsSync = result.data.lmsSync;
            element('canvas-linked-course').textContent = `Linked to ${result.data.lmsSync.code || result.data.lmsSync.name}`;
            setMessage('Canvas course linked. Choose a file to import.', 'success');
            await loadCanvasFiles(canvasCourseId);
        } catch (error) {
            setMessage(error.message, 'error');
        } finally {
            button.disabled = false;
            updateImportButton();
        }
    }

    async function importSelectedFile() {
        const canvasFileId = element('canvas-file-select')?.value;
        const lectureName = element('canvas-unit-select')?.value;
        if (!canvasFileId || !lectureName) {
            setMessage('Choose both a Canvas file and a BiocBot unit.', 'error');
            return;
        }

        const button = element('canvas-import-file-btn');
        button.disabled = true;
        button.textContent = 'Importing and extracting…';
        setMessage('Downloading the file from Canvas and processing it in BiocBot.');

        try {
            const title = element('canvas-file-title')?.value.trim();
            const result = await canvasRequest(
                `/courses/${encodeURIComponent(currentBiocBotCourse.courseId)}/import-file`,
                {
                    method: 'POST',
                    body: JSON.stringify({
                        canvasFileId,
                        lectureName,
                        documentType: element('canvas-document-type-select').value,
                        ...(title ? { title } : {})
                    })
                }
            );
            const chunkNote = result.data.chunksStored
                ? ` ${result.data.chunksStored} searchable chunks were created.`
                : '';
            setMessage(`Imported ${result.data.filename}.${chunkNote}`, 'success');
            element('canvas-file-select').value = '';
            element('canvas-file-title').value = '';
            if (typeof loadDocuments === 'function') await loadDocuments();
        } catch (error) {
            if (error.status === 409) {
                setMessage('That Canvas file is already in this BiocBot course.', 'error');
            } else {
                setMessage(error.message, 'error');
            }
        } finally {
            button.textContent = 'Import file';
            updateImportButton();
        }
    }

    function connectCanvas() {
        const returnTo = `${window.location.pathname}${window.location.search}`;
        window.location.assign(`${API_ROOT}/auth/login?returnTo=${encodeURIComponent(returnTo)}`);
    }

    async function disconnectCanvas() {
        const button = element('canvas-disconnect-btn');
        if (!button || !connected) return;

        button.disabled = true;
        setMessage('Revoking BiocBot’s Canvas authorization…');
        try {
            await canvasRequest('/auth/logout', { method: 'POST' });
            connected = false;
            currentBiocBotCourse.lmsSync = null;
            setConnectionStatus('Not authorized', 'disconnected');
            element('canvas-import-controls').hidden = true;
            element('canvas-connect-controls').hidden = false;
            button.hidden = true;
            setMessage('Canvas disconnected. BiocBot can no longer access Canvas.', 'success');
        } catch (error) {
            setMessage(`Could not disconnect Canvas: ${error.message}`, 'error');
        } finally {
            button.disabled = false;
            updateImportButton();
        }
    }

    async function initializeCanvasImport() {
        if (!element('canvas-import-panel')) return;
        const connectControls = element('canvas-connect-controls');
        const importControls = element('canvas-import-controls');
        const disconnectButton = element('canvas-disconnect-btn');

        try {
            await loadBiocBotCourse();
            await canvasRequest('/status');
            connected = true;
            setConnectionStatus('Authorized', 'connected');
            connectControls.hidden = true;
            importControls.hidden = false;
            disconnectButton.hidden = false;
            await loadCanvasLink();
            await loadCanvasCourses();
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
            const connectButton = element('canvas-connect-btn');
            if (connectButton) connectButton.disabled = true;
            const help = connectControls.querySelector('.canvas-import-help');
            if (help) {
                help.textContent = error.status === 404
                    ? 'Canvas integration is not configured for this BiocBot deployment.'
                    : `Canvas is temporarily unavailable: ${error.message}`;
            }
            connectControls.hidden = false;
            importControls.hidden = true;
            disconnectButton.hidden = true;
        }
    }

    document.addEventListener('DOMContentLoaded', () => {
        element('canvas-connect-btn')?.addEventListener('click', connectCanvas);
        element('canvas-disconnect-btn')?.addEventListener('click', disconnectCanvas);
        element('canvas-link-course-btn')?.addEventListener('click', linkSelectedCourse);
        element('canvas-import-file-btn')?.addEventListener('click', importSelectedFile);
        element('canvas-file-select')?.addEventListener('change', updateImportButton);
        element('canvas-unit-select')?.addEventListener('change', updateImportButton);
        initializeCanvasImport();
    });
})();
