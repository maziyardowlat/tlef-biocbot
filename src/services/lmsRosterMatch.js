/**
 * Matches an LMS course roster against BiocBot accounts.
 *
 * Grade snapshots are stored against a BiocBot `localUserId`, so before any
 * grades can be imported the two systems have to agree on who is who. The only
 * identifier both sides reliably hold is the institutional email address, so
 * that is the primary key here; username/login and SIS id are fallbacks for
 * deployments where the email is hidden or differs. Display names are never
 * used to match automatically — "J. Smith" vs "Jane Smith" vs a second Jane
 * Smith is exactly the ambiguity that silently attaches one student's grades to
 * another. Anyone who cannot be matched is reported back so the instructor can
 * fix it at the source instead of guessing.
 */

const { normalizeEmail } = require('./authorization');

const SUPPORTED_PROVIDERS = Object.freeze(['canvas', 'moodle']);

function normalizeKey(value) {
    const normalized = String(value ?? '').trim().toLowerCase();
    return normalized || null;
}

function emailLocalPart(email) {
    const normalized = normalizeEmail(email);
    return normalized?.includes('@') ? normalized.split('@')[0] : null;
}

/**
 * Matching rules, strongest evidence first. Each rule names the key to read
 * from the LMS roster entry and the key to read from the BiocBot account; a
 * rule only fires when both sides produce the same non-empty value.
 */
const MATCH_STRATEGIES = Object.freeze([
    {
        id: 'sis',
        label: 'student number',
        // Populated on BiocBot accounts created by the academic-API roster sync.
        lmsKey: (entry) => normalizeKey(entry.sisId),
        localKeys: (user) => [normalizeKey(user.academicStudentId), normalizeKey(user.puid)]
    },
    {
        id: 'email',
        label: 'email address',
        lmsKey: (entry) => normalizeEmail(entry.email),
        localKeys: (user) => [normalizeEmail(user.email)]
    },
    {
        id: 'username',
        label: 'username',
        lmsKey: (entry) => normalizeKey(entry.username),
        localKeys: (user) => [normalizeKey(user.username)]
    },
    {
        id: 'email-local-part',
        label: 'email name before the @',
        // Covers deployments where BiocBot stores the CWL as the username and
        // the LMS only exposes the full institutional email.
        lmsKey: (entry) => emailLocalPart(entry.email),
        localKeys: (user) => [normalizeKey(user.username), emailLocalPart(user.email)]
    }
]);

/** Canvas exposes the roster as course users filtered to student enrollments. */
async function fetchCanvasRoster(client, canvasCourseId) {
    const users = await client.get(`/courses/${encodeURIComponent(String(canvasCourseId))}/users`, {
        enrollment_type: ['student'],
        enrollment_state: ['active', 'invited'],
        include: ['email'],
        per_page: 100
    });
    return (users || []).map((user) => ({
        externalUserId: String(user.id),
        name: user.name || user.sortable_name || `Canvas user ${user.id}`,
        email: user.email || user.login_id || '',
        username: user.login_id || '',
        sisId: user.sis_user_id || ''
    }));
}

/**
 * Moodle returns every enrolled user with their roles, so students are filtered
 * here rather than by the web-service call. `email` is only populated when the
 * token's account can see user identity fields (`moodle/site:viewuseridentity`).
 */
async function fetchMoodleRoster(client, moodleCourseId) {
    const users = await client.call('core_enrol_get_enrolled_users', {
        courseid: Number(moodleCourseId) || moodleCourseId
    });
    return (users || [])
        .filter((user) => {
            const roles = user.roles || [];
            return roles.length === 0 || roles.some((role) => role.shortname === 'student');
        })
        .map((user) => ({
            externalUserId: String(user.id),
            name: user.fullname || `Moodle user ${user.id}`,
            email: user.email || '',
            username: user.username || '',
            sisId: user.idnumber || ''
        }));
}

async function fetchRoster(provider, client, externalCourseId) {
    if (provider === 'canvas') return fetchCanvasRoster(client, externalCourseId);
    if (provider === 'moodle') return fetchMoodleRoster(client, externalCourseId);
    throw new Error(`Unsupported LMS provider: ${provider}`);
}

/**
 * The BiocBot accounts eligible to be matched: everyone whose active course is
 * this one, plus anyone carried on the course's enrollment overrides. This
 * mirrors the set the Student Hub lists, so the two views cannot disagree about
 * who exists.
 */
async function listLocalCandidates(db, course) {
    const enrollmentIds = Object.keys(course.studentEnrollment || {});
    const users = await db.collection('users').find({
        isActive: { $ne: false },
        isPreview: { $ne: true },
        $or: [
            { role: 'student', 'preferences.courseId': course.courseId },
            ...(enrollmentIds.length ? [{ userId: { $in: enrollmentIds } }] : [])
        ]
    }).project({
        _id: 0,
        userId: 1,
        username: 1,
        email: 1,
        displayName: 1,
        puid: 1,
        academicStudentId: 1
    }).toArray();

    return users.map((user) => ({
        localUserId: String(user.userId),
        username: user.username || '',
        email: user.email || '',
        puid: user.puid || '',
        academicStudentId: user.academicStudentId || '',
        displayName: user.displayName || user.username || String(user.userId)
    }));
}

