/**
 * Canvas submission and grade synchronization — identity, scoping, and export
 * safety.
 *
 * These run the real `@ubc/ubc-genai-toolkit-lms-integration` against a fake
 * Canvas HTTP client holding several courses, so the assertions are about what
 * the toolkit actually does rather than about BiocBot calling a well-named stub.
 * The multi-course fixture also lets each test prove a negative — that CHEM123
 * was read and BIOL200/PHYS101 never were.
 */

const express = require('express');
const request = require('supertest');

const { memoryDb } = require('../helpers/memory-db');
const {
    assignmentFixture,
    fakeCanvasClient,
    rosterUser,
    submissionFixture
} = require('../helpers/canvas-fake');
const { createStudentHubCanvasGradesRouter } = require('../../../src/routes/studentHubCanvasGrades');
const { canvas } = require('@ubc/ubc-genai-toolkit-lms-integration');

const CHEM123 = '1001';
const BIOL200 = '2002';
const PHYS101 = '3003';
const LAB1 = '55';
const LAB2 = '56';

const INTEGRATION_ID = 'canvas:BIOC-1';
const instructor = { userId: 'inst-1', role: 'instructor' };

const PUID = { alice: 'PUID-ALICE', bob: 'PUID-BOB', carol: 'PUID-CAROL' };
// Canvas ids are the same person in every course they take — which is exactly
// why a grade resolved against one course's roster must never be posted to
// another. Alice is 501 in all three courses below.
const CANVAS_USER = { alice: 501, bob: 502, carol: 503, stranger: 599 };

function biocbotCourse(overrides = {}) {
    return {
        courseId: 'BIOC-1',
        courseName: 'CHEM 123',
        instructorId: 'inst-1',
        instructors: ['inst-1'],
        lmsGradeSources: { canvas: { courseId: CHEM123, name: 'CHEM 123', code: 'CHEM123' } },
        ...overrides
    };
}

function biocbotStudents(overrides = []) {
    const base = [
        { userId: 'u-alice', role: 'student', displayName: 'Alice Ng', puid: PUID.alice, preferences: { courseId: 'BIOC-1' } },
        { userId: 'u-bob', role: 'student', displayName: 'Bob Ito', puid: PUID.bob, preferences: { courseId: 'BIOC-1' } },
        { userId: 'u-carol', role: 'student', displayName: 'Carol Diaz', puid: PUID.carol, preferences: { courseId: 'BIOC-1' } }
    ];
    return [...base, ...overrides];
}

/**
 * CHEM123 carries Alice and Bob. Carol appears only in BIOL200, so a lookup
 * that leaked into another course would find her — and must not.
 */
function canvasWorld(overrides = {}) {
    return {
        courses: {
            [CHEM123]: {
                users: [
                    rosterUser({ id: CANVAS_USER.alice, name: 'Alice Ng', integrationId: PUID.alice }),
                    rosterUser({ id: CANVAS_USER.bob, name: 'Bob Ito', integrationId: PUID.bob })
                ],
                assignments: [
                    assignmentFixture({ id: LAB1, name: 'Lab 1', pointsPossible: 10 }),
                    assignmentFixture({ id: LAB2, name: 'Lab 2', pointsPossible: 20 })
                ],
                submissions: {
                    [LAB1]: [
                        submissionFixture({ userId: CANVAS_USER.alice, assignmentId: LAB1, score: 8, grade: '8' }),
                        submissionFixture({
                            userId: CANVAS_USER.bob,
                            assignmentId: LAB1,
                            workflowState: 'unsubmitted',
                            submittedAt: null
                        })
                    ],
                    [LAB2]: []
                }
            },
            [BIOL200]: {
                users: [
                    rosterUser({ id: CANVAS_USER.alice, name: 'Alice Ng', integrationId: PUID.alice }),
                    rosterUser({ id: CANVAS_USER.carol, name: 'Carol Diaz', integrationId: PUID.carol })
                ],
                assignments: [assignmentFixture({ id: LAB1, name: 'Other Lab 1', pointsPossible: 10 })],
                submissions: { [LAB1]: [submissionFixture({ userId: CANVAS_USER.carol, assignmentId: LAB1, score: 10 })] }
            },
            [PHYS101]: {
                users: [rosterUser({ id: CANVAS_USER.alice, name: 'Alice Ng', integrationId: PUID.alice })],
                assignments: [assignmentFixture({ id: LAB1, name: 'Physics Lab 1' })],
                submissions: { [LAB1]: [] }
            }
        },
        ...overrides
    };
}

/**
 * Mounts the router with the real toolkit namespace and a fake transport.
 * `sessionID` is injected because prepared export operations are bound to it.
 */
