// @ts-check
const { test, expect } = require('./fixtures/monocart');
const { storageStatePath } = require('./helpers/users');

const COURSE_ID = 'HOME-BRANCH-MISSING';
const INSTRUCTOR_ID = 'e2e_instructor_id';

test.use({ storageState: storageStatePath('instructor') });

function completeLecture(name = 'Unit 1') {
    return {
        name,
        learningObjectives: [`Understand ${name}`],
        documents: [
            { documentId: `${name}-notes`, documentType: 'lecture_notes' },
            { documentId: `${name}-practice`, documentType: 'tutorial' },
        ],
        assessmentQuestions: [],
    };
}

function missingLecture(name = 'Unit & Missing') {
    return {
        name,
        learningObjectives: [],
        documents: [],
        assessmentQuestions: [],
    };
}

function courseDoc(overrides = {}) {
    return {
        courseId: COURSE_ID,
        courseName: 'Branch Missing Content Biology',
        courseCode: 'BRSTU',
        instructorCourseCode: 'BRINS',
        instructorId: INSTRUCTOR_ID,
        instructors: [INSTRUCTOR_ID],
        tas: [],
        approvedStruggleTopics: [],
        isOnboardingComplete: true,
        status: 'active',
        lectures: [completeLecture()],
        ...overrides,
    };
}

async function installHomeRoutes(page, options = {}) {
    const baseCourse = options.course || courseDoc();
    const courseResponses = options.courseResponses || [
        { status: 200, body: { success: true, data: baseCourse } },
    ];
    let courseRequestCount = 0;

    await page.route('**/chart.umd.min.js', (route) =>
        route.fulfill({
            contentType: 'application/javascript',
            body: 'window.Chart = class { constructor() {} destroy() {} };',
        })
    );

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
                        userId: INSTRUCTOR_ID,
                        username: 'e2e_instructor',
                        displayName: 'Branch Instructor',
                        role: 'instructor',
                        permissions: { systemAdmin: true },
                    },
                },
            });
            return;
        }

        if (pathname === `/api/onboarding/instructor/${INSTRUCTOR_ID}`) {
            await route.fulfill({ json: { success: true, data: { courses: [baseCourse] } } });
            return;
        }

        if (pathname === '/api/settings/can-delete-all') {
            await route.fulfill({ json: { success: true, canDeleteAll: false } });
            return;
        }

        if (pathname === '/api/courses/available/all') {
            await route.fulfill({ json: { success: true, data: [baseCourse] } });
            return;
        }

        if (pathname === '/api/courses/available/joinable') {
            await route.fulfill({ json: { success: true, data: [] } });
            return;
        }

        if (pathname === '/api/courses/statistics') {
            await route.fulfill({
                json: {
                    success: true,
                    data: {
                        totalStudents: 0,
                        totalSessions: 0,
                        averageSessionLength: '0s',
                        averageMessageLength: 0,
                        modeDistribution: { tutor: 0, protege: 0 },
                    },
                },
            });
            return;
        }

        if (pathname === '/api/courses') {
            await route.fulfill({
                json: options.allCourses || { success: true, data: [] },
            });
            return;
        }

        if (pathname === `/api/courses/${COURSE_ID}` && method === 'GET') {
            const response = courseResponses[Math.min(courseRequestCount, courseResponses.length - 1)];
            courseRequestCount += 1;

            if (response.abort) {
                await route.abort('failed');
                return;
            }

            await route.fulfill({
                status: response.status || 200,
                json: response.body || { success: true, data: baseCourse },
            });
            return;
        }

        if (pathname.startsWith('/api/courses/ALL-BRANCH-') && method === 'GET') {
            const detail = options.allCourseDetails?.[pathname.split('/').pop() || ''];
            if (detail?.status && detail.status >= 400) {
                await route.fulfill({ status: detail.status, json: { success: false } });
                return;
            }

            await route.fulfill({
                json: detail?.body || { success: true, data: courseDoc({ courseId: pathname.split('/').pop() }) },
            });
            return;
        }

        if (pathname === `/api/flags/course/${COURSE_ID}`) {
            await route.fulfill({ json: { success: true, data: { flags: [] } } });
            return;
        }

        if (pathname === `/api/courses/${COURSE_ID}/students`) {
            await route.fulfill({ json: { success: true, data: { students: [] } } });
            return;
        }

        if (pathname === `/api/courses/${COURSE_ID}/approved-topics`) {
            await route.fulfill({
                json: options.approvedTopics || {
                    success: true,
                    data: { topics: [{ topic: 'cell division', unitId: 'Unit 1', source: 'manual' }] },
                },
            });
            return;
        }

        if (pathname === `/api/struggle-activity/persistence/${COURSE_ID}`) {
            await route.fulfill({ json: { success: true, data: [] } });
            return;
        }

        if (pathname === `/api/struggle-activity/${COURSE_ID}`) {
            await route.fulfill({ json: { success: true, data: [] } });
            return;
        }

        if (pathname === `/api/struggle-activity/weekly/${COURSE_ID}`) {
            await route.fulfill({ json: { success: true, data: [] } });
            return;
        }

        if (pathname === '/api/settings/anonymize-students') {
            await route.fulfill({ json: { success: true, enabled: false } });
            return;
        }

        await route.fulfill({ json: { success: true, data: [] } });
    });
}

