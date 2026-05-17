// @ts-check
/**
 * Focused branch coverage for public/student/scripts/student.js lines 2623-3838.
 *
 * This window owns new-session handling, flag submission, course selection,
 * course loading/display fallbacks, and small identity helpers.
 */

const { test, expect } = require('./fixtures/monocart');
const { TEST_USERS, storageStatePath } = require('./helpers/users');

/** @typedef {import('@playwright/test').Page} Page */
/** @typedef {import('@playwright/test').Route} Route */

const COURSE_ID = 'BIOC-E2E-STUDENT-SESSION-BRANCHES';
const COURSE_NAME = 'BIOC E2E Session Branches';
const SECOND_COURSE_ID = 'BIOC-E2E-STUDENT-SESSION-BRANCHES-2';
const STUDENT_ID = 'user_e2e_student_session_branches';

test.use({ storageState: storageStatePath('student') });

function chatData() {
    return {
        metadata: {
            courseId: COURSE_ID,
            courseName: COURSE_NAME,
            studentId: STUDENT_ID,
            studentName: TEST_USERS.student.displayName,
            unitName: 'Unit 1',
            currentMode: 'tutor',
            totalMessages: 1,
            version: '1.0',
        },
        messages: [
            {
                type: 'bot',
                content: 'seeded branch chat',
                messageType: 'regular-chat',
                timestamp: new Date().toISOString(),
            },
        ],
        practiceTests: null,
        studentAnswers: { answers: [] },
        sessionInfo: {
            sessionId: 'e2e_session_branches',
            startTime: new Date().toISOString(),
            duration: '0 minutes',
        },
        lastActivityTimestamp: new Date().toISOString(),
    };
}

function courseDoc(overrides = {}) {
    return {
        courseId: COURSE_ID,
        courseName: COURSE_NAME,
        name: COURSE_NAME,
        status: 'active',
        lectures: [
            {
                name: 'Unit 1',
                displayName: 'Unit 1',
                isPublished: true,
                passThreshold: 0,
                documents: [],
                assessmentQuestions: [],
            },
        ],
        ...overrides,
    };
}

/**
 * @param {Page} page
 * @param {Object} [options]
 * @param {boolean} [options.seedSelectedCourse]
 * @param {boolean} [options.seedCourseName]
 * @returns {Promise<{
 *   calls: string[],
 *   alerts: string[],
 *   prompts: string[],
 *   setAvailableCourses: (value: Object) => void,
 *   setAuthResponse: (value: Object) => void,
 *   setCourseResponse: (value: Object) => void,
 *   setFlagResponse: (value: Object) => void,
 *   setJoinResponse: (value: Object) => void,
 * }>}
 */
