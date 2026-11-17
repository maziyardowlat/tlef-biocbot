/**
 * What the chat page gets from POST /api/chat on the agent path: the statuses
 * it shows beside the typing dots while the reply is written, then the reply.
 *
 * Rung 4 of the agents framework swaps BiocBot's own live-status code for the
 * framework's chat package (the framework's PRD, section 11). These tests
 * were written against the code before the swap and run on the code after it.
 * They post through the page's own request code, which a VM loads by URL as
 * the student page does (PAGE_SCRIPTS), to the real route on a real socket.
 * The model is mocked, and every message and reason is made up.
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
    getLearningObjectives: jest.fn().mockResolvedValue(['Explain where glycolysis happens']),
    MAX_RAG_TOP_K: 20
}));
jest.mock('../../../src/models/Document', () => ({ getDocumentById: jest.fn() }));
jest.mock('../../../src/models/MessageFeedback', () => ({ normalizeRating: jest.fn() }));
jest.mock('../../../src/models/ChatSurveyResponse', () => ({ buildSettingsFingerprint: jest.fn() }));
// The real key-error responses, so the page gets what a student would.
jest.mock('../../../src/routes/llmKeyMiddleware', () => ({
    ...jest.requireActual('../../../src/routes/llmKeyMiddleware'),
    resolveCourseAi: jest.fn()
}));

const http = require('http');
const path = require('path');
const vm = require('vm');
const express = require('express');
const { memoryDb } = require('../helpers/memory-db');
const User = require('../../../src/models/User');
const MentalHealthFlag = require('../../../src/models/MentalHealthFlag');
const { resolveCourseAi } = require('../../../src/routes/llmKeyMiddleware');
const agentChat = require('../../../src/services/agentChat');
const pendingChatReplies = require('../../../src/services/pendingChatReplies');
const router = require('../../../src/routes/chat');
const vendorRoutes = require('../../../src/routes/vendor');

const describeWithFramework = agentChat.loadFramework() !== null ? describe : describe.skip;

/** What the student page loads to post a message, in its order (public/student/index.html). */
const PAGE_SCRIPTS = ['/vendor/agents-chat.js', '/student/scripts/student-chat-request.js'];

// The text a student sees, pinned here as text so that a change to it shows.
const UNDERSTANDING = 'BiocBot is understanding your message';
const FINDING = 'BiocBot is finding relevant course materials';
const PLANNING = 'BiocBot is working out what to say';
const FINALIZING = 'BiocBot is finalizing its response';
const LABELS = Object.freeze({
    [UNDERSTANDING]: 'Understanding',
    [FINDING]: 'Course materials',
    [PLANNING]: 'Planning',
    [FINALIZING]: 'Writing'
});
const FALLBACK_MESSAGE = 'Sorry, I encountered an error processing your message.';

const student = { userId: 's1', role: 'student', displayName: 'Student' };
const course = {
    courseId: 'C1',
    lectures: [{ name: 'Unit 1', isPublished: true }, { name: 'Unit 2', isPublished: false }],
    approvedStruggleTopics: ['Glycolysis']
};
const chunk = { lectureName: 'Unit 1', fileName: 'glycolysis.pdf', chunkText: 'Glycolysis takes place in the cytosol.', score: 0.9, documentType: 'lecture-notes' };
// Each agent's output has a marker, so a test can tell if one reaches the browser.
const PLAN = { approach: 'PLAN-MARKER guide them.', keyPoints: [{ point: 'It happens in the cytosol.', unit: 'Unit 1' }] };
const PROTEGE_PLAN = { verdict: 'incorrect', nextQuestion: 'PLAN-MARKER are you sure?' };
const json = value => ({ content: JSON.stringify(value), stopReason: 'stop', model: 'mock-model', usage: { total_tokens: 9 } });

const CONVERSATION = Object.freeze([
    { role: 'assistant', content: "I'm BiocBot in Tutor Mode. We're discussing Unit 1 this week. How can I help you today?" },
    { role: 'user', content: 'Where does glycolysis happen?' },
    { role: 'assistant', content: 'In the cytosol.' },
    { role: 'user', content: 'ok. lately I feel like a burden to everyone around me.' }
]);
const DISTRESS = CONVERSATION[3].content;
const CONCERN = Object.freeze({ concernLevel: 'high concern', reason: 'MH-MARKER a made-up reason for a test.' });

