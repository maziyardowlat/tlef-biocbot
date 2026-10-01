/**
 * One Canvas roster sync, shared by the Student Hub's "Sync now", linking a
 * class list, and the scheduled background sync.
 *
 * A sync reads the linked Canvas course's roster, pairs it with BiocBot
 * accounts (lmsRosterMatch), and records the result on the course. When the
 * course takes its class list from Canvas (lmsRosterEnrollment), the sync also
 * enrolls roster students who already have a BiocBot account and saves the
 * roster so the rest are enrolled when they first sign in. Courses without a
 * class list get the grade-matching sync they always had.
 */

const crypto = require('crypto');

const { getGradeSource } = require('./lmsGradeImport');
const { confirmLeftCanvasCourse, syncCourseRoster } = require('./lmsRosterMatch');
const {
    canvasEnrollmentOf,
    isBlockedOutsideCanvas,
    listPendingRosterEntries,
    replaceRosterEntries
} = require('./lmsRosterEnrollment');

const DEFAULT_PRUNE_MIN_INTEGRATION_COVERAGE = 0.8;
// Long enough for a large roster plus the per-student enrollment checks; a
// sync that dies without releasing the lock frees the course after this.
const SYNC_LOCK_MS = 5 * 60 * 1000;

function pruneCoverageThreshold(env = process.env) {
    const configured = Number(env.LMS_ROSTER_PRUNE_MIN_INTEGRATION_COVERAGE);
    return Number.isFinite(configured) && configured >= 0 && configured <= 1
        ? configured
        : DEFAULT_PRUNE_MIN_INTEGRATION_COVERAGE;
}

function effectiveRosterSource(course = {}) {
    if (course.rosterSource) return course.rosterSource;
    // Legacy academic-linked courses predate rosterSource. Treating them as
    // manual would let Canvas claim them before the migration field is written.
    if (Array.isArray(course.academicSync?.sectionIds) && course.academicSync.sectionIds.length) {
        return 'academicSync';
    }
    return 'manual';
}

function buildPruneSafety(coverage = {}, provider = 'canvas', env = process.env) {
    const total = Number(coverage.total) || 0;
    const integrationId = Number(coverage.integrationId) || 0;
    const integrationIdRatio = total ? integrationId / total : 0;
    const threshold = pruneCoverageThreshold(env);
    const allowed = provider === 'canvas' && total > 0 && integrationIdRatio >= threshold;

    return {
        allowed,
        threshold,
        integrationIdRatio,
        reason: allowed
            ? null
            : (total === 0
                ? 'empty-roster'
                : (provider !== 'canvas' ? 'provider-not-supported' : 'insufficient-integration-id-coverage'))
    };
}

async function claimCanvasRosterOwnership(db, course) {
    const result = await db.collection('courses').updateOne(
        { courseId: course.courseId },
        { $set: { rosterSource: 'canvas', updatedAt: new Date() } }
    );
    return result.matchedCount > 0;
}

/**
 * Whether a BiocBot student might have left the linked Canvas course, judged
 * from this sync alone. Only students this Canvas course put on the roster
 * qualify — never someone who joined with a course code, came from Academic
 * Sync, or was never matched — and only when their Canvas user id is gone
 * from the roster the sync read. That read is filtered to the reader's
 * sections, so a student who passes still has to be confirmed with Canvas
 * (confirmLeftCanvasCourse) before being offered for soft-drop.
 */
function isDropCandidate(enrollment, { externalCourseId, rosterExternalUserIds }) {
    if (!enrollment || enrollment.source !== 'canvas' || enrollment.enrolled === false) return false;
    if (String(enrollment.externalCourseId || '') !== String(externalCourseId)) return false;
    return Boolean(enrollment.externalUserId) && !rosterExternalUserIds.has(String(enrollment.externalUserId));
}

