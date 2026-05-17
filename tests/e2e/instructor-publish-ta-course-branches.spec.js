// @ts-check

const { test, expect } = require('./fixtures/monocart');
const { storageStatePath } = require('./helpers/users');

const COURSE_ID = 'INSTRUCTOR-BRANCH-WINDOW';
const INSTRUCTOR_ID = 'e2e_instructor_id';
const TA_ID = 'e2e_ta_id';

/**
 * @typedef {Window & Record<string, any>} InstructorWindow
 */

function branchCourse(overrides = {}) {
    const now = new Date('2026-02-03T04:05:06.000Z');
    return {
        courseId: COURSE_ID,
        courseName: 'Instructor Branch Window',
        courseCode: 'BRANCH-STU',
        instructorCourseCode: 'BRANCH-INS',
        instructorId: INSTRUCTOR_ID,
        instructors: [INSTRUCTOR_ID],
        tas: [TA_ID],
        taPermissions: {},
        courseStructure: { weeks: 2, lecturesPerWeek: 1, totalUnits: 2 },
        isOnboardingComplete: true,
        status: 'active',
        approvedStruggleTopics: [],
        lectures: [
            {
                name: 'Unit 1',
                displayName: 'Unit 1',
                isPublished: true,
                learningObjectives: ['Explain enzymes'],
                passThreshold: 1,
                createdAt: now,
                updatedAt: now,
                documents: [],
                assessmentQuestions: [],
            },
            {
                name: 'Unit 2',
                displayName: 'Unit 2',
                isPublished: false,
                learningObjectives: [],
                passThreshold: 0,
                createdAt: now,
                updatedAt: now,
                documents: [],
                assessmentQuestions: [],
            },
        ],
        ...overrides,
    };
}

async function installBranchRoutes(page, options = {}) {
    const role = options.role || 'instructor';
    const userId = role === 'ta' ? TA_ID : INSTRUCTOR_ID;
    const course = options.course || branchCourse();
    const controls = {
        publishMode: 'success',
        publishStatusMode: 'normal',
        retrievalSaveMode: 'success',
        taCourses: [{ courseId: COURSE_ID, courseName: course.courseName }],
        taPermissions: { canAccessCourses: true, canAccessFlags: true },
        instructorCourses: [course],
        courseByIdStatus: 200,
        publishCalls: 0,
        publishStatusCalls: 0,
    };
    Object.assign(controls, options.controls || {});

    await page.route('**/api/**', async (route) => {
        const request = route.request();
        const url = new URL(request.url());
        const pathname = url.pathname;
        const method = request.method();

        if (pathname === '/api/settings/llm-tag') {
            await route.fulfill({ json: { success: true, llmIndex: 0, reasoningIndex: 0 } });
            return;
        }

        if (pathname === '/api/auth/me') {
            await route.fulfill({
                json: {
                    success: true,
                    user: {
                        userId,
                        username: role === 'ta' ? 'e2e_ta' : 'e2e_instructor',
                        displayName: role === 'ta' ? 'Branch TA' : 'Branch Instructor',
                        role,
                        preferences: options.userPreferences || {},
                    },
                },
            });
            return;
        }

        if (pathname === `/api/onboarding/${COURSE_ID}`) {
            await route.fulfill({ json: { success: true, data: course } });
            return;
        }

        if (pathname === `/api/onboarding/instructor/${INSTRUCTOR_ID}`) {
            await route.fulfill({ json: { success: true, data: { courses: controls.instructorCourses } } });
            return;
        }

        if (pathname === `/api/courses/ta/${TA_ID}`) {
            await route.fulfill({ json: { success: true, data: controls.taCourses } });
            return;
        }

        if (pathname === `/api/courses/ta/${INSTRUCTOR_ID}`) {
            await route.fulfill({ json: { success: true, data: controls.taCourses } });
            return;
        }

        if (pathname === `/api/courses/${COURSE_ID}/ta-permissions/${TA_ID}`) {
            await route.fulfill({
                json: {
                    success: true,
                    data: { permissions: controls.taPermissions },
                },
            });
            return;
        }

        if (pathname === `/api/courses/${COURSE_ID}/ta-permissions/${INSTRUCTOR_ID}`) {
            await route.fulfill({
                json: {
                    success: true,
                    data: { permissions: controls.taPermissions },
                },
            });
            return;
        }

        if (pathname === `/api/courses/${COURSE_ID}` && method === 'GET') {
            if (controls.courseByIdStatus !== 200) {
                await route.fulfill({ status: controls.courseByIdStatus, body: 'course unavailable' });
                return;
            }
            await route.fulfill({ json: { success: true, data: course } });
            return;
        }

        if (pathname === `/api/courses/${COURSE_ID}/retrieval-mode` && method === 'PUT') {
            if (controls.retrievalSaveMode === 'fail') {
                await route.fulfill({ status: 500, json: { success: false, message: 'save failed' } });
                return;
            }
            await route.fulfill({ json: { success: true, data: request.postDataJSON() } });
            return;
        }

        if (pathname === '/api/lectures/publish-status') {
            controls.publishStatusCalls += 1;
            if (controls.publishStatusMode === 'fail') {
                await route.fulfill({ status: 500, body: 'publish status unavailable' });
                return;
            }
            const publishStatus = controls.publishStatusMode === 'external-change'
                ? { 'Unit 1': false, 'Unit 2': false }
                : { 'Unit 1': true, 'Unit 2': false };
            await route.fulfill({ json: { success: true, data: { publishStatus } } });
            return;
        }

        if (pathname === '/api/lectures/publish') {
            controls.publishCalls += 1;
            if (controls.publishMode === 'http-error-once') {
                controls.publishMode = 'success';
                await route.fulfill({ status: 409, json: { success: false, message: 'publish conflict' } });
                return;
            }
            if (controls.publishMode === 'result-error-once') {
                controls.publishMode = 'success';
                await route.fulfill({ json: { success: false, message: 'publish rejected' } });
                return;
            }
            await route.fulfill({ json: { success: true, message: 'Publish updated', data: request.postDataJSON() } });
            return;
        }

        if (pathname === '/api/learning-objectives') {
            await route.fulfill({ json: { success: true, data: { objectives: ['Explain enzymes'] } } });
            return;
        }

        if (pathname === '/api/questions/lecture') {
            await route.fulfill({ json: { success: true, data: { questions: [] } } });
            return;
        }

        if (pathname === '/api/lectures/pass-threshold') {
            await route.fulfill({ json: { success: true, data: { passThreshold: 0 } } });
            return;
        }

        await route.fulfill({ json: { success: true, data: {} } });
    });

    return controls;
}

