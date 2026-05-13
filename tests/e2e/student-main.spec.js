// @ts-check
/**
 * Browser coverage for public/student/scripts/student.js.
 *
 * This spec focuses on client-side flows that are not well exercised by the
 * API-heavy student-chat suite: course bootstrapping, assessment calibration,
 * chat rendering/action controls, and in-page flagging.
 */

const { test, expect } = require('./fixtures/monocart');
const { TEST_USERS, storageStatePath } = require('./helpers/users');
const { withDb, getUserIdByUsername } = require('./helpers/quiz');
const {
    STU_COURSE_ID,
    STU_COURSE_NAME,
    STU_OTHER_COURSE_ID,
    getStudentId,
    resetStudentChatData,
    cleanupStudentChatData,
    setUserAgreement,
} = require('./helpers/student');

let instructorId;
let studentId;

test.use({ storageState: storageStatePath('student') });

test.beforeAll(async () => {
    instructorId = await getUserIdByUsername(TEST_USERS.instructor.username);
    studentId = await getStudentId();
});

test.afterAll(async () => {
    await cleanupStudentChatData();
});

test.beforeEach(async () => {
    await resetStudentChatData({ instructorId });
    await setUserAgreement(studentId, true);
    await withDb(async (db) => {
        await db.collection('flaggedQuestions').deleteMany({ studentId });
    });
});

async function openStudentFresh(page) {
    await page.addInitScript(() => {
        localStorage.clear();
        sessionStorage.clear();
    });
    await page.goto('/student');
    await expect(page.locator('#course-select')).toBeVisible({ timeout: 15_000 });
}

async function selectMainCourse(page) {
    await page.locator('#course-select').selectOption(STU_COURSE_ID);
    await expect(page.locator('#course-selection-wrapper')).toBeHidden({ timeout: 15_000 });
    await expect(page.locator('.course-name')).toContainText(STU_COURSE_NAME, {
        timeout: 15_000,
    });
}

async function waitForDirectChatReady(page) {
    await expect(page.locator('#chat-messages')).toContainText('No Questions Available', {
        timeout: 15_000,
    });
    await expect(page.locator('#chat-input')).toBeEnabled({ timeout: 10_000 });
    await expect(page.locator('.mode-toggle-container')).toBeVisible();
}

async function setAllUnitsUnpublished() {
    await withDb(async (db) => {
        await db.collection('courses').updateOne(
            { courseId: STU_COURSE_ID },
            {
                $set: {
                    'lectures.0.isPublished': false,
                    'lectures.1.isPublished': false,
                    updatedAt: new Date(),
                },
            }
        );
    });
}

async function seedAssessmentQuestions() {
    await withDb(async (db) => {
        await db.collection('courses').updateOne(
            { courseId: STU_COURSE_ID },
            {
                $set: {
                    'lectures.0.isPublished': true,
                    'lectures.0.displayName': 'Foundations',
                    'lectures.0.passThreshold': 2,
                    'lectures.0.updatedAt': new Date('2026-01-03T10:00:00.000Z'),
                    'lectures.0.assessmentQuestions': [
                        {
                            questionId: 'student_main_mc',
                            questionType: 'multiple-choice',
                            question: 'Which molecule is the main energy currency of the cell?',
                            options: { A: 'DNA', B: 'ATP', C: 'Cellulose', D: 'Cholesterol' },
                            correctAnswer: 'B',
                            explanation: 'ATP stores and transfers energy in cells.',
                            isActive: true,
                        },
                        {
                            questionId: 'student_main_tf',
                            questionType: 'true-false',
                            question: 'Water is a polar molecule.',
                            correctAnswer: 'true',
                            explanation: 'Water has partial charges because oxygen is more electronegative.',
                            isActive: true,
                        },
                    ],
                    'lectures.1.isPublished': false,
                    'lectures.1.assessmentQuestions': [],
                    updatedAt: new Date(),
                },
            }
        );
    });
}

async function dropOtherCourseEnrollment() {
    await withDb(async (db) => {
        await db.collection('courses').updateOne(
            { courseId: STU_OTHER_COURSE_ID },
            { $unset: { [`studentEnrollment.${studentId}`]: '' } }
        );
    });
}

