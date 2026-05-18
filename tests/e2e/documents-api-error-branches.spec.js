// @ts-check
/**
 * Error / edge-case branches for `src/routes/documents.js`.
 *
 * Targets uncovered ranges from coverage-reports/e2e/coverage-summary.json:
 *   - lines 217-259 — upload route's non-text (PDF/DOCX/etc) parsing block,
 *     including the parse-failure catch on 256-259.
 *   - lines 65-66, 80-82 — getStoredFileBuffer null/base64-string branches.
 *   - line 45 — resolveDownloadFilename preserves the filename's extension when
 *     `originalName` has none.
 *   - lines 929-961 — extract-questions large-content / Qdrant chunks branch
 *     and the chunk-retrieval failure catch.
 *
 * Does NOT duplicate the happy paths exercised by `routes-documents-api.spec.js`
 * or `rag-documents-coverage-branches.spec.js`.
 *
 * Genuinely unreachable in production via this route (documented, not forced):
 *   - line 69-70 (`Buffer.isBuffer(fileData)`): MongoDB driver deserializes
 *     stored binary as a `Binary` object whose `.buffer` is the Node Buffer,
 *     so the prior `if (fileData.buffer)` branch always wins.
 *   - `/upload` `if (!db)` → 503 (lines 167-171), and the symmetric 503/500
 *     handlers in `/text`, `/lecture`, `/stats`, `/:documentId`, `/:documentId/download`,
 *     `/cleanup-orphans`, `/extract-questions` — `req.app.locals.db` is set
 *     by `src/server.js` boot and the model layer's `findOne` doesn't throw on
 *     missing docs, so the catch-paths aren't reachable from outside.
 *   - line 568-573 / 651-656 — `if (!documentId)` after Express has already
 *     bound `:documentId`. Cannot reach via HTTP.
 */

const fs = require('fs');
const os = require('os');
const path = require('path');
const { test, expect } = require('./fixtures/monocart');
const { TEST_USERS, storageStatePath } = require('./helpers/users');
const {
    withDb,
    getUserIdByUsername,
    seedCourse,
    cleanupCourses,
    cleanupCoursesForUser,
} = require('./helpers/courses-test');

const COURSE_A = 'BIOC-E2E-DOCS-ERR-A';

let instructorId;

test.beforeAll(async () => {
    instructorId = await getUserIdByUsername(TEST_USERS.instructor.username);
});

test.beforeEach(async () => {
    await cleanupCoursesForUser(instructorId);
    await withDb((db) =>
        db.collection('documents').deleteMany({
            $or: [
                { courseId: COURSE_A },
                { documentId: /^doc_e2e_docs_err_/ },
            ],
        })
    );
});

test.afterAll(async () => {
    await cleanupCourses([COURSE_A]);
    await cleanupCoursesForUser(instructorId);
    await withDb((db) =>
        db.collection('documents').deleteMany({ documentId: /^doc_e2e_docs_err_/ })
    );
});

