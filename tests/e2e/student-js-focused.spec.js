// @ts-check
/**
 * Focused browser coverage for public/student/scripts/student.js.
 *
 * These tests intentionally exercise client-side branches that are not covered
 * by the broader student API/history suite.
 */

const { test, expect } = require('./fixtures/monocart');
const { TEST_USERS, storageStatePath } = require('./helpers/users');
const { withDb, getUserIdByUsername } = require('./helpers/quiz');
const {
    STU_COURSE_ID,
    STU_OTHER_COURSE_ID,
    getStudentId,
    resetStudentChatData,
    cleanupStudentChatData,
    setUserAgreement,
} = require('./helpers/student');

/**
 * @typedef {Window & {
 *   addMessage?: (
 *     content: string,
 *     type?: string,
 *     showActions?: boolean,
 *     showFlag?: boolean,
 *     sourceAttribution?: Record<string, unknown> | null
 *   ) => void,
 *   renderPracticeQuestion?: (question: Record<string, unknown>) => void
 * }} StudentWindow
 */

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
});

async function openStudentChat(page, options = {}) {
    const {
        courseId = STU_COURSE_ID,
        courseName = 'BIOC E2E Student Chat',
        unitName = 'Unit 1',
        chatData = null,
    } = options;

    await page.addInitScript(({ courseId, courseName, unitName, studentId, chatData }) => {
        try {
            localStorage.clear();
            localStorage.setItem('selectedCourseId', courseId);
            localStorage.setItem('selectedCourseName', courseName);
            localStorage.setItem('selectedUnitName', unitName);

            const initialChatData = chatData || {
                metadata: {
                    courseId,
                    courseName,
                    studentId,
                    studentName: 'E2E Student',
                    unitName,
                    currentMode: 'tutor',
                    totalMessages: 0,
                    version: '1.0',
                },
                messages: [],
                practiceTests: null,
                studentAnswers: { answers: [] },
                sessionInfo: {
                    sessionId: `e2e_${courseId}_${unitName}`,
                    startTime: new Date().toISOString(),
                    duration: '0 minutes',
                },
                lastActivityTimestamp: new Date().toISOString(),
            };
            localStorage.setItem(`biocbot_current_chat_${studentId}`, JSON.stringify(initialChatData));
            localStorage.setItem(`biocbot_session_${studentId}_${courseId}_${unitName}`, initialChatData.sessionInfo.sessionId);
        } catch (_) {}
    }, { courseId, courseName, unitName, studentId, chatData });

    await page.goto('/student');
}

async function waitForStudentFunctions(page, names) {
    await page.waitForFunction((names) => names.every((name) => {
        const studentWindow = /** @type {StudentWindow & Record<string, unknown>} */ (/** @type {unknown} */ (window));
        return typeof studentWindow[name] === 'function';
    }), names);
}

async function waitForDirectChatReady(page) {
    await expect(page.locator('#chat-messages')).toContainText('No Questions Available', { timeout: 15_000 });
    await expect(page.locator('#chat-input')).toBeEnabled();
    await page.waitForTimeout(750);
}

test.describe('Course/unit initialization and saved state', () => {
    test('a unit with no assessment questions enables direct chat and preserves the selected unit', async ({ page }) => {
        await openStudentChat(page);

        await expect(page.locator('#unit-select')).toHaveValue('Unit 1', { timeout: 15_000 });
        await waitForDirectChatReady(page);
        await expect.poll(() => page.evaluate(() => localStorage.getItem('selectedUnitName'))).toBe('Unit 1');
    });

    test('does not restore recent saved chat data from a different course', async ({ page }) => {
        const leakedText = 'CROSS_COURSE_LOCALSTORAGE_LEAK_SENTINEL';
        await openStudentChat(page, {
            courseId: STU_COURSE_ID,
            chatData: {
                metadata: {
                    courseId: STU_OTHER_COURSE_ID,
                    courseName: 'BIOC E2E Student Chat (Other Course)',
                    studentId,
                    studentName: 'E2E Student',
                    unitName: 'Unit 1',
                    currentMode: 'tutor',
                    totalMessages: 1,
                    version: '1.0',
                },
                messages: [
                    {
                        type: 'bot',
                        content: leakedText,
                        messageType: 'regular-chat',
                        timestamp: new Date().toISOString(),
                    },
                ],
                practiceTests: null,
                studentAnswers: { answers: [] },
                sessionInfo: {
                    sessionId: 'e2e_cross_course_stale_session',
                    startTime: new Date().toISOString(),
                    duration: '0 minutes',
                },
                lastActivityTimestamp: new Date().toISOString(),
            },
        });

        await expect(page.locator('#chat-messages')).not.toContainText(leakedText, { timeout: 15_000 });
        await expect.poll(() => page.evaluate(() => localStorage.getItem('selectedCourseId'))).not.toBe(STU_OTHER_COURSE_ID);
    });
});

