/**
 * Topic Dashboard Timer
 *
 * Tracks how long a student actively looks at the Topic Dashboard page and
 * reports it to the server so instructors can see it in Student Hub.
 * "Active" means the tab is visible AND the browser window has focus - the
 * timer pauses the moment either goes false (switching tabs, minimizing,
 * or switching to another app) and resumes when both come back.
 */
(function () {
    const courseId = localStorage.getItem('selectedCourseId');
    if (!courseId) return;

    const HEARTBEAT_MS = 20000; // periodic flush so a crash/close doesn't lose much
    const endpoint = `/api/topic-dashboard-time/${encodeURIComponent(courseId)}`;

    let segmentStart = null; // Date.now() when the current active stretch began, or null if paused
    let pendingMs = 0; // accrued active ms not yet sent to the server

    function isPageActive() {
        return document.visibilityState === 'visible' && document.hasFocus();
    }

    function resume() {
        if (segmentStart === null) segmentStart = Date.now();
    }

    function pause() {
        if (segmentStart === null) return;
        pendingMs += Date.now() - segmentStart;
        segmentStart = null;
    }

    function send(durationMs, useBeacon) {
        if (useBeacon && navigator.sendBeacon) {
            const blob = new Blob([JSON.stringify({ durationMs })], { type: 'application/json' });
            const sent = navigator.sendBeacon(endpoint, blob);
            if (sent) return;
        }
        fetch(endpoint, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            credentials: 'include',
            keepalive: true,
            body: JSON.stringify({ durationMs })
        }).catch(() => {
            // Best-effort - losing an increment isn't worth retry complexity here.
        });
    }

    function flush(useBeacon) {
        if (pendingMs <= 0) return;
        const durationMs = Math.round(pendingMs);
        pendingMs = 0;
        send(durationMs, useBeacon);
    }

    function heartbeat() {
        if (segmentStart === null) return;
        const now = Date.now();
        pendingMs += now - segmentStart;
        segmentStart = now;
        flush(false);
    }

    function handleActivityChange() {
        if (isPageActive()) {
            resume();
        } else {
            pause();
            flush(false);
        }
    }

    function handlePageHide() {
        pause();
        flush(true);
    }

    document.addEventListener('visibilitychange', handleActivityChange);
    window.addEventListener('focus', handleActivityChange);
    window.addEventListener('blur', handleActivityChange);
    window.addEventListener('pagehide', handlePageHide);
    window.addEventListener('beforeunload', handlePageHide);
    setInterval(heartbeat, HEARTBEAT_MS);

    if (isPageActive()) resume();
})();
