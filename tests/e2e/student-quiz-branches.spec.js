// @ts-check
/**
 * Focused branch coverage for public/student/scripts/quiz.js.
 */

const { test, expect } = require('./fixtures/monocart');
const { TEST_USERS, loadCredentials } = require('./helpers/users');
const {
    QUIZ_COURSE_ID,
    QUESTION_IDS,
    getUserIdByUsername,
    resetQuizCourse,
    cleanupQuizCourse,
} = require('./helpers/quiz');

const studentUser = TEST_USERS.student;
let studentPassword;
let instructorId;

test.beforeAll(async () => {
    studentPassword = loadCredentials().student;
    instructorId = await getUserIdByUsername(TEST_USERS.instructor.username);
});

test.afterAll(async () => {
    await cleanupQuizCourse();
});

test.beforeEach(async () => {
    await resetQuizCourse({ instructorId, quizSettings: { enabled: true } });
});

async function loginAsStudent(page) {
    await page.goto('/');
    await page.locator('#auth-form input#username').fill(studentUser.username);
    await page.locator('#auth-form input#password').fill(studentPassword);
    await page.locator('#auth-form button#login-btn').click();
    await page.waitForURL((url) => url.pathname !== '/' && url.pathname !== '/login', {
        timeout: 10_000,
    });
}

async function gotoQuizPage(page) {
    await page.goto(`/student/quiz?courseId=${QUIZ_COURSE_ID}`);
}

async function openWrongMultipleChoiceChat(page) {
    await page.locator('#type-filter').selectOption('multiple-choice');
    await expect(page.locator('#question-card')).toBeVisible({ timeout: 10_000 });
    await page.locator('input[name="mc-answer"][value="A"]').check();
    await page.locator('#submit-btn').click();
    await expect(page.locator('#quiz-chat-container')).toBeVisible({ timeout: 10_000 });
}

async function sendQuizChatMessage(page, message) {
    await expect(page.locator('#quiz-chat-input')).toBeEnabled({ timeout: 10_000 });
    await page.locator('#quiz-chat-input').fill(message);
    await page.locator('#quiz-chat-send').click();
}