function step(systemPrompt = '') {
    if (systemPrompt.includes('mental health concern detector')) return 'mental-health';
    if (systemPrompt.includes('analyzing student struggle')) return 'tracker';
    if (systemPrompt.includes('PLANNING STEP')) return 'tutor';
    if (systemPrompt.includes('WRITING STEP')) return 'writer';
    if (systemPrompt.includes('summarize, recap')) return 'summary-check';
    if (systemPrompt.includes('recover after its output was rejected')) return 'recovery';
    return 'old-path';
}

/** A course's model and Qdrant, answering by step. */
function ai(answers = {}) {
    const defaults = {
        tracker: () => json({ isStruggling: false, mappedTopic: 'unmapped', matchConfidence: 0, reason: 'TRACKER-MARKER' }),
        tutor: options => json(options.systemPrompt.includes('confused student') ? PROTEGE_PLAN : PLAN),
        writer: () => json({ reply: 'An agent reply.' }),
        'summary-check': () => json({ isSummaryAttempt: true }),
        'mental-health': () => json({ concernLevel: 'no concern', reason: 'MH-MARKER ordinary study talk.' }),
        recovery: () => json({ retry: false, adjustment: '' }),
        'old-path': () => ({ content: 'An old-path reply.', model: 'old-model', usage: {} })
    };
    const llm = {
        sendMessage: jest.fn(async (message, options) => (answers[step(options.systemPrompt)] || defaults[step(options.systemPrompt)])(options)),
        analyzeMentalHealth: jest.fn().mockResolvedValue({ concernLevel: 'no concern' })
    };
    const qdrant = { searchDocuments: jest.fn().mockResolvedValue([chunk]) };
    resolveCourseAi.mockResolvedValue({ llm, qdrant });
    return { llm, qdrant };
}

/** The route as the server mounts it, with the student page's static files. */
function pageApp({ user = student, db = memoryDb({ courses: [course] }), headers = {} } = {}) {
    const app = express();
    app.use(express.json());
    app.locals.db = db;
    app.use((req, res, next) => {
        if (user) req.user = user;
        res.set(headers);
        next();
    });
    app.use('/api/chat', router);
    app.use('/student', express.static(path.join(__dirname, '../../../public/student')));
    app.use('/vendor', vendorRoutes);
    return app;
}

const servers = [];
async function listen(app = pageApp()) {
    const server = http.createServer(app);
    await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
    servers.push(server);
    return `http://127.0.0.1:${server.address().port}`;
}

/**
 * The student page's request code in a VM, loaded by URL in the page's order,
 * with relative URLs resolved against the test's server, as a browser would.
 * As in a browser, a script that doesn't load (the chat client, where the
 * framework isn't installed) doesn't run, and the page goes on without it.
 */
async function openPage(base, scripts = PAGE_SCRIPTS) {
    const page = vm.createContext({
        console,
        TextDecoder,
        DOMException,
        fetch: (url, init) => fetch(new URL(url, base), init)
    });
    page.window = page;
    for (const src of scripts) {
        const response = await fetch(new URL(src, base));
        if (response.ok) vm.runInContext(await response.text(), page, { filename: src });
    }
    return page;
}

/** The body student.js posts. */
const pageBody = (body = {}) => ({
    message: 'Where does glycolysis happen?',
    conversationId: 'conversation-1',
    mode: 'tutor',
    courseId: 'C1',
    unitName: 'Unit 1',
    conversationContext: null,
    checkSummaryAttempt: false,
    isExplanationRequest: false,
    topic: null,
    ...body
});

/**
 * Sends a message as student.js does, and returns what the page gets: each
 * text it passes to the status line, then the status code and body, or the
 * name of the error it handles.
 */
async function sendAsThePage(page, body, { signal = null, onStatus = () => {} } = {}) {
    const shown = [];
    try {
        const { status, data } = await page.requestChatReply(pageBody(body), {
            signal,
            onStatus: text => {
                shown.push(text);
                onStatus(text);
            }
        });
        return { shown, status, body: data };
    } catch (error) {
        return { shown, error: error.name };
    }
}