// ---------------------------------------------------------------------------
// /upload — non-text parsing path + parse-failure catch
// ---------------------------------------------------------------------------
test.describe('POST /api/documents/upload — parse paths', () => {
    test.use({ storageState: storageStatePath('instructor') });

    test('PDF upload with garbage bytes fires the docParser failure catch and still stores the doc', async ({ request: api }) => {
        await seedCourse({ courseId: COURSE_A, instructorId });
        // application/pdf mime + .pdf extension forces the upload handler down
        // the non-text branch (lines 217-255). The bytes are not a real PDF, so
        // docParser.parse throws and the `catch (parseError)` arm fires
        // (lines 256-259). The document should still be saved with empty
        // content and the API should return success.
        const tmpPath = path.join(os.tmpdir(), `biocbot-e2e-docerr-${Date.now()}.pdf`);
        fs.writeFileSync(tmpPath, 'this is not a real PDF, just bytes');
        try {
            const res = await api.post('/api/documents/upload', {
                multipart: {
                    courseId: COURSE_A,
                    lectureName: 'Unit 1',
                    documentType: 'lecture-notes',
                    instructorId,
                    title: 'Broken PDF',
                    file: {
                        name: 'broken.pdf',
                        mimeType: 'application/pdf',
                        buffer: fs.readFileSync(tmpPath),
                    },
                },
                timeout: 90_000,
            });
            // The route swallows parse errors and still returns 200 — the
            // document is created with empty content. Qdrant ingest is skipped.
            expect(res.ok()).toBeTruthy();
            const body = await res.json();
            expect(body.success).toBe(true);
            expect(body.data.documentId).toBeTruthy();
            expect(body.data.chunksStored).toBe(0);

            const stored = await withDb((db) =>
                db.collection('documents').findOne({ documentId: body.data.documentId })
            );
            expect(stored).toBeTruthy();
            // Either the parser produced nothing (parseError catch) or the
            // produced result was falsy — both branches end with empty content.
            expect(stored.content === '' || stored.content == null).toBe(true);
        } finally {
            try { fs.unlinkSync(tmpPath); } catch (_) { /* ignore */ }
        }
    });

    test('oversized file (>50MB) is rejected by multer fileSize limit', async ({ request: api }) => {
        await seedCourse({ courseId: COURSE_A, instructorId });
        // multer is configured with `limits.fileSize = 50 * 1024 * 1024`. A
        // 50MB + 1 byte buffer must exercise the limit branch in multer's
        // internal flow. There's no custom error handler in the route, so
        // express' default handler returns 500.
        const oversized = Buffer.alloc(50 * 1024 * 1024 + 1, 0x61);
        const res = await api.post('/api/documents/upload', {
            multipart: {
                courseId: COURSE_A,
                lectureName: 'Unit 1',
                documentType: 'lecture-notes',
                instructorId,
                file: {
                    name: 'huge.txt',
                    mimeType: 'text/plain',
                    buffer: oversized,
                },
            },
            timeout: 120_000,
        });
        // multer emits LIMIT_FILE_SIZE → bubbles through express' default
        // error handler. Accept any 4xx/5xx; the multer error path is the
        // only way an oversized upload can land here.
        expect(res.status()).toBeGreaterThanOrEqual(400);
        expect(res.ok()).toBeFalsy();
    });
});

// ---------------------------------------------------------------------------
// /:documentId/download — getStoredFileBuffer null + base64 branches
// ---------------------------------------------------------------------------
test.describe('GET /api/documents/:documentId/download — fileData shapes', () => {
    test.use({ storageState: storageStatePath('instructor') });

    test('500 when contentType=file but fileData is null (getStoredFileBuffer null arm)', async ({ request: api }) => {
        // contentType==='file' alone makes isFileDocument true even when
        // fileData is missing entirely, so getStoredFileBuffer(null) is called
        // and returns null on the `if (!fileData)` arm (lines 64-66). The
        // handler then 500s with "Stored file data is invalid".
        await seedCourse({ courseId: COURSE_A, instructorId });
        const now = new Date();
        await withDb((db) =>
            db.collection('documents').insertOne({
                documentId: 'doc_e2e_docs_err_nullfile',
                courseId: COURSE_A,
                lectureName: 'Unit 1',
                documentType: 'lecture-notes',
                contentType: 'file',
                fileData: null,
                originalName: 'gone.pdf',
                filename: 'gone.pdf',
                mimeType: 'application/pdf',
                size: 0,
                status: 'parsed',
                uploadDate: now,
                lastModified: now,
            })
        );
        const res = await api.get('/api/documents/doc_e2e_docs_err_nullfile/download');
        expect(res.status()).toBe(500);
        const body = await res.json();
        expect(body.success).toBe(false);
        expect(String(body.message || '').toLowerCase()).toContain('invalid');
    });

    test('serves base64-string fileData via the typeof===string arm', async ({ request: api }) => {
        // Stores fileData as a base64 string. getStoredFileBuffer hits the
        // `typeof fileData === 'string'` branch (lines 80-82) and returns
        // Buffer.from(str, 'base64'). The handler ships those decoded bytes.
        await seedCourse({ courseId: COURSE_A, instructorId });
        const expected = Buffer.from('hello from base64', 'utf8');
        const base64 = expected.toString('base64');
        const now = new Date();
        await withDb((db) =>
            db.collection('documents').insertOne({
                documentId: 'doc_e2e_docs_err_b64',
                courseId: COURSE_A,
                lectureName: 'Unit 1',
                documentType: 'lecture-notes',
                contentType: 'file',
                fileData: base64,
                originalName: 'b64.bin',
                filename: 'b64.bin',
                mimeType: 'application/octet-stream',
                size: expected.length,
                status: 'parsed',
                uploadDate: now,
                lastModified: now,
            })
        );
        const res = await api.get('/api/documents/doc_e2e_docs_err_b64/download');
        expect(res.ok()).toBeTruthy();
        const got = await res.body();
        expect(Buffer.compare(got, expected)).toBe(0);
        const disp = res.headers()['content-disposition'] || '';
        expect(disp.toLowerCase()).toContain('attachment');
        expect(disp).toContain('b64.bin');
    });

    test('uses the filename extension when originalName is set but has no extension', async ({ request: api }) => {
        // Drives resolveDownloadFilename through line 45 specifically:
        //   - rawOriginal='dotless-display' → preferredName has no extension
        //   - rawFile='lecture.pdf' has an extension
        //   → the `if (rawFile && path.extname(rawFile))` branch picks up
        //     `lecture.pdf` (line 45) instead of falling through to the
        //     mime-type fallback on line 47.
        await seedCourse({ courseId: COURSE_A, instructorId });
        const now = new Date();
        await withDb((db) =>
            db.collection('documents').insertOne({
                documentId: 'doc_e2e_docs_err_extkeep',
                courseId: COURSE_A,
                lectureName: 'Unit 1',
                documentType: 'lecture-notes',
                contentType: 'text',
                originalName: 'dotless-display',
                filename: 'lecture.pdf',
                content: 'plain text masquerading as a pdf attachment',
                // intentionally NOT application/pdf — proves we picked the
                // extension from `filename`, not from the mime fallback.
                mimeType: 'text/plain',
                size: 42,
                status: 'parsed',
                uploadDate: now,
                lastModified: now,
            })
        );
        const res = await api.get('/api/documents/doc_e2e_docs_err_extkeep/download');
        expect(res.ok()).toBeTruthy();
        const disp = res.headers()['content-disposition'] || '';
        expect(disp.toLowerCase()).toContain('attachment');
        // The chosen filename should be `lecture.pdf` (from `filename`), not
        // `dotless-display.txt` (which would mean we hit the mime fallback).
        expect(disp).toContain('lecture.pdf');
        expect(disp).not.toContain('dotless-display.txt');
    });
});

