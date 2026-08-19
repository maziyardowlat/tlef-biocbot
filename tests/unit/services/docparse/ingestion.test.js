/**
 * documentIngestion's parsing-service path, end to end over the memory db.
 *
 * The three things worth protecting here are the ones the integration exists
 * for: the upload call must not wait for a parse, `pages`/`headings` must reach
 * the Qdrant payload, and a document must never be left saying "processing".
 */
jest.mock('ubc-genai-toolkit-document-parsing', () => ({ DocumentParsingModule: jest.fn() }));
jest.mock('ubc-genai-toolkit-core', () => ({ ConsoleLogger: jest.fn() }));
jest.mock('../../../../src/services/gridfs', () => ({
    uploadBuffer: jest.fn(async () => 'grid-file-1')
}));

const { Readable } = require('stream');

const { memoryDb } = require('../../helpers/memory-db');
const DocumentModel = require('../../../../src/models/Document');
const { ingestFileBuffer } = require('../../../../src/services/documentIngestion');
const { resetDocParse } = require('../../../../src/services/docparse');

const PDF = 'application/pdf';
const PPTX = 'application/vnd.openxmlformats-officedocument.presentationml.presentation';

const ENV = {
    DOCPARSE_ENABLED: 'true',
    DOCPARSE_BASE_URL: 'http://parsing.test',
    DOCPARSE_API_KEY: 'test-key',
    DOCPARSE_POLL_INTERVAL_MS: '1',
    DOCPARSE_POLL_MAX_INTERVAL_MS: '1',
    // Short so a detached tracker cannot outlive the test it belongs to. The
    // real default is 30 minutes, which has to outlast the service's own
    // 1200s worker timeout.
    DOCPARSE_POLL_TIMEOUT_MS: '300'
};

/**
 * A fake gateway. `statuses` is walked one entry per poll, so a test can make a
 * job queue, fail transiently, and recover.
 */
function fakeGateway({ statuses, chunks = [], uploadStatus = 200 }) {
    let poll = 0;
    const seen = { created: null, uploadedTo: null };

    const fetchImpl = jest.fn(async (url, init = {}) => {
        const href = String(url);
        if (href.endsWith('/v1/documents') && init.method === 'POST') {
            seen.created = JSON.parse(init.body);
            return {
                ok: true, status: 201, headers: { get: () => null },
                json: async () => ({
                    job_id: 'job-1',
                    upload: { url: '/v1/uploads/ticket', ticket: 'ticket', max_bytes: 104857600 }
                })
            };
        }
        if (href.includes('/v1/uploads/')) {
            seen.uploadedTo = href;
            return {
                ok: uploadStatus === 200, status: uploadStatus, headers: { get: () => null },
                json: async () => (uploadStatus === 200
                    ? { job_id: 'job-1', status: 'queued', bytes_received: 4 }
                    : { reason: 'too_large' })
            };
        }
        if (href.includes('/chunks')) {
            return {
                ok: true, status: 200, headers: { get: () => null },
                body: Readable.from(chunks.map((c) => Buffer.from(`${JSON.stringify(c)}\n`)))
            };
        }
        // Status poll.
        const next = statuses[Math.min(poll, statuses.length - 1)];
        poll += 1;
        if (next.httpStatus) {
            return {
                ok: false, status: next.httpStatus, headers: { get: () => null },
                json: async () => ({ reason: next.reason })
            };
        }
        return { ok: true, status: 200, headers: { get: () => null }, json: async () => next };
    });

    return { fetchImpl, seen, polls: () => poll };
}

function makeAi() {
    const storeChunks = jest.fn(async (documentData, chunks) =>
        chunks.map((_, i) => ({ id: `pt-${i}`, chunkIndex: i })));
    return {
        llm: { isReady: () => false },
        qdrant: {
            embeddingProfile: null,
            generateEmbeddings: jest.fn(async (chunks) => chunks.map(() => [0.1, 0.2])),
            storeChunks,
            deleteDocumentChunks: jest.fn(async () => ({ success: true })),
            processAndStoreDocument: jest.fn(async () => ({ success: true, chunksStored: 0 }))
        }
    };
}

