// @ts-check
/**
 * Quiz API tests — covers the /api/quiz/* routes directly via Playwright's
 * request fixture. UI rendering is exercised by student-quiz.spec.js; this
 * suite is for shape, status codes, persistence, and the LLM-backed paths.
 */

const { test, expect, request } = require('@playwright/test');
const { TEST_USERS, storageStatePath } = require('./helpers/users');
const {
    QUIZ_COURSE_ID,
    QUESTION_IDS,
    DOC_ID,
    withDb,
    getUserIdByUsername,
    resetQuizCourse,
    cleanupQuizCourse,
} = require('./helpers/quiz');

let instructorId;
let studentId;

test.beforeAll(async () => {
    instructorId = await getUserIdByUsername(TEST_USERS.instructor.username);
    studentId = await getUserIdByUsername(TEST_USERS.student.username);
});

test.afterAll(async () => {
    await cleanupQuizCourse();
});

// ----------------------------------------------------------------------------
// /api/quiz/status
// ----------------------------------------------------------------------------
test.describe('GET /api/quiz/status', () => {
    test.use({ storageState: storageStatePath('student') });

    test('returns enabled:true when quiz is enabled', async ({ request: api }) => {
        await resetQuizCourse({ instructorId, quizSettings: { enabled: true } });

        const res = await api.get(`/api/quiz/status?courseId=${QUIZ_COURSE_ID}`);
        expect(res.ok()).toBeTruthy();
        const body = await res.json();
        expect(body).toMatchObject({ success: true, enabled: true });
    });

    test('returns enabled:false when quiz is disabled', async ({ request: api }) => {
        await resetQuizCourse({ instructorId, quizSettings: { enabled: false } });

        const res = await api.get(`/api/quiz/status?courseId=${QUIZ_COURSE_ID}`);
        expect(res.ok()).toBeTruthy();
        const body = await res.json();
        expect(body).toMatchObject({ success: true, enabled: false });
    });

    test('returns 400 when courseId is missing', async ({ request: api }) => {
        const res = await api.get('/api/quiz/status');
        expect(res.status()).toBe(400);
    });
});

// ----------------------------------------------------------------------------
// /api/quiz/questions
// ----------------------------------------------------------------------------
test.describe('GET /api/quiz/questions', () => {
    test.use({ storageState: storageStatePath('student') });

    test('returns 403 when quiz is disabled', async ({ request: api }) => {
        await resetQuizCourse({ instructorId, quizSettings: { enabled: false } });

        const res = await api.get(`/api/quiz/questions?courseId=${QUIZ_COURSE_ID}`);
        expect(res.status()).toBe(403);
    });

    test('returns questions for published units only and never leaks correctAnswer', async ({ request: api }) => {
        await resetQuizCourse({ instructorId, quizSettings: { enabled: true } });

        const res = await api.get(`/api/quiz/questions?courseId=${QUIZ_COURSE_ID}`);
        expect(res.ok()).toBeTruthy();
        const body = await res.json();

        expect(body.success).toBe(true);
        expect(body.allowLectureMaterialAccess).toBe(true);

        // Three published questions (Unit 1) — Unit 2 is unpublished
        expect(body.questions).toHaveLength(3);
        const ids = body.questions.map((q) => q.questionId).sort();
        expect(ids).toEqual([QUESTION_IDS.mc, QUESTION_IDS.sa, QUESTION_IDS.tf].sort());

        // No published question is from Unit 2
        for (const q of body.questions) {
            expect(q.lectureName).toBe('Unit 1');
            // The correctAnswer must never be exposed to the client
            expect(q).not.toHaveProperty('correctAnswer');
        }

        // The unpublished unit's question id must NOT appear
        expect(ids).not.toContain(QUESTION_IDS.unpublished);

        // Units list reflects published, testable units only
        expect(body.units.map((u) => u.name)).toEqual(['Unit 1']);
    });

    test('honors testableUnits filter when restricted', async ({ request: api }) => {
        // Seed with two published units, then restrict testableUnits to ['Unit 1']
        await resetQuizCourse({
            instructorId,
            quizSettings: { enabled: true, testableUnits: ['Unit 1'] },
        });
        // Make Unit 2 published too, so the testableUnits filter has work to do
        await withDb((db) =>
            db.collection('courses').updateOne(
                { courseId: QUIZ_COURSE_ID, 'lectures.name': 'Unit 2' },
                { $set: { 'lectures.$.isPublished': true } }
            )
        );

        const res = await api.get(`/api/quiz/questions?courseId=${QUIZ_COURSE_ID}`);
        const body = await res.json();
        expect(body.success).toBe(true);
        // Only Unit 1 questions — Unit 2 is published but not testable
        expect(body.questions.every((q) => q.lectureName === 'Unit 1')).toBe(true);
        expect(body.units.map((u) => u.name)).toEqual(['Unit 1']);
    });

    test('returns empty list when no units are published', async ({ request: api }) => {
        await resetQuizCourse({ instructorId, quizSettings: { enabled: true } });
        await withDb((db) =>
            db.collection('courses').updateOne(
                { courseId: QUIZ_COURSE_ID },
                { $set: { 'lectures.$[].isPublished': false } }
            )
        );

        const res = await api.get(`/api/quiz/questions?courseId=${QUIZ_COURSE_ID}`);
        const body = await res.json();
        expect(body).toMatchObject({ success: true, questions: [], units: [] });
    });
});

