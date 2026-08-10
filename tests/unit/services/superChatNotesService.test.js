/**
 * Unit tests for src/services/superChatNotesService.js.
 *
 * This service coordinates the SuperChatNote Mongo model (real over memory-db) with
 * the Qdrant vector store (mocked — it pulls config/embeddings at load). We assert
 * the orchestration the route layer can't see directly: vector backfill on create,
 * re-embed-only-when-content-changes on update, and the swallow-on-Qdrant-failure
 * behavior of delete. Shared spies let us check which Qdrant calls actually fired.
 */
const mockQdrant = {
    initialize: jest.fn(),
    addNote: jest.fn(),
    updateNote: jest.fn(),
    deleteNote: jest.fn(),
    findSimilarTo: jest.fn(),
};
jest.mock('../../../src/services/notesQdrantService', () => {
    const Mock = jest.fn(() => mockQdrant);
    Mock.DEFAULT_DUP_THRESHOLD = 0.88;
    return Mock;
});

const { memoryDb } = require('../helpers/memory-db');
const { buildEmbeddingProfile } = require('../../../src/services/embeddingConfig');
const { contentHash, needsIndexing } = require('../../../src/services/embeddingIndexService');
const service = require('../../../src/services/superChatNotesService');
const SuperChatNote = require('../../../src/models/SuperChatNote');

const COLLECTION = 'superchat_notes';

beforeAll(() => {
    jest.spyOn(console, 'error').mockImplementation(() => {});
});
afterAll(() => jest.restoreAllMocks());

beforeEach(() => {
    mockQdrant.initialize.mockResolvedValue(undefined);
    mockQdrant.addNote.mockResolvedValue(['pt-1']);
    mockQdrant.updateNote.mockResolvedValue(['pt-2']);
    mockQdrant.deleteNote.mockResolvedValue(undefined);
    mockQdrant.findSimilarTo.mockResolvedValue({ noteId: 'dup', score: 0.95 });
});

describe('DUP_THRESHOLD', () => {
    test('re-exports the Qdrant default duplicate threshold', () => {
        expect(service.DUP_THRESHOLD).toBe(0.88);
    });
});

describe('createNote', () => {
    test('persists the note then backfills the Qdrant point IDs', async () => {
        const db = memoryDb({});
        const note = await service.createNote(db, { authorId: 'i1', authorName: 'Dr', content: 'ATP', tags: ['bio'] }, { url: 'x' });

        expect(mockQdrant.initialize).toHaveBeenCalledWith({ url: 'x' });
        expect(mockQdrant.addNote).toHaveBeenCalledWith(note.noteId, 'ATP', expect.objectContaining({ authorId: 'i1' }));
        expect(note.qdrantPointIds).toEqual(['pt-1']);
        const saved = await db.collection(COLLECTION).findOne({ noteId: note.noteId });
        expect(saved.qdrantPointIds).toEqual(['pt-1']);
    });

    test('skips the backfill when Qdrant returns no point IDs', async () => {
        mockQdrant.addNote.mockResolvedValueOnce([]);
        const db = memoryDb({});
        const note = await service.createNote(db, { authorId: 'i1', content: 'ATP' });
        expect(note.qdrantPointIds).toEqual([]);
    });
});

describe('updateNote', () => {
    test('404 when the note does not exist', async () => {
        const result = await service.updateNote(memoryDb({}), 'nope', 'i1', { title: 'x' });
        expect(result).toMatchObject({ ok: false, status: 404 });
    });

    test('403 when the requester is not the author', async () => {
        const db = memoryDb({ [COLLECTION]: [{ noteId: 'n1', authorId: 'someone-else', content: 'a', isDeleted: false }] });
        const result = await service.updateNote(db, 'n1', 'i1', { title: 'x' });
        expect(result).toMatchObject({ ok: false, status: 403 });
    });

    test('does NOT re-embed when content is unchanged', async () => {
        const db = memoryDb({ [COLLECTION]: [{ noteId: 'n1', authorId: 'i1', content: 'same', isDeleted: false }] });
        const result = await service.updateNote(db, 'n1', 'i1', { title: 'New title', content: 'same' });
        expect(result.ok).toBe(true);
        expect(mockQdrant.updateNote).not.toHaveBeenCalled();
    });

    test('re-embeds and stores new point IDs when content changes', async () => {
        const db = memoryDb({ [COLLECTION]: [{ noteId: 'n1', authorId: 'i1', content: 'old', isDeleted: false }] });
        const result = await service.updateNote(db, 'n1', 'i1', { content: 'brand new content' }, { url: 'x' });
        expect(result.ok).toBe(true);
        expect(mockQdrant.updateNote).toHaveBeenCalledWith('n1', 'brand new content', expect.any(Object));
        expect(result.note.qdrantPointIds).toEqual(['pt-2']);
    });
});

