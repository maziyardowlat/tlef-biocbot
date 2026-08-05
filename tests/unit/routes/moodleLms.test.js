const express = require('express');
const { memoryDb } = require('../helpers/memory-db');
const { makeRouteApp, request } = require('../helpers/route-app');
const { createMoodleLmsRouter } = require('../../../src/routes/moodleLms');

const instructor = { userId: 'inst-1', role: 'instructor' };

function moodleHarness({ client, getCourses, getFiles, downloadFile } = {}) {
    const authRouter = express.Router();
    authRouter.post('/connect', (req, res) => res.json({ success: true }));
    authRouter.post('/disconnect', (req, res) => res.status(204).end());
    const moodleClient = client || { call: jest.fn() };
    const api = {
        createAuthRouter: jest.fn(() => authRouter),
        requireAuth: jest.fn(() => (req, res, next) => {
            req.moodleApi = moodleClient;
            next();
        }),
        getCourses: getCourses || jest.fn(async () => []),
        getCourseFiles: getFiles || jest.fn(async () => []),
        downloadFile: downloadFile || jest.fn()
    };
    return {
        api,
        moodleClient,
        integration: {
            api,
            config: {
                moodleDomain: 'http://moodle.test',
                getUserKey: jest.fn((req) => req.user.userId),
                tokenStore: { get: jest.fn(async () => ({ token: 'moodle-token' })) }
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

describe('Moodle LMS routes', () => {
    test('lists enrolled courses and normalizes Moodle files', async () => {
        const getCourses = jest.fn(async () => [{ id: '20', provider: 'moodle', name: 'BIOC 301' }]);
        const getFiles = jest.fn(async () => [{
            id: 'file-hash',
            name: 'Week 1.pdf',
            filename: 'week-1.pdf',
            mimeType: 'application/pdf',
            size: 1234
        }]);
        const harness = moodleHarness({ getCourses, getFiles });
        const app = makeRouteApp(createMoodleLmsRouter(harness.integration), {
            db: memoryDb(),
            user: instructor
        });

        const courses = await request(app).get('/courses').expect(200);
        expect(courses.body.data[0].id).toBe('20');
        expect(getCourses).toHaveBeenCalledWith(harness.moodleClient);

        const files = await request(app).get('/courses/20/files').expect(200);
        expect(files.body.data[0]).toMatchObject({
            id: 'file-hash',
            filename: 'week-1.pdf',
            mimeType: 'application/pdf',
            supported: true
        });
        expect(getFiles).toHaveBeenCalledWith(harness.moodleClient, '20');
    });

    test('links Moodle independently of the saved Canvas file source', async () => {
        const getCourses = jest.fn(async () => [{ id: '20', name: 'BIOC 301', code: 'BIOC301' }]);
        const harness = moodleHarness({ getCourses });
        const db = memoryDb({
            courses: [course({
                lmsFileSources: { canvas: { provider: 'canvas', courseId: '10' } }
            })]
        });
        const app = makeRouteApp(createMoodleLmsRouter(harness.integration), { db, user: instructor });

        const response = await request(app)
            .put('/courses/BIOC-1/link')
            .send({ moodleCourseId: '20' })
            .expect(200);
        expect(response.body.data.lmsSync).toMatchObject({
            provider: 'moodle',
            courseId: '20',
            linkedBy: 'inst-1'
        });

        const saved = await db.collection('courses').findOne({ courseId: 'BIOC-1' });
        expect(saved.lmsFileSources.canvas.courseId).toBe('10');
        expect(saved.lmsFileSources.moodle.courseId).toBe('20');

        const restored = await request(app).get('/courses/BIOC-1/link').expect(200);
        expect(restored.body.data.lmsSync.courseId).toBe('20');
    });

    test('imports a linked Moodle file through the shared ingestion service', async () => {
        const file = {
            id: 'file-hash',
            name: 'Week 1 Notes.txt',
            filename: 'week-1.txt',
            mimeType: 'text/plain',
            size: 17,
            updatedAt: '2026-08-05T00:00:00Z'
        };
        const getFiles = jest.fn(async () => [file]);
        const downloadFile = jest.fn(async () => ({
            data: new Uint8Array(Buffer.from('Moodle notes body')),
            contentType: 'text/plain',
            filename: 'week-1.txt',
            size: 17
        }));
        const harness = moodleHarness({ getFiles, downloadFile });
        const ingestFile = jest.fn(async (input) => ({
            result: { documentId: 'doc-2', filename: input.title },
            courseResult: { success: true },
            qdrantResult: { success: true, chunksStored: 2 }
        }));
        const resolveAi = jest.fn(async () => ({ llm: {}, qdrant: {} }));
        const db = memoryDb({
            courses: [course({
                lmsFileSources: { moodle: { provider: 'moodle', courseId: '20' } }
            })],
            documents: []
        });
        const app = makeRouteApp(
            createMoodleLmsRouter(harness.integration, { ingestFile, resolveAi }),
            { db, user: instructor }
        );

        const response = await request(app)
            .post('/courses/BIOC-1/import-file')
            .send({ moodleFileId: 'file-hash', lectureName: 'Unit 1', documentType: 'lecture-notes' })
            .expect(201);

        expect(response.body.data).toMatchObject({ documentId: 'doc-2', chunksStored: 2 });
        expect(downloadFile).toHaveBeenCalledWith(
            harness.moodleClient,
            '20',
            'file-hash',
            { maxBytes: 50 * 1024 * 1024 }
        );
        expect(ingestFile).toHaveBeenCalledWith(expect.objectContaining({
            courseId: 'BIOC-1',
            lectureName: 'Unit 1',
            buffer: expect.any(Buffer),
            metadata: expect.objectContaining({
                lms: expect.objectContaining({
                    provider: 'moodle',
                    externalCourseId: '20',
                    externalFileId: 'file-hash'
                })
            })
        }));
    });

    test('refuses duplicate Moodle file imports', async () => {
        const file = {
            id: 'file-hash',
            name: 'notes.txt',
            filename: 'notes.txt',
            mimeType: 'text/plain',
            size: 10
        };
        const harness = moodleHarness({ getFiles: jest.fn(async () => [file]) });
        const db = memoryDb({
            courses: [course({
                lmsFileSources: { moodle: { provider: 'moodle', courseId: '20' } }
            })],
            documents: [{
                documentId: 'existing-doc',
                courseId: 'BIOC-1',
                metadata: { lms: { provider: 'moodle', externalCourseId: '20', externalFileId: 'file-hash' } }
            }]
        });
        const app = makeRouteApp(createMoodleLmsRouter(harness.integration), { db, user: instructor });

        const response = await request(app)
            .post('/courses/BIOC-1/import-file')
            .send({ moodleFileId: 'file-hash', lectureName: 'Unit 1' })
            .expect(409);
        expect(response.body.code).toBe('MOODLE_FILE_ALREADY_IMPORTED');
    });

    test('exposes the Moodle token connect and disconnect routes', async () => {
        const harness = moodleHarness();
        const app = makeRouteApp(createMoodleLmsRouter(harness.integration), {
            db: memoryDb(),
            user: instructor
        });

        await request(app).post('/auth/connect').send({ token: 'local-token' }).expect(200);
        await request(app).post('/auth/disconnect').expect(204);
    });
});