/** Posts the page's body the way an old page, a test or another client does: plain JSON, no stream asked for. */
async function postJson(base, body) {
    const response = await fetch(new URL('/api/chat', base), {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(pageBody(body))
    });
    return { status: response.status, type: response.headers.get('content-type'), body: await response.json() };
}

/** Asks for a stream and reads the raw response until the server ends it. */
async function readRaw(base, body) {
    const response = await fetch(new URL('/api/chat', base), {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Accept: 'text/event-stream, application/json' },
        body: JSON.stringify(pageBody(body))
    });
    const text = await response.text();
    return { status: response.status, headers: response.headers, text, events: parseEvents(text) };
}

/** Splits a server-sent event body into { event, data } frames, skipping comments. */
function parseEvents(text) {
    return text.split('\n\n').filter(frame => frame.trim() && !frame.startsWith(':')).map(frame => {
        const event = (frame.match(/^event: (.*)$/m) || [])[1];
        const data = (frame.match(/^data: (.*)$/m) || [])[1];
        return { event, data: data && JSON.parse(data) };
    });
}

/** The result event, and every other event (the statuses). */
const resultOf = events => events.filter(e => e.event === 'result');
const statusEventsOf = events => events.filter(e => e.event !== 'result');

/** A response body without the fields that differ on every request. */
function stable(body) {
    if (!body || typeof body !== 'object') return body;
    const copy = { ...body };
    if ('messageId' in copy) copy.messageId = '<id>';
    if ('timestamp' in copy) copy.timestamp = '<time>';
    if (copy.debug && 'agentRunId' in copy.debug) copy.debug = { ...copy.debug, agentRunId: '<run>' };
    return copy;
}

/** The body the agent path answers with, pinned for each mode. */
function agentReplyBody({ mode, message = 'An agent reply.', struggleState = null, directiveModeActive = false, identifiedTopic = null } = {}) {
    return {
        success: true,
        messageId: '<id>',
        message,
        model: 'mock-model',
        usage: { total_tokens: 9 },
        timestamp: '<time>',
        mode,
        citations: [{ lectureName: 'Unit 1', fileName: 'glycolysis.pdf', score: 0.9 }],
        sourceAttribution: {
            source: 'multiple',
            description: 'From: glycolysis.pdf — Lecture Notes (Unit 1)',
            unitName: 'Unit 1',
            documentType: 'multiple',
            documents: [],
            downloadsEnabled: false
        },
        debug: {
            searchResultsCount: 1,
            avgScore: 0.9,
            maxScore: 0.9,
            documentTypes: [{ fileName: 'glycolysis.pdf', documentType: 'lecture-notes', score: 0.9 }],
            agentRunId: '<run>'
        },
        retrieval: { mode: 'single', lectureNames: ['Unit 1'], searchScope: ['Unit 1'] },
        struggleState,
        struggleDebug: { userExists: true, userId: 's1', trackerInitialized: true, directiveModeActive, identifiedTopic }
    };
}

/** sendChatError's body for an error that isn't a key error. */
const errorBody = message => ({ success: false, message, timestamp: '<time>' });

// The route doesn't wait for the mental-health check, so the tests wait on
// each run, and on the check after it, through runStudentChat.
const runStudentChat = agentChat.runStudentChat;
let runs = [];
const runsFinished = () => Promise.all(runs);
const checksFinished = async () => Promise.all((await runsFinished()).map(outcome => outcome.run.asyncDone));

/** Retries an assertion until it passes, for what nothing can wait on. */
async function eventually(assertion) {
    for (let attempt = 0; attempt < 200; attempt += 1) {
        try {
            assertion();
            return;
        } catch {
            await new Promise(resolve => setTimeout(resolve, 5));
        }
    }
    assertion();
}

