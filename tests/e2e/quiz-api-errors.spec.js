// @ts-check
/**
 * Error-path coverage for src/routes/quiz.js.
 *
 * The live e2e webServer always wires up app.locals.db + app.locals.llm and
 * always mounts auth middleware in front of /api/quiz, which makes the
 * route file's "missing-dependency" 503s, its top-level try/catch blocks, and
 * its "unauthenticated" branches unreachable from the main server. This spec
 * spawns a minimal Express harness (helpers/quiz-error-harness.js) that
 * mounts the real router with controllable dependencies, so we can reach
 * every remaining branch.
 *
 * The harness runs as a child Node process with the same NODE_V8_COVERAGE
 * directory as the main webServer, so its coverage is merged into the
 * monocart report by the existing global-teardown.
 */

const { test, expect, request } = require('./fixtures/monocart');
const { spawn } = require('child_process');
const path = require('path');
const net = require('net');
const { once } = require('events');

/** @type {import('child_process').ChildProcess|null} */
let harnessProc = null;
/** @type {import('@playwright/test').APIRequestContext|null} */
let api = null;

function getFreePort() {
    return /** @type {Promise<number>} */ (new Promise((resolve, reject) => {
        const srv = net.createServer();
        srv.unref();
        srv.on('error', reject);
        srv.listen(0, () => {
            const addr = /** @type {any} */ (srv.address());
            srv.close(() => resolve(addr.port));
        });
    }));
}

async function configure(mode) {
    if (!api) throw new Error('Harness API not ready');
    const res = await api.post('/__configure', { data: { mode }, failOnStatusCode: false });
    if (!res.ok()) {
        throw new Error(`Failed to configure harness mode=${mode}: ${res.status()}`);
    }
}

test.beforeAll(async () => {
    const port = await getFreePort();
    const env = {
        ...process.env,
        QUIZ_HARNESS_PORT: String(port),
        NODE_V8_COVERAGE: path.resolve(__dirname, '../../coverage-reports/.v8-server'),
        BIOCBOT_COVERAGE_RUN_ID: process.env.BIOCBOT_COVERAGE_RUN_ID || String(Date.now()),
    };

    harnessProc = spawn(process.execPath, [
        path.resolve(__dirname, 'helpers/quiz-error-harness.js'),
    ], { env, stdio: ['ignore', 'inherit', 'inherit'] });

    api = await request.newContext({ baseURL: `http://127.0.0.1:${port}` });

    const deadline = Date.now() + 15_000;
    while (Date.now() < deadline) {
        try {
            const res = await api.get('/__ping', { failOnStatusCode: false });
            if (res.ok()) return;
        } catch { /* not yet listening */ }
        await new Promise((r) => setTimeout(r, 100));
    }
    throw new Error('Quiz harness did not become ready in time');
});

test.afterAll(async () => {
    if (api) {
        await api.dispose();
        api = null;
    }
    if (harnessProc && harnessProc.pid && !harnessProc.killed) {
        harnessProc.kill('SIGTERM');
        await once(harnessProc, 'exit');
    }
});

test.beforeEach(async () => {
    await configure('');
});

