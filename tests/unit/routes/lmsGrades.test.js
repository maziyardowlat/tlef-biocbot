const { memoryDb } = require('../helpers/memory-db');
const { makeRouteApp, request } = require('../helpers/route-app');
const { createLmsGradesRouter } = require('../../../src/routes/lmsGrades');

const instructor = { userId: 'inst-1', role: 'instructor' };

function course(overrides = {}) {
    return {
        courseId: 'BIOC-1',
        courseName: 'BIOC 301',
        instructorId: 'inst-1',
        instructors: ['inst-1'],
        lectures: [{ name: 'Unit 1', documents: [] }],
        lmsGradeSources: {
            canvas: { courseId: '10', name: 'BIOC 301', code: 'BIOC301' }
        },
        ...overrides
    };
}

/**
 * Both providers configured, both authorized. `canvasClient`/`moodleClient` are
 * the raw API clients the roster reader receives.
 */
function integrationHarness() {
    const canvasClient = { get: jest.fn(async () => []) };
    const moodleClient = { call: jest.fn(async () => []) };
    const provider = (client, key) => ({
        api: {
            requireAuth: jest.fn(() => (req, res, next) => {
                req[key] = client;
                next();
            })
        },
        config: {}
    });

    return {
        canvasClient,
        moodleClient,
        integration: {
            canvas: provider(canvasClient, 'canvasApi'),
            moodle: provider(moodleClient, 'moodleApi')
        }
    };
}

describe('LMS grades routes', () => {
    test('lists every provider with whether it is configured and linked', async () => {
        const harness = integrationHarness();
        const app = makeRouteApp(createLmsGradesRouter(harness.integration), {
            db: memoryDb({ courses: [course()] }),
            user: instructor
        });

        const res = await request(app).get('/courses/BIOC-1').expect(200);
        expect(res.body.data.sources).toEqual([
            expect.objectContaining({ provider: 'canvas', configured: true, linked: true, courseId: '10' }),
            expect.objectContaining({ provider: 'moodle', configured: true, linked: false })
        ]);
    });

    test('matches the roster and returns the refreshed grade view', async () => {
        const harness = integrationHarness();
        const matchRoster = jest.fn(async () => ({
            provider: 'canvas',
            matchedCount: 2,
            rosterSize: 3,
            unmatchedLmsStudents: [{ externalUserId: '903', name: 'Unknown Student', email: '', reason: 'no-biocbot-account' }],
            unmatchedBiocBotStudents: []
        }));
        const app = makeRouteApp(createLmsGradesRouter(harness.integration, { matchRoster }), {
            db: memoryDb({ courses: [course()] }),
            user: instructor
        });

        const res = await request(app)
            .post('/courses/BIOC-1/match-students')
            .send({ provider: 'canvas' })
            .expect(200);

        expect(matchRoster).toHaveBeenCalledWith(expect.objectContaining({
            provider: 'canvas',
            externalCourseId: '10',
            client: harness.canvasClient,
            matchedBy: 'inst-1'
        }));
        expect(res.body.data.match).toMatchObject({ matchedCount: 2, rosterSize: 3 });
        expect(res.body.data.students).toEqual([]);
    });

    test('refuses to match a provider this course is not linked to', async () => {
        const harness = integrationHarness();
        const matchRoster = jest.fn();
        const app = makeRouteApp(createLmsGradesRouter(harness.integration, { matchRoster }), {
            db: memoryDb({ courses: [course()] }),
            user: instructor
        });

        const res = await request(app)
            .post('/courses/BIOC-1/match-students')
            .send({ provider: 'moodle' })
            .expect(400);

        expect(res.body.message).toMatch(/link this biocbot course/i);
        expect(matchRoster).not.toHaveBeenCalled();
    });

    test('rejects an unknown provider and one the deployment has not configured', async () => {
        const harness = integrationHarness();
        const canvasOnly = { canvas: harness.integration.canvas };
        const app = makeRouteApp(createLmsGradesRouter(canvasOnly), {
            db: memoryDb({ courses: [course()] }),
            user: instructor
        });

        await request(app).post('/courses/BIOC-1/match-students').send({ provider: 'blackboard' }).expect(400);
        await request(app).post('/courses/BIOC-1/match-students').send({ provider: 'moodle' }).expect(404);
    });

    test('keeps grades of other instructors out of reach', async () => {
        const harness = integrationHarness();
        const app = makeRouteApp(createLmsGradesRouter(harness.integration), {
            db: memoryDb({ courses: [course({ instructorId: 'other', instructors: ['other'] })] }),
            user: instructor
        });

        await request(app).get('/courses/BIOC-1').expect(403);
        await request(app).post('/courses/BIOC-1/match-students').send({ provider: 'canvas' }).expect(403);
    });

    test('surfaces a provider failure as a gateway error, not a crash', async () => {
        const harness = integrationHarness();
        const matchRoster = jest.fn(async () => { throw new Error('Canvas API request returned 503'); });
        const app = makeRouteApp(createLmsGradesRouter(harness.integration, { matchRoster }), {
            db: memoryDb({ courses: [course()] }),
            user: instructor
        });

        const res = await request(app)
            .post('/courses/BIOC-1/match-students')
            .send({ provider: 'canvas' })
            .expect(502);
        expect(res.body).toMatchObject({ success: false, provider: 'canvas' });
    });
});