async function persistCanvasSync({ db, course, externalCourseId, report, confirmLeft = async () => new Set(), syncedBy }) {
    const mappings = await db.collection('lms_identity_mappings').find({
        courseId: course.courseId,
        provider: 'canvas',
        externalCourseId: String(externalCourseId)
    }).toArray();
    const freshCourse = await db.collection('courses').findOne({ courseId: course.courseId });
    const existingEnrollment = freshCourse?.studentEnrollment || {};
    const now = new Date();
    const syncToken = crypto.randomUUID();
    const prune = buildPruneSafety(report.coverage, 'canvas');
    // Anyone the roster read returned is still on the course, whether or not
    // BiocBot could match them.
    const rosterExternalUserIds = new Set([
        ...mappings.map((mapping) => String(mapping.externalUserId)),
        ...(report.unmatchedLmsStudents || []).map((student) => String(student.externalUserId))
    ]);
    const enrollmentOf = (student) => existingEnrollment[String(student.localUserId)];
    const unmatchedBiocBotStudents = (report.unmatchedBiocBotStudents || []).map((student) => ({
        ...student,
        accessDisabled: enrollmentOf(student)?.enrolled === false
    }));
    const absent = unmatchedBiocBotStudents.filter((student) => isDropCandidate(
        enrollmentOf(student),
        { externalCourseId, rosterExternalUserIds }
    ));
    const confirmedLeft = absent.length
        ? await confirmLeft(absent.map((student) => String(enrollmentOf(student).externalUserId)))
        : new Set();
    const dropCandidates = absent.filter((student) => confirmedLeft.has(String(enrollmentOf(student).externalUserId)));
    const set = {
        rosterSource: 'canvas',
        lmsRosterSync: {
            provider: 'canvas',
            externalCourseId: String(externalCourseId),
            lastSyncAt: now,
            syncedBy: String(syncedBy),
            syncToken,
            coverage: report.coverage,
            prune,
            dropCandidateIds: dropCandidates.map((student) => String(student.localUserId))
        },
        updatedAt: now
    };

    let addedCount = 0;
    let blockedCount = 0;
    for (const mapping of mappings) {
        const localUserId = String(mapping.localUserId);
        const existing = existingEnrollment[localUserId];
        // A student an instructor turned off by hand stays off, however often
        // Canvas lists them; only the instructor can turn them back on.
        if (isBlockedOutsideCanvas(existing)) {
            blockedCount += 1;
            continue;
        }
        if (!existing) addedCount += 1;
        set[`studentEnrollment.${localUserId}`] = {
            ...(existing || { joinedAt: now }),
            enrolled: true,
            source: 'canvas',
            externalUserId: String(mapping.externalUserId),
            externalCourseId: String(externalCourseId),
            syncedAt: now,
            updatedAt: now
        };
        delete set[`studentEnrollment.${localUserId}`].droppedAt;
    }

    await db.collection('courses').updateOne(
        { courseId: course.courseId, rosterSource: 'canvas' },
        { $set: set }
    );

    return { syncToken, prune, dropCandidates, unmatchedBiocBotStudents, addedCount, blockedCount };
}

/**
 * The Canvas course a sync reads: the class-list course when the class list is
 * on, otherwise the course linked for grades (or inherited from a file import).
 */
function rosterExternalCourseId(course, enrollment = canvasEnrollmentOf(course)) {
    return enrollment?.externalCourseId || getGradeSource(course, 'canvas')?.courseId || null;
}

class RosterSyncInProgressError extends Error {
    constructor() {
        super('A Canvas roster sync is already running for this course. Try again in a minute.');
        this.code = 'ROSTER_SYNC_IN_PROGRESS';
    }
}

/**
 * Holds the course for one sync at a time. Two overlapping syncs could each
 * delete the other's saved roster rows as stale; the lock expires on its own
 * if a sync dies without releasing it.
 * @returns {Promise<boolean|null>} true when held, null when the course is gone
 */
async function acquireSyncLock(db, courseId, now) {
    const result = await db.collection('courses').updateOne(
        {
            courseId,
            $or: [
                { rosterSyncLockedUntil: { $exists: false } },
                { rosterSyncLockedUntil: null },
                { rosterSyncLockedUntil: { $lt: now } }
            ]
        },
        { $set: { rosterSyncLockedUntil: new Date(now.getTime() + SYNC_LOCK_MS) } }
    );
    if (result.matchedCount) return true;
    const exists = await db.collection('courses').findOne({ courseId });
    if (!exists) return null;
    throw new RosterSyncInProgressError();
}

async function releaseSyncLock(db, courseId) {
    await db.collection('courses').updateOne({ courseId }, { $unset: { rosterSyncLockedUntil: '' } });
}

/**
 * Runs one sync. The caller has already authenticated `client` and checked
 * that the course is linked.
 * @param {Object} options
 * @param {Object|null} [options.enrollment] - Class-list settings
 *   (canvasEnrollmentOf); null for a grade-matching sync. Linking passes the
 *   settings it is about to save.
 * @returns {Promise<Object|null>} The browser-safe report, or null when the
 *   course no longer exists
 */