async function routeChatResponse(page, responseFactory) {
    let calls = 0;
    const bodies = [];

    await page.route('**/api/chat', async (route) => {
        const request = route.request();
        if (request.method() !== 'POST') {
            await route.fallback();
            return;
        }

        const body = request.postDataJSON();
        bodies.push(body);
        const payload = responseFactory(body, calls);
        calls += 1;
        await route.fulfill({
            status: 200,
            contentType: 'application/json',
            body: JSON.stringify(payload),
        });
    });

    return bodies;
}

test.describe('student.js course and unit bootstrapping', () => {
    test('no published units disables chat input and hides the mode toggle', async ({ page }) => {
        await setAllUnitsUnpublished();

        await openStudentFresh(page);
        await selectMainCourse(page);

        await expect(page.locator('#chat-messages')).toContainText(
            'No units published at this time',
            { timeout: 15_000 }
        );
        await expect(page.locator('#chat-input')).toBeDisabled();
        await expect(page.locator('#chat-input')).toHaveAttribute(
            'placeholder',
            'No units published - chat unavailable'
        );
        await expect(page.locator('#send-button')).toBeDisabled();
        await expect(page.locator('.mode-toggle-container')).toBeHidden();
    });

    test('course selection starts calibration, records answers, and unlocks chat in the computed mode', async ({ page }) => {
        await seedAssessmentQuestions();

        await openStudentFresh(page);
        await selectMainCourse(page);

        const unitSelect = page.locator('#unit-select');
        await expect(unitSelect).toBeVisible({ timeout: 15_000 });
        await expect(unitSelect).toHaveValue('Unit 1');
        await expect(unitSelect).not.toContainText('Unit 2');

        await expect(page.locator('.assessment-start')).toContainText('Starting Assessment for Unit 1', {
            timeout: 15_000,
        });
        await expect(page.locator('#calibration-question-0')).toContainText(
            'Which molecule is the main energy currency of the cell?'
        );
        await expect(page.locator('.chat-input-container')).toBeHidden();

        await page.locator('#calibration-question-0 .calibration-option', { hasText: 'B. ATP' }).click();
        await expect(page.locator('#calibration-question-1')).toContainText('Water is a polar molecule.', {
            timeout: 10_000,
        });
        await page.locator('#calibration-question-1 .calibration-option', { hasText: 'True' }).click();

        const result = page.locator('.mode-result');
        await expect(result).toContainText(/BiocBot is in prot.g. mode/i, { timeout: 10_000 });
        await expect(result).toContainText('Assessment Summary');
        await expect(result).toContainText('Score: 2/2');
        await expect(page.locator('#chat-input')).toBeEnabled();
        await expect(page.locator('.mode-toggle-container')).toBeVisible();

        await expect.poll(async () => {
            return await page.evaluate(() => localStorage.getItem('studentMode'));
        }, { timeout: 10_000 }).toBe('protege');

        const saved = await page.evaluate((id) => {
            const raw = localStorage.getItem(`biocbot_current_chat_${id}`);
            return raw ? JSON.parse(raw) : null;
        }, studentId);
        expect(saved?.practiceTests?.questions).toHaveLength(2);
        expect(saved?.metadata?.courseId).toBe(STU_COURSE_ID);
    });

    test('change course clears selected context and returns to the course picker', async ({ page }) => {
        await openStudentFresh(page);
        await selectMainCourse(page);
        await waitForDirectChatReady(page);

        page.once('dialog', (dialog) => dialog.accept());
        await page.locator('#change-course-btn').click();

        await expect(page.locator('#course-select')).toBeVisible({ timeout: 15_000 });
        const stored = await page.evaluate(() => ({
            courseId: localStorage.getItem('selectedCourseId'),
            courseName: localStorage.getItem('selectedCourseName'),
        }));
        expect(stored).toEqual({ courseId: null, courseName: null });
    });

    test('selecting an unenrolled course prompts for a code and rejects an invalid join without changing context', async ({ page }) => {
        await dropOtherCourseEnrollment();

        await openStudentFresh(page);

        const dialogs = [];
        page.on('dialog', async (dialog) => {
            dialogs.push({ type: dialog.type(), message: dialog.message() });
            if (dialog.type() === 'prompt') {
                await dialog.accept('BAD-CODE');
            } else {
                await dialog.accept();
            }
        });

        await page.locator('#course-select').selectOption(STU_OTHER_COURSE_ID);
        await expect(page.locator('#course-select')).toHaveValue('', { timeout: 10_000 });

        expect(dialogs.some((dialog) => dialog.type === 'prompt')).toBe(true);
        expect(dialogs.some((dialog) => /failed|check the code|invalid|course code/i.test(dialog.message))).toBe(true);
        expect(await page.evaluate(() => localStorage.getItem('selectedCourseId'))).toBeNull();
    });
});

