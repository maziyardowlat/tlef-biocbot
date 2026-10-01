/**
 * Keeps Canvas class lists current without anyone clicking anything.
 *
 * Every few minutes the scheduler looks for courses whose class list is on and
 * whose last sync attempt is older than the interval
 * (LMS_ROSTER_AUTO_SYNC_INTERVAL_MINUTES, default six hours; 0 turns it off).
 * Each due course is claimed with a conditional update before it is synced, so
 * when several app servers run the scheduler only one of them syncs a course.
 *
 * A sync runs as an instructor of the course, with the Canvas connection they
 * saved: the instructor who linked the class list first, then the course's
 * other instructors. When none of them has a working connection, the course
 * records why, and the Student Hub asks an instructor to connect again. Drops
 * are never applied here — they wait for an instructor in the Student Hub.
 */

const { canvasEnrollmentOf } = require('./lmsRosterEnrollment');
const { recordClassListSyncStatus, runCanvasRosterSync } = require('./canvasRosterSync');
const { lmsErrorResponse } = require('./lmsErrors');

const DEFAULT_INTERVAL_MINUTES = 360;
const MIN_INTERVAL_MINUTES = 15;
const TICK_MS = 5 * 60 * 1000;
// Let startup finish (and a restart loop calm down) before the first sweep.
const FIRST_TICK_DELAY_MS = 60 * 1000;

/**
 * @returns {number} Milliseconds between syncs of one course; 0 means off
 */
function autoSyncIntervalMs(env = process.env, logger = console) {
    const raw = env.LMS_ROSTER_AUTO_SYNC_INTERVAL_MINUTES;
    if (raw === undefined || String(raw).trim() === '') return DEFAULT_INTERVAL_MINUTES * 60 * 1000;

    const minutes = Number(raw);
    if (minutes === 0) return 0;
    if (!Number.isFinite(minutes) || minutes < 0) {
        logger.warn(`⚠️ LMS_ROSTER_AUTO_SYNC_INTERVAL_MINUTES="${raw}" is not a number of minutes; using ${DEFAULT_INTERVAL_MINUTES}`);
        return DEFAULT_INTERVAL_MINUTES * 60 * 1000;
    }
    return Math.max(minutes, MIN_INTERVAL_MINUTES) * 60 * 1000;
}

/**
 * The instructors whose saved Canvas connections may run this course's sync,
 * in the order to try them. Someone no longer teaching the BiocBot course is
 * never used, even if they linked the class list.
 */
function connectionCandidates(course, enrollment) {
    const instructors = new Set(
        [course.instructorId, ...(Array.isArray(course.instructors) ? course.instructors : [])]
            .filter(Boolean)
            .map(String)
    );
    return [...new Set([enrollment.enabledBy, ...instructors].filter(Boolean).map(String))]
        .filter((userId) => instructors.has(userId));
}

/**
 * Opens a Canvas client with an instructor's saved connection, through the
 * same middleware the routes use, so refresh and scope checks are identical.
 * @returns {Promise<{userId: string, req: Object, client: Object}|null>} null
 *   when the instructor has no working connection
 */
async function connectAs(canvasIntegration, userId) {
    const req = { user: { userId: String(userId) }, originalUrl: '/api/lms/roster/class-list/auto-sync' };
    const res = {
        statusCode: 200,
        status(code) { this.statusCode = code; return this; },
        json() { return this; },
        redirect() { return this; }
    };
    let passed = false;
    let failure = null;
    await canvasIntegration.api.requireAuth(canvasIntegration.config)(req, res, (error) => {
        if (error) failure = error;
        else passed = true;
    });
    if (failure) throw failure;
    return passed && req.canvasApi ? { userId: String(userId), req, client: req.canvasApi } : null;
}

function dueFilter(dueBefore) {
    return {
        'canvasEnrollment.enabled': true,
        status: { $nin: ['inactive', 'deleted'] },
        $or: [
            { 'canvasEnrollment.syncStatus.lastAttemptAt': { $exists: false } },
            { 'canvasEnrollment.syncStatus.lastAttemptAt': null },
            { 'canvasEnrollment.syncStatus.lastAttemptAt': { $lt: dueBefore } }
        ]
    };
}

const NOT_CONNECTED = Object.freeze({
    code: 'CANVAS_NOT_CONNECTED',
    message: 'Automatic class list syncs stopped: no instructor of this course has a working Canvas connection. '
        + 'Connect Canvas from the Student Hub to start them again.'
});

