/**
 * Preview Session Service
 *
 * Backs the "View as Student" feature: an instructor, TA, or system admin can
 * open the student UI in a second tab and interact with it as a sandboxed
 * student without disturbing their own instructor session.
 *
 * Two independent signals must both be present for a request to be treated as
 * a preview:
 *
 *   1. A *grant* stored on the shared express session, created when the user
 *      deliberately starts a preview. It is pinned to the granting user and to
 *      a single course.
 *   2. A *marker* on the individual request (the X-Preview-Session header, or
 *      ?preview=1 on a top-level page navigation).
 *
 * The grant alone is not enough, because express-session is shared across every
 * tab in the browser: if the grant alone flipped the effective role, the
 * instructor's other tabs would silently become student tabs. The marker alone
 * is not enough either, because a real student could trivially send the header.
 * Requiring both keeps the preview confined to the tab that opted into it, and
 * keeps it unavailable to anyone who was never granted it.
 */

const PREVIEW_USER_PREFIX = '__preview__';
const PREVIEW_ID_SEPARATOR = '::';
const PREVIEW_HEADER = 'x-preview-session';

// Roles permitted to open a preview at all. System admins qualify via their
// effective instructor role (see services/authorization.js).
const PREVIEW_CAPABLE_ROLES = ['instructor', 'ta'];

/**
 * Build the namespaced user id used for all data written during a preview.
 *
 * The prefix is what keeps sandbox data out of real course data: no genuine
 * userId can collide with it, so roster joins, enrollment maps, and per-student
 * lookups never surface a preview record by accident.
 *
 * @param {string} ownerUserId - The real user opening the preview
 * @param {string} courseId - Course being previewed
 * @returns {string} Namespaced preview user id
 */
function buildPreviewUserId(ownerUserId, courseId) {
    return `${PREVIEW_USER_PREFIX}${ownerUserId}${PREVIEW_ID_SEPARATOR}${courseId}`;
}

/**
 * Check whether a user id belongs to a preview session
 * @param {string} userId - User id to test
 * @returns {boolean} True if this is a preview user id
 */
function isPreviewUserId(userId) {
    return typeof userId === 'string' && userId.startsWith(PREVIEW_USER_PREFIX);
}

/**
 * Split a preview user id back into its owner and course
 * @param {string} userId - Preview user id
 * @returns {{ownerUserId: string, courseId: string}|null} Parts, or null if not a preview id
 */
function parsePreviewUserId(userId) {
    if (!isPreviewUserId(userId)) {
        return null;
    }

    const body = userId.slice(PREVIEW_USER_PREFIX.length);
    const separatorIndex = body.indexOf(PREVIEW_ID_SEPARATOR);

    if (separatorIndex <= 0) {
        return null;
    }

    return {
        ownerUserId: body.slice(0, separatorIndex),
        courseId: body.slice(separatorIndex + PREVIEW_ID_SEPARATOR.length)
    };
}

/**
 * Mongo condition excluding preview-owned records from a query.
 *
 * Course-scoped reads (analytics, rosters, exports) must never surface sandbox
 * data: an instructor's own test chatter showing up as a student in their
 * dashboard is both confusing and, for anyone reading the numbers, wrong.
 * Reads that already pin an explicit user id do not need this.
 *
 * @param {string} [field] - Field holding the user id ('studentId' or 'userId')
 * @returns {Object} Filter fragment to spread into a query
 */
function excludePreviewFilter(field = 'studentId') {
    return {
        [field]: { $not: new RegExp(`^${PREVIEW_USER_PREFIX}`) }
    };
}

/**
 * Drop preview user ids out of an already-fetched list.
 * For call sites that read ids first and filter in memory.
 *
 * @param {Array<string>} userIds - Candidate user ids
 * @returns {Array<string>} Ids with preview entries removed
 */
function withoutPreviewIds(userIds) {
    if (!Array.isArray(userIds)) {
        return [];
    }

    return userIds.filter(id => !isPreviewUserId(id));
}

/**
 * Check whether a user is allowed to open a preview session
 * @param {Object} user - Authenticated user
 * @returns {boolean} True if the user may preview
 */
function canPreview(user) {
    if (!user) {
        return false;
    }

    if (user.permissions && user.permissions.systemAdmin === true) {
        return true;
    }

    return PREVIEW_CAPABLE_ROLES.includes(user.role);
}

/**
 * Create the grant stored on the session when a preview starts
 * @param {Object} user - The real user opening the preview
 * @param {string} courseId - Course to preview
 * @returns {Object} Grant object
 */
function createGrant(user, courseId) {
    return {
        ownerUserId: user.userId,
        ownerRole: user.role,
        courseId,
        previewUserId: buildPreviewUserId(user.userId, courseId),
        startedAt: new Date().toISOString()
    };
}

/**
 * Read the preview grant off a request's session
 * @param {Object} req - Express request
 * @returns {Object|null} Grant, or null when none is stored
 */
function getGrant(req) {
    return (req && req.session && req.session.preview) || null;
}

