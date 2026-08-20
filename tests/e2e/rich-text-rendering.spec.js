// @ts-check
/**
 * Chemistry and math rendering in AI-generated study content.
 *
 * Covers public/common/scripts/rich-text.js end to end: KaTeX typesets the
 * formulas, smiles-drawer draws the molecules, and a malformed SMILES string
 * costs the drawing rather than the whole card.
 */

const { test, expect } = require('./fixtures/monocart');
const { TEST_USERS, loadCredentials, storageStatePath } = require('./helpers/users');
const {
    QUIZ_COURSE_ID,
    QUESTION_IDS,
    getUserIdByUsername,
    resetQuizCourse,
    cleanupQuizCourse,
} = require('./helpers/quiz');

const FLASHCARD_COURSE_ID = 'RICHTEXT-UI-COURSE';

/**
 * Stub the two flashcard endpoints with a single-card deck.
 *
 * @param {import('@playwright/test').Page} page Page under test
 * @param {{front: string, back: string}} card Card content to serve
 * @returns {Promise<void>}
 */
async function stubDeck(page, card) {
    const deck = {
        deckId: 'deck1',
        courseId: FLASHCARD_COURSE_ID,
        lectureName: 'Unit 1',
        title: 'Chemistry Flashcards',
        version: 1,
        cardCount: 1,
        knownCount: 0,
    };

    await page.route('**/api/flashcards/student?**', async route => {
        await route.fulfill({
            status: 200,
            contentType: 'application/json',
            body: JSON.stringify({ success: true, data: [deck] }),
        });
    });
    await page.route('**/api/flashcards/student/deck1?**', async route => {
        await route.fulfill({
            status: 200,
            contentType: 'application/json',
            body: JSON.stringify({
                success: true,
                data: {
                    ...deck,
                    cards: [{
                        cardId: 'fc1',
                        front: card.front,
                        back: card.back,
                        source: { fileName: 'Lecture 1.pdf', chunkIndex: 0 },
                    }],
                    progress: {},
                },
            }),
        });
    });
}

/**
 * Report whether a canvas has any non-transparent pixel, i.e. something was
 * actually drawn into it rather than the element merely existing.
 *
 * @param {import('@playwright/test').Locator} canvas Canvas locator
 * @returns {Promise<boolean>} True when the canvas has visible content
 */
function canvasHasDrawing(canvas) {
    return canvas.evaluate((element) => {
        const node = /** @type {HTMLCanvasElement} */ (element);
        const context = node.getContext('2d');
        if (!context) return false;
        const { data } = context.getImageData(0, 0, node.width, node.height);
        for (let index = 3; index < data.length; index += 4) {
            if (data[index] !== 0) return true;
        }
        return false;
    });
}

test.describe('flashcard chemistry rendering', () => {
    test.use({ storageState: storageStatePath('student') });

    test.beforeEach(async ({ page }) => {
        await page.addInitScript((courseId) => {
            localStorage.setItem('selectedCourseId', courseId);
        }, FLASHCARD_COURSE_ID);
        await page.route('**/api/quiz/status?**', async route => {
            await route.fulfill({
                status: 200,
                contentType: 'application/json',
                body: JSON.stringify({ success: true, enabled: false }),
            });
        });
    });

    test('typesets inline math on both sides of a card', async ({ page }) => {
        await stubDeck(page, {
            front: 'What is the formula for water, \\( H_2O \\)?',
            back: 'Two hydrogens and one oxygen: \\( H_2O \\), molar mass \\( 18.02 \\) g/mol.',
        });

        await page.goto('/student/flashcards');
        await page.getByRole('button', { name: /Chemistry Flashcards/ }).click();

        const content = page.locator('#card-content');
        await expect(content.locator('.katex').first()).toBeVisible({ timeout: 10_000 });
        // The subscript is real markup, not the literal source string.
        await expect(content.locator('.katex sub, .katex .msupsub').first()).toBeAttached();
        await expect(content).not.toContainText('\\(');

        await page.locator('#study-card').click();
        await expect(content.locator('.katex')).toHaveCount(2, { timeout: 10_000 });
        await expect(content).toContainText('Two hydrogens and one oxygen');
    });

    test('draws a molecule from a SMILES tag', async ({ page }) => {
        await stubDeck(page, {
            front: 'Identify this molecule: [SMILES]C1=CC=CC=C1[/SMILES]',
            back: 'Benzene, an aromatic six-carbon ring.',
        });

        await page.goto('/student/flashcards');
        await page.getByRole('button', { name: /Chemistry Flashcards/ }).click();

        const canvas = page.locator('#card-content canvas.rich-smiles');
        await expect(canvas).toBeVisible({ timeout: 10_000 });
        await expect(canvas).toHaveAttribute('data-smiles', 'C1=CC=CC=C1');
        await expect(canvas).not.toHaveClass(/rich-smiles-error/);
        await expect.poll(() => canvasHasDrawing(canvas), { timeout: 10_000 }).toBe(true);

        // The tag itself never reaches the student.
        await expect(page.locator('#card-content')).not.toContainText('[SMILES]');
    });

    test('a malformed SMILES string degrades without breaking the card', async ({ page }) => {
        await stubDeck(page, {
            front: 'Broken structure: [SMILES]C1=CC=CC=C1)[/SMILES] — what should it be?',
            back: 'A closed aromatic ring.',
        });

        await page.goto('/student/flashcards');
        await page.getByRole('button', { name: /Chemistry Flashcards/ }).click();

        const content = page.locator('#card-content');
        const canvas = content.locator('canvas.rich-smiles');
        await expect(canvas).toHaveClass(/rich-smiles-error/, { timeout: 10_000 });
        await expect(canvas).toHaveAttribute('aria-label', 'Chemical structure could not be drawn');

        // The rest of the card is unaffected and the card still flips.
        await expect(content).toContainText('what should it be?');
        await page.locator('#study-card').click();
        await expect(content).toContainText('A closed aromatic ring.');
        await expect(page.locator('#review-actions')).toBeVisible();
    });

    test('model output is inserted as inert text, never as markup', async ({ page }) => {
        await stubDeck(page, {
            front: 'Tricky card <img src=x onerror="window.__xss = true"> and \\( H_2O \\)',
            back: 'Still text.',
        });

        await page.goto('/student/flashcards');
        await page.getByRole('button', { name: /Chemistry Flashcards/ }).click();

        const content = page.locator('#card-content');
        await expect(content).toContainText('<img src=x', { timeout: 10_000 });
        await expect(content.locator('img')).toHaveCount(0);
        expect(await page.evaluate(() => /** @type {any} */ (window).__xss)).toBeUndefined();
    });
});