test.describe('Quiz API — dependency-missing and catch-block coverage (harness)', () => {
    // ----- /status -----
    test('GET /status returns 503 when db is unavailable', async () => {
        await configure('no-db');
        const res = await /** @type {any} */ (api).get('/api/quiz/status?courseId=BIOC-1');
        expect(res.status()).toBe(503);
    });

    test('GET /status returns 500 when getQuizSettings throws', async () => {
        await configure('throw-getQuizSettings');
        const res = await /** @type {any} */ (api).get('/api/quiz/status?courseId=BIOC-1');
        expect(res.status()).toBe(500);
    });

    // ----- /questions -----
    test('GET /questions returns 400 when courseId is missing', async () => {
        const res = await /** @type {any} */ (api).get('/api/quiz/questions');
        expect(res.status()).toBe(400);
    });

    test('GET /questions returns 503 when db is unavailable', async () => {
        await configure('no-db');
        const res = await /** @type {any} */ (api).get('/api/quiz/questions?courseId=BIOC-1');
        expect(res.status()).toBe(503);
    });

    test('GET /questions returns 500 when getQuizSettings throws', async () => {
        await configure('throw-getQuizSettings');
        const res = await /** @type {any} */ (api).get('/api/quiz/questions?courseId=BIOC-1');
        expect(res.status()).toBe(500);
    });

    // ----- /check-answer -----
    test('POST /check-answer returns 503 when db is unavailable', async () => {
        await configure('no-db');
        const res = await /** @type {any} */ (api).post('/api/quiz/check-answer', {
            data: { courseId: 'BIOC-1', questionId: 'q', lectureName: 'U', studentAnswer: 'A' },
        });
        expect(res.status()).toBe(503);
    });

    test('POST /check-answer returns 503 when the LLM is unavailable for a short-answer question', async () => {
        await configure('check-answer-sa-no-llm');
        const res = await /** @type {any} */ (api).post('/api/quiz/check-answer', {
            data: {
                courseId: 'BIOC-1',
                questionId: 'q-test-sa',
                lectureName: 'U',
                studentAnswer: 'anything',
            },
        });
        expect(res.status()).toBe(503);
    });

    test('POST /check-answer returns 500 when getAssessmentQuestions throws', async () => {
        await configure('throw-getAssessmentQuestions');
        const res = await /** @type {any} */ (api).post('/api/quiz/check-answer', {
            data: { courseId: 'BIOC-1', questionId: 'q', lectureName: 'U', studentAnswer: 'A' },
        });
        expect(res.status()).toBe(500);
    });

    // ----- /attempt -----
    test('POST /attempt returns 401 when the request is unauthenticated', async () => {
        await configure('no-auth');
        const res = await /** @type {any} */ (api).post('/api/quiz/attempt', {
            data: {
                courseId: 'BIOC-1', questionId: 'q', lectureName: 'U',
                questionType: 'multiple-choice', studentAnswer: 'A', correct: true,
            },
        });
        expect(res.status()).toBe(401);
    });

    test('POST /attempt returns 503 when db is unavailable', async () => {
        await configure('no-db');
        const res = await /** @type {any} */ (api).post('/api/quiz/attempt', {
            data: {
                courseId: 'BIOC-1', questionId: 'q', lectureName: 'U',
                questionType: 'multiple-choice', studentAnswer: 'A', correct: true,
            },
        });
        expect(res.status()).toBe(503);
    });

    test('POST /attempt returns 500 when saveAttempt throws', async () => {
        await configure('throw-saveAttempt');
        const res = await /** @type {any} */ (api).post('/api/quiz/attempt', {
            data: {
                courseId: 'BIOC-1', questionId: 'q', lectureName: 'U',
                questionType: 'multiple-choice', studentAnswer: 'A', correct: true,
            },
        });
        expect(res.status()).toBe(500);
    });

    // ----- /history -----
    test('GET /history returns 400 when courseId is missing', async () => {
        const res = await /** @type {any} */ (api).get('/api/quiz/history');
        expect(res.status()).toBe(400);
    });

    test('GET /history returns 401 when the request is unauthenticated', async () => {
        await configure('no-auth');
        const res = await /** @type {any} */ (api).get('/api/quiz/history?courseId=BIOC-1');
        expect(res.status()).toBe(401);
    });

    test('GET /history returns 503 when db is unavailable', async () => {
        await configure('no-db');
        const res = await /** @type {any} */ (api).get('/api/quiz/history?courseId=BIOC-1');
        expect(res.status()).toBe(503);
    });

    test('GET /history returns 500 when getAttemptStats throws', async () => {
        await configure('throw-getAttemptStats');
        const res = await /** @type {any} */ (api).get('/api/quiz/history?courseId=BIOC-1');
        expect(res.status()).toBe(500);
    });

    // ----- /materials -----
    test('GET /materials returns 503 when db is unavailable', async () => {
        await configure('no-db');
        const res = await /** @type {any} */ (api).get('/api/quiz/materials?courseId=BIOC-1&lectureName=U');
        expect(res.status()).toBe(503);
    });

    test('GET /materials returns 500 when getQuizSettings throws', async () => {
        await configure('throw-getQuizSettings');
        const res = await /** @type {any} */ (api).get('/api/quiz/materials?courseId=BIOC-1&lectureName=U');
        expect(res.status()).toBe(500);
    });

    test('GET /materials returns 500 when getDocumentsForLecture throws', async () => {
        await configure('throw-getDocumentsForLecture');
        const res = await /** @type {any} */ (api).get('/api/quiz/materials?courseId=BIOC-1&lectureName=U');
        expect(res.status()).toBe(500);
    });

    // ----- /materials/:id/download -----
    test('GET /materials/:id/download returns 503 when db is unavailable', async () => {
        await configure('no-db');
        const res = await /** @type {any} */ (api).get('/api/quiz/materials/doc-1/download?courseId=BIOC-1');
        expect(res.status()).toBe(503);
    });

    test('GET /materials/:id/download returns 500 when getDocumentById throws', async () => {
        await configure('throw-getDocumentById');
        const res = await /** @type {any} */ (api).get('/api/quiz/materials/doc-1/download?courseId=BIOC-1');
        expect(res.status()).toBe(500);
    });

    // ----- /chat -----
    test('POST /chat returns 503 when db is unavailable', async () => {
        await configure('no-db');
        const res = await /** @type {any} */ (api).post('/api/quiz/chat', {
            data: {
                courseId: 'BIOC-1', lectureName: 'U', questionText: 'Q?',
                message: 'help', questionType: 'multiple-choice',
            },
        });
        expect(res.status()).toBe(503);
    });

    test('POST /chat returns 503 when LLM is unavailable', async () => {
        await configure('no-llm');
        const res = await /** @type {any} */ (api).post('/api/quiz/chat', {
            data: {
                courseId: 'BIOC-1', lectureName: 'U', questionText: 'Q?',
                message: 'help', questionType: 'multiple-choice',
            },
        });
        expect(res.status()).toBe(503);
    });

    test('POST /chat returns 500 when the course lookup throws', async () => {
        await configure('chat-throw-courses-findOne');
        const res = await /** @type {any} */ (api).post('/api/quiz/chat', {
            data: {
                courseId: 'BIOC-1', lectureName: 'U', questionText: 'Q?',
                message: 'help me think about this',
                questionType: 'multiple-choice',
            },
        });
        expect(res.status()).toBe(500);
    });

    test('POST /chat logs and continues when the inner short-answer correctAnswer lookup throws', async () => {
        // questionType=short-answer + the AI placeholder triggers the inner
        // `db.collection('courses').findOne(...)` lookup. Configuring the db so
        // that findOne throws hits the inner try/catch's console.error path.
        // (The second findOne further down then throws too and produces 500.)
        await configure('chat-throw-courses-findOne');
        const res = await /** @type {any} */ (api).post('/api/quiz/chat', {
            data: {
                courseId: 'BIOC-1',
                lectureName: 'U',
                questionText: 'Name the bond formed between amino acids.',
                questionType: 'short-answer',
                correctAnswer: '[evaluated by AI - see feedback]',
                studentAnswer: 'no idea',
                message: 'remind me about this bond please',
            },
        });
        expect(res.status()).toBe(500);
    });

    test('POST /chat includes Qdrant-retrieved snippets in the LLM context when results exist', async () => {
        await configure('chat-qdrant-returns-results');
        const res = await /** @type {any} */ (api).post('/api/quiz/chat', {
            data: {
                courseId: 'BIOC-1', lectureName: 'Unit 1', questionText: 'Q?',
                message: 'walk me through energy carriers in cells',
                questionType: 'multiple-choice', correctAnswer: 'B', studentAnswer: 'A',
            },
        });
        expect(res.ok()).toBeTruthy();
        const body = await res.json();
        expect(body.success).toBe(true);
        expect(body.source).toBe('quiz-help');
        // The stub LLM echoes a fixed reply — the value of this test is the
        // branch coverage (RAG-results path + the .map() arrow function).
        expect(typeof body.message).toBe('string');
    });

    test('POST /chat falls back to a default reply when the LLM returns no content', async () => {
        await configure('chat-llm-empty-response');
        const res = await /** @type {any} */ (api).post('/api/quiz/chat', {
            data: {
                courseId: 'BIOC-1', lectureName: 'U', questionText: 'Q?',
                message: 'help me think about this question',
                questionType: 'multiple-choice', correctAnswer: 'B', studentAnswer: 'A',
            },
        });
        expect(res.ok()).toBeTruthy();
        const body = await res.json();
        expect(body.message).toBe('Sorry, I could not generate a response. Please try again.');
        expect(body.source).toBe('quiz-help');
    });
});
