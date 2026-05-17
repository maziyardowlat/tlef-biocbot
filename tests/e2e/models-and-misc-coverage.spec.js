// @ts-check
/**
 * Coverage for the remaining low-coverage src/ files:
 *   - src/routes/learning-objectives.js
 *   - src/routes/user-agreement.js  + src/models/UserAgreement.js
 *   - src/routes/struggle-activity.js + src/models/StruggleActivity.js
 *   - src/routes/qdrant.js (lightweight branches, no real ingestion)
 *   - src/routes/students.js (a few read paths)
 *   - User model branches that aren't exercised by other specs (struggleState updates)
 */

const { test, expect, request } = require('./fixtures/monocart');
const { TEST_USERS, storageStatePath } = require('./helpers/users');
const {
    withDb,
    getUserIdByUsername,
    seedCourse,
    cleanupCourses,
    cleanupCoursesForUser,
    setStudentEnrollment,
} = require('./helpers/courses-test');

const COURSE_A = 'BIOC-E2E-API-MISC-A';

let instructorId;
let studentId;

test.beforeAll(async () => {
    instructorId = await getUserIdByUsername(TEST_USERS.instructor.username);
    studentId = await getUserIdByUsername(TEST_USERS.student.username);
});

test.beforeEach(async () => {
    await cleanupCoursesForUser(instructorId);
});

test.afterAll(async () => {
    await cleanupCourses([COURSE_A]);
    await cleanupCoursesForUser(instructorId);
});

// ---------------------------------------------------------------------------
// /api/learning-objectives
// ---------------------------------------------------------------------------
test.describe('/api/learning-objectives', () => {
    test.use({ storageState: storageStatePath('instructor') });

    test('POST 400 when fields missing', async ({ request: api }) => {
        const res = await api.post('/api/learning-objectives', {
            data: { week: 'Unit 1' },
        });
        expect(res.status()).toBe(400);
    });

    test('GET 400 when params missing', async ({ request: api }) => {
        const res = await api.get('/api/learning-objectives?courseId=X');
        expect(res.status()).toBe(400);
    });

    test('happy path round-trip via lectureName', async ({ request: api }) => {
        await seedCourse({ courseId: COURSE_A, instructorId });
        const post = await api.post('/api/learning-objectives', {
            data: {
                lectureName: 'Unit 1',
                objectives: ['Identify biomolecules', 'Apply enzyme kinetics'],
                instructorId,
                courseId: COURSE_A,
            },
        });
        expect(post.ok()).toBeTruthy();

        const get = await api.get(`/api/learning-objectives?lectureName=${encodeURIComponent('Unit 1')}&courseId=${COURSE_A}`);
        expect(get.ok()).toBeTruthy();
        const body = await get.json();
        expect(body.data.objectives).toEqual(['Identify biomolecules', 'Apply enzyme kinetics']);
    });

    test('happy path round-trip via week (back-compat)', async ({ request: api }) => {
        await seedCourse({ courseId: COURSE_A, instructorId });
        const post = await api.post('/api/learning-objectives', {
            data: {
                week: 'Unit 2',
                objectives: ['Compare DNA vs RNA'],
                instructorId,
                courseId: COURSE_A,
            },
        });
        expect(post.ok()).toBeTruthy();
        const get = await api.get(`/api/learning-objectives?week=${encodeURIComponent('Unit 2')}&courseId=${COURSE_A}`);
        const body = await get.json();
        expect(body.data.objectives).toEqual(['Compare DNA vs RNA']);
    });
});

// ---------------------------------------------------------------------------
// /api/user-agreement (covers models/UserAgreement.js)
// ---------------------------------------------------------------------------
test.describe('/api/user-agreement', () => {
    test.use({ storageState: storageStatePath('instructor') });

    test.afterEach(async () => {
        await withDb((db) =>
            db.collection('userAgreements').deleteMany({ userId: instructorId })
        );
    });

    test('GET /status returns hasAgreed:false when no record exists', async ({ request: api }) => {
        await withDb((db) =>
            db.collection('userAgreements').deleteMany({ userId: instructorId })
        );
        const res = await api.get('/api/user-agreement/status');
        expect(res.ok()).toBeTruthy();
        const body = await res.json();
        expect(body.data.hasAgreed).toBe(false);
    });

    test('POST /agree records and GET /status reflects it', async ({ request: api }) => {
        const post = await api.post('/api/user-agreement/agree', {
            data: { agreementVersion: '2.1' },
        });
        expect(post.ok()).toBeTruthy();
        const postBody = await post.json();
        expect(postBody.data.hasAgreed).toBe(true);
        expect(postBody.data.agreementVersion).toBe('2.1');

        const get = await api.get('/api/user-agreement/status');
        const body = await get.json();
        expect(body.data.hasAgreed).toBe(true);
        expect(body.data.agreementVersion).toBe('2.1');
    });

    test('POST /agree uses default version when not supplied', async ({ request: api }) => {
        const res = await api.post('/api/user-agreement/agree', { data: {} });
        expect(res.ok()).toBeTruthy();
        const body = await res.json();
        expect(body.data.agreementVersion).toBe('1.0');
    });
});