async function openStudentWithMocks(page, options = {}) {
    const calls = /** @type {string[]} */ ([]);
    const alerts = /** @type {string[]} */ ([]);
    const prompts = /** @type {string[]} */ ([]);
    let availableCourses = {
        success: true,
        data: [{ courseId: COURSE_ID, courseName: COURSE_NAME, isEnrolled: true }],
    };
    let authResponse = {
        status: 200,
        body: {
            success: true,
            user: {
                userId: STUDENT_ID,
                username: TEST_USERS.student.username,
                role: 'student',
                displayName: TEST_USERS.student.displayName,
                preferences: {},
            },
        },
    };
    let courseResponse = { status: 200, body: { success: true, data: courseDoc() } };
    let flagResponse = { status: 500, body: { success: false } };
    let joinResponse = { status: 200, body: { success: true } };
    const seedSelectedCourse = options.seedSelectedCourse !== false;
    const seedCourseName = options.seedCourseName !== false;
    const seededChat = chatData();

    await page.route('**/api/**', async (route) => {
        calls.push(new URL(route.request().url()).pathname + new URL(route.request().url()).search);
        await fulfillApi(route, { availableCourses, authResponse, courseResponse, flagResponse, joinResponse });
    });

    await page.exposeFunction('__recordStudentSessionAlert', (message) => {
        alerts.push(String(message));
    });
    await page.exposeFunction('__recordStudentSessionPrompt', (message) => {
        prompts.push(String(message));
    });

    await page.addInitScript(({ seedSelectedCourse, seedCourseName, seededChat }) => {
        const testWindow = /** @type {any} */ (window);
        localStorage.clear();
        sessionStorage.clear();
        localStorage.setItem('studentMode', 'tutor');
        testWindow.__studentSessionPromptValue = 'JOIN-CODE';
        testWindow.__studentSessionConfirmValue = true;
        window.prompt = (message) => {
            testWindow.__recordStudentSessionPrompt(String(message));
            return testWindow.__studentSessionPromptValue;
        };
        window.alert = (message) => {
            testWindow.__recordStudentSessionAlert(String(message));
        };
        window.confirm = () => testWindow.__studentSessionConfirmValue;

        if (seedSelectedCourse) {
            localStorage.setItem('selectedCourseId', seededChat.metadata.courseId);
            localStorage.setItem('selectedUnitName', seededChat.metadata.unitName);
            if (seedCourseName) {
                localStorage.setItem('selectedCourseName', seededChat.metadata.courseName);
            }
            localStorage.setItem(`biocbot_current_chat_${seededChat.metadata.studentId}`, JSON.stringify(seededChat));
            localStorage.setItem(
                `biocbot_session_${seededChat.metadata.studentId}_${seededChat.metadata.courseId}_${seededChat.metadata.unitName}`,
                seededChat.sessionInfo.sessionId
            );
        }
    }, { seedSelectedCourse, seedCourseName, seededChat });

    await page.goto('/student');
    await page.waitForFunction(() => {
        const w = /** @type {any} */ (window);
        return typeof w.loadAvailableCourses === 'function' &&
            typeof w.submitFlag === 'function' &&
            typeof w.addChangeCourseButton === 'function';
    });

    return {
        calls,
        alerts,
        prompts,
        setAvailableCourses(value) {
            availableCourses = value;
        },
        setAuthResponse(value) {
            authResponse = value;
        },
        setCourseResponse(value) {
            courseResponse = value;
        },
        setFlagResponse(value) {
            flagResponse = value;
        },
        setJoinResponse(value) {
            joinResponse = value;
        },
    };
}

/**
 * @param {Route} route
 * @param {{ availableCourses: Object, authResponse: Object, courseResponse: Object, flagResponse: Object, joinResponse: Object }} state
 */
async function fulfillApi(route, state) {
    const request = route.request();
    const url = new URL(request.url());
    const pathname = url.pathname;

    if (pathname === '/api/auth/me') {
        if (state.authResponse.abort) {
            await route.abort('failed');
            return;
        }
        await route.fulfill({
            status: Number(state.authResponse.status || 200),
            contentType: 'application/json',
            body: JSON.stringify(state.authResponse.body || state.authResponse),
        });
        return;
    }

    if (pathname === '/api/user-agreement/status') {
        await route.fulfill({ json: { success: true, data: { hasAgreed: true, agreementVersion: '1.0' } } });
        return;
    }

    if (pathname === '/api/settings/llm-tag') {
        await route.fulfill({ json: { success: true, llmIndex: null, reasoningIndex: null } });
        return;
    }

    if (pathname === '/api/quiz/status') {
        await route.fulfill({ json: { success: true, enabled: false } });
        return;
    }

    if (pathname === `/api/courses/${COURSE_ID}/student-enrollment`) {
        await route.fulfill({ json: { success: true, data: { enrolled: true, status: 'active' } } });
        return;
    }

    if (pathname === `/api/courses/${COURSE_ID}` || pathname === `/api/courses/${SECOND_COURSE_ID}`) {
        const status = Number(state.courseResponse.status || 200);
        await route.fulfill({
            status,
            contentType: 'application/json',
            body: JSON.stringify(state.courseResponse.body || {}),
        });
        return;
    }

    if (pathname === '/api/courses/available/all') {
        const status = Number(state.availableCourses.status || 200);
        await route.fulfill({
            status,
            contentType: 'application/json',
            body: JSON.stringify(state.availableCourses.body || state.availableCourses),
        });
        return;
    }

    if (pathname === `/api/courses/${SECOND_COURSE_ID}/join`) {
        if (state.joinResponse.abort) {
            await route.abort('failed');
            return;
        }
        await route.fulfill({
            status: Number(state.joinResponse.status || 200),
            contentType: 'application/json',
            body: JSON.stringify(state.joinResponse.body || state.joinResponse),
        });
        return;
    }

    if (pathname === '/api/questions/lecture') {
        await route.fulfill({ json: { success: true, data: { questions: [] } } });
        return;
    }

    if (pathname === '/api/student/struggle') {
        await route.fulfill({ json: { success: true, struggleState: { topics: [] } } });
        return;
    }

    if (pathname === '/api/chat/save') {
        await route.fulfill({ json: { success: true } });
        return;
    }

    if (pathname === '/api/flags') {
        await route.fulfill({
            status: Number(state.flagResponse.status || 200),
            contentType: 'application/json',
            body: JSON.stringify(state.flagResponse.body || state.flagResponse),
        });
        return;
    }

    if (pathname === '/api/flags/count') {
        await route.fulfill({ json: { success: true, count: 0, data: [] } });
        return;
    }

    await route.fulfill({ json: { success: true, data: {} } });
}