// ----------------------------------------------------------------------------
// /api/quiz/check-answer
// ----------------------------------------------------------------------------
test.describe('POST /api/quiz/check-answer', () => {
    test.use({ storageState: storageStatePath('student') });

    test.beforeEach(async () => {
        await resetQuizCourse({ instructorId, quizSettings: { enabled: true } });
    });

    test('marks a correct MC answer as correct', async ({ request: api }) => {
        const res = await api.post('/api/quiz/check-answer', {
            data: {
                courseId: QUIZ_COURSE_ID,
                questionId: QUESTION_IDS.mc,
                lectureName: 'Unit 1',
                studentAnswer: 'B', // correct
            },
        });
        const body = await res.json();
        expect(body.success).toBe(true);
        expect(body.data.correct).toBe(true);
        expect(body.data.feedback).toMatch(/correct/i);
    });

    test('marks an incorrect MC answer as wrong and reveals the correct answer', async ({ request: api }) => {
        const res = await api.post('/api/quiz/check-answer', {
            data: {
                courseId: QUIZ_COURSE_ID,
                questionId: QUESTION_IDS.mc,
                lectureName: 'Unit 1',
                studentAnswer: 'A', // wrong
            },
        });
        const body = await res.json();
        expect(body.data.correct).toBe(false);
        expect(body.data.correctAnswer).toBe('B');
    });

    test('marks a correct TF answer as correct', async ({ request: api }) => {
        const res = await api.post('/api/quiz/check-answer', {
            data: {
                courseId: QUIZ_COURSE_ID,
                questionId: QUESTION_IDS.tf,
                lectureName: 'Unit 1',
                studentAnswer: 'true',
            },
        });
        const body = await res.json();
        expect(body.data.correct).toBe(true);
    });

    test('marks an incorrect TF answer as wrong', async ({ request: api }) => {
        const res = await api.post('/api/quiz/check-answer', {
            data: {
                courseId: QUIZ_COURSE_ID,
                questionId: QUESTION_IDS.tf,
                lectureName: 'Unit 1',
                studentAnswer: 'false',
            },
        });
        const body = await res.json();
        expect(body.data.correct).toBe(false);
    });

    test('returns 404 for an unknown questionId', async ({ request: api }) => {
        const res = await api.post('/api/quiz/check-answer', {
            data: {
                courseId: QUIZ_COURSE_ID,
                questionId: 'q_does_not_exist',
                lectureName: 'Unit 1',
                studentAnswer: 'B',
            },
        });
        expect(res.status()).toBe(404);
    });

    test('returns 400 when required fields are missing', async ({ request: api }) => {
        const res = await api.post('/api/quiz/check-answer', {
            data: { courseId: QUIZ_COURSE_ID, questionId: QUESTION_IDS.mc },
        });
        expect(res.status()).toBe(400);
    });

    // --- LLM-backed short-answer evaluation ---
    // These call the real LLM service. We do two pairs (clearly correct,
    // clearly wrong) and assert the boolean outcome — the LLM has plenty of
    // signal to differentiate "peptide bond" from "I have no idea".
    test.describe('short-answer (real LLM)', () => {
        test.setTimeout(60_000);

        test('grades a clearly-correct short answer as correct', async ({ request: api }) => {
            const res = await api.post('/api/quiz/check-answer', {
                data: {
                    courseId: QUIZ_COURSE_ID,
                    questionId: QUESTION_IDS.sa,
                    lectureName: 'Unit 1',
                    studentAnswer:
                        'A peptide bond, formed by a condensation reaction between the carboxyl and amino groups of adjacent amino acids.',
                    studentName: 'E2E Student',
                },
            });
            expect(res.ok()).toBeTruthy();
            const body = await res.json();
            expect(body.success).toBe(true);
            expect(body.data).toBeTruthy();
            expect(typeof body.data.correct).toBe('boolean');
            expect(typeof body.data.feedback).toBe('string');
            expect(body.data.feedback.length).toBeGreaterThan(0);
            expect(body.data.correct).toBe(true);
        });

        test('grades a clearly-wrong short answer as incorrect', async ({ request: api }) => {
            const res = await api.post('/api/quiz/check-answer', {
                data: {
                    courseId: QUIZ_COURSE_ID,
                    questionId: QUESTION_IDS.sa,
                    lectureName: 'Unit 1',
                    studentAnswer: 'Banana phone purple seventeen',
                    studentName: 'E2E Student',
                },
            });
            const body = await res.json();
            expect(body.success).toBe(true);
            expect(typeof body.data.correct).toBe('boolean');
            expect(body.data.correct).toBe(false);
        });
    });
});