function makeApp({ db, world = canvasWorld(), user = instructor, sessionID = 'sess-1' } = {}) {
    const client = fakeCanvasClient(world);
    const integration = {
        api: {
            ...canvas,
            requireAuth: () => (req, res, next) => { req.canvasApi = client; next(); }
        },
        config: {}
    };

    const app = express();
    app.locals.db = db;
    app.use((req, res, next) => {
        req.user = user;
        req.sessionID = sessionID;
        next();
    });
    app.use('/', createStudentHubCanvasGradesRouter(integration));
    return { app, client, world };
}

function seedDb(extra = {}) {
    return memoryDb({
        courses: [biocbotCourse()],
        users: biocbotStudents(),
        ...extra
    });
}

/** Imports grades for Lab 1. Returns the supertest chain so `.expect()` works. */
function importGrades(app, body = {}) {
    return request(app)
        .post('/grades/import')
        .send({ courseIntegrationId: INTEGRATION_ID, gradeItemId: LAB1, ...body });
}

describe('Student Hub Canvas grade sync — identity', () => {
    test('1. a PUID matches only Canvas integration_id', async () => {
        const db = seedDb();
        const { app } = makeApp({ db });

        const res = await importGrades(app).expect(200);

        // Alice matched on integration_id; the stored row is keyed by BiocBot's
        // own user id, and carries the PUID as the evidence for the match.
        const alice = res.body.data.records.find((row) => row.appUserId === 'u-alice');
        expect(alice).toBeDefined();
        expect(alice.canvasScore).toBe(8);
        expect(alice.puidMasked).toBe('••••LICE');

        const stored = await db.collection('canvas_grade_records').findOne({ appUserId: 'u-alice' });
        expect(stored.puid).toBe(PUID.alice);
    });

    test('2. email, name, SIS id, and login id are never fallback matches', async () => {
        // Every weak identifier lines up perfectly; only integration_id is absent.
        const world = canvasWorld();
        world.courses[CHEM123].users = [
            rosterUser({
                id: CANVAS_USER.alice,
                name: 'Alice Ng',
                integrationId: null,
                sisId: PUID.alice,
                loginId: PUID.alice,
                email: `${PUID.alice}@example.edu`
            }),
            rosterUser({ id: CANVAS_USER.bob, name: 'Bob Ito', integrationId: PUID.bob })
        ];

        const db = seedDb();
        const { app } = makeApp({ db, world });
        const res = await importGrades(app).expect(200);

        expect(res.body.data.records.some((row) => row.appUserId === 'u-alice')).toBe(false);
        expect(res.body.data.roster.appOnly.map((entry) => entry.appUserId)).toContain('u-alice');
        // Bob still matched, so this is a rejected weak match rather than a
        // roster that failed to load.
        expect(res.body.data.records.some((row) => row.appUserId === 'u-bob')).toBe(true);
    });

    test('3. a student in several Canvas courses is synchronized only through the linked course', async () => {
        const db = seedDb();
        const { app, client } = makeApp({ db });

        await importGrades(app).expect(200);

        expect(client.pathsTouching(CHEM123).length).toBeGreaterThan(0);
        expect(client.pathsTouching(BIOL200)).toEqual([]);
        expect(client.pathsTouching(PHYS101)).toEqual([]);
    });

    test('4. a PUID present in another course but not the selected one stays unmatched', async () => {
        const db = seedDb();
        const { app, client } = makeApp({ db });

        const res = await importGrades(app).expect(200);

        const carol = res.body.data.roster.appOnly.find((entry) => entry.appUserId === 'u-carol');
        expect(carol).toBeDefined();
        // Not "missing a submission" — not on the selected course's roster.
        expect(carol.message).toMatch(/Not enrolled in the linked Canvas course/);
        // Her PUID is on BIOL200's roster, which was never consulted.
        expect(client.pathsTouching(BIOL200)).toEqual([]);
    });

    test('6. duplicate PUIDs are ambiguous and receive no grade', async () => {
        const db = seedDb({
            users: biocbotStudents([
                {
                    userId: 'u-alice-dup',
                    role: 'student',
                    displayName: 'A. Ng (duplicate)',
                    puid: PUID.alice,
                    preferences: { courseId: 'BIOC-1' }
                }
            ])
        });
        const { app } = makeApp({ db });

        const res = await importGrades(app).expect(200);

        const ambiguous = res.body.data.roster.ambiguous;
        expect(ambiguous).toHaveLength(1);
        expect(ambiguous[0].appUserIds.sort()).toEqual(['u-alice', 'u-alice-dup']);
        // Neither account may hold Alice's Canvas score.
        expect(res.body.data.records.some((row) => row.appUserId.startsWith('u-alice'))).toBe(false);
    });

    test('11. Canvas user ids are never stored as BiocBot user ids', async () => {
        const db = seedDb();
        const { app } = makeApp({ db });

        await importGrades(app).expect(200);

        const rows = await db.collection('canvas_grade_records').find({}).toArray();
        expect(rows.length).toBeGreaterThan(0);
        const canvasIds = Object.values(CANVAS_USER).map(String);
        for (const row of rows) {
            expect(canvasIds).not.toContain(String(row.appUserId));
            // No Canvas id is persisted at all: it is re-derived per request.
            expect(JSON.stringify(row)).not.toMatch(/canvasUserId|lmsUserId/);
        }
    });
});