test.describe('Quiz page branch ranges', () => {
    test('chat success response renders a system message', async ({ page }) => {
        await page.route('**/api/quiz/chat', async (route) => {
            await route.fulfill({
                status: 200,
                contentType: 'application/json',
                body: JSON.stringify({
                    success: true,
                    source: 'system',
                    message: 'Review how ATP stores energy in phosphate bonds.',
                }),
            });
        });

        await loginAsStudent(page);
        await gotoQuizPage(page);
        await openWrongMultipleChoiceChat(page);

        await sendQuizChatMessage(page, 'Why was ATP correct?');

        await expect(page.locator('.quiz-chat-msg.system')).toContainText(
            'Review how ATP stores energy',
            { timeout: 10_000 }
        );
    });

    test('chat stops accepting messages after the per-question message limit', async ({ page }) => {
        let chatCalls = 0;
        await page.route('**/api/quiz/chat', async (route) => {
            chatCalls += 1;
            await route.fulfill({
                status: 200,
                contentType: 'application/json',
                body: JSON.stringify({
                    success: true,
                    source: 'quiz-help',
                    message: `Tutor reply ${chatCalls}`,
                }),
            });
        });

        await loginAsStudent(page);
        await gotoQuizPage(page);
        await openWrongMultipleChoiceChat(page);

        for (let i = 1; i <= 10; i += 1) {
            await sendQuizChatMessage(page, `help ${i}`);
            await expect(page.locator('.quiz-chat-msg.bot').filter({ hasText: `Tutor reply ${i}` }))
                .toBeVisible({ timeout: 10_000 });
        }

        await sendQuizChatMessage(page, 'one more');

        await expect(page.locator('.quiz-chat-msg.system')).toContainText(
            'You have reached the message limit for this question',
            { timeout: 10_000 }
        );
        await expect(page.locator('#quiz-chat-input')).toBeDisabled();
        await expect(page.locator('#quiz-chat-send')).toBeDisabled();
        expect(chatCalls).toBe(10);
    });

    test('wrong true-false answer sends the server correct answer into quiz chat context', async ({ page }) => {
        let chatPayload = /** @type {any} */ (null);
        await page.route('**/api/quiz/chat', async (route) => {
            chatPayload = JSON.parse(route.request().postData() || '{}');
            await route.fulfill({
                status: 200,
                contentType: 'application/json',
                body: JSON.stringify({ success: false, message: 'forced chat failure' }),
            });
        });

        await loginAsStudent(page);
        await gotoQuizPage(page);

        await page.locator('#type-filter').selectOption('true-false');
        await expect(page.locator('#tf-options')).toBeVisible({ timeout: 10_000 });
        await page.locator('input[name="tf-answer"][value="false"]').check();
        await page.locator('#submit-btn').click();
        await expect(page.locator('#quiz-chat-container')).toBeVisible({ timeout: 10_000 });

        await sendQuizChatMessage(page, 'Why is this true?');

        await expect(page.locator('.quiz-chat-msg.system')).toContainText(
            'Sorry, I had trouble processing that',
            { timeout: 10_000 }
        );
        expect(chatPayload).toMatchObject({
            courseId: QUIZ_COURSE_ID,
            questionType: 'true-false',
            correctAnswer: 'true',
            studentAnswer: 'false',
        });
    });

    test('short-answer submission disables the textarea and uses AI-evaluated chat context', async ({ page }) => {
        let checkPayload = /** @type {any} */ (null);
        let chatPayload = /** @type {any} */ (null);

        await page.route('**/api/quiz/check-answer', async (route) => {
            checkPayload = JSON.parse(route.request().postData() || '{}');
            await route.fulfill({
                status: 200,
                contentType: 'application/json',
                body: JSON.stringify({
                    success: true,
                    data: {
                        correct: false,
                        feedback: 'That answer does not identify the peptide bond.',
                    },
                }),
            });
        });

        await page.route('**/api/quiz/chat', async (route) => {
            chatPayload = JSON.parse(route.request().postData() || '{}');
            await route.fulfill({
                status: 200,
                contentType: 'application/json',
                body: JSON.stringify({ success: false, message: 'forced chat failure' }),
            });
        });

        await loginAsStudent(page);
        await gotoQuizPage(page);

        await page.locator('#type-filter').selectOption('short-answer');
        await expect(page.locator('#sa-container')).toBeVisible({ timeout: 10_000 });
        await page.locator('#sa-input').fill('hydrogen bond');
        await page.locator('#submit-btn').click();

        await expect(page.locator('#feedback-container')).toContainText('peptide bond', { timeout: 10_000 });
        await expect(page.locator('#sa-input')).toBeDisabled();
        expect(checkPayload).toMatchObject({
            courseId: QUIZ_COURSE_ID,
            questionId: QUESTION_IDS.sa,
            studentAnswer: 'hydrogen bond',
        });

        await sendQuizChatMessage(page, 'What should I review?');
        await expect(page.locator('.quiz-chat-msg.system')).toContainText(
            'Sorry, I had trouble processing that',
            { timeout: 10_000 }
        );
        expect(chatPayload).toMatchObject({
            courseId: QUIZ_COURSE_ID,
            questionType: 'short-answer',
            correctAnswer: '[evaluated by AI on server]',
            studentAnswer: 'hydrogen bond',
        });
    });

    test('unit filter shows the empty state when the selected unit has no matching questions', async ({ page }) => {
        await page.route('**/api/quiz/questions?**', async (route) => {
            await route.fulfill({
                status: 200,
                contentType: 'application/json',
                body: JSON.stringify({
                    success: true,
                    allowLectureMaterialAccess: true,
                    units: [
                        { name: 'Unit 1', displayName: 'Unit 1' },
                        { name: 'Unit 2', displayName: 'Unit 2' },
                    ],
                    questions: [
                        {
                            questionId: QUESTION_IDS.mc,
                            lectureName: 'Unit 1',
                            questionType: 'multiple-choice',
                            question: 'Which biomolecule is the primary energy currency of the cell?',
                            options: { A: 'DNA', B: 'ATP', C: 'Glucose', D: 'Glycogen' },
                            difficulty: 'easy',
                            tags: ['energy'],
                            points: 1,
                        },
                    ],
                }),
            });
        });

        await loginAsStudent(page);
        await gotoQuizPage(page);

        await expect(page.locator('#question-card')).toBeVisible({ timeout: 10_000 });
        await page.locator('#unit-filter').selectOption('Unit 2');

        await expect(page.locator('#quiz-empty')).toBeVisible({ timeout: 10_000 });
        await expect(page.locator('#question-card')).toBeHidden();
        await expect(page.locator('#quiz-progress')).toBeHidden();
    });
});