// ----------------------------------------------------------------------------
// /api/quiz/attempt and /api/quiz/history
// ----------------------------------------------------------------------------
test.describe('POST /api/quiz/attempt + GET /api/quiz/history', () => {
    test.describe('authenticated as student', () => {
        test.use({ storageState: storageStatePath('student') });

        test.beforeEach(async () => {
            await resetQuizCourse({ instructorId, quizSettings: { enabled: true } });
        });

        test('records an attempt and surfaces it in history stats', async ({ request: api }) => {
            // Two attempts: one correct, one wrong
            const a1 = await api.post('/api/quiz/attempt', {
                data: {
                    courseId: QUIZ_COURSE_ID,
                    questionId: QUESTION_IDS.mc,
                    lectureName: 'Unit 1',
                    questionType: 'multiple-choice',
                    studentAnswer: 'B',
                    correct: true,
                    feedback: 'Correct! Well done.',
                },
            });
            expect(a1.ok()).toBeTruthy();
            const a1Body = await a1.json();
            expect(a1Body.success).toBe(true);
            expect(a1Body.attemptId).toMatch(/^qa_/);

            const a2 = await api.post('/api/quiz/attempt', {
                data: {
                    courseId: QUIZ_COURSE_ID,
                    questionId: QUESTION_IDS.tf,
                    lectureName: 'Unit 1',
                    questionType: 'true-false',
                    studentAnswer: 'false',
                    correct: false,
                    feedback: 'Incorrect. The correct answer is true.',
                },
            });
            expect(a2.ok()).toBeTruthy();

            // DB truth — both attempts persisted with the right studentId
            const stored = await withDb((db) =>
                db.collection('quizAttempts').find({ courseId: QUIZ_COURSE_ID }).toArray()
            );
            expect(stored).toHaveLength(2);
            expect(stored.every((a) => a.studentId === studentId)).toBe(true);

            // Stats
            const histRes = await api.get(`/api/quiz/history?courseId=${QUIZ_COURSE_ID}`);
            const hist = await histRes.json();
            expect(hist.success).toBe(true);
            expect(hist.stats.totalAttempts).toBe(2);
            expect(hist.stats.correctCount).toBe(1);
            expect(hist.stats.accuracy).toBe(50);
            expect(hist.stats.unitBreakdown['Unit 1']).toEqual({ total: 2, correct: 1 });
        });

        test('returns 400 when required fields are missing', async ({ request: api }) => {
            const res = await api.post('/api/quiz/attempt', {
                data: { courseId: QUIZ_COURSE_ID, questionId: QUESTION_IDS.mc },
            });
            expect(res.status()).toBe(400);
        });
    });

    test.describe('unauthenticated', () => {
        // Override storage state to an empty (logged-out) context.
        // The requireAuth middleware redirects API calls to /login when the
        // path (post mount) doesn't start with /api/ — so we accept either a
        // 401 JSON response or a 302 redirect as proof the request was
        // rejected. Either way it must NOT reach the route handler.
        test('rejects unauthenticated requests to /attempt and /history', async ({ baseURL }) => {
            const api = await request.newContext({ baseURL });
            try {
                const attemptRes = await api.post('/api/quiz/attempt', {
                    maxRedirects: 0,
                    failOnStatusCode: false,
                    data: {
                        courseId: QUIZ_COURSE_ID,
                        questionId: QUESTION_IDS.mc,
                        lectureName: 'Unit 1',
                        questionType: 'multiple-choice',
                        studentAnswer: 'B',
                        correct: true,
                    },
                });
                expect([302, 401]).toContain(attemptRes.status());

                const histRes = await api.get(
                    `/api/quiz/history?courseId=${QUIZ_COURSE_ID}`,
                    { maxRedirects: 0, failOnStatusCode: false }
                );
                expect([302, 401]).toContain(histRes.status());

                // And no attempt was persisted
                const persisted = await withDb((db) =>
                    db.collection('quizAttempts').countDocuments({ courseId: QUIZ_COURSE_ID })
                );
                expect(persisted).toBe(0);
            } finally {
                await api.dispose();
            }
        });
    });
});

