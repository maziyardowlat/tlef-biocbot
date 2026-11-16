/**
 * A reload while BiocBot is writing a reply aborts POST /api/chat, but the
 * server still finishes the run. The route keeps the finished reply for the
 * conversation, and GET /api/chat/pending-reply hands it to the reloaded page.
 * Checked on the old handler and on the agent path, as JSON and as a stream.
 */
jest.mock('../../../src/services/llm', () => jest.fn());
jest.mock('../../../src/services/gridfs', () => ({ openDownloadStream: jest.fn() }));
jest.mock('../../../src/services/tracker', () => {
    const actual = jest.requireActual('../../../src/services/tracker');
    const Tracker = jest.fn(() => ({ analyzeMessage: jest.fn().mockResolvedValue({ isStruggling: false }) }));
    Tracker.buildAnalysisPrompt = actual.buildAnalysisPrompt;
    Tracker.normalizeAnalysis = actual.normalizeAnalysis;
    return Tracker;
});
jest.mock('../../../src/models/User', () => ({ updateUserStruggleState: jest.fn() }));
jest.mock('../../../src/models/MentalHealthFlag', () => ({ createMentalHealthFlag: jest.fn() }));
jest.mock('../../../src/models/Course', () => ({
    normalizeTopicList: jest.fn(value => Array.isArray(value) ? value : []),
    resolveRagSettings: jest.fn(() => ({ student: { topK: 5 } })),
    getLearningObjectives: jest.fn().mockResolvedValue([]),
    MAX_RAG_TOP_K: 20
}));
jest.mock('../../../src/models/Document', () => ({ getDocumentById: jest.fn() }));
jest.mock('../../../src/models/MessageFeedback', () => ({ normalizeRating: jest.fn() }));
jest.mock('../../../src/models/ChatSurveyResponse', () => ({ buildSettingsFingerprint: jest.fn() }));
jest.mock('../../../src/routes/llmKeyMiddleware', () => ({
    resolveCourseAi: jest.fn(),
    sendLlmKeyError: jest.fn(() => false)
}));

const http = require('http');
const { once } = require('events');
const { memoryDb } = require('../helpers/memory-db');
const { makeRouteApp, request } = require('../helpers/route-app');
const User = require('../../../src/models/User');
const { resolveCourseAi, sendLlmKeyError } = require('../../../src/routes/llmKeyMiddleware');
const agentChat = require('../../../src/services/agentChat');
const pendingChatReplies = require('../../../src/services/pendingChatReplies');
const router = require('../../../src/routes/chat');

const describeWithFramework = agentChat.loadFramework() !== null ? describe : describe.skip;

const student = { userId: 's1', role: 'student', displayName: 'Student' };
const course = { courseId: 'C1', lectures: [{ name: 'Unit 1', isPublished: true }], approvedStruggleTopics: [] };
const chunk = { lectureName: 'Unit 1', fileName: 'glycolysis.pdf', chunkText: 'Glycolysis takes place in the cytosol.', score: 0.9, documentType: 'lecture-notes' };
const PLAN = { approach: 'Guide them.', keyPoints: [{ point: 'It happens in the cytosol.', unit: 'Unit 1' }] };
const CONVERSATION = 'autosave_1763300000000_abc123def';
const json = value => ({ content: JSON.stringify(value), stopReason: 'stop', model: 'mock-model', usage: { total_tokens: 9 } });

function step(systemPrompt = '') {
    if (systemPrompt.includes('analyzing student struggle')) return 'tracker';
    if (systemPrompt.includes('PLANNING STEP')) return 'tutor';
    if (systemPrompt.includes('WRITING STEP')) return 'writer';
    if (systemPrompt.includes('recover after its output was rejected')) return 'recovery';
    return 'old-path';
}

function ai(answers = {}) {
    const defaults = {
        tracker: () => json({ isStruggling: false, mappedTopic: 'unmapped', matchConfidence: 0 }),
        tutor: () => json(PLAN),
        writer: () => json({ reply: 'An agent reply.' }),
        recovery: () => json({ retry: false, adjustment: '' }),
        'old-path': () => ({ content: 'An old-path reply.', model: 'old-model', usage: {} })
    };
    const llm = {
        sendMessage: jest.fn(async (message, options) => (answers[step(options.systemPrompt)] || defaults[step(options.systemPrompt)])(options)),
        analyzeMentalHealth: jest.fn().mockResolvedValue({ concernLevel: 'no concern' })
    };
    resolveCourseAi.mockResolvedValueOnce({ llm, qdrant: { searchDocuments: jest.fn().mockResolvedValue([chunk]) } });
    return llm;
}