async function seedPublishToggleHarness(page, checked = true) {
    await page.evaluate((isChecked) => {
        let accordion = document.querySelector('.accordion-item[data-unit-name="Unit 1"]');
        if (!accordion) {
            accordion = document.createElement('div');
            accordion.className = 'accordion-item';
            accordion.setAttribute('data-unit-name', 'Unit 1');
            document.body.appendChild(accordion);
        }
        accordion.classList.toggle('published', isChecked);
        let toggle = /** @type {HTMLInputElement | null} */ (document.getElementById('publish-unit1'));
        if (!toggle) {
            const wrapper = document.createElement('div');
            wrapper.className = 'publish-toggle';
            wrapper.innerHTML = '<input id="publish-unit1" type="checkbox">';
            accordion.appendChild(wrapper);
            toggle = /** @type {HTMLInputElement} */ (document.getElementById('publish-unit1'));
        }
        toggle.checked = isChecked;
    }, checked);
}

async function openInstructorDocuments(page, options = {}) {
    const controls = await installBranchRoutes(page, options);
    await page.goto(`/instructor/documents?courseId=${COURSE_ID}`);
    await expect(page.locator('#course-title')).toHaveText('Instructor Branch Window', { timeout: 15_000 });
    await page.waitForFunction(() => {
        const instructorWindow = /** @type {InstructorWindow} */ (window);
        return [
            'addContentToWeek',
            'updatePublishStatus',
            'loadPublishStatus',
            'startPublishStatusPolling',
            'stopPublishStatusPolling',
        ].every((name) => typeof instructorWindow[name] === 'function');
    });
    return controls;
}

async function openInstructorSettings(page, options = {}) {
    const controls = await installBranchRoutes(page, options);
    await page.goto(`/instructor/settings?courseId=${options.withCourseParam === false ? '' : COURSE_ID}`);
    await page.waitForFunction(() => {
        const instructorWindow = /** @type {InstructorWindow} */ (window);
        return typeof instructorWindow.showNotification === 'function';
    });
    return controls;
}