const savedModes = process.env.AGENT_CHAT_MODES;
beforeAll(() => {
    jest.spyOn(console, 'log').mockImplementation(() => {});
    jest.spyOn(console, 'warn').mockImplementation(() => {});
    jest.spyOn(console, 'error').mockImplementation(() => {});
});
beforeEach(() => {
    process.env.AGENT_CHAT_MODES = 'tutor,explain,protege';
    resolveCourseAi.mockReset();
    User.updateUserStruggleState.mockReset().mockResolvedValue({ success: true, skipped: true });
    MentalHealthFlag.createMentalHealthFlag.mockReset().mockResolvedValue({ success: true });
    runs = [];
    jest.spyOn(agentChat, 'runStudentChat').mockImplementation(options => {
        const outcome = runStudentChat(options);
        runs.push(outcome);
        return outcome;
    });
});
afterEach(async () => {
    await Promise.allSettled(runs.map(outcome => outcome.then(({ run }) => run.asyncDone)));
    agentChat.runStudentChat.mockRestore();
    await Promise.all(servers.splice(0).map(server => new Promise(resolve => {
        server.closeAllConnections();
        server.close(resolve);
    })));
});
afterAll(() => {
    process.env.AGENT_CHAT_MODES = savedModes;
    jest.restoreAllMocks();
});

const MODES = [
    ['tutor', { mode: 'tutor' }, 'tutor'],
    ['protégé', { mode: 'protege' }, 'protege'],
    ['explain', { mode: 'tutor', isExplanationRequest: true }, 'tutor']
];

describeWithFramework.each(MODES)('in %s mode, the page', (_, body, responseMode) => {
    test('shows the same statuses, in the same order, with the same text', async () => {
        ai();
        const page = await openPage(await listen());

        const got = await sendAsThePage(page, body);

        expect(got.shown).toEqual([UNDERSTANDING, FINDING, PLANNING, FINALIZING]);
    });

    test('sees the same statuses without the struggle check, which needs a signed-in student', async () => {
        ai();
        const page = await openPage(await listen(pageApp({ user: null })));

        const got = await sendAsThePage(page, body);

        expect(got.shown).toEqual([FINDING, PLANNING, FINALIZING]);
        expect(got.status).toBe(200);
    });

    test('every status on the stream has the step’s own label and text', async () => {
        ai();
        const raw = await readRaw(await listen(), body);

        const steps = statusEventsOf(raw.events).filter(({ data }) => data && 'status' in data);
        expect(new Set(steps.map(({ data }) => data.status))).toEqual(new Set([UNDERSTANDING, FINDING, PLANNING, FINALIZING]));
        steps.forEach(({ data }) => expect(data.label).toBe(LABELS[data.status]));
    });

    test('gets the reply with the same status code and body as a JSON request', async () => {
        ai();
        const base = await listen();
        const page = await openPage(base);

        const streamed = await sendAsThePage(page, body);
        const plain = await postJson(base, body);

        expect(streamed.status).toBe(200);
        expect(stable(streamed.body)).toEqual(agentReplyBody({ mode: responseMode }));
        expect(plain.status).toBe(200);
        expect(stable(plain.body)).toEqual(stable(streamed.body));
    });

    test('a request that doesn’t ask for a stream gets plain JSON', async () => {
        ai();

        const plain = await postJson(await listen(), body);

        expect(plain.type).toBe('application/json; charset=utf-8');
        expect(stable(plain.body)).toEqual(agentReplyBody({ mode: responseMode }));
    });

    test('gets today’s error, after the same statuses, when the reply can’t be written', async () => {
        ai({ writer: () => ({ content: 'Not JSON. FAILURE-MARKER' }) });
        const base = await listen();
        const page = await openPage(base);

        const streamed = await sendAsThePage(page, body);
        const plain = await postJson(base, body);

        expect(streamed.shown).toEqual([UNDERSTANDING, FINDING, PLANNING, FINALIZING]);
        expect(streamed.status).toBe(500);
        expect(stable(streamed.body)).toEqual(errorBody(FALLBACK_MESSAGE));
        expect(plain.status).toBe(500);
        expect(stable(plain.body)).toEqual(stable(streamed.body));
    });
});

