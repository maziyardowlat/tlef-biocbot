const { memoryDb } = require('../helpers/memory-db');
const {
    DEFAULT_INTERVAL_MINUTES,
    autoSyncIntervalMs,
    connectAs,
    connectionCandidates,
    runDueClassListSyncs,
    startClassListScheduler
} = require('../../../src/services/classListScheduler');

const HOUR = 60 * 60 * 1000;
const NOW = new Date('2026-10-01T12:00:00Z');
const INTERVAL = 6 * HOUR;

function classListCourse(overrides = {}) {
    return {
        courseId: 'BIOC-1',
        status: 'active',
        instructorId: 'inst-1',
        instructors: ['inst-1', 'inst-2'],
        rosterSource: 'canvas',
        canvasEnrollment: {
            enabled: true,
            externalCourseId: '10',
            enabledBy: 'inst-1',
            syncStatus: { lastAttemptAt: new Date(NOW.getTime() - 7 * HOUR), lastError: null }
        },
        ...overrides
    };
}

/** Instructors listed in `connected` have a working saved Canvas connection. */
function fakeCanvas(connected = ['inst-1', 'inst-2']) {
    return {
        api: {
            requireAuth: () => async (req, res, next) => {
                if (!connected.includes(req.user.userId)) {
                    return res.status(401).json({ success: false, connected: false });
                }
                req.canvasApi = { owner: req.user.userId };
                return next();
            }
        },
        config: { getUserKey: (req) => req.user.userId, tokenStore: { get: async () => null } }
    };
}

function run(db, overrides = {}) {
    return runDueClassListSyncs({
        db,
        integration: { canvas: overrides.canvas || fakeCanvas() },
        intervalMs: INTERVAL,
        now: NOW,
        runSync: overrides.runSync || jest.fn(async () => ({ addedCount: 2 })),
        ...(overrides.connect ? { connect: overrides.connect } : {})
    });
}

async function syncStatusOf(db, courseId = 'BIOC-1') {
    return (await db.collection('courses').findOne({ courseId })).canvasEnrollment.syncStatus;
}

describe('class list sync interval', () => {
    test('defaults to six hours, can be turned off, and never runs more often than every 15 minutes', () => {
        const logger = { warn: jest.fn() };
        expect(DEFAULT_INTERVAL_MINUTES).toBe(360);
        expect(autoSyncIntervalMs({}, logger)).toBe(6 * HOUR);
        expect(autoSyncIntervalMs({ LMS_ROSTER_AUTO_SYNC_INTERVAL_MINUTES: '0' }, logger)).toBe(0);
        expect(autoSyncIntervalMs({ LMS_ROSTER_AUTO_SYNC_INTERVAL_MINUTES: '60' }, logger)).toBe(HOUR);
        expect(autoSyncIntervalMs({ LMS_ROSTER_AUTO_SYNC_INTERVAL_MINUTES: '1' }, logger)).toBe(15 * 60 * 1000);
        expect(logger.warn).not.toHaveBeenCalled();
        expect(autoSyncIntervalMs({ LMS_ROSTER_AUTO_SYNC_INTERVAL_MINUTES: 'hourly' }, logger)).toBe(6 * HOUR);
        expect(logger.warn).toHaveBeenCalled();
    });

    test('does not start without Canvas, or with the interval set to 0', () => {
        const logger = { log: jest.fn(), warn: jest.fn() };
        expect(startClassListScheduler({ db: memoryDb({}), integration: { canvas: null }, logger })).toBeNull();
        expect(startClassListScheduler({
            db: memoryDb({}),
            integration: { canvas: fakeCanvas() },
            env: { LMS_ROSTER_AUTO_SYNC_INTERVAL_MINUTES: '0' },
            logger
        })).toBeNull();

        const scheduler = startClassListScheduler({ db: memoryDb({}), integration: { canvas: fakeCanvas() }, env: {}, logger });
        expect(scheduler).not.toBeNull();
        scheduler.stop();
    });
});

describe('whose Canvas connection a sync uses', () => {
    test('the instructor who linked the class list first, then the other instructors', () => {
        expect(connectionCandidates(classListCourse(), { enabledBy: 'inst-2' })).toEqual(['inst-2', 'inst-1']);
    });

    test('never someone who no longer teaches the BiocBot course', () => {
        expect(connectionCandidates(classListCourse(), { enabledBy: 'former-inst' })).toEqual(['inst-1', 'inst-2']);
    });

    test('opens a client through the same Canvas middleware the routes use', async () => {
        expect(await connectAs(fakeCanvas(['inst-1']), 'inst-1')).toMatchObject({ userId: 'inst-1', client: { owner: 'inst-1' } });
        expect(await connectAs(fakeCanvas([]), 'inst-1')).toBeNull();
    });
});

