const { memoryDb } = require('../helpers/memory-db');
const flashcardService = require('../../../src/services/flashcardService');

describe('flashcardService content selection', () => {
    test('splits long material and samples across every document', () => {
        const documents = [
            {
                documentId: 'd1',
                originalName: 'One.pdf',
                content: Array.from({ length: 8 }, (_, index) => `Paragraph ${index}. ${'A'.repeat(300)}`).join('\n\n')
            },
            {
                documentId: 'd2',
                originalName: 'Two.pdf',
                content: Array.from({ length: 4 }, (_, index) => `Section ${index}. ${'B'.repeat(300)}`).join('\n\n')
            }
        ];
        const sources = flashcardService.buildSourceRecords(documents, 10000);
        expect(new Set(sources.map(source => source.documentId))).toEqual(new Set(['d1', 'd2']));
        expect(sources.some(source => source.chunkIndex > 0)).toBe(true);
    });

    test('uses a beginning/end/middle stratified order', () => {
        expect(flashcardService.stratifiedIndexes(5).slice(0, 3)).toEqual([0, 4, 2]);
    });
});

describe('flashcardService generated response validation', () => {
    const sources = [{
        sourceRef: 'S1',
        documentId: 'doc1',
        fileName: 'Lecture.pdf',
        chunkIndex: 0,
        text: 'ATP synthase produces ATP.'
    }];

    test('accepts source-grounded unique cards and attaches trusted source metadata', () => {
        const cards = flashcardService.parseGeneratedCards(JSON.stringify({
            cards: [{ front: 'What produces ATP?', back: 'ATP synthase.', sourceRef: 'S1' }]
        }), sources, 10);
        expect(cards).toEqual([{
            front: 'What produces ATP?',
            back: 'ATP synthase.',
            source: { documentId: 'doc1', fileName: 'Lecture.pdf', chunkIndex: 0 }
        }]);
    });

    test('drops invented source references and duplicate fronts', () => {
        expect(() => flashcardService.parseGeneratedCards(JSON.stringify({
            cards: [{ front: 'Unsupported', back: 'Nope', sourceRef: 'S99' }]
        }), sources, 10)).toThrow(/source-grounded/i);

        const cards = flashcardService.parseGeneratedCards(JSON.stringify({
            cards: [
                { front: 'Same?', back: 'First', sourceRef: 'S1' },
                { front: ' same? ', back: 'Second', sourceRef: 'S1' }
            ]
        }), sources, 10);
        expect(cards).toHaveLength(1);
    });

    test('generates and persists a draft from stored parsed text', async () => {
        const db = memoryDb({
            documents: [{
                documentId: 'doc1',
                courseId: 'C1',
                lectureName: 'Unit 1',
                originalName: 'Lecture.pdf',
                content: `Mitochondria create a proton gradient used by ATP synthase. ${'Details '.repeat(20)}`
            }]
        });
        const llmService = {
            sendMessage: jest.fn(async () => ({
                content: JSON.stringify({
                    cards: Array.from({ length: 5 }, (_, index) => ({
                        front: `Question ${index + 1}?`,
                        back: `Answer ${index + 1}.`,
                        sourceRef: 'S1'
                    }))
                })
            }))
        };
        const deck = await flashcardService.generateDeck({
            db,
            llmService,
            course: {
                courseId: 'C1',
                lectures: [{ name: 'Unit 1', displayName: 'Bioenergetics', learningObjectives: ['Explain ATP synthesis'] }]
            },
            lectureName: 'Unit 1',
            cardCount: 5,
            generatedBy: 'i1'
        });

        expect(deck.title).toBe('Bioenergetics Flashcards');
        expect(deck.draftCards).toHaveLength(5);
        expect(llmService.sendMessage).toHaveBeenCalledWith(
            expect.stringContaining('Explain ATP synthesis'),
            expect.objectContaining({ response_format: { type: 'json_object' } })
        );
    });
});