/** Builds one lookup table per matching strategy over the BiocBot accounts. */
function indexLocalCandidates(localUsers) {
    const indexes = new Map(MATCH_STRATEGIES.map((strategy) => [strategy.id, new Map()]));
    const ambiguous = new Map(MATCH_STRATEGIES.map((strategy) => [strategy.id, new Set()]));

    for (const strategy of MATCH_STRATEGIES) {
        const index = indexes.get(strategy.id);
        for (const user of localUsers) {
            for (const key of strategy.localKeys(user)) {
                if (!key) continue;
                // A key held by two accounts proves nothing about either, so it
                // is dropped rather than attaching grades to whichever account
                // happened to be read first.
                if (index.has(key) && index.get(key).localUserId !== user.localUserId) {
                    ambiguous.get(strategy.id).add(key);
                }
                index.set(key, user);
            }
        }
    }

    for (const [strategyId, keys] of ambiguous) {
        for (const key of keys) indexes.get(strategyId).delete(key);
    }
    return indexes;
}

function matchRosterEntry(entry, indexes) {
    for (const strategy of MATCH_STRATEGIES) {
        const key = strategy.lmsKey(entry);
        const localUser = key ? indexes.get(strategy.id).get(key) : null;
        if (localUser) return { localUser, matchedBy: strategy.id };
    }
    return null;
}

/**
 * Reconciles the LMS roster with BiocBot accounts and rewrites this course's
 * identity mappings to the result. Returns a report of who matched, how, and
 * who did not — the unmatched lists are the actionable part for an instructor.
 */
async function matchCourseRoster({ db, course, provider, roster, matchedBy }) {
    if (!SUPPORTED_PROVIDERS.includes(provider)) {
        throw new Error(`Unsupported LMS provider: ${provider}`);
    }

    const externalCourseId = String(roster.externalCourseId);
    const localUsers = await listLocalCandidates(db, course);
    const indexes = indexLocalCandidates(localUsers);
    const now = new Date();

    const matched = [];
    const unmatchedLmsStudents = [];
    const claimedLocalUserIds = new Set();

    for (const entry of roster.entries) {
        const match = matchRosterEntry(entry, indexes);
        // The mapping collection holds one row per local user, so a second LMS
        // row claiming an already-matched account is a data problem in the LMS
        // (duplicate account) and is surfaced rather than silently overwritten.
        if (!match || claimedLocalUserIds.has(match.localUser.localUserId)) {
            unmatchedLmsStudents.push({
                externalUserId: entry.externalUserId,
                name: entry.name,
                email: entry.email,
                reason: match ? 'duplicate-biocbot-account' : 'no-biocbot-account'
            });
            continue;
        }
        claimedLocalUserIds.add(match.localUser.localUserId);
        matched.push({ entry, ...match });
    }

    if (matched.length) {
        await db.collection('lms_identity_mappings').bulkWrite(matched.map(({ entry, localUser, matchedBy: strategy }) => ({
            updateOne: {
                filter: {
                    courseId: course.courseId,
                    provider,
                    externalCourseId,
                    externalUserId: entry.externalUserId
                },
                update: {
                    $set: {
                        localUserId: localUser.localUserId,
                        externalLabel: entry.name,
                        externalEmail: entry.email,
                        matchedBy: strategy,
                        mappedAt: now,
                        mappedBy: String(matchedBy)
                    }
                },
                upsert: true
            }
        })));
    }

    // Anyone who dropped the course in the LMS should stop appearing here, and
    // stale rows would also collide with the unique local-user index above.
    const keptExternalIds = matched.map(({ entry }) => entry.externalUserId);
    await db.collection('lms_identity_mappings').deleteMany({
        courseId: course.courseId,
        provider,
        externalCourseId,
        externalUserId: { $nin: keptExternalIds }
    });

    return {
        provider,
        externalCourseId,
        matchedAt: now,
        rosterSize: roster.entries.length,
        matchedCount: matched.length,
        matchedBy: Object.fromEntries(MATCH_STRATEGIES.map((strategy) => [
            strategy.id,
            matched.filter((match) => match.matchedBy === strategy.id).length
        ])),
        unmatchedLmsStudents,
        unmatchedBiocBotStudents: localUsers
            .filter((user) => !claimedLocalUserIds.has(user.localUserId))
            .map((user) => ({
                localUserId: user.localUserId,
                displayName: user.displayName,
                email: user.email
            }))
    };
}

/** Fetches the roster and reconciles it in one step. */
async function syncCourseRoster({ db, course, provider, client, externalCourseId, matchedBy }) {
    const entries = await fetchRoster(provider, client, externalCourseId);
    if (entries.length && !entries.some((entry) => entry.email || entry.username || entry.sisId)) {
        console.warn(
            `⚠️ ${provider} roster for course ${externalCourseId} exposed no email, username, or student number — nothing can be matched.`
        );
    }
    return matchCourseRoster({
        db,
        course,
        provider,
        roster: { externalCourseId, entries },
        matchedBy
    });
}

module.exports = {
    MATCH_STRATEGIES,
    SUPPORTED_PROVIDERS,
    fetchCanvasRoster,
    fetchMoodleRoster,
    fetchRoster,
    indexLocalCandidates,
    listLocalCandidates,
    matchCourseRoster,
    matchRosterEntry,
    syncCourseRoster
};