describeWithFramework('the route’s other answers reach the page as before', () => {
    test('a struggle the tracker maps comes back in the body', async () => {
        ai({ tracker: () => json({ isStruggling: true, mappedTopic: 'Glycolysis', matchConfidence: 0.9 }) });
        User.updateUserStruggleState.mockResolvedValue({ success: true, state: { topic: 'Glycolysis', isActive: true } });
        const page = await openPage(await listen());

        const got = await sendAsThePage(page, { mode: 'tutor' });

        expect(got.shown).toEqual([UNDERSTANDING, FINDING, PLANNING, FINALIZING]);
        expect(stable(got.body)).toEqual(agentReplyBody({
            mode: 'tutor',
            struggleState: { topic: 'Glycolysis', isActive: true },
            directiveModeActive: true,
            identifiedTopic: 'Glycolysis'
        }));
    });

    test('the summary check’s reprompt line comes back in the message', async () => {
        ai({ 'summary-check': () => json({ isSummaryAttempt: false }) });
        const page = await openPage(await listen());

        const got = await sendAsThePage(page, { mode: 'tutor', checkSummaryAttempt: true });

        expect(got.shown).toEqual([UNDERSTANDING, FINDING, PLANNING, FINALIZING]);
        expect(stable(got.body)).toEqual(agentReplyBody({ mode: 'tutor', message: `An agent reply.${agentChat.REPROMPT_TEXT}` }));
    });

    test('a course search that fails comes back as an error, after the statuses so far', async () => {
        const { qdrant } = ai();
        qdrant.searchDocuments.mockRejectedValue(new Error('Service endpoint unreachable'));
        const base = await listen();
        const page = await openPage(base);

        const streamed = await sendAsThePage(page, { mode: 'tutor' });
        const plain = await postJson(base, { mode: 'tutor' });

        expect(streamed.shown).toEqual([UNDERSTANDING, FINDING, PLANNING]);
        expect(streamed.status).toBe(503);
        expect(stable(streamed.body)).toEqual(errorBody('Service endpoint is not reachable. Please check your configuration.'));
        expect(plain.status).toBe(503);
        expect(stable(plain.body)).toEqual(stable(streamed.body));
    });

    test('a key error from the model keeps its own response', async () => {
        const keyError = Object.assign(new Error('The course key was rejected.'), { name: 'LlmKeyError', code: 'LLM_KEY_INVALID', status: 'invalid', httpStatus: 403 });
        ai({ tracker: () => { throw keyError; }, tutor: () => { throw keyError; } });
        const base = await listen();
        const page = await openPage(base);

        const streamed = await sendAsThePage(page, { mode: 'tutor' });
        const plain = await postJson(base, { mode: 'tutor' });

        expect(streamed.shown).toEqual([UNDERSTANDING, FINDING, PLANNING]);
        expect(streamed.status).toBe(403);
        expect(streamed.body).toEqual({ success: false, code: 'LLM_KEY_INVALID', message: expect.any(String) });
        expect(plain).toMatchObject({ status: 403, body: streamed.body });
    });

    test.each([
        ['an error', new Error('OLLAMA_ENDPOINT is not set'), 503, errorBody('Ollama service is not available. Please check if Ollama is running.')],
        ['a key error', Object.assign(new Error('No key.'), { name: 'LlmKeyError', code: 'LLM_KEY_MISSING', status: 'missing' }), 403, { success: false, code: 'LLM_KEY_MISSING', message: expect.any(String) }]
    ])('%s thrown once the run is under way comes back with its own status', async (_, error, status, body) => {
        ai();
        const base = await listen();
        const page = await openPage(base);
        agentChat.runStudentChat.mockImplementation(async () => { throw error; });

        const streamed = await sendAsThePage(page, { mode: 'tutor' });
        const plain = await postJson(base, { mode: 'tutor' });

        expect(streamed).toEqual({ shown: [], status, body: expect.anything() });
        expect(stable(streamed.body)).toEqual(body);
        expect(plain.status).toBe(status);
        expect(stable(plain.body)).toEqual(stable(streamed.body));
    });

    test.each([
        ['an unpublished unit', { unitName: 'Unit 2' }, 400, { success: false, message: 'Selected unit is not published or does not exist' }],
        ['an unknown course', { courseId: 'NOPE' }, 404, { success: false, message: 'Course not found' }],
        ['no message', { message: '' }, 400, { success: false, message: 'Message is required and must be a string' }]
    ])('%s is still a plain JSON error, with no stream', async (_, body, status, expected) => {
        ai();
        const base = await listen();
        const page = await openPage(base);

        const streamed = await sendAsThePage(page, { mode: 'tutor', ...body });
        const raw = await readRaw(base, { mode: 'tutor', ...body });

        expect(streamed).toEqual({ shown: [], status, body: expected });
        expect(raw.headers.get('content-type')).toBe('application/json; charset=utf-8');
    });
});