test.describe('student.js chat rendering and actions', () => {
    test('chat submit renders source downloads, directive status, topic actions, and auto-save data', async ({ page }) => {
        const chatBodies = await routeChatResponse(page, (body) => ({
            success: true,
            message: 'Mitochondria make ATP for cellular work.',
            sourceAttribution: {
                downloadsEnabled: true,
                description: 'Unit 1 notes',
                documents: [
                    {
                        documentId: 'student-main-source',
                        fileName: 'Unit 1 Notes.txt',
                        lectureName: 'Unit 1',
                    },
                ],
            },
            struggleState: {
                topics: [
                    { topic: 'photosynthesis', count: 3, isActive: true },
                ],
            },
            struggleDebug: {
                identifiedTopic: 'photosynthesis',
                directiveModeActive: true,
            },
            echo: body.message,
        }));

        await openStudentFresh(page);
        await selectMainCourse(page);
        await waitForDirectChatReady(page);

        await page.locator('#chat-input').fill('What do mitochondria do?');
        await page.locator('#send-button').click();

        await expect(page.locator('.user-message')).toContainText('What do mitochondria do?');
        const botMessage = page.locator('.bot-message', {
            hasText: 'Mitochondria make ATP for cellular work.',
        });
        await expect(botMessage).toBeVisible({ timeout: 10_000 });
        await expect(page.locator('#typing-indicator')).toHaveCount(0);

        await expect(page.locator('#directive-mode-indicator')).toBeVisible();
        await expect(botMessage.getByRole('button', { name: 'Explain' })).toBeVisible();
        await expect(botMessage.getByRole('button', { name: 'Ask me a question' })).toBeVisible();
        await expect(botMessage.getByRole('button', { name: 'I understand Photosynthesis now' })).toBeVisible();

        const sourceLink = botMessage.locator('.message-source a');
        await expect(sourceLink).toHaveText('Unit 1 Notes.txt (Unit 1)');
        await expect(sourceLink).toHaveAttribute(
            'href',
            `/api/chat/source-documents/student-main-source/download?courseId=${STU_COURSE_ID}`
        );

        expect(chatBodies[0]).toMatchObject({
            message: 'What do mitochondria do?',
            courseId: STU_COURSE_ID,
            unitName: 'Unit 1',
        });

        const saved = await page.evaluate((id) => {
            const raw = localStorage.getItem(`biocbot_current_chat_${id}`);
            return raw ? JSON.parse(raw) : null;
        }, studentId);
        expect(saved?.messages?.map((message) => message.type)).toEqual(['user', 'bot']);
        expect(saved?.messages?.[1]?.activeStruggleTopic).toBe('photosynthesis');
    });

    test('explain and practice actions use the detected topic and validate unanswered practice submissions', async ({ page }) => {
        const chatBodies = await routeChatResponse(page, (body, callIndex) => {
            if (callIndex === 0) {
                return {
                    success: true,
                    message: 'Mitochondria make ATP for cellular work.',
                    sourceAttribution: { description: 'Course answer' },
                    struggleState: {
                        topics: [
                            { topic: 'photosynthesis', count: 2, isActive: false },
                        ],
                    },
                    struggleDebug: {
                        identifiedTopic: 'photosynthesis',
                        directiveModeActive: false,
                    },
                };
            }

            return {
                success: true,
                message: 'Here is a novice-friendly explanation of the same idea.',
                sourceAttribution: { description: 'Explanation mode' },
            };
        });

        let practiceRequest = null;
        await page.route('**/api/chat/practice-question', async (route) => {
            practiceRequest = route.request().postDataJSON();
            await route.fulfill({
                status: 200,
                contentType: 'application/json',
                body: JSON.stringify({
                    success: true,
                    data: {
                        practiceId: 'practice-student-main',
                        questionType: 'multiple-choice',
                        question: 'Which molecule directly stores usable cellular energy?',
                        options: { A: 'DNA', B: 'ATP', C: 'Starch', D: 'Water' },
                    },
                }),
            });
        });
        await page.route('**/api/chat/check-practice-answer', async (route) => {
            await route.fulfill({
                status: 200,
                contentType: 'application/json',
                body: JSON.stringify({
                    success: true,
                    data: {
                        correct: true,
                        feedback: 'Correct: ATP is the usable energy currency.',
                        correctAnswer: 'B',
                    },
                }),
            });
        });

        await openStudentFresh(page);
        await selectMainCourse(page);
        await waitForDirectChatReady(page);

        await page.locator('#chat-input').fill('Explain mitochondria.');
        await page.locator('#send-button').click();

        const botMessage = page.locator('.bot-message', {
            hasText: 'Mitochondria make ATP for cellular work.',
        });
        await expect(botMessage).toBeVisible({ timeout: 10_000 });

        await botMessage.getByRole('button', { name: 'Explain' }).click();
        await expect(page.locator('.bot-message', {
            hasText: 'Here is a novice-friendly explanation',
        })).toBeVisible({ timeout: 10_000 });
        expect(chatBodies[1]).toMatchObject({
            topic: 'photosynthesis',
        });
        expect(chatBodies[1].isExplanationRequest).toBeTruthy();

        await botMessage.getByRole('button', { name: 'Ask me a question' }).click();
        const practice = page.locator('.practice-question-container[data-practice-id="practice-student-main"]');
        await expect(practice).toContainText('Which molecule directly stores usable cellular energy?', {
            timeout: 10_000,
        });
        expect(practiceRequest).toMatchObject({
            courseId: STU_COURSE_ID,
            unitName: 'Unit 1',
            topic: 'photosynthesis',
        });

        await practice.locator('.practice-submit-btn').click();
        await expect(practice.locator('.practice-feedback')).toHaveText('Please select an answer.');

        await practice.locator('input[value="B"]').check();
        await practice.locator('.practice-submit-btn').click();
        await expect(page.locator('.practice-completed')).toContainText(
            'Correct: ATP is the usable energy currency.',
            { timeout: 10_000 }
        );
    });

    test('flagging a bot response submits the selected reason and replaces the message with a review notice', async ({ page }) => {
        await routeChatResponse(page, () => ({
            success: true,
            message: 'This response should be reviewable by the instructor.',
            sourceAttribution: { description: 'Unit answer' },
        }));

        await openStudentFresh(page);
        await selectMainCourse(page);
        await waitForDirectChatReady(page);

        await page.locator('#chat-input').fill('Give me something to review.');
        await page.locator('#send-button').click();

        const botMessage = page.locator('.bot-message', {
            hasText: 'This response should be reviewable by the instructor.',
        });
        await expect(botMessage).toBeVisible({ timeout: 10_000 });

        await botMessage.locator('.flag-button').click();
        await expect(botMessage.locator('.flag-menu')).toHaveClass(/show/);
        await botMessage.locator('.flag-option', { hasText: 'Incorrect' }).click();

        const flaggedNotice = page.locator('.bot-message', {
            hasText: 'Thank you for reporting this response as incorrect information.',
        });
        await expect(flaggedNotice).toBeVisible();
        await expect(flaggedNotice.locator('.flag-button')).toHaveCount(0);

        await expect.poll(async () => {
            return await withDb((db) =>
                db.collection('flaggedQuestions').countDocuments({
                    studentId,
                    courseId: STU_COURSE_ID,
                    flagReason: 'incorrect',
                    'questionContent.question': 'This response should be reviewable by the instructor.',
                })
            );
        }, { timeout: 10_000 }).toBe(1);
    });
});
