// @ts-check
/**
 * Broader coverage for public/instructor/scripts/settings.js.
 *
 * These tests drive the real /instructor/settings page through the Monocart
 * Playwright fixture and seed MongoDB directly for stable course/user state.
 */

require('dotenv').config();
const { MongoClient } = require('mongodb');
const { test, expect, request } = require('./fixtures/monocart');
const { TEST_USERS, storageStatePath } = require('./helpers/users');

const SETTINGS_COURSE_ID = 'BIOC-E2E-SETTINGS';
const SETTINGS_OTHER_COURSE_ID = 'BIOC-E2E-SETTINGS-OTHER';
const SETTINGS_COURSE_NAME = 'BIOC E2E Settings Test';
const SETTINGS_OTHER_COURSE_NAME = 'BIOC E2E Settings Other Owner';
const SETTINGS_COPY_NAME_PREFIX = 'BIOC E2E Settings Copy';
const SETTINGS_TEST_COURSE_IDS = [SETTINGS_COURSE_ID, SETTINGS_OTHER_COURSE_ID];

let instructorId;
let freshInstructorId;
let taId;
let originalGlobalSettings = null;
let originalLLMSettings = null;
let originalInstructorSystemAdmin = false;
let originalFreshSystemAdmin = false;
let originalInstructorPreferences;
let originalFreshInstructorPreferences;

async function withDb(fn) {
    if (!process.env.MONGO_URI) {
        throw new Error('MONGO_URI not set; cannot run instructor settings e2e tests.');
    }
    const client = new MongoClient(process.env.MONGO_URI);
    await client.connect();
    try {
        return await fn(client.db());
    } finally {
        await client.close();
    }
}

async function getUserByUsername(username) {
    return withDb(async (db) => {
        const user = await db.collection('users').findOne({ username });
        if (!user) throw new Error(`User ${username} not found in DB.`);
        return user;
    });
}

async function setSystemAdmin(userId, isAdmin) {
    await withDb(async (db) => {
        if (isAdmin) {
            await db.collection('users').updateOne(
                { userId },
                { $set: { 'permissions.systemAdmin': true, updatedAt: new Date() } }
            );
            return;
        }

        await db.collection('users').updateOne(
            { userId },
            { $unset: { 'permissions.systemAdmin': '' }, $set: { updatedAt: new Date() } }
        );
    });
}

async function restoreSettingDoc(id, originalDoc) {
    await withDb(async (db) => {
        if (originalDoc) {
            await db.collection('settings').replaceOne({ _id: id }, originalDoc, { upsert: true });
        } else {
            await db.collection('settings').deleteOne({ _id: id });
        }
    });
}

function deepClone(value) {
    return value === undefined ? undefined : JSON.parse(JSON.stringify(value));
}

async function restoreUserPreferences(userId, preferences) {
    await withDb(async (db) => {
        if (preferences === undefined) {
            await db.collection('users').updateOne(
                { userId },
                { $unset: { preferences: '' }, $set: { updatedAt: new Date() } }
            );
            return;
        }

        await db.collection('users').updateOne(
            { userId },
            { $set: { preferences: deepClone(preferences), updatedAt: new Date() } }
        );
    });
}