function ingestArgs(db, ai, overrides = {}) {
    return {
        db,
        ai,
        buffer: Buffer.from('%PDF'),
        originalName: 'lecture.pdf',
        mimeType: PDF,
        size: 4,
        courseId: 'course-1',
        lectureName: 'Unit 1',
        documentType: 'lecture-notes',
        instructorId: 'instructor-1',
        env: ENV,
        awaitParse: true,
        ...overrides
    };
}

/** Waits for a detached tracker to reach `predicate`, or fails loudly. */
async function settle(predicate, { tries = 200 } = {}) {
    for (let i = 0; i < tries; i++) {
        if (predicate()) return;
        await new Promise((resolve) => setTimeout(resolve, 5));
    }
    throw new Error('background parse did not settle');
}

let db;
let ai;

beforeEach(async () => {
    resetDocParse();
    db = memoryDb();
    ai = makeAi();
    await db.collection('courses').insertOne({
        courseId: 'course-1',
        instructorId: 'instructor-1',
        lectures: [{ name: 'Unit 1', documents: [] }]
    });
});

afterEach(() => resetDocParse());

/** Point the memoised client at this test's fake gateway. */
function useGateway(gateway) {
    const { getDocParse } = require('../../../../src/services/docparse');
    const docparse = getDocParse(ENV);
    docparse.client.fetch = gateway.fetchImpl;
    return docparse;
}

