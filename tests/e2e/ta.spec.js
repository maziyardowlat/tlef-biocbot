// @ts-check
require('dotenv').config();
const path = require('path');
const { MongoClient } = require('mongodb');
const { test, expect, request } = require('@playwright/test');
const { TEST_USERS, loadCredentials } = require('./helpers/users');

const user = TEST_USERS.ta;
const instructorUser = TEST_USERS.instructor;
const COURSE_ID = 'BIOC-E2E-TA';
const COURSE_NAME = 'BIOC E2E TA Test';
const OTHER_COURSE_ID = 'BIOC-E2E-TA-OTHER';
const OTHER_COURSE_NAME = 'BIOC E2E TA Test (Unassigned)';
const LECTURE_FIXTURE = path.join(__dirname, 'fixtures', 'sample-lecture.txt');

let password;

test.beforeAll(() => {
    password = loadCredentials().ta;
    if (!password) {
        throw new Error('No credentials.ta found. Global-setup should have generated it.');
    }
});

async function withDb(fn) {
    if (!process.env.MONGO_URI) {
        throw new Error('MONGO_URI not set; cannot run ta.spec.js tests.');
    }
    const client = new MongoClient(process.env.MONGO_URI);
    await client.connect();
    try {
        return await fn(client.db());
    } finally {
        await client.close();
    }
}

async function getUserIdByUsername(username) {
    return withDb(async (db) => {
        const u = await db.collection('users').findOne({ username });
        if (!u) throw new Error(`User ${username} not found in DB.`);
        return u.userId;
    });
}

/**
 * @param {{
 *   courseId: string,
 *   courseName: string,
 *   instructorId: string,
 *   tas?: string[],
 *   taPermissions?: Record<string, { canAccessCourses: boolean, canAccessFlags: boolean, updatedAt: Date }> | null,
 *   now?: Date,
 * }} args
 */
function buildCourseDoc({ courseId, courseName, instructorId, tas = [], taPermissions = null, now = new Date() }) {
    /** @type {Record<string, any>} */
    const doc = {
        courseId,
        courseName,
        courseCode: `${courseId}-S`,
        instructorCourseCode: `${courseId}-I`,
        instructorId,
        instructors: [instructorId],
        tas,
        courseDescription: '',
        assessmentCriteria: '',
        courseMaterials: [],
        approvedStruggleTopics: [],
        courseStructure: { weeks: 1, lecturesPerWeek: 1, totalUnits: 1 },
        isOnboardingComplete: true,
        status: 'active',
        lectures: [
            {
                name: 'Unit 1',
                isPublished: false,
                learningObjectives: ['Sample objective'],
                passThreshold: 0,
                createdAt: now,
                updatedAt: now,
                documents: [],
                assessmentQuestions: [],
            },
        ],
        createdAt: now,
        updatedAt: now,
    };
    if (taPermissions) {
        doc.taPermissions = taPermissions;
    }
    return doc;
}

async function seedCourseWithTA(overrides = {}) {
    const instructorId = await getUserIdByUsername(instructorUser.username);
    const taId = await getUserIdByUsername(user.username);
    await withDb(async (db) => {
        await db.collection('courses').deleteMany({
            courseId: { $in: [COURSE_ID, OTHER_COURSE_ID] },
        });
        await db.collection('courses').insertOne(
            buildCourseDoc({
                courseId: COURSE_ID,
                courseName: COURSE_NAME,
                instructorId,
                tas: [taId],
                taPermissions: overrides.taPermissions || null,
            })
        );
    });
}

async function seedTwoCourses() {
    const instructorId = await getUserIdByUsername(instructorUser.username);
    const taId = await getUserIdByUsername(user.username);
    await withDb(async (db) => {
        await db.collection('courses').deleteMany({
            courseId: { $in: [COURSE_ID, OTHER_COURSE_ID] },
        });
        await db.collection('courses').insertMany([
            buildCourseDoc({
                courseId: COURSE_ID,
                courseName: COURSE_NAME,
                instructorId,
                tas: [taId],
            }),
            buildCourseDoc({
                courseId: OTHER_COURSE_ID,
                courseName: OTHER_COURSE_NAME,
                instructorId,
                tas: [],
            }),
        ]);
    });
}