// ---------------------------------------------------------------------------
// /:documentId/extract-questions — large-content / chunks branch
// ---------------------------------------------------------------------------
test.describe('POST /api/documents/:documentId/extract-questions — large content', () => {
    test.use({ storageState: storageStatePath('instructor') });

    test('large content with no Qdrant chunks returns 400 on the chunks branch', async ({ request: api }) => {
        // Build content well above the 32k-token limit (`TOKEN_LIMIT` in the
        // route) so estimatedTokens > 32_000 and the handler enters the
        // `else if (content.length > 0)` arm at line 929. The seeded document
        // never had its chunks written to Qdrant.
        //
        // Two valid outcomes — both targeted branches in the same arm:
        //   (a) Qdrant reachable: getDocumentChunks returns [] →
        //       400 "Document is too large and no chunks were found" (lines 939-944).
        //   (b) Qdrant unreachable: initialize()/scroll throws →
        //       outer catch returns 400 "...chunk retrieval failed" (lines 955-961).
        //
        // Either way the handler hits the large-content branch — which is the
        // entire point — and we don't depend on the test env having Qdrant up.
        test.setTimeout(120_000);
        await seedCourse({ courseId: COURSE_A, instructorId });
        // Use varied token-rich text so tiktoken doesn't collapse it. Aim for
        // ~40K tokens — well over the 32K cap.
        const sentence = 'Catalase decomposes hydrogen peroxide into water and oxygen during cellular metabolism in many eukaryotic organisms. ';
        const content = sentence.repeat(2500); // ~40K+ tokens of natural English
        const now = new Date();
        await withDb((db) =>
            db.collection('documents').insertOne({
                documentId: 'doc_e2e_docs_err_huge',
                courseId: COURSE_A,
                lectureName: 'Unit 1',
                documentType: 'practice-quiz',
                contentType: 'text',
                content,
                originalName: 'huge.txt',
                filename: 'huge.txt',
                mimeType: 'text/plain',
                size: content.length,
                status: 'parsed',
                uploadDate: now,
                lastModified: now,
            })
        );
        const res = await api.post('/api/documents/doc_e2e_docs_err_huge/extract-questions', {
            data: {},
            timeout: 90_000,
        });
        expect(res.status()).toBe(400);
        const body = await res.json();
        expect(body.success).toBe(false);
        // Either "no chunks were found" or "chunk retrieval failed".
        expect(String(body.message || '').toLowerCase()).toMatch(
            /no chunks were found|chunk retrieval failed/
        );
    });
});