/** An LLM answer that waits until the test lets it through. */
function gate(answer) {
    let release;
    let reached;
    const released = new Promise(resolve => { release = resolve; });
    const started = new Promise(resolve => { reached = resolve; });
    return {
        answer: options => { reached(); return released.then(() => answer(options)); },
        started,
        release
    };
}

const app = (user = student) => makeRouteApp(router, { db: memoryDb({ courses: [course] }), user });
const chatBody = body => ({ courseId: 'C1', unitName: 'Unit 1', message: 'Where does glycolysis happen?', conversationId: CONVERSATION, mode: 'tutor', ...body });
const pendingReply = (query = {}, user = student) => request(app(user))
    .get('/pending-reply')
    .query({ courseId: 'C1', conversationId: CONVERSATION, ...query });

/**
 * Send a chat request over a real socket, like the page's fetch, so the test
 * can drop the connection the way a reload does.
 */
async function openChatRequest(body, { stream = false } = {}) {
    const server = app().listen(0);
    await once(server, 'listening');
    const req = http.request({
        port: server.address().port,
        method: 'POST',
        path: '/',
        headers: {
            'Content-Type': 'application/json',
            Accept: stream ? 'text/event-stream, application/json' : 'application/json'
        }
    });
    req.on('error', () => {});
    req.end(JSON.stringify(chatBody(body)));
    return {
        reload: () => req.destroy(),
        close: () => new Promise(resolve => server.close(resolve))
    };
}

/** Wait until the kept outcome is no longer pending. */
async function settled() {
    for (let i = 0; i < 200; i++) {
        const res = await pendingReply();
        if (res.body.state !== 'pending') return res;
        await new Promise(resolve => setTimeout(resolve, 10));
    }
    throw new Error('The reply stayed pending');
}

const savedModes = process.env.AGENT_CHAT_MODES;
beforeAll(() => {
    jest.spyOn(console, 'log').mockImplementation(() => {});
    jest.spyOn(console, 'warn').mockImplementation(() => {});
    jest.spyOn(console, 'error').mockImplementation(() => {});
});
beforeEach(() => {
    pendingChatReplies.clear();
    delete process.env.AGENT_CHAT_MODES;
    resolveCourseAi.mockReset();
    sendLlmKeyError.mockReset().mockReturnValue(false);
    User.updateUserStruggleState.mockReset().mockResolvedValue({ success: true, skipped: true });
});
afterAll(() => {
    process.env.AGENT_CHAT_MODES = savedModes;
    jest.restoreAllMocks();
});

describe('GET /api/chat/pending-reply', () => {
    test('is "none" for a conversation with nothing kept', async () => {
        const res = await pendingReply();

        expect(res.status).toBe(200);
        expect(res.headers['cache-control']).toBe('no-store');
        expect(res.body).toEqual({ success: true, state: 'none' });
    });

    test.each([
        ['conversationId', { conversationId: '' }],
        ['courseId', { courseId: '' }]
    ])('needs a %s', async (_, query) => {
        const res = await pendingReply(query);

        expect(res.status).toBe(400);
    });

    test('needs a signed-in user', async () => {
        const res = await request(makeRouteApp(router, { db: memoryDb({ courses: [course] }) }))
            .get('/pending-reply')
            .query({ courseId: 'C1', conversationId: CONVERSATION });

        expect(res.status).toBe(401);
    });
});

