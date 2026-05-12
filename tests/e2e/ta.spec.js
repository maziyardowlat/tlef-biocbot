// @ts-check
require('dotenv').config();
const path = require('path');
const { MongoClient } = require('mongodb');
const { test, expect, request } = require('@playwright/test');
const { TEST_USERS, loadCredentials } = require('./helpers/users');

const user = TEST_USERS.ta;
const instructorUser = TEST_USERS.instructor;
const studentUser = TEST_USERS.student;
const COURSE_ID = 'BIOC-E2E-TA';
const COURSE_NAME = 'BIOC E2E TA Test';
const OTHER_COURSE_ID = 'BIOC-E2E-TA-OTHER';
const OTHER_COURSE_NAME = 'BIOC E2E TA Test (Unassigned)';
const TA_JOIN_COURSE_ID = 'BIOC-E2E-TA-JOIN';
const TA_JOIN_COURSE_NAME = 'BIOC E2E TA Join Test';
const TA_JOIN_COURSE_CODE = 'TAJOIN';
const TA_INVITED_COURSE_ID = 'BIOC-E2E-TA-INVITED';
const TA_INVITED_COURSE_NAME = 'BIOC E2E TA Invited Test';
const TA_INVITED_COURSE_CODE = 'TAINVITE';
const TEST_COURSE_IDS = [COURSE_ID, OTHER_COURSE_ID, TA_JOIN_COURSE_ID, TA_INVITED_COURSE_ID];
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
 *   courseCode?: string,
 *   status?: string,
 *   now?: Date,
 * }} args
 */
