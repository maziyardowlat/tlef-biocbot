// @ts-check
/**
 * Ownership / role / state-mismatch coverage for src/routes/questions.js.
 *
 * Branch enumeration vs. existing specs:
 *
 *   - routes-questions-api.spec.js already covers (a) POST cross-instructor
 *     mutation [FINDINGS #23] and (b) GET /:questionId cross-course leak
 *     [FINDINGS #24]. It does NOT cover the same ownership gap on PUT, DELETE,
 *     /bulk, or /auto-link-learning-objectives — the route file has zero
 *     callers of any access-control helper for those endpoints, so every verb
 *     should be exercised.
 *   - questions-api-coverage.spec.js exercises the *happy* model-mutation
 *     paths and a few model-failure 400s. It does NOT exercise role-based
 *     denial (a logged-in student calling instructor-only mutations) nor
 *     cross-course information leaks on GET /lecture.
 *   - questions-api-error-branches.spec.js focuses on per-field validation.
 *     It includes an anonymous generate-ai test but nothing for student-role
 *     callers, TA role callers without permission, or cross-instructor
 *     mutations on the non-generate-ai verbs.
 *
 * Branches targeted here (each labelled inline):
 *   1. Student authenticated → instructor-only mutations on POST/PUT/DELETE/
 *      bulk/auto-link should be 401/403. Currently 200 (NEW FINDING #34).
 *   2. Authenticated instructor → mutations on another instructor's course:
 *      PUT, DELETE, /bulk, /auto-link. Same root cause as FINDINGS #23 but
 *      previously only documented for POST.
 *   3. Authenticated user → GET /lecture for a course they don't own/enroll
 *      in. Currently 200 (information leak — NEW FINDING #34 / generalized
 *      #24).
 *   4. State-mismatch reachable branches:
 *      - DELETE on existing course/lecture but non-existent questionId →
 *        success path with deletedCount=0. Pure coverage win (no bug).
 *      - PUT on existing course/lecture but non-existent questionId →
 *        the model treats this as an UPSERT and silently CREATES a new
 *        question with the supplied id. Surprising and arguably a bug
 *        (NEW FINDING #35: "PUT on unknown questionId silently creates").
 *      - auto-link DB-write loop `continue` branch when every DB question
 *        already has a learningObjective (preserveExisting=true keeps them →
 *        `originalObjective` truthy on every iteration → no DB updates).
 *
 * Constraints (tests/e2e/AGENTS.md):
 *   - No production-code changes.
 *   - Bug-exposing assertions are written for the EXPECTED behavior and are
 *     allowed to fail; they are documented in FINDINGS.md (#34, #35 added).
 *   - HTTP-only — no internal mocks. Uses real Mongo via courses-test helpers.
 */

const { test, expect } = require('./fixtures/monocart');
const { TEST_USERS, storageStatePath } = require('./helpers/users');
const {
    withDb,
    getUserIdByUsername,
    seedCourse,
    cleanupCourses,
    cleanupCoursesForUser,
} = require('./helpers/courses-test');

const COURSE_OWNER = 'BIOC-E2E-QOWN-A';   // owned by e2e_instructor
const COURSE_OTHER = 'BIOC-E2E-QOWN-B';   // owned by e2e_instructor_fresh

let instructorId;
let instructorFreshId;
let studentId;

test.beforeAll(async () => {
    instructorId = await getUserIdByUsername(TEST_USERS.instructor.username);
    instructorFreshId = await getUserIdByUsername(TEST_USERS.instructor_fresh.username);
    studentId = await getUserIdByUsername(TEST_USERS.student.username);
});

test.beforeEach(async () => {
    await cleanupCoursesForUser(instructorId);
    await cleanupCoursesForUser(instructorFreshId);
});

test.afterAll(async () => {
    await cleanupCourses([COURSE_OWNER, COURSE_OTHER]);
    await cleanupCoursesForUser(instructorId);
    await cleanupCoursesForUser(instructorFreshId);
});

/**
 * Seed a course owned by `ownerId` with one published lecture containing a
 * single assessment question (for ownership tests that PUT/DELETE that q).
 */
async function seedOwnedCourse({ courseId, ownerId, questionId = 'q_owner_seed' }) {
    const now = new Date();
    await seedCourse({
        courseId,
        instructorId: ownerId,
        lectures: [{
            name: 'Unit 1',
            displayName: 'Unit 1',
            isPublished: true,
            learningObjectives: [],
            passThreshold: 2,
            createdAt: now,
            updatedAt: now,
            documents: [],
            assessmentQuestions: [
                {
                    questionId,
                    questionType: 'true-false',
                    question: 'Owned question text',
                    correctAnswer: 'true',
                    isActive: true,
                    points: 1,
                    learningObjective: '',
                    createdAt: now,
                    updatedAt: now,
                },
            ],
        }],
    });
}