describe('ingestFileBuffer via the parsing service', () => {
    test('carries pages and headings into the Qdrant chunk payload', async () => {
        const gateway = fakeGateway({
            statuses: [{ status: 'processing' }, { status: 'done', metadata: { warnings: [] } }],
            chunks: [
                { index: 0, text: 'Intro text', pages: [1], headings: ['Introduction'] },
                { index: 1, text: 'Assay text', pages: [4, 5], headings: ['Methods', 'Assay'] }
            ]
        });
        useGateway(gateway);

        const { result, qdrantResult, jobId } = await ingestFileBuffer(ingestArgs(db, ai));

        expect(jobId).toBe('job-1');
        expect(qdrantResult).toMatchObject({ success: true, chunksStored: 2 });

        const [documentData, chunks] = ai.qdrant.storeChunks.mock.calls[0];
        expect(chunks).toEqual(['Intro text', 'Assay text']);
        expect(documentData.chunkMetadata[0]).toMatchObject({ pages: [1], headings: ['Introduction'] });
        expect(documentData.chunkMetadata[1]).toMatchObject({ pages: [4, 5], headings: ['Methods', 'Assay'] });
        expect(documentData.documentId).toBe(result.documentId);

        const stored = await db.collection('documents').findOne({ documentId: result.documentId });
        expect(stored.status).toBe('uploaded');
        expect(stored.content).toBe('Intro text\n\nAssay text');
        expect(stored.metadata.parsing).toMatchObject({ status: 'ready', jobId: 'job-1', chunkCount: 2 });
    });

    test('requests chunking at create time — it cannot be added to an existing job', async () => {
        const gateway = fakeGateway({
            statuses: [{ status: 'done', metadata: { warnings: [] } }],
            chunks: [{ index: 0, text: 'text', pages: [1] }]
        });
        useGateway(gateway);

        await ingestFileBuffer(ingestArgs(db, ai));

        expect(gateway.seen.created.options.chunk).toEqual({
            strategy: 'word', max_words: 400, overlap: 0
        });
        expect(gateway.seen.uploadedTo).toBe('http://parsing.test/v1/uploads/ticket');
    });

    test('returns without waiting for the parse when awaitParse is false', async () => {
        // The gate holds the first status poll open, so the assertions below run
        // at a moment when the parse provably has not finished.
        let releasePoll;
        const held = new Promise((resolve) => { releasePoll = resolve; });
        const gateway = fakeGateway({
            statuses: [{ status: 'done', metadata: { warnings: [] } }],
            chunks: [{ index: 0, text: 'late arrival', pages: [1] }]
        });
        const original = gateway.fetchImpl;
        useGateway({
            fetchImpl: jest.fn(async (url, init) => {
                if (String(url).endsWith('/v1/documents/job-1')) await held;
                return original(url, init);
            })
        });

        const outcome = await ingestFileBuffer(ingestArgs(db, ai, { awaitParse: false }));

        // The caller already has a document id and a job id, with the parse
        // still outstanding behind it.
        expect(outcome.jobId).toBe('job-1');
        expect(outcome.qdrantResult).toBeNull();
        expect(outcome.result.documentId).toBeTruthy();
        const pending = await db.collection('documents').findOne({ documentId: outcome.result.documentId });
        expect(pending.metadata.parsing.status).toBe('processing');
        expect(pending.content).toBe('');
        expect(ai.qdrant.storeChunks).not.toHaveBeenCalled();

        // Let the background finish and confirm it lands on its own.
        releasePoll();
        await settle(() => ai.qdrant.storeChunks.mock.calls.length > 0);
        const finished = await db.collection('documents').findOne({ documentId: outcome.result.documentId });
        expect(finished.metadata.parsing.status).toBe('ready');
        expect(finished.content).toBe('late arrival');
    });

    test('does not report a failure while the service is still retrying a transient fault', async () => {
        const gateway = fakeGateway({
            statuses: [
                { status: 'failed', reason: 'scan_unavailable' },
                { status: 'failed', reason: 'scan_unavailable' },
                { status: 'done', metadata: { warnings: [] } }
            ],
            chunks: [{ index: 0, text: 'recovered', pages: [1] }]
        });
        useGateway(gateway);
        const phases = [];

        const { result, qdrantResult } = await ingestFileBuffer(ingestArgs(db, ai, {
            onProgress: ({ phase, status, reason }) => phases.push({ phase, status, reason })
        }));

        expect(qdrantResult.success).toBe(true);
        const stored = await db.collection('documents').findOne({ documentId: result.documentId });
        expect(stored.metadata.parsing.status).toBe('ready');
        // The transient failure was reported as progress, not as an outcome.
        expect(phases.filter((p) => p.phase === 'parsing').map((p) => p.reason))
            .toContain('scan_unavailable');
    });

    test('records a terminal failure instead of leaving the document processing', async () => {
        const gateway = fakeGateway({
            statuses: [{ status: 'failed', reason: 'parse_error' }]
        });
        useGateway(gateway);

        const { result, qdrantResult } = await ingestFileBuffer(ingestArgs(db, ai));

        expect(qdrantResult).toMatchObject({ success: false, reason: 'parse_error' });
        const stored = await db.collection('documents').findOne({ documentId: result.documentId });
        expect(stored.status).toBe('parse-failed');
        expect(stored.metadata.parsing).toMatchObject({ status: 'failed', reason: 'parse_error' });
        expect(stored.metadata.parsing.message).toMatch(/corrupt/i);
        expect(ai.qdrant.storeChunks).not.toHaveBeenCalled();
    });

    test('a job record that ages out mid-poll ends as a failure, not a hang', async () => {
        const gateway = fakeGateway({
            statuses: [{ status: 'processing' }, { httpStatus: 404, reason: 'not_found' }]
        });
        useGateway(gateway);

        const { result } = await ingestFileBuffer(ingestArgs(db, ai));

        const stored = await db.collection('documents').findOne({ documentId: result.documentId });
        expect(stored.status).toBe('parse-failed');
        expect(stored.metadata.parsing.reason).toBe('not_found');
    });

    test('an unreachable gateway mid-parse fails the document rather than stranding it', async () => {
        // The upload succeeds and then the gateway goes away — a restart, a
        // crashed container, a dropped network. Nothing will ever revisit this
        // document, so it must not be left saying "processing".
        const gateway = fakeGateway({ statuses: [{ status: 'processing' }] });
        const original = gateway.fetchImpl;
        useGateway({
            fetchImpl: jest.fn(async (url, init) => {
                if (String(url).endsWith('/v1/documents/job-1')) {
                    throw Object.assign(new TypeError('fetch failed'), { cause: 'ECONNREFUSED' });
                }
                return original(url, init);
            })
        });

        const { result, qdrantResult } = await ingestFileBuffer(ingestArgs(db, ai));

        expect(qdrantResult).toMatchObject({ success: false, reason: 'tracker_error' });
        const stored = await db.collection('documents').findOne({ documentId: result.documentId });
        expect(stored.status).toBe('parse-failed');
        expect(stored.metadata.parsing.status).toBe('failed');
        expect(stored.metadata.parsing.message).toBeTruthy();
    });

    test('keeps the text when Qdrant indexing fails, so the parse is not lost', async () => {
        const gateway = fakeGateway({
            statuses: [{ status: 'done', metadata: { warnings: [] } }],
            chunks: [{ index: 0, text: 'still here', pages: [1] }]
        });
        useGateway(gateway);
        ai.qdrant.generateEmbeddings.mockRejectedValueOnce(new Error('qdrant down'));

        const { result, qdrantResult } = await ingestFileBuffer(ingestArgs(db, ai));

        expect(qdrantResult.success).toBe(false);
        const stored = await db.collection('documents').findOne({ documentId: result.documentId });
        expect(stored.content).toBe('still here');
        expect(stored.metadata.parsing).toMatchObject({ status: 'ready', indexed: false });
    });

    test('batches embeddings and Qdrant writes while preserving global chunk indexes', async () => {
        const chunks = Array.from({ length: 5 }, (_, index) => ({
            index,
            text: `chunk ${index}`,
            pages: [index + 1]
        }));
        const gateway = fakeGateway({
            statuses: [{ status: 'done', metadata: { warnings: [] } }],
            chunks
        });
        useGateway(gateway);

        const { qdrantResult } = await ingestFileBuffer(ingestArgs(db, ai, {
            env: { ...ENV, DOCPARSE_EMBED_BATCH_SIZE: '2' }
        }));

        expect(qdrantResult).toMatchObject({ success: true, chunksStored: 5 });
        expect(ai.qdrant.generateEmbeddings).toHaveBeenCalledTimes(3);
        expect(ai.qdrant.storeChunks).toHaveBeenCalledTimes(3);
        expect(ai.qdrant.storeChunks.mock.calls.map(([data]) => [data.chunkIndexOffset, data.totalChunks]))
            .toEqual([[0, 5], [2, 5], [4, 5]]);
    });

    test('records result-fetch failures instead of leaving the document processing', async () => {
        const gateway = fakeGateway({
            statuses: [{ status: 'done', metadata: { warnings: [] } }],
            chunks: []
        });
        const original = gateway.fetchImpl;
        useGateway({
            fetchImpl: jest.fn(async (url, init) => {
                if (String(url).includes('/chunks')) {
                    return {
                        ok: false,
                        status: 410,
                        headers: { get: () => null },
                        json: async () => ({ reason: 'expired' })
                    };
                }
                return original(url, init);
            })
        });

        const { result, qdrantResult } = await ingestFileBuffer(ingestArgs(db, ai));

        expect(qdrantResult).toMatchObject({ success: false, reason: 'expired' });
        const stored = await db.collection('documents').findOne({ documentId: result.documentId });
        expect(stored).toMatchObject({ status: 'parse-failed', metadata: { parsing: { status: 'failed', reason: 'expired' } } });
    });

    test('treats a swallowed Mongo content-update failure as terminal', async () => {
        const gateway = fakeGateway({
            statuses: [{ status: 'done', metadata: { warnings: [] } }],
            chunks: [{ index: 0, text: 'content', pages: [1] }]
        });
        useGateway(gateway);
        jest.spyOn(DocumentModel, 'updateDocumentContent').mockResolvedValueOnce({
            success: false,
            error: 'mongo write failed'
        });

        const { result, qdrantResult } = await ingestFileBuffer(ingestArgs(db, ai));

        expect(qdrantResult).toMatchObject({ success: false, reason: 'persistence_error' });
        const stored = await db.collection('documents').findOne({ documentId: result.documentId });
        expect(stored.metadata.parsing).toMatchObject({ status: 'failed', reason: 'persistence_error' });
        expect(ai.qdrant.storeChunks).not.toHaveBeenCalled();
    });

    test('removes chunks if the document is deleted while a batch is being stored', async () => {
        const gateway = fakeGateway({
            statuses: [{ status: 'done', metadata: { warnings: [] } }],
            chunks: [
                { index: 0, text: 'first', pages: [1] },
                { index: 1, text: 'second', pages: [2] }
            ]
        });
        useGateway(gateway);
        ai.qdrant.storeChunks.mockImplementationOnce(async (documentData, chunks) => {
            await db.collection('documents').deleteOne({ documentId: documentData.documentId });
            return chunks.map((_, index) => ({ id: `pt-${index}` }));
        });

        const { qdrantResult } = await ingestFileBuffer(ingestArgs(db, ai, {
            env: { ...ENV, DOCPARSE_EMBED_BATCH_SIZE: '1' }
        }));

        expect(qdrantResult).toMatchObject({ success: false, reason: 'document_deleted' });
        expect(ai.qdrant.deleteDocumentChunks).toHaveBeenCalledWith(expect.any(String), 'course-1');
    });

    test('image_description_unavailable is a warning, not a failure', async () => {
        const gateway = fakeGateway({
            statuses: [{ status: 'done', metadata: { warnings: ['image_description_unavailable'] } }],
            chunks: [{ index: 0, text: 'text intact', pages: [1] }]
        });
        useGateway(gateway);

        const { result, qdrantResult } = await ingestFileBuffer(ingestArgs(db, ai));

        expect(qdrantResult.success).toBe(true);
        const stored = await db.collection('documents').findOne({ documentId: result.documentId });
        expect(stored.metadata.parsing.status).toBe('ready');
        expect(stored.metadata.parsing.warnings).toEqual(['image_description_unavailable']);
    });

    test('reports the parsing phase so a long parse does not look frozen', async () => {
        const gateway = fakeGateway({
            statuses: [
                { status: 'queued' },
                { status: 'processing' },
                { status: 'done', metadata: { warnings: [] } }
            ],
            chunks: [{ index: 0, text: 'text', pages: [1] }]
        });
        useGateway(gateway);
        const phases = [];

        await ingestFileBuffer(ingestArgs(db, ai, {
            onProgress: (event) => phases.push(event)
        }));

        const order = phases.map((p) => p.phase);
        expect(order.filter((p, i) => order.indexOf(p) === i))
            .toEqual(['storing', 'extracting', 'parsing', 'saving', 'indexing']);
        const parsing = phases.filter((p) => p.phase === 'parsing');
        expect(parsing.map((p) => p.status)).toEqual(['queued', 'processing', 'done']);
        expect(parsing.at(-1).polls).toBeGreaterThan(0);
    });

    test('an upload rejected as too large fails the call rather than ingesting nothing', async () => {
        const gateway = fakeGateway({ statuses: [{ status: 'done' }], uploadStatus: 413 });
        useGateway(gateway);

        await expect(ingestFileBuffer(ingestArgs(db, ai)))
            .rejects.toMatchObject({ name: 'DocParseError', reason: 'too_large' });
        expect(await db.collection('documents').countDocuments({})).toBe(0);
    });
});

