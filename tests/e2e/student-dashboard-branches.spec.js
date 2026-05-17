// @ts-check
/**
 * Branch coverage for public/student/scripts/dashboard.js.
 *
 * These tests use the real /student/dashboard.html page and force hard-to-hit
 * API states with Playwright routes. Production code is intentionally untouched.
 */

const fs = require('fs');
const os = require('os');
const path = require('path');

const { test, expect } = require('./fixtures/monocart');
const { storageStatePath } = require('./helpers/users');

// Ephemeral copy of the student storage state for the logout test.
const LOGOUT_STORAGE_STATE = path.join(
    os.tmpdir(),
    `biocbot-student-logout-${process.pid}.json`
);

const STUDENT_ID = 'user_e2e_dashboard_branch_student';
const COURSE_ID = 'BIOC-E2E-DASH-BRANCH';
const COURSE_NAME = 'BIOC E2E Dashboard Branches';

const STUDENT_USER = {
    userId: STUDENT_ID,
    username: 'e2e_dashboard_branch_student',
    displayName: 'Dashboard Branch Student',
    role: 'student',
};

/**
 * @param {import('@playwright/test').Route} route
 * @param {unknown} body
 * @param {number} [status]
 */
function fulfillJson(route, body, status = 200) {
    return route.fulfill({
        status,
        contentType: 'application/json',
        body: JSON.stringify(body),
    });
}

/**
 * @param {import('@playwright/test').Page} page
 * @param {Object} [options]
 * @param {string} [options.courseId]
 * @param {boolean} [options.quizEnabled]
 * @param {unknown} [options.enrollment]
 * @param {unknown} [options.struggle]
 * @param {number} [options.courseStatus]
 * @param {unknown} [options.course]
 * @param {unknown} [options.sessions]
 * @param {unknown} [options.approvedTopics]
 * @param {unknown} [options.resetResult]
 */
async function mockDashboardApis(page, options = {}) {
    const courseId = options.courseId || COURSE_ID;
    const quizEnabled = options.quizEnabled ?? true;
    const enrollment = options.enrollment || {
        success: true,
        data: { courseId, enrolled: true, status: 'enrolled' },
    };
    const struggle = options.struggle || {
        success: true,
        struggleState: { topics: [] },
    };
    const courseStatus = options.courseStatus || 200;
    const course = options.course || {
        success: true,
        data: {
            courseId,
            courseName: COURSE_NAME,
            lectures: [
                { name: 'unit alpha', isPublished: true },
                { name: 'unit beta', displayName: 'Unit Beta', isPublished: false },
            ],
        },
    };
    const sessions = options.sessions || {
        success: true,
        data: { sessions: [] },
    };
    const approvedTopics = options.approvedTopics || {
        success: true,
        data: { topics: ['Glycolysis'] },
    };
    const resetResult = options.resetResult || {
        success: true,
    };

    await page.route('**/api/**', async (route) => {
        const request = route.request();
        const url = new URL(request.url());

        if (url.pathname === '/api/auth/me') {
            return fulfillJson(route, { success: true, user: STUDENT_USER });
        }

        // Important: never let this spec destroy the real server-side session
        // stored in tests/e2e/.auth/student.json.
        if (url.pathname === '/api/auth/logout') {
            return fulfillJson(route, { success: true });
        }

        if (url.pathname === '/api/settings/llm-tag') {
            return fulfillJson(route, { success: false });
        }

        if (url.pathname === '/api/quiz/status') {
            return fulfillJson(route, { success: true, enabled: quizEnabled });
        }

        if (url.pathname === `/api/courses/${courseId}/student-enrollment`) {
            return fulfillJson(route, enrollment);
        }

        if (url.pathname === '/api/student/struggle') {
            return fulfillJson(route, struggle);
        }

        if (url.pathname === '/api/student/struggle/reset') {
            return fulfillJson(route, resetResult);
        }

        if (url.pathname === `/api/courses/${courseId}/approved-topics`) {
            return fulfillJson(route, approvedTopics);
        }

        if (
            url.pathname.startsWith(`/api/students/${courseId}/`) &&
            url.pathname.endsWith('/sessions/own')
        ) {
            return fulfillJson(route, sessions);
        }

        if (url.pathname === `/api/courses/${courseId}`) {
            return fulfillJson(route, course, courseStatus);
        }

        return route.continue();
    });
}

/**
 * @param {import('@playwright/test').Page} page
 * @param {Object} [options]
 * @param {string} [options.courseId]
 * @param {string} [options.courseName]
 * @param {boolean} [options.installAuthShim]
 * @param {unknown} [options.authUser]
 */
async function openDashboard(page, options = {}) {
    const courseId = options.courseId || COURSE_ID;
    const courseName = options.courseName || COURSE_NAME;
    const installAuthShim = options.installAuthShim || false;
    const authUser = options.authUser === undefined ? STUDENT_USER : options.authUser;

    await page.addInitScript(({ courseId, courseName, installAuthShim, authUser, studentUser }) => {
        const testWindow = /** @type {any} */ (window);
        localStorage.clear();
        localStorage.setItem('selectedCourseId', courseId);
        localStorage.setItem('selectedCourseName', courseName);
        localStorage.setItem('currentUser', JSON.stringify(studentUser));
        testWindow.currentUser = studentUser;

        if (installAuthShim) {
            testWindow.__dashboardCheckAuthCalls = 0;
            testWindow.Auth = {
                checkAuth: async () => {
                    testWindow.__dashboardCheckAuthCalls += 1;
                    return authUser;
                },
                logout: () => {
                    testWindow.__dashboardLogoutCalled = true;
                },
            };
        }
    }, { courseId, courseName, installAuthShim, authUser, studentUser: STUDENT_USER });

    await page.goto('/student/dashboard.html');
}