test.describe('Chat input request behavior', () => {
    test('empty submit does not call /api/chat or append a user message', async ({ page }) => {
        let chatCalls = 0;
        await page.route('/api/chat', async (route) => {
            chatCalls += 1;
            await route.fulfill({ json: { success: true, message: 'unexpected' } });
        });

        await openStudentChat(page);
        await waitForDirectChatReady(page);

        await page.locator('#chat-input').fill('   ');
        await page.locator('#send-button').click();
        await page.waitForTimeout(500);

        expect(chatCalls).toBe(0);
        await expect(page.locator('.user-message')).toHaveCount(0);
    });

    test('API failure removes the typing indicator and renders the generic chat error', async ({ page }) => {
        await page.route('/api/chat', async (route) => {
            await route.fulfill({
                status: 500,
                contentType: 'application/json',
                body: JSON.stringify({ success: false, message: 'simulated chat failure' }),
            });
        });

        await openStudentChat(page);
        await waitForDirectChatReady(page);

        await page.locator('#chat-input').fill('please fail');
        await page.locator('#chat-input').press('Enter');

        await expect(page.locator('#typing-indicator')).toHaveCount(0, { timeout: 10_000 });
        await expect(page.locator('#chat-messages')).toContainText('Sorry, I encountered an error processing your message.');
    });

    test('disables chat controls while a slow chat request is in flight', async ({ page }) => {
        /** @type {() => void} */
        let releaseResponse = () => {};
        const responseGate = new Promise((resolve) => {
            releaseResponse = () => resolve(undefined);
        });

        await page.route('/api/chat', async (route) => {
            await responseGate;
            await route.fulfill({
                json: {
                    success: true,
                    message: 'slow response finished',
                    sourceAttribution: { description: 'test source' },
                },
            });
        });

        await openStudentChat(page);
        await waitForDirectChatReady(page);

        await page.locator('#chat-input').fill('slow request');
        await page.locator('#chat-input').press('Enter');

        await expect(page.locator('#typing-indicator')).toBeVisible();
        await expect(page.locator('#chat-input')).toBeDisabled();
        await expect(page.locator('#send-button')).toBeDisabled();

        releaseResponse();
        await expect(page.locator('#typing-indicator')).toHaveCount(0, { timeout: 10_000 });
        await expect(page.locator('#chat-messages')).toContainText('slow response finished');
    });
});