test('starts a new session with a fetched course name and closes the notification', async ({ page }) => {
    await openStudentWithMocks(page, { seedCourseName: false });
    await expect(page.locator('#chat-messages')).toContainText('seeded branch chat', { timeout: 10_000 });

    await page.evaluate(() => localStorage.removeItem('selectedCourseName'));
    await page.locator('#new-session-btn').click();

    const notification = page.locator('.notification.info').filter({ hasText: 'New chat session started' });
    await expect(notification).toBeVisible({ timeout: 5_000 });
    await expect.poll(() => page.evaluate(() => localStorage.getItem('selectedCourseName'))).toBe(COURSE_NAME);

    await notification.locator('.notification-close').click();
    await expect(notification).toHaveCount(0);
});

test('auto-removes the new-session notification after its timeout', async ({ page }) => {
    await openStudentWithMocks(page);

    await page.evaluate(() => {
        document.querySelector('.notification-container')?.remove();
        const w = /** @type {any} */ (window);
        w.showNewSessionNotification();
    });

    await expect(page.locator('.notification.info')).toContainText('New chat session started');
    await expect(page.locator('.notification.info')).toHaveCount(0, { timeout: 4_000 });
});

test('formats timestamps across elapsed-time buckets', async ({ page }) => {
    await openStudentWithMocks(page);

    const labels = await page.evaluate(() => {
        const w = /** @type {any} */ (window);
        const now = Date.now();
        return [
            w.formatTimestamp(new Date(now - 2 * 60 * 1000)),
            w.formatTimestamp(new Date(now - 2 * 60 * 60 * 1000)),
            w.formatTimestamp(new Date(now - 2 * 24 * 60 * 60 * 1000)),
            w.formatTimestamp(new Date(now - 10 * 24 * 60 * 60 * 1000)),
        ];
    });

    expect(labels[0]).toBe('2 minutes ago');
    expect(labels[1]).toBe('2 hours ago');
    expect(labels[2]).toBe('2 days ago');
    expect(labels[3]).toMatch(/^\w{3} \d{1,2}, /);
});

test('submits flag failures without removing the user-facing thank-you state', async ({ page }) => {
    await openStudentWithMocks(page);

    const message = page.locator('.bot-message').first();
    await expect(message).toContainText('seeded branch chat');
    await expect(message.locator('.flag-button')).toBeVisible();
    await message.locator('.flag-button').click();
    await message.locator('.flag-option', { hasText: 'Incorrect' }).evaluate((element) => {
        /** @type {HTMLElement} */ (element).click();
    });

    await expect(message).toContainText('Thank you for reporting this response as incorrect information');
    await expect(message.locator('.message-flag-container')).toHaveCount(0);
    await expect(message.locator('.timestamp')).toHaveText('Flagged just now');
});

