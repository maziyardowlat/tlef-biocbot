// @ts-check
/**
 * Reloading the chat page while BiocBot is writing a reply must not lose the
 * reply. The server finishes the run after the reload either way; it keeps the
 * finished reply for the conversation, and the page shows it once it's ready.
 *
 * The LLM stub answers the reply step slowly so the reload lands mid-reply.
 * The stub rules cover both the old chat path and the agent path
 * (AGENT_CHAT_MODES), so this spec checks whichever one the server runs.
 */

const { test, expect } = require('./fixtures/monocart');
const { TEST_USERS, storageStatePath } = require('./helpers/users');
const { getUserIdByUsername } = require('./helpers/quiz');
const {
    STU_COURSE_ID,
    getStudentId,
    resetStudentChatData,
    cleanupStudentChatData,
    setUserAgreement,
} = require('./helpers/student');
const { resetLlmStub, addLlmStubRule } = require('./helpers/llm-stub');

const UNIT = 'Unit 1';
const QUESTION = 'Where does glycolysis happen? (reload check)';
const REPLY = 'Glycolysis happens in the cytosol (Unit 1).';
const REPLY_DELAY_MS = 4000;

/** @type {string} */
let instructorId;
/** @type {string} */
let studentId;

test.use({ storageState: storageStatePath('student') });

test.beforeAll(async () => {
    instructorId = await getUserIdByUsername(TEST_USERS.instructor.username);
    studentId = await getStudentId();
});

test.afterAll(async ({ request: api }) => {
    await resetLlmStub(api);
    await cleanupStudentChatData();
});

test.beforeEach(async ({ request: api }) => {
    await resetStudentChatData({ instructorId });
    await setUserAgreement(studentId, true);
    await resetLlmStub(api);
    // Rules are tried in order. The tracker and the agent path's planner
    // answer at once; the step that writes the reply is slow.
    await addLlmStubRule(api, {
        matchSystemPrompt: 'analyzing student struggle',
        content: { isStruggling: false, mappedTopic: 'unmapped', matchConfidence: 0 },
    });
    await addLlmStubRule(api, {
        matchSystemPrompt: 'WRITING STEP',
        content: { reply: REPLY },
        delayMs: REPLY_DELAY_MS,
    });
    await addLlmStubRule(api, {
        matchSystemPrompt: 'PLANNING STEP',
        content: { approach: 'Guide them.', keyPoints: [{ point: 'It happens in the cytosol.', unit: UNIT }] },
    });
    // The old path's reply call is the only one that carries the course context.
    await addLlmStubRule(api, { matchMessage: 'Course context:', content: REPLY, delayMs: REPLY_DELAY_MS });
});

/**
 * Open the chat with an empty conversation. localStorage is seeded once, so a
 * reload keeps what the page saved.
 * @param {import('@playwright/test').Page} page
 */
async function openStudentChat(page) {
    await page.addInitScript(({ courseId, unitName, studentId }) => {
        if (sessionStorage.getItem('reloadSpecSeeded')) return;
        sessionStorage.setItem('reloadSpecSeeded', '1');
        localStorage.clear();
        localStorage.setItem('selectedCourseId', courseId);
        localStorage.setItem('selectedCourseName', 'BIOC E2E Student Chat');
        localStorage.setItem('selectedUnitName', unitName);
        localStorage.setItem('studentMode', 'tutor');
    }, { courseId: STU_COURSE_ID, unitName: UNIT, studentId });

    await page.goto('/student');
    await expect(page.locator('#chat-messages')).toContainText('No Questions Available', { timeout: 15_000 });
    await expect(page.locator('#chat-input')).toBeEnabled();
    // Let the page finish its startup autosave before sending.
    await page.waitForTimeout(750);
}

/**
 * Send the question and wait until the server has it.
 * @param {import('@playwright/test').Page} page
 */
async function sendQuestion(page) {
    const sent = page.waitForRequest(request => request.method() === 'POST' && new URL(request.url()).pathname === '/api/chat');
    await page.locator('#chat-input').fill(QUESTION);
    await page.locator('#chat-input').press('Enter');
    await sent;
    await expect(page.locator('#typing-indicator')).toBeVisible();
    // Comfortably inside the stub's delay: the server is running the request.
    await page.waitForTimeout(1000);
}