describe('Student Hub Canvas grade sync — course boundary', () => {
    test('7. missing integration_id coverage blocks import', async () => {
        const world = canvasWorld();
        world.courses[CHEM123].users = world.courses[CHEM123].users.map((user) => ({
            ...user,
            integration_id: null
        }));

        const db = seedDb();
        const { app } = makeApp({ db, world });

        const res = await importGrades(app).expect(409);
        expect(res.body.code).toBe('roster-coverage');
        expect(res.body.message).toMatch(/SIS-read permission/);
    });

    test('7b. missing integration_id coverage blocks export preview', async () => {
        const db = seedDb();
        const { app } = makeApp({ db });
        await importGrades(app).expect(200);

        // Coverage disappears (a permission change) before the export.
        const world = canvasWorld();
        world.courses[CHEM123].users = world.courses[CHEM123].users.map((user) => ({
            ...user,
            integration_id: null
        }));
        const second = makeApp({ db, world });

        await request(second.app)
            .put('/grades/draft')
            .send({ courseIntegrationId: INTEGRATION_ID, gradeItemId: LAB1, appUserId: 'u-alice', draftScore: 9 });

        const res = await request(second.app)
            .post('/grade-exports/preview')
            .send({ courseIntegrationId: INTEGRATION_ID, gradeItemId: LAB1 })
            .expect(409);
        expect(res.body.code).toBe('roster-coverage');
    });

    test('8. a browser-supplied Canvas course id cannot redirect the operation', async () => {
        const db = seedDb();
        const { app, client } = makeApp({ db });

        const res = await request(app)
            .post('/grades/import')
            .send({
                courseIntegrationId: INTEGRATION_ID,
                gradeItemId: LAB1,
                // All of these are ignored: the course comes from the link record.
                canvasCourseId: BIOL200,
                courseId: BIOL200,
                canvas_course_id: BIOL200
            })
            .expect(200);

        expect(res.body.data.roster.canvasCourseId).toBe(CHEM123);
        expect(client.pathsTouching(BIOL200)).toEqual([]);
        // Carol's BIOL200 score of 10 must not have leaked in.
        expect(res.body.data.records.some((row) => row.appUserId === 'u-carol')).toBe(false);
    });

    test('8b. a raw Canvas course id is not a valid BiocBot integration id', async () => {
        const db = seedDb();
        const { app, client } = makeApp({ db });

        const res = await request(app)
            .post('/grades/import')
            .send({ courseIntegrationId: BIOL200, gradeItemId: LAB1 })
            .expect(400);

        expect(res.body.code).toBe('invalid-integration-id');
        expect(client.requests).toEqual([]);
    });

    test('an assignment from another Canvas course cannot be targeted', async () => {
        const db = seedDb();
        const { app } = makeApp({ db });

        const res = await importGrades(app, { gradeItemId: '9999' }).expect(400);
        expect(res.body.code).toBe('assignment-mismatch');
    });

    test('an instructor without access to the BiocBot course is refused', async () => {
        const db = seedDb();
        const { app, client } = makeApp({ db, user: { userId: 'inst-other', role: 'instructor' } });

        const res = await importGrades(app).expect(403);
        expect(res.body.code).toBe('forbidden');
        expect(client.requests).toEqual([]);
    });
});

describe('Student Hub Canvas grade sync — submissions', () => {
    test('submission import stores status and metadata but downloads nothing', async () => {
        const world = canvasWorld();
        world.courses[CHEM123].submissions[LAB1][0].attachments = [
            { id: 900, filename: 'lab1.pdf', display_name: 'Lab 1.pdf', 'content-type': 'application/pdf', size: 12, url: 'https://canvas.test/files/900' }
        ];

        const db = seedDb();
        const { app, client } = makeApp({ db, world });

        const res = await request(app)
            .post('/submissions/import')
            .send({ courseIntegrationId: INTEGRATION_ID, gradeItemId: LAB1 })
            .expect(200);

        const alice = res.body.data.records.find((row) => row.appUserId === 'u-alice');
        expect(alice.submissionState).toBe('submitted');
        expect(alice.submittedAt).toBeTruthy();
        expect(alice.attachments).toEqual([
            expect.objectContaining({ id: '900', displayName: 'Lab 1.pdf' })
        ]);

        const bob = res.body.data.records.find((row) => row.appUserId === 'u-bob');
        expect(bob.submissionState).toBe('unsubmitted');

        // Metadata only: no bytes were fetched during the import.
        expect(client.requests.some((entry) => entry.method === 'DOWNLOAD')).toBe(false);
    });

    test('9. a mixed-course or mixed-assignment submission result is rejected', () => {
        const report = {
            courseId: CHEM123,
            matched: [{ key: PUID.alice, appUserId: 'u-alice', lmsUserId: String(CANVAS_USER.alice), name: 'Alice Ng', matchedBy: 'integrationId' }],
            appOnly: [],
            rosterOnly: [],
            ambiguous: [],
            coverage: { total: 2, integrationId: 2, sisId: 0, email: 0, loginId: 0 }
        };
        const good = {
            courseId: CHEM123,
            gradeItemId: LAB1,
            userId: String(CANVAS_USER.alice),
            workflowState: 'submitted',
            attachments: [],
            raw: {}
        };

        expect(() => canvas.resolveSubmissions(report, LAB1, [{ ...good, courseId: BIOL200 }]))
            .toThrow(expect.objectContaining({ reason: 'course-mismatch' }));
        expect(() => canvas.resolveSubmissions(report, LAB1, [{ ...good, gradeItemId: LAB2 }]))
            .toThrow(expect.objectContaining({ reason: 'assignment-mismatch' }));
    });

    test('9b. submission import uses the package resolver rather than a private join', async () => {
        const db = seedDb();
        const world = canvasWorld();
        const client = fakeCanvasClient(world);
        const resolveSubmissions = jest.fn((...args) => canvas.resolveSubmissions(...args));
        const integration = {
            api: {
                ...canvas,
                resolveSubmissions,
                requireAuth: () => (req, res, next) => { req.canvasApi = client; next(); }
            },
            config: {}
        };
        const app = express();
        app.locals.db = db;
        app.use((req, res, next) => { req.user = instructor; req.sessionID = 'sess-1'; next(); });
        app.use('/', createStudentHubCanvasGradesRouter(integration));

        await request(app)
            .post('/submissions/import')
            .send({ courseIntegrationId: INTEGRATION_ID, gradeItemId: LAB1 })
            .expect(200);

        expect(resolveSubmissions).toHaveBeenCalledTimes(1);
        expect(resolveSubmissions.mock.calls[0][1]).toBe(LAB1);
    });

    test('10. grade import maps Canvas userId through the roster report', async () => {
        const world = canvasWorld();
        // A Canvas student with a grade but no BiocBot account.
        world.courses[CHEM123].users.push(
            rosterUser({ id: CANVAS_USER.stranger, name: 'Dana Stranger', integrationId: 'PUID-DANA' })
        );
        world.courses[CHEM123].submissions[LAB1].push(
            submissionFixture({ userId: CANVAS_USER.stranger, assignmentId: LAB1, score: 7 })
        );

        const db = seedDb();
        const { app } = makeApp({ db, world });
        const res = await importGrades(app).expect(200);

        // The unmapped row is reported, not dropped and not stored.
        expect(res.body.data.unresolved).toEqual([{ reason: 'no-app-account' }]);
        const rows = await db.collection('canvas_grade_records').find({}).toArray();
        expect(rows.map((row) => row.appUserId).sort()).toEqual(['u-alice', 'u-bob']);
        expect(rows.every((row) => row.canvasScore !== 7)).toBe(true);
    });

    test('16. attachment download is course/assignment/student scoped and enforces maxBytes', async () => {
        const world = canvasWorld();
        world.courses[CHEM123].submissions[LAB1][0].attachments = [
            { id: 900, filename: 'lab1.pdf', display_name: 'Lab 1.pdf', 'content-type': 'application/pdf', size: 4, url: 'https://canvas.test/files/900' }
        ];
        world.files = {
            'https://canvas.test/files/900': {
                data: new Uint8Array([1, 2, 3, 4]),
                contentType: 'application/pdf',
                filename: 'lab1.pdf'
            }
        };

        const db = seedDb();
        const { app, client } = makeApp({ db, world });
        const imported = await request(app)
            .post('/submissions/import')
            .send({ courseIntegrationId: INTEGRATION_ID, gradeItemId: LAB1 })
            .expect(200);
        const alice = imported.body.data.records.find((row) => row.appUserId === 'u-alice');

        const res = await request(app)
            .post('/submissions/attachment')
            .send({
                courseIntegrationId: INTEGRATION_ID,
                gradeItemId: LAB1,
                recordId: alice.recordId,
                attachmentId: '900'
            })
            .expect(200);
        expect(res.headers['content-disposition']).toContain('lab1.pdf');

        // Resolved through the course-, assignment-, and student-scoped endpoint.
        expect(client.requests.some((entry) => entry.method === 'GET'
            && entry.path === `/courses/${CHEM123}/assignments/${LAB1}/submissions/${CANVAS_USER.alice}`)).toBe(true);

        // An attachment not listed on this student's submission is refused
        // before any Canvas read.
        const wrong = await request(app)
            .post('/submissions/attachment')
            .send({
                courseIntegrationId: INTEGRATION_ID,
                gradeItemId: LAB1,
                recordId: alice.recordId,
                attachmentId: '901'
            })
            .expect(404);
        expect(wrong.body.code).toBe('attachment-not-found');
    });

    test('16b. maxBytes is enforced on the download', async () => {
        const world = canvasWorld();
        world.courses[CHEM123].submissions[LAB1][0].attachments = [
            { id: 900, filename: 'big.pdf', display_name: 'big.pdf', size: 8, url: 'https://canvas.test/files/900' }
        ];
        world.files = {
            'https://canvas.test/files/900': { data: new Uint8Array(8), contentType: 'application/pdf', filename: 'big.pdf' }
        };

        const db = seedDb();
        const previousLimit = process.env.CANVAS_SUBMISSION_ATTACHMENT_MAX_BYTES;
        process.env.CANVAS_SUBMISSION_ATTACHMENT_MAX_BYTES = '4';
        try {
            const { app } = makeApp({ db, world });
            const imported = await request(app)
                .post('/submissions/import')
                .send({ courseIntegrationId: INTEGRATION_ID, gradeItemId: LAB1 })
                .expect(200);
            const alice = imported.body.data.records.find((row) => row.appUserId === 'u-alice');

            const res = await request(app)
                .post('/submissions/attachment')
                .send({
                    courseIntegrationId: INTEGRATION_ID,
                    gradeItemId: LAB1,
                    recordId: alice.recordId,
                    attachmentId: '900'
                })
                .expect(502);
            expect(res.body.code).toBe('canvas-api-error');
        } finally {
            if (previousLimit === undefined) delete process.env.CANVAS_SUBMISSION_ATTACHMENT_MAX_BYTES;
            else process.env.CANVAS_SUBMISSION_ATTACHMENT_MAX_BYTES = previousLimit;
        }
    });
});

describe('Student Hub Canvas grade sync — drafts and export', () => {
    function draft(app, appUserId, draftScore, draftComment = '') {
        return request(app)
            .put('/grades/draft')
            .send({ courseIntegrationId: INTEGRATION_ID, gradeItemId: LAB1, appUserId, draftScore, draftComment });
    }

    test('17. an unsynced local draft is not overwritten by a Canvas import', async () => {
        const db = seedDb();
        const { app } = makeApp({ db });
        await importGrades(app).expect(200);
        await draft(app, 'u-alice', 9, 'Nice work').expect(200);

        // Canvas now reports a different score for the same student.
        const world = canvasWorld();
        world.courses[CHEM123].submissions[LAB1][0].score = 5;
        world.courses[CHEM123].submissions[LAB1][0].grade = '5';
        const second = makeApp({ db, world });
        const res = await importGrades(second.app).expect(200);

        const alice = res.body.data.records.find((row) => row.appUserId === 'u-alice');
        expect(alice.draftScore).toBe(9);
        expect(alice.draftComment).toBe('Nice work');
        // The Canvas value is kept alongside, and the disagreement is flagged
        // rather than resolved silently.
        expect(alice.canvasScore).toBe(5);
        expect(alice.draftConflict).toBe(true);
        expect(res.body.data.preservedDrafts).toEqual([
            expect.objectContaining({ appUserId: 'u-alice', draftScore: 9, canvasScore: 5 })
        ]);
    });

    test('5. an appOnly student blocks the export by default', async () => {
        const db = seedDb();
        const { app } = makeApp({ db });
        await importGrades(app).expect(200);
        await draft(app, 'u-alice', 9).expect(200);
        await draft(app, 'u-bob', 7).expect(200);
        // Carol is not on the CHEM123 roster but has a local draft.
        await draft(app, 'u-carol', 6).expect(200);

        const res = await request(app)
            .post('/grade-exports/preview')
            .send({ courseIntegrationId: INTEGRATION_ID, gradeItemId: LAB1 })
            .expect(200);

        expect(res.body.data.blocked).toBe(true);
        expect(res.body.data.blockedReason).toBe('partial-export');
        expect(res.body.data.preparedOperationId).toBeNull();
        expect(res.body.data.unresolved).toEqual([
            expect.objectContaining({ displayName: 'Carol Diaz', reason: 'no-roster-match' })
        ]);
        expect(res.body.data.matchedCount).toBe(2);
    });

    test('14. the automatic posting policy is surfaced before confirmation', async () => {
        const db = seedDb();
        const { app } = makeApp({ db });
        await importGrades(app).expect(200);
        await draft(app, 'u-alice', 9, 'See comments').expect(200);

        const res = await request(app)
            .post('/grade-exports/preview')
            .send({ courseIntegrationId: INTEGRATION_ID, gradeItemId: LAB1, recordIds: null })
            .expect(200);

        const data = res.body.data;
        expect(data.blocked).toBe(false);
        expect(data.postManually).toBe(false);
        expect(data.visibilityWarning).toMatch(/visible to students immediately/);
        // Everything the instructor needs to judge the write.
        expect(data.canvasCourse).toMatchObject({ id: CHEM123, code: 'CHEM123' });
        expect(data.assignment).toMatchObject({ gradeItemId: LAB1, name: 'Lab 1', maxScore: 10, gradingType: 'points' });
        expect(data.matchedCount).toBe(1);
        expect(data.preparedOperationId).toEqual(expect.any(String));
    });

    test('14b. a manual posting policy is surfaced too', async () => {
        const world = canvasWorld();
        world.courses[CHEM123].assignments[0].post_manually = true;
        const db = seedDb();
        const { app } = makeApp({ db, world });
        await importGrades(app).expect(200);
        await draft(app, 'u-alice', 9).expect(200);

        const res = await request(app)
            .post('/grade-exports/preview')
            .send({ courseIntegrationId: INTEGRATION_ID, gradeItemId: LAB1 })
            .expect(200);

        expect(res.body.data.postManually).toBe(true);
        expect(res.body.data.visibilityWarning).toMatch(/stay hidden from students/);
    });

    test('12. a preview batch or preflight cannot be modified through the browser', async () => {
        const db = seedDb();
        const { app, client } = makeApp({ db });
        await importGrades(app).expect(200);
        await draft(app, 'u-alice', 9).expect(200);

        const preview = await request(app)
            .post('/grade-exports/preview')
            .send({ courseIntegrationId: INTEGRATION_ID, gradeItemId: LAB1 })
            .expect(200);
        const operationId = preview.body.data.preparedOperationId;

        // The response never carries the batch or the preflight in the first place.
        expect(JSON.stringify(preview.body)).not.toMatch(/"writes"|"preflight"/);

        // A forged batch aimed at another student and a forged preflight are
        // both ignored: the server posts what it stored.
        await request(app)
            .post(`/grade-exports/${operationId}/confirm`)
            .send({
                courseIntegrationId: INTEGRATION_ID,
                batch: {
                    courseId: CHEM123,
                    gradeItemId: LAB1,
                    writes: [{ userId: String(CANVAS_USER.bob), postedGrade: 10 }],
                    unresolved: []
                },
                preflight: { courseId: CHEM123, gradeItemId: LAB1, postManually: true, assignmentName: 'forged' },
                allowPartial: true
            })
            .expect(200);

        expect(client.posted).toHaveLength(1);
        expect(client.posted[0].gradeData).toEqual({
            [String(CANVAS_USER.alice)]: { posted_grade: 9 }
        });
    });

    test('12b. a prepared operation is single-use and instructor-bound', async () => {
        const db = seedDb();
        const { app } = makeApp({ db });
        await importGrades(app).expect(200);
        await draft(app, 'u-alice', 9).expect(200);

        const preview = await request(app)
            .post('/grade-exports/preview')
            .send({ courseIntegrationId: INTEGRATION_ID, gradeItemId: LAB1 })
            .expect(200);
        const operationId = preview.body.data.preparedOperationId;

        await request(app)
            .post(`/grade-exports/${operationId}/confirm`)
            .send({ courseIntegrationId: INTEGRATION_ID })
            .expect(200);

        const replay = await request(app)
            .post(`/grade-exports/${operationId}/confirm`)
            .send({ courseIntegrationId: INTEGRATION_ID })
            .expect(409);
        expect(replay.body.code).toBe('prepared-operation-already-used');
    });

    test('12c. a draft edited after the preview invalidates it', async () => {
        const db = seedDb();
        const { app } = makeApp({ db });
        await importGrades(app).expect(200);
        await draft(app, 'u-alice', 9).expect(200);

        const preview = await request(app)
            .post('/grade-exports/preview')
            .send({ courseIntegrationId: INTEGRATION_ID, gradeItemId: LAB1 })
            .expect(200);

        await draft(app, 'u-alice', 3).expect(200);

        const res = await request(app)
            .post(`/grade-exports/${preview.body.data.preparedOperationId}/confirm`)
            .send({ courseIntegrationId: INTEGRATION_ID })
            .expect(409);
        expect(res.body.code).toBe('records-changed');
    });

    test('13. changed assignment settings produce preflight-stale', async () => {
        const db = seedDb();
        const world = canvasWorld();
        const { app } = makeApp({ db, world });
        await importGrades(app).expect(200);
        await draft(app, 'u-alice', 9).expect(200);

        const preview = await request(app)
            .post('/grade-exports/preview')
            .send({ courseIntegrationId: INTEGRATION_ID, gradeItemId: LAB1 })
            .expect(200);

        // The instructor changes the posting policy in Canvas while reviewing.
        world.courses[CHEM123].assignments[0].post_manually = true;

        const res = await request(app)
            .post(`/grade-exports/${preview.body.data.preparedOperationId}/confirm`)
            .send({ courseIntegrationId: INTEGRATION_ID })
            .expect(409);

        expect(res.body.code).toBe('preflight-stale');
        expect(res.body.message).toBe('Canvas assignment settings changed; review the export again.');
    });

    test('15. a failed Canvas Progress result is reported and not stored as success', async () => {
        const db = seedDb();
        const world = canvasWorld({
            progress: [{ id: 'prog-9', workflow_state: 'failed', message: 'Could not grade 1 student' }]
        });
        const { app } = makeApp({ db, world });
        await importGrades(app).expect(200);
        await draft(app, 'u-alice', 9).expect(200);

        const preview = await request(app)
            .post('/grade-exports/preview')
            .send({ courseIntegrationId: INTEGRATION_ID, gradeItemId: LAB1 })
            .expect(200);

        const res = await request(app)
            .post(`/grade-exports/${preview.body.data.preparedOperationId}/confirm`)
            .send({ courseIntegrationId: INTEGRATION_ID })
            .expect(200);

        expect(res.body.success).toBe(false);
        expect(res.body.data.workflowState).toBe('failed');
        expect(res.body.data.message).toBe('Could not grade 1 student');

        const stored = await db.collection('canvas_grade_records').findOne({ appUserId: 'u-alice' });
        expect(stored.syncStatus).toBe('failed');
        expect(stored.lastExportedAt).toBeNull();
    });

    test('a queued job is not reported as success until Progress completes', async () => {
        const db = seedDb();
        const world = canvasWorld({
            progress: [
                { id: 'prog-3', workflow_state: 'queued' },
                { id: 'prog-3', workflow_state: 'completed', completion: 100 }
            ]
        });
        const { app } = makeApp({ db, world });
        await importGrades(app).expect(200);
        await draft(app, 'u-alice', 9).expect(200);

        const preview = await request(app)
            .post('/grade-exports/preview')
            .send({ courseIntegrationId: INTEGRATION_ID, gradeItemId: LAB1 })
            .expect(200);
        const res = await request(app)
            .post(`/grade-exports/${preview.body.data.preparedOperationId}/confirm`)
            .send({ courseIntegrationId: INTEGRATION_ID })
            .expect(200);

        expect(res.body.data.workflowState).toBe('completed');
        const stored = await db.collection('canvas_grade_records').findOne({ appUserId: 'u-alice' });
        expect(stored.syncStatus).toBe('exported');
    }, 15000);

    test('browser-supplied record ids cannot reach another assignment\'s rows', async () => {
        const db = seedDb();
        const { app, client } = makeApp({ db });

        // A draft on Lab 2 that must not be exportable through a Lab 1 export.
        await request(app)
            .post('/grades/import')
            .send({ courseIntegrationId: INTEGRATION_ID, gradeItemId: LAB2 })
            .expect(200);
        await request(app)
            .put('/grades/draft')
            .send({ courseIntegrationId: INTEGRATION_ID, gradeItemId: LAB2, appUserId: 'u-alice', draftScore: 20 })
            .expect(200);
        const lab2Row = await db.collection('canvas_grade_records')
            .findOne({ gradeItemId: LAB2, appUserId: 'u-alice' });

        await importGrades(app).expect(200);
        await draft(app, 'u-bob', 7).expect(200);

        const res = await request(app)
            .post('/grade-exports/preview')
            .send({
                courseIntegrationId: INTEGRATION_ID,
                gradeItemId: LAB1,
                recordIds: [lab2Row.recordId]
            })
            .expect(400);

        // The id names a real row, but not one in this assignment's scope.
        expect(res.body.code).toBe('empty-batch');
        expect(client.posted).toHaveLength(0);
    });

    test('an anonymously graded assignment is refused as unsupported-grading', async () => {
        const world = canvasWorld();
        world.courses[CHEM123].assignments[0].anonymous_grading = true;
        const db = seedDb();
        const { app, client } = makeApp({ db, world });
        await importGrades(app).expect(200);
        await draft(app, 'u-alice', 9).expect(200);

        const res = await request(app)
            .post('/grade-exports/preview')
            .send({ courseIntegrationId: INTEGRATION_ID, gradeItemId: LAB1 })
            .expect(400);

        expect(res.body.code).toBe('unsupported-grading');
        expect(client.posted).toHaveLength(0);
    });

    test('an expired prepared operation cannot be confirmed', async () => {
        const db = seedDb();
        const { app, client } = makeApp({ db });
        await importGrades(app).expect(200);
        await draft(app, 'u-alice', 9).expect(200);

        const preview = await request(app)
            .post('/grade-exports/preview')
            .send({ courseIntegrationId: INTEGRATION_ID, gradeItemId: LAB1 })
            .expect(200);
        const operationId = preview.body.data.preparedOperationId;

        await db.collection('canvas_grade_export_operations').updateOne(
            { operationId },
            { $set: { expiresAt: new Date(Date.now() - 1000) } }
        );

        const res = await request(app)
            .post(`/grade-exports/${operationId}/confirm`)
            .send({ courseIntegrationId: INTEGRATION_ID })
            .expect(409);
        expect(res.body.code).toBe('prepared-operation-expired');
        expect(client.posted).toHaveLength(0);
    });

    test('a prepared operation is bound to the session that made it', async () => {
        const db = seedDb();
        const { app } = makeApp({ db, sessionID: 'sess-1' });
        await importGrades(app).expect(200);
        await draft(app, 'u-alice', 9).expect(200);

        const preview = await request(app)
            .post('/grade-exports/preview')
            .send({ courseIntegrationId: INTEGRATION_ID, gradeItemId: LAB1 })
            .expect(200);

        const other = makeApp({ db, sessionID: 'sess-2' });
        const res = await request(other.app)
            .post(`/grade-exports/${preview.body.data.preparedOperationId}/confirm`)
            .send({ courseIntegrationId: INTEGRATION_ID })
            .expect(409);

        expect(res.body.code).toBe('prepared-operation-wrong-session');
        expect(other.client.posted).toHaveLength(0);
    });

    test('a draft score above a points assignment maximum is refused', async () => {
        const db = seedDb();
        const { app } = makeApp({ db });
        await importGrades(app).expect(200);

        const res = await draft(app, 'u-alice', 25).expect(400);
        expect(res.body.code).toBe('invalid-grade');
        expect(res.body.message).toMatch(/exceed the assignment maximum of 10/);
    });
});

