/**
 * Unit tests for the "View as Student" preview session service.
 *
 * The bulk of these cover the allow/deny matrix, because the preview is a
 * deliberate role downgrade wired into normal auth: the marker and the grant
 * are each meaningless alone, and getting that wrong either leaks the preview
 * into an instructor's real tabs or lets a student claim one.
 */

const previewSession = require('../../../src/services/previewSession');

const instructor = {
    userId: 'inst-1',
    role: 'instructor',
    permissions: { systemAdmin: false }
};

const ta = { userId: 'ta-1', role: 'ta', permissions: { systemAdmin: false } };
const student = { userId: 'stu-1', role: 'student', permissions: { systemAdmin: false } };
const admin = { userId: 'admin-1', role: 'student', permissions: { systemAdmin: true } };

/**
 * Build a request-like object for the resolver.
 * @param {Object} options - Marker and session configuration
 * @returns {Object} Request stand-in
 */
function makeRequest({ header, query = {}, grant } = {}) {
    return {
        headers: header ? { 'x-preview-session': header } : {},
        query,
        session: grant ? { preview: grant } : {}
    };
}

describe('previewSession id namespacing', () => {
    test('builds and parses a preview user id', () => {
        const id = previewSession.buildPreviewUserId('inst-1', 'BIOC-302');

        expect(id).toBe('__preview__inst-1::BIOC-302');
        expect(previewSession.isPreviewUserId(id)).toBe(true);
        expect(previewSession.parsePreviewUserId(id)).toEqual({
            ownerUserId: 'inst-1',
            courseId: 'BIOC-302'
        });
    });

    test('ordinary user ids are never mistaken for preview ids', () => {
        expect(previewSession.isPreviewUserId('user_123')).toBe(false);
        expect(previewSession.isPreviewUserId('')).toBe(false);
        expect(previewSession.isPreviewUserId(null)).toBe(false);
        expect(previewSession.parsePreviewUserId('user_123')).toBeNull();
    });

    test('course ids containing the separator round-trip intact', () => {
        // Course ids are generated, but a "::" inside one must not silently
        // truncate the course a preview is scoped to.
        const id = previewSession.buildPreviewUserId('inst-1', 'BIOC::302');

        expect(previewSession.parsePreviewUserId(id)).toEqual({
            ownerUserId: 'inst-1',
            courseId: 'BIOC::302'
        });
    });
});

describe('previewSession.canPreview', () => {
    test('allows instructors, TAs, and system admins', () => {
        expect(previewSession.canPreview(instructor)).toBe(true);
        expect(previewSession.canPreview(ta)).toBe(true);
        expect(previewSession.canPreview(admin)).toBe(true);
    });

    test('denies students and anonymous callers', () => {
        expect(previewSession.canPreview(student)).toBe(false);
        expect(previewSession.canPreview(null)).toBe(false);
    });
});

describe('previewSession.resolveGrantForRequest', () => {
    const grant = previewSession.createGrant(instructor, 'BIOC-302');

    test('resolves when a marked request carries the owner\'s grant', () => {
        const req = makeRequest({ header: '1', grant });

        expect(previewSession.resolveGrantForRequest(req, instructor)).toBe(grant);
    });

    test('accepts the query marker, since a page load cannot set headers', () => {
        const req = makeRequest({ query: { preview: '1' }, grant });

        expect(previewSession.resolveGrantForRequest(req, instructor)).toBe(grant);
    });

    test('refuses a grant with no marker, so other tabs stay instructor tabs', () => {
        const req = makeRequest({ grant });

        expect(previewSession.resolveGrantForRequest(req, instructor)).toBeNull();
    });

    test('refuses a marker with no grant, so the header alone proves nothing', () => {
        const req = makeRequest({ header: '1' });

        expect(previewSession.resolveGrantForRequest(req, instructor)).toBeNull();
    });

    test('refuses a student sending the header at a grant they do not own', () => {
        const req = makeRequest({ header: '1', grant });

        expect(previewSession.resolveGrantForRequest(req, student)).toBeNull();
    });

    test('refuses a grant issued to a different user on the same session', () => {
        const otherInstructor = { ...instructor, userId: 'inst-2' };
        const req = makeRequest({ header: '1', grant });

        expect(previewSession.resolveGrantForRequest(req, otherInstructor)).toBeNull();
    });

    test('refuses a grant whose holder has since lost preview rights', () => {
        const demoted = { ...instructor, role: 'student' };
        const req = makeRequest({ header: '1', grant });

        expect(previewSession.resolveGrantForRequest(req, demoted)).toBeNull();
    });
});