describe('the old chat path', () => {
    test('keeps the reply it sent, unchanged, for the conversation', async () => {
        ai();

        const sent = await request(app()).post('/').send(chatBody());
        const kept = await pendingReply();

        expect(sent.status).toBe(200);
        expect(sent.body.message).toBe('An old-path reply.');
        expect(kept.body).toEqual({ success: true, state: 'ready', isExplanationRequest: false, reply: sent.body });
    });

    test('a reload mid-reply: pending while the reply is written, then ready', async () => {
        const slow = gate(() => ({ content: 'An old-path reply.', model: 'old-model', usage: {} }));
        ai({ 'old-path': slow.answer });
        const chat = await openChatRequest();
        try {
            await slow.started;
            chat.reload();

            expect((await pendingReply()).body).toEqual({ success: true, state: 'pending', isExplanationRequest: false, reply: null });

            slow.release();
            const kept = await settled();
            expect(kept.body.state).toBe('ready');
            expect(kept.body.reply).toMatchObject({ success: true, message: 'An old-path reply.', messageId: expect.stringMatching(/^msg_/) });
        } finally {
            await chat.close();
        }
    });

    test('an error is kept as failed, without a reply', async () => {
        ai({ 'old-path': () => { throw new Error('model unavailable'); } });

        const sent = await request(app()).post('/').send(chatBody());
        const kept = await pendingReply();

        expect(sent.status).toBe(500);
        expect(kept.body).toMatchObject({ state: 'failed', reply: null });
    });

    test('an Explain click is kept and marked as one', async () => {
        ai();

        await request(app()).post('/').send(chatBody({ isExplanationRequest: true, message: 'Glycolysis happens in the cytosol.' }));

        expect((await pendingReply()).body).toMatchObject({ state: 'ready', isExplanationRequest: true });
    });

    test('the profanity warning is kept like any reply', async () => {
        const sent = await request(app()).post('/').send(chatBody({ message: 'this is some shit answer' }));

        expect((await pendingReply()).body).toMatchObject({ state: 'ready', reply: sent.body });
    });

    test('another student, course or conversation sees nothing', async () => {
        ai();

        await request(app()).post('/').send(chatBody());

        expect((await pendingReply({}, { ...student, userId: 's2' })).body.state).toBe('none');
        expect((await pendingReply({ courseId: 'C2' })).body.state).toBe('none');
        expect((await pendingReply({ conversationId: 'autosave_other' })).body.state).toBe('none');
    });

    test('a request without a conversation id still gets its reply, and nothing is kept', async () => {
        ai();

        const sent = await request(app()).post('/').send(chatBody({ conversationId: null }));

        expect(sent.body.message).toBe('An old-path reply.');
        expect((await pendingReply()).body.state).toBe('none');
    });

    test('a request that fails validation keeps nothing', async () => {
        const sent = await request(app()).post('/').send(chatBody({ unitName: '' }));

        expect(sent.status).toBe(400);
        expect((await pendingReply()).body.state).toBe('none');
    });
});

describeWithFramework('the agent path', () => {
    beforeEach(() => {
        process.env.AGENT_CHAT_MODES = 'tutor,explain,protege';
    });

    test('keeps the JSON reply it sent, unchanged', async () => {
        ai();

        const sent = await request(app()).post('/').send(chatBody());
        const kept = await pendingReply();

        expect(sent.body.message).toBe('An agent reply.');
        expect(kept.body).toEqual({ success: true, state: 'ready', isExplanationRequest: false, reply: sent.body });
    });

    test('keeps the reply it streamed as the result event', async () => {
        ai();

        const sent = await request(app())
            .post('/')
            .set('Accept', 'text/event-stream, application/json')
            .send(chatBody())
            .buffer(true)
            .parse((res, done) => {
                let text = '';
                res.setEncoding('utf8');
                res.on('data', part => { text += part; });
                res.on('end', () => done(null, text));
            });
        const result = sent.body.split('\n\n').filter(Boolean)
            .map(frame => ({ event: (frame.match(/^event: (.*)$/m) || [])[1], data: (frame.match(/^data: (.*)$/m) || [])[1] }))
            .find(frame => frame.event === 'result');

        expect(JSON.parse(result.data).body.message).toBe('An agent reply.');
        expect((await pendingReply()).body).toEqual({ success: true, state: 'ready', isExplanationRequest: false, reply: JSON.parse(result.data).body });
    });

    test.each([
        ['streamed', true],
        ['as JSON', false]
    ])('a reload mid-reply (%s): pending while the reply is written, then ready', async (_, stream) => {
        const slow = gate(() => json({ reply: 'An agent reply.' }));
        ai({ writer: slow.answer });
        const chat = await openChatRequest({}, { stream });
        try {
            await slow.started;
            chat.reload();

            expect((await pendingReply()).body.state).toBe('pending');

            slow.release();
            const kept = await settled();
            expect(kept.body.state).toBe('ready');
            expect(kept.body.reply).toMatchObject({ success: true, message: 'An agent reply.', messageId: expect.stringMatching(/^msg_/) });
        } finally {
            await chat.close();
        }
    });

    test('a reply that could not be written is kept as failed', async () => {
        ai({ writer: () => ({ content: 'Not JSON.' }) });

        await request(app()).post('/').set('Accept', 'text/event-stream, application/json').send(chatBody());

        expect((await pendingReply()).body).toMatchObject({ state: 'failed', reply: null });
    });

    test('an unpublished unit is kept as failed', async () => {
        ai();

        const sent = await request(app()).post('/').send(chatBody({ unitName: 'Unit 9' }));

        expect(sent.status).toBe(400);
        expect((await pendingReply()).body.state).toBe('failed');
    });
});