describeWithFramework('the stream itself', () => {
    test('has the same headers, and keeps the ones already set', async () => {
        ai();
        const raw = await readRaw(await listen(pageApp({ headers: { 'X-Frame-Options': 'DENY' } })), { mode: 'tutor' });

        expect(raw.status).toBe(200);
        expect(raw.headers.get('content-type')).toBe('text/event-stream; charset=utf-8');
        expect(raw.headers.get('cache-control')).toBe('no-cache, no-transform');
        expect(raw.headers.get('connection')).toBe('keep-alive');
        expect(raw.headers.get('x-accel-buffering')).toBe('no');
        expect(raw.headers.get('x-frame-options')).toBe('DENY');
        expect(raw.headers.get('x-powered-by')).toBe('Express');
    });

    test('ends with the result, which is sent once', async () => {
        ai();
        const raw = await readRaw(await listen(), { mode: 'tutor' });

        expect(resultOf(raw.events)).toHaveLength(1);
        expect(raw.events.at(-1).event).toBe('result');
    });

    test.each([
        ['a reply', {}],
        ['failures', {
            writer: () => ({ content: 'Not JSON. FAILURE-MARKER' }),
            'mental-health': () => { throw new Error('FAILURE-MARKER model unavailable'); }
        }]
    ])('with %s, no agent output and no failure code or message reaches the browser', async (_, answers) => {
        ai(answers);
        const raw = await readRaw(await listen(), { mode: 'tutor', message: DISTRESS, conversationContext: { conversationMessages: CONVERSATION } });
        await checksFinished();

        const statuses = statusEventsOf(raw.events);
        expect(statuses.length).toBeGreaterThan(0);
        for (const marker of ['PLAN-MARKER', 'TRACKER-MARKER', 'MH-MARKER', 'FAILURE-MARKER', 'invalid_json', 'output_mismatch', 'llm_failed', 'tool_failed']) {
            expect(raw.text).not.toContain(marker);
        }
        statuses.filter(({ data }) => data && 'status' in data)
            .forEach(({ data }) => expect(LABELS[data.status]).toBe(data.label));
    });
});

describeWithFramework('a slow, hanging or closed browser', () => {
    test('a student who leaves mid-reply doesn’t stop the run, its writes are still saved, and the reply is kept', async () => {
        pendingChatReplies.clear();
        const leave = new AbortController();
        let shownFirst;
        const firstShown = new Promise(resolve => { shownFirst = resolve; });
        ai({
            // The student leaves once the page shows the first status, while the struggle check runs.
            tracker: async () => {
                await firstShown;
                leave.abort();
                await new Promise(resolve => setTimeout(resolve, 50));
                return json({ isStruggling: true, mappedTopic: 'Glycolysis', matchConfidence: 0.9 });
            },
            'mental-health': () => json(CONCERN)
        });
        const page = await openPage(await listen());

        const got = await sendAsThePage(page, {
            mode: 'tutor',
            message: DISTRESS,
            conversationContext: { conversationMessages: CONVERSATION }
        }, { signal: leave.signal, onStatus: shownFirst });
        const [outcome] = await runsFinished();
        await checksFinished();

        expect(got).toEqual({ shown: [UNDERSTANDING], error: 'AbortError' });
        expect(outcome.reply).toBe('An agent reply.');
        expect(outcome.run.usedFallback).toBe(false);
        expect(User.updateUserStruggleState).toHaveBeenCalledWith(expect.anything(), 's1', expect.objectContaining({ topic: 'Glycolysis' }), 'C1');
        expect(MentalHealthFlag.createMentalHealthFlag).toHaveBeenCalledTimes(1);
        // The streamed result is kept for the conversation, so the page shows
        // the reply when the student comes back (GET /api/chat/pending-reply).
        await eventually(() => expect(pendingChatReplies.get({ userId: 's1', courseId: 'C1', conversationId: 'conversation-1' })).toMatchObject({
            state: 'ready',
            body: expect.objectContaining({ success: true, message: 'An agent reply.', messageId: expect.stringMatching(/^msg_/) })
        }));
    });

    test('a browser that stops reading doesn’t hold up the run, and gets the whole result once it reads', async () => {
        // A reply far bigger than a socket holds, so the result backs up.
        const long = 'x'.repeat(4 * 1024 * 1024);
        ai({ writer: () => json({ reply: long }), 'mental-health': () => json(CONCERN) });
        const base = new URL(await listen());
        const response = await new Promise((resolve, reject) => {
            const request = http.request({
                host: base.hostname,
                port: base.port,
                path: '/api/chat',
                method: 'POST',
                headers: { 'Content-Type': 'application/json', Accept: 'text/event-stream, application/json' }
            }, resolve);
            request.on('error', reject);
            request.end(JSON.stringify(pageBody({ mode: 'tutor', message: DISTRESS, conversationContext: { conversationMessages: CONVERSATION } })));
        });
        response.pause();

        // The run starts after the headers, so wait for it before waiting on it.
        await eventually(() => expect(runs).toHaveLength(1));
        const [outcome] = await runsFinished();
        await checksFinished();
        expect(outcome.reply).toBe(long);
        expect(MentalHealthFlag.createMentalHealthFlag).toHaveBeenCalledTimes(1);
        expect(response.readableEnded).toBe(false);

        response.setEncoding('utf8');
        let text = '';
        response.on('data', piece => { text += piece; });
        const ended = new Promise(resolve => response.on('end', resolve));
        response.resume();
        await ended;
        const [result] = resultOf(parseEvents(text));
        expect(result.data.status).toBe(200);
        expect(result.data.body.message).toBe(long);
    });
});