// ---------------------------------------------------------------------------
// Section 1 — Student role calling instructor-only mutations.
//
// /api/questions has only authentication + `requireActiveCourseForNonInstructors`
// in front of it (see src/server.js:497). There is NO role gate, so a student
// who is logged in can POST/PUT/DELETE/bulk/auto-link any active course's
// questions — including a course they aren't enrolled in. This documents
// FINDING #34 ("question-routes have no role gate").
// ---------------------------------------------------------------------------
test.describe('Student-role caller cannot mutate questions (FINDING #34)', () => {
    test.use({ storageState: storageStatePath('student') });

    test.beforeEach(async () => {
        await seedOwnedCourse({ courseId: COURSE_OWNER, ownerId: instructorId });
    });

    test('PRODUCT BUG: student can POST a new question to an instructor\'s course', async ({ request: api }) => {
        const res = await api.post('/api/questions', {
            data: {
                courseId: COURSE_OWNER,
                lectureName: 'Unit 1',
                instructorId,           // route ignores who the caller is
                questionType: 'true-false',
                question: 'Injected by a student',
                correctAnswer: 'true',
            },
            failOnStatusCode: false,
        });
        // EXPECTED: 401/403 — students must not mutate course content.
        expect([401, 403]).toContain(res.status());
    });

    test('PRODUCT BUG: student can PUT an existing question on an instructor\'s course', async ({ request: api }) => {
        const res = await api.put('/api/questions/q_owner_seed', {
            data: {
                courseId: COURSE_OWNER,
                lectureName: 'Unit 1',
                instructorId,
                question: 'Vandalized by a student',
            },
            failOnStatusCode: false,
        });
        expect([401, 403]).toContain(res.status());
    });

    test('PRODUCT BUG: student can DELETE a question on an instructor\'s course', async ({ request: api }) => {
        const res = await api.delete('/api/questions/q_owner_seed', {
            data: { courseId: COURSE_OWNER, lectureName: 'Unit 1', instructorId },
            failOnStatusCode: false,
        });
        expect([401, 403]).toContain(res.status());
    });

    test('PRODUCT BUG: student can bulk-insert questions into an instructor\'s course', async ({ request: api }) => {
        const res = await api.post('/api/questions/bulk', {
            data: {
                courseId: COURSE_OWNER,
                lectureName: 'Unit 1',
                instructorId,
                questions: [
                    { questionType: 'true-false', question: 'Student bulk', correctAnswer: 'true', learningObjective: '' },
                ],
            },
            failOnStatusCode: false,
        });
        expect([401, 403]).toContain(res.status());
    });

    test('PRODUCT BUG: student can run auto-link-learning-objectives on an instructor\'s course', async ({ request: api }) => {
        const res = await api.post('/api/questions/auto-link-learning-objectives', {
            data: {
                courseId: COURSE_OWNER,
                lectureName: 'Unit 1',
                instructorId,
                learningObjectives: [],
                questions: [{ ref: 'q1', question: 'student-driven', learningObjective: '' }],
            },
            failOnStatusCode: false,
        });
        expect([401, 403]).toContain(res.status());
    });
});