test.describe('Source attribution and flag menus', () => {
    test('renders source fallback text, multiple downloads, and missing document metadata', async ({ page }) => {
        await openStudentChat(page);
        await waitForDirectChatReady(page);
        await waitForStudentFunctions(page, ['addMessage']);

        await page.evaluate(() => {
            const studentWindow = /** @type {StudentWindow} */ (window);

            studentWindow.addMessage?.(
                'Downloads disabled response',
                'bot',
                true,
                true,
                {
                    description: 'Instructor materials only',
                    downloadsEnabled: false,
                    documents: [{ documentId: 'doc_hidden', fileName: 'Hidden.pdf' }],
                }
            );
            studentWindow.addMessage?.(
                'Downloadable response',
                'bot',
                true,
                true,
                {
                    description: 'Should prefer documents',
                    downloadsEnabled: true,
                    documents: [
                        { documentId: 'doc_alpha', fileName: 'Alpha.pdf', lectureName: 'Unit 1' },
                        { documentId: 'doc_missing_name' },
                        { fileName: 'Ignored because missing id' },
                    ],
                }
            );
        });

        const disabledMessage = page.locator('.bot-message').filter({ hasText: 'Downloads disabled response' });
        await expect(disabledMessage.locator('.message-source')).toHaveText('Source: Instructor materials only');
        await expect(disabledMessage.locator('.message-source a')).toHaveCount(0);

        const downloadableMessage = page.locator('.bot-message').filter({ hasText: 'Downloadable response' });
        await expect(downloadableMessage.locator('.message-source a')).toHaveCount(2);
        await expect(downloadableMessage.locator('.message-source')).toContainText('Alpha.pdf (Unit 1)');
        await expect(downloadableMessage.locator('.message-source')).toContainText('Source Document');
        await expect(downloadableMessage.locator('.message-source a').first()).toHaveAttribute(
            'href',
            new RegExp(`/api/chat/source-documents/doc_alpha/download\\?courseId=${STU_COURSE_ID}`)
        );
    });

    test('flag menu closes on outside click and submits the selected reason', async ({ page }) => {
        /** @type {{ flagReason?: string, courseId?: string } | undefined} */
        let flagPayload;
        await page.route('/api/flags', async (route) => {
            flagPayload = route.request().postDataJSON();
            await route.fulfill({ json: { success: true } });
        });

        await openStudentChat(page);
        await waitForDirectChatReady(page);
        await waitForStudentFunctions(page, ['addMessage']);
        await page.evaluate(() => {
            const studentWindow = /** @type {StudentWindow} */ (window);
            studentWindow.addMessage?.('Flaggable bot response', 'bot', false, true, null);
        });

        const message = page.locator('.bot-message').filter({ hasText: 'Flaggable bot response' }).last();
        await message.locator('.flag-button').click();
        const flagMenu = page.locator('.flag-menu').last();
        await expect(flagMenu).toHaveClass(/show/);

        await page.locator('body').click({ position: { x: 5, y: 5 } });
        await expect(flagMenu).not.toHaveClass(/show/);

        await message.locator('.flag-button').click();
        await expect(flagMenu).toHaveClass(/show/);
        await flagMenu.locator('.flag-option', { hasText: 'Unclear' }).click();

        await expect(page.locator('#chat-messages')).toContainText('Thank you for reporting this response as unclear or confusing content');
        await expect.poll(() => flagPayload?.flagReason).toBe('unclear');
        if (!flagPayload) {
            throw new Error('Expected flag payload to be submitted');
        }
        expect(flagPayload.courseId).toBe(STU_COURSE_ID);
    });
});