async function loginViaUI(page) {
    await page.goto('/');
    await page.locator('#auth-form input#username').fill(user.username);
    await page.locator('#auth-form input#password').fill(password);
    await page.locator('#auth-form button#login-btn').click();
    await page.waitForURL((url) => url.pathname !== '/' && url.pathname !== '/login', {
        timeout: 10_000,
    });
}

test.describe('TA authentication and course access', () => {
    test.beforeEach(async () => {
        await seedCourseWithTA();
    });

    test('TA can sign in via the UI and lands on /ta', async ({ page }) => {
        await page.goto('/');
        await page.locator('#auth-form input#username').fill(user.username);
        await page.locator('#auth-form input#password').fill(password);
        await page.locator('#auth-form button#login-btn').click();

        await page.waitForURL((url) => !url.pathname.match(/^\/?$/) && url.pathname !== '/login', {
            timeout: 10_000,
        });

        expect(page.url()).toContain(user.landingPath);
        await expect(page.locator('h1', { hasText: 'TA Dashboard' })).toBeVisible();
    });

    test('TA dashboard renders assigned course in picker and summary', async ({ page }) => {
        await loginViaUI(page);
        await page.goto('/ta');

        // The course picker only appears once courses load
        const pickerSection = page.locator('#ta-course-picker-section');
        await expect(pickerSection).toBeVisible({ timeout: 15_000 });

        // Assigned course appears in dropdown
        const courseSelect = page.locator('#ta-course-select');
        await expect(courseSelect.locator(`option[value="${COURSE_ID}"]`)).toHaveCount(1);

        // Selected-course summary reflects the seeded course
        await expect(page.locator('#selected-course-name')).toHaveText(COURSE_NAME, { timeout: 10_000 });
        await expect(page.locator('#selected-course-id')).toHaveText(COURSE_ID);

        // Course card is rendered in the courses container with assigned permissions
        const card = page.locator(`.course-card[data-course-id="${COURSE_ID}"]`);
        await expect(card).toBeVisible();
        await expect(card).toContainText('Course Upload: Allowed');
    });

    test('TA can upload a course document to an assigned course', async ({ page }) => {
        await loginViaUI(page);

        // Mock the upload + topic extraction to avoid real LLM/vector work
        let uploadCalls = 0;
        await page.route('**/api/documents/upload', async (route) => {
            uploadCalls += 1;
            await route.fulfill({
                status: 200,
                contentType: 'application/json',
                body: JSON.stringify({
                    success: true,
                    data: { documentId: `e2e-ta-mocked-upload-${uploadCalls}` },
                }),
            });
        });
        await page.route('**/api/courses/*/extract-topics', async (route) => {
            await route.fulfill({
                status: 200,
                contentType: 'application/json',
                body: JSON.stringify({
                    success: true,
                    data: { topics: ['E2E TA Mock Topic'] },
                }),
            });
        });

        await page.goto(`/instructor/documents?courseId=${COURSE_ID}`);
        await expect(page.locator('#course-title')).toHaveText(COURSE_NAME, { timeout: 15_000 });

        const unitContainer = page.locator('#dynamic-units-container');
        await expect(unitContainer).toContainText('Unit 1');

        // The upload buttons live inside collapsed unit sections, so trigger the
        // page's global openUploadModal directly (same handler the buttons use)
        const firstUploadBtn = unitContainer.locator('button.action-button.upload').first();
        await expect(firstUploadBtn).toBeAttached({ timeout: 15_000 });
        await page.evaluate(() => /** @type {any} */ (window).openUploadModal('Unit 1', 'lecture-notes'));

        await expect(page.locator('#upload-modal')).toBeVisible();
        await page.locator('#file-input').setInputFiles(LECTURE_FIXTURE);
        await page.locator('#upload-btn').click();

        // Mocked extraction surfaces the topic review section
        await expect(page.locator('#topic-review-section')).toBeVisible({ timeout: 15_000 });
        expect(uploadCalls).toBeGreaterThanOrEqual(1);
    });
});