function buildCourseDoc({
    courseId,
    courseName,
    instructorId,
    tas = [],
    taPermissions = null,
    courseCode = `${courseId}-S`,
    status = 'active',
    now = new Date(),
}) {
    /** @type {Record<string, any>} */
    const doc = {
        courseId,
        courseName,
        courseCode,
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
        status,
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

async function resetTAUserState(db, taId) {
    await db.collection('users').updateOne(
        { userId: taId },
        {
            $set: {
                role: 'ta',
                isActive: true,
                invitedCourses: [],
                updatedAt: new Date(),
            },
        }
    );
}

async function seedCourseWithTA(overrides = {}) {
    const instructorId = await getUserIdByUsername(instructorUser.username);
    const taId = await getUserIdByUsername(user.username);
    await withDb(async (db) => {
        await resetTAUserState(db, taId);
        await db.collection('courses').deleteMany({
            courseId: { $in: TEST_COURSE_IDS },
        });
        await db.collection('flaggedQuestions').deleteMany({
            courseId: { $in: TEST_COURSE_IDS },
        });
        await db.collection('courses').insertOne(
            buildCourseDoc({
                courseId: COURSE_ID,
                courseName: COURSE_NAME,
                instructorId,
                tas: [taId],
                taPermissions: overrides.taPermissions || null,
                status: overrides.status || 'active',
            })
        );
    });
}

async function seedTwoCourses() {
    const instructorId = await getUserIdByUsername(instructorUser.username);
    const taId = await getUserIdByUsername(user.username);
    await withDb(async (db) => {
        await resetTAUserState(db, taId);
        await db.collection('courses').deleteMany({
            courseId: { $in: TEST_COURSE_IDS },
        });
        await db.collection('flaggedQuestions').deleteMany({
            courseId: { $in: TEST_COURSE_IDS },
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

async function seedTwoAssignedCoursesWithDifferentPermissions() {
    const instructorId = await getUserIdByUsername(instructorUser.username);
    const taId = await getUserIdByUsername(user.username);
    const now = new Date();

    await withDb(async (db) => {
        await resetTAUserState(db, taId);
        await db.collection('courses').deleteMany({
            courseId: { $in: TEST_COURSE_IDS },
        });
        await db.collection('flaggedQuestions').deleteMany({
            courseId: { $in: TEST_COURSE_IDS },
        });
        await db.collection('courses').insertMany([
            buildCourseDoc({
                courseId: COURSE_ID,
                courseName: COURSE_NAME,
                instructorId,
                tas: [taId],
                taPermissions: {
                    [taId]: {
                        canAccessCourses: true,
                        canAccessFlags: false,
                        updatedAt: now,
                    },
                },
                now,
            }),
            buildCourseDoc({
                courseId: OTHER_COURSE_ID,
                courseName: OTHER_COURSE_NAME,
                instructorId,
                tas: [taId],
                taPermissions: {
                    [taId]: {
                        canAccessCourses: false,
                        canAccessFlags: true,
                        updatedAt: now,
                    },
                },
                now,
            }),
        ]);
    });
}

async function seedJoinableCourseForTA() {
    const instructorId = await getUserIdByUsername(instructorUser.username);
    const taId = await getUserIdByUsername(user.username);

    await withDb(async (db) => {
        await resetTAUserState(db, taId);
        await db.collection('courses').deleteMany({
            courseId: { $in: TEST_COURSE_IDS },
        });
        await db.collection('flaggedQuestions').deleteMany({
            courseId: { $in: TEST_COURSE_IDS },
        });
        await db.collection('courses').insertOne(
            buildCourseDoc({
                courseId: TA_JOIN_COURSE_ID,
                courseName: TA_JOIN_COURSE_NAME,
                courseCode: TA_JOIN_COURSE_CODE,
                instructorId,
                tas: [],
            })
        );
    });
}

async function seedInvitedCourseForTA() {
    const instructorId = await getUserIdByUsername(instructorUser.username);
    const taId = await getUserIdByUsername(user.username);

    await withDb(async (db) => {
        await resetTAUserState(db, taId);
        await db.collection('courses').deleteMany({
            courseId: { $in: TEST_COURSE_IDS },
        });
        await db.collection('flaggedQuestions').deleteMany({
            courseId: { $in: TEST_COURSE_IDS },
        });
        await db.collection('users').updateOne(
            { userId: taId },
            {
                $set: {
                    role: 'ta',
                    isActive: true,
                    invitedCourses: [TA_INVITED_COURSE_ID],
                    updatedAt: new Date(),
                },
            }
        );
        await db.collection('courses').insertOne(
            buildCourseDoc({
                courseId: TA_INVITED_COURSE_ID,
                courseName: TA_INVITED_COURSE_NAME,
                courseCode: TA_INVITED_COURSE_CODE,
                instructorId,
                tas: [],
            })
        );
    });
}

async function seedFlaggedQuestion(courseId = COURSE_ID) {
    const studentId = await getUserIdByUsername(studentUser.username);
    const flagId = `e2e-ta-flag-${Date.now()}`;

    await withDb(async (db) => {
        await db.collection('flaggedQuestions').deleteMany({
            courseId,
            flagId: /^e2e-ta-flag-/,
        });
        await db.collection('flaggedQuestions').insertOne({
            flagId,
            questionId: 'e2e-ta-question',
            courseId,
            unitName: 'Unit 1',
            studentId,
            studentName: studentUser.displayName,
            flagReason: 'unclear',
            flagDescription: 'TA seeded flag for Playwright review',
            botMode: 'tutor',
            flagStatus: 'pending',
            priority: 'medium',
            questionContent: {
                question: 'What does this enzyme do?',
                questionType: 'short-answer',
                explanation: 'Seeded e2e flag content',
            },
            createdAt: new Date(),
            updatedAt: new Date(),
        });
    });

    return flagId;
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

    test('TA with canAccessFlags=false is hidden from and denied flagged-content access', async ({ page, baseURL }) => {
        const taId = await getUserIdByUsername(user.username);
        await seedCourseWithTA({
            taPermissions: {
                [taId]: {
                    canAccessCourses: true,
                    canAccessFlags: false,
                    updatedAt: new Date(),
                },
            },
        });

        await loginViaUI(page);
        await page.goto('/ta');

        await expect(page.locator('#my-courses-link')).toBeVisible({ timeout: 15_000 });
        await expect(page.locator('#student-support-link')).toBeHidden();
        await expect(page.locator('#quick-courses-link')).toBeVisible();
        await expect(page.locator('#quick-support-link')).toBeHidden();

        const response = await page.goto(`/instructor/flagged?courseId=${COURSE_ID}`);
        if (!response) throw new Error('Expected a navigation response for /instructor/flagged');
        expect(response.status()).toBe(403);

        const apiCtx = await request.newContext({ baseURL });
        await apiCtx.post('/api/auth/login', {
            data: { username: user.username, password },
        });

        const studentsRes = await apiCtx.get(`/api/courses/${COURSE_ID}/students`, {
            failOnStatusCode: false,
        });
        expect(studentsRes.status()).toBe(403);

        // Desired behavior: direct flag APIs should be course/permission scoped too,
        // not just hidden behind the flagged-content page route.
        const flagsRes = await apiCtx.get(`/api/flags/course/${COURSE_ID}`, {
            failOnStatusCode: false,
        });
        expect(flagsRes.status()).toBe(403);

        await apiCtx.dispose();
    });

    test('TA dashboard updates visible actions when switching selected courses', async ({ page }) => {
        await seedTwoAssignedCoursesWithDifferentPermissions();
        await loginViaUI(page);

        await page.goto(`/ta?courseId=${COURSE_ID}`);
        await expect(page.locator('#selected-course-id')).toHaveText(COURSE_ID, { timeout: 15_000 });
        await expect(page.locator('#my-courses-link')).toBeVisible();
        await expect(page.locator('#student-support-link')).toBeHidden();
        await expect(page.locator('#quick-courses-link')).toBeVisible();
        await expect(page.locator('#quick-support-link')).toBeHidden();

        await page.locator('#ta-course-select').selectOption(OTHER_COURSE_ID);
        await expect(page.locator('#selected-course-id')).toHaveText(OTHER_COURSE_ID, { timeout: 10_000 });
        await expect(page.locator('#my-courses-link')).toBeHidden();
        await expect(page.locator('#student-support-link')).toBeVisible();
        await expect(page.locator('#quick-courses-link')).toBeHidden();
        await expect(page.locator('#quick-support-link')).toBeVisible();

        const selectedCourseId = await page.evaluate(() => localStorage.getItem('selectedCourseId'));
        expect(selectedCourseId).toBe(OTHER_COURSE_ID);

        await page.locator('#quick-support-link').click();
        await page.waitForURL((url) =>
            url.pathname === '/instructor/flagged' &&
            url.searchParams.get('courseId') === OTHER_COURSE_ID,
            { timeout: 10_000 }
        );
    });

    test('TA with flag permission can review and dismiss a seeded flag', async ({ page }) => {
        const taId = await getUserIdByUsername(user.username);
        await seedCourseWithTA({
            taPermissions: {
                [taId]: {
                    canAccessCourses: false,
                    canAccessFlags: true,
                    updatedAt: new Date(),
                },
            },
        });
        const flagId = await seedFlaggedQuestion();

        await loginViaUI(page);
        await page.goto(`/instructor/flagged?courseId=${COURSE_ID}`);

        const flagCard = page.locator(`[data-flag-id="${flagId}"]`);
        await expect(flagCard).toBeVisible({ timeout: 15_000 });
        await expect(flagCard).toContainText('TA seeded flag for Playwright review');
        await expect(page.locator('#ta-dashboard-nav')).toBeVisible();
        await expect(page.locator('#instructor-ta-hub-nav')).toBeHidden();

        await flagCard.locator('.dismiss-btn').click();
        await expect(flagCard).toHaveCount(0, { timeout: 10_000 });

        const updatedFlag = await withDb((db) =>
            db.collection('flaggedQuestions').findOne({ flagId })
        );
        expect(updatedFlag.flagStatus).toBe('dismissed');
        // Desired behavior: moderation should leave an audit trail for who acted.
        expect(updatedFlag.instructorId).toBe(taId);
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

test.describe('TA course joining', () => {
    test('TA onboarding requires a valid student course code before joining a course', async ({ page }) => {
        const taId = await getUserIdByUsername(user.username);
        await seedJoinableCourseForTA();
        await loginViaUI(page);

        await page.goto('/ta/onboarding');
        const courseSelect = page.locator('#ta-course-select');
        await expect(courseSelect.locator(`option[value="${TA_JOIN_COURSE_ID}"]`)).toHaveCount(1, {
            timeout: 15_000,
        });

        await courseSelect.selectOption(TA_JOIN_COURSE_ID);
        const courseCodeInput = page.locator('#ta-course-code');
        await expect(courseCodeInput).toHaveAttribute('required', '');

        await page.locator('#ta-course-selection-form button[type="submit"]').click();
        await expect(page.locator('#ta-onboarding-complete')).toBeHidden();
        expect(await courseCodeInput.evaluate((input) => {
            const element = /** @type {HTMLInputElement} */ (input);
            return !element.checkValidity();
        })).toBe(true);

        const notJoinedCourse = await withDb((db) =>
            db.collection('courses').findOne({ courseId: TA_JOIN_COURSE_ID })
        );
        expect(notJoinedCourse.tas || []).not.toContain(taId);

        await courseCodeInput.fill('WRONG1');
        await page.locator('#ta-course-selection-form button[type="submit"]').click();
        await expect(page.locator('.notification.error').last()).toContainText('Invalid course code', {
            timeout: 10_000,
        });

        await courseCodeInput.fill(TA_JOIN_COURSE_CODE);
        await page.locator('#ta-course-selection-form button[type="submit"]').click();
        await expect(page.locator('#ta-onboarding-complete')).toBeVisible({ timeout: 15_000 });

        const joinedCourse = await withDb((db) =>
            db.collection('courses').findOne({ courseId: TA_JOIN_COURSE_ID })
        );
        expect(joinedCourse.tas).toContain(taId);
    });
});

test.describe('TA dashboard course picker joins', () => {
    test('TA can accept an instructor invite from the dashboard picker without a course code prompt', async ({ page }) => {
        const taId = await getUserIdByUsername(user.username);
        await seedInvitedCourseForTA();
        await loginViaUI(page);

        let promptCount = 0;
        page.on('dialog', async (dialog) => {
            promptCount += 1;
            await dialog.dismiss();
        });

        await page.goto('/ta');
        const courseSelect = page.locator('#ta-course-select');
        await expect(courseSelect.locator(`option[value="${TA_INVITED_COURSE_ID}"]`)).toContainText(
            '(join invite)',
            { timeout: 15_000 }
        );

        await courseSelect.selectOption(TA_INVITED_COURSE_ID);
        await expect(page.locator('#selected-course-id')).toHaveText(TA_INVITED_COURSE_ID, {
            timeout: 15_000,
        });
        await expect(page.locator('.notification.success').last()).toContainText(TA_INVITED_COURSE_NAME);
        expect(promptCount).toBe(0);

        const { joinedCourse, refreshedTA } = await withDb(async (db) => ({
            joinedCourse: await db.collection('courses').findOne({ courseId: TA_INVITED_COURSE_ID }),
            refreshedTA: await db.collection('users').findOne({ userId: taId }),
        }));
        expect(joinedCourse.tas).toContain(taId);
        expect(refreshedTA.invitedCourses || []).not.toContain(TA_INVITED_COURSE_ID);
    });

    test('TA dashboard requires a valid student code before joining an unassigned active course', async ({ page }) => {
        const taId = await getUserIdByUsername(user.username);
        await seedJoinableCourseForTA();
        await loginViaUI(page);

        const promptResponses = ['WRONG1', TA_JOIN_COURSE_CODE];
        page.on('dialog', async (dialog) => {
            await dialog.accept(promptResponses.shift() || '');
        });

        await page.goto('/ta');
        const courseSelect = page.locator('#ta-course-select');
        await expect(courseSelect.locator(`option[value="${TA_JOIN_COURSE_ID}"]`)).toContainText(
            '(enter code to join)',
            { timeout: 15_000 }
        );

        await courseSelect.selectOption(TA_JOIN_COURSE_ID);
        await expect(page.locator('.notification.error').last()).toContainText('Invalid course code', {
            timeout: 10_000,
        });
        const notJoinedCourse = await withDb((db) =>
            db.collection('courses').findOne({ courseId: TA_JOIN_COURSE_ID })
        );
        expect(notJoinedCourse.tas || []).not.toContain(taId);

        await courseSelect.selectOption(TA_JOIN_COURSE_ID);
        await expect(page.locator('#selected-course-id')).toHaveText(TA_JOIN_COURSE_ID, {
            timeout: 15_000,
        });

        const joinedCourse = await withDb((db) =>
            db.collection('courses').findOne({ courseId: TA_JOIN_COURSE_ID })
        );
        expect(joinedCourse.tas).toContain(taId);
    });
});

test.describe('TA settings and inactive course display', () => {
    test('TA dashboard marks an assigned inactive course while preserving permitted actions', async ({ page }) => {
        const taId = await getUserIdByUsername(user.username);
        await seedCourseWithTA({
            status: 'inactive',
            taPermissions: {
                [taId]: {
                    canAccessCourses: true,
                    canAccessFlags: true,
                    updatedAt: new Date(),
                },
            },
        });

        await loginViaUI(page);
        await page.goto('/ta');

        await expect(page.locator('#selected-course-name')).toHaveText(`${COURSE_NAME} (Inactive)`, {
            timeout: 15_000,
        });
        await expect(page.locator('#selected-course-status')).toHaveText('Inactive');
        const card = page.locator(`.course-card[data-course-id="${COURSE_ID}"]`);
        await expect(card).toContainText('Inactive');
        await expect(card).toContainText('Course Upload: Allowed');
        await expect(card).toContainText('Flags: Allowed');
        await expect(page.locator('#my-courses-link')).toBeVisible();
        await expect(page.locator('#student-support-link')).toBeVisible();
    });

    test('TA settings displays account details and permission status', async ({ page }) => {
        const taId = await getUserIdByUsername(user.username);
        await seedCourseWithTA({
            taPermissions: {
                [taId]: {
                    canAccessCourses: true,
                    canAccessFlags: false,
                    updatedAt: new Date(),
                },
            },
        });

        await loginViaUI(page);
        await page.goto(`/ta/settings?courseId=${COURSE_ID}`);

        await expect(page.locator('#ta-id')).toHaveValue(taId, { timeout: 15_000 });
        await expect(page.locator('#ta-email')).toHaveValue(user.email);
        await expect(page.locator('#permissions-status')).toContainText('Course Access');
        await expect(page.locator('#permissions-status')).toContainText('Allowed');
        await expect(page.locator('#permissions-status')).toContainText('Student Support');
        await expect(page.locator('#permissions-status')).toContainText('Denied');
        await expect(page.locator('#ta-my-courses-link')).toBeVisible();
        await expect(page.locator('#ta-student-support-link')).toBeHidden();
    });
});

test.describe('TA instructor-only guardrails', () => {
    test('authorized TA visiting instructor TA management hub is routed to shared course upload page', async ({ page }) => {
        await seedCourseWithTA();
        await loginViaUI(page);

        await page.goto('/instructor/ta-hub');
        await page.waitForLoadState('domcontentloaded');

        await expect(page).toHaveURL(/\/instructor\/documents/);
    });

    test('TA cannot spoof an instructorId to mutate instructor-only course settings or units', async ({ baseURL }) => {
        const instructorId = await getUserIdByUsername(instructorUser.username);
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

        const apiCtx = await request.newContext({ baseURL });
        await apiCtx.post('/api/auth/login', {
            data: { username: user.username, password },
        });

        const updateRes = await apiCtx.put(`/api/courses/${COURSE_ID}`, {
            data: {
                instructorId,
                name: 'TA Spoofed Course Name',
                status: 'inactive',
            },
            failOnStatusCode: false,
        });
        expect.soft(updateRes.status()).toBe(403);

        const addUnitRes = await apiCtx.post(`/api/courses/${COURSE_ID}/units`, {
            data: { instructorId },
            failOnStatusCode: false,
        });
        expect.soft(addUnitRes.status()).toBe(403);

        const courseAfterAttempts = await withDb((db) =>
            db.collection('courses').findOne({ courseId: COURSE_ID })
        );
        expect.soft(courseAfterAttempts.courseName).toBe(COURSE_NAME);
        expect.soft(courseAfterAttempts.status).toBe('active');
        expect.soft(courseAfterAttempts.lectures).toHaveLength(1);

        await apiCtx.dispose();
    });
});
