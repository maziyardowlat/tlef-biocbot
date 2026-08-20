/**
 * In-process route tests for src/routes/exportChangeLog.js (supertest).
 *
 * The change log describes the student chat downloads, so it is gated exactly
 * like the downloads themselves: system admins only. These tests pin that gate
 * and the two response shapes the Downloads page depends on — JSON for the
 * modal, and an attachment for the Markdown download.
 */
const { makeRouteApp, request } = require('../helpers/route-app');
const exportChangeLogService = require('../../../src/services/exportChangeLog');
const router = require('../../../src/routes/exportChangeLog');

const systemAdmin = {
    userId: 'inst-admin',
    role: 'instructor',
    isActive: true,
    permissions: { systemAdmin: true }
};

const instructor = {
    userId: 'inst-1',
    role: 'instructor',
    isActive: true,
    permissions: { systemAdmin: false }
};

const student = {
    userId: 'stu-1',
    role: 'student',
    isActive: true,
    permissions: { systemAdmin: false }
};

beforeAll(() => {
    jest.spyOn(console, 'error').mockImplementation(() => {});
});
afterAll(() => jest.restoreAllMocks());

describe('GET /api/export-change-log', () => {
    test('returns the change log to a system admin', async () => {
        const app = makeRouteApp(router, { user: systemAdmin });
        const response = await request(app).get('/');

        expect(response.status).toBe(200);
        expect(response.body.success).toBe(true);
        expect(response.body.data.entries.length).toBeGreaterThan(0);
        expect(response.body.data.entries[0]).toHaveProperty('title');
    });

    test('refuses an instructor without system admin access', async () => {
        const app = makeRouteApp(router, { user: instructor });
        const response = await request(app).get('/');

        expect(response.status).toBe(403);
        expect(response.body.success).toBe(false);
    });

    test('refuses a student', async () => {
        const app = makeRouteApp(router, { user: student });
        expect((await request(app).get('/')).status).toBe(403);
    });

    test('refuses an unauthenticated request', async () => {
        const app = makeRouteApp(router, { user: null });
        const response = await request(app).get('/');

        expect(response.status).toBe(401);
        expect(response.body.success).toBe(false);
    });

    test('reports a broken change log file instead of serving a partial one', async () => {
        const getChangeLog = jest.spyOn(exportChangeLogService, 'getChangeLog')
            .mockImplementation(() => { throw new Error('Export change log file is missing'); });

        try {
            const app = makeRouteApp(router, { user: systemAdmin });
            const response = await request(app).get('/');

            expect(response.status).toBe(500);
            expect(response.body.success).toBe(false);
        } finally {
            getChangeLog.mockRestore();
        }
    });
});

describe('GET /api/export-change-log/markdown', () => {
    test('serves the document as a named Markdown attachment', async () => {
        const app = makeRouteApp(router, { user: systemAdmin });
        const response = await request(app).get('/markdown');

        expect(response.status).toBe(200);
        expect(response.headers['content-type']).toMatch(/text\/markdown/);
        expect(response.headers['content-disposition'])
            .toBe(`attachment; filename="${exportChangeLogService.buildFileName()}"`);
        expect(response.text).toContain('## Changes');
        expect(response.text).toContain('## Appendix: Interpreting the JSON Chat Export');
    });

    test('refuses an instructor without system admin access', async () => {
        const app = makeRouteApp(router, { user: instructor });
        expect((await request(app).get('/markdown')).status).toBe(403);
    });

    test('reports a rendering failure rather than an empty download', async () => {
        const renderMarkdown = jest.spyOn(exportChangeLogService, 'renderMarkdown')
            .mockImplementation(() => { throw new Error('boom'); });

        try {
            const app = makeRouteApp(router, { user: systemAdmin });
            const response = await request(app).get('/markdown');

            expect(response.status).toBe(500);
            expect(response.body.success).toBe(false);
        } finally {
            renderMarkdown.mockRestore();
        }
    });
});