async function gotoHome(page) {
    await page.addInitScript((courseId) => {
        window.localStorage.setItem('selectedCourseId', courseId);
    }, COURSE_ID);
    await page.goto(`/instructor/home?courseId=${COURSE_ID}`);
    await expect(page.locator('#course-name-display')).not.toHaveText('No course selected', {
        timeout: 15_000,
    });
}

test('hides completion panels when selected course detail fetch fails', async ({ page }) => {
    await installHomeRoutes(page, {
        courseResponses: [
            { status: 200, body: { success: true, data: courseDoc() } },
            { status: 404, body: { success: false, message: 'not found' } },
        ],
    });

    await gotoHome(page);

    await expect(page.locator('#missing-items-section')).toBeHidden();
    await expect(page.locator('#complete-section')).toBeHidden();
});

test('hides completion panels when selected course payload has no lectures', async ({ page }) => {
    const malformedCourse = courseDoc({
        courseName: 'Malformed Branch Biology',
    });
    delete malformedCourse.lectures;

    await installHomeRoutes(page, {
        course: malformedCourse,
        courseResponses: [
            { status: 200, body: { success: true, data: malformedCourse } },
            { status: 200, body: { success: true, data: malformedCourse } },
        ],
    });

    await gotoHome(page);

    await expect(page.locator('#missing-items-section')).toBeHidden();
    await expect(page.locator('#complete-section')).toBeHidden();
});

test('renders grouped missing items for absent objectives and documents', async ({ page }) => {
    await installHomeRoutes(page, {
        course: courseDoc({
            courseName: '<Branch & Missing>',
            lectures: [missingLecture('Unit & Missing')],
        }),
    });

    await gotoHome(page);

    await expect(page.locator('#missing-items-section')).toBeVisible();
    await expect(page.locator('#complete-section')).toBeHidden();
    await expect(page.locator('#missing-items-list')).toContainText('<Branch & Missing>');
    await expect(page.locator('#missing-items-list')).toContainText('Unit & Missing');
    await expect(page.locator('#missing-items-list')).toContainText(
        'Missing: Learning Objective, Lecture Note, Practice Question/Tutorial'
    );
    await expect(page.locator('#missing-items-list a')).toHaveAttribute(
        'href',
        `/instructor/documents?courseId=${COURSE_ID}&unit=Unit%20%26%20Missing`
    );
});

test('renders completion panel when every unit has required content', async ({ page }) => {
    await installHomeRoutes(page, {
        course: courseDoc({
            lectures: [completeLecture('Unit 1')],
        }),
    });

    await gotoHome(page);

    await expect(page.locator('#missing-items-section')).toBeHidden();
    await expect(page.locator('#complete-section')).toBeVisible();
});

test('scans all courses when no course is selected', async ({ page }) => {
    await installHomeRoutes(page, {
        allCourses: {
            success: true,
            data: [
                { id: 'ALL-BRANCH-MISSING', name: 'All Courses Missing' },
                { id: 'ALL-BRANCH-SKIPPED', name: 'All Courses Skipped' },
            ],
        },
        allCourseDetails: {
            'ALL-BRANCH-MISSING': {
                body: {
                    success: true,
                    data: {
                        courseId: 'ALL-BRANCH-MISSING',
                        courseName: 'All Courses Missing',
                        lectures: [missingLecture('All Unit')],
                    },
                },
            },
            'ALL-BRANCH-SKIPPED': { status: 500 },
        },
    });
    await gotoHome(page);

    await page.evaluate(async () => {
        window.localStorage.removeItem('selectedCourseId');
        window.history.replaceState({}, '', '/instructor/home');
        const testWindow = /** @type {any} */ (window);
        await testWindow.checkMissingContent();
    });

    await expect(page.locator('#missing-items-section')).toBeVisible();
    await expect(page.locator('#missing-items-list')).toContainText('All Courses Missing');
    await expect(page.locator('#missing-items-list')).toContainText(
        'Missing: Learning Objective, Lecture Note, Practice Question/Tutorial'
    );
});

test('renders approved topic labels when API returns legacy topicLabels', async ({ page }) => {
    await installHomeRoutes(page, {
        course: courseDoc({
            lectures: [completeLecture('Unit 1'), { displayName: 'Ignored malformed unit' }],
        }),
        approvedTopics: {
            success: true,
            data: {
                topicLabels: [
                    '  Respiration  ',
                    'respiration',
                    { topic: 'Membrane Transport', unitId: 'Unit 1', source: 'scraped' },
                    { topic: '' },
                ],
            },
        },
    });

    await gotoHome(page);

    await expect(page.locator('#approved-topics-section')).toBeVisible();
    await expect(page.locator('#approved-topics-content')).toContainText('Respiration');
    await expect(page.locator('#approved-topics-content')).toContainText('Membrane Transport');
    await expect(page.locator('.approved-topic-chip[data-topic="Respiration"]')).toHaveCount(1);
    await expect(page.locator('.approved-topic-chip[data-topic="Membrane Transport"]')).toContainText('Unit 1');
});
