/**
 * Unit tests for the preview branches of the auth middleware.
 *
 * The preview is a deliberate role downgrade spliced into normal auth, so these
 * tests are mostly about what must NOT happen: an unmarked request keeping its
 * instructor identity, and a marked request from someone without a grant
 * gaining a student one.
 */
const { memoryDb } = require('../helpers/memory-db');
const createAuthMiddleware = require('../../../src/middleware/auth');
const previewSession = require('../../../src/services/previewSession');

const COURSE_ID = 'BIOC-302';

const instructor = {
    userId: 'inst-1',
    role: 'instructor',
    isActive: true,
    permissions: { systemAdmin: false }
};

const student = {
    userId: 'stu-1',
    role: 'student',
    isActive: true,
    permissions: { systemAdmin: false }
};

beforeAll(() => {
    jest.spyOn(console, 'log').mockImplementation(() => {});
    jest.spyOn(console, 'error').mockImplementation(() => {});
});

afterAll(() => {
    jest.restoreAllMocks();
});

/**
 * Build middleware over a seeded database.
 * @returns {Object} Auth middleware bundle
 */
function makeMiddleware() {
    const db = memoryDb({
        users: [instructor, student],
        courses: [{ courseId: COURSE_ID, status: 'active', instructorId: 'inst-1' }],
        previewStates: []
    });

    return { db, middleware: createAuthMiddleware(db) };
}

/**
 * Build a request stand-in.
 * @param {Object} options - User, marker, and grant configuration
 * @returns {Object} Request
 */
function makeRequest({ user, marked = false, grant, path = '/student' } = {}) {
    return {
        user,
        path,
        originalUrl: path,
        headers: marked ? { 'x-preview-session': '1' } : {},
        query: {},
        session: grant ? { userId: user && user.userId, preview: grant } : { userId: user && user.userId },
        body: {}
    };
}

/**
 * Minimal response stand-in recording what the middleware did.
 * @returns {Object} Response
 */
function makeResponse() {
    const res = {
        statusCode: null,
        body: null,
        redirectedTo: null,
        status(code) {
            this.statusCode = code;
            return this;
        },
        json(payload) {
            this.body = payload;
            return this;
        },
        redirect(url) {
            this.redirectedTo = url;
            return this;
        }
    };
    return res;
}

describe('resolvePreview', () => {
    test('swaps in a student identity for a marked request with a valid grant', async () => {
        const { middleware } = makeMiddleware();
        const grant = previewSession.createGrant(instructor, COURSE_ID);
        const req = makeRequest({ user: instructor, marked: true, grant });
        const next = jest.fn();

        await middleware.resolvePreview(req, makeResponse(), next);

        expect(next).toHaveBeenCalled();
        expect(req.preview.active).toBe(true);
        expect(req.user.role).toBe('student');
        expect(req.user.userId).toBe(grant.previewUserId);
        expect(req.realUser.userId).toBe('inst-1');
    });

    test('leaves an unmarked request untouched, so other tabs stay instructor tabs', async () => {
        const { middleware } = makeMiddleware();
        const grant = previewSession.createGrant(instructor, COURSE_ID);
        const req = makeRequest({ user: instructor, marked: false, grant });
        const next = jest.fn();

        await middleware.resolvePreview(req, makeResponse(), next);

        expect(next).toHaveBeenCalled();
        expect(req.preview).toBeUndefined();
        expect(req.user.role).toBe('instructor');
    });

    test('ignores the marker from a student who holds no grant', async () => {
        const { middleware } = makeMiddleware();
        const req = makeRequest({ user: student, marked: true });
        const next = jest.fn();

        await middleware.resolvePreview(req, makeResponse(), next);

        expect(next).toHaveBeenCalled();
        expect(req.preview).toBeUndefined();
        expect(req.user.userId).toBe('stu-1');
    });

    test('ignores a grant belonging to someone else on the same session', async () => {
        const { middleware } = makeMiddleware();
        const grant = previewSession.createGrant(instructor, COURSE_ID);
        const req = makeRequest({ user: student, marked: true, grant });
        const next = jest.fn();

        await middleware.resolvePreview(req, makeResponse(), next);

        expect(req.preview).toBeUndefined();
        expect(req.user.role).toBe('student');
        expect(req.user.userId).toBe('stu-1');
    });
});

