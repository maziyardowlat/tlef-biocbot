const { memoryDb } = require('../helpers/memory-db');
const { makeRouteApp, request } = require('../helpers/route-app');
const {
    buildPruneSafety,
    createLmsRosterSyncRouter,
    effectiveRosterSource
} = require('../../../src/routes/lmsRosterSync');

const instructor = { userId: 'inst-1', role: 'instructor' };

function course(overrides = {}) {
    return {
        courseId: 'BIOC-1',
        courseName: 'BIOC 301',
        instructorId: 'inst-1',
        instructors: ['inst-1'],
        rosterSource: 'manual',
        studentEnrollment: {
            'user-1': { enrolled: false, source: 'manual' },
            'user-2': { enrolled: true, source: 'manual' }
        },
        lmsGradeSources: {
            canvas: { courseId: '10', name: 'BIOC 301', code: 'BIOC301' }
        },
        ...overrides
    };
}

function integrationHarness() {
    const canvasClient = {};
    const moodleClient = {};
    const provider = (client, key) => ({
        api: {
            requireAuth: () => (req, res, next) => {
                req[key] = client;
                next();
            }
        },
        config: {}
    });
    return {
        canvasClient,
        integration: {
            canvas: provider(canvasClient, 'canvasApi'),
            moodle: provider(moodleClient, 'moodleApi')
        }
    };
}

describe('LMS roster sync routes', () => {
    test('Canvas sync claims ownership, persists matched enrollment, and returns coverage safety', async () => {
        const harness = integrationHarness();
        const db = memoryDb({ courses: [course()] });
        const matchRoster = jest.fn(async ({ db: matchDb }) => {
            await matchDb.collection('lms_identity_mappings').insertOne({
                courseId: 'BIOC-1',
                provider: 'canvas',
                externalCourseId: '10',
                externalUserId: '900',
                localUserId: 'user-1'
            });
            return {
                provider: 'canvas',
                externalCourseId: '10',
                rosterSize: 2,
                matchedCount: 1,
                matchedBy: { integration: 1 },
                unmatchedLmsStudents: [],
                unmatchedBiocBotStudents: [{ localUserId: 'user-2', displayName: 'Grace', email: '' }],
                coverage: { total: 2, integrationId: 2, sisId: 2, email: 2, loginId: 2 }
            };
        });
        const app = makeRouteApp(createLmsRosterSyncRouter(harness.integration, { matchRoster }), { db, user: instructor });

        const res = await request(app)
            .post('/courses/BIOC-1/sync')
            .send({ provider: 'canvas' })
            .expect(200);

        expect(matchRoster).toHaveBeenCalledWith(expect.objectContaining({
            provider: 'canvas',
            externalCourseId: '10',
            client: harness.canvasClient
        }));
        expect(res.body.data).toMatchObject({
            rosterSource: 'canvas',
            coverage: { total: 2, integrationId: 2 },
            prune: { allowed: true, integrationIdRatio: 1 }
        });
        expect(res.body.data.syncToken).toEqual(expect.any(String));

        const stored = await db.collection('courses').findOne({ courseId: 'BIOC-1' });
        expect(stored.rosterSource).toBe('canvas');
        expect(stored.studentEnrollment['user-1']).toMatchObject({
            enrolled: true,
            source: 'canvas',
            externalUserId: '900'
        });
        expect(stored.lmsRosterSync.unmatchedLocalUserIds).toEqual(['user-2']);
    });

    test('Canvas sync takes ownership from Academic Sync when explicitly triggered', async () => {
        const harness = integrationHarness();
        const matchRoster = jest.fn(async () => ({
            provider: 'canvas',
            externalCourseId: '10',
            rosterSize: 0,
            matchedCount: 0,
            matchedBy: {},
            unmatchedLmsStudents: [],
            unmatchedBiocBotStudents: [],
            coverage: { total: 0, integrationId: 0, sisId: 0, email: 0, loginId: 0 }
        }));
        const db = memoryDb({
            courses: [course({
                rosterSource: 'academicSync',
                academicSync: { sectionIds: ['SEC-1'] }
            })]
        });
        const app = makeRouteApp(createLmsRosterSyncRouter(harness.integration, { matchRoster }), { db, user: instructor });

        const res = await request(app)
            .post('/courses/BIOC-1/sync')
            .send({ provider: 'canvas' })
            .expect(200);

        expect(res.body.data.rosterSource).toBe('canvas');
        expect(matchRoster).toHaveBeenCalled();
        expect((await db.collection('courses').findOne({ courseId: 'BIOC-1' })).rosterSource).toBe('canvas');
    });

    test('soft-drops only the candidates from the exact safe sync token', async () => {
        const harness = integrationHarness();
        const db = memoryDb({
            courses: [course({
                rosterSource: 'canvas',
                lmsRosterSync: {
                    provider: 'canvas',
                    externalCourseId: '10',
                    syncToken: 'sync-1',
                    coverage: { total: 10, integrationId: 9, sisId: 9, email: 10, loginId: 9 },
                    unmatchedLocalUserIds: ['user-2']
                }
            })]
        });
        const app = makeRouteApp(createLmsRosterSyncRouter(harness.integration), { db, user: instructor });

        await request(app)
            .post('/courses/BIOC-1/drop-unmatched')
            .send({ syncToken: 'stale' })
            .expect(409);

        const res = await request(app)
            .post('/courses/BIOC-1/drop-unmatched')
            .send({ syncToken: 'sync-1' })
            .expect(200);
        expect(res.body.data.droppedCount).toBe(1);

        const stored = await db.collection('courses').findOne({ courseId: 'BIOC-1' });
        expect(stored.studentEnrollment['user-1'].enrolled).toBe(false);
        expect(stored.studentEnrollment['user-2']).toMatchObject({ enrolled: false, source: 'canvas' });
        expect(stored.studentEnrollment['user-2'].droppedAt).toBeTruthy();
    });

    test('never offers prune for an empty or low-integration-coverage roster', () => {
        expect(buildPruneSafety({ total: 0, integrationId: 0 })).toMatchObject({ allowed: false, reason: 'empty-roster' });
        expect(buildPruneSafety({ total: 10, integrationId: 7 })).toMatchObject({
            allowed: false,
            reason: 'insufficient-integration-id-coverage'
        });
        expect(buildPruneSafety({ total: 10, integrationId: 8 })).toMatchObject({ allowed: true });
    });

    test('treats legacy academic-linked courses as Academic Sync owned', () => {
        expect(effectiveRosterSource({ academicSync: { sectionIds: ['SEC-1'] } })).toBe('academicSync');
        expect(effectiveRosterSource({})).toBe('manual');
    });
});
