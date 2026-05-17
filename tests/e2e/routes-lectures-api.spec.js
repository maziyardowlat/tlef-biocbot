// @ts-check
/**
 * API coverage for src/routes/lectures.js (27% → target higher).
 *
 * Also includes a failing assertion that exposes FINDINGS #11: the
 * /publish-status route trusts the body `instructorId` and does no
 * course-access check, so a student can read another course's publish state.
 */

const { test, expect } = require('./fixtures/monocart');
const { TEST_USERS, storageStatePath } = require('./helpers/users');
const {
    withDb,
    getUserIdByUsername,
    seedCourse,
    cleanupCourses,
    cleanupCoursesForUser,
    setStudentEnrollment,
} = require('./helpers/courses-test');

const COURSE_A = 'BIOC-E2E-API-LECT-A';
const COURSE_B = 'BIOC-E2E-API-LECT-B';

let instructorId;
let instructorFreshId;
let studentId;

test.beforeAll(async () => {
    instructorId = await getUserIdByUsername(TEST_USERS.instructor.username);
    instructorFreshId = await getUserIdByUsername(TEST_USERS.instructor_fresh.username);
    studentId = await getUserIdByUsername(TEST_USERS.student.username);
});

test.beforeEach(async () => {
    await cleanupCoursesForUser(instructorId);
    await cleanupCoursesForUser(instructorFreshId);
});

test.afterAll(async () => {
    await cleanupCourses([COURSE_A, COURSE_B]);
    await cleanupCoursesForUser(instructorId);
    await cleanupCoursesForUser(instructorFreshId);
});

// ---------------------------------------------------------------------------
// POST /api/lectures/publish
// ---------------------------------------------------------------------------
test.describe('POST /api/lectures/publish', () => {
    test.use({ storageState: storageStatePath('instructor') });

    test('400 when required fields missing', async ({ request: api }) => {
        const res = await api.post('/api/lectures/publish', {
            data: { lectureName: 'Unit 1' },
        });
        expect(res.status()).toBe(400);
    });

    test('403 when caller has no course access', async ({ request: api }) => {
        await seedCourse({ courseId: COURSE_B, instructorId: instructorFreshId });
        const res = await api.post('/api/lectures/publish', {
            data: { courseId: COURSE_B, lectureName: 'Unit 1', isPublished: true },
        });
        expect(res.status()).toBe(403);
    });

    test('happy path publishes a unit', async ({ request: api }) => {
        await seedCourse({ courseId: COURSE_A, instructorId });
        const res = await api.post('/api/lectures/publish', {
            data: { courseId: COURSE_A, lectureName: 'Unit 1', isPublished: true },
        });
        expect(res.ok()).toBeTruthy();
        const doc = await withDb((db) =>
            db.collection('courses').findOne({ courseId: COURSE_A })
        );
        const u1 = doc.lectures.find((l) => l.name === 'Unit 1');
        expect(u1.isPublished).toBe(true);
    });
});

// ---------------------------------------------------------------------------
// GET /api/lectures/publish-status
// ---------------------------------------------------------------------------
test.describe('GET /api/lectures/publish-status', () => {
    test('400 when params missing', async ({ baseURL }) => {
        const { request } = require('@playwright/test');
        const api = await request.newContext({
            baseURL,
            storageState: storageStatePath('instructor'),
        });
        try {
            const res = await api.get('/api/lectures/publish-status');
            expect(res.status()).toBe(400);
        } finally {
            await api.dispose();
        }
    });

    test('happy path returns publish status map (name → isPublished)', async ({ baseURL }) => {
        await seedCourse({ courseId: COURSE_A, instructorId });
        const { request } = require('@playwright/test');
        const api = await request.newContext({
            baseURL,
            storageState: storageStatePath('instructor'),
        });
        try {
            const res = await api.get(`/api/lectures/publish-status?instructorId=${instructorId}&courseId=${COURSE_A}`);
            expect(res.ok()).toBeTruthy();
            const body = await res.json();
            expect(body.data.courseId).toBe(COURSE_A);
            expect(typeof body.data.publishStatus).toBe('object');
            expect(body.data.publishStatus['Unit 1']).toBe(false);
        } finally {
            await api.dispose();
        }
    });

    test('PRODUCT BUG (FINDINGS #11): a student can read the publish state of any course', async ({ baseURL }) => {
        // The route accepts any `instructorId` and `courseId` from the query
        // string and serves the full publish-status array with no auth check.
        // EXPECTED: 403 — students must not see publish state for courses
        // they're not enrolled in, especially not by impersonating an instructorId.
        await seedCourse({ courseId: COURSE_A, instructorId });
        const { request } = require('@playwright/test');
        const api = await request.newContext({
            baseURL,
            storageState: storageStatePath('student'),
        });
        try {
            const res = await api.get(`/api/lectures/publish-status?instructorId=${instructorId}&courseId=${COURSE_A}`);
            expect(res.status()).toBe(403);
        } finally {
            await api.dispose();
        }
    });
});