describe('requireStudentOrPreview', () => {
    test('lets a real student through', async () => {
        const { middleware } = makeMiddleware();
        const req = makeRequest({ user: student });
        const next = jest.fn();

        await middleware.requireStudentOrPreview(req, makeResponse(), next);

        expect(next).toHaveBeenCalled();
    });

    test('lets a marked previewer through', async () => {
        const { middleware } = makeMiddleware();
        const grant = previewSession.createGrant(instructor, COURSE_ID);
        const req = makeRequest({ user: instructor, marked: true, grant });
        const next = jest.fn();

        // resolvePreview runs first in the real pipeline.
        await middleware.resolvePreview(req, makeResponse(), () => {});
        await middleware.requireStudentOrPreview(req, makeResponse(), next);

        expect(next).toHaveBeenCalled();
    });

    test('redirects an unmarked page load to carry the marker', async () => {
        const { middleware } = makeMiddleware();
        const grant = previewSession.createGrant(instructor, COURSE_ID);
        const req = makeRequest({ user: instructor, grant, path: '/student/quiz' });
        const res = makeResponse();
        const next = jest.fn();

        await middleware.requireStudentOrPreview(req, res, next);

        // Browsers cannot set headers on a navigation, so the marker is added
        // to the URL rather than bouncing the previewer out.
        expect(res.redirectedTo).toBe('/student/quiz?preview=1');
        expect(next).not.toHaveBeenCalled();
    });

    test('bounces an instructor with no grant at all', async () => {
        const { middleware } = makeMiddleware();
        const req = makeRequest({ user: instructor });
        const res = makeResponse();
        const next = jest.fn();

        await middleware.requireStudentOrPreview(req, res, next);

        expect(next).not.toHaveBeenCalled();
        expect(res.redirectedTo).toBe('/instructor');
    });
});

describe('allowStudentAssets', () => {
    test('serves inert assets on the grant alone, since a script tag sends no header', async () => {
        const { middleware } = makeMiddleware();
        const grant = previewSession.createGrant(instructor, COURSE_ID);
        const req = makeRequest({ user: instructor, grant, path: '/student/scripts/student.js' });
        const next = jest.fn();

        await middleware.allowStudentAssets(req, makeResponse(), next);

        expect(next).toHaveBeenCalled();
    });

    test('does not serve an unmarked HTML page to an instructor who merely holds a grant', async () => {
        const { middleware } = makeMiddleware();
        const grant = previewSession.createGrant(instructor, COURSE_ID);
        const req = makeRequest({ user: instructor, grant, path: '/student/dashboard.html' });
        const res = makeResponse();
        const next = jest.fn();

        await middleware.allowStudentAssets(req, res, next);

        expect(next).not.toHaveBeenCalled();
        expect(res.redirectedTo).toBe('/instructor');
    });

    test('serves the HTML page after resolvePreview has swapped a marked request', async () => {
        const { middleware } = makeMiddleware();
        const grant = previewSession.createGrant(instructor, COURSE_ID);
        const req = makeRequest({
            user: instructor,
            marked: true,
            grant,
            path: '/student/dashboard.html?preview=1'
        });
        req.query = { preview: '1' };
        const next = jest.fn();

        await middleware.resolvePreview(req, makeResponse(), () => {});
        await middleware.allowStudentAssets(req, makeResponse(), next);

        expect(req.user.role).toBe('student');
        expect(next).toHaveBeenCalled();
    });

    test('still refuses an instructor with no grant', async () => {
        const { middleware } = makeMiddleware();
        const req = makeRequest({ user: instructor, path: '/student/scripts/student.js' });
        const res = makeResponse();
        const next = jest.fn();

        await middleware.allowStudentAssets(req, res, next);

        expect(next).not.toHaveBeenCalled();
        expect(res.redirectedTo).toBe('/instructor');
    });
});

describe('requireStudentEnrolled', () => {
    test('lets a preview through for the course its grant names', async () => {
        const { middleware } = makeMiddleware();
        const grant = previewSession.createGrant(instructor, COURSE_ID);
        const req = makeRequest({ user: instructor, marked: true, grant });
        req.body = { courseId: COURSE_ID };
        const res = makeResponse();
        const next = jest.fn();

        await middleware.resolvePreview(req, makeResponse(), () => {});
        await middleware.requireStudentEnrolled(req, res, next);

        expect(next).toHaveBeenCalled();
        expect(res.statusCode).toBeNull();
    });

    test('refuses a preview reaching for a course outside its grant', async () => {
        // The whole point of the enrollment check for a preview: /api/chat and
        // /api/quiz have no course gate of their own, so a preview that skipped
        // this could read any course on the platform by changing the courseId.
        const { db, middleware } = makeMiddleware();
        await db.collection('courses').insertOne({
            courseId: 'OTHER-101',
            status: 'active',
            instructorId: 'someone-else'
        });

        const grant = previewSession.createGrant(instructor, COURSE_ID);
        const req = makeRequest({ user: instructor, marked: true, grant });
        req.body = { courseId: 'OTHER-101' };
        const res = makeResponse();
        const next = jest.fn();

        await middleware.resolvePreview(req, makeResponse(), () => {});
        await middleware.requireStudentEnrolled(req, res, next);

        expect(next).not.toHaveBeenCalled();
        expect(res.statusCode).toBe(403);
    });

    test('a real unenrolled student is still blocked', async () => {
        const { middleware } = makeMiddleware();
        const req = makeRequest({ user: student });
        req.body = { courseId: COURSE_ID };
        const res = makeResponse();
        const next = jest.fn();

        await middleware.requireStudentEnrolled(req, res, next);

        expect(next).not.toHaveBeenCalled();
        expect(res.statusCode).toBe(403);
    });
});
