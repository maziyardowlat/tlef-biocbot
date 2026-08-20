// @ts-check
const { test, expect } = require('./fixtures/monocart');

const SCRIPT_PATH = 'public/instructor/scripts/instructor-flashcards.js';

/** @param {string} id @param {string} front */
function card(id, front) {
    return {
        cardId: id,
        front,
        back: `${front} answer`,
        source: { documentId: 'doc1', fileName: 'Lecture.pdf', chunkIndex: 0 }
    };
}

/** @param {import('@playwright/test').Page} page @param {any} initialDeck */
async function loadHarness(page, initialDeck) {
    await page.setContent(`
        <section class="flashcards-section" data-flashcard-unit="Unit 1">
            <span id="flashcard-status-unit-1">Not generated</span>
            <p id="flashcard-message-unit-1"></p>
            <div id="flashcard-editor-unit-1"></div>
        </section>
    `);
    await page.evaluate((/** @type {any} */ deck) => {
        const testWindow = /** @type {any} */ (window);
        testWindow.testFlashcardState = { deck, putBodies: [], notifications: [] };
        testWindow.getCurrentCourseId = async () => 'C1';
        testWindow.RichText = {
            render: (/** @type {Element} */ element, /** @type {string} */ text) => {
                element.textContent = `Rendered: ${text}`;
            }
        };
        testWindow.showNotification = (/** @type {string} */ message, /** @type {string} */ type) => {
            testWindow.testFlashcardState.notifications.push({ message, type });
        };
        testWindow.fetch = async (/** @type {any} */ url, /** @type {any} */ options = {}) => {
            const method = options.method || 'GET';
            const state = testWindow.testFlashcardState;
            if (method === 'GET') {
                return {
                    ok: true,
                    json: async () => ({
                        success: true,
                        data: { units: [], decks: [state.deck] }
                    })
                };
            }
            if (method === 'PUT') {
                const body = JSON.parse(String(options.body || '{}'));
                state.putBodies.push(body);
                state.deck = { ...state.deck, hasDraft: true, draftCards: body.cards };
                return { ok: true, json: async () => ({ success: true, data: state.deck }) };
            }
            if (String(url).endsWith('/unpublish')) {
                state.deck = {
                    ...state.deck,
                    isPublished: false,
                    hasDraft: true,
                    draftCards: [...state.deck.publishedCards]
                };
                return { ok: true, json: async () => ({ success: true, data: state.deck }) };
            }
            if (String(url).endsWith('/publish')) {
                state.deck = {
                    ...state.deck,
                    isPublished: true,
                    hasDraft: false,
                    publishedVersion: state.deck.publishedVersion + 1,
                    publishedCards: [...state.deck.draftCards],
                    draftCards: []
                };
                return { ok: true, json: async () => ({ success: true, data: state.deck }) };
            }
            throw new Error(`Unexpected request: ${method} ${url}`);
        };
    }, initialDeck);
    await page.addScriptTag({ path: SCRIPT_PATH });
    await page.evaluate(() => /** @type {any} */ (window).loadFlashcardDecks());
}

test.describe('instructor flashcard editor', () => {
    test('shows live student previews for generated rich content', async ({ page }) => {
        await loadHarness(page, {
            deckId: 'deck1',
            courseId: 'C1',
            lectureName: 'Unit 1',
            title: 'Unit 1 Flashcards',
            hasDraft: true,
            isPublished: false,
            isStale: false,
            publishedVersion: 0,
            draftCards: [{
                ...card('fc1', 'Water is \\( H_2O \\)'),
                back: '[SMILES]CCO[/SMILES]'
            }],
            publishedCards: []
        });

        const previews = page.locator('.flashcard-rendered-preview');
        await expect(previews).toHaveCount(2);
        await expect(previews.nth(0)).toHaveText('Rendered: Water is \\( H_2O \\)');
        await expect(previews.nth(1)).toHaveText('Rendered: [SMILES]CCO[/SMILES]');

        await page.locator('.flashcard-back-input').fill('[SMILES]C1=CC=CC=C1[/SMILES]');
        await expect(previews.nth(1)).toHaveText('Rendered: [SMILES]C1=CC=CC=C1[/SMILES]');
    });

    test('removing a draft card persists immediately and survives a reload', async ({ page }) => {
        await loadHarness(page, {
            deckId: 'deck1',
            courseId: 'C1',
            lectureName: 'Unit 1',
            title: 'Unit 1 Flashcards',
            hasDraft: true,
            isPublished: false,
            isStale: false,
            publishedVersion: 0,
            draftCards: [card('fc1', 'First card'), card('fc2', 'Second card')],
            publishedCards: []
        });

        await page.getByRole('button', { name: 'Remove' }).first().click();
        await expect.poll(() => page.evaluate(() => /** @type {any} */ (window).testFlashcardState.putBodies.length)).toBe(1);
        await expect(page.locator('.flashcard-editor-row')).toHaveCount(1);
        await expect(page.locator('.flashcard-front-input')).toHaveValue('Second card');

        await page.evaluate(() => /** @type {any} */ (window).loadFlashcardDecks());
        await expect(page.locator('.flashcard-editor-row')).toHaveCount(1);
        await expect(page.locator('.flashcard-front-input')).toHaveValue('Second card');
    });

    test('unpublishing creates an editable draft that can be republished', async ({ page }) => {
        await loadHarness(page, {
            deckId: 'deck1',
            courseId: 'C1',
            lectureName: 'Unit 1',
            title: 'Unit 1 Flashcards',
            hasDraft: false,
            isPublished: true,
            isStale: false,
            publishedVersion: 1,
            draftCards: [],
            publishedCards: [card('fc1', 'Published card')]
        });

        await page.getByRole('button', { name: 'Unpublish' }).click();
        await expect(page.getByRole('button', { name: 'Publish to Students' })).toBeVisible();
        await expect(page.getByRole('button', { name: 'Remove' })).toBeVisible();

        await page.getByRole('button', { name: 'Publish to Students' }).click();
        await expect(page.getByRole('button', { name: 'Unpublish' })).toBeVisible();
        await expect(page.locator('#flashcard-status-unit-1')).toHaveText('Published v2');
    });

    test('recovers a deck left unpublished without a draft by the previous behavior', async ({ page }) => {
        await loadHarness(page, {
            deckId: 'deck1',
            courseId: 'C1',
            lectureName: 'Unit 1',
            title: 'Unit 1 Flashcards',
            hasDraft: false,
            isPublished: false,
            isStale: false,
            publishedVersion: 1,
            draftCards: [],
            publishedCards: [card('fc1', 'Recoverable card')]
        });

        await expect(page.locator('#flashcard-status-unit-1')).toHaveText('Unpublished draft');
        await expect(page.getByRole('button', { name: 'Remove' })).toBeVisible();
        await page.getByRole('button', { name: 'Publish to Students' }).click();
        await expect(page.locator('#flashcard-status-unit-1')).toHaveText('Published v2');
    });
});