describeWithFramework('the mental-health check is async, and the student never sees it', () => {
    test('the stream closes when the reply is ready, and the check saves its flag after that', async () => {
        let answer;
        ai({ 'mental-health': () => new Promise(resolve => { answer = resolve; }) });
        const base = await listen();

        try {
            // Reads until the server ends the response, so it returns only once the stream has closed.
            const raw = await readRaw(base, { mode: 'tutor', message: DISTRESS, conversationContext: { conversationMessages: CONVERSATION } });

            expect(resultOf(raw.events)).toEqual([{ event: 'result', data: { status: 200, body: expect.objectContaining({ message: 'An agent reply.' }) } }]);
            expect(answer).toEqual(expect.any(Function));
            expect(MentalHealthFlag.createMentalHealthFlag).not.toHaveBeenCalled();
        } finally {
            answer?.(json(CONCERN));
        }
        await checksFinished();
        expect(MentalHealthFlag.createMentalHealthFlag).toHaveBeenCalledTimes(1);
        expect(MentalHealthFlag.createMentalHealthFlag).toHaveBeenCalledWith(expect.anything(), expect.objectContaining({
            studentId: 's1', courseId: 'C1', message: DISTRESS, concernLevel: 'high concern'
        }));
    });

    test('the page has its reply while the check is still running', async () => {
        let answer;
        ai({ 'mental-health': () => new Promise(resolve => { answer = resolve; }) });
        const page = await openPage(await listen());

        try {
            const got = await sendAsThePage(page, { mode: 'tutor', message: DISTRESS, conversationContext: { conversationMessages: CONVERSATION } });

            expect(got.shown).toEqual([UNDERSTANDING, FINDING, PLANNING, FINALIZING]);
            expect(got.body.message).toBe('An agent reply.');
            expect(MentalHealthFlag.createMentalHealthFlag).not.toHaveBeenCalled();
        } finally {
            answer?.(json(CONCERN));
        }
        await checksFinished();
        expect(MentalHealthFlag.createMentalHealthFlag).toHaveBeenCalledTimes(1);
    });

    test('a failed check shows nothing, and is still logged on the server', async () => {
        ai({ 'mental-health': () => { throw new Error('Model unavailable'); } });
        const page = await openPage(await listen());

        const got = await sendAsThePage(page, { mode: 'tutor', message: DISTRESS, conversationContext: { conversationMessages: CONVERSATION } });
        await checksFinished();

        expect(got.shown).toEqual([UNDERSTANDING, FINDING, PLANNING, FINALIZING]);
        expect(got.body.message).toBe('An agent reply.');
        expect(MentalHealthFlag.createMentalHealthFlag).not.toHaveBeenCalled();
        expect(console.error).toHaveBeenCalledWith(expect.stringContaining('agent.failed mental-health-check llm_failed'));
    });
});