// ---------------------------------------------------------------------------
// Section 2 — Cross-instructor mutations (FINDINGS #23 generalization).
//
// Logged-in instructor A mutates course content owned by instructor B. The
// route trusts body `instructorId` and never compares it (or req.user) against
// the course's owner / instructors[] / tas[]. Existing spec covers POST; here
// we extend to PUT, DELETE, /bulk, and /auto-link-learning-objectives.
// ---------------------------------------------------------------------------
test.describe('Cross-instructor mutations on another instructor\'s course (FINDING #23 generalized)', () => {
    test.use({ storageState: storageStatePath('instructor') });

    test.beforeEach(async () => {
        // COURSE_OTHER is owned by e2e_instructor_fresh. Caller is
        // e2e_instructor — should have no access.
        await seedOwnedCourse({ courseId: COURSE_OTHER, ownerId: instructorFreshId });
    });

    test('PRODUCT BUG: PUT another instructor\'s question succeeds with no access check', async ({ request: api }) => {
        const res = await api.put('/api/questions/q_owner_seed', {
            data: {
                courseId: COURSE_OTHER,
                lectureName: 'Unit 1',
                instructorId: instructorFreshId, // body identity != caller
                question: 'cross-instructor edit',
                points: 99,
            },
            failOnStatusCode: false,
        });
        // EXPECTED: 401/403. Currently 200.
        expect([401, 403]).toContain(res.status());

        // If the bug allowed the write through, confirm the data was actually
        // mutated — this is what makes the gap impactful rather than cosmetic.
        if (res.ok()) {
            const doc = await withDb((db) =>
                db.collection('courses').findOne({ courseId: COURSE_OTHER })
            );
            const q = doc.lectures[0].assessmentQuestions.find((x) => x.questionId === 'q_owner_seed');
            // We expect the cross-instructor edit to NOT have landed.
            expect(q.question).toBe('Owned question text');
        }
    });

    test('PRODUCT BUG: DELETE another instructor\'s question succeeds with no access check', async ({ request: api }) => {
        const res = await api.delete('/api/questions/q_owner_seed', {
            data: {
                courseId: COURSE_OTHER,
                lectureName: 'Unit 1',
                instructorId: instructorFreshId,
            },
            failOnStatusCode: false,
        });
        expect([401, 403]).toContain(res.status());
    });

    test('PRODUCT BUG: bulk-insert into another instructor\'s course succeeds', async ({ request: api }) => {
        const res = await api.post('/api/questions/bulk', {
            data: {
                courseId: COURSE_OTHER,
                lectureName: 'Unit 1',
                instructorId: instructorFreshId,
                questions: [
                    { questionType: 'true-false', question: 'cross-instructor bulk', correctAnswer: 'true', learningObjective: '' },
                ],
            },
            failOnStatusCode: false,
        });
        expect([401, 403]).toContain(res.status());
    });

    test('PRODUCT BUG: auto-link-learning-objectives on another instructor\'s course succeeds', async ({ request: api }) => {
        const res = await api.post('/api/questions/auto-link-learning-objectives', {
            data: {
                courseId: COURSE_OTHER,
                lectureName: 'Unit 1',
                instructorId: instructorFreshId,
                learningObjectives: [],
                questions: [{ ref: 'q1', question: 'cross-link', learningObjective: '' }],
            },
            failOnStatusCode: false,
        });
        expect([401, 403]).toContain(res.status());
    });
});

// ---------------------------------------------------------------------------
// Section 3 — GET /api/questions/lecture information leak.
//
// Existing /:questionId leak is captured in FINDINGS #24, but /lecture is
// equally permissive: any authenticated caller can list the questions of any
// active course, including units that haven't been published. NEW FINDING #34.
// ---------------------------------------------------------------------------
test.describe('GET /api/questions/lecture cross-course information leak (FINDING #34)', () => {
    test('PRODUCT BUG: instructor A can list instructor B\'s course questions', async ({ baseURL, browser }) => {
        await seedOwnedCourse({ courseId: COURSE_OTHER, ownerId: instructorFreshId });
        const ctx = await browser.newContext({ storageState: storageStatePath('instructor') });
        try {
            const api = ctx.request;
            const res = await api.get(
                `/api/questions/lecture?courseId=${COURSE_OTHER}&lectureName=${encodeURIComponent('Unit 1')}`,
                { failOnStatusCode: false }
            );
            // EXPECTED: 401/403/404. Currently 200 and returns the questions.
            expect([401, 403, 404]).toContain(res.status());
        } finally {
            await ctx.close();
        }
    });

    test('PRODUCT BUG: a student not enrolled in the course can still list its questions', async ({ baseURL, browser }) => {
        await seedOwnedCourse({ courseId: COURSE_OWNER, ownerId: instructorId });
        const ctx = await browser.newContext({ storageState: storageStatePath('student') });
        try {
            const api = ctx.request;
            const res = await api.get(
                `/api/questions/lecture?courseId=${COURSE_OWNER}&lectureName=${encodeURIComponent('Unit 1')}`,
                { failOnStatusCode: false }
            );
            // EXPECTED: 401/403 — student isn't enrolled in COURSE_OWNER.
            expect([401, 403]).toContain(res.status());
        } finally {
            await ctx.close();
        }
    });
});