function buildSettingsCourse({
    courseId,
    courseName,
    ownerId,
    status = 'active',
    includeSettings = true,
}) {
    const now = new Date();
    const course = {
        courseId,
        courseName,
        courseCode: `${courseId}-STU`,
        instructorCourseCode: `${courseId}-INS`,
        instructorId: ownerId,
        instructors: [ownerId],
        tas: [taId],
        taPermissions: {
            [taId]: {
                canAccessCourses: true,
                canAccessFlags: true,
                updatedAt: now,
            },
        },
        courseDescription: '',
        assessmentCriteria: '',
        courseMaterials: [],
        approvedStruggleTopics: ['Cell signaling'],
        courseStructure: { weeks: 2, lecturesPerWeek: 1, totalUnits: 2 },
        isOnboardingComplete: true,
        status,
        lectures: [
            {
                name: 'Unit 1',
                displayName: 'Intro Unit',
                isPublished: true,
                learningObjectives: ['Describe ATP synthesis'],
                passThreshold: 1,
                documents: [],
                assessmentQuestions: [
                    {
                        questionId: 'settings-q1',
                        questionType: 'true-false',
                        question: 'ATP stores usable cellular energy.',
                        correctAnswer: 'true',
                        isActive: true,
                    },
                ],
                createdAt: now,
                updatedAt: now,
            },
            {
                name: 'Unit 2',
                displayName: 'Advanced Unit',
                isPublished: true,
                learningObjectives: ['Explain membrane gradients'],
                passThreshold: 1,
                documents: [],
                assessmentQuestions: [
                    {
                        questionId: 'settings-q2',
                        questionType: 'short-answer',
                        question: 'What does a proton gradient store?',
                        correctAnswer: 'Potential energy',
                        isActive: true,
                    },
                ],
                createdAt: now,
                updatedAt: now,
            },
        ],
        createdAt: now,
        updatedAt: now,
    };

    if (includeSettings) {
        course.prompts = {
            base: 'Seed base prompt',
            protege: 'Seed protege prompt',
            tutor: 'Seed tutor prompt',
            explain: 'Seed explain prompt',
            directive: 'Seed directive prompt',
            quizHelp: 'Seed quiz help prompt',
            studentIdleTimeout: 180,
        };
        course.isAdditiveRetrieval = false;
        course.quizSettings = {
            enabled: true,
            testableUnits: ['Unit 1'],
            allowLectureMaterialAccess: true,
            allowSourceAttributionDownloads: false,
        };
        course.anonymizeStudents = {
            [ownerId]: {
                enabled: false,
                updatedAt: now,
            },
        };
        course.questionPrompts = {
            systemPrompt: 'Seed question system prompt',
            trueFalse: 'Seed true false prompt',
            multipleChoice: 'Seed multiple choice prompt',
            shortAnswer: 'Seed short answer prompt',
        };
        course.mentalHealthDetectionPrompt = 'Seed mental health detection prompt';
    }

    return course;
}

async function cleanupSettingsCourses() {
    await withDb(async (db) => {
        const copyCourses = await db.collection('courses')
            .find(
                { courseName: { $regex: `^${SETTINGS_COPY_NAME_PREFIX}` } },
                { projection: { courseId: 1 } }
            )
            .toArray();
        const courseIds = [
            ...SETTINGS_TEST_COURSE_IDS,
            ...copyCourses.map((course) => course.courseId),
        ];

        await db.collection('courses').deleteMany({
            $or: [
                { courseId: { $in: SETTINGS_TEST_COURSE_IDS } },
                { courseName: { $regex: `^${SETTINGS_COPY_NAME_PREFIX}` } },
            ],
        });
        await db.collection('documents').deleteMany({ courseId: { $in: courseIds } });
    });
}

async function resetSettingsData() {
    await cleanupSettingsCourses();
    await withDb(async (db) => {
        await db.collection('settings').updateOne(
            { _id: 'global' },
            { $set: { allowLocalLogin: true, updatedAt: new Date() } },
            { upsert: true }
        );
        await db.collection('settings').updateOne(
            { _id: 'llm' },
            {
                $set: {
                    model: 'gpt-5-nano',
                    reasoningEffort: 'minimal',
                    updatedAt: new Date(),
                },
            },
            { upsert: true }
        );

        await db.collection('courses').insertMany([
            buildSettingsCourse({
                courseId: SETTINGS_COURSE_ID,
                courseName: SETTINGS_COURSE_NAME,
                ownerId: instructorId,
            }),
            buildSettingsCourse({
                courseId: SETTINGS_OTHER_COURSE_ID,
                courseName: SETTINGS_OTHER_COURSE_NAME,
                ownerId: freshInstructorId,
                includeSettings: false,
            }),
        ]);
    });
}

async function readCourse(courseId = SETTINGS_COURSE_ID) {
    return withDb((db) => db.collection('courses').findOne({ courseId }));
}

async function findCourseByName(courseName) {
    return withDb((db) => db.collection('courses').findOne({ courseName }));
}

async function readSetting(id) {
    return withDb((db) => db.collection('settings').findOne({ _id: id }));
}

async function openSettings(page, courseId = SETTINGS_COURSE_ID) {
    await page.goto(`/instructor/settings?courseId=${courseId}`);
    await expect(page.locator('h1')).toHaveText('Settings', { timeout: 15_000 });
    await expect(page.locator('#base-prompt')).toHaveValue('Seed base prompt', { timeout: 15_000 });
    await expect(page.locator('#testable-units-container .loading-text')).toHaveCount(0, { timeout: 15_000 });
    await expect(page.locator('#transfer-unit-grid .transfer-unit-row')).toHaveCount(2, { timeout: 15_000 });
}