test.describe('Practice question UI', () => {
    test('validates unanswered multiple-choice and short-answer practice questions before calling the API', async ({ page }) => {
        let checkCalls = 0;
        await page.route('/api/chat/check-practice-answer', async (route) => {
            checkCalls += 1;
            await route.fulfill({ json: { success: true, data: { correct: true, feedback: 'ok', correctAnswer: 'A' } } });
        });

        await openStudentChat(page);
        await waitForDirectChatReady(page);
        await waitForStudentFunctions(page, ['renderPracticeQuestion']);

        await page.evaluate(() => {
            const studentWindow = /** @type {StudentWindow} */ (window);

            studentWindow.renderPracticeQuestion?.({
                practiceId: 'pq_mc_validation',
                questionType: 'multiple-choice',
                question: 'Which option is correct?',
                options: { A: 'Alpha', B: 'Beta' },
            });
            studentWindow.renderPracticeQuestion?.({
                practiceId: 'pq_sa_validation',
                questionType: 'short-answer',
                question: 'Explain briefly.',
            });
        });

        const mc = page.locator('[data-practice-id="pq_mc_validation"]');
        await mc.locator('.practice-submit-btn').click();
        await expect(mc.locator('.practice-feedback')).toContainText('Please select an answer.');

        const shortAnswer = page.locator('[data-practice-id="pq_sa_validation"]');
        await shortAnswer.locator('.practice-submit-btn').click();
        await expect(shortAnswer.locator('.practice-feedback')).toContainText('Please type your answer.');

        expect(checkCalls).toBe(0);
    });

    test('renders true/false completion and recovers from check-answer API failure', async ({ page }) => {
        await page.route('/api/chat/check-practice-answer', async (route) => {
            const body = route.request().postDataJSON();
            if (body.practiceId === 'pq_tf_success') {
                await route.fulfill({
                    json: {
                        success: true,
                        data: {
                            correct: false,
                            feedback: 'Review the definition again.',
                            correctAnswer: 'True',
                        },
                    },
                });
                return;
            }

            await route.fulfill({ json: { success: false, message: 'check failed' } });
        });

        await openStudentChat(page);
        await waitForDirectChatReady(page);
        await waitForStudentFunctions(page, ['renderPracticeQuestion']);

        await page.evaluate(() => {
            const studentWindow = /** @type {StudentWindow} */ (window);

            studentWindow.renderPracticeQuestion?.({
                practiceId: 'pq_tf_success',
                questionType: 'true-false',
                question: 'BiocBot is deterministic.',
            });
            studentWindow.renderPracticeQuestion?.({
                practiceId: 'pq_mc_failure',
                questionType: 'multiple-choice',
                question: 'Which answer should fail?',
                options: { A: 'One', B: 'Two' },
            });
        });

        const tf = page.locator('[data-practice-id="pq_tf_success"]');
        await tf.locator('input[value="False"]').check();
        await tf.locator('.practice-submit-btn').click();
        await expect(page.locator('.practice-completed').filter({ hasText: 'Review the definition again.' })).toBeVisible();

        const failed = page.locator('[data-practice-id="pq_mc_failure"]');
        await failed.locator('input[value="A"]').check();
        await failed.locator('.practice-submit-btn').click();
        await expect(failed.locator('.practice-feedback')).toContainText('check failed');
        await expect(failed.locator('.practice-submit-btn')).toBeEnabled();
    });
});

test.describe('Assessment calibration', () => {
    test('mixed assessment question types can fail into tutor mode', async ({ page }) => {
        await withDb(async (db) => {
            await db.collection('courses').updateOne(
                { courseId: STU_COURSE_ID, 'lectures.name': 'Unit 1' },
                {
                    $set: {
                        'lectures.$.passThreshold': 3,
                        'lectures.$.assessmentQuestions': [
                            {
                                questionId: 'e2e_mixed_mc',
                                questionType: 'multiple-choice',
                                question: 'Which letter is correct?',
                                options: { A: 'Correct', B: 'Incorrect' },
                                correctAnswer: 'A',
                                explanation: 'A is correct.',
                            },
                            {
                                questionId: 'e2e_mixed_tf',
                                questionType: 'true-false',
                                question: 'This statement is true.',
                                correctAnswer: 'True',
                                explanation: 'It is true.',
                            },
                            {
                                questionId: 'e2e_mixed_sa',
                                questionType: 'short-answer',
                                question: 'Explain the concept.',
                                correctAnswer: 'A detailed explanation',
                                explanation: 'Expected detail.',
                            },
                        ],
                    },
                }
            );
        });

        await page.route('/api/questions/check-answer', async (route) => {
            await route.fulfill({
                json: {
                    success: true,
                    data: { correct: false, feedback: 'Needs more detail.' },
                },
            });
        });

        await openStudentChat(page);

        await expect(page.locator('#calibration-question-0')).toContainText('Which letter is correct?', { timeout: 15_000 });
        await page.locator('#calibration-question-0 .calibration-option', { hasText: 'B. Incorrect' }).click();

        await expect(page.locator('#calibration-question-1')).toContainText('This statement is true.');
        await page.locator('#calibration-question-1 .calibration-option', { hasText: 'False' }).click();

        await expect(page.locator('#calibration-question-2')).toContainText('Explain the concept.');
        await page.locator('#calibration-question-2 .calibration-answer-input').fill('too short');
        await page.locator('#calibration-question-2 .calibration-submit-btn').click();

        await expect(page.locator('.mode-result')).toContainText('BiocBot is in tutor mode', { timeout: 10_000 });
        await expect.poll(() => page.evaluate(() => localStorage.getItem('studentMode'))).toBe('tutor');
        await expect(page.locator('#chat-input')).toBeEnabled();
    });
});
