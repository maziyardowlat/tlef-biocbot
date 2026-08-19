/**
 * Watches parsing jobs until they finish.
 *
 * WHY THIS EXISTS. Parsing is slow: the service allows a single job up to
 * 1200s. The shape BiocBot used to have —
 *
 *     const text = await parseDocumentBuffer(...);   // inside the upload route
 *
 * — held an HTTP connection open for the whole parse, and raced it against a
 * 5-minute timeout that killed any lecture slower than that. Any proxy, load
 * balancer, laptop sleep or rolling deploy drops such a connection, and when it
 * drops the parse still completed but the result is unreachable.
 *
 * So the upload route returns as soon as the bytes are handed over, and this
 * class does the waiting. Only the tracker talks to the parsing service, so ten
 * open instructor tabs are still one poller.
 *
 * Persistence is deliberately NOT owned here: callers pass `onStatus` and
 * decide what a transition means for their Mongo document. That keeps the
 * polling rules — which are subtle — in one testable place.
 *
 * PRODUCTION NOTE: state lives in this process, so two Node replicas would each
 * poll their own jobs. In-flight jobs are lost on restart; a multi-instance
 * deployment should move this to a shared queue with one worker per job.
 *
 * Ported from the service team's reference app (server/docparse/tracker.js),
 * converted from ESM to CommonJS and decoupled from its Mongo repositories.
 */

const { isFinal } = require('./errors');

const sleepReal = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

class JobTracker {
    constructor({ client, config, sleep = sleepReal }) {
        this.client = client;
        this.config = config;
        this.sleep = sleep;
        this.active = new Set();
    }

    get activeCount() {
        return this.active.size;
    }

    /**
     * Watch `jobId` until it stops moving.
     *
     * Resolves with the terminal status object — never rejects, because a
     * tracker running detached from a request must not take the process down
     * with an unhandled rejection. A failure comes back as
     * `{ status: 'failed', reason }` like any other terminal state.
     *
     * Callers that have a live progress stream (the LMS importers) may await
     * this; the manual upload route deliberately does not.
     */
    async track(jobId, { onStatus = null } = {}) {
        // Guard against double-tracking the same job from two entry points.
        if (this.active.has(jobId)) {
            return { status: 'failed', reason: 'tracker_error' };
        }
        while (this.active.size >= this.config.maxTrackedJobs) {
            // The service enforces per-app concurrency and rate limits. Rather
            // than trip them, wait for a slot; the job is queued there anyway.
            await this.sleep(this.config.pollIntervalMs);
        }

        this.active.add(jobId);
        try {
            return await this.pollUntilTerminal(jobId, onStatus);
        } catch (error) {
            return { status: 'failed', reason: error.reason || 'tracker_error', error };
        } finally {
            this.active.delete(jobId);
        }
    }

    async pollUntilTerminal(jobId, onStatus) {
        // Must exceed the service's own worker timeout (1200s by default),
        // otherwise we abandon jobs that were running perfectly normally.
        const deadline = Date.now() + this.config.pollTimeoutMs;
        let interval = this.config.pollIntervalMs;
        let last = { status: null, reason: null };
        let polls = 0;

        while (Date.now() < deadline) {
            polls += 1;

            let status;
            try {
                status = await this.client.getStatus(jobId);
            } catch (error) {
                // There is no `expired` STATUS — once a job ages out the record
                // is deleted outright — so a 404 mid-poll is terminal. A loop
                // watching only done|failed|rejected spins to its own deadline
                // against a job that no longer exists.
                if (error.status === 404) {
                    const gone = { status: 'failed', reason: 'not_found' };
                    if (onStatus) await onStatus({ ...gone, polls, final: true });
                    return gone;
                }
                throw error;
            }

            const reason = status.reason || null;

            // Report every poll so a long-lived `processing` status still gives
            // clients a heartbeat. The REASON is part of what counts as a
            // transition: a job moves failed/scan_unavailable ->
            // failed/retries_exhausted without the status shifting at all, and
            // that second reason is the verdict.
            const changed = status.status !== last.status || reason !== last.reason;
            const final = isFinal(status.status, reason);
            if (onStatus) {
                // `metadata` is null until the job is terminal, so anything
                // reading metadata.warnings mid-poll throws a TypeError.
                await onStatus({
                    status: status.status,
                    reason,
                    metadata: final ? (status.metadata || null) : null,
                    polls,
                    final
                });
                if (changed || final) last = { status: status.status, reason };
            }

            // Not a membership test against a list of terminal states: `failed`
            // is written on every failed attempt and the service retries three
            // times, so branching on status alone reports a healthy document
            // as broken.
            if (final) return status;

            await this.sleep(interval);
            // Back off: parses take seconds to minutes, so polling every second
            // for the whole duration is wasted requests. Cap it to stay
            // responsive once the job is nearly done.
            interval = Math.min(interval * 1.5, this.config.pollMaxIntervalMs);
        }

        const timedOut = { status: 'failed', reason: 'poll_timeout' };
        if (onStatus) await onStatus({ ...timedOut, polls, final: true });
        return timedOut;
    }
}

module.exports = { JobTracker };
