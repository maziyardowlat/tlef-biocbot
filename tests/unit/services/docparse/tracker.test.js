/**
 * The poll loop. Four rules here are easy to get wrong and expensive when they
 * are: a 404 is terminal, `failed` may not be, `metadata` is null until it is,
 * and the deadline has to outlast the service's own worker timeout.
 */
const { JobTracker } = require('../../../../src/services/docparse/tracker');
const { DocParseError } = require('../../../../src/services/docparse/client');

const CONFIG = {
    pollIntervalMs: 10,
    pollMaxIntervalMs: 50,
    pollTimeoutMs: 60_000,
    maxTrackedJobs: 10
};

/** A client that walks a scripted list of status responses, one per poll. */
function scriptedClient(responses) {
    let call = 0;
    return {
        calls: () => call,
        getStatus: jest.fn(async () => {
            const next = responses[Math.min(call, responses.length - 1)];
            call += 1;
            if (next instanceof Error) throw next;
            return next;
        })
    };
}

/**
 * A clock the injected sleep advances, so a 30-minute deadline can be exhausted
 * in a test without waiting 30 minutes.
 */
function fakeClock() {
    let now = 1_000_000;
    const spy = jest.spyOn(Date, 'now').mockImplementation(() => now);
    return {
        advance: (ms) => { now += ms; },
        restore: () => spy.mockRestore()
    };
}

const noSleep = async () => {};

afterEach(() => jest.restoreAllMocks());