test('successful flag submission schedules flag refresh', async ({ page }) => {
    const harness = await openStudentWithMocks(page);
    harness.setFlagResponse({ status: 200, body: { success: true } });

    await page.evaluate(() => {
        const w = /** @type {any} */ (window);
        w.__studentSessionFlagRefreshes = 0;
        w.checkForFlagUpdates = () => {
            w.__studentSessionFlagRefreshes += 1;
        };
        return w.submitFlag('Flag refresh branch response', 'unclear');
    });

    await expect.poll(() => page.evaluate(() => /** @type {any} */ (window).__studentSessionFlagRefreshes)).toBe(1);
});

test('course join dropdown handles failed join, network error, and prompt cancel', async ({ page }) => {
    const harness = await openStudentWithMocks(page);

    async function renderJoinDropdown() {
        await page.evaluate((secondCourseId) => {
            const w = /** @type {any} */ (window);
            w.showCourseSelection([
                { courseId: secondCourseId, courseName: 'Join Target', isEnrolled: false },
            ]);
        }, SECOND_COURSE_ID);
        await expect(page.locator('#course-select')).toBeVisible();
    }

    harness.setJoinResponse({ status: 200, body: { success: false, message: 'Bad join code' } });
    await renderJoinDropdown();
    await page.evaluate(() => {
        const w = /** @type {any} */ (window);
        w.__studentSessionPromptValue = 'BAD-CODE';
    });
    await page.locator('#course-select').selectOption(SECOND_COURSE_ID);
    await expect.poll(() => harness.alerts.includes('Bad join code')).toBe(true);
    await expect(page.locator('#course-select')).toHaveValue('');

    harness.setJoinResponse({ abort: true });
    await renderJoinDropdown();
    await page.evaluate(() => {
        const w = /** @type {any} */ (window);
        w.__studentSessionPromptValue = 'NETWORK-CODE';
    });
    await page.locator('#course-select').selectOption(SECOND_COURSE_ID);
    await expect.poll(() => harness.alerts.includes('Error joining course. Please try again.')).toBe(true);

    await renderJoinDropdown();
    await page.evaluate(() => {
        const w = /** @type {any} */ (window);
        w.__studentSessionPromptValue = null;
    });
    await page.locator('#course-select').selectOption(SECOND_COURSE_ID);
    await expect(page.locator('#course-select')).toHaveValue('');
    expect(harness.prompts.length).toBeGreaterThanOrEqual(3);
});

test('loadAvailableCourses renders no-courses and fetch-error empty states', async ({ page }) => {
    const harness = await openStudentWithMocks(page, { seedSelectedCourse: false });

    harness.setAvailableCourses({ success: true, data: [] });
    await page.evaluate(() => {
        const w = /** @type {any} */ (window);
        return w.loadAvailableCourses();
    });
    await expect(page.locator('#chat-messages')).toContainText('No Courses Available');

    harness.setAvailableCourses({ status: 500, body: { success: false, message: 'Nope' } });
    await page.evaluate(() => {
        document.getElementById('chat-messages').innerHTML = '';
        const w = /** @type {any} */ (window);
        return w.loadAvailableCourses();
    });
    await expect(page.locator('#chat-messages')).toContainText('No Courses Available');
});

test('loadCourseData clears a 404 selection and renders load errors for invalid course payloads', async ({ page }) => {
    const harness = await openStudentWithMocks(page);

    harness.setCourseResponse({ status: 404, body: { success: false, message: 'missing' } });
    await page.evaluate((courseId) => {
        localStorage.setItem('selectedCourseId', courseId);
        const w = /** @type {any} */ (window);
        return w.loadCourseData(courseId);
    }, COURSE_ID);
    await expect.poll(() => page.evaluate(() => localStorage.getItem('selectedCourseId'))).toBeNull();

    harness.setCourseResponse({ status: 200, body: { success: false } });
    await page.evaluate((courseId) => {
        document.getElementById('chat-messages').innerHTML = '';
        const w = /** @type {any} */ (window);
        return w.loadCourseData(courseId);
    }, COURSE_ID);
    await expect(page.locator('#chat-messages')).toContainText('Error Loading Course');
});