describe('the scheduled sweep', () => {
    test('syncs only courses whose class list is on, active, and due', async () => {
        const fresh = { lastAttemptAt: new Date(NOW.getTime() - HOUR) };
        const db = memoryDb({
            courses: [
                classListCourse({ courseId: 'DUE' }),
                classListCourse({ courseId: 'NEVER-SYNCED', canvasEnrollment: { enabled: true, externalCourseId: '11', enabledBy: 'inst-1' } }),
                classListCourse({ courseId: 'RECENT', canvasEnrollment: { enabled: true, externalCourseId: '12', enabledBy: 'inst-1', syncStatus: fresh } }),
                classListCourse({ courseId: 'OFF', canvasEnrollment: { enabled: false, externalCourseId: '13' } }),
                classListCourse({ courseId: 'INACTIVE', status: 'inactive' }),
                { courseId: 'CODE-ONLY', status: 'active', instructorId: 'inst-1' }
            ]
        });
        const runSync = jest.fn(async () => ({ addedCount: 1 }));

        const results = await run(db, { runSync });

        expect(results.map((result) => [result.courseId, result.outcome])).toEqual([
            ['DUE', 'synced'],
            ['NEVER-SYNCED', 'synced']
        ]);
        expect(runSync).toHaveBeenCalledTimes(2);
        expect(await syncStatusOf(db, 'DUE')).toMatchObject({
            lastAttemptAt: NOW, lastSuccessAt: NOW, lastTrigger: 'schedule', lastError: null
        });
        // Untouched courses stay exactly as they were.
        expect(await db.collection('courses').findOne({ courseId: 'CODE-ONLY' }))
            .toEqual({ courseId: 'CODE-ONLY', status: 'active', instructorId: 'inst-1' });
        expect((await syncStatusOf(db, 'RECENT')).lastAttemptAt).toEqual(fresh.lastAttemptAt);
    });

    test('a course already claimed in this sweep is not synced twice', async () => {
        const db = memoryDb({ courses: [classListCourse()] });
        const runSync = jest.fn(async () => ({ addedCount: 0 }));

        await run(db, { runSync });
        await run(db, { runSync });

        expect(runSync).toHaveBeenCalledTimes(1);
    });

    test('syncs with the linking instructor, or a co-instructor when the linker is not connected', async () => {
        const db = memoryDb({ courses: [classListCourse()] });
        const runSync = jest.fn(async () => ({ addedCount: 0 }));

        await run(db, { runSync, canvas: fakeCanvas(['inst-2']) });

        expect(runSync).toHaveBeenCalledWith(expect.objectContaining({
            client: { owner: 'inst-2' },
            syncedBy: 'inst-2',
            enrollment: expect.objectContaining({ externalCourseId: '10' })
        }));
    });

    test('records why when no instructor has a working Canvas connection', async () => {
        const db = memoryDb({ courses: [classListCourse()] });
        const runSync = jest.fn();

        const [result] = await run(db, { runSync, canvas: fakeCanvas([]) });

        expect(result).toMatchObject({ outcome: 'failed', code: 'CANVAS_NOT_CONNECTED' });
        expect(runSync).not.toHaveBeenCalled();
        const status = await syncStatusOf(db);
        expect(status.lastError).toMatchObject({ code: 'CANVAS_NOT_CONNECTED' });
        // The attempt counts, so the course waits a full interval before retrying.
        expect(status.lastAttemptAt).toEqual(NOW);
    });

    test('records the Canvas error a failed sync hit, and a later success clears it', async () => {
        const db = memoryDb({ courses: [classListCourse()] });
        const failing = jest.fn(async () => {
            throw Object.assign(new Error('Canvas API returned 403'), { statusCode: 403 });
        });

        await run(db, { runSync: failing });
        expect((await syncStatusOf(db)).lastError).toMatchObject({ code: 'CANVAS_FORBIDDEN' });

        await runDueClassListSyncs({
            db,
            integration: { canvas: fakeCanvas() },
            intervalMs: INTERVAL,
            now: new Date(NOW.getTime() + 7 * HOUR),
            runSync: jest.fn(async () => ({ addedCount: 0 }))
        });
        expect((await syncStatusOf(db)).lastError).toBeNull();
    });

    test('leaves a course alone while a sync started by hand is still running', async () => {
        const db = memoryDb({ courses: [classListCourse()] });
        const busy = jest.fn(async () => {
            throw Object.assign(new Error('busy'), { code: 'ROSTER_SYNC_IN_PROGRESS' });
        });

        const [result] = await run(db, { runSync: busy });

        expect(result.outcome).toBe('skipped');
        expect((await syncStatusOf(db)).lastError).toBeNull();
    });
});