// ---------------------------------------------------------------------------
// Section 4 — State-mismatch branches the existing specs miss.
//
// These are "coverage win" branches that the route file does reach in normal
// operation; they aren't expressly tested elsewhere.
// ---------------------------------------------------------------------------
test.describe('State-mismatch branches in PUT / DELETE / auto-link', () => {
    test.use({ storageState: storageStatePath('instructor') });

    test.beforeEach(async () => {
        await seedOwnedCourse({ courseId: COURSE_OWNER, ownerId: instructorId });
    });

    test('DELETE on existing course/lecture but unknown questionId → success with deletedCount=0', async ({ request: api }) => {
        // Hits the success-branch on L624-631 in questions.js where the model
        // returns `{ success:true, deletedCount:0 }` (the `$pull` simply didn't
        // match). Distinct from the existing "course not found" 400 test.
        const res = await api.delete('/api/questions/q_never_existed_owner', {
            data: { courseId: COURSE_OWNER, lectureName: 'Unit 1', instructorId },
        });
        expect(res.ok()).toBeTruthy();
        const body = await res.json();
        expect(body.success).toBe(true);
        expect(body.data.deletedCount).toBe(0);
    });

    test('PRODUCT BUG (FINDING #35): PUT on an unknown questionId silently creates a new question', async ({ request: api }) => {
        // The model's updateAssessmentQuestions() treats a missing questionId
        // as "append new question with this id" (Course.js:561-582). The route
        // exposes this as 200 success even though the caller asked to UPDATE
        // a question that didn't exist. EXPECTED: 404 (question not found).
        const res = await api.put('/api/questions/q_does_not_exist_anywhere', {
            data: {
                courseId: COURSE_OWNER,
                lectureName: 'Unit 1',
                instructorId,
                question: 'PUT should not create',
                points: 42,
            },
            failOnStatusCode: false,
        });
        // EXPECTED: 404 — caller wanted to update a non-existent resource.
        expect(res.status()).toBe(404);

        // If the bug allows it through, confirm what landed in the DB so the
        // failing assertion makes the impact concrete.
        if (res.ok()) {
            const doc = await withDb((db) =>
                db.collection('courses').findOne({ courseId: COURSE_OWNER })
            );
            const inserted = doc.lectures[0].assessmentQuestions.find(
                (x) => x.questionId === 'q_does_not_exist_anywhere'
            );
            // A future regression test will catch this: the silent insert
            // should NOT exist after a PUT to an unknown id.
            expect(inserted).toBeUndefined();
        }
    });

    test('auto-link DB-write loop: every existing DB question already has a LO → no updates issued', async ({ request: api }) => {
        // Exercises the `originalObjective` truthy branch of the `continue`
        // gate on questions.js:404-406. Real LLM call still happens for the
        // matching pass, but every iteration of the DB-write loop should
        // short-circuit, so updatedCount stays 0.
        test.setTimeout(180_000);
        const now = new Date();
        await seedCourse({
            courseId: COURSE_OWNER,
            instructorId,
            lectures: [{
                name: 'Unit 1',
                displayName: 'Unit 1',
                isPublished: true,
                learningObjectives: ['Understand DNA structure', 'Compare DNA and RNA'],
                passThreshold: 2,
                createdAt: now,
                updatedAt: now,
                documents: [],
                assessmentQuestions: [
                    {
                        questionId: 'q_already_linked_1',
                        questionType: 'short-answer',
                        question: 'What stores genes?',
                        correctAnswer: 'DNA',
                        isActive: true,
                        learningObjective: 'Understand DNA structure',
                        points: 1,
                        createdAt: now,
                        updatedAt: now,
                    },
                    {
                        questionId: 'q_already_linked_2',
                        questionType: 'short-answer',
                        question: 'What is the sugar in RNA?',
                        correctAnswer: 'ribose',
                        isActive: true,
                        learningObjective: 'Compare DNA and RNA',
                        points: 1,
                        createdAt: now,
                        updatedAt: now,
                    },
                ],
            }],
        });
        const res = await api.post('/api/questions/auto-link-learning-objectives', {
            data: {
                courseId: COURSE_OWNER,
                lectureName: 'Unit 1',
                instructorId,
                learningObjectives: ['Understand DNA structure', 'Compare DNA and RNA'],
            },
        });
        expect(res.ok()).toBeTruthy();
        const body = await res.json();
        expect(body.data.updatedCount).toBe(0);
        // Every DB question already had a LO, so linkedCount surfaces them all
        // (the response counts preserved + freshly-linked alike).
        expect(body.data.linkedCount).toBe(2);
    });
});

// ---------------------------------------------------------------------------
// Section 5 — GET /:questionId after a DELETE removes the question.
//
// Drives the "course matched the nested array, but the inner Array.find()
// missed" defensive branch on questions.js:494-499. That branch is reachable
// when a question is deleted but the global `findOne` still matched some
// other lecture in the same course on the same id (rare). We simulate the
// simpler version: seed a question, delete it, then re-fetch by id → 404.
// ---------------------------------------------------------------------------
test.describe('GET /:questionId after delete-by-id', () => {
    test.use({ storageState: storageStatePath('instructor') });

    test('404 after the question is removed from its lecture', async ({ request: api }) => {
        await seedOwnedCourse({ courseId: COURSE_OWNER, ownerId: instructorId, questionId: 'q_to_delete' });
        const del = await api.delete('/api/questions/q_to_delete', {
            data: { courseId: COURSE_OWNER, lectureName: 'Unit 1', instructorId },
        });
        expect(del.ok()).toBeTruthy();

        const res = await api.get('/api/questions/q_to_delete', { failOnStatusCode: false });
        // Outer findOne won't match any course (the $pull removed the only
        // occurrence), so the first 404 branch fires.
        expect(res.status()).toBe(404);
    });
});