test.describe('Student dashboard branch coverage', () => {
    test.use({ storageState: storageStatePath('student') });

    test('hides quiz nav and renders inactive topic/course-topic fallbacks', async ({ page }) => {
        await mockDashboardApis(page, {
            quizEnabled: false,
            struggle: {
                success: true,
                struggleState: {
                    topics: [
                        {
                            topic: 'respiration',
                            count: 2,
                            isActive: false,
                        },
                    ],
                },
            },
            sessions: {
                success: true,
                data: { sessions: [{}] },
            },
            approvedTopics: {
                success: true,
                data: {
                    topics: ['Glycolysis', { topic: 'Krebs Cycle' }, null],
                },
            },
        });

        await openDashboard(page);

        await expect(page.locator('#quiz-nav-item')).toBeHidden({ timeout: 10_000 });
        await expect(page.locator('#active-topics-count')).toHaveText('0');
        await expect(page.locator('#directive-mode-status')).toHaveText('Inactive');

        const topicCard = page.locator('#topics-list-container .topic-card');
        await expect(topicCard).toHaveCount(1);
        await expect(topicCard.first()).toContainText('Respiration');
        await expect(topicCard.first()).toContainText('Monitoring');
        await expect(topicCard.first()).toContainText('Last: N/A');

        const courseTopic = page.locator('#course-topics-container .topic-item-card');
        await expect(courseTopic).toHaveCount(1);
        await expect(courseTopic.first()).toContainText('Unit alpha');
        await expect(courseTopic.first()).toContainText('Explore');

        await expect.poll(async () => {
            return page.evaluate(() => /** @type {any} */ (window).courseApprovedTopics);
        }, { timeout: 10_000 }).toEqual(['Glycolysis', 'Krebs Cycle']);
    });

    test('shows dashboard error states when struggle and course-topic requests fail', async ({ page }) => {
        await mockDashboardApis(page, {
            quizEnabled: true,
            struggle: {
                success: false,
                message: 'forced struggle failure',
            },
            courseStatus: 403,
            course: {
                success: false,
                message: 'course access denied',
            },
        });

        await openDashboard(page);

        await expect(page.locator('#quiz-nav-item')).toBeVisible({ timeout: 10_000 });
        await expect(page.locator('#topics-list-container')).toContainText(
            'Failed to load topics. Please try again.'
        );
        await expect(page.locator('#course-topics-container')).toContainText(
            'Failed to load course topics.'
        );
    });

    test('shows disabled-access warning when the selected course is inactive', async ({ page }) => {
        await mockDashboardApis(page, {
            enrollment: {
                success: true,
                data: {
                    courseId: COURSE_ID,
                    enrolled: false,
                    status: 'banned',
                },
            },
        });

        await openDashboard(page);

        await expect(page.locator('.dashboard-content')).toBeHidden({ timeout: 10_000 });
        await expect(page.locator('.main-content')).toContainText('Access disabled');
        await expect(page.locator('.main-content')).toContainText('Your access in this course is revoked.');
    });

    test('surfaces reset failure without closing the confirmation modal', async ({ page }) => {
        await mockDashboardApis(page, {
            struggle: {
                success: true,
                struggleState: {
                    topics: [
                        {
                            topic: 'photosynthesis',
                            count: 4,
                            isActive: true,
                            lastStruggle: '2026-01-03T10:00:00.000Z',
                        },
                    ],
                },
            },
            resetResult: {
                success: false,
                message: 'forced reset failure',
            },
        });

        let alertText = '';
        page.on('dialog', async (dialog) => {
            alertText = dialog.message();
            await dialog.accept();
        });

        await openDashboard(page);

        await expect(page.locator('#topics-list-container .topic-card')).toHaveCount(1, {
            timeout: 10_000,
        });
        await page.locator('.reset-btn[data-topic="photosynthesis"]').click();
        await expect(page.locator('#confirm-modal')).toBeVisible();
        await page.locator('#modal-confirm-btn').click();

        await expect.poll(() => alertText, { timeout: 10_000 }).toBe(
            'Failed to reset: forced reset failure'
        );
        await expect(page.locator('#confirm-modal')).toBeVisible();
    });

    test.describe('logout isolation', () => {
        test.use({ storageState: LOGOUT_STORAGE_STATE });

        test.beforeAll(() => {
            fs.copyFileSync(storageStatePath('student'), LOGOUT_STORAGE_STATE);
        });

        test.afterAll(() => {
            if (fs.existsSync(LOGOUT_STORAGE_STATE)) {
                fs.unlinkSync(LOGOUT_STORAGE_STATE);
            }
        });

        test('uses the page Auth shim for auth checks and logout handling', async ({ page }) => {
            await mockDashboardApis(page);
            await openDashboard(page, {
                installAuthShim: true,
                authUser: {
                    ...STUDENT_USER,
                    displayName: 'Injected Dashboard Student',
                },
            });

            await expect.poll(async () => {
                return page.evaluate(() => /** @type {any} */ (window).__dashboardCheckAuthCalls);
            }, { timeout: 10_000 }).toBe(1);

            await page.locator('#logout-btn').click();
            await expect.poll(async () => {
                return page.evaluate(() => /** @type {any} */ (window).__dashboardLogoutCalled === true);
            }).toBe(true);
        });
    });

    test('stops dashboard initialization when page Auth reports no user', async ({ page }) => {
        await mockDashboardApis(page);
        await openDashboard(page, {
            installAuthShim: true,
            authUser: null,
        });

        await expect(page).toHaveURL(/\/login(?:\.html)?$/, { timeout: 10_000 });
        await expect(page.locator('#topics-list-container .topic-card')).toHaveCount(0);
    });
});