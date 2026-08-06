const express = require('express');
const { memoryDb } = require('../helpers/memory-db');
const { makeRouteApp, request } = require('../helpers/route-app');
const { createCanvasLmsRouter } = require('../../../src/routes/canvasLms');

const instructor = { userId: 'inst-1', role: 'instructor' };

function canvasHarness({ client, getCourses, getSections, getFiles, downloadFile } = {}) {
    const authRouter = express.Router();
    authRouter.get('/login', (req, res) => res.json({ returnTo: req.query.returnTo || null }));
    authRouter.post('/logout', (req, res) => res.status(204).end());
    const canvasClient = client || { get: jest.fn() };
    const api = {
        baseUrl: jest.fn(() => 'http://canvas.test'),
        createAuthRouter: jest.fn(() => authRouter),
        requireAuth: jest.fn(() => (req, res, next) => {
            req.canvasApi = canvasClient;
            next();
        }),
        getCourses: getCourses || jest.fn(async () => []),
        getCourseSections: getSections || jest.fn(async () => []),
        getCourseFiles: getFiles || jest.fn(async () => []),
        downloadFile: downloadFile || jest.fn()
    };
    return {
        api,
        canvasClient,
        integration: {
            api,
            config: {
                canvasDomain: 'http://canvas.test',
                getUserKey: jest.fn((req) => req.user.userId),
                tokenStore: { get: jest.fn(async () => ({ accessToken: 'canvas-access-token' })) }
            }
        }
    };
}

function course(overrides = {}) {
    return {
        courseId: 'BIOC-1',
        courseName: 'BIOC 301',
        instructorId: 'inst-1',
        instructors: ['inst-1'],
        lectures: [{ name: 'Unit 1', documents: [] }],
        ...overrides
    };
}

