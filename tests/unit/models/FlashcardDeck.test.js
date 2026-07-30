const { memoryDb } = require('../helpers/memory-db');
const FlashcardDeck = require('../../../src/models/FlashcardDeck');

function sampleCards() {
    return [
        {
            front: 'What does ATP synthase produce?',
            back: 'ATP from ADP and inorganic phosphate.',
            source: { documentId: 'doc1', fileName: 'Lecture 1.pdf', chunkIndex: 2 }
        },
        {
            front: 'Where is the proton gradient formed?',
            back: 'Across the inner mitochondrial membrane.',
            source: { documentId: 'doc1', fileName: 'Lecture 1.pdf', chunkIndex: 3 }
        }
    ];
}

describe('FlashcardDeck', () => {
    test('creates a draft, publishes it, and keeps one shared unit deck', async () => {
        const db = memoryDb({});
        const draft = await FlashcardDeck.saveGeneratedDraft(db, {
            courseId: 'C1',
            lectureName: 'Unit 1',
            title: 'Energy',
            cards: sampleCards(),
            sourceDocumentIds: ['doc1'],
            generatedBy: 'i1'
        });

        expect(draft.deckId).toMatch(/^deck_[0-9a-f-]{36}$/i);
        expect(draft.hasDraft).toBe(true);
        expect(draft.draftCards).toHaveLength(2);
        expect(draft.draftCards[0].cardId).toMatch(/^fc_[0-9a-f-]{36}$/i);

        const published = await FlashcardDeck.publishDraft(db, draft.deckId, 'i1');
        expect(published).toMatchObject({
            isPublished: true,
            hasDraft: false,
            publishedVersion: 1,
            publishedBy: 'i1'
        });
        expect(published.publishedCards).toHaveLength(2);

        const visible = await FlashcardDeck.listPublishedDecks(db, 'C1', ['Unit 1']);
        expect(visible).toHaveLength(1);
    });

    test('preserves card ids when regenerating the same front', async () => {
        const db = memoryDb({});
        const first = await FlashcardDeck.saveGeneratedDraft(db, {
            courseId: 'C1', lectureName: 'Unit 1', cards: sampleCards(), generatedBy: 'i1'
        });
        const originalId = first.draftCards[0].cardId;

        const regenerated = await FlashcardDeck.saveGeneratedDraft(db, {
            courseId: 'C1',
            lectureName: 'Unit 1',
            cards: [{ ...sampleCards()[0], back: 'A revised answer.' }, sampleCards()[1]],
            generatedBy: 'i1'
        });
        expect(regenerated.deckId).toBe(first.deckId);
        expect(regenerated.draftCards[0].cardId).toBe(originalId);
    });

    test('validates blank and duplicate cards', () => {
        expect(() => FlashcardDeck.prepareCards([{ front: '', back: 'answer' }])).toThrow(/front and back/i);
        expect(() => FlashcardDeck.prepareCards([
            { front: 'Same', back: 'one' },
            { front: ' same ', back: 'two' }
        ])).toThrow(/unique/i);
    });

    test('marks a deck stale without removing its published cards', async () => {
        const db = memoryDb({});
        const draft = await FlashcardDeck.saveGeneratedDraft(db, {
            courseId: 'C1', lectureName: 'Unit 1', cards: sampleCards(), generatedBy: 'i1'
        });
        await FlashcardDeck.publishDraft(db, draft.deckId, 'i1');
        await FlashcardDeck.markUnitStale(db, 'C1', 'Unit 1');

        const deck = await FlashcardDeck.getDeckById(db, draft.deckId);
        expect(deck.isStale).toBe(true);
        expect(deck.isPublished).toBe(true);
        expect(deck.publishedCards).toHaveLength(2);
    });

    test('stores only per-student mastery and review counts', async () => {
        const db = memoryDb({});
        await FlashcardDeck.saveStudentReview(db, {
            studentId: 's1',
            courseId: 'C1',
            deckId: 'deck1',
            deckVersion: 2,
            cardId: 'card1',
            rating: 'again'
        });
        const progress = await FlashcardDeck.saveStudentReview(db, {
            studentId: 's1',
            courseId: 'C1',
            deckId: 'deck1',
            deckVersion: 2,
            cardId: 'card1',
            rating: 'know'
        });

        expect(progress.cards.card1).toMatchObject({ mastery: 'known', timesReviewed: 2 });
        expect(progress).not.toHaveProperty('publishedCards');
    });

    test('ensures deck and progress indexes', async () => {
        await expect(FlashcardDeck.ensureIndexes(memoryDb({}))).resolves.toBeUndefined();
    });
});
