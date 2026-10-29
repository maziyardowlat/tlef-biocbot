/**
 * Matches an LMS course roster against BiocBot accounts.
 *
 * Grade snapshots are stored against a BiocBot `localUserId`, so before any
 * grades can be imported the two systems have to agree on who is who. Only two
 * keys are trusted, in this order: Canvas's integration_id (the CWL PUID at
 * UBC), then the email address. Weaker keys — usernames, the part of an email
 * before the @, display names — are never used: each can pair a real student
 * with somebody else's account and file their grades there. Anyone who cannot
 * be matched is reported back so the instructor can fix it at the source
 * instead of guessing.
 *
 * A Canvas roster sync also enrolls (provisionAccounts): a roster student is
 * then looked for by PUID across all of BiocBot, not just this course, and a
 * student who has never signed in gets a placeholder account to be enrolled
 * on. Email stays a within-course key only — across every account it is not
 * strong enough to decide whose account a student gets.
 */

const { normalizeEmail } = require('./authorization');
const { buildPlaceholderStudent } = require('../models/User');

const SUPPORTED_PROVIDERS = Object.freeze(['canvas', 'moodle']);

function normalizeKey(value) {
    const normalized = String(value ?? '').trim().toLowerCase();
    return normalized || null;
}

/**
 * Matching rules, strongest evidence first. Each rule names the key to read
 * from the LMS roster entry and the key to read from the BiocBot account; a
 * rule only fires when both sides produce the same non-empty value and the
 * rule's `conflicts` check (if any) does not veto the pair.
 */
const MATCH_STRATEGIES = Object.freeze([
    {
        id: 'integration',
        label: 'integration id',
        // At UBC Canvas integration_id is the PUID supplied by CWL.
        lmsKey: (entry) => normalizeKey(entry.integrationId),
        localKeys: (user) => [normalizeKey(user.puid)]
    },
    {
        id: 'email',
        label: 'email address',
        lmsKey: (entry) => normalizeEmail(entry.email),
        localKeys: (user) => [normalizeEmail(user.email)],
        // Two different PUIDs are two different people, whatever the email
        // says, and an account whose PUID is on another roster row belongs to
        // that row. The email fallback is only for rows where a PUID is missing.
        conflicts: (entry, user, rosterPuids) => {
            const integrationId = normalizeKey(entry.integrationId);
            const puid = normalizeKey(user.puid);
            if (!puid) return false;
            return integrationId ? integrationId !== puid : rosterPuids.has(puid);
        }
    }
]);

function loadRosterToolkit() {
    try {
        return require('@ubc/ubc-genai-toolkit-lms-integration');
    } catch (error) {
        const wrapped = new Error('LMS roster matching requires @ubc/ubc-genai-toolkit-lms-integration 1.0.4 or newer');
        wrapped.code = 'LMS_TOOLKIT_MISSING';
        wrapped.cause = error;
        throw wrapped;
    }
}

function externalUserId(entry) {
    return String(entry.id ?? entry.externalUserId);
}

function integrationIdOf(entry) {
    return typeof entry.integrationId === 'string' ? entry.integrationId.trim() : '';
}

/**
 * The spellings a stored PUID could have for one roster integration_id. The
 * matcher compares case-insensitively, but the users query is exact, so it
 * asks for each casing the two systems might have written.
 */
function puidSpellings(integrationId) {
    return integrationId
        ? [...new Set([integrationId, integrationId.toUpperCase(), integrationId.toLowerCase()])]
        : [];
}

const CANDIDATE_PROJECTION = Object.freeze({
    _id: 0,
    userId: 1,
    username: 1,
    email: 1,
    displayName: 1,
    puid: 1
});

function toCandidate(user) {
    return {
        localUserId: String(user.userId),
        username: user.username || '',
        email: user.email || '',
        puid: user.puid || '',
        displayName: user.displayName || user.username || String(user.userId)
    };
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
    }).project(CANDIDATE_PROJECTION).toArray();

    return users.map(toCandidate);
}

/**
 * Student accounts anywhere in BiocBot whose PUID is on this roster: someone
 * who signed in for another course, or never got as far as joining this one,
 * is still the same person. Instructor, TA, and deactivated accounts are left
 * out; enrolling one of those as a student is not the sync's call to make.
 */