/**
 * @typedef {{ type: string, content: string, messageType?: string, messageId?: string | null }} SavedMessage
 */

/**
 * The saved chat's messages from the student's first one on (the welcome
 * message comes before it).
 * @param {import('@playwright/test').Page} page
 * @returns {Promise<SavedMessage[]>}
 */
async function savedMessages(page) {
    return page.evaluate((id) => {
        const chat = JSON.parse(localStorage.getItem(`biocbot_current_chat_${id}`) || '{}');
        /** @type {SavedMessage[]} */
        const messages = (chat.messages || []).filter(/** @param {SavedMessage} message */ message => message.messageType === 'regular-chat');
        return messages
            .slice(Math.max(0, messages.findIndex(message => message.type === 'user')))
            .map(message => ({ type: message.type, content: message.content, messageId: message.messageId || null }));
    }, studentId);
}

/** @param {import('@playwright/test').Page} page */
const replyBubbles = page => page.locator('#chat-messages .bot-message', { hasText: REPLY });

test.describe('Reloading during a reply', () => {
    test('shows the reply once the server finishes it', async ({ page }) => {
        await openStudentChat(page);
        await sendQuestion(page);

        await page.reload();

        // The reply isn't ready yet: the page shows that BiocBot is still writing.
        await expect(page.locator('#chat-messages .user-message', { hasText: QUESTION })).toHaveCount(1, { timeout: 15_000 });
        await expect(page.locator('#typing-indicator')).toBeVisible();
        await expect(replyBubbles(page)).toHaveCount(1, { timeout: 20_000 });
        await expect(page.locator('#typing-indicator')).toHaveCount(0);
        await expect(page.locator('#chat-input')).toBeEnabled();

        const saved = await savedMessages(page);
        expect(saved.map(({ type, content }) => ({ type, content }))).toEqual([
            { type: 'user', content: QUESTION },
            { type: 'bot', content: REPLY },
        ]);
        expect(saved[1].messageId).toMatch(/^msg_/);

        // Saved like a reply that arrived normally: another reload shows it once.
        await page.reload();
        await expect(page.locator('#chat-messages .user-message', { hasText: QUESTION })).toHaveCount(1, { timeout: 15_000 });
        await page.waitForTimeout(1500);
        await expect(replyBubbles(page)).toHaveCount(1);
        await expect(page.locator('#typing-indicator')).toHaveCount(0);
    });

    test('shows a reply that finished while the student was away', async ({ page, request: api }) => {
        await openStudentChat(page);
        await sendQuestion(page);
        const conversationId = await page.evaluate((id) => {
            const chat = JSON.parse(localStorage.getItem(`biocbot_current_chat_${id}`) || '{}');
            return chat.sessionInfo && chat.sessionInfo.sessionId;
        }, studentId);
        expect(conversationId).toBeTruthy();

        await page.goto('about:blank');
        await expect.poll(async () => {
            const res = await api.get('/api/chat/pending-reply', { params: { courseId: STU_COURSE_ID, conversationId } });
            return (await res.json()).state;
        }, { timeout: 20_000 }).toBe('ready');

        await page.goto('/student');

        await expect(replyBubbles(page)).toHaveCount(1, { timeout: 15_000 });
        await expect(page.locator('#chat-input')).toBeEnabled();
        const saved = await savedMessages(page);
        expect(saved.map(({ type }) => type)).toEqual(['user', 'bot']);
    });

    test('a reply that arrived normally is not added again after a reload', async ({ page }) => {
        await openStudentChat(page);
        await sendQuestion(page);
        await expect(replyBubbles(page)).toHaveCount(1, { timeout: 20_000 });

        await page.reload();

        await expect(page.locator('#chat-messages .user-message', { hasText: QUESTION })).toHaveCount(1, { timeout: 15_000 });
        await page.waitForTimeout(1500);
        await expect(replyBubbles(page)).toHaveCount(1);
        expect((await savedMessages(page)).map(({ type }) => type)).toEqual(['user', 'bot']);
    });
});