describe('Acceptance scenario — CHEM123', () => {
    test('Alice and Bob export; Carol is unresolved and blocks by default', async () => {
        const db = seedDb();
        const { app, client } = makeApp({ db });

        // 1. Import grades and submissions from the linked course only.
        const grades = await importGrades(app).expect(200);
        expect(grades.body.data.records.map((row) => row.appUserId).sort()).toEqual(['u-alice', 'u-bob']);
        await request(app)
            .post('/submissions/import')
            .send({ courseIntegrationId: INTEGRATION_ID, gradeItemId: LAB1 })
            .expect(200);

        // Carol is reported as not enrolled, not as missing a submission.
        const carol = grades.body.data.roster.appOnly.find((entry) => entry.appUserId === 'u-carol');
        expect(carol.reason).toBe('not-enrolled');

        // 2. Drafts for all three, including the unmatched Carol.
        for (const [appUserId, score] of [['u-alice', 9], ['u-bob', 7], ['u-carol', 6]]) {
            await request(app)
                .put('/grades/draft')
                .send({ courseIntegrationId: INTEGRATION_ID, gradeItemId: LAB1, appUserId, draftScore: score })
                .expect(200);
        }

        // 3. The default preview refuses and shows Carol.
        const blocked = await request(app)
            .post('/grade-exports/preview')
            .send({ courseIntegrationId: INTEGRATION_ID, gradeItemId: LAB1 })
            .expect(200);
        expect(blocked.body.data.blocked).toBe(true);
        expect(blocked.body.data.canAcknowledgePartial).toBe(true);
        expect(client.posted).toHaveLength(0);

        // 4. A deliberate partial acknowledgement regenerates the operation.
        const preview = await request(app)
            .post('/grade-exports/preview')
            .send({ courseIntegrationId: INTEGRATION_ID, gradeItemId: LAB1, allowPartial: true })
            .expect(200);
        expect(preview.body.data.blocked).toBe(false);
        expect(preview.body.data.matchedCount).toBe(2);

        const confirmed = await request(app)
            .post(`/grade-exports/${preview.body.data.preparedOperationId}/confirm`)
            .send({ courseIntegrationId: INTEGRATION_ID })
            .expect(200);
        expect(confirmed.body.success).toBe(true);

        // 5. Only Alice and Bob were written, to CHEM123's Lab 1 and nowhere else.
        expect(client.posted).toHaveLength(1);
        expect(client.posted[0]).toMatchObject({ courseId: CHEM123, assignmentId: LAB1 });
        expect(client.posted[0].gradeData).toEqual({
            [String(CANVAS_USER.alice)]: { posted_grade: 9 },
            [String(CANVAS_USER.bob)]: { posted_grade: 7 }
        });
        expect(client.pathsTouching(BIOL200)).toEqual([]);
        expect(client.pathsTouching(PHYS101)).toEqual([]);

        // Carol keeps her draft, marked unexported with the reason she was skipped.
        const carolRow = await db.collection('canvas_grade_records').findOne({ appUserId: 'u-carol' });
        expect(carolRow.draftScore).toBe(6);
        expect(carolRow.syncStatus).toBe('draft');
        expect(carolRow.syncError).toMatch(/not matched on the linked Canvas course roster/);
        expect(carolRow.lastExportedAt).toBeNull();
    });
});