async function listRosterStudentsByPuid(db, entries) {
    const puids = [...new Set(entries.flatMap((entry) => puidSpellings(integrationIdOf(entry))))];
    if (!puids.length) return [];
    const users = await db.collection('users').find({
        role: 'student',
        isActive: { $ne: false },
        isPreview: { $ne: true },
        puid: { $in: puids }
    }).project(CANDIDATE_PROJECTION).toArray();

    return users.map(toCandidate);
}

/**
 * Creates a placeholder account for each roster student BiocBot has never
 * seen, so the sync can enroll them before their first sign-in.
 *
 * A row is skipped, with a reason, when it has no PUID (nothing for CWL login
 * to find the account by), or when BiocBot already holds its PUID or email on
 * an account the matcher could not use. A second account carrying either
 * would split the student in two at their next sign-in, since CWL login looks
 * accounts up by both.
 * @returns {Promise<Array<{ localUser: Object } | { reason: string }>>}
 *   One result per entry, in order.
 */
async function provisionRosterStudents(db, entries, courseId, now) {
    const users = db.collection('users');
    const results = entries.map((entry) => (integrationIdOf(entry) ? null : { reason: 'missing-puid' }));
    const pending = entries
        .map((entry, index) => ({ entry, index, puid: integrationIdOf(entry), email: normalizeEmail(entry.email) }))
        .filter(({ index }) => !results[index]);
    if (!pending.length) return results;

    const puids = [...new Set(pending.flatMap(({ puid }) => puidSpellings(puid)))];
    const emails = [...new Set(pending.map(({ email }) => email).filter(Boolean))];
    const taken = await users.find({
        $or: [
            { puid: { $in: puids } },
            ...(emails.length ? [{ email: { $in: emails } }] : [])
        ]
    }).project({ _id: 0, puid: 1, email: 1 }).toArray();
    const takenPuids = new Set(taken.map((user) => normalizeKey(user.puid)).filter(Boolean));
    const takenEmails = new Set(taken.map((user) => normalizeEmail(user.email)).filter(Boolean));

    const created = [];
    const claimedPuids = new Set();
    for (const { entry, index, puid, email } of pending) {
        const key = normalizeKey(puid);
        if (claimedPuids.has(key)) {
            results[index] = { reason: 'duplicate-biocbot-account' };
        } else if (takenPuids.has(key)) {
            results[index] = { reason: 'puid-on-other-account' };
        } else if (email && takenEmails.has(email)) {
            results[index] = { reason: 'email-on-other-account' };
        } else {
            claimedPuids.add(key);
            created.push({
                index,
                user: buildPlaceholderStudent({
                    // What CWL login would set it to, so the first sign-in
                    // leaves it alone.
                    username: puid,
                    puid,
                    email,
                    displayName: entry.name,
                    courseId
                }, now)
            });
        }
    }
    if (!created.length) return results;

    // Upserted on the PUID: if the student's first sign-in made their account
    // since the check above, that account is left alone rather than joined by
    // a second one, and the next sync matches it.
    await users.bulkWrite(created.map(({ user }) => ({
        updateOne: {
            filter: { puid: user.puid },
            update: { $setOnInsert: user },
            upsert: true
        }
    })), { ordered: false });
    const inserted = new Set((await users.find({
        userId: { $in: created.map(({ user }) => user.userId) }
    }).project({ _id: 0, userId: 1 }).toArray()).map((user) => String(user.userId)));

    for (const { index, user } of created) {
        results[index] = inserted.has(user.userId)
            ? { localUser: toCandidate(user) }
            : { reason: 'puid-on-other-account' };
    }
    return results;
}

/**
 * Builds one lookup table per matching strategy over the BiocBot accounts.
 * `puidOnlyUsers` (accounts from outside the course) join the PUID table only:
 * in the email table they could make a course student's email look shared and
 * cost them a match they had before.
 */