describe('previewSession.buildPreviewUser', () => {
    const grant = previewSession.createGrant(admin, 'BIOC-302');
    const previewUser = previewSession.buildPreviewUser(admin, grant);

    test('presents as a plain student', () => {
        expect(previewUser.role).toBe('student');
        expect(previewUser.userId).toBe(grant.previewUserId);
        expect(previewUser.preferences.courseId).toBe('BIOC-302');
    });

    test('drops system admin rights, so preview is the least-privileged view', () => {
        expect(previewUser.permissions.systemAdmin).toBe(false);
    });

    test('keeps a trail back to the real user for the control endpoints', () => {
        expect(previewUser.previewOwnerId).toBe('admin-1');
        expect(previewUser.isPreview).toBe(true);
    });

    test('carries the welcome-flow flag through from the stored record', () => {
        // The guided tour gates on studentOnboardingComplete === false, read via
        // /api/auth/me. A synthesized user missing the field reads as "already
        // onboarded" and silently skips the whole first-run experience.
        const merged = previewSession.buildPreviewUser(admin, grant, {
            studentOnboardingComplete: false,
            struggleState: { topics: ['glycolysis'] }
        });

        expect(merged.studentOnboardingComplete).toBe(false);
        expect(merged.struggleState).toEqual({ topics: ['glycolysis'] });
    });

    test('a stored record cannot smuggle in a role or admin rights', () => {
        const merged = previewSession.buildPreviewUser(admin, grant, {
            role: 'instructor',
            permissions: { systemAdmin: true },
            userId: 'someone-else'
        });

        expect(merged.role).toBe('student');
        expect(merged.permissions.systemAdmin).toBe(false);
        expect(merged.userId).toBe(grant.previewUserId);
    });
});

describe('previewSession.buildPreviewUserDocument', () => {
    const grant = previewSession.createGrant(instructor, 'BIOC-302');
    const document = previewSession.buildPreviewUserDocument(instructor, grant);

    test('starts un-onboarded so a first preview shows the welcome flow', () => {
        // The welcome flow checks for strictly false; an absent field means
        // "already onboarded", which would silently skip it.
        expect(document.studentOnboardingComplete).toBe(false);
    });

    test('is marked so user listings can exclude it', () => {
        expect(document.isPreview).toBe(true);
        expect(document.role).toBe('student');
        expect(document.isActive).toBe(true);
    });
});

describe('previewSession.excludePreviewFilter', () => {
    test('builds a filter that rejects preview ids and keeps real ones', () => {
        const filter = previewSession.excludePreviewFilter('studentId');
        const pattern = filter.studentId.$not;

        expect(pattern.test('__preview__inst-1::BIOC-302')).toBe(true);
        expect(pattern.test('user_123')).toBe(false);
    });

    test('defaults to studentId and honours an explicit field', () => {
        expect(previewSession.excludePreviewFilter()).toHaveProperty('studentId');
        expect(previewSession.excludePreviewFilter('userId')).toHaveProperty('userId');
    });
});

describe('previewSession.isPreviewRequest', () => {
    test('reports only on requests the middleware converted', () => {
        expect(previewSession.isPreviewRequest({ preview: { active: true } })).toBe(true);
        expect(previewSession.isPreviewRequest({ preview: { active: false } })).toBe(false);
        expect(previewSession.isPreviewRequest({})).toBe(false);
        expect(previewSession.isPreviewRequest(null)).toBe(false);
    });
});