// ---------------------------------------------------------------------------
// GET /api/lectures/student-visible
// ---------------------------------------------------------------------------
test.describe('GET /api/lectures/student-visible', () => {
    test.use({ storageState: storageStatePath('student') });

    test('400 when courseId missing', async ({ request: api }) => {
        const res = await api.get('/api/lectures/student-visible');
        expect(res.status()).toBe(400);
    });

    test('returns the published lecture names', async ({ request: api }) => {
        await seedCourse({
            courseId: COURSE_A,
            instructorId,
            lectures: [
                {
                    name: 'Unit 1',
                    isPublished: true,
                    learningObjectives: [],
                    passThreshold: 2,
                    documents: [],
                    assessmentQuestions: [],
                },
                {
                    name: 'Unit 2',
                    isPublished: false,
                    learningObjectives: [],
                    passThreshold: 2,
                    documents: [],
                    assessmentQuestions: [],
                },
            ],
        });
        await setStudentEnrollment(COURSE_A, studentId, true);
        const res = await api.get(`/api/lectures/student-visible?courseId=${COURSE_A}`);
        expect(res.ok()).toBeTruthy();
        const body = await res.json();
        expect(body.data.publishedLectures).toContain('Unit 1');
        expect(body.data.publishedLectures).not.toContain('Unit 2');
    });
});

// ---------------------------------------------------------------------------
// pass-threshold
// ---------------------------------------------------------------------------
test.describe('pass-threshold endpoints', () => {
    test.use({ storageState: storageStatePath('instructor') });

    test('POST 400 when fields missing', async ({ request: api }) => {
        const res = await api.post('/api/lectures/pass-threshold', { data: { courseId: COURSE_A } });
        expect(res.status()).toBe(400);
    });

    test('POST 400 when passThreshold out of range', async ({ request: api }) => {
        const res = await api.post('/api/lectures/pass-threshold', {
            data: { courseId: COURSE_A, lectureName: 'Unit 1', passThreshold: 101, instructorId },
        });
        expect(res.status()).toBe(400);
    });

    test('POST happy path updates the threshold and GET reads it back', async ({ request: api }) => {
        await seedCourse({ courseId: COURSE_A, instructorId });
        const post = await api.post('/api/lectures/pass-threshold', {
            data: { courseId: COURSE_A, lectureName: 'Unit 1', passThreshold: 60, instructorId },
        });
        expect(post.ok()).toBeTruthy();

        const get = await api.get(`/api/lectures/pass-threshold?courseId=${COURSE_A}&lectureName=${encodeURIComponent('Unit 1')}`);
        expect(get.ok()).toBeTruthy();
        const body = await get.json();
        expect(body.data.passThreshold).toBe(60);
    });

    test('GET 400 when params missing', async ({ request: api }) => {
        const res = await api.get('/api/lectures/pass-threshold');
        expect(res.status()).toBe(400);
    });
});

// ---------------------------------------------------------------------------
// GET /api/lectures/published-with-questions
// ---------------------------------------------------------------------------
test.describe('GET /api/lectures/published-with-questions', () => {
    test.use({ storageState: storageStatePath('student') });

    test('400 when courseId missing', async ({ request: api }) => {
        const res = await api.get('/api/lectures/published-with-questions');
        expect(res.status()).toBe(400);
    });

    test('empty course returns empty array', async ({ request: api }) => {
        await seedCourse({ courseId: COURSE_A, instructorId });
        await setStudentEnrollment(COURSE_A, studentId, true);
        const res = await api.get(`/api/lectures/published-with-questions?courseId=${COURSE_A}`);
        expect(res.ok()).toBeTruthy();
        const body = await res.json();
        expect(body.data.publishedLectures).toEqual([]);
    });

    test('returns published lectures with their assessment questions', async ({ request: api }) => {
        const now = new Date();
        await seedCourse({
            courseId: COURSE_A,
            instructorId,
            lectures: [
                {
                    name: 'Unit 1',
                    isPublished: true,
                    learningObjectives: ['LO'],
                    passThreshold: 60,
                    createdAt: now,
                    updatedAt: now,
                    documents: [],
                    assessmentQuestions: [
                        { questionId: 'q-lect-1', questionType: 'true-false', question: 'X', correctAnswer: 'true', isActive: true },
                    ],
                },
                {
                    name: 'Unit 2',
                    isPublished: false,
                    learningObjectives: [],
                    passThreshold: 2,
                    createdAt: now,
                    updatedAt: now,
                    documents: [],
                    assessmentQuestions: [],
                },
            ],
        });
        await setStudentEnrollment(COURSE_A, studentId, true);
        const res = await api.get(`/api/lectures/published-with-questions?courseId=${COURSE_A}`);
        expect(res.ok()).toBeTruthy();
        const body = await res.json();
        expect(body.data.publishedLectures).toHaveLength(1);
        expect(body.data.publishedLectures[0].assessmentQuestions[0].questionId).toBe('q-lect-1');
    });
});