test.describe('quiz chemistry rendering', () => {
    const studentUser = TEST_USERS.student;
    /** @type {string} */
    let studentPassword;
    /** @type {string} */
    let instructorId;

    test.beforeAll(async () => {
        studentPassword = loadCredentials().student;
        instructorId = await getUserIdByUsername(TEST_USERS.instructor.username);
    });

    test.afterAll(async () => {
        await cleanupQuizCourse();
    });

    test.beforeEach(async ({ page }) => {
        await resetQuizCourse({ instructorId, quizSettings: { enabled: true } });
        await page.route('**/api/quiz/questions?**', async route => {
            await route.fulfill({
                status: 200,
                contentType: 'application/json',
                body: JSON.stringify({
                    success: true,
                    allowLectureMaterialAccess: false,
                    units: [{ name: 'Unit 1', displayName: 'Unit 1' }],
                    questions: [{
                        questionId: QUESTION_IDS.mc,
                        lectureName: 'Unit 1',
                        questionType: 'multiple-choice',
                        question: 'Which molecule is shown here? [SMILES]C1=CC=CC=C1[/SMILES]',
                        options: {
                            A: 'Water, \\( H_2O \\)',
                            B: 'Benzene, \\( C_6H_6 \\)',
                            C: 'Methane, \\( CH_4 \\)',
                            D: 'Ammonia, \\( NH_3 \\)',
                        },
                        difficulty: 'easy',
                        tags: ['structure'],
                        points: 1,
                    }],
                }),
            });
        });
        await page.route('**/api/quiz/check-answer', async route => {
            await route.fulfill({
                status: 200,
                contentType: 'application/json',
                body: JSON.stringify({
                    success: true,
                    data: {
                        correct: true,
                        feedback: 'Correct. Benzene is \\( C_6H_6 \\), an aromatic ring.',
                        correctAnswer: 'B',
                    },
                }),
            });
        });
    });

    test('renders formulas and structures in the question, options, and feedback', async ({ page }) => {
        await page.goto('/');
        await page.locator('#auth-form input#username').fill(studentUser.username);
        await page.locator('#auth-form input#password').fill(studentPassword);
        await page.locator('#auth-form button#login-btn').click();
        await page.waitForURL((url) => url.pathname !== '/' && url.pathname !== '/login', { timeout: 10_000 });
        await page.goto(`/student/quiz?courseId=${QUIZ_COURSE_ID}`);

        const questionCanvas = page.locator('#question-text canvas.rich-smiles');
        await expect(questionCanvas).toBeVisible({ timeout: 10_000 });
        await expect(questionCanvas).not.toHaveClass(/rich-smiles-error/);
        await expect(page.locator('#question-text')).not.toContainText('[SMILES]');

        // Every option keeps its letter prefix and gains typeset math.
        const options = page.locator('#mc-options .option-text');
        await expect(options).toHaveCount(4);
        await expect(options.nth(1)).toContainText('B. Benzene,');
        await expect(options.nth(1).locator('.katex')).toHaveCount(1);
        await expect(page.locator('#mc-options')).not.toContainText('\\(');

        await page.locator('#mc-options input[value="B"]').check();
        await page.locator('#submit-btn').click();

        const feedback = page.locator('#feedback-text');
        await expect(feedback).toContainText('Correct. Benzene is', { timeout: 10_000 });
        await expect(feedback.locator('.katex')).toHaveCount(1);
        await expect(feedback).not.toContainText('\\(');
    });
});