// ----------------------------------------------------------------------------
// /api/quiz/materials and download
// ----------------------------------------------------------------------------
test.describe('Quiz materials', () => {
    test.use({ storageState: storageStatePath('student') });

    test('GET /materials returns 403 when allowLectureMaterialAccess is false', async ({ request: api }) => {
        await resetQuizCourse({
            instructorId,
            quizSettings: { enabled: true, allowLectureMaterialAccess: false },
        });

        const res = await api.get(
            `/api/quiz/materials?courseId=${QUIZ_COURSE_ID}&lectureName=Unit 1`
        );
        expect(res.status()).toBe(403);
    });

    test('GET /materials returns the seeded document when access is allowed', async ({ request: api }) => {
        await resetQuizCourse({
            instructorId,
            quizSettings: { enabled: true, allowLectureMaterialAccess: true },
        });

        const res = await api.get(
            `/api/quiz/materials?courseId=${QUIZ_COURSE_ID}&lectureName=${encodeURIComponent('Unit 1')}`
        );
        expect(res.ok()).toBeTruthy();
        const body = await res.json();
        expect(body.success).toBe(true);
        expect(body.materials).toHaveLength(1);
        expect(body.materials[0]).toMatchObject({
            documentId: DOC_ID,
            originalName: 'Unit 1 Notes.txt',
            mimeType: 'text/plain',
        });
    });

    test('GET /materials/:id/download returns the file content with attachment headers', async ({ request: api }) => {
        await resetQuizCourse({
            instructorId,
            quizSettings: { enabled: true, allowLectureMaterialAccess: true },
        });

        const res = await api.get(
            `/api/quiz/materials/${DOC_ID}/download?courseId=${QUIZ_COURSE_ID}`
        );
        expect(res.ok()).toBeTruthy();
        const disposition = res.headers()['content-disposition'] || '';
        expect(disposition.toLowerCase()).toContain('attachment');
        expect(disposition).toContain('Unit 1 Notes.txt');

        const text = await res.text();
        expect(text).toContain('ATP is the primary energy currency');
    });

    test('GET /materials/:id/download returns 403 when access is disabled', async ({ request: api }) => {
        await resetQuizCourse({
            instructorId,
            quizSettings: { enabled: true, allowLectureMaterialAccess: false },
        });

        const res = await api.get(
            `/api/quiz/materials/${DOC_ID}/download?courseId=${QUIZ_COURSE_ID}`
        );
        expect(res.status()).toBe(403);
    });
});