describe('Canvas LMS routes', () => {
    test('lists teacher courses and Canvas sections through the toolkit', async () => {
        const getCourses = jest.fn(async () => [{ id: '10', provider: 'canvas', name: 'BIOC 301' }]);
        const getSections = jest.fn(async () => [{ id: '20', provider: 'canvas', name: 'Section 001' }]);
        const harness = canvasHarness({ getCourses, getSections });
        const router = createCanvasLmsRouter(harness.integration);
        const app = makeRouteApp(router, { db: memoryDb(), user: instructor });

        const courses = await request(app).get('/courses').expect(200);
        expect(courses.body.data[0].id).toBe('10');
        expect(getCourses).toHaveBeenCalledWith(harness.canvasClient, { enrollment_type: 'teacher' });

        const sections = await request(app).get('/courses/10/sections').expect(200);
        expect(sections.body.data[0].id).toBe('20');
        expect(getSections).toHaveBeenCalledWith(harness.canvasClient, '10');
    });

    test('lists supported Canvas files in a normalized shape', async () => {
        const getFiles = jest.fn(async () => [{
                id: 31,
                name: 'Week 1.pdf',
                filename: 'week-1.pdf',
                mimeType: 'application/pdf',
                size: 1234,
                updatedAt: '2026-08-04T00:00:00Z'
            }]);
        const harness = canvasHarness({ getFiles });
        const app = makeRouteApp(createCanvasLmsRouter(harness.integration), {
            db: memoryDb(),
            user: instructor
        });

        const res = await request(app).get('/courses/10/files').expect(200);
        expect(res.body.data[0]).toMatchObject({
            id: '31',
            name: 'Week 1.pdf',
            filename: 'week-1.pdf',
            mimeType: 'application/pdf',
            supported: true
        });
        expect(getFiles).toHaveBeenCalledWith(harness.canvasClient, '10', expect.objectContaining({
            sort: 'updated_at',
            order: 'desc'
        }));
    });

    test('links an owned BiocBot course to a verified Canvas course', async () => {
        const getCourses = jest.fn(async () => [{ id: '10', name: 'BIOC 301 001', code: 'BIOC301' }]);
        const harness = canvasHarness({ getCourses });
        const db = memoryDb({ courses: [course()] });
        const app = makeRouteApp(createCanvasLmsRouter(harness.integration), { db, user: instructor });

        const res = await request(app)
            .put('/courses/BIOC-1/link')
            .send({ canvasCourseId: '10' })
            .expect(200);
        expect(res.body.data.lmsSync).toMatchObject({
            provider: 'canvas',
            courseId: '10',
            linkedBy: 'inst-1'
        });
        expect(getCourses).toHaveBeenCalledWith(harness.canvasClient, { enrollment_type: 'teacher' });
        expect((await db.collection('courses').findOne({ courseId: 'BIOC-1' })).lmsSync.courseId).toBe('10');
    });

    test('returns the saved Canvas link so the instructor UI can restore it after reload', async () => {
        const harness = canvasHarness();
        const db = memoryDb({
            courses: [course({
                lmsSync: { provider: 'canvas', courseId: '10', name: 'BIOC 301', code: 'BIOC301' }
            })]
        });
        const app = makeRouteApp(createCanvasLmsRouter(harness.integration), { db, user: instructor });

        const res = await request(app).get('/courses/BIOC-1/link').expect(200);
        expect(res.body.data).toEqual({
            courseId: 'BIOC-1',
            lmsSync: { provider: 'canvas', courseId: '10', name: 'BIOC 301', code: 'BIOC301' }
        });
    });

    test('imports a linked Canvas file through the reusable BiocBot ingestion service', async () => {
        const file = {
            id: '31',
            name: 'Week 1 Notes.txt',
            filename: 'week-1.txt',
            mimeType: 'text/plain',
            size: 17,
            updatedAt: '2026-08-04T00:00:00Z'
        };
        const getFiles = jest.fn(async () => [file]);
        const downloadFile = jest.fn(async () => ({
            data: new Uint8Array(Buffer.from('Canvas notes body')),
            contentType: 'text/plain',
            filename: 'week-1.txt',
            size: 17
        }));
        const harness = canvasHarness({ getFiles, downloadFile });
        const ingestFile = jest.fn(async (input) => ({
            result: { documentId: 'doc-1', filename: input.title },
            courseResult: { success: true },
            qdrantResult: { success: true, chunksStored: 2 }
        }));
        const resolveAi = jest.fn(async () => ({ llm: {}, qdrant: {} }));
        const db = memoryDb({
            courses: [course({ lmsSync: { provider: 'canvas', courseId: '10' } })],
            documents: []
        });
        const router = createCanvasLmsRouter(harness.integration, { ingestFile, resolveAi });
        const app = makeRouteApp(router, { db, user: instructor });

        const res = await request(app)
            .post('/courses/BIOC-1/import-file')
            .send({ canvasFileId: '31', lectureName: 'Unit 1', documentType: 'lecture-notes' })
            .expect(201);

        expect(res.body.data).toMatchObject({ documentId: 'doc-1', chunksStored: 2 });
        expect(downloadFile).toHaveBeenCalledWith(
            harness.canvasClient,
            '10',
            '31',
            { maxBytes: 50 * 1024 * 1024 }
        );
        expect(ingestFile).toHaveBeenCalledWith(expect.objectContaining({
            courseId: 'BIOC-1',
            lectureName: 'Unit 1',
            instructorId: 'inst-1',
            buffer: expect.any(Buffer),
            metadata: expect.objectContaining({
                lms: expect.objectContaining({
                    provider: 'canvas',
                    externalCourseId: '10',
                    externalFileId: '31'
                })
            })
        }));
    });

    test('refuses duplicate imports and courses owned by another instructor', async () => {
        const file = {
            id: '31',
            name: 'notes.txt',
            filename: 'notes.txt',
            mimeType: 'text/plain',
            size: 10
        };
        const harness = canvasHarness({ getFiles: jest.fn(async () => [file]) });
        const duplicateDb = memoryDb({
            courses: [course({ lmsSync: { provider: 'canvas', courseId: '10' } })],
            documents: [{
                documentId: 'existing-doc',
                courseId: 'BIOC-1',
                metadata: { lms: { provider: 'canvas', externalCourseId: '10', externalFileId: '31' } }
            }]
        });
        const duplicateApp = makeRouteApp(createCanvasLmsRouter(harness.integration), {
            db: duplicateDb,
            user: instructor
        });
        const duplicate = await request(duplicateApp)
            .post('/courses/BIOC-1/import-file')
            .send({ canvasFileId: '31', lectureName: 'Unit 1' })
            .expect(409);
        expect(duplicate.body.code).toBe('CANVAS_FILE_ALREADY_IMPORTED');

        const forbiddenDb = memoryDb({ courses: [course({ instructorId: 'other', instructors: ['other'] })] });
        const forbiddenApp = makeRouteApp(createCanvasLmsRouter(harness.integration), {
            db: forbiddenDb,
            user: instructor
        });
        await request(forbiddenApp)
            .put('/courses/BIOC-1/link')
            .send({ canvasCourseId: '10' })
            .expect(403);
    });

    test('streams per-stage progress when the client asks for NDJSON', async () => {
        const file = {
            id: '31',
            name: 'Week 1 Notes.txt',
            filename: 'week-1.txt',
            mimeType: 'text/plain',
            size: 17
        };
        const harness = canvasHarness({
            getFiles: jest.fn(async () => [file]),
            downloadFile: jest.fn(async () => ({
                data: new Uint8Array(Buffer.from('Canvas notes body')),
                size: 17
            }))
        });
        // Replays the phases the real ingestion service emits so the route's
        // translation from ingestion phase to import stage is exercised.
        const ingestFile = jest.fn(async ({ onProgress }) => {
            onProgress({ phase: 'storing' });
            onProgress({ phase: 'extracting' });
            onProgress({ phase: 'extracted', characters: 17, slides: 0 });
            onProgress({ phase: 'saving' });
            onProgress({ phase: 'indexing' });
            return {
                result: { documentId: 'doc-1', filename: 'Week 1 Notes.txt' },
                courseResult: { success: true },
                qdrantResult: { success: true, chunksStored: 3 }
            };
        });
        const db = memoryDb({
            courses: [course({ lmsSync: { provider: 'canvas', courseId: '10' } })],
            documents: []
        });
        const router = createCanvasLmsRouter(harness.integration, {
            ingestFile,
            resolveAi: jest.fn(async () => ({ llm: {}, qdrant: {} }))
        });
        const app = makeRouteApp(router, { db, user: instructor });

        const res = await request(app)
            .post('/courses/BIOC-1/import-file')
            .set('Accept', 'application/x-ndjson')
            .send({ canvasFileId: '31', lectureName: 'Unit 1' })
            .expect(200);

        expect(res.headers['content-type']).toContain('application/x-ndjson');
        const events = res.text.trim().split('\n').map((line) => JSON.parse(line));
        expect(events.filter((event) => event.type === 'step').map((event) => event.step))
            .toEqual(['download', 'store', 'extract', 'save', 'index']);
        expect(events).toContainEqual({ type: 'detail', step: 'extract', detail: '17 characters read' });
        expect(events.at(-1)).toEqual({
            type: 'done',
            data: expect.objectContaining({ documentId: 'doc-1', lectureName: 'Unit 1', chunksStored: 3 })
        });
    });

    test('reports a mid-stream failure in band rather than as a dead connection', async () => {
        const errorLog = jest.spyOn(console, 'error').mockImplementation(() => {});
        const harness = canvasHarness({
            getFiles: jest.fn(async () => [{
                id: '31',
                name: 'notes.txt',
                filename: 'notes.txt',
                mimeType: 'text/plain',
                size: 10,
                raw: { url: 'https://files.canvas.test/notes.txt?verifier=secret' }
            }]),
            downloadFile: jest.fn(async () => {
                const error = new Error('Canvas file download returned 502');
                error.name = 'CanvasApiError';
                error.statusCode = 502;
                error.provider = 'canvas';
                throw error;
            })
        });
        const db = memoryDb({
            courses: [course({ lmsSync: { provider: 'canvas', courseId: '10' } })],
            documents: []
        });
        const router = createCanvasLmsRouter(harness.integration, {
            resolveAi: jest.fn(async () => ({ llm: {}, qdrant: {} }))
        });
        const app = makeRouteApp(router, { db, user: instructor });

        const res = await request(app)
            .post('/courses/BIOC-1/import-file')
            .set('Accept', 'application/x-ndjson')
            .send({ canvasFileId: '31', lectureName: 'Unit 1' })
            .expect(200);

        const events = res.text.trim().split('\n').map((line) => JSON.parse(line));
        expect(events.at(-1)).toMatchObject({
            type: 'error',
            message: 'Canvas file download returned 502',
            diagnostic: {
                reference: expect.any(String),
                provider: 'canvas',
                stage: 'download',
                errorName: 'CanvasApiError',
                statusCode: 502,
                fileHost: 'https://files.canvas.test',
                lmsHost: 'http://canvas.test',
                occurredAt: expect.any(String)
            }
        });
        expect(errorLog).toHaveBeenCalledWith(expect.stringContaining(events.at(-1).diagnostic.reference));
        expect(errorLog.mock.calls[0][0]).not.toContain('verifier=secret');
        errorLog.mockRestore();
    });

    test('validation still fails with a real status code before the stream opens', async () => {
        const harness = canvasHarness({ getFiles: jest.fn(async () => []) });
        const db = memoryDb({
            courses: [course({ lmsSync: { provider: 'canvas', courseId: '10' } })],
            documents: []
        });
        const app = makeRouteApp(createCanvasLmsRouter(harness.integration), { db, user: instructor });

        await request(app)
            .post('/courses/BIOC-1/import-file')
            .set('Accept', 'application/x-ndjson')
            .send({ canvasFileId: 'missing', lectureName: 'Unit 1' })
            .expect(404);
    });

    test('rejects external OAuth return paths', async () => {
        const harness = canvasHarness();
        const app = makeRouteApp(createCanvasLmsRouter(harness.integration), {
            db: memoryDb(),
            user: instructor
        });
        await request(app)
            .get('/auth/login?returnTo=https%3A%2F%2Fevil.example')
            .expect(400);
    });

    test('exposes the toolkit logout endpoint for explicit Canvas disconnect', async () => {
        const harness = canvasHarness();
        const app = makeRouteApp(createCanvasLmsRouter(harness.integration), {
            db: memoryDb(),
            user: instructor
        });

        await request(app).post('/auth/logout').expect(204);
    });

});
