/**
 * Student Hub — Canvas grades for one assignment.
 *
 * Kept in its own module and its own IIFE so it does not collide with the
 * globals student-hub.js declares. The only things it borrows are the page-wide
 * helpers every instructor script uses: authenticatedFetch, showNotification,
 * and a11yModal.
 *
 * The browser never sends a Canvas course id, a Canvas user id, or a resolved
 * grade batch. It sends BiocBot's link id, an assignment id, and its own record
 * ids; the server derives everything else.
 */
(function canvasGrades() {
    'use strict';

    const MATCH_LABEL = {
        matched: 'Matched',
        appOnly: 'Not on Canvas roster',
        ambiguous: 'Duplicate PUID'
    };

    const state = {
        courseIntegrationId: null,
        canvasCourse: null,
        assignments: [],
        gradeItemId: null,
        assignment: null,
        records: [],
        roster: null,
        preview: null,
        busy: false
    };

    function el(id) {
        return document.getElementById(id);
    }

    function escapeText(value) {
        return String(value == null ? '' : value).replace(/[&<>"']/g, (character) => ({
            '&': '&amp;',
            '<': '&lt;',
            '>': '&gt;',
            '"': '&quot;',
            "'": '&#39;'
        })[character]);
    }

    function setStatus(message) {
        const status = el('canvas-grades-status');
        if (status) status.textContent = message;
    }

    function notify(message, type) {
        if (typeof showNotification === 'function') showNotification(message, type);
    }

    /**
     * Every response from these routes is JSON, including the failures. A
     * non-JSON body means the route was not mounted, which is worth saying
     * plainly rather than surfacing as a parse error.
     */
    async function callApi(path, options = {}) {
        const response = await authenticatedFetch(`/api/student-hub/canvas${path}`, options);
        const text = await response.text();
        let payload = {};
        if (text) {
            try {
                payload = JSON.parse(text);
            } catch (error) {
                throw new Error(
                    `The Canvas grade endpoint returned HTTP ${response.status} with a non-JSON response. `
                    + 'Check whether Canvas is configured for this deployment.'
                );
            }
        }
        if (!response.ok) {
            const failure = new Error(payload.message || `Canvas request failed (HTTP ${response.status})`);
            failure.code = payload.code;
            failure.details = payload.details;
            throw failure;
        }
        return payload;
    }

    function selectedCourseId() {
        const fromUrl = new URLSearchParams(window.location.search).get('courseId');
        return fromUrl || localStorage.getItem('selectedCourseId');
    }

    function setBusy(busy) {
        state.busy = busy;
        const hasAssignment = Boolean(state.gradeItemId);
        for (const [id, needsAssignment] of [
            ['canvas-import-submissions', true],
            ['canvas-import-grades', true],
            ['canvas-preview-export', true],
            ['canvas-assignment-select', false]
        ]) {
            const control = el(id);
            if (control) control.disabled = busy || (needsAssignment && !hasAssignment);
        }
    }

    function formatScore(score, maxScore) {
        if (score === null || score === undefined) return '—';
        const rounded = Number(score).toFixed(2).replace(/\.?0+$/, '');
        return maxScore === null || maxScore === undefined ? rounded : `${rounded}/${maxScore}`;
    }

    function formatTime(value) {
        if (!value) return '—';
        const date = new Date(value);
        return Number.isNaN(date.getTime()) ? '—' : date.toLocaleString();
    }

    function submissionLabel(record) {
        if (!record.submissionState) return 'Not imported';
        if (record.submissionState === 'unsubmitted') return record.submissionMissing ? 'Missing' : 'Not submitted';
        const suffix = record.submissionLate ? ' (late)' : '';
        return `${record.submissionState.charAt(0).toUpperCase()}${record.submissionState.slice(1)}${suffix}`;
    }

    function syncLabel(record) {
        if (record.syncError) return escapeText(record.syncError);
        return {
            exported: 'Exported to Canvas',
            failed: 'Export failed',
            draft: 'Draft — not exported',
            imported: 'Imported from Canvas'
        }[record.syncStatus] || '—';
    }

    /**
     * Rows are keyed by the roster report, so a student with a local draft who
     * is not on the Canvas roster still appears — with their match status
     * saying why, rather than silently vanishing from the table.
     */
    function buildRows() {
        const rows = state.records.map((record) => ({ record, match: 'matched' }));
        const known = new Set(rows.map((row) => row.record.appUserId));

        for (const entry of (state.roster?.appOnly || [])) {
            if (!entry.appUserId || known.has(entry.appUserId)) {
                const existing = rows.find((row) => row.record.appUserId === entry.appUserId);
                if (existing) existing.match = 'appOnly';
                continue;
            }
            rows.push({
                match: 'appOnly',
                record: {
                    appUserId: entry.appUserId,
                    displayName: entry.displayName,
                    puidMasked: entry.puidMasked,
                    attachments: []
                },
                note: entry.message
            });
        }

        for (const entry of (state.roster?.ambiguous || [])) {
            for (const appUserId of entry.appUserIds || []) {
                const existing = rows.find((row) => row.record.appUserId === appUserId);
                if (existing) {
                    existing.match = 'ambiguous';
                    existing.note = entry.message;
                    continue;
                }
                rows.push({
                    match: 'ambiguous',
                    record: { appUserId, displayName: '', puidMasked: entry.puidMasked, attachments: [] },
                    note: entry.message
                });
            }
        }

        return rows.sort((a, b) => String(a.record.displayName || a.record.appUserId)
            .localeCompare(String(b.record.displayName || b.record.appUserId)));
    }

    function renderTable() {
        const wrap = el('canvas-grades-table-wrap');
        if (!wrap) return;

        if (!state.gradeItemId) {
            wrap.innerHTML = '<p class="canvas-grades-empty">Choose an assignment to begin.</p>';
            return;
        }

        const rows = buildRows();
        if (!rows.length) {
            wrap.innerHTML = '<p class="canvas-grades-empty">Nothing imported yet. Import submissions or grades to populate this table.</p>';
            return;
        }

        const maxScore = state.assignment?.maxScore ?? null;
        const body = rows.map(({ record, match, note }) => {
            const editable = match === 'matched';
            const attachments = (record.attachments || []).map((attachment) => `
                <button type="button" class="btn-small btn-secondary canvas-attachment"
                        data-record-id="${escapeText(record.recordId)}"
                        data-attachment-id="${escapeText(attachment.id)}">
                    ${escapeText(attachment.displayName || 'Attachment')}
                </button>`).join(' ');

            return `
                <tr data-record-app-user="${escapeText(record.appUserId)}">
                    <th scope="row">
                        ${escapeText(record.displayName || record.appUserId)}
                        <span class="canvas-puid">${escapeText(record.puidMasked || '')}</span>
                    </th>
                    <td data-match="${escapeText(match)}">
                        ${escapeText(MATCH_LABEL[match])}
                        ${note ? `<span class="canvas-match-note">${escapeText(note)}</span>` : ''}
                    </td>
                    <td>${escapeText(submissionLabel(record))}</td>
                    <td>${escapeText(formatTime(record.submittedAt))}${attachments ? `<div class="canvas-attachments">${attachments}</div>` : ''}</td>
                    <td>
                        ${escapeText(formatScore(record.canvasScore, record.maxScore ?? maxScore))}
                        ${record.draftConflict ? '<span class="canvas-conflict">Canvas changed since your draft</span>' : ''}
                    </td>
                    <td>
                        <label class="visually-hidden" for="draft-score-${escapeText(record.appUserId)}">Draft score for ${escapeText(record.displayName || record.appUserId)}</label>
                        <input type="number" step="any" min="0" class="canvas-draft-score"
                               id="draft-score-${escapeText(record.appUserId)}"
                               data-app-user-id="${escapeText(record.appUserId)}"
                               value="${record.draftScore ?? ''}" ${editable ? '' : 'disabled'}>
                    </td>
                    <td>
                        <label class="visually-hidden" for="draft-comment-${escapeText(record.appUserId)}">Feedback for ${escapeText(record.displayName || record.appUserId)}</label>
                        <input type="text" class="canvas-draft-comment"
                               id="draft-comment-${escapeText(record.appUserId)}"
                               data-app-user-id="${escapeText(record.appUserId)}"
                               value="${escapeText(record.draftComment || '')}" ${editable ? '' : 'disabled'}>
                    </td>
                    <td>${syncLabel(record)}</td>
                </tr>`;
        }).join('');

        wrap.innerHTML = `
            <table class="canvas-grades-table">
                <caption>${escapeText(state.assignment?.name || 'Assignment')} — grades and submissions</caption>
                <thead>
                    <tr>
                        <th scope="col">Student</th>
                        <th scope="col">Match status</th>
                        <th scope="col">Submission</th>
                        <th scope="col">Submitted</th>
                        <th scope="col">Canvas score</th>
                        <th scope="col">Local draft</th>
                        <th scope="col">Feedback</th>
                        <th scope="col">Sync status</th>
                    </tr>
                </thead>
                <tbody>${body}</tbody>
            </table>`;

        wrap.querySelectorAll('.canvas-draft-score, .canvas-draft-comment')
            .forEach((input) => input.addEventListener('change', onDraftChanged));
        wrap.querySelectorAll('.canvas-attachment')
            .forEach((button) => button.addEventListener('click', onDownloadAttachment));
    }

    function renderRoster() {
        const panel = el('canvas-roster-panel');
        const summary = el('canvas-roster-summary');
        const body = el('canvas-roster-body');
        if (!panel || !summary || !body || !state.roster) return;

        const roster = state.roster;
        const unmatched = (roster.appOnly || []).length + (roster.ambiguous || []).length;
        panel.hidden = false;
        summary.textContent = unmatched
            ? `${roster.matchedCount} matched, ${unmatched} unmatched`
            : `All ${roster.matchedCount} students matched`;

        const coverage = roster.coverage || {};
        const sections = [];

        if (coverage.total > 0) {
            const percent = Math.round(((coverage.integrationId || 0) / coverage.total) * 100);
            sections.push(`<p class="canvas-roster-coverage"><strong>Canvas integration_id coverage:</strong> ${percent}% (${coverage.integrationId || 0}/${coverage.total})</p>`);
        }

        if ((roster.appOnly || []).length) {
            sections.push(`
                <section class="canvas-roster-group">
                    <h3>Not on the Canvas roster</h3>
                    <p>These BiocBot students were not found on the linked Canvas course's active roster, so they have no Canvas record to sync. They are not simply missing a submission.</p>
                    <ul>${roster.appOnly.map((entry) => `<li>${escapeText(entry.displayName)} — ${escapeText(entry.message)}</li>`).join('')}</ul>
                </section>`);
        }

        if ((roster.ambiguous || []).length) {
            sections.push(`
                <section class="canvas-roster-group">
                    <h3>Duplicate identities</h3>
                    <p>These PUIDs are claimed more than once, so no grade can be attributed. Fix the duplicate accounts before syncing.</p>
                    <ul>${roster.ambiguous.map((entry) => `<li>${escapeText(entry.displayNames.join(', '))} — ${escapeText(entry.message)}</li>`).join('')}</ul>
                </section>`);
        }

        if ((roster.withoutPuid || []).length) {
            sections.push(`
                <section class="canvas-roster-group">
                    <h3>No PUID recorded</h3>
                    <p>A PUID is the only key that can be matched to Canvas, so these accounts cannot be synced until one is recorded.</p>
                    <ul>${roster.withoutPuid.map((entry) => `<li>${escapeText(entry.displayName)}</li>`).join('')}</ul>
                </section>`);
        }

        if ((roster.rosterOnly || []).length) {
            sections.push(`<p class="canvas-roster-note">${roster.rosterOnly.length} Canvas student(s) have no BiocBot account. This is expected on a partly adopted course.</p>`);
        }

        body.innerHTML = sections.join('') || '<p>Everyone matched.</p>';
    }

    async function onDraftChanged(event) {
        const input = event.currentTarget;
        const appUserId = input.dataset.appUserId;
        const row = input.closest('tr');
        const scoreInput = row.querySelector('.canvas-draft-score');
        const commentInput = row.querySelector('.canvas-draft-comment');

        try {
            const payload = await callApi('/grades/draft', {
                method: 'PUT',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({
                    courseIntegrationId: state.courseIntegrationId,
                    gradeItemId: state.gradeItemId,
                    appUserId,
                    draftScore: scoreInput.value === '' ? null : Number(scoreInput.value),
                    draftComment: commentInput.value
                })
            });

            const updated = payload.data.record;
            const index = state.records.findIndex((record) => record.appUserId === appUserId);
            if (index === -1) state.records.push(updated);
            else state.records[index] = updated;
            setStatus('Draft saved.');
        } catch (error) {
            notify(error.message, 'error');
            setStatus(error.message);
        }
    }

    async function onDownloadAttachment(event) {
        const button = event.currentTarget;
        button.disabled = true;
        try {
            // A plain link would expose a Canvas URL; the bytes come back through
            // BiocBot, which re-resolves them per course, assignment, and student.
            const response = await authenticatedFetch('/api/student-hub/canvas/submissions/attachment', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({
                    courseIntegrationId: state.courseIntegrationId,
                    gradeItemId: state.gradeItemId,
                    recordId: button.dataset.recordId,
                    attachmentId: button.dataset.attachmentId
                })
            });
            if (!response.ok) {
                const payload = await response.json().catch(() => ({}));
                throw new Error(payload.message || `Download failed (HTTP ${response.status})`);
            }

            const blob = await response.blob();
            const url = URL.createObjectURL(blob);
            const link = document.createElement('a');
            link.href = url;
            link.download = button.textContent.trim() || 'submission';
            document.body.appendChild(link);
            link.click();
            link.remove();
            URL.revokeObjectURL(url);
        } catch (error) {
            notify(error.message, 'error');
        } finally {
            button.disabled = false;
        }
    }

    function applyImportResult(data) {
        state.assignment = data.assignment || state.assignment;
        state.records = data.records || [];
        state.roster = data.roster || state.roster;
        renderRoster();
        renderTable();
    }

    async function importFrom(path, label) {
        if (!state.gradeItemId) return;
        setBusy(true);
        setStatus(`Importing ${label} from Canvas…`);
        try {
            const payload = await callApi(path, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({
                    courseIntegrationId: state.courseIntegrationId,
                    gradeItemId: state.gradeItemId
                })
            });
            applyImportResult(payload.data);

            const parts = [`Imported ${payload.data.importedCount} ${label}.`];
            if (payload.data.unresolved?.length) {
                parts.push(`${payload.data.unresolved.length} Canvas row(s) could not be matched to a BiocBot account.`);
            }
            if (payload.data.preservedDrafts?.length) {
                parts.push(`${payload.data.preservedDrafts.length} unexported draft(s) were kept — review the highlighted rows.`);
            }
            setStatus(parts.join(' '));
            notify(parts[0], 'success');
        } catch (error) {
            setStatus(error.message);
            notify(error.message, 'error');
        } finally {
            setBusy(false);
        }
    }

    function renderPreview(data) {
        const body = el('canvas-export-body');
        const confirm = el('canvas-export-confirm');
        if (!body || !confirm) return;

        const assignment = data.assignment || {};
        const unresolved = (data.unresolved || []).map((entry) => `
            <li>${escapeText(entry.displayName || entry.puidMasked)} — ${escapeText({
                'no-roster-match': 'not on the linked Canvas course roster',
                'ambiguous-key': 'duplicate PUID',
                'duplicate-key': 'the same PUID appears twice in this export'
            }[entry.reason] || entry.reason)}</li>`).join('');

        const skipped = (data.skippedNoDraft || []).map((entry) => `<li>${escapeText(entry.displayName)}</li>`).join('');

        body.innerHTML = `
            <dl class="canvas-export-facts">
                <dt>Canvas course</dt>
                <dd>${escapeText(data.canvasCourse?.name || '')} ${escapeText(data.canvasCourse?.code || '')} (id ${escapeText(data.canvasCourse?.id || '')})</dd>
                <dt>Assignment</dt>
                <dd>${escapeText(assignment.name || '')} (id ${escapeText(assignment.gradeItemId || '')})</dd>
                <dt>Points possible</dt>
                <dd>${assignment.maxScore === null || assignment.maxScore === undefined ? 'Not set' : escapeText(assignment.maxScore)}</dd>
                <dt>Grading type</dt>
                <dd>${escapeText(assignment.gradingType || 'Not reported')}</dd>
                <dt>Students to be graded</dt>
                <dd>${escapeText(data.matchedCount)}</dd>
                <dt>Unresolved</dt>
                <dd>${escapeText(data.unresolvedCount)}</dd>
            </dl>

            <p class="canvas-export-visibility ${data.postManually ? 'is-manual' : 'is-automatic'}">
                <strong>${data.postManually ? 'Manual posting policy.' : 'Automatic posting policy.'}</strong>
                ${escapeText(data.visibilityWarning || '')}
            </p>

            ${unresolved ? `
                <section class="canvas-export-group">
                    <h3>Will not receive a grade</h3>
                    <ul>${unresolved}</ul>
                </section>` : ''}

            ${skipped ? `
                <section class="canvas-export-group">
                    <h3>No draft to export</h3>
                    <ul>${skipped}</ul>
                </section>` : ''}

            ${data.blocked ? `
                <p class="canvas-export-blocked">${escapeText(data.message || '')}</p>
                ${data.canAcknowledgePartial ? `
                    <p class="canvas-export-ack">
                        <label>
                            <input type="checkbox" id="canvas-export-allow-partial">
                            Export the ${escapeText(data.matchedCount)} matched student(s) only, and leave the unresolved students ungraded.
                        </label>
                    </p>` : ''}` : ''}
        `;

        if (data.blocked) {
            confirm.textContent = 'Continue with a partial export';
            confirm.disabled = !data.canAcknowledgePartial;
        } else {
            confirm.textContent = `Export ${data.matchedCount} grade(s) to Canvas`;
            confirm.disabled = data.matchedCount === 0;
        }
    }

    function closeExportModal() {
        const modal = el('canvas-export-modal');
        if (!modal) return;
        // Visibility is the caller's job here; a11yModal owns focus and the
        // Escape/backdrop contract. Same split as the other instructor modals.
        if (window.a11yModal) window.a11yModal.close(modal);
        modal.classList.remove('show');
        state.preview = null;
    }

    async function previewExport(allowPartial) {
        if (!state.gradeItemId) return;
        setBusy(true);
        setStatus('Preparing the Canvas export…');
        try {
            const payload = await callApi('/grade-exports/preview', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({
                    courseIntegrationId: state.courseIntegrationId,
                    gradeItemId: state.gradeItemId,
                    allowPartial: allowPartial === true
                })
            });
            state.preview = payload.data;
            renderPreview(payload.data);

            const modal = el('canvas-export-modal');
            if (modal) {
                modal.classList.add('show');
                if (window.a11yModal && !window.a11yModal.isOpen(modal)) {
                    window.a11yModal.open(modal, {
                        labelledBy: 'canvas-export-title',
                        onRequestClose: closeExportModal
                    });
                }
            }
            setStatus('Review the export, then confirm.');
        } catch (error) {
            setStatus(error.message);
            notify(error.message, 'error');
            if (Array.isArray(error.details)) {
                for (const detail of error.details) {
                    notify(`${detail.displayName}: ${detail.message}`, 'error');
                }
            }
        } finally {
            setBusy(false);
        }
    }

    async function confirmExport() {
        const preview = state.preview;
        if (!preview) return;

        // A blocked preview has no prepared operation. Acknowledging the partial
        // export regenerates one server-side with that decision recorded, rather
        // than sending a flag along with the confirmation.
        if (preview.blocked) {
            const acknowledgement = el('canvas-export-allow-partial');
            if (!acknowledgement?.checked) {
                notify('Tick the acknowledgement to export only the matched students.', 'warning');
                return;
            }
            await previewExport(true);
            return;
        }

        const confirmButton = el('canvas-export-confirm');
        if (confirmButton) confirmButton.disabled = true;
        setStatus('Exporting to Canvas…');
        try {
            const payload = await callApi(
                `/grade-exports/${encodeURIComponent(preview.preparedOperationId)}/confirm`,
                {
                    method: 'POST',
                    headers: { 'Content-Type': 'application/json' },
                    body: JSON.stringify({ courseIntegrationId: state.courseIntegrationId })
                }
            );

            const data = payload.data;
            state.records = data.records || state.records;
            renderTable();
            closeExportModal();

            // Canvas applies grades asynchronously; this is the finished job's
            // own result, not the fact that it was accepted.
            if (data.success) {
                const visibility = data.postManually
                    ? 'They stay hidden until you post the assignment in Canvas.'
                    : 'They are visible to students now.';
                setStatus(`Canvas finished the export: ${data.writeCount} grade(s) written. ${visibility}`);
                notify('Canvas grade export completed.', 'success');
            } else {
                setStatus(`Canvas reported the export as ${data.workflowState}: ${data.message || 'no detail provided'}`);
                notify('Canvas reported the grade export as failed.', 'error');
            }
        } catch (error) {
            setStatus(error.message);
            notify(error.message, 'error');
            if (confirmButton) confirmButton.disabled = false;
        }
    }

    async function loadAssignmentGrades() {
        if (!state.gradeItemId) {
            state.assignment = null;
            state.records = [];
            renderTable();
            return;
        }
        setBusy(true);
        try {
            const payload = await callApi(
                `/grades?courseIntegrationId=${encodeURIComponent(state.courseIntegrationId)}`
                + `&gradeItemId=${encodeURIComponent(state.gradeItemId)}`
            );
            state.assignment = payload.data.assignment;
            state.records = payload.data.records || [];
            renderTable();
            setStatus(state.records.length
                ? `${state.records.length} student row(s) stored for ${state.assignment.name}.`
                : `Nothing imported yet for ${state.assignment.name}.`);
        } catch (error) {
            setStatus(error.message);
        } finally {
            setBusy(false);
        }
    }

    async function initialize() {
        const section = el('canvas-grades-section');
        const courseId = selectedCourseId();
        if (!section || !courseId) return;

        let link;
        try {
            link = await callApi(`/link/${encodeURIComponent(courseId)}`);
        } catch (error) {
            // Not linked to Canvas, Canvas not configured for this deployment, or
            // no access. All three mean this area has nothing to show.
            return;
        }

        state.courseIntegrationId = link.data.courseIntegrationId;
        state.canvasCourse = link.data.canvasCourse;
        section.hidden = false;

        const note = el('canvas-grades-course-note');
        if (note) {
            note.textContent = `Linked to Canvas course ${state.canvasCourse.name || state.canvasCourse.id}`
                + `${state.canvasCourse.code ? ` (${state.canvasCourse.code})` : ''}. `
                + 'Every import and export below uses only that course.';
        }

        const select = el('canvas-assignment-select');
        select?.addEventListener('change', () => {
            state.gradeItemId = select.value || null;
            state.roster = null;
            const panel = el('canvas-roster-panel');
            if (panel) panel.hidden = true;
            setBusy(false);
            loadAssignmentGrades();
        });

        el('canvas-import-grades')?.addEventListener('click', () => importFrom('/grades/import', 'grades'));
        el('canvas-import-submissions')?.addEventListener('click', () => importFrom('/submissions/import', 'submissions'));
        el('canvas-preview-export')?.addEventListener('click', () => previewExport(false));
        el('canvas-export-confirm')?.addEventListener('click', confirmExport);
        el('canvas-export-cancel')?.addEventListener('click', closeExportModal);
        el('canvas-export-close')?.addEventListener('click', closeExportModal);

        try {
            const payload = await callApi(
                `/assignments?courseIntegrationId=${encodeURIComponent(state.courseIntegrationId)}`
            );
            state.assignments = payload.data.assignments || [];
            if (select) {
                select.replaceChildren();
                const placeholder = document.createElement('option');
                placeholder.value = '';
                placeholder.textContent = state.assignments.length
                    ? 'Choose an assignment…'
                    : 'No assignments in this Canvas course';
                select.appendChild(placeholder);
                for (const assignment of state.assignments) {
                    const option = document.createElement('option');
                    option.value = assignment.gradeItemId;
                    option.textContent = assignment.maxScore === null || assignment.maxScore === undefined
                        ? assignment.name
                        : `${assignment.name} (out of ${assignment.maxScore})`;
                    select.appendChild(option);
                }
            }
            setStatus(state.assignments.length
                ? 'Choose an assignment to import submissions and grades.'
                : 'This Canvas course has no assignments.');
        } catch (error) {
            setStatus(error.message);
        }

        setBusy(false);
        renderTable();
    }

    document.addEventListener('DOMContentLoaded', () => {
        // student-hub.js owns the auth gate for this page; wait for it so this
        // module's first request is not the one that discovers a stale session.
        const start = typeof waitForAuth === 'function' ? waitForAuth() : Promise.resolve();
        Promise.resolve(start).then(initialize).catch((error) => {
            console.error('Canvas grades area failed to initialize:', error);
        });
    });
})();
