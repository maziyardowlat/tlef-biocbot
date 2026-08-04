/**
 * Preview Session Bootstrap ("View as Student")
 *
 * Loaded first in the head of every student page. Two jobs:
 *
 *   1. Mark this tab. An instructor enters via /student?preview=1; the flag is
 *      then kept in sessionStorage, which is per-tab, so the instructor's other
 *      tabs keep their instructor session. Every same-origin request from this
 *      tab carries X-Preview-Session, which is what the server requires before
 *      it will swap in the sandboxed student identity.
 *
 *   2. Render the preview banner and controls, so it is never ambiguous that
 *      this is a sandbox and not a real student's account.
 *
 * The fetch patch is installed at parse time, before any page script runs, so
 * no request can escape unmarked.
 */

(function () {
    'use strict';

    const STORAGE_KEY = 'biocbot_preview_tab';
    const COURSE_KEY = 'biocbot_preview_course';
    // Shared with the instructor tab (which starts a preview), so it lives in
    // localStorage rather than per-tab sessionStorage.
    const FIRST_RUN_PENDING_KEY = 'biocbot_preview_first_run_pending';
    const PREVIEW_HEADER = 'X-Preview-Session';

    /**
     * Decide whether this tab is a preview tab, and remember the answer.
     * @returns {boolean} True when the tab is in preview mode
     */
    function detectPreviewTab() {
        let fromUrl = false;
        try {
            fromUrl = new URLSearchParams(window.location.search).get('preview') === '1';
        } catch (e) {
            fromUrl = false;
        }

        if (fromUrl) {
            try {
                sessionStorage.setItem(STORAGE_KEY, '1');
            } catch (e) {
                // Private browsing can refuse storage; the URL flag still works
                // for this navigation and the server re-adds it on the next one.
            }
            return true;
        }

        try {
            return sessionStorage.getItem(STORAGE_KEY) === '1';
        } catch (e) {
            return false;
        }
    }

    /**
     * Erase every scrap of client state belonging to a preview sandbox.
     *
     * Several independent paths can restore a course: the stored course id, the
     * cached course name, and the autosaved chat, whose metadata carries its own
     * courseId that the restore path writes back over anything this script
     * clears. They have to go together or the page ends up in two states at once.
     *
     * Runs synchronously at parse time, ahead of every page script, so nothing
     * reads a value that is about to disappear.
     *
     * Sandbox keys are recognised by the preview id embedded in them, so a real
     * student's autosave on the same browser is never touched.
     */
    function wipeSandboxState() {
        try {
            const doomed = [];
            for (let index = 0; index < localStorage.length; index += 1) {
                const key = localStorage.key(index);
                if (key && key.includes('__preview__')) {
                    doomed.push(key);
                }
            }

            doomed.forEach(key => localStorage.removeItem(key));

            ['selectedCourseId', 'selectedCourseName', 'selectedUnitName', 'lastModeChange']
                .forEach(key => localStorage.removeItem(key));
        } catch (e) {
            console.warn('[PREVIEW] Could not clear sandbox state', e);
        }
    }

    /**
     * Drop courseId from the address bar without reloading.
     *
     * getCurrentCourseId reads the URL before anything else, so a courseId left
     * in the query string re-selects the course the walkthrough is about to ask
     * the previewer to choose.
     */
    function stripCourseFromUrl() {
        try {
            const url = new URL(window.location.href);
            if (!url.searchParams.has('courseId')) {
                return;
            }
            url.searchParams.delete('courseId');
            window.history.replaceState({}, '', url.toString());
        } catch (e) {
            console.warn('[PREVIEW] Could not strip courseId from the URL', e);
        }
    }

    /**
     * Pin the previewed course for the student pages.
     *
     * Student code reads the active course from localStorage.selectedCourseId.
     * The entry URL carries the course, but later navigations do not, so the
     * value is kept per-tab and re-applied on every load — synchronously, ahead
     * of any page script, so nothing reads a stale or empty course first.
     *
     * Suspended while the first-run walkthrough is pending. Its opening step
     * asks the student to choose a course, and that dropdown only renders when
     * no course is stored — pinning one would skip the step the previewer asked
     * to see. The server narrows the dropdown to the granted course, so there is
     * nothing out of scope to pick.
     */
    function pinPreviewCourse() {
        let courseId = null;

        try {
            courseId = new URLSearchParams(window.location.search).get('courseId');
        } catch (e) {
            courseId = null;
        }

        try {
            if (courseId) {
                sessionStorage.setItem(COURSE_KEY, courseId);
            } else {
                courseId = sessionStorage.getItem(COURSE_KEY);
            }

            if (localStorage.getItem(FIRST_RUN_PENDING_KEY) !== null) {
                // The walkthrough opens on "choose your course", so the sandbox
                // has to genuinely look new. Clearing the stored course alone is
                // not enough — the autosaved chat carries its own courseId and
                // the restore path writes it straight back, leaving a course
                // picker and a half-finished assessment on screen together.
                wipeSandboxState();
                stripCourseFromUrl();
                return;
            }

            if (courseId) {
                localStorage.setItem('selectedCourseId', courseId);
            }
        } catch (e) {
            console.warn('[PREVIEW] Could not pin preview course', e);
        }
    }

    const isPreviewTab = detectPreviewTab();

    if (isPreviewTab) {
        pinPreviewCourse();
    }

    window.BiocBotPreview = {
        active: isPreviewTab,
        state: null,
        /**
         * Leave preview mode and return to the instructor UI.
         * @returns {Promise<void>}
         */
        exit: async function () {
            try {
                await fetch('/api/preview/stop', { method: 'POST', credentials: 'include' });
            } catch (e) {
                console.warn('[PREVIEW] stop request failed', e);
            }
            try {
                sessionStorage.removeItem(STORAGE_KEY);
                sessionStorage.removeItem(COURSE_KEY);
            } catch (e) {
                // Nothing to clean up if storage is unavailable.
            }
            window.location.href = '/instructor/home';
        }
    };

    if (!isPreviewTab) {
        return;
    }

    // ---------------------------------------------------------------------
    // Request marking
    // ---------------------------------------------------------------------

    const nativeFetch = window.fetch.bind(window);

    /**
     * Whether a request target is same-origin, and so ours to mark.
     * @param {string} url - Request URL
     * @returns {boolean} True when same-origin
     */
    function isSameOrigin(url) {
        try {
            return new URL(url, window.location.href).origin === window.location.origin;
        } catch (e) {
            return false;
        }
    }

    window.fetch = function (input, init) {
        const url = typeof input === 'string' ? input : (input && input.url) || '';

        if (!isSameOrigin(url)) {
            return nativeFetch(input, init);
        }

        // Request objects carry their own immutable-ish headers, so rebuild the
        // request rather than mutating the caller's argument.
        if (typeof Request !== 'undefined' && input instanceof Request) {
            const headers = new Headers(input.headers);
            headers.set(PREVIEW_HEADER, '1');
            return nativeFetch(new Request(input, { headers }), init);
        }

        const options = { credentials: 'include', ...(init || {}) };
        const headers = new Headers(options.headers || {});
        headers.set(PREVIEW_HEADER, '1');
        options.headers = headers;

        return nativeFetch(input, options);
    };

    // XMLHttpRequest is used by a few older call sites; mark those too.
    if (window.XMLHttpRequest) {
        const nativeOpen = XMLHttpRequest.prototype.open;
        const nativeSend = XMLHttpRequest.prototype.send;

        XMLHttpRequest.prototype.open = function (method, url, ...rest) {
            this.__biocbotPreviewSameOrigin = isSameOrigin(url);
            return nativeOpen.call(this, method, url, ...rest);
        };

        XMLHttpRequest.prototype.send = function (...args) {
            if (this.__biocbotPreviewSameOrigin) {
                try {
                    this.setRequestHeader(PREVIEW_HEADER, '1');
                } catch (e) {
                    // Header can only be set after open(); ignore odd orderings.
                }
            }
            return nativeSend.apply(this, args);
        };
    }

    // ---------------------------------------------------------------------
    // Navigation
    // ---------------------------------------------------------------------

    /**
     * Keep the marker on in-app student links.
     *
     * A top-level navigation cannot send a header, so student links carry
     * ?preview=1 instead. Without this the server would bounce each click
     * through a redirect to add the flag back.
     */
    function markStudentLinks() {
        document.querySelectorAll('a[href^="/student"]').forEach(link => {
            const href = link.getAttribute('href');
            if (!href || href.includes('preview=1')) {
                return;
            }
            link.setAttribute('href', `${href}${href.includes('?') ? '&' : '?'}preview=1`);
        });
    }

    /**
     * Hide surfaces that are out of scope for a preview.
     * Super Course spans courses beyond the one being previewed.
     */
    function hideOutOfScopeNav() {
        const superCourseNav = document.getElementById('super-course-nav-item');
        if (superCourseNav) {
            superCourseNav.style.display = 'none';
        }
    }

    // ---------------------------------------------------------------------
    // Banner + controls
    // ---------------------------------------------------------------------

    /**
     * Read the current preview state from the server.
     * @returns {Promise<Object|null>} Preview state, or null when unavailable
     */
    async function loadState() {
        try {
            const response = await fetch('/api/preview/state', { credentials: 'include' });
            const result = await response.json();
            return result && result.success && result.active ? result : null;
        } catch (e) {
            console.warn('[PREVIEW] Could not load preview state', e);
            return null;
        }
    }

    /**
     * Persist a settings change for this preview.
     * @param {Object} patch - Settings to merge and save
     * @returns {Promise<Object|null>} Saved settings
     */
    async function saveSettings(patch) {
        const current = (window.BiocBotPreview.state && window.BiocBotPreview.state.settings) || {};
        const next = { ...current, ...patch };

        try {
            const response = await fetch('/api/preview/settings', {
                method: 'PUT',
                credentials: 'include',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify(next)
            });
            const result = await response.json();

            if (result && result.success) {
                window.BiocBotPreview.state.settings = result.settings;
                return result.settings;
            }

            console.warn('[PREVIEW] Settings not saved:', result && result.message);
            return null;
        } catch (e) {
            console.warn('[PREVIEW] Settings request failed', e);
            return null;
        }
    }

    /**
     * Flag that the next preview load should replay the first-run walkthrough.
     *
     * The actual clearing happens in wipeSandboxState at bootstrap rather than
     * here, so a sandbox carrying leftovers from an earlier session is cleaned
     * up too — not just one reset from this exact click.
     */
    function markFirstRunPending() {
        try {
            localStorage.setItem(FIRST_RUN_PENDING_KEY, '1');
            wipeSandboxState();
        } catch (e) {
            console.warn('[PREVIEW] Could not flag the first-run replay', e);
        }
    }

    /**
     * Build the preview banner and its controls.
     * @param {Object} state - Preview state from the server
     * @returns {HTMLElement} The banner element
     */
    function buildBanner(state) {
        const settings = state.settings || {};
        const banner = document.createElement('div');
        banner.className = 'preview-banner';
        banner.setAttribute('role', 'region');
        banner.setAttribute('aria-label', 'Student preview controls');

        banner.innerHTML = `
            <div class="preview-banner-main">
                <span class="preview-badge">Preview</span>
                <span class="preview-summary">
                    You are viewing <strong>${escapeHtml(state.courseName || state.courseId)}</strong>
                    as a student. Nothing here is recorded against a real student.
                </span>
                <div class="preview-actions">
                    <button type="button" class="preview-btn" id="preview-toggle-panel" aria-expanded="false">Preview settings</button>
                    <button type="button" class="preview-btn preview-btn-exit" id="preview-exit">Exit preview</button>
                </div>
            </div>
            <div class="preview-panel" id="preview-panel" hidden>
                <div class="preview-explainer">
                    <h2>What this is</h2>
                    <p>
                        A sandbox copy of your course as a student sees it. You can chat with the bot,
                        take the quiz, and work through flashcards. It is not a real student's account,
                        and it is not any particular student's data.
                    </p>

                    <h3>Nothing here reaches you or your TAs</h3>
                    <ul>
                        <li><strong>Flagged messages</strong> — flagging behaves exactly as a student sees it, but no flag is recorded and nobody is notified. Your Flagged Content queue stays untouched.</li>
                        <li><strong>Thumbs up / thumbs down</strong> — recorded against the sandbox only. It never counts toward your course's feedback list or ratings.</li>
                        <li><strong>End-of-chat surveys</strong> — same: answered in the sandbox, excluded from your survey results and exports.</li>
                        <li><strong>Wellbeing check-ins</strong> — detection is switched off entirely in preview, so nothing you type here can raise an alert.</li>
                    </ul>

                    <h3>Kept, but only for you</h3>
                    <ul>
                        <li>Chats, quiz attempts, flashcard progress, and struggle topics are saved so you can pick up where you left off. They are excluded from your dashboard, Student Hub, chat downloads, and every analytic on the instructor side.</li>
                        <li>The preview student never appears in your course roster and is never enrolled.</li>
                        <li><strong>Reset preview data</strong> deletes all of it and starts the sandbox over.</li>
                    </ul>

                    <h3>Worth knowing</h3>
                    <ul>
                        <li>Chats here use your course's real LLM settings and prompts, so they consume the same API budget as a student's.</li>
                        <li>Super Course is not part of the preview — it spans courses beyond this one.</li>
                        <li>Your instructor session stays signed in in its other tab; closing this one changes nothing.</li>
                    </ul>
                </div>
                <div class="preview-controls">
                    <label class="preview-check">
                        <input type="checkbox" id="preview-show-unpublished">
                        <span>Include unpublished units</span>
                    </label>
                    <div class="preview-panel-actions">
                        <button type="button" class="preview-btn" id="preview-replay-first-run">Replay first-run experience</button>
                        <button type="button" class="preview-btn preview-btn-danger" id="preview-reset">Reset preview data</button>
                        <span class="preview-status" id="preview-status" role="status" aria-live="polite"></span>
                    </div>
                </div>
            </div>
        `;

        const unpublished = banner.querySelector('#preview-show-unpublished');
        const status = banner.querySelector('#preview-status');

        unpublished.checked = settings.showUnpublished === true;

        /**
         * Show a short-lived confirmation next to the controls.
         * @param {string} message - Text to display
         */
        function setStatus(message) {
            status.textContent = message;
            window.setTimeout(() => {
                if (status.textContent === message) {
                    status.textContent = '';
                }
            }, 4000);
        }

        banner.querySelector('#preview-toggle-panel').addEventListener('click', event => {
            const panel = banner.querySelector('#preview-panel');
            const nowOpen = panel.hidden;
            panel.hidden = !nowOpen;
            event.currentTarget.setAttribute('aria-expanded', String(nowOpen));
        });

        banner.querySelector('#preview-exit').addEventListener('click', () => {
            window.BiocBotPreview.exit();
        });

        unpublished.addEventListener('change', async event => {
            const saved = await saveSettings({ showUnpublished: event.target.checked });
            if (saved) {
                setStatus('Reloading with the new unit visibility…');
                window.location.reload();
            }
        });

        banner.querySelector('#preview-replay-first-run').addEventListener('click', async () => {
            try {
                await fetch('/api/preview/first-run', {
                    method: 'POST',
                    credentials: 'include',
                    headers: { 'Content-Type': 'application/json' },
                    body: JSON.stringify({ completed: false })
                });
                markFirstRunPending();
                window.location.href = '/student?preview=1';
            } catch (e) {
                setStatus('Could not restart the first-run experience.');
            }
        });

        banner.querySelector('#preview-reset').addEventListener('click', async () => {
            const confirmed = window.confirm(
                'Delete all preview chats, quiz attempts, and flashcard progress for this course? Real student data is not affected.'
            );
            if (!confirmed) {
                return;
            }

            try {
                const response = await fetch('/api/preview/reset', { method: 'POST', credentials: 'include' });
                const result = await response.json();
                if (result && result.success) {
                    markFirstRunPending();
                    window.location.href = '/student?preview=1';
                } else {
                    setStatus('Could not reset preview data.');
                }
            } catch (e) {
                setStatus('Could not reset preview data.');
            }
        });

        return banner;
    }

    /**
     * Escape text for safe interpolation into the banner markup.
     * @param {string} value - Raw text
     * @returns {string} Escaped text
     */
    function escapeHtml(value) {
        const div = document.createElement('div');
        div.textContent = value == null ? '' : String(value);
        return div.innerHTML;
    }

    /**
     * Re-point the preview grant at a course the previewer just chose.
     *
     * The sandbox is scoped to one course — its id encodes which — so choosing
     * a different one has to issue a fresh grant rather than leave every later
     * request refused. /api/preview/start already validates that the real user
     * may preview the course, so it is reused here.
     *
     * @param {string} courseId - Newly chosen course
     * @returns {Promise<boolean>} Whether the grant moved
     */
    async function repointGrant(courseId) {
        try {
            const response = await fetch('/api/preview/start', {
                method: 'POST',
                credentials: 'include',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ courseId })
            });
            const result = await response.json();

            if (!result || !result.success) {
                console.warn('[PREVIEW] Could not switch preview course:', result && result.message);
                return false;
            }

            try {
                sessionStorage.setItem(COURSE_KEY, courseId);
            } catch (e) {
                // Non-fatal; the URL carries the course on the next navigation.
            }
            return true;
        } catch (e) {
            console.warn('[PREVIEW] Could not switch preview course', e);
            return false;
        }
    }

    /**
     * While the walkthrough waits on its course step, watch for the choice.
     *
     * The course dropdown is owned by the student page, which records the pick
     * in localStorage. Watching that is less brittle than binding to a control
     * this script does not render and which appears asynchronously.
     *
     * @param {Object} state - Preview state from the server
     */
    function watchForCourseChoice(state) {
        if (localStorage.getItem(FIRST_RUN_PENDING_KEY) === null) {
            return;
        }

        const timer = window.setInterval(async () => {
            const chosen = localStorage.getItem('selectedCourseId');
            if (!chosen) {
                return;
            }

            window.clearInterval(timer);
            localStorage.removeItem(FIRST_RUN_PENDING_KEY);

            // Only a different course needs a new grant; picking the one the
            // preview already covers can carry straight on.
            if (chosen !== state.courseId) {
                await repointGrant(chosen);
            }
        }, 300);
    }

    async function init() {
        markStudentLinks();
        hideOutOfScopeNav();

        const state = await loadState();

        if (!state) {
            // The grant is gone (stopped elsewhere, or the session expired).
            // Drop the tab marker so the page stops pretending to be a preview.
            try {
                sessionStorage.removeItem(STORAGE_KEY);
            } catch (e) {
                // Nothing to clean up.
            }
            window.BiocBotPreview.active = false;
            return;
        }

        window.BiocBotPreview.state = state;
        document.body.classList.add('preview-mode');

        const banner = buildBanner(state);
        document.body.insertBefore(banner, document.body.firstChild);

        // The welcome flow itself needs no help: it is gated by
        // studentOnboardingComplete on the sandbox's user record, which starts
        // false and the flow flips to true exactly as it does for a real
        // student. "Replay first-run" sets it back.
        watchForCourseChoice(state);
    }

    if (document.readyState === 'loading') {
        document.addEventListener('DOMContentLoaded', init);
    } else {
        init();
    }
})();