test.describe('TA is blocked from student & instructor-only routes', () => {
    test('TA visiting /student is redirected to /ta', async ({ page }) => {
        await loginViaUI(page);

        const response = await page.goto('/student');
        // Either the server 302s to /ta, or the final URL is /ta
        expect(page.url()).toContain('/ta');
        if (response) {
            expect(response.url()).toContain('/ta');
        }
    });

    test('TA visiting /student/quiz is redirected to /ta', async ({ page }) => {
        await loginViaUI(page);

        await page.goto('/student/quiz');
        expect(page.url()).toContain('/ta');
        expect(page.url()).not.toContain('/student');
    });

    test('TA visiting /instructor/onboarding is redirected to /ta', async ({ page }) => {
        await loginViaUI(page);

        await page.goto('/instructor/onboarding');
        expect(page.url()).toContain('/ta');
        expect(page.url()).not.toContain('/instructor/onboarding');
    });
});

test.describe('TA permission gating', () => {
    test('TA with canAccessCourses=false is denied at /instructor/documents', async ({ page, baseURL }) => {
        const taId = await getUserIdByUsername(user.username);
        await seedCourseWithTA({
            taPermissions: {
                [taId]: {
                    canAccessCourses: false,
                    canAccessFlags: false,
                    updatedAt: new Date(),
                },
            },
        });

        await loginViaUI(page);

        const response = await page.goto(`/instructor/documents?courseId=${COURSE_ID}`);
        if (!response) throw new Error('Expected a navigation response for /instructor/documents');
        expect(response.status()).toBe(403);

        // Independently verify via the permissions API (source of truth for the gate)
        const apiCtx = await request.newContext({ baseURL });
        await apiCtx.post('/api/auth/login', {
            data: { username: user.username, password },
        });
        const permRes = await apiCtx.get(`/api/courses/${COURSE_ID}/ta-permissions/${taId}`);
        expect(permRes.ok()).toBeTruthy();
        const permBody = await permRes.json();
        expect(permBody.success).toBe(true);
        expect(permBody.data.permissions.canAccessCourses).toBe(false);
        await apiCtx.dispose();
    });
});

test.describe('TA course scoping', () => {
    test('GET /api/courses/ta/:taId only returns assigned courses', async ({ baseURL }) => {
        await seedTwoCourses();
        const taId = await getUserIdByUsername(user.username);

        const apiCtx = await request.newContext({ baseURL });
        const loginRes = await apiCtx.post('/api/auth/login', {
            data: { username: user.username, password },
        });
        expect(loginRes.ok()).toBeTruthy();

        const coursesRes = await apiCtx.get(`/api/courses/ta/${taId}`);
        expect(coursesRes.ok()).toBeTruthy();
        const body = await coursesRes.json();
        expect(body.success).toBe(true);

        const returnedIds = body.data.map((c) => c.courseId);
        expect(returnedIds).toContain(COURSE_ID);
        expect(returnedIds).not.toContain(OTHER_COURSE_ID);

        await apiCtx.dispose();
    });

    test('GET /api/courses/ta/:taId for another TA returns 403', async ({ baseURL }) => {
        await seedCourseWithTA();

        const apiCtx = await request.newContext({ baseURL });
        const loginRes = await apiCtx.post('/api/auth/login', {
            data: { username: user.username, password },
        });
        expect(loginRes.ok()).toBeTruthy();

        const res = await apiCtx.get('/api/courses/ta/some-other-ta-id', {
            failOnStatusCode: false,
        });
        expect(res.status()).toBe(403);

        await apiCtx.dispose();
    });
});
