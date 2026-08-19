// @ts-check

const { test, expect } = require('./fixtures/monocart');
const { storageStatePath } = require('./helpers/users');

const COURSE_ID = 'INSTRUCTOR-UNIT-STATE';
const INSTRUCTOR_ID = 'e2e_instructor_id';

function makeUnit(name, now) {
    return {
        name,
        displayName: name,
        isPublished: false,
        learningObjectives: [],
        passThreshold: 0,
        createdAt: now,
        updatedAt: now,
        documents: [],
        assessmentQuestions: [],
    };
}

function unitStateCourse() {
    const now = new Date('2026-02-03T04:05:06.000Z');
    return {
        courseId: COURSE_ID,
        courseName: 'Instructor Unit State',
        courseCode: 'UNIT-STU',
        instructorCourseCode: 'UNIT-INS',
        instructorId: INSTRUCTOR_ID,
        instructors: [INSTRUCTOR_ID],
        tas: [],
        taPermissions: {},
        courseStructure: { weeks: 3, lecturesPerWeek: 1, totalUnits: 3 },
        isOnboardingComplete: true,
        status: 'active',
        approvedStruggleTopics: [],
        lectures: [makeUnit('Unit 1', now), makeUnit('Unit 2', now), makeUnit('Unit 3', now)],
    };
}

/**
 * Serve a mutable course so add/delete round-trips change what the page reloads.
 */
async function installUnitStateRoutes(page) {
    const course = unitStateCourse();

    await page.route('**/api/**', async (route) => {
        const request = route.request();
        const url = new URL(request.url());
        const pathname = url.pathname;
        const method = request.method();

        if (pathname === '/api/auth/me') {
            await route.fulfill({
                json: {
                    success: true,
                    user: {
                        userId: INSTRUCTOR_ID,
                        username: 'e2e_instructor',
                        displayName: 'Unit State Instructor',
                        role: 'instructor',
                        preferences: {},
                    },
                },
            });
            return;
        }

        if (pathname === `/api/onboarding/${COURSE_ID}` || pathname === `/api/courses/${COURSE_ID}`) {
            await route.fulfill({ json: { success: true, data: course } });
            return;
        }

        if (pathname === `/api/courses/${COURSE_ID}/units` && method === 'POST') {
            const highest = course.lectures.reduce((max, lecture) => {
                const match = /\d+/.exec(lecture.name);
                return match ? Math.max(max, parseInt(match[0], 10)) : max;
            }, 0);
            const newUnit = makeUnit(`Unit ${highest + 1}`, new Date());
            course.lectures.push(newUnit);
            course.courseStructure.totalUnits = course.lectures.length;
            await route.fulfill({
                json: {
                    success: true,
                    message: `${newUnit.name} added successfully`,
                    data: { unit: newUnit, totalUnits: course.lectures.length },
                },
            });
            return;
        }

        const deleteMatch = pathname.match(/^\/api\/courses\/[^/]+\/units\/([^/]+)$/);
        if (deleteMatch && method === 'DELETE') {
            const unitName = decodeURIComponent(deleteMatch[1]);
            course.lectures = course.lectures.filter((lecture) => lecture.name !== unitName);
            course.courseStructure.totalUnits = course.lectures.length;
            await route.fulfill({ json: { success: true, message: `${unitName} deleted successfully` } });
            return;
        }

        if (pathname === '/api/lectures/publish-status') {
            await route.fulfill({ json: { success: true, data: { publishStatus: {} } } });
            return;
        }

        if (pathname === '/api/learning-objectives') {
            await route.fulfill({ json: { success: true, data: { objectives: [] } } });
            return;
        }

        if (pathname === '/api/questions/lecture') {
            await route.fulfill({ json: { success: true, data: { questions: [] } } });
            return;
        }

        await route.fulfill({ json: { success: true, data: {} } });
    });

    return course;
}

function unitContent(page, unitName) {
    return page.locator(`.accordion-item[data-unit-name="${unitName}"] .accordion-content`);
}

async function expectExpanded(page, unitName) {
    await expect(unitContent(page, unitName)).not.toHaveClass(/collapsed/);
}

async function expectCollapsed(page, unitName) {
    await expect(unitContent(page, unitName)).toHaveClass(/collapsed/);
}

async function toggleUnit(page, unitName) {
    await page.locator(`.accordion-item[data-unit-name="${unitName}"] .accordion-header .folder-name`).click();
}

async function openDocumentsPage(page) {
    const course = await installUnitStateRoutes(page);
    await page.goto(`/instructor/documents?courseId=${COURSE_ID}`);
    await expect(page.locator('#course-title')).toHaveText('Instructor Unit State', { timeout: 15_000 });
    await expect(page.locator('.accordion-item[data-unit-name="Unit 1"]')).toBeVisible();
    return course;
}

test.describe('instructor unit expansion state across add and delete', () => {
    test.use({ storageState: storageStatePath('instructor') });

    test('first render expands the first unit only', async ({ page }) => {
        await openDocumentsPage(page);

        await expectExpanded(page, 'Unit 1');
        await expectCollapsed(page, 'Unit 2');
        await expectCollapsed(page, 'Unit 3');
    });

    test('adding a unit keeps the open unit open and opens the new unit', async ({ page }) => {
        await openDocumentsPage(page);

        // Work on Unit 3 instead of the default Unit 1.
        await toggleUnit(page, 'Unit 1');
        await toggleUnit(page, 'Unit 3');
        await expectCollapsed(page, 'Unit 1');
        await expectExpanded(page, 'Unit 3');

        await page.locator('#add-unit-btn').click();
        await expect(page.locator('.accordion-item[data-unit-name="Unit 4"]')).toBeVisible();

        await expectExpanded(page, 'Unit 4');
        await expectExpanded(page, 'Unit 3');
        await expectCollapsed(page, 'Unit 1');
    });

    test('deleting a unit leaves the remaining units as they were', async ({ page }) => {
        await openDocumentsPage(page);

        await toggleUnit(page, 'Unit 1');
        await toggleUnit(page, 'Unit 3');
        await expectCollapsed(page, 'Unit 1');
        await expectExpanded(page, 'Unit 3');

        await page.evaluate(() => {
            /** @type {any} */ (window).openDeleteUnitModal('Unit 2');
        });
        await page.locator('#confirm-delete-unit-btn').click();
        await expect(page.locator('.accordion-item[data-unit-name="Unit 2"]')).toHaveCount(0);

        await expectExpanded(page, 'Unit 3');
        await expectCollapsed(page, 'Unit 1');
    });
});