// ----------------------------------------------------------------------------
// /api/quiz/chat — profanity, safety, and the real-LLM happy path
// ----------------------------------------------------------------------------
test.describe('POST /api/quiz/chat', () => {
    test.use({ storageState: storageStatePath('student') });

    test.beforeEach(async () => {
        await resetQuizCourse({ instructorId, quizSettings: { enabled: true } });
    });

    test('returns 400 when required fields are missing', async ({ request: api }) => {
        const res = await api.post('/api/quiz/chat', {
            data: { courseId: QUIZ_COURSE_ID, lectureName: 'Unit 1' },
        });
        expect(res.status()).toBe(400);
    });

    test('profanity is intercepted with a system response, no LLM call needed', async ({ request: api }) => {
        const res = await api.post('/api/quiz/chat', {
            data: {
                courseId: QUIZ_COURSE_ID,
                lectureName: 'Unit 1',
                questionText: 'Which biomolecule is the primary energy currency of the cell?',
                questionType: 'multiple-choice',
                studentAnswer: 'A',
                message: 'this question is shit, explain it',
            },
        });
        expect(res.ok()).toBeTruthy();
        const body = await res.json();
        expect(body.success).toBe(true);
        expect(body.source).toBe('system');
        expect(body.message).toMatch(/appropriate/i);
    });

    test('mental-health safety keyword returns the Wellness Centre message', async ({ request: api }) => {
        const res = await api.post('/api/quiz/chat', {
            data: {
                courseId: QUIZ_COURSE_ID,
                lectureName: 'Unit 1',
                questionText: 'Which biomolecule is the primary energy currency of the cell?',
                questionType: 'multiple-choice',
                studentAnswer: 'A',
                message: 'I want to kill myself, I cannot do this anymore.',
            },
        });
        expect(res.ok()).toBeTruthy();
        const body = await res.json();
        expect(body.source).toBe('system');
        expect(body.message).toMatch(/wellness/i);
    });

    test('benign question reaches the LLM and returns a quiz-help response', async ({ request: api }) => {
        test.setTimeout(60_000);
        const res = await api.post('/api/quiz/chat', {
            data: {
                courseId: QUIZ_COURSE_ID,
                lectureName: 'Unit 1',
                questionText: 'Which biomolecule is the primary energy currency of the cell?',
                questionType: 'multiple-choice',
                correctAnswer: 'B',
                studentAnswer: 'A',
                message: 'Can you give me a hint about how to think about energy in cells?',
                conversationHistory: [],
            },
        });
        expect(res.ok()).toBeTruthy();
        const body = await res.json();
        expect(body.success).toBe(true);
        expect(body.source).toBe('quiz-help');
        expect(typeof body.message).toBe('string');
        expect(body.message.length).toBeGreaterThan(20);
    });
});