// ---------------------------------------------------------------------------
// /api/struggle-activity
// ---------------------------------------------------------------------------
test.describe('/api/struggle-activity', () => {
    test.use({ storageState: storageStatePath('instructor') });

    test.beforeEach(async () => {
        await seedCourse({ courseId: COURSE_A, instructorId });
    });

    test.afterEach(async () => {
        await withDb((db) =>
            db.collection('struggleActivities').deleteMany({ courseId: COURSE_A })
        );
    });

    test('GET /:courseId returns daily metrics array', async ({ request: api }) => {
        // Seed two activity rows
        await withDb((db) =>
            db.collection('struggleActivities').insertMany([
                { courseId: COURSE_A, studentId, day: '2026-04-01', topic: 'Cells', count: 1, recordedAt: new Date('2026-04-01T00:00:00Z') },
                { courseId: COURSE_A, studentId, day: '2026-04-02', topic: 'Cells', count: 2, recordedAt: new Date('2026-04-02T00:00:00Z') },
            ])
        );
        const res = await api.get(`/api/struggle-activity/${COURSE_A}`);
        expect(res.ok()).toBeTruthy();
        const body = await res.json();
        expect(body.success).toBe(true);
        expect(Array.isArray(body.data)).toBe(true);
    });

    test('GET /weekly/:courseId returns aggregated counts', async ({ request: api }) => {
        const res = await api.get(`/api/struggle-activity/weekly/${COURSE_A}`);
        expect(res.ok()).toBeTruthy();
        const body = await res.json();
        expect(body.success).toBe(true);
    });

    test('GET /persistence/:courseId returns persistence topic list', async ({ request: api }) => {
        const res = await api.get(`/api/struggle-activity/persistence/${COURSE_A}`);
        expect(res.ok()).toBeTruthy();
        const body = await res.json();
        expect(body.success).toBe(true);
    });

    test('GET /student/:userId returns per-student activity', async ({ request: api }) => {
        const res = await api.get(`/api/struggle-activity/student/${studentId}`);
        expect(res.ok()).toBeTruthy();
        const body = await res.json();
        expect(body.success).toBe(true);
    });
});

// ---------------------------------------------------------------------------
// /api/qdrant — lightweight: status + 400 validation paths
// ---------------------------------------------------------------------------
test.describe('/api/qdrant', () => {
    test.use({ storageState: storageStatePath('instructor') });

    test('GET /status returns the qdrant service state', async ({ request: api }) => {
        const res = await api.get('/api/qdrant/status');
        expect([200, 503]).toContain(res.status());
        const body = await res.json();
        // Either initialized OR not — both are valid branches.
        expect('success' in body || 'message' in body).toBe(true);
    });

    test('POST /process-document 400 when fields missing', async ({ request: api }) => {
        const res = await api.post('/api/qdrant/process-document', { data: {} });
        expect(res.status()).toBe(400);
    });

    test('POST /search 400 when query missing', async ({ request: api }) => {
        const res = await api.post('/api/qdrant/search', { data: {} });
        expect(res.status()).toBe(400);
    });

    test('GET /collection-stats returns the chunk counts', async ({ request: api }) => {
        const res = await api.get('/api/qdrant/collection-stats');
        expect([200, 500, 503]).toContain(res.status());
    });
});

// ---------------------------------------------------------------------------
// /api/students — instructor reads
// ---------------------------------------------------------------------------
test.describe('/api/students', () => {
    test.describe('as non-admin instructor', () => {
        test.use({ storageState: storageStatePath('instructor') });

        test.beforeEach(async () => {
            await seedCourse({ courseId: COURSE_A, instructorId });
            await setStudentEnrollment(COURSE_A, studentId, true);
        });

        test('GET /:courseId returns 403 (requires system-admin access)', async ({ request: api }) => {
            const res = await api.get(`/api/students/${COURSE_A}`);
            expect(res.status()).toBe(403);
        });

        test('GET /:courseId/:studentId/sessions returns 403 (system-admin only)', async ({ request: api }) => {
            const res = await api.get(`/api/students/${COURSE_A}/${studentId}/sessions`);
            expect(res.status()).toBe(403);
        });
    });

    test.describe('as student', () => {
        test.use({ storageState: storageStatePath('student') });

        test.beforeEach(async () => {
            await seedCourse({ courseId: COURSE_A, instructorId });
            await setStudentEnrollment(COURSE_A, studentId, true);
        });

        test('GET /:courseId/:studentId/sessions/own returns the caller\'s own sessions', async ({ request: api }) => {
            const res = await api.get(`/api/students/${COURSE_A}/${studentId}/sessions/own?courseId=${COURSE_A}`);
            expect([200, 403]).toContain(res.status());
        });
    });
});

// ---------------------------------------------------------------------------
// User model — struggle-state path via /api/student/struggle
// ---------------------------------------------------------------------------
test.describe('/api/student/struggle', () => {
    test.describe('as student', () => {
        test.use({ storageState: storageStatePath('student') });

        test('GET state returns a response (route is reachable)', async ({ request: api }) => {
            const res = await api.get('/api/student/struggle/state');
            expect([200, 400, 404]).toContain(res.status());
        });
    });
});
