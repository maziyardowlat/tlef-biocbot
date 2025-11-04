/**
 * Student Flagged Content Page
 * Lists the flags created by the authenticated student and shows instructor responses
 */

const studentFlagsState = {
    all: [],
    filtered: [],
    status: 'all'
};

document.addEventListener('DOMContentLoaded', async function() {
    try {
        const courseId = localStorage.getItem('selectedCourseId');
        if (courseId) {
            const resp = await fetch(`/api/courses/${courseId}/student-enrollment`, { credentials: 'include' });
            if (resp.ok) {
                const data = await resp.json();
                if (data && data.success && data.data && data.data.enrolled === false) {
                    // Keep header/subtitle, hide controls and list
                    const controls = document.querySelector('.filter-controls');
                    const container = document.querySelector('.flagged-content-container');
                    if (controls) controls.style.display = 'none';
                    if (container) container.style.display = 'none';
                    const mainContent = document.querySelector('.main-content');
                    if (mainContent) {
                        const notice = document.createElement('div');
                        notice.style.padding = '24px';
                        notice.innerHTML = `
                            <div style=\"background:#fff3cd;border:1px solid #ffeeba;color:#856404;padding:16px;border-radius:8px;\">
                                <h2 style=\"margin-top:0;margin-bottom:8px;\">Access disabled</h2>
                                <p>Your access in this course is revoked.</p>
                                <p>Please select another course from the course selector at the top if available.</p>
                            </div>
                        `;
                        mainContent.appendChild(notice);
                    }
                    return;
                }
            }
        }
    } catch (e) { console.warn('Enrollment check failed, proceeding:', e); }
    await initAuth();
    const statusSelect = document.getElementById('status-filter');
    if (statusSelect) {
        statusSelect.addEventListener('change', () => {
            studentFlagsState.status = statusSelect.value;
            applyStudentFlagFilters();
            renderStudentFlags();
        });
    }
    const refreshBtn = document.getElementById('refresh-flags');
    if (refreshBtn) {
        refreshBtn.addEventListener('click', () => loadStudentFlags());
    }
    await loadStudentFlags();
});

async function loadStudentFlags() {
    showStudentFlagsLoading();
    try {
        const response = await fetch('/api/flags/my', { credentials: 'include' });
        if (!response.ok) throw new Error('Failed to load flags');
        const result = await response.json();
        if (!result.success) throw new Error(result.message || 'Failed to load flags');
        studentFlagsState.all = result.data.flags || [];
        applyStudentFlagFilters();
        renderStudentFlags();
    } catch (err) {
        showStudentFlagsError('Unable to load your flags. Please try again.');
        console.error(err);
    }
}

function applyStudentFlagFilters() {
    const status = studentFlagsState.status;
    studentFlagsState.filtered = studentFlagsState.all.filter(f => status === 'all' || f.flagStatus === status);
}

function renderStudentFlags() {
    const list = document.getElementById('flagged-list');
    const empty = document.getElementById('empty-state');
    const loading = document.getElementById('loading-state');
    if (loading) loading.style.display = 'none';
    if (!list) return;
    list.innerHTML = '';
    if (studentFlagsState.filtered.length === 0) {
        if (empty) empty.style.display = 'block';
        return;
    }
    if (empty) empty.style.display = 'none';
    studentFlagsState.filtered.forEach(flag => list.appendChild(renderStudentFlagItem(flag)));
}

function renderStudentFlagItem(flag) {
    const div = document.createElement('div');
    div.className = 'flagged-item';
    const ts = formatStudentTimestamp(flag.createdAt);
    div.innerHTML = `
        <div class="flag-header">
            <div class="flag-meta">
                <div class="flag-reason ${flag.flagReason}">${mapReason(flag.flagReason)}</div>
                <div class="flag-timestamp">${ts}</div>
                <div class="flag-status"><span class="status-badge ${flag.flagStatus}">${mapStatus(flag.flagStatus)}</span></div>
            </div>
        </div>
        <div class="flag-content">
            <div class="question-content">
                <div class="content-label">Flagged Question:</div>
                <div class="question-text">${escapeHtml((flag.questionContent && flag.questionContent.question) || 'Question content not available')}</div>
                <div class="question-details">
                    <span class="question-type">${flag.questionContent && flag.questionContent.questionType ? `Type: ${escapeHtml(flag.questionContent.questionType)}` : ''}</span>
                    <span class="unit-name">Unit: ${flag.unitName || 'Unknown'}</span>
                </div>
            </div>
            <div class="question-content">
                <div class="content-label">Your Note:</div>
                <div class="question-text">${escapeHtml(flag.flagDescription)}</div>
            </div>
            ${flag.instructorResponse ? `
            <div class="instructor-response">
                <div class="content-label">Instructor Response:</div>
                <div class="response-text">${escapeHtml(flag.instructorResponse)}</div>
                <div class="response-meta">${flag.instructorName ? `Responded by: ${escapeHtml(flag.instructorName)} · ` : ''}${formatStudentTimestamp(flag.updatedAt)}</div>
            </div>` : ''}
        </div>
    `;
    return div;
}

function showStudentFlagsLoading() {
    const loading = document.getElementById('loading-state');
    const empty = document.getElementById('empty-state');
    const list = document.getElementById('flagged-list');
    if (loading) loading.style.display = 'block';
    if (empty) empty.style.display = 'none';
    if (list) list.innerHTML = '';
}

function showStudentFlagsError(message) {
    const loading = document.getElementById('loading-state');
    const empty = document.getElementById('empty-state');
    const list = document.getElementById('flagged-list');
    if (loading) loading.style.display = 'none';
    if (empty) { empty.textContent = message; empty.style.display = 'block'; }
    if (list) list.innerHTML = '';
}

function formatStudentTimestamp(ts) {
    try {
        const d = new Date(ts);
        return d.toLocaleString();
    } catch (e) {
        return 'Unknown';
    }
}

function mapReason(r) {
    const m = { incorrect: 'Incorrect', inappropriate: 'Inappropriate', unclear: 'Unclear', confusing: 'Confusing', typo: 'Typo/Error', offensive: 'Offensive', irrelevant: 'Irrelevant' };
    return m[r] || r;
}

function mapStatus(s) {
    const m = { pending: 'Pending Review', reviewed: 'Reviewed', resolved: 'Resolved', dismissed: 'Dismissed' };
    return m[s] || s;
}

function escapeHtml(text) {
    const div = document.createElement('div');
    div.textContent = text || '';
    return div.innerHTML;
}