describe('formats that stay on the in-process parser', () => {
    test('PPTX never reaches the parsing service', async () => {
        const gateway = fakeGateway({ statuses: [{ status: 'done' }] });
        useGateway(gateway);

        await ingestFileBuffer(ingestArgs(db, ai, {
            mimeType: PPTX,
            originalName: 'lecture.pptx',
            awaitParse: false
        }));

        expect(gateway.fetchImpl).not.toHaveBeenCalled();
    });

    test('DOCPARSE_ENABLED=false sends a PDF down the old path', async () => {
        const gateway = fakeGateway({ statuses: [{ status: 'done' }] });
        useGateway(gateway);

        const outcome = await ingestFileBuffer(ingestArgs(db, ai, {
            env: { ...ENV, DOCPARSE_ENABLED: 'false' },
            awaitParse: false
        }));

        expect(gateway.fetchImpl).not.toHaveBeenCalled();
        expect(outcome.jobId).toBeUndefined();
    });

    test('text/plain keeps its short-circuit and never calls out', async () => {
        const gateway = fakeGateway({ statuses: [{ status: 'done' }] });
        useGateway(gateway);

        const { result } = await ingestFileBuffer(ingestArgs(db, ai, {
            buffer: Buffer.from('plain text body'),
            mimeType: 'text/plain',
            originalName: 'notes.txt',
            awaitParse: false
        }));

        expect(gateway.fetchImpl).not.toHaveBeenCalled();
        const stored = await db.collection('documents').findOne({ documentId: result.documentId });
        expect(stored.content).toBe('plain text body');
    });
});
