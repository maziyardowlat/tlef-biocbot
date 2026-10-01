const { memoryDb } = require('../helpers/memory-db');
const { makeRouteApp, request } = require('../helpers/route-app');
const { matchCourseRoster } = require('../../../src/services/lmsRosterMatch');
const {
    buildPruneSafety,
    createLmsRosterSyncRouter,
    effectiveRosterSource,
    isDropCandidate
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

/** A student an earlier sync of Canvas course 10 put on this course. */
function canvasEnrollment(externalUserId, overrides = {}) {
    return {
        enrolled: true,
        source: 'canvas',
        externalUserId,
        externalCourseId: '10',
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
        const db = memoryDb({
            courses: [course({
                studentEnrollment: {
                    'user-1': { enrolled: false, source: 'manual' },
                    'user-2': { enrolled: true, source: 'manual' },
                    'user-3': canvasEnrollment('903'),
                    'user-4': canvasEnrollment('904'),
                    'user-5': canvasEnrollment('905', { enrolled: false })
                }
            })]
        });
        // 904 moved to a section this teacher cannot see; Canvas still has them.
        const confirmLeft = jest.fn(async () => new Set(['903']));
        const matchRoster = jest.fn(async ({ db: matchDb }) => {
            await matchDb.collection('lms_identity_mappings').insertOne({
                courseId: 'BIOC-1',
                provider: 'canvas',
                externalCourseId: '10',
                externalUserId: '900',
                localUserId: 'user-1'
            });
            await matchDb.collection('lms_identity_mappings').insertOne({
                courseId: 'BIOC-1',
                provider: 'canvas',
                externalCourseId: '10',
                externalUserId: '906',
                localUserId: 'user-6'
            });
            return {
                provider: 'canvas',
                externalCourseId: '10',
                rosterSize: 3,
                matchedCount: 2,
                matchedBy: { integration: 2 },
                unmatchedLmsStudents: [{ externalUserId: '901', name: 'New Student', reason: 'no-biocbot-account' }],
                unmatchedBiocBotStudents: [
                    { localUserId: 'user-2', displayName: 'Grace', email: '' },
                    { localUserId: 'user-3', displayName: 'Alan', email: '' },
                    { localUserId: 'user-4', displayName: 'Katherine', email: '' },
                    { localUserId: 'user-5', displayName: 'Edsger', email: '' }
                ],
                coverage: { total: 2, integrationId: 2, sisId: 2, email: 2, loginId: 2 }
            };
        });
        const app = makeRouteApp(createLmsRosterSyncRouter(harness.integration, { matchRoster, confirmLeft }), { db, user: instructor });

        const res = await request(app)
            .post('/courses/BIOC-1/sync')
            .send({ provider: 'canvas' })
            .expect(200);

        // Only students this Canvas course enrolled and who are gone from the
        // roster read are checked — not the manual one or the already-dropped one.
        expect(confirmLeft).toHaveBeenCalledWith(harness.canvasClient, '10', ['903', '904']);
        expect(matchRoster).toHaveBeenCalledWith(expect.objectContaining({
            provider: 'canvas',
            externalCourseId: '10',
            client: harness.canvasClient,
            // No class list on this course, so nobody outside it is enrolled.
            enrollFromRoster: false
        }));
        expect(res.body.data).toMatchObject({
            rosterSource: 'canvas',
            classListEnabled: false,
            coverage: { total: 2, integrationId: 2 },
            prune: { allowed: true, integrationIdRatio: 1 },
            addedCount: 1,
            blockedCount: 1
        });
        expect(res.body.data.syncToken).toEqual(expect.any(String));
        expect(res.body.data.dropCandidates).toEqual([
            { localUserId: 'user-3', displayName: 'Alan', email: '', accessDisabled: false }
        ]);
        expect(res.body.data.unmatchedBiocBotStudents.find((student) => student.localUserId === 'user-5'))
            .toMatchObject({ accessDisabled: true });

        const stored = await db.collection('courses').findOne({ courseId: 'BIOC-1' });
        expect(stored.rosterSource).toBe('canvas');
        // The instructor turned user-1 off by hand; being on the Canvas roster
        // does not turn them back on.
        expect(stored.studentEnrollment['user-1']).toEqual({ enrolled: false, source: 'manual' });
        expect(stored.studentEnrollment['user-6']).toMatchObject({
            enrolled: true,
            source: 'canvas',
            externalUserId: '906',
            externalCourseId: '10'
        });
        expect(stored.studentEnrollment['user-6'].joinedAt).toBeTruthy();
        expect(stored.lmsRosterSync.dropCandidateIds).toEqual(['user-3']);
        expect(stored.rosterSyncLockedUntil).toBeUndefined();
    });

    test('a student Canvas dropped gets access back when Canvas lists them again', async () => {
        const harness = integrationHarness();
        const db = memoryDb({
            courses: [course({
                rosterSource: 'canvas',
                studentEnrollment: {
                    'user-5': canvasEnrollment('905', { enrolled: false, droppedAt: new Date('2026-09-01') })
                }
            })]
        });
        const matchRoster = jest.fn(async ({ db: matchDb }) => {
            await matchDb.collection('lms_identity_mappings').insertOne({
                courseId: 'BIOC-1',
                provider: 'canvas',
                externalCourseId: '10',
                externalUserId: '905',
                localUserId: 'user-5'
            });
            return {
                provider: 'canvas',
                externalCourseId: '10',
                rosterSize: 1,
                matchedCount: 1,
                matchedBy: { integration: 1 },
                unmatchedLmsStudents: [],
                unmatchedBiocBotStudents: [],
                coverage: { total: 1, integrationId: 1, sisId: 1, email: 1, loginId: 1 }
            };
        });
        const app = makeRouteApp(createLmsRosterSyncRouter(harness.integration, { matchRoster }), { db, user: instructor });

        await request(app).post('/courses/BIOC-1/sync').send({ provider: 'canvas' }).expect(200);

        const stored = await db.collection('courses').findOne({ courseId: 'BIOC-1' });
        expect(stored.studentEnrollment['user-5']).toMatchObject({ enrolled: true, source: 'canvas' });
        expect(stored.studentEnrollment['user-5'].droppedAt).toBeUndefined();
    });

    test('refuses a second sync while one is still running for the course', async () => {
        const harness = integrationHarness();
        const db = memoryDb({
            courses: [course({ rosterSyncLockedUntil: new Date(Date.now() + 60_000) })]
        });
        const matchRoster = jest.fn();
        const app = makeRouteApp(createLmsRosterSyncRouter(harness.integration, { matchRoster }), { db, user: instructor });

        const res = await request(app).post('/courses/BIOC-1/sync').send({ provider: 'canvas' }).expect(409);

        expect(res.body.code).toBe('ROSTER_SYNC_IN_PROGRESS');
        expect(matchRoster).not.toHaveBeenCalled();
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
                studentEnrollment: {
                    'user-1': { enrolled: false, source: 'manual' },
                    'user-2': canvasEnrollment('902')
                },
                lmsRosterSync: {
                    provider: 'canvas',
                    externalCourseId: '10',
                    syncToken: 'sync-1',
                    coverage: { total: 10, integrationId: 9, sisId: 9, email: 10, loginId: 9 },
                    dropCandidateIds: ['user-2']
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
        expect(stored.studentEnrollment['user-2']).toMatchObject({ enrolled: false, source: 'canvas', externalCourseId: '10' });
        expect(stored.studentEnrollment['user-2'].droppedAt).toBeTruthy();
    });

    test('refuses to drop from a sync stored before drops were limited to the Canvas course', async () => {
        const harness = integrationHarness();
        const db = memoryDb({
            courses: [course({
                rosterSource: 'canvas',
                lmsRosterSync: {
                    provider: 'canvas',
                    externalCourseId: '10',
                    syncToken: 'sync-1',
                    coverage: { total: 10, integrationId: 9 },
                    unmatchedLocalUserIds: ['user-2']
                }
            })]
        });
        const app = makeRouteApp(createLmsRosterSyncRouter(harness.integration), { db, user: instructor });

        const res = await request(app)
            .post('/courses/BIOC-1/drop-unmatched')
            .send({ syncToken: 'sync-1' })
            .expect(409);

        expect(res.body.code).toBe('ROSTER_SYNC_STALE');
        const stored = await db.collection('courses').findOne({ courseId: 'BIOC-1' });
        expect(stored.studentEnrollment['user-2']).toEqual({ enrolled: true, source: 'manual' });
    });

    test('leaves a candidate alone when the instructor changed their access by hand after the sync', async () => {
        const harness = integrationHarness();
        const db = memoryDb({
            courses: [course({
                rosterSource: 'canvas',
                studentEnrollment: {
                    'user-2': { enrolled: true, updatedAt: new Date() },
                    'user-3': canvasEnrollment('903')
                },
                lmsRosterSync: {
                    provider: 'canvas',
                    externalCourseId: '10',
                    syncToken: 'sync-1',
                    coverage: { total: 10, integrationId: 9 },
                    dropCandidateIds: ['user-2', 'user-3']
                }
            })]
        });
        const app = makeRouteApp(createLmsRosterSyncRouter(harness.integration), { db, user: instructor });

        const res = await request(app)
            .post('/courses/BIOC-1/drop-unmatched')
            .send({ syncToken: 'sync-1' })
            .expect(200);

        expect(res.body.data.droppedCount).toBe(1);
        const stored = await db.collection('courses').findOne({ courseId: 'BIOC-1' });
        expect(stored.studentEnrollment['user-2'].enrolled).toBe(true);
        expect(stored.studentEnrollment['user-3'].enrolled).toBe(false);
    });

    test('only students this Canvas course enrolled, now gone from the roster read, go on to the Canvas check', () => {
        const context = { externalCourseId: '10', rosterExternalUserIds: new Set(['900']) };

        expect(isDropCandidate(canvasEnrollment('903'), context)).toBe(true);
        // Still on the roster, even if BiocBot could not match them this time.
        expect(isDropCandidate(canvasEnrollment('900'), context)).toBe(false);
        // Synced from a different Canvas course, or before the course was recorded.
        expect(isDropCandidate(canvasEnrollment('903', { externalCourseId: '99' }), context)).toBe(false);
        expect(isDropCandidate({ enrolled: true, source: 'canvas', externalUserId: '903' }, context)).toBe(false);
        // Joined another way, or already dropped.
        expect(isDropCandidate({ enrolled: true, source: 'manual' }, context)).toBe(false);
        expect(isDropCandidate(canvasEnrollment('903', { enrolled: false }), context)).toBe(false);
        expect(isDropCandidate(undefined, context)).toBe(false);
    });

    test('tells the browser to reconnect only when a Canvas 401 left no stored tokens behind', async () => {
        const harness = integrationHarness();
        const tokens = { current: null };
        harness.integration.canvas.config = {
            getUserKey: (req) => req.user.userId,
            tokenStore: { get: jest.fn(async () => tokens.current) }
        };
        const matchRoster = jest.fn(async () => {
            throw Object.assign(new Error('Canvas API request to /api/v1/courses/10/users returned 401'), { statusCode: 401 });
        });
        const db = memoryDb({ courses: [course()] });
        const app = makeRouteApp(createLmsRosterSyncRouter(harness.integration, { matchRoster }), { db, user: instructor });
        const error = jest.spyOn(console, 'error').mockImplementation(() => {});

        const expired = await request(app).post('/courses/BIOC-1/sync').send({ provider: 'canvas' }).expect(401);
        expect(expired.body).toMatchObject({ connected: false, code: 'CANVAS_NOT_CONNECTED' });

        tokens.current = { accessToken: 'still-valid' };
        const refused = await request(app).post('/courses/BIOC-1/sync').send({ provider: 'canvas' }).expect(403);
        expect(refused.body).toMatchObject({ code: 'CANVAS_ACCESS_DENIED' });
        error.mockRestore();
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

describe('Canvas class list', () => {
    // A Canvas roster read through the real matcher, so linking exercises the
    // same PUID/email rules a sync does.
    const ROSTER = [
        { id: '701', name: 'Ada Already', email: 'ada@student.ubc.ca', integrationId: 'PUID-A' },
        { id: '702', name: 'Bea Blocked', email: 'bea@student.ubc.ca', integrationId: 'PUID-B' },
        { id: '703', name: 'Cy New', email: 'cy@student.ubc.ca', integrationId: 'PUID-C' }
    ];
    const TEACHER_COURSES = [
        { id: 10, name: 'BIOC 301 2026W1', code: 'BIOC301' },
        { id: 20, name: 'BIOC 302 2026W1', code: 'BIOC302' }
    ];

    function rosterReader(entries = ROSTER) {
        return jest.fn(async ({ db, course: syncedCourse, externalCourseId, matchedBy, enrollFromRoster }) => ({
            ...(await matchCourseRoster({
                db,
                course: syncedCourse,
                provider: 'canvas',
                roster: { externalCourseId, entries },
                matchedBy,
                enrollFromRoster
            })),
            coverage: { total: entries.length, integrationId: entries.length, sisId: 0, email: entries.length, loginId: 0 }
        }));
    }

    function classListDb(overrides = {}) {
        return memoryDb({
            users: [
                // Uses BiocBot for another course, never joined this one.
                { userId: 'stu-a', role: 'student', puid: 'PUID-A', email: 'ada@student.ubc.ca', preferences: { courseId: 'OTHER' } },
                // Turned off by hand in this course.
                { userId: 'stu-b', role: 'student', puid: 'PUID-B', email: 'bea@student.ubc.ca' }
            ],
            courses: [course({ studentEnrollment: { 'stu-b': { enrolled: false, updatedAt: new Date('2026-09-02') } } })],
            ...overrides
        });
    }

    function classListApp(db, dependencies = {}) {
        const harness = integrationHarness();
        return makeRouteApp(createLmsRosterSyncRouter(harness.integration, {
            matchRoster: rosterReader(),
            confirmLeft: jest.fn(async () => new Set()),
            listTeacherCourses: jest.fn(async () => TEACHER_COURSES),
            saveGradeSource: jest.fn(async () => ({})),
            ...dependencies
        }), { db, user: instructor });
    }

    test('starts off, suggesting the Canvas course already linked for grades or files', async () => {
        const res = await request(classListApp(classListDb())).get('/courses/BIOC-1/class-list').expect(200);

        expect(res.body.data).toMatchObject({
            canvasConfigured: true,
            enabled: false,
            canvasCourse: null,
            suggestedCanvasCourse: { id: '10', name: 'BIOC 301' },
            allowCodeJoin: true,
            pendingCount: 0
        });
    });

    test('linking enrolls roster students who already use BiocBot and saves the rest for sign-in', async () => {
        const db = classListDb();
        const saveGradeSource = jest.fn(async () => ({}));
        const res = await request(classListApp(db, { saveGradeSource }))
            .put('/courses/BIOC-1/class-list')
            .send({ provider: 'canvas', externalCourseId: '10' })
            .expect(200);

        expect(res.body.data.sync).toMatchObject({ classListEnabled: true, addedCount: 1, blockedCount: 1 });
        expect(res.body.data.sync.rosterEntries).toBeUndefined();
        expect(res.body.data.classList).toMatchObject({
            enabled: true,
            canvasCourse: { id: '10', name: 'BIOC 301 2026W1', code: 'BIOC301' },
            allowCodeJoin: true,
            pendingCount: 1,
            pending: [{ name: 'Cy New', email: 'cy@student.ubc.ca' }]
        });
        // Already pinned to Canvas course 10 for grades, so nothing to re-pin.
        expect(saveGradeSource).not.toHaveBeenCalled();

        const stored = await db.collection('courses').findOne({ courseId: 'BIOC-1' });
        expect(stored.rosterSource).toBe('canvas');
        expect(stored.canvasEnrollment).toMatchObject({
            enabled: true,
            externalCourseId: '10',
            enabledBy: 'inst-1',
            syncStatus: { lastTrigger: 'link', lastError: null }
        });
        expect(stored.studentEnrollment['stu-a']).toMatchObject({
            enrolled: true, source: 'canvas', externalUserId: '701', externalCourseId: '10'
        });
        expect(stored.studentEnrollment['stu-b']).toMatchObject({ enrolled: false });
        expect(stored.studentEnrollment['stu-b'].source).toBeUndefined();

        const rows = await db.collection('lms_roster_entries').find({ courseId: 'BIOC-1' }).toArray();
        expect(Object.fromEntries(rows.map((row) => [row.externalUserId, row.localUserId]))).toEqual({
            701: 'stu-a',
            702: 'stu-b',
            703: null
        });
        expect(rows.find((row) => row.externalUserId === '703')).toMatchObject({
            integrationIdKey: 'puid-c',
            emailKey: 'cy@student.ubc.ca'
        });
    });

    test('a later sync drops saved rows for students who left Canvas', async () => {
        const db = classListDb();
        await request(classListApp(db))
            .put('/courses/BIOC-1/class-list')
            .send({ provider: 'canvas', externalCourseId: '10' })
            .expect(200);

        await request(classListApp(db, { matchRoster: rosterReader(ROSTER.slice(0, 2)) }))
            .post('/courses/BIOC-1/sync')
            .send({ provider: 'canvas' })
            .expect(200);

        const rows = await db.collection('lms_roster_entries').find({ courseId: 'BIOC-1' }).toArray();
        expect(rows.map((row) => row.externalUserId).sort()).toEqual(['701', '702']);
        const stored = await db.collection('courses').findOne({ courseId: 'BIOC-1' });
        expect(stored.canvasEnrollment.syncStatus).toMatchObject({ lastTrigger: 'manual', lastError: null });
    });

    test('pins grades to the class-list course when it differs from the grade source', async () => {
        const db = classListDb();
        const saveGradeSource = jest.fn(async () => ({}));
        await request(classListApp(db, { saveGradeSource }))
            .put('/courses/BIOC-1/class-list')
            .send({ provider: 'canvas', externalCourseId: '20' })
            .expect(200);

        expect(saveGradeSource).toHaveBeenCalledWith(expect.objectContaining({
            provider: 'canvas',
            externalCourse: expect.objectContaining({ id: 20 })
        }));
    });

    test('refuses a Canvas course the instructor does not teach, and changes nothing', async () => {
        const db = classListDb();
        const matchRoster = rosterReader();
        const res = await request(classListApp(db, { matchRoster }))
            .put('/courses/BIOC-1/class-list')
            .send({ provider: 'canvas', externalCourseId: '999' })
            .expect(403);

        expect(res.body.code).toBe('CANVAS_COURSE_NOT_TAUGHT');
        expect(matchRoster).not.toHaveBeenCalled();
        const stored = await db.collection('courses').findOne({ courseId: 'BIOC-1' });
        expect(stored.canvasEnrollment).toBeUndefined();
        expect(stored.rosterSource).toBe('manual');
    });

    test('a failed first roster read leaves the class list off', async () => {
        const db = classListDb();
        const matchRoster = jest.fn(async () => {
            throw Object.assign(new Error('Canvas throttled the request'), { statusCode: 403 });
        });
        const error = jest.spyOn(console, 'error').mockImplementation(() => {});
        await request(classListApp(db, { matchRoster }))
            .put('/courses/BIOC-1/class-list')
            .send({ provider: 'canvas', externalCourseId: '10' })
            .expect(403);
        error.mockRestore();

        const stored = await db.collection('courses').findOne({ courseId: 'BIOC-1' });
        expect(stored.canvasEnrollment).toBeUndefined();
        expect(stored.rosterSyncLockedUntil).toBeUndefined();
    });

    test('the course code can be turned off only while the class list is on', async () => {
        const db = classListDb();
        const app = classListApp(db);

        const off = await request(app).patch('/courses/BIOC-1/class-list').send({ allowCodeJoin: false }).expect(409);
        expect(off.body.code).toBe('CLASS_LIST_OFF');
        await request(app).patch('/courses/BIOC-1/class-list').send({ allowCodeJoin: 'no' }).expect(400);

        await request(app).put('/courses/BIOC-1/class-list').send({ provider: 'canvas', externalCourseId: '10' }).expect(200);
        const res = await request(app).patch('/courses/BIOC-1/class-list').send({ allowCodeJoin: false }).expect(200);

        expect(res.body.data.allowCodeJoin).toBe(false);
        expect((await db.collection('courses').findOne({ courseId: 'BIOC-1' })).canvasEnrollment.allowCodeJoin).toBe(false);
    });

    test('turning the class list off keeps everyone enrolled and forgets the saved roster', async () => {
        const db = classListDb();
        const app = classListApp(db);
        await request(app).put('/courses/BIOC-1/class-list').send({ provider: 'canvas', externalCourseId: '10' }).expect(200);

        const res = await request(app).delete('/courses/BIOC-1/class-list').expect(200);

        expect(res.body.data).toMatchObject({ enabled: false, allowCodeJoin: true, pendingCount: 0 });
        const stored = await db.collection('courses').findOne({ courseId: 'BIOC-1' });
        expect(stored.canvasEnrollment.enabled).toBe(false);
        expect(stored.rosterSource).toBe('manual');
        expect(stored.studentEnrollment['stu-a'].enrolled).toBe(true);
        expect(await db.collection('lms_roster_entries').find({ courseId: 'BIOC-1' }).toArray()).toEqual([]);
    });
});