async function syncCourse({ db, canvasIntegration, courseId, now, runSync, connect }) {
    const course = await db.collection('courses').findOne({ courseId });
    const enrollment = canvasEnrollmentOf(course);
    if (!enrollment) return { courseId, outcome: 'skipped' };

    let connection = null;
    for (const userId of connectionCandidates(course, enrollment)) {
        try {
            connection = await connect(canvasIntegration, userId);
        } catch (error) {
            console.warn(`⚠️ Could not load the Canvas connection of ${userId} for ${courseId}: ${error.message}`);
        }
        if (connection) break;
    }
    if (!connection) {
        await recordClassListSyncStatus(db, courseId, { trigger: 'schedule', error: NOT_CONNECTED, at: now });
        return { courseId, outcome: 'failed', code: NOT_CONNECTED.code };
    }

    try {
        const report = await runSync({
            db,
            course,
            client: connection.client,
            syncedBy: connection.userId,
            enrollment
        });
        if (!report) return { courseId, outcome: 'skipped' };
        await recordClassListSyncStatus(db, courseId, { trigger: 'schedule', at: now });
        return { courseId, outcome: 'synced', addedCount: report.addedCount || 0 };
    } catch (error) {
        // A sync someone started by hand is already doing this course's work.
        if (error.code === 'ROSTER_SYNC_IN_PROGRESS') return { courseId, outcome: 'skipped' };

        const { body } = await lmsErrorResponse(error, {
            provider: 'canvas',
            config: canvasIntegration.config,
            req: connection.req,
            fallbackMessage: 'The automatic Canvas class list sync failed'
        });
        await recordClassListSyncStatus(db, courseId, {
            trigger: 'schedule',
            error: { code: body.code || 'SYNC_FAILED', message: body.message || error.message },
            at: now
        });
        return { courseId, outcome: 'failed', code: body.code || 'SYNC_FAILED' };
    }
}

/**
 * Syncs every course whose class list is due. Courses are claimed one at a
 * time, right before their sync, so a long sweep never holds courses another
 * server could be syncing.
 * @returns {Promise<Array<{courseId: string, outcome: 'synced'|'failed'|'skipped'}>>}
 */
async function runDueClassListSyncs({
    db,
    integration,
    intervalMs,
    now = new Date(),
    runSync = runCanvasRosterSync,
    connect = connectAs
}) {
    if (!db || !integration?.canvas || !intervalMs) return [];

    const dueBefore = new Date(now.getTime() - intervalMs);
    const due = await db.collection('courses').find(dueFilter(dueBefore)).project({ _id: 0, courseId: 1 }).toArray();
    const results = [];

    for (const { courseId } of due) {
        const claim = await db.collection('courses').updateOne(
            { courseId, ...dueFilter(dueBefore) },
            {
                $set: {
                    'canvasEnrollment.syncStatus.lastAttemptAt': now,
                    'canvasEnrollment.syncStatus.lastTrigger': 'schedule'
                }
            }
        );
        if (!claim.matchedCount) continue;

        try {
            results.push(await syncCourse({ db, canvasIntegration: integration.canvas, courseId, now, runSync, connect }));
        } catch (error) {
            console.error(`❌ Automatic class list sync for ${courseId} failed:`, error.message);
            results.push({ courseId, outcome: 'failed', code: 'SYNC_FAILED' });
        }
    }
    return results;
}

/**
 * Starts the background sweep. Does nothing when Canvas is not configured or
 * the interval is 0. The timers never keep the process alive on their own.
 * @returns {{stop: Function, tick: Function}|null}
 */
function startClassListScheduler({ db, integration, env = process.env, logger = console }) {
    if (!integration?.canvas) return null;
    const intervalMs = autoSyncIntervalMs(env, logger);
    if (!intervalMs) {
        logger.log('ℹ️ Automatic Canvas class list syncs are off (LMS_ROSTER_AUTO_SYNC_INTERVAL_MINUTES=0)');
        return null;
    }

    let running = false;
    const tick = async () => {
        if (running) return;
        running = true;
        try {
            const results = await runDueClassListSyncs({ db, integration, intervalMs });
            const synced = results.filter((result) => result.outcome === 'synced');
            const failed = results.filter((result) => result.outcome === 'failed');
            if (synced.length || failed.length) {
                const added = synced.reduce((total, result) => total + result.addedCount, 0);
                logger.log(`🔄 Canvas class lists: ${synced.length} synced (${added} students added), ${failed.length} failed`);
            }
        } catch (error) {
            logger.error('❌ Canvas class list sweep failed:', error.message);
        } finally {
            running = false;
        }
    };

    const interval = setInterval(tick, Math.min(TICK_MS, intervalMs));
    const first = setTimeout(tick, FIRST_TICK_DELAY_MS);
    if (typeof interval.unref === 'function') interval.unref();
    if (typeof first.unref === 'function') first.unref();
    logger.log(`✅ Canvas class lists sync automatically every ${Math.round(intervalMs / 60000)} minutes`);

    return {
        tick,
        stop() {
            clearInterval(interval);
            clearTimeout(first);
        }
    };
}

module.exports = {
    DEFAULT_INTERVAL_MINUTES,
    autoSyncIntervalMs,
    connectAs,
    connectionCandidates,
    runDueClassListSyncs,
    startClassListScheduler
};