test.describe('instructor publish, TA, course, and polling branches', () => {
    test.use({ storageState: storageStatePath('instructor') });

    test('renders no action buttons when content has no document id', async ({ page }) => {
        await openInstructorDocuments(page);

        const buttonCount = await page.evaluate(() => {
            const instructorWindow = /** @type {InstructorWindow} */ (window);
            const accordion = document.createElement('div');
            accordion.className = 'accordion-item';
            accordion.dataset.unitName = 'Harness Unit';
            accordion.innerHTML = '<div class="course-materials-section"><div class="section-content"></div></div>';
            document.body.appendChild(accordion);

            instructorWindow.addContentToWeek('Harness Unit', 'Orphan material', 'No id available', null, 'processed', 'additional');
            return accordion.querySelectorAll('.action-button').length;
        });

        expect(buttonCount).toBe(0);
        await expect(page.locator('.accordion-item[data-unit-name="Harness Unit"] .status-text')).toHaveText('Processed');
    });

    test('reverts published toggle when publish request returns an HTTP error', async ({ page }) => {
        const controls = await openInstructorDocuments(page, { controls: { publishMode: 'http-error-once' } });
        await seedPublishToggleHarness(page, true);

        await page.evaluate(async () => {
            const instructorWindow = /** @type {InstructorWindow} */ (window);
            const toggle = /** @type {HTMLInputElement} */ (document.getElementById('publish-unit1'));
            toggle.checked = false;
            await instructorWindow.updatePublishStatus('Unit 1', false);
        });

        await expect(page.locator('#publish-unit1')).toBeChecked();
        await expect(page.locator('.accordion-item[data-unit-name="Unit 1"]')).toHaveClass(/published/);
        await expect(page.locator('.notification').filter({ hasText: 'publish conflict' })).toBeVisible();
        expect(controls.publishCalls).toBeGreaterThanOrEqual(1);
    });

    test('reverts published toggle when publish response reports failure', async ({ page }) => {
        await openInstructorDocuments(page, { controls: { publishMode: 'result-error-once' } });
        await seedPublishToggleHarness(page, true);

        await page.evaluate(async () => {
            const instructorWindow = /** @type {InstructorWindow} */ (window);
            const toggle = /** @type {HTMLInputElement} */ (document.getElementById('publish-unit1'));
            toggle.checked = false;
            await instructorWindow.updatePublishStatus('Unit 1', false);
        });

        await expect(page.locator('#publish-unit1')).toBeChecked();
        await expect(page.locator('.notification').filter({ hasText: 'Failed to update publish status' })).toBeVisible();
    });

    test('shows warning when publish status request fails', async ({ page }) => {
        const controls = await openInstructorDocuments(page);
        await page.evaluate(() => {
            const instructorWindow = /** @type {InstructorWindow} */ (window);
            return instructorWindow.loadPublishStatus(false);
        });

        controls.publishStatusMode = 'fail';

        await page.evaluate(async () => {
            const instructorWindow = /** @type {InstructorWindow} */ (window);
            await instructorWindow.loadPublishStatus(false);
        });

        await expect(page.locator('.notification').filter({ hasText: 'Error loading publish status' })).toBeVisible();
    });

    test('announces external publish changes when loaded status differs', async ({ page }) => {
        const controls = await openInstructorDocuments(page);
        await seedPublishToggleHarness(page, true);
        controls.publishStatusMode = 'external-change';

        await page.evaluate(async () => {
            const instructorWindow = /** @type {InstructorWindow} */ (window);
            const toggle = /** @type {HTMLInputElement} */ (document.getElementById('publish-unit1'));
            toggle.checked = true;
            await instructorWindow.loadPublishStatus(false);
        });

        await expect(page.locator('#publish-unit1')).not.toBeChecked();
        await expect(page.locator('.notification').filter({ hasText: 'Publish status updated by another user' })).toBeVisible();
    });

    test('disables retrieval toggle when no course context exists', async ({ page }) => {
        await openInstructorSettings(page, {
            withCourseParam: false,
            controls: { instructorCourses: [] },
        });

        await expect(page.locator('#additive-retrieval-toggle')).toBeDisabled();
    });

    test('restores retrieval toggle when save fails', async ({ page }) => {
        await openInstructorSettings(page, {
            controls: { retrievalSaveMode: 'fail' },
        });

        const toggle = page.locator('#additive-retrieval-toggle');
        await expect(toggle).not.toBeChecked();
        await toggle.evaluate((element) => {
            const input = /** @type {HTMLInputElement} */ (element);
            input.checked = true;
            input.dispatchEvent(new Event('change', { bubbles: true }));
        });

        await expect(toggle).not.toBeChecked();
        await expect(page.locator('.notification').filter({ hasText: 'Failed to update retrieval mode' })).toBeVisible();
    });

    test('skips polling when no document accordions exist', async ({ page }) => {
        await openInstructorDocuments(page);

        const intervalCalls = await page.evaluate(() => {
            const instructorWindow = /** @type {InstructorWindow} */ (window);
            document.querySelectorAll('.accordion-item').forEach((item) => item.remove());
            let calls = 0;
            const originalSetInterval = window.setInterval;
            window.setInterval = /** @type {any} */ (() => {
                calls += 1;
                return 101;
            });
            instructorWindow.startPublishStatusPolling();
            window.setInterval = originalSetInterval;
            return calls;
        });

        expect(intervalCalls).toBe(0);
    });

    test('clears existing publish poller before starting a new poller', async ({ page }) => {
        await openInstructorDocuments(page);

        const clearCalls = await page.evaluate(() => {
            const instructorWindow = /** @type {InstructorWindow} */ (window);
            let clearCount = 0;
            const originalSetInterval = window.setInterval;
            const originalClearInterval = window.clearInterval;
            window.setInterval = /** @type {any} */ (() => 202);
            window.clearInterval = /** @type {any} */ (() => {
                clearCount += 1;
            });
            instructorWindow.startPublishStatusPolling();
            instructorWindow.startPublishStatusPolling();
            window.setInterval = originalSetInterval;
            window.clearInterval = originalClearInterval;
            return clearCount;
        });

        expect(clearCalls).toBe(1);
    });

    test('stops active publish polling interval', async ({ page }) => {
        await openInstructorDocuments(page);

        const clearCalls = await page.evaluate(() => {
            const instructorWindow = /** @type {InstructorWindow} */ (window);
            let clearCount = 0;
            const originalSetInterval = window.setInterval;
            const originalClearInterval = window.clearInterval;
            window.setInterval = /** @type {any} */ (() => 303);
            window.clearInterval = /** @type {any} */ (() => {
                clearCount += 1;
            });
            instructorWindow.startPublishStatusPolling();
            instructorWindow.stopPublishStatusPolling();
            window.setInterval = originalSetInterval;
            window.clearInterval = originalClearInterval;
            return clearCount;
        });

        expect(clearCalls).toBe(1);
    });

    test('hides TA links when permissions deny access', async ({ page }) => {
        await openInstructorDocuments(page, {
            controls: {
                taPermissions: { canAccessCourses: false, canAccessFlags: false },
            },
        });

        await page.evaluate(async () => {
            const instructorWindow = /** @type {InstructorWindow} */ (window);
            ['ta-my-courses-link', 'ta-student-support-link'].forEach((id) => {
                if (!document.getElementById(id)) {
                    const link = document.createElement('a');
                    link.id = id;
                    link.href = '#';
                    link.style.display = 'block';
                    document.body.appendChild(link);
                }
            });
            localStorage.setItem('selectedCourseId', 'INSTRUCTOR-BRANCH-WINDOW');
            await instructorWindow.updateTANavigationBasedOnPermissions();
        });

        await expect(page.locator('#ta-my-courses-link')).toHaveCSS('display', 'none');
        await expect(page.locator('#ta-student-support-link')).toHaveCSS('display', 'none');
    });

    test('alerts when TA support has no selected course', async ({ page }) => {
        await openInstructorDocuments(page, {
            controls: {
                taCourses: [],
                taPermissions: { canAccessCourses: true, canAccessFlags: true },
            },
        });

        let alertMessage = '';
        page.on('dialog', async (dialog) => {
            alertMessage = dialog.message();
            await dialog.accept();
        });

        await page.evaluate(async () => {
            const instructorWindow = /** @type {InstructorWindow} */ (window);
            const testWindow = /** @type {any} */ (window);
            if (!document.getElementById('ta-student-support-link')) {
                const link = document.createElement('a');
                link.id = 'ta-student-support-link';
                link.href = '#';
                document.body.appendChild(link);
            }
            instructorWindow.setupTANavigationHandlers();
            window.history.replaceState({}, '', '/instructor/documents');
            localStorage.removeItem('selectedCourseId');
            testWindow.taCourses = [];
            testWindow.getCurrentCourseId = async () => null;
            document.getElementById('ta-student-support-link')?.dispatchEvent(new MouseEvent('click', { bubbles: true, cancelable: true }));
            await new Promise((resolve) => setTimeout(resolve, 0));
        });

        expect(alertMessage).toBe('No course selected. Please try again.');
    });
});