async function setInputChecked(page, selector, checked) {
    await page.evaluate(
        ({ selector, checked }) => {
            const input = /** @type {HTMLInputElement | null} */ (document.querySelector(selector));
            if (!input) throw new Error(`${selector} not found`);
            input.checked = checked;
            input.dispatchEvent(new Event('change', { bubbles: true }));
        },
        { selector, checked }
    );
}

test.beforeAll(async () => {
    const instructor = await getUserByUsername(TEST_USERS.instructor.username);
    const freshInstructor = await getUserByUsername(TEST_USERS.instructor_fresh.username);
    const ta = await getUserByUsername(TEST_USERS.ta.username);
    instructorId = instructor.userId;
    freshInstructorId = freshInstructor.userId;
    taId = ta.userId;
    originalInstructorSystemAdmin = instructor.permissions?.systemAdmin === true;
    originalFreshSystemAdmin = freshInstructor.permissions?.systemAdmin === true;
    originalInstructorPreferences = deepClone(instructor.preferences);
    originalFreshInstructorPreferences = deepClone(freshInstructor.preferences);
    originalGlobalSettings = await readSetting('global');
    originalLLMSettings = await readSetting('llm');
});

test.beforeEach(async () => {
    await setSystemAdmin(instructorId, false);
    await setSystemAdmin(freshInstructorId, false);
    await resetSettingsData();
});

test.afterEach(async () => {
    await setSystemAdmin(instructorId, false);
    await setSystemAdmin(freshInstructorId, false);
    await restoreUserPreferences(instructorId, originalInstructorPreferences);
    await restoreUserPreferences(freshInstructorId, originalFreshInstructorPreferences);
    await restoreSettingDoc('global', originalGlobalSettings);
    await restoreSettingDoc('llm', originalLLMSettings);
});

test.afterAll(async () => {
    await cleanupSettingsCourses();
    await setSystemAdmin(instructorId, originalInstructorSystemAdmin);
    await setSystemAdmin(freshInstructorId, originalFreshSystemAdmin);
    await restoreUserPreferences(instructorId, originalInstructorPreferences);
    await restoreUserPreferences(freshInstructorId, originalFreshInstructorPreferences);
    await restoreSettingDoc('global', originalGlobalSettings);
    await restoreSettingDoc('llm', originalLLMSettings);
});

