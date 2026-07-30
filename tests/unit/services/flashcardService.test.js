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

    test('renders an editable prompt while preserving source and JSON requirements', () => {
        const prompt = flashcardService.buildPrompt({
            lectureName: 'Unit 3',
            cardCount: 10,
            learningObjectives: ['Compare pathway regulation'],
            sourceRecords: [{
                sourceRef: 'S1',
                fileName: 'Pathways.pdf',
                chunkIndex: 2,
                text: 'Pathway regulation material.'
            }],
            promptTemplate: 'Prioritize comparisons for {{lectureName}} using {{learningObjectives}}.'
        });

        expect(prompt).toContain('Prioritize comparisons for Unit 3 using 1. Compare pathway regulation.');
        expect(prompt).toContain('[S1] Pathways.pdf, section 3');
        expect(prompt).toContain('Generate exactly 10 cards');
        expect(prompt).toContain('"sourceRef": "S1"');
    });

    test('uses existing indexed chunks and preserves slide metadata', () => {
        const sources = flashcardService.buildSourceRecordsFromStoredChunks(
            [{
                documentId: 'd1',
                originalName: 'Slides.pptx',
                content: 'Mongo fallback content should not be used.'
            }],
            [{
                documentId: 'd1',
                fileName: 'Slides.pptx',
                chunkIndex: 6,
                chunkText: 'Existing Qdrant chunk.',
                slideNumber: 7
            }],
            12000
        );

        expect(sources).toEqual([expect.objectContaining({
            documentId: 'd1',
            chunkIndex: 6,
            text: 'Existing Qdrant chunk.',
            slideNumber: 7
        })]);
    });

    test('normalizes the configurable source token budget', () => {
        expect(flashcardService.normalizeSourceTokenBudget(24000)).toBe(24000);
        expect(flashcardService.normalizeSourceTokenBudget(1000)).toBe(12000);
        expect(flashcardService.normalizeSourceTokenBudget(50001)).toBe(12000);
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

    test('drops questions that depend on a vague lecture or unseen figure reference', () => {
        const cards = flashcardService.parseGeneratedCards(JSON.stringify({
            cards: [
                {
                    front: 'Based on lecture one, what do you think the figures show?',
                    back: 'A generic interpretation.',
                    sourceRef: 'S1'
                },
                {
                    front: 'How does ATP synthase use a proton gradient to produce ATP?',
                    back: 'It couples proton flow to rotational catalysis.',
                    sourceRef: 'S1'
                }
            ]
        }), sources, 10);

        expect(cards).toHaveLength(1);
        expect(cards[0].front).toMatch(/ATP synthase/);
        expect(flashcardService.hasVagueSourceReference('What does Figure 3 show?')).toBe(true);
        expect(flashcardService.hasVagueSourceReference('What variables appear on a Lineweaver-Burk plot?')).toBe(false);
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
        const qdrantService = {
            getUnitChunkRecords: jest.fn(async () => [{
                documentId: 'doc1',
                fileName: 'Lecture.pdf',
                chunkIndex: 4,
                chunkText: 'Indexed mitochondria and ATP synthase material.'
            }])
        };
        const deck = await flashcardService.generateDeck({
            db,
            llmService,
            qdrantService,
            course: {
                courseId: 'C1',
                lectures: [{ name: 'Unit 1', displayName: 'Bioenergetics', learningObjectives: ['Explain ATP synthesis'] }]
            },
            lectureName: 'Unit 1',
            cardCount: 5,
            generatedBy: 'i1',
            promptTemplate: 'Emphasize mechanisms for {{lectureName}}: {{courseMaterial}}',
            sourceTokenBudget: 24000
        });

        expect(deck.title).toBe('Bioenergetics Flashcards');
        expect(deck.draftCards).toHaveLength(5);
        expect(qdrantService.getUnitChunkRecords).toHaveBeenCalledWith('C1', 'Unit 1', ['doc1']);
        expect(llmService.sendMessage.mock.calls[0][0]).toContain('Indexed mitochondria and ATP synthase material.');
        expect(llmService.sendMessage.mock.calls[0][0]).not.toContain('Mitochondria create a proton gradient');
        expect(llmService.sendMessage).toHaveBeenCalledWith(
            expect.stringContaining('Emphasize mechanisms for Unit 1'),
            expect.objectContaining({ response_format: { type: 'json_object' } })
        );
    });
});
