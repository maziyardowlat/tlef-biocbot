// @ts-check
const { test, expect } = require('./fixtures/monocart');
const { storageStatePath } = require('./helpers/users');

const COURSE_ID = 'FLASHCARD-UI-COURSE';

test.describe('student flashcards page', () => {
    test.use({ storageState: storageStatePath('student') });

    test.beforeEach(async ({ page }) => {
        await page.addInitScript((courseId) => {
            localStorage.setItem('selectedCourseId', courseId);
        }, COURSE_ID);
        await page.route('**/api/quiz/status?**', async route => {
            await route.fulfill({
                status: 200,
                contentType: 'application/json',
                body: JSON.stringify({ success: true, enabled: false })
            });
        });
    });

    test('opens, flips, cites, and reviews an instructor-published deck', async ({ page }) => {
        await page.route('**/api/flashcards/student?**', async route => {
            await route.fulfill({
                status: 200,
                contentType: 'application/json',
                body: JSON.stringify({
                    success: true,
                    data: [{
                        deckId: 'deck1',
                        courseId: COURSE_ID,
                        lectureName: 'Unit 1',
                        title: 'Enzyme Flashcards',
                        version: 1,
                        cardCount: 1,
                        knownCount: 0
                    }]
                })
            });
        });
        await page.route('**/api/flashcards/student/deck1?**', async route => {
            await route.fulfill({
                status: 200,
                contentType: 'application/json',
                body: JSON.stringify({
                    success: true,
                    data: {
                        deckId: 'deck1',
                        courseId: COURSE_ID,
                        lectureName: 'Unit 1',
                        title: 'Enzyme Flashcards',
                        version: 1,
                        cardCount: 1,
                        knownCount: 0,
                        cards: [{
                            cardId: 'fc1',
                            front: 'What lowers activation energy?',
                            back: 'An enzyme lowers the activation energy of a reaction.',
                            source: { fileName: 'Lecture 1.pdf', chunkIndex: 2 }
                        }],
                        progress: {}
                    }
                })
            });
        });
        await page.route('**/api/flashcards/student/deck1/review', async route => {
            expect(route.request().postDataJSON()).toMatchObject({
                courseId: COURSE_ID,
                cardId: 'fc1',
                rating: 'know'
            });
            await route.fulfill({
                status: 200,
                contentType: 'application/json',
                body: JSON.stringify({ success: true, data: { mastery: 'known', timesReviewed: 1 } })
            });
        });

        await page.goto('/student/flashcards');
        await expect(page.getByRole('heading', { name: 'Flashcards', level: 1 })).toBeVisible();
        await expect(page.locator('#quiz-nav-item')).toBeHidden();
        await page.getByRole('button', { name: /Enzyme Flashcards/ }).click();

        const card = page.getByRole('button', { name: /What lowers activation energy/ });
        await expect(card).toBeVisible();
        await card.click();
        await expect(page.getByText('An enzyme lowers the activation energy of a reaction.')).toBeVisible();
        await expect(page.getByText('Source: Lecture 1.pdf, section 3')).toBeVisible();
        await page.getByRole('button', { name: /Know it/ }).click();
        await expect(page.getByRole('heading', { name: 'Deck complete' })).toBeVisible();
    });

    test('shows a useful empty state when no deck is published', async ({ page }) => {
        await page.route('**/api/flashcards/student?**', async route => {
            await route.fulfill({
                status: 200,
                contentType: 'application/json',
                body: JSON.stringify({ success: true, data: [] })
            });
        });
        await page.goto('/student/flashcards');
        await expect(page.getByRole('heading', { name: 'No flashcard decks yet' })).toBeVisible();
    });
});