test('confirmed change-course clears selected course and reloads the selector', async ({ page }) => {
    await openStudentWithMocks(page);

    await page.evaluate(() => {
        const w = /** @type {any} */ (window);
        w.addChangeCourseButton();
        w.__studentSessionConfirmValue = true;
    });
    await expect(page.locator('#change-course-btn')).toHaveCount(1);

    await page.locator('#change-course-btn').click();
    await expect.poll(() => page.evaluate(() => localStorage.getItem('selectedCourseId'))).toBeNull();
    await expect(page.locator('#change-course-btn')).toHaveCount(0);
    await expect(page.locator('#course-select')).toBeVisible();
});

test('current student id falls back to a generated session id when auth helper throws', async ({ page }) => {
    await openStudentWithMocks(page);

    const generated = await page.evaluate(() => {
        const w = /** @type {any} */ (window);
        w.getCurrentUser = () => {
            throw new Error('auth unavailable');
        };
        sessionStorage.removeItem('sessionId');
        return w.getCurrentStudentId();
    });

    expect(generated).toMatch(/^session_\d+_/);
    await expect.poll(() => page.evaluate(() => sessionStorage.getItem('sessionId'))).toBe(generated);
});

test('student name falls back when the auth request fails', async ({ page }) => {
    const harness = await openStudentWithMocks(page);
    harness.setAuthResponse({ abort: true });

    await expect.poll(() => page.evaluate(() => {
        const w = /** @type {any} */ (window);
        return w.getCurrentStudentName();
    })).toBe('Student Name');
});

test('current course id follows preferences, storage, course list, and error fallbacks', async ({ page }) => {
    const harness = await openStudentWithMocks(page, { seedSelectedCourse: false });

    harness.setAuthResponse({
        status: 200,
        body: {
            success: true,
            user: { preferences: { courseId: SECOND_COURSE_ID } },
        },
    });
    await expect.poll(() => page.evaluate(() => {
        const w = /** @type {any} */ (window);
        return w.getCurrentCourseId();
    })).toBe(SECOND_COURSE_ID);

    harness.setAuthResponse({ status: 200, body: { success: true, user: { preferences: {} } } });
    await page.evaluate((courseId) => localStorage.setItem('selectedCourseId', courseId), COURSE_ID);
    await expect.poll(() => page.evaluate(() => {
        const w = /** @type {any} */ (window);
        return w.getCurrentCourseId();
    })).toBe(COURSE_ID);

    await page.evaluate(() => localStorage.removeItem('selectedCourseId'));
    harness.setAvailableCourses({ success: true, data: [{ courseId: SECOND_COURSE_ID, courseName: 'Single Course' }] });
    await expect.poll(() => page.evaluate(() => {
        const w = /** @type {any} */ (window);
        return w.getCurrentCourseId();
    })).toBe(SECOND_COURSE_ID);

    await page.evaluate(() => localStorage.removeItem('selectedCourseId'));
    harness.setAvailableCourses({
        success: true,
        data: [
            { courseId: COURSE_ID, courseName: COURSE_NAME },
            { courseId: SECOND_COURSE_ID, courseName: 'Second Course' },
        ],
    });
    await expect.poll(() => page.evaluate(() => {
        const w = /** @type {any} */ (window);
        return w.getCurrentCourseId();
    })).toBeNull();

    harness.setAvailableCourses({ status: 500, body: { success: false } });
    await expect.poll(() => page.evaluate(() => {
        const w = /** @type {any} */ (window);
        return w.getCurrentCourseId();
    })).toBeNull();
});