function indexLocalCandidates(localUsers, puidOnlyUsers = []) {
    const indexes = new Map(MATCH_STRATEGIES.map((strategy) => [strategy.id, new Map()]));
    const ambiguous = new Map(MATCH_STRATEGIES.map((strategy) => [strategy.id, new Set()]));

    for (const strategy of MATCH_STRATEGIES) {
        const index = indexes.get(strategy.id);
        const users = strategy.id === 'integration' ? [...localUsers, ...puidOnlyUsers] : localUsers;
        for (const user of users) {
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

/**
 * Pairs roster rows with accounts one strategy at a time across the whole
 * roster, so a PUID match anywhere wins over an email match anywhere. Matching
 * row by row instead would let an earlier row take an account by email before
 * the row carrying that account's PUID was reached.
 *
 * The mapping collection holds one row per local user, so a later row that
 * reaches an already-claimed account is a data problem in the LMS (a duplicate
 * account) and is reported rather than silently overwriting the first.
 * @returns {Array<{ localUser: Object, matchedBy: string } | { duplicate: true } | null>}
 *   One result per roster entry, in roster order.
 */
function matchRosterEntries(entries, indexes) {
    const rosterPuids = new Set(entries.map((entry) => normalizeKey(entry.integrationId)).filter(Boolean));
    const results = entries.map(() => null);
    const claimedLocalUserIds = new Set();

    for (const strategy of MATCH_STRATEGIES) {
        entries.forEach((entry, index) => {
            if (results[index]) return;
            const key = strategy.lmsKey(entry);
            const localUser = key ? indexes.get(strategy.id).get(key) : null;
            if (!localUser) return;
            if (claimedLocalUserIds.has(localUser.localUserId)) {
                results[index] = { duplicate: true };
                return;
            }
            if (strategy.conflicts?.(entry, localUser, rosterPuids)) return;
            claimedLocalUserIds.add(localUser.localUserId);
            results[index] = { localUser, matchedBy: strategy.id };
        });
    }
    return results;
}

/**
 * Reconciles the LMS roster with BiocBot accounts and rewrites this course's
 * identity mappings to the result. Returns a report of who matched, how, and
 * who did not — the unmatched lists are the actionable part for an instructor.
 *
 * With `provisionAccounts`, roster students are also matched by PUID outside
 * the course, and those BiocBot has never seen get a placeholder account (see
 * provisionRosterStudents). Only a sync that enrolls who it matches may pass
 * it; a grade-only match would otherwise create accounts with no course.
 */
async function matchCourseRoster({ db, course, provider, roster, matchedBy, provisionAccounts = false }) {
    if (!SUPPORTED_PROVIDERS.includes(provider)) {
        throw new Error(`Unsupported LMS provider: ${provider}`);
    }

    const externalCourseId = String(roster.externalCourseId);
    const localUsers = await listLocalCandidates(db, course);
    const rosterStudents = provisionAccounts ? await listRosterStudentsByPuid(db, roster.entries) : [];
    const indexes = indexLocalCandidates(localUsers, rosterStudents);
    const now = new Date();

    const matched = [];
    const unmatchedLmsStudents = [];
    const createdAccounts = [];
    const claimedLocalUserIds = new Set();
    const unmatchedRow = (entry, reason) => ({
        externalUserId: externalUserId(entry),
        name: entry.name,
        email: entry.email,
        reason
    });

    const matches = matchRosterEntries(roster.entries, indexes);
    const unclaimed = [];
    matches.forEach((match, index) => {
        const entry = roster.entries[index];
        if (match?.localUser) {
            claimedLocalUserIds.add(match.localUser.localUserId);
            matched.push({ entry, ...match });
        } else if (match?.duplicate) {
            unmatchedLmsStudents.push(unmatchedRow(entry, 'duplicate-biocbot-account'));
        } else if (provisionAccounts) {
            unclaimed.push(entry);
        } else {
            unmatchedLmsStudents.push(unmatchedRow(entry, 'no-biocbot-account'));
        }
    });

    const provisioned = unclaimed.length
        ? await provisionRosterStudents(db, unclaimed, course.courseId, now)
        : [];
    provisioned.forEach((outcome, index) => {
        const entry = unclaimed[index];
        if (!outcome.localUser) {
            unmatchedLmsStudents.push(unmatchedRow(entry, outcome.reason));
            return;
        }
        claimedLocalUserIds.add(outcome.localUser.localUserId);
        matched.push({ entry, localUser: outcome.localUser, matchedBy: 'integration' });
        createdAccounts.push({ localUserId: outcome.localUser.localUserId, name: entry.name });
    });

    // Clear every row this sync does not reproduce exactly — students who left
    // the LMS course, and accounts now paired with a different LMS user —
    // before writing. Upserting first would collide with the unique
    // local-user index whenever an account moves to a new LMS user id.
    const mappings = db.collection('lms_identity_mappings');
    const pairs = new Map(matched.map(({ entry, localUser }) => [externalUserId(entry), localUser.localUserId]));
    const existingMappings = await mappings.find({ courseId: course.courseId, provider, externalCourseId }).toArray();
    const staleExternalIds = existingMappings
        .filter((mapping) => pairs.get(String(mapping.externalUserId)) !== String(mapping.localUserId))
        .map((mapping) => String(mapping.externalUserId));
    if (staleExternalIds.length) {
        await mappings.deleteMany({
            courseId: course.courseId,
            provider,
            externalCourseId,
            externalUserId: { $in: staleExternalIds }
        });
    }

    if (matched.length) {
        await mappings.bulkWrite(matched.map(({ entry, localUser, matchedBy: strategy }) => ({
            updateOne: {
                filter: {
                    courseId: course.courseId,
                    provider,
                    externalCourseId,
                    externalUserId: externalUserId(entry)
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
        createdAccounts,
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
async function syncCourseRoster({
    db,
    course,
    provider,
    client,
    externalCourseId,
    matchedBy,
    provisionAccounts = false,
    toolkit: injectedToolkit
}) {
    if (!SUPPORTED_PROVIDERS.includes(provider)) {
        throw new Error(`Unsupported LMS provider: ${provider}`);
    }

    // Injection keeps unit tests deterministic when the optional GitHub
    // Packages dependency is intentionally unavailable in CI. Production
    // callers omit it and use the installed toolkit package.
    const toolkit = injectedToolkit || loadRosterToolkit();
    const entries = await toolkit[provider].getCourseUsers(client, externalCourseId);
    const coverage = toolkit.rosterFieldCoverage(entries);
    if (entries.length && !entries.some((entry) => entry.integrationId || entry.email)) {
        console.warn(
            `⚠️ ${provider} roster for course ${externalCourseId} exposed no integration id or email — nothing can be matched.`
        );
    }
    const report = await matchCourseRoster({
        db,
        course,
        provider,
        roster: { externalCourseId, entries },
        matchedBy,
        provisionAccounts
    });
    return { ...report, coverage };
}

const CANVAS_ENROLLMENT_CHECK_CONCURRENCY = 4;

/**
 * Which of these Canvas users Canvas confirms have no active or invited
 * student enrollment left in the course, in any section.
 *
 * Absence from a roster read proves nothing on its own: Canvas filters roster
 * reads to the reader's sections, so to a teacher limited to one section a
 * student who moved to another section looks exactly like one who left. Asking
 * for one user's enrollments in the course (user_id=...) is answered from all
 * of that user's enrollments without the section filter, for anyone who can
 * read the roster.
 *
 * Fails safe: a user whose lookup errors is never reported as having left.
 * @returns {Promise<Set<string>>}
 */
async function confirmLeftCanvasCourse(client, externalCourseId, externalUserIds) {
    const path = `/courses/${encodeURIComponent(String(externalCourseId))}/enrollments`;
    const pending = [...new Set(externalUserIds.map(String))];
    const left = new Set();

    async function worker() {
        while (pending.length) {
            const userId = pending.shift();
            try {
                const enrollments = await client.getAll(path, {
                    user_id: userId,
                    type: ['StudentEnrollment'],
                    state: ['active', 'invited']
                });
                if (!enrollments.length) left.add(userId);
            } catch (error) {
                console.warn(`⚠️ Could not confirm Canvas enrollment for user ${userId} in course ${externalCourseId}: ${error.message}`);
            }
        }
    }

    await Promise.all(Array.from({ length: CANVAS_ENROLLMENT_CHECK_CONCURRENCY }, worker));
    return left;
}

module.exports = {
    MATCH_STRATEGIES,
    SUPPORTED_PROVIDERS,
    confirmLeftCanvasCourse,
    indexLocalCandidates,
    listLocalCandidates,
    listRosterStudentsByPuid,
    matchCourseRoster,
    matchRosterEntries,
    provisionRosterStudents,
    syncCourseRoster
};
