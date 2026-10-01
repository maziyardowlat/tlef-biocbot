/**
 * Canvas class-list enrollment: students on a linked Canvas course's roster get
 * into the BiocBot course without a course code.
 *
 * It is opt-in per course. An instructor explicitly chooses "use this Canvas
 * course for my class list", which writes `course.canvasEnrollment`; a course
 * without that field keeps the course-code flow exactly as before. Linking a
 * Canvas course only to import files or grades never turns this on.
 *
 * Each sync saves the roster in `lms_roster_entries`, one row per Canvas
 * student. A row whose student already has a BiocBot account is enrolled during
 * the sync. The rest wait for the student's first sign-in, when
 * enrollStudentFromSavedRosters pairs them with the new account using the same
 * rules the sync uses — so no account is created for a student who never signs
 * in, and nobody is enrolled on weaker evidence at sign-in than at sync time.
 */

const { normalizeEmail } = require('./authorization');
const { indexLocalCandidates, matchRosterEntries } = require('./lmsRosterMatch');

const ROSTER_ENTRIES_COLLECTION = 'lms_roster_entries';
const PROVIDER = 'canvas';

function normalizeKey(value) {
    const normalized = String(value ?? '').trim().toLowerCase();
    return normalized || null;
}

/**
 * The course's Canvas class-list settings, or null when the instructor has not
 * turned it on. Everything else in this module treats null as "leave this
 * course alone".
 */
function canvasEnrollmentOf(course) {
    const config = course?.canvasEnrollment;
    if (!config || config.enabled !== true || !config.externalCourseId) return null;
    return {
        enabled: true,
        externalCourseId: String(config.externalCourseId),
        name: config.name || '',
        code: config.code || '',
        // Missing means on: the code stays a fallback until the instructor
        // explicitly turns it off.
        allowCodeJoin: config.allowCodeJoin !== false,
        enabledBy: config.enabledBy ? String(config.enabledBy) : null,
        enabledAt: config.enabledAt || null,
        syncStatus: config.syncStatus || null
    };
}

/**
 * Whether a Canvas sync may decide this student's access. A block an
 * instructor set by hand (or another roster source applied) stands until the
 * instructor lifts it; only a block Canvas itself applied lifts when Canvas
 * lists the student again.
 */
function isBlockedOutsideCanvas(enrollment) {
    return Boolean(enrollment) && enrollment.enrolled === false && enrollment.source !== PROVIDER;
}

/** Variants worth querying for a PUID; Canvas and CWL can disagree on case. */
function puidVariants(value) {
    const text = String(value ?? '').trim();
    if (!text) return [];
    return [...new Set([text, text.toUpperCase(), text.toLowerCase()])];
}

/**
 * Replaces the saved roster for a course with the one a sync just read.
 * Rows the read no longer has, and rows from a previously linked Canvas
 * course, are removed.
 * @param {Object} db
 * @param {Object} options
 * @param {string} options.courseId - BiocBot course id
 * @param {string} options.externalCourseId - Canvas course id the roster came from
 * @param {Array<{externalUserId: string, name?: string, email?: string, integrationId?: string, localUserId?: string|null}>} options.entries
 * @param {Date} options.syncedAt
 */
async function replaceRosterEntries(db, { courseId, externalCourseId, entries, syncedAt }) {
    const collection = db.collection(ROSTER_ENTRIES_COLLECTION);
    const canvasCourseId = String(externalCourseId);

    if (entries.length) {
        await collection.bulkWrite(entries.map((entry) => ({
            updateOne: {
                filter: {
                    courseId,
                    provider: PROVIDER,
                    externalCourseId: canvasCourseId,
                    externalUserId: String(entry.externalUserId)
                },
                update: {
                    $set: {
                        name: entry.name || '',
                        email: entry.email || null,
                        emailKey: normalizeEmail(entry.email),
                        integrationIdKey: normalizeKey(entry.integrationId),
                        // Always written, null included: sign-in looks rows up
                        // by `localUserId: null`.
                        localUserId: entry.localUserId ? String(entry.localUserId) : null,
                        syncedAt
                    }
                },
                upsert: true
            }
        })), { ordered: false });
    }

    await collection.deleteMany({
        courseId,
        provider: PROVIDER,
        $or: [
            { externalCourseId: { $ne: canvasCourseId } },
            { syncedAt: { $lt: syncedAt } }
        ]
    });
}

async function clearRosterEntries(db, courseId) {
    await db.collection(ROSTER_ENTRIES_COLLECTION).deleteMany({ courseId, provider: PROVIDER });
}

/** Canvas students on the saved roster who have not signed in to BiocBot yet. */
async function listPendingRosterEntries(db, courseId, externalCourseId) {
    const rows = await db.collection(ROSTER_ENTRIES_COLLECTION).find({
        courseId,
        provider: PROVIDER,
        externalCourseId: String(externalCourseId),
        localUserId: null
    }).toArray();
    return rows
        .map((row) => ({ name: row.name || '', email: row.email || null }))
        .sort((a, b) => a.name.localeCompare(b.name));
}