// These don't need the framework, so they run wherever it isn't installed too.
describe('with AGENT_CHAT_MODES unset, the old path is unchanged', () => {
    test('the page gets the old handler’s JSON, with no statuses, and the old check runs', async () => {
        delete process.env.AGENT_CHAT_MODES;
        const { llm } = ai();
        const base = await listen();
        const page = await openPage(base);

        const got = await sendAsThePage(page, { mode: 'tutor', message: DISTRESS, conversationContext: { conversationMessages: CONVERSATION } });
        const raw = await readRaw(base, { mode: 'tutor' });

        expect(got.shown).toEqual([]);
        expect(got.status).toBe(200);
        expect(got.body).toMatchObject({ success: true, message: 'An old-path reply.', model: 'old-model' });
        expect(raw.headers.get('content-type')).toBe('application/json; charset=utf-8');
        expect(llm.analyzeMentalHealth).toHaveBeenCalled();
        expect(agentChat.runStudentChat).not.toHaveBeenCalled();
    });
});

// Not parity: what the chat package adds, and how the page copes without it.
describeWithFramework('the chat package’s stream (new in R4)', () => {
    test('opens with the format and the run’s id, which is the run the body reports', async () => {
        ai();
        const raw = await readRaw(await listen(), { mode: 'tutor' });

        const [open] = raw.events;
        expect(open).toEqual({ event: 'open', data: { format: 1, runId: expect.any(String) } });
        const [result] = resultOf(raw.events);
        expect(result.data.body.debug.agentRunId).toBe(open.data.runId);
        statusEventsOf(raw.events).forEach(({ data }) => expect(data.runId).toBe(open.data.runId));
    });

    test('sends each visible step’s start and finish as a status, and the status line as activity', async () => {
        ai();
        const raw = await readRaw(await listen(), { mode: 'tutor' });

        const step = ({ data }) => [data.toolId ? `${data.agentId}/${data.toolId}` : data.agentId, data.status, data.state];
        expect(raw.events.filter(e => e.event === 'status').map(step)).toEqual([
            ['tracker', UNDERSTANDING, 'running'],
            ['tracker', UNDERSTANDING, 'done'],
            ['tutor', PLANNING, 'running'],
            ['tutor/course-context', FINDING, 'running'],
            ['tutor/course-context', FINDING, 'done'],
            ['tutor', PLANNING, 'done'],
            ['summariser', FINALIZING, 'running'],
            ['summariser', FINALIZING, 'done']
        ]);
        expect(raw.events.filter(e => e.event === 'activity').map(({ data }) => data.status))
            .toEqual([UNDERSTANDING, FINDING, PLANNING, FINALIZING]);
    });

    test('a step that fails is sent as failed, with no code or message', async () => {
        ai({ writer: () => ({ content: 'Not JSON. FAILURE-MARKER' }) });
        const raw = await readRaw(await listen(), { mode: 'tutor' });

        const failed = raw.events.filter(e => e.event === 'status' && e.data.state === 'failed');
        expect(failed).toEqual([{
            event: 'status',
            data: { runId: expect.any(String), agentId: 'summariser', label: LABELS[FINALIZING], status: FINALIZING, state: 'failed' }
        }]);
    });

    test('the student page gets the client as a classic script, from the installed package', async () => {
        const base = await listen();

        const response = await fetch(new URL('/vendor/agents-chat.js', base));

        expect(response.status).toBe(200);
        expect(response.headers.get('content-type')).toMatch(/javascript/);
        expect(await response.text()).toBe(require('fs').readFileSync(require.resolve('@ubc/genai-toolkit-agents-chat/client.global.js'), 'utf8'));
    });

    test('a request that fails is an error the page shows, not a stop', async () => {
        const page = await openPage(await listen());
        page.fetch = () => Promise.reject(new TypeError('Failed to fetch'));

        const got = await sendAsThePage(page, { mode: 'tutor' });

        expect(got).toEqual({ shown: [], error: 'Error' });
    });

    test('where the client doesn’t load, the page asks for JSON and gets the same reply, with no statuses', async () => {
        ai();
        const base = await listen();
        const page = await openPage(base, PAGE_SCRIPTS.filter(src => !src.startsWith('/vendor/')));

        const got = await sendAsThePage(page, { mode: 'tutor' });

        expect(got.shown).toEqual([]);
        expect(got.status).toBe(200);
        expect(stable(got.body)).toEqual(agentReplyBody({ mode: 'tutor' }));
    });
});