async function runCanvasRosterSync({
    db,
    course,
    client,
    syncedBy,
    enrollment = canvasEnrollmentOf(course),
    externalCourseId = rosterExternalCourseId(course, enrollment),
    matchRoster = syncCourseRoster,
    confirmLeft = confirmLeftCanvasCourse
}) {
    if (!externalCourseId) {
        throw new Error('Link this BiocBot course to a Canvas course before syncing its roster');
    }

    const startedAt = new Date();
    const held = await acquireSyncLock(db, course.courseId, startedAt);
    if (!held) return null;

    try {
        if (!await claimCanvasRosterOwnership(db, course)) return null;

        const report = await matchRoster({
            db,
            course: { ...course, rosterSource: 'canvas' },
            provider: 'canvas',
            client,
            externalCourseId,
            matchedBy: syncedBy,
            enrollFromRoster: Boolean(enrollment)
        });
        const safety = await persistCanvasSync({
            db,
            course,
            externalCourseId,
            report,
            confirmLeft: (externalUserIds) => confirmLeft(client, externalCourseId, externalUserIds),
            syncedBy
        });
        if (enrollment) {
            await replaceRosterEntries(db, {
                courseId: course.courseId,
                externalCourseId,
                entries: report.rosterEntries || [],
                syncedAt: startedAt
            });
        }

        // rosterEntries carries every student's email and PUID match; it is
        // for saving, not for the browser.
        const { rosterEntries, ...publicReport } = report;
        return {
            ...publicReport,
            rosterSource: 'canvas',
            classListEnabled: Boolean(enrollment),
            ...safety
        };
    } finally {
        await releaseSyncLock(db, course.courseId);
    }
}

/**
 * Records how the latest class-list sync went, for the Student Hub and for the
 * scheduler's next-run decision. A course whose class list is off is left
 * alone.
 * @param {Object} options
 * @param {'manual'|'link'|'schedule'} options.trigger
 * @param {{code?: string, message: string}|null} [options.error]
 */
async function recordClassListSyncStatus(db, courseId, { trigger, error = null, at = new Date() }) {
    const set = {
        'canvasEnrollment.syncStatus.lastAttemptAt': at,
        'canvasEnrollment.syncStatus.lastTrigger': trigger,
        'canvasEnrollment.syncStatus.lastError': error
            ? { code: error.code || 'SYNC_FAILED', message: error.message, at }
            : null
    };
    if (!error) set['canvasEnrollment.syncStatus.lastSuccessAt'] = at;
    await db.collection('courses').updateOne(
        { courseId, 'canvasEnrollment.enabled': true },
        { $set: set }
    );
}

/** What the Student Hub's class-list panel shows. */
async function describeCanvasEnrollment(db, course, { canvasConfigured = false } = {}) {
    const enrollment = canvasEnrollmentOf(course);
    const linked = getGradeSource(course, 'canvas');
    const sync = course?.lmsRosterSync?.provider === 'canvas' ? course.lmsRosterSync : null;
    const pending = enrollment
        ? await listPendingRosterEntries(db, course.courseId, enrollment.externalCourseId)
        : [];

    return {
        canvasConfigured,
        enabled: Boolean(enrollment),
        canvasCourse: enrollment
            ? { id: enrollment.externalCourseId, name: enrollment.name, code: enrollment.code }
            : null,
        // A course linked for files or grades is only ever a suggestion; the
        // class list starts when the instructor confirms it.
        suggestedCanvasCourse: !enrollment && linked
            ? { id: linked.courseId, name: linked.name, code: linked.code, inherited: linked.inherited }
            : null,
        allowCodeJoin: enrollment ? enrollment.allowCodeJoin : true,
        enabledBy: enrollment?.enabledBy || null,
        enabledAt: enrollment?.enabledAt || null,
        syncStatus: enrollment?.syncStatus || null,
        lastSyncAt: sync?.lastSyncAt || null,
        dropCandidateCount: Array.isArray(sync?.dropCandidateIds) ? sync.dropCandidateIds.length : 0,
        pendingCount: pending.length,
        pending
    };
}

module.exports = {
    DEFAULT_PRUNE_MIN_INTEGRATION_COVERAGE,
    RosterSyncInProgressError,
    buildPruneSafety,
    claimCanvasRosterOwnership,
    describeCanvasEnrollment,
    effectiveRosterSource,
    isDropCandidate,
    persistCanvasSync,
    pruneCoverageThreshold,
    recordClassListSyncStatus,
    rosterExternalCourseId,
    runCanvasRosterSync
};