/**
 * The BiocBot student accounts that hold the same PUID or email as this
 * student, the student included. Matching against all of them, not just the
 * student, keeps a key two accounts share ambiguous here exactly as it is in a
 * full sync.
 */
async function accountsSharingKeys(db, user) {
    const clauses = [];
    const variants = puidVariants(user.puid);
    if (variants.length) clauses.push({ puid: { $in: variants } });
    const email = normalizeEmail(user.email);
    if (email) clauses.push({ email });
    if (!clauses.length) return [];

    const users = await db.collection('users').find({
        role: 'student',
        isActive: { $ne: false },
        isPreview: { $ne: true },
        $or: clauses
    }).project({ _id: 0, userId: 1, username: 1, email: 1, displayName: 1, puid: 1 }).toArray();

    return users.map((account) => ({
        localUserId: String(account.userId),
        username: account.username || '',
        email: account.email || '',
        puid: account.puid || '',
        displayName: account.displayName || account.username || String(account.userId)
    }));
}

/**
 * Enrolls a signing-in student in every course whose saved Canvas roster lists
 * them and that has not heard of them yet.
 *
 * Never changes an existing enrollment record — not a block, not a code join —
 * and does nothing for courses whose class list is off, inactive, or no longer
 * owned by Canvas. Safe to call on every page load: with nothing pending it is
 * one indexed query.
 * @returns {Promise<string[]>} The BiocBot course ids the student was added to
 */
async function enrollStudentFromSavedRosters(db, user, { now = new Date() } = {}) {
    if (!db || !user || user.role !== 'student' || !user.userId) return [];

    const userId = String(user.userId);
    const puidKey = normalizeKey(user.puid);
    const emailKey = normalizeEmail(user.email);
    // Rows carrying a different PUID belong to someone else whatever their
    // email says, so only email-only rows are worth a look by email when the
    // student has a PUID — the same veto the sync applies.
    const keyClauses = puidKey
        ? [{ integrationIdKey: puidKey }, ...(emailKey ? [{ emailKey, integrationIdKey: null }] : [])]
        : (emailKey ? [{ emailKey }] : []);
    if (!keyClauses.length) return [];

    const rosters = db.collection(ROSTER_ENTRIES_COLLECTION);
    const pending = await rosters.find({ provider: PROVIDER, localUserId: null, $or: keyClauses }).toArray();
    if (!pending.length) return [];

    const enrolledIn = [];
    let accounts = null;

    for (const courseId of [...new Set(pending.map((row) => row.courseId))]) {
        const course = await db.collection('courses').findOne({ courseId });
        const enrollment = canvasEnrollmentOf(course);
        if (!enrollment || course.rosterSource !== PROVIDER) continue;
        if (course.status === 'inactive' || course.status === 'deleted') continue;
        if (course.studentEnrollment && course.studentEnrollment[userId]) continue;

        accounts = accounts || await accountsSharingKeys(db, user);
        if (!accounts.some((account) => account.localUserId === userId)) return enrolledIn;

        const roster = await rosters.find({
            courseId,
            provider: PROVIDER,
            externalCourseId: enrollment.externalCourseId
        }).toArray();
        const results = matchRosterEntries(
            roster.map((row) => ({ integrationId: row.integrationIdKey, email: row.email })),
            indexLocalCandidates(accounts)
        );
        const index = results.findIndex((result) => result?.localUser?.localUserId === userId);
        const row = index === -1 ? null : roster[index];
        if (!row || row.localUserId) continue;

        const update = await db.collection('courses').updateOne(
            {
                courseId,
                rosterSource: PROVIDER,
                'canvasEnrollment.enabled': true,
                [`studentEnrollment.${userId}`]: { $exists: false }
            },
            {
                $set: {
                    [`studentEnrollment.${userId}`]: {
                        enrolled: true,
                        source: PROVIDER,
                        externalUserId: String(row.externalUserId),
                        externalCourseId: String(row.externalCourseId),
                        joinedAt: now,
                        syncedAt: now,
                        updatedAt: now
                    },
                    updatedAt: now
                }
            }
        );
        if (!update.matchedCount) continue;

        await rosters.updateOne(
            {
                courseId,
                provider: PROVIDER,
                externalCourseId: String(row.externalCourseId),
                externalUserId: String(row.externalUserId)
            },
            { $set: { localUserId: userId } }
        );
        enrolledIn.push(courseId);
    }

    return enrolledIn;
}

module.exports = {
    ROSTER_ENTRIES_COLLECTION,
    canvasEnrollmentOf,
    clearRosterEntries,
    enrollStudentFromSavedRosters,
    isBlockedOutsideCanvas,
    listPendingRosterEntries,
    replaceRosterEntries
};