describe('embedding index tracking', () => {
    const SANDBOX = buildEmbeddingProfile({
        provider: 'ubc-llm-sandbox', embeddingModel: 'qwen3-embedding-0.6b',
    });

    beforeEach(() => { mockQdrant.embeddingProfile = SANDBOX; });
    afterEach(() => { delete mockQdrant.embeddingProfile; });

    test('a new note records the profile it was embedded with', async () => {
        const db = memoryDb({});
        const note = await service.createNote(db, { authorId: 'i1', content: 'ATP' }, { url: 'x' });

        // Without this record the note looks like pre-tracking (legacy OpenAI)
        // content, and a migration to OpenAI would skip it as already indexed.
        const saved = await db.collection(COLLECTION).findOne({ noteId: note.noteId });
        expect(saved.embeddingIndexes[SANDBOX.storageKey]).toMatchObject({
            provider: 'ubc-llm-sandbox',
            collection: SANDBOX.notesCollection,
            contentHash: contentHash('ATP'),
            status: 'ready',
        });
        expect(needsIndexing(saved, SANDBOX, contentHash('ATP'))).toBe(false);
    });

    test('re-embedding an edited note updates the record to the new content', async () => {
        const db = memoryDb({ [COLLECTION]: [{ noteId: 'n1', authorId: 'i1', content: 'old', isDeleted: false }] });
        await service.updateNote(db, 'n1', 'i1', { content: 'brand new content' }, { url: 'x' });

        const saved = await db.collection(COLLECTION).findOne({ noteId: 'n1' });
        expect(saved.embeddingIndexes[SANDBOX.storageKey].contentHash)
            .toBe(contentHash('brand new content'));
        expect(needsIndexing(saved, SANDBOX, contentHash('brand new content'))).toBe(false);
    });

    test('an unchanged note is not re-recorded', async () => {
        const db = memoryDb({ [COLLECTION]: [{ noteId: 'n1', authorId: 'i1', content: 'same', isDeleted: false }] });
        await service.updateNote(db, 'n1', 'i1', { title: 'New title', content: 'same' });

        const saved = await db.collection(COLLECTION).findOne({ noteId: 'n1' });
        expect(saved.embeddingIndexes).toBeUndefined();
    });
});

describe('deleteNote', () => {
    test('404 / 403 guards mirror updateNote', async () => {
        expect(await service.deleteNote(memoryDb({}), 'nope', 'i1')).toMatchObject({ ok: false, status: 404 });
        const db = memoryDb({ [COLLECTION]: [{ noteId: 'n1', authorId: 'other', isDeleted: false }] });
        expect(await service.deleteNote(db, 'n1', 'i1')).toMatchObject({ ok: false, status: 403 });
    });

    test('soft-deletes the note and removes its vectors', async () => {
        const db = memoryDb({ [COLLECTION]: [{ noteId: 'n1', authorId: 'i1', isDeleted: false }] });
        const result = await service.deleteNote(db, 'n1', 'i1');
        expect(result).toEqual({ ok: true });
        expect(mockQdrant.deleteNote).toHaveBeenCalledWith('n1');
        expect((await db.collection(COLLECTION).findOne({ noteId: 'n1' })).isDeleted).toBe(true);
    });

    test('still reports success when the Qdrant delete fails (Mongo is the source of truth)', async () => {
        mockQdrant.deleteNote.mockRejectedValueOnce(new Error('qdrant down'));
        const db = memoryDb({ [COLLECTION]: [{ noteId: 'n1', authorId: 'i1', isDeleted: false }] });
        const result = await service.deleteNote(db, 'n1', 'i1');
        expect(result).toEqual({ ok: true });
        expect((await db.collection(COLLECTION).findOne({ noteId: 'n1' })).isDeleted).toBe(true);
    });
});

describe('checkSimilar', () => {
    test('probes Qdrant with the duplicate threshold and the exclude id', async () => {
        const similar = await service.checkSimilar(memoryDb({}), 'ATP energy', 'exclude-me', { url: 'x' });
        expect(similar).toMatchObject({ noteId: 'dup' });
        expect(mockQdrant.findSimilarTo).toHaveBeenCalledWith('ATP energy', { excludeNoteId: 'exclude-me', threshold: 0.88 });
    });
});

describe('incrementUsage', () => {
    test('bumps the usage counter for the named notes', async () => {
        const db = memoryDb({ [COLLECTION]: [
            { noteId: 'n1', usageCount: 0 },
            { noteId: 'n2', usageCount: 5 },
        ] });
        await service.incrementUsage(db, ['n1', 'n2']);
        expect((await db.collection(COLLECTION).findOne({ noteId: 'n1' })).usageCount).toBe(1);
        expect((await db.collection(COLLECTION).findOne({ noteId: 'n2' })).usageCount).toBe(6);
    });
});