/**
 * Check whether an individual request opted into preview mode.
 *
 * API calls carry a header (installed by the client fetch patch). Top-level
 * page loads cannot set headers, so the entry navigation uses ?preview=1 —
 * after which the client stores the flag per-tab and headers take over.
 *
 * @param {Object} req - Express request
 * @returns {boolean} True if the request is marked as preview
 */
function isPreviewMarked(req) {
    if (!req) {
        return false;
    }

    const header = req.headers && req.headers[PREVIEW_HEADER];
    if (header === '1' || header === 'true') {
        return true;
    }

    const queryFlag = req.query && req.query.preview;
    return queryFlag === '1' || queryFlag === 'true';
}

/**
 * Decide whether a request should run as a preview student.
 *
 * Deliberately requires the marker *and* a grant that belongs to the
 * authenticated user — see the module comment for why either alone is unsafe.
 *
 * @param {Object} req - Express request
 * @param {Object} user - The real authenticated user
 * @returns {Object|null} The active grant, or null when this is a normal request
 */
function resolveGrantForRequest(req, user) {
    if (!user || !isPreviewMarked(req)) {
        return null;
    }

    const grant = getGrant(req);
    if (!grant || !grant.courseId || !grant.ownerUserId) {
        return null;
    }

    // A grant issued to somebody else must never apply, even on a marked
    // request — sessions can outlive a logout/login on shared machines.
    if (grant.ownerUserId !== user.userId) {
        return null;
    }

    if (!canPreview(user)) {
        return null;
    }

    return grant;
}

/**
 * Build the student-shaped user object that downstream student code sees.
 *
 * Everything that identifies the instructor is replaced: the role is a plain
 * student, admin permissions are dropped, and the user id is the namespaced
 * preview id so every write lands in the sandbox.
 *
 * The sandbox's persisted record is layered in underneath when available, so
 * state that lives on the user document travels with the preview. That matters
 * for more than tidiness: studentOnboardingComplete is what gates the welcome
 * tour, and a synthesized object missing it silently skips the whole first-run
 * experience.
 *
 * @param {Object} realUser - The authenticated instructor/TA/admin
 * @param {Object} grant - Active preview grant
 * @param {Object} [persisted] - The sandbox's stored user record, if it exists
 * @returns {Object} Student-shaped preview user
 */
function buildPreviewUser(realUser, grant, persisted = null) {
    return {
        // Anything the stored record carries and this object does not — welcome
        // flow state, struggle state — comes through here.
        ...(persisted || {}),
        userId: grant.previewUserId || buildPreviewUserId(realUser.userId, grant.courseId),
        username: 'preview-student',
        displayName: 'Preview Student',
        email: null,
        role: 'student',
        baseRole: realUser.role,
        isActive: true,
        isPreview: true,
        previewOwnerId: realUser.userId,
        previewCourseId: grant.courseId,
        preferences: {
            ...((persisted && persisted.preferences) || {}),
            courseId: grant.courseId
        },
        // Preview must never carry elevated permissions: the whole point is to
        // see the least-privileged view of the course.
        permissions: {
            systemAdmin: false
        }
    };
}

/**
 * Build the persisted `users` document backing a preview sandbox.
 *
 * The sandbox needs a real user record because parts of the student experience
 * hang off the user document rather than a side collection — struggle state is
 * the clearest example. Without it those reads 404 and the student pages fail
 * to load. The record is marked isPreview so listings can exclude it.
 *
 * @param {Object} realUser - The authenticated instructor/TA/admin
 * @param {Object} grant - Active preview grant
 * @returns {Object} User document fields for the sandbox
 */
function buildPreviewUserDocument(realUser, grant) {
    return {
        userId: grant.previewUserId,
        username: 'preview-student',
        displayName: 'Preview Student',
        email: null,
        role: 'student',
        isActive: true,
        isPreview: true,
        previewOwnerId: realUser.userId,
        previewCourseId: grant.courseId,
        authProvider: 'preview',
        preferences: {
            courseId: grant.courseId
        },
        permissions: {
            systemAdmin: false
        },
        struggleState: { topics: [] },
        // Explicitly false, not absent: the student welcome flow (calibration
        // plus the blurred guided tour) only runs when this is strictly false,
        // and a user missing the field is treated as already onboarded. A first
        // preview should show what a brand-new student sees.
        studentOnboardingComplete: false
    };
}

/**
 * Whether the request is currently running as a preview student
 * @param {Object} req - Express request
 * @returns {boolean} True when preview is active on this request
 */
function isPreviewRequest(req) {
    return !!(req && req.preview && req.preview.active);
}

module.exports = {
    PREVIEW_USER_PREFIX,
    PREVIEW_HEADER,
    buildPreviewUserId,
    isPreviewUserId,
    parsePreviewUserId,
    canPreview,
    excludePreviewFilter,
    withoutPreviewIds,
    createGrant,
    getGrant,
    isPreviewMarked,
    resolveGrantForRequest,
    buildPreviewUser,
    buildPreviewUserDocument,
    isPreviewRequest
};