test.describe('Instructor settings UI', () => {
    test.use({ storageState: storageStatePath('instructor') });

    test('hides system-admin-only settings for a regular instructor and loads course-scoped settings', async ({ page }) => {
        await openSettings(page);

        await expect(page.locator('#database-management-section')).toBeHidden();
        await expect(page.locator('#login-restriction-section')).toBeHidden();
        await expect(page.locator('#question-generation-section')).toBeHidden();
        await expect(page.locator('#mental-health-detection-section')).toBeHidden();
        await expect(page.locator('#system-admin-section')).toBeHidden();
        await expect(page.locator('#llm-model-section')).toBeHidden();

        await expect(page.locator('#idle-timeout-input')).toHaveValue('3');
        await expect(page.locator('#additive-retrieval-toggle')).not.toBeChecked();
        await expect(page.locator('#anonymize-students-toggle')).not.toBeChecked();
        await expect(page.locator('#quiz-enabled-toggle')).toBeChecked();
        await expect(page.locator('.testable-unit-checkbox[value="Unit 1"]')).toBeChecked();
        await expect(page.locator('.testable-unit-checkbox[value="Unit 2"]')).not.toBeChecked();
    });

    test('saves prompts, retrieval, idle timeout, quiz download, and anonymize settings for the selected course', async ({ page }) => {
        await openSettings(page);

        await page.locator('#base-prompt').fill('Updated base prompt from settings UI');
        await page.locator('#protege-prompt').fill('Updated protege prompt from settings UI');
        await page.locator('#tutor-prompt').fill('Updated tutor prompt from settings UI');
        await page.locator('#explain-prompt').fill('Updated explain prompt from settings UI');
        await page.locator('#directive-prompt').fill('Updated directive prompt from settings UI');
        await page.locator('#quiz-help-prompt').fill('Updated quiz help prompt from settings UI');
        await page.locator('#idle-timeout-input').fill('5.5');
        await setInputChecked(page, '#additive-retrieval-toggle', true);
        await setInputChecked(page, '#source-attribution-download-toggle', true);
        await setInputChecked(page, '#anonymize-students-toggle', true);

        await page.locator('#save-settings').click();

        await expect(page.locator('.notification.success', { hasText: 'Settings saved successfully' })).toBeVisible({
            timeout: 10_000,
        });

        await expect.poll(async () => {
            const course = await readCourse();
            return {
                base: course.prompts?.base,
                protege: course.prompts?.protege,
                tutor: course.prompts?.tutor,
                explain: course.prompts?.explain,
                directive: course.prompts?.directive,
                quizHelp: course.prompts?.quizHelp,
                studentIdleTimeout: course.prompts?.studentIdleTimeout,
                isAdditiveRetrieval: course.isAdditiveRetrieval,
                allowSourceAttributionDownloads: course.quizSettings?.allowSourceAttributionDownloads,
                anonymizeEnabled: course.anonymizeStudents?.[instructorId]?.enabled,
            };
        }, { timeout: 10_000 }).toMatchObject({
            base: 'Updated base prompt from settings UI',
            protege: 'Updated protege prompt from settings UI',
            tutor: 'Updated tutor prompt from settings UI',
            explain: 'Updated explain prompt from settings UI',
            directive: 'Updated directive prompt from settings UI',
            quizHelp: 'Updated quiz help prompt from settings UI',
            studentIdleTimeout: 330,
            isAdditiveRetrieval: true,
            allowSourceAttributionDownloads: true,
            anonymizeEnabled: true,
        });
    });

    test('shows admin settings, enforces gpt-5.4-nano reasoning rules, and saves global admin controls', async ({ page }) => {
        await setSystemAdmin(instructorId, true);
        await openSettings(page);

        await expect(page.locator('#database-management-section')).toBeVisible();
        await expect(page.locator('#login-restriction-section')).toBeVisible();
        await expect(page.locator('#question-generation-section')).toBeVisible();
        await expect(page.locator('#mental-health-detection-section')).toBeVisible();
        await expect(page.locator('#system-admin-section')).toBeVisible();
        await expect(page.locator('#llm-model-section')).toBeVisible();
        await expect(page.locator('#mental-health-detection-prompt')).toHaveValue('Seed mental health detection prompt');
        await expect(page.locator('#question-system-prompt')).toHaveValue('Seed question system prompt');

        await expect(page.locator('#llm-model-select')).toHaveValue('gpt-5-nano');
        await expect(page.locator('#llm-reasoning-item')).toBeVisible();
        await expect(page.locator('#llm-reasoning-select')).toHaveValue('minimal');

        await page.locator('#llm-model-select').selectOption('gpt-5.4-nano');
        await expect(page.locator('#llm-reasoning-select')).toHaveValue('low');
        await expect(page.locator('#llm-reasoning-select option[value="minimal"]')).toBeDisabled();
        await setInputChecked(page, '#allow-local-login-toggle', false);

        await page.locator('#save-settings').click();
        await expect(page.locator('.notification.success', { hasText: 'Settings saved successfully' })).toBeVisible({
            timeout: 10_000,
        });

        await expect.poll(async () => {
            const [globalSettings, llmSettings] = await Promise.all([
                readSetting('global'),
                readSetting('llm'),
            ]);
            return {
                allowLocalLogin: globalSettings?.allowLocalLogin,
                model: llmSettings?.model,
                reasoningEffort: llmSettings?.reasoningEffort,
            };
        }, { timeout: 10_000 }).toMatchObject({
            allowLocalLogin: false,
            model: 'gpt-5.4-nano',
            reasoningEffort: 'low',
        });
    });

    test('deactivates and reactivates the selected course from the lifecycle panel', async ({ page }) => {
        await openSettings(page);
        await page.locator('#course-lifecycle-section').scrollIntoViewIfNeeded();

        await expect(page.locator('#course-status-badge')).toHaveText('Active');
        page.once('dialog', (dialog) => dialog.accept());
        await page.locator('#toggle-course-active-btn').click();

        await expect(page.locator('.notification.success', { hasText: 'Course deactivated' })).toBeVisible({
            timeout: 10_000,
        });
        await expect(page.locator('#course-status-badge')).toHaveText('Inactive');
        await expect.poll(async () => (await readCourse()).status, { timeout: 10_000 }).toBe('inactive');

        page.once('dialog', (dialog) => dialog.accept());
        await page.locator('#toggle-course-active-btn').click();

        await expect(page.locator('.notification.success', { hasText: 'Course reactivated successfully' })).toBeVisible({
            timeout: 10_000,
        });
        await expect(page.locator('#course-status-badge')).toHaveText('Active');
        await expect.poll(async () => (await readCourse()).status, { timeout: 10_000 }).toBe('active');
    });

    test('previews transfer selections and creates a course copy with selected units and options', async ({ page }) => {
        const copyName = `${SETTINGS_COPY_NAME_PREFIX} ${Date.now()}`;
        await openSettings(page);
        await page.locator('#course-lifecycle-section').scrollIntoViewIfNeeded();

        await page.locator('#transfer-course-name').fill(copyName);
        await setInputChecked(page, '#transfer-settings-toggle', false);
        await setInputChecked(page, '#transfer-tas-toggle', false);
        await setInputChecked(page, '#deactivate-source-after-transfer-toggle', true);
        await setInputChecked(page, '.transfer-unit-row[data-unit-name="Unit 2"] .transfer-objectives-checkbox', false);
        await setInputChecked(page, '.transfer-unit-row[data-unit-name="Unit 1"] .transfer-questions-checkbox', false);

        await page.locator('#transfer-course-btn').click();

        const modal = page.locator('#transfer-course-modal');
        await expect(modal).toHaveClass(/show/);
        await expect(page.locator('#transfer-modal-summary')).toContainText(`New course name: ${copyName}`);
        await expect(page.locator('#transfer-modal-summary')).toContainText('2 of 2 units will copy docs and existing chunks.');
        await expect(page.locator('#transfer-modal-summary')).toContainText('1 of 2 units will copy learning objectives.');
        await expect(page.locator('#transfer-modal-summary')).toContainText('1 of 2 units will copy assessment questions.');
        await expect(page.locator('#transfer-modal-summary')).toContainText('Course settings will not be copied.');
        await expect(page.locator('#transfer-modal-summary')).toContainText('TAs will not be copied.');
        await expect(page.locator('#transfer-modal-summary')).toContainText('The source course will be deactivated after the transfer finishes.');

        await page.locator('#transfer-modal-confirm').click();

        await expect.poll(async () => Boolean(await findCourseByName(copyName)), { timeout: 15_000 }).toBe(true);
        const copiedCourse = await findCourseByName(copyName);
        const sourceCourse = await readCourse();
        const unit1 = copiedCourse.lectures.find((lecture) => lecture.name === 'Unit 1');
        const unit2 = copiedCourse.lectures.find((lecture) => lecture.name === 'Unit 2');

        await expect(page).toHaveURL(new RegExp(`/instructor/settings\\?courseId=${copiedCourse.courseId}`), {
            timeout: 15_000,
        });
        expect(sourceCourse.status).toBe('inactive');
        expect(copiedCourse.status).toBe('active');
        expect(copiedCourse.instructorId).toBe(instructorId);
        expect(copiedCourse.tas).toEqual([]);
        expect(copiedCourse.quizSettings).toBeUndefined();
        expect(copiedCourse.prompts).toBeUndefined();
        expect(unit1.isPublished).toBe(false);
        expect(unit2.isPublished).toBe(false);
        expect(unit1.learningObjectives).toEqual(['Describe ATP synthesis']);
        expect(unit1.assessmentQuestions).toEqual([]);
        expect(unit2.learningObjectives).toEqual([]);
        expect(unit2.assessmentQuestions).toHaveLength(1);
    });
});

test.describe('Settings API authorization', () => {
    test('non-owner instructor cannot update another instructor course through direct settings API', async ({ baseURL }) => {
        const api = await request.newContext({
            baseURL,
            storageState: storageStatePath('instructor_fresh'),
        });

        try {
            const response = await api.post('/api/settings/prompts', {
                data: {
                    courseId: SETTINGS_COURSE_ID,
                    base: 'Unauthorized base prompt',
                    protege: 'Unauthorized protege prompt',
                    tutor: 'Unauthorized tutor prompt',
                    explain: 'Unauthorized explain prompt',
                    directive: 'Unauthorized directive prompt',
                    quizHelp: 'Unauthorized quiz help prompt',
                    additiveRetrieval: true,
                    studentIdleTimeout: 120,
                },
                failOnStatusCode: false,
            });

            expect.soft(response.status()).toBe(403);
            const course = await readCourse();
            expect.soft(course.prompts.base).toBe('Seed base prompt');
            expect.soft(course.isAdditiveRetrieval).toBe(false);
        } finally {
            await api.dispose();
        }
    });
});