describe('JobTracker.track', () => {
    test('polls until done and reports a heartbeat for every status read', async () => {
        const client = scriptedClient([
            { status: 'queued' },
            { status: 'queued' },
            { status: 'processing' },
            { status: 'done', metadata: { warnings: [], pages: 12 } }
        ]);
        const seen = [];
        const tracker = new JobTracker({ client, config: CONFIG, sleep: noSleep });

        const final = await tracker.track('job-1', { onStatus: (s) => seen.push(s) });

        expect(final.status).toBe('done');
        expect(final.metadata.pages).toBe(12);
        // Repeated states still reach listeners so a long parse looks alive.
        expect(client.calls()).toBe(4);
        expect(seen.map((s) => s.status)).toEqual(['queued', 'queued', 'processing', 'done']);
        expect(seen.map((s) => s.polls)).toEqual([1, 2, 3, 4]);
    });

    test('keeps polling through `failed` on a transient reason, and can still finish done', async () => {
        const client = scriptedClient([
            { status: 'processing' },
            { status: 'failed', reason: 'scan_unavailable' },
            { status: 'failed', reason: 'scan_unavailable' },
            { status: 'done', metadata: { warnings: [] } }
        ]);
        const seen = [];
        const tracker = new JobTracker({ client, config: CONFIG, sleep: noSleep });

        const final = await tracker.track('job-2', { onStatus: (s) => seen.push(s) });

        expect(final.status).toBe('done');
        // A transient failure remains non-final, including repeated heartbeats.
        expect(seen.map((s) => `${s.status}/${s.reason}`)).toEqual([
            'processing/null', 'failed/scan_unavailable', 'failed/scan_unavailable', 'done/null'
        ]);
    });

    test('stops on `failed` once the reason becomes a verdict', async () => {
        const client = scriptedClient([
            { status: 'failed', reason: 'scan_unavailable' },
            { status: 'failed', reason: 'retries_exhausted' },
            { status: 'done' }
        ]);
        const tracker = new JobTracker({ client, config: CONFIG, sleep: noSleep });

        const final = await tracker.track('job-3');

        expect(final).toMatchObject({ status: 'failed', reason: 'retries_exhausted' });
        expect(client.calls()).toBe(2);
    });

    test('reports the reason change even when the status does not move', async () => {
        const client = scriptedClient([
            { status: 'failed', reason: 'scan_unavailable' },
            { status: 'failed', reason: 'retries_exhausted' }
        ]);
        const seen = [];
        const tracker = new JobTracker({ client, config: CONFIG, sleep: noSleep });

        await tracker.track('job-4', { onStatus: (s) => seen.push(s) });

        expect(seen.map((s) => s.reason)).toEqual(['scan_unavailable', 'retries_exhausted']);
    });

    test('treats a 404 mid-poll as terminal — there is no `expired` status', async () => {
        const client = scriptedClient([
            { status: 'processing' },
            new DocParseError('gone', { status: 404, reason: 'not_found' })
        ]);
        const seen = [];
        const tracker = new JobTracker({ client, config: CONFIG, sleep: noSleep });

        const final = await tracker.track('job-5', { onStatus: (s) => seen.push(s) });

        expect(final).toEqual({ status: 'failed', reason: 'not_found' });
        expect(seen.at(-1)).toMatchObject({ reason: 'not_found', final: true });
        expect(client.calls()).toBe(2);
    });

    test('withholds metadata until the job is terminal — it is null before that', async () => {
        const client = scriptedClient([
            { status: 'processing', metadata: null },
            { status: 'done', metadata: { warnings: ['images_described'] } }
        ]);
        const seen = [];
        const tracker = new JobTracker({ client, config: CONFIG, sleep: noSleep });

        await tracker.track('job-6', { onStatus: (s) => seen.push(s) });

        expect(seen[0].metadata).toBeNull();
        expect(seen[0].final).toBe(false);
        expect(seen[1].metadata.warnings).toEqual(['images_described']);
        expect(seen[1].final).toBe(true);
    });

    test('gives up with poll_timeout once the deadline passes', async () => {
        const clock = fakeClock();
        const client = scriptedClient([{ status: 'processing' }]);
        const tracker = new JobTracker({
            client,
            config: { ...CONFIG, pollTimeoutMs: 500 },
            sleep: async (ms) => clock.advance(ms)
        });

        const final = await tracker.track('job-7');

        expect(final).toEqual({ status: 'failed', reason: 'poll_timeout' });
        clock.restore();
    });

    test('backs off between polls, capped at pollMaxIntervalMs', async () => {
        const waits = [];
        const client = scriptedClient([
            { status: 'processing' }, { status: 'processing' }, { status: 'processing' },
            { status: 'processing' }, { status: 'processing' }, { status: 'processing' },
            { status: 'done' }
        ]);
        const tracker = new JobTracker({
            client,
            config: CONFIG,
            sleep: async (ms) => { waits.push(ms); }
        });

        await tracker.track('job-8');

        expect(waits[0]).toBe(10);
        expect(waits[1]).toBeGreaterThan(waits[0]);
        expect(Math.max(...waits)).toBeLessThanOrEqual(CONFIG.pollMaxIntervalMs);
    });

    test('never rejects — a detached tracker must not take the process down', async () => {
        const client = { getStatus: jest.fn(async () => { throw new Error('gateway is gone'); }) };
        const tracker = new JobTracker({ client, config: CONFIG, sleep: noSleep });

        await expect(tracker.track('job-9')).resolves.toMatchObject({
            status: 'failed',
            reason: 'tracker_error'
        });
    });

    test('refuses to track the same job twice', async () => {
        let release;
        const gate = new Promise((resolve) => { release = resolve; });
        const client = { getStatus: jest.fn(async () => { await gate; return { status: 'done' }; }) };
        const tracker = new JobTracker({ client, config: CONFIG, sleep: noSleep });

        const first = tracker.track('job-10');
        const second = await tracker.track('job-10');

        expect(second).toMatchObject({ reason: 'tracker_error' });
        release();
        await expect(first).resolves.toMatchObject({ status: 'done' });
        expect(tracker.activeCount).toBe(0);
    });

    test('waits for a slot rather than tripping the service concurrency quota', async () => {
        let release;
        const gate = new Promise((resolve) => { release = resolve; });
        const client = { getStatus: jest.fn(async () => { await gate; return { status: 'done' }; }) };
        const tracker = new JobTracker({
            client,
            config: { ...CONFIG, maxTrackedJobs: 1 },
            sleep: noSleep
        });

        const first = tracker.track('busy');
        await Promise.resolve();
        expect(tracker.activeCount).toBe(1);

        const second = tracker.track('waiting');
        release();
        await expect(first).resolves.toMatchObject({ status: 'done' });
        await expect(second).resolves.toMatchObject({ status: 'done' });
    });
});
