/**
 * POST /api/chat on the agents framework path (agents framework PRD, Rung 2a).
 * It keeps the old handler's response shape and errors (decision 28), so these
 * mirror the old handler's tests in chat.additional.test.js.
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
jest.mock('../../../src/routes/llmKeyMiddleware', () => ({
    resolveCourseAi: jest.fn(),
    sendLlmKeyError: jest.fn(() => false)
}));

const express = require('express');
const { memoryDb } = require('../helpers/memory-db');
const { makeRouteApp, request } = require('../helpers/route-app');
const User = require('../../../src/models/User');
const MentalHealthFlag = require('../../../src/models/MentalHealthFlag');
const prompts = require('../../../src/services/prompts');
const Tracker = require('../../../src/services/tracker');
const { resolveCourseAi, sendLlmKeyError } = require('../../../src/routes/llmKeyMiddleware');
const agentChat = require('../../../src/services/agentChat');
const router = require('../../../src/routes/chat');

const describeWithFramework = agentChat.loadFramework() !== null ? describe : describe.skip;

const student = { userId: 's1', role: 'student', displayName: 'Student' };
const course = {
    courseId: 'C1',
    lectures: [{ name: 'Unit 1', isPublished: true }, { name: 'Unit 2', isPublished: false }],
    approvedStruggleTopics: ['Glycolysis']
};
const chunk = { lectureName: 'Unit 1', fileName: 'glycolysis.pdf', chunkText: 'Glycolysis takes place in the cytosol.', score: 0.9, documentType: 'lecture-notes' };
const PLAN = { approach: 'Guide them.', keyPoints: [{ point: 'It happens in the cytosol.', unit: 'Unit 1' }] };
const PROTEGE_PLAN = { verdict: 'incorrect', nextQuestion: 'Are you sure?' };
const json = value => ({ content: JSON.stringify(value), stopReason: 'stop', model: 'mock-model', usage: { total_tokens: 9 } });

function step(systemPrompt = '') {
    if (systemPrompt.includes('mental health concern detector') || systemPrompt.includes('COURSE MH PROMPT')) return 'mental-health';
    if (systemPrompt.includes('analyzing student struggle')) return 'tracker';
    if (systemPrompt.includes('PLANNING STEP')) return 'tutor';
    if (systemPrompt.includes('WRITING STEP')) return 'writer';
    if (systemPrompt.includes('summarize, recap')) return 'summary-check';
    if (systemPrompt.includes('recover after its output was rejected')) return 'recovery';
    return 'old-path';
}

function ai(answers = {}) {
    const defaults = {
        tracker: () => json({ isStruggling: false, mappedTopic: 'unmapped', matchConfidence: 0 }),
        tutor: options => json(options.systemPrompt.includes('confused student') ? PROTEGE_PLAN : PLAN),
        writer: () => json({ reply: 'An agent reply.' }),
        'mental-health': () => json({ concernLevel: 'no concern', reason: 'Ordinary study talk.' }),
        recovery: () => json({ retry: false, adjustment: '' }),
        'old-path': () => ({ content: 'An old-path reply.', model: 'old-model', usage: {} })
    };
    const llm = {
        sendMessage: jest.fn(async (message, options) => (answers[step(options.systemPrompt)] || defaults[step(options.systemPrompt)])(options)),
        analyzeMentalHealth: jest.fn().mockResolvedValue({ concernLevel: 'no concern' })
    };
    const qdrant = { searchDocuments: jest.fn().mockResolvedValue([chunk]) };
    resolveCourseAi.mockResolvedValueOnce({ llm, qdrant });
    const named = () => llm.sendMessage.mock.calls.map(([message, options]) => ({ name: step(options.systemPrompt), message, options }));
    // The steps the reply waits for. The mental-health check runs beside them.
    const steps = () => named().map(({ name }) => name).filter(name => name !== 'mental-health');
    const checkCalls = () => named().filter(({ name }) => name === 'mental-health');
    return { llm, qdrant, steps, checkCalls };
}

const app = (user = student) => makeRouteApp(router, { db: memoryDb({ courses: [course] }), user });
const post = (body, user) => request(app(user)).post('/').send({ courseId: 'C1', unitName: 'Unit 1', message: 'Where does glycolysis happen?', ...body });

const savedModes = process.env.AGENT_CHAT_MODES;
beforeAll(() => {
    jest.spyOn(console, 'log').mockImplementation(() => {});
    jest.spyOn(console, 'warn').mockImplementation(() => {});
    jest.spyOn(console, 'error').mockImplementation(() => {});
});
beforeEach(() => {
    process.env.AGENT_CHAT_MODES = 'tutor,explain,protege';
    resolveCourseAi.mockReset();
    sendLlmKeyError.mockReset().mockReturnValue(false);
    User.updateUserStruggleState.mockReset().mockResolvedValue({ success: true, state: { topic: 'Glycolysis', isActive: true } });
});
afterAll(() => {
    process.env.AGENT_CHAT_MODES = savedModes;
    jest.restoreAllMocks();
});

describe('the switch', () => {
    test('with AGENT_CHAT_MODES unset, every mode stays on the old handler', async () => {
        delete process.env.AGENT_CHAT_MODES;
        const { steps } = ai();

        const res = await post({ mode: 'tutor' });

        expect(res.status).toBe(200);
        expect(res.body.message).toBe('An old-path reply.');
        expect(steps()).toEqual(['old-path']);
    });

    test('it is set per mode', async () => {
        process.env.AGENT_CHAT_MODES = 'tutor';
        const { steps } = ai();

        const res = await post({ mode: 'protege' });

        expect(res.body.message).toBe('An old-path reply.');
        expect(steps()).toEqual(['old-path']);
    });
});

describeWithFramework.each([
    ['tutor', { mode: 'tutor' }],
    ['protege', { mode: 'protege' }],
    ['explain', { isExplanationRequest: true }]
])('%s mode on the agent path', (mode, body) => {
    test('returns the old handler’s response shape', async () => {
        const { steps } = ai();

        const res = await post(body);

        expect(res.status).toBe(200);
        expect(steps()).toEqual(['tracker', 'tutor', 'writer']);
        expect(res.body).toMatchObject({
            success: true,
            message: 'An agent reply.',
            model: 'mock-model',
            usage: { total_tokens: 9 },
            mode: body.mode || 'default',
            citations: [{ lectureName: 'Unit 1', fileName: 'glycolysis.pdf', score: 0.9 }],
            retrieval: { mode: 'single', lectureNames: ['Unit 1'], searchScope: ['Unit 1'] },
            struggleState: null,
            struggleDebug: { userExists: true, userId: 's1', directiveModeActive: false, identifiedTopic: null }
        });
        expect(Object.keys(res.body)).toEqual(expect.arrayContaining([
            'messageId', 'timestamp', 'sourceAttribution', 'debug'
        ]));
        expect(res.body.sourceAttribution).toMatchObject({ unitName: 'Unit 1' });
    });

    test('learning objectives reach both steps through the base prompt', async () => {
        const { llm } = ai();

        await post(body);

        const prompts = llm.sendMessage.mock.calls
            .filter(([, options]) => ['tutor', 'writer'].includes(step(options.systemPrompt)))
            .map(([, options]) => options.systemPrompt);
        expect(prompts).toHaveLength(2);
        prompts.forEach(prompt => expect(prompt).toContain('Explain where glycolysis happens'));
    });

    test('returns today’s error, not a saved reply, when the reply can’t be written (decision 28)', async () => {
        ai({ writer: () => ({ content: 'Not JSON.' }) });

        const res = await post(body);

        expect(res.status).toBe(500);
        expect(res.body).toMatchObject({ success: false, message: 'Sorry, I encountered an error processing your message.' });
    });

    test('a key error keeps its own response', async () => {
        const keyError = Object.assign(new Error('bad key'), { name: 'LlmKeyError', code: 'LLM_KEY_INVALID' });
        ai({ tracker: () => { throw keyError; }, tutor: () => { throw keyError; } });
        sendLlmKeyError.mockImplementation((res, error) => {
            res.status(403).json({ success: false, code: error.code });
            return true;
        });

        const res = await post(body);

        expect(res.status).toBe(403);
        expect(res.body).toEqual({ success: false, code: 'LLM_KEY_INVALID' });
    });
});

describeWithFramework('the agent path', () => {
    test('a struggle the tracker maps updates the state and turns on directive mode', async () => {
        const { llm } = ai({ tracker: () => json({ isStruggling: true, mappedTopic: 'Glycolysis', matchConfidence: 0.9 }) });

        const res = await post({ mode: 'tutor' });

        expect(User.updateUserStruggleState).toHaveBeenCalledWith(expect.anything(), 's1', expect.objectContaining({ topic: 'Glycolysis', isMapped: true }), 'C1');
        expect(res.body.struggleState).toEqual({ topic: 'Glycolysis', isActive: true });
        expect(res.body.struggleDebug).toMatchObject({ directiveModeActive: true, identifiedTopic: 'Glycolysis' });
        const tutorCall = llm.sendMessage.mock.calls.find(([, options]) => step(options.systemPrompt) === 'tutor');
        expect(JSON.parse(tutorCall[0]).toolResults['directive-state']).toMatchObject({ active: true });
    });

    test('an explanation with an approved topic updates the state without asking the model', async () => {
        const { steps } = ai();

        const res = await post({ isExplanationRequest: true, topic: 'glycolysis' });

        expect(steps()).toEqual(['tutor', 'writer']);
        expect(User.updateUserStruggleState).toHaveBeenCalledWith(expect.anything(), 's1', expect.objectContaining({ topic: 'Glycolysis', reason: 'User requested explanation' }), 'C1');
        expect(res.body.struggleState).toEqual({ topic: 'Glycolysis', isActive: true });
    });

    test('an explanation with a topic that is not approved changes nothing', async () => {
        const { steps } = ai();

        await post({ isExplanationRequest: true, topic: 'something else' });

        expect(steps()).toEqual(['tutor', 'writer']);
        expect(User.updateUserStruggleState).not.toHaveBeenCalled();
    });

    test('with no signed-in user, neither the struggle check nor the mental-health check runs', async () => {
        const { steps, checkCalls } = ai();

        const res = await post({ mode: 'tutor' }, null);

        expect(steps()).toEqual(['tutor', 'writer']);
        expect(checkCalls()).toEqual([]);
        expect(res.body.struggleDebug).toMatchObject({ userExists: false, trackerInitialized: false });
    });

    test('an unpublished unit is rejected before anything runs', async () => {
        const { llm } = ai();

        const res = await post({ mode: 'tutor', unitName: 'Unit 2' });

        expect(res.status).toBe(400);
        expect(llm.sendMessage).not.toHaveBeenCalled();
        expect(User.updateUserStruggleState).not.toHaveBeenCalled();
    });

    test('the summary check adds the reprompt line, as the old handler does', async () => {
        ai({ 'summary-check': () => json({ isSummaryAttempt: false }) });

        const res = await post({ mode: 'tutor', checkSummaryAttempt: true });

        expect(res.body.message).toBe(`An agent reply.${agentChat.REPROMPT_TEXT}`);
    });

    test('the old handler’s tracker and mental-health check do not run', async () => {
        const { llm } = ai();

        await post({ mode: 'tutor' });

        expect(llm.analyzeMentalHealth).not.toHaveBeenCalled();
        expect(Tracker).not.toHaveBeenCalled();
    });
});

// The mental-health check (2b). Every message and reason below is made up.
const CONVERSATION = Object.freeze([
    { role: 'assistant', content: "I'm BiocBot in Tutor Mode. We're discussing Unit 1 this week. How can I help you today?" },
    { role: 'user', content: 'Where does glycolysis happen?' },
    { role: 'assistant', content: 'In the cytosol.' },
    { role: 'user', content: 'ok. lately I feel like a burden to everyone around me.' }
]);
const DISTRESS = CONVERSATION[3].content;
// The last assistant message, then the last two student messages.
const TRIMMED = [CONVERSATION[2], CONVERSATION[1], CONVERSATION[3]];
const CONCERN = Object.freeze({ concernLevel: 'high concern', reason: 'A made-up reason for a test.' });
const withHistory = body => ({ message: DISTRESS, conversationContext: { conversationMessages: CONVERSATION }, ...body });
const flagFields = Object.freeze({
    studentId: 's1',
    studentName: 'Student',
    courseId: 'C1',
    unitName: 'Unit 1',
    message: DISTRESS,
    conversationContext: TRIMMED,
    concernLevel: 'high concern',
    llmReason: CONCERN.reason
});

/** Retries an assertion until it passes, for the old check, which nothing can wait on. */
async function eventually(assertion) {
    for (let attempt = 0; attempt < 100; attempt += 1) {
        try {
            assertion();
            return;
        } catch {
            await new Promise(resolve => setTimeout(resolve, 5));
        }
    }
    assertion();
}

// These don't need the framework, so they also run in CI, where it isn't installed.
describe('the old path keeps the old mental-health check (staging and production)', () => {
    beforeEach(() => {
        MentalHealthFlag.createMentalHealthFlag.mockReset().mockResolvedValue({ success: true });
    });

    test('with AGENT_CHAT_MODES unset, the old check runs and still saves a flag', async () => {
        delete process.env.AGENT_CHAT_MODES;
        const { llm, steps } = ai();
        llm.analyzeMentalHealth.mockResolvedValue(CONCERN);

        const res = await post(withHistory({ mode: 'tutor' }));

        expect(res.status).toBe(200);
        expect(res.body.message).toBe('An old-path reply.');
        expect(steps()).toEqual(['old-path']);
        expect(llm.analyzeMentalHealth).toHaveBeenCalledTimes(1);
        expect(llm.analyzeMentalHealth).toHaveBeenCalledWith(TRIMMED, prompts.DEFAULT_MENTAL_HEALTH_DETECTION_PROMPT);
        await eventually(() => expect(MentalHealthFlag.createMentalHealthFlag).toHaveBeenCalledWith(expect.anything(), flagFields));
        expect(MentalHealthFlag.createMentalHealthFlag).toHaveBeenCalledTimes(1);
    });

    test('a mode that isn’t switched on keeps the old check too', async () => {
        process.env.AGENT_CHAT_MODES = 'tutor';
        const { llm } = ai();
        llm.analyzeMentalHealth.mockResolvedValue(CONCERN);

        const res = await post(withHistory({ mode: 'protege' }));

        expect(res.body.message).toBe('An old-path reply.');
        expect(llm.analyzeMentalHealth).toHaveBeenCalledTimes(1);
        await eventually(() => expect(MentalHealthFlag.createMentalHealthFlag).toHaveBeenCalledWith(expect.anything(), flagFields));
    });
});

/** The chat route with a preview request, as src/middleware/auth.js marks one. */
function previewApp() {
    const previewer = express();
    previewer.use(express.json());
    previewer.locals.db = memoryDb({ courses: [course] });
    previewer.use((req, res, next) => {
        req.user = student;
        req.preview = { active: true };
        next();
    });
    previewer.use('/', router);
    return previewer;
}

describeWithFramework('the mental-health check on the agent path', () => {
    // The route doesn't wait for the check, so the tests wait on the run's asyncDone.
    const runStudentChat = agentChat.runStudentChat;
    let runs = [];
    const checksDone = () => Promise.all(runs);
    beforeEach(() => {
        runs = [];
        jest.spyOn(agentChat, 'runStudentChat').mockImplementation(async options => {
            const outcome = await runStudentChat(options);
            runs.push(outcome.run.asyncDone);
            return outcome;
        });
        MentalHealthFlag.createMentalHealthFlag.mockReset().mockResolvedValue({ success: true });
    });
    afterEach(() => agentChat.runStudentChat.mockRestore());

    test.each([
        ['tutor', { mode: 'tutor' }],
        ['protege', { mode: 'protege' }],
        ['explain', { isExplanationRequest: true }]
    ])('%s mode runs it as an agent instead of the old check, and a concern saves a flag', async (_, body) => {
        const { llm, steps, checkCalls } = ai({ 'mental-health': () => json(CONCERN) });

        const res = await post(withHistory(body));
        await checksDone();

        expect(res.status).toBe(200);
        expect(res.body.message).toBe('An agent reply.');
        expect(steps()).toEqual(['tracker', 'tutor', 'writer']);
        expect(llm.analyzeMentalHealth).not.toHaveBeenCalled();
        expect(checkCalls()).toHaveLength(1);
        expect(checkCalls()[0].options).toMatchObject({ lane: 'backend', temperature: 0.1, maxTokens: 256, responseFormat: 'json' });
        expect(MentalHealthFlag.createMentalHealthFlag).toHaveBeenCalledTimes(1);
        expect(MentalHealthFlag.createMentalHealthFlag).toHaveBeenCalledWith(expect.anything(), flagFields);
        expect(console.log).toHaveBeenCalledWith('🧾 [AGENT_AUDIT] mental-health-check/mental-health-flag completed');
    });

    test('reads and saves the same trimmed conversation as the old check, with the same prompt', async () => {
        delete process.env.AGENT_CHAT_MODES;
        const old = ai();
        old.llm.analyzeMentalHealth.mockResolvedValue(CONCERN);
        await post(withHistory({ mode: 'tutor' }));
        await eventually(() => expect(MentalHealthFlag.createMentalHealthFlag).toHaveBeenCalledTimes(1));
        const [oldContext, oldPrompt] = old.llm.analyzeMentalHealth.mock.calls[0];
        const oldFlag = MentalHealthFlag.createMentalHealthFlag.mock.calls[0][1];

        process.env.AGENT_CHAT_MODES = 'tutor';
        MentalHealthFlag.createMentalHealthFlag.mockClear();
        const agent = ai({ 'mental-health': () => json(CONCERN) });
        await post(withHistory({ mode: 'tutor' }));
        await checksDone();

        const [call] = agent.checkCalls();
        expect(call.options.systemPrompt).toBe(oldPrompt);
        expect(JSON.parse(call.message)).toEqual({
            message: DISTRESS,
            toolResults: { 'mental-health-context': agentChat.serializeConversation(oldContext) }
        });
        expect(MentalHealthFlag.createMentalHealthFlag.mock.calls[0][1]).toEqual(oldFlag);
    });

    test('a course’s own detection prompt reaches the agent', async () => {
        const { checkCalls } = ai();
        const ownPrompt = 'COURSE MH PROMPT: return JSON with concernLevel and reason.';
        const db = memoryDb({ courses: [{ ...course, mentalHealthDetectionPrompt: ownPrompt }] });

        await request(makeRouteApp(router, { db, user: student })).post('/')
            .send({ courseId: 'C1', unitName: 'Unit 1', ...withHistory({ mode: 'tutor' }) });
        await checksDone();

        expect(checkCalls()[0].options.systemPrompt).toBe(ownPrompt);
    });

    test('"no concern" saves no flag', async () => {
        const { checkCalls } = ai();

        await post(withHistory({ mode: 'tutor' }));
        await checksDone();

        expect(checkCalls()).toHaveLength(1);
        expect(MentalHealthFlag.createMentalHealthFlag).not.toHaveBeenCalled();
    });

    test.each([
        ['invalid JSON', () => ({ content: 'The student seems fine to me.' }), 'invalid_json'],
        ['a missing concernLevel', () => json({ reason: 'No level given.' }), 'output_mismatch'],
        ['a model error', () => { throw new Error('Model unavailable'); }, 'llm_failed']
    ])('%s saves no flag, is logged as a failure, and leaves the reply alone', async (_, answer, code) => {
        ai({ 'mental-health': answer });

        const res = await post(withHistory({ mode: 'tutor' }));
        await checksDone();

        expect(res.status).toBe(200);
        expect(res.body.message).toBe('An agent reply.');
        expect(MentalHealthFlag.createMentalHealthFlag).not.toHaveBeenCalled();
        expect(console.error).toHaveBeenCalledWith(expect.stringContaining(`agent.failed mental-health-check ${code}`));
    });

    test('the reply doesn’t wait for the check, and the flag is saved after it', async () => {
        let answer;
        const { checkCalls } = ai({ 'mental-health': () => new Promise(resolve => { answer = resolve; }) });

        const res = await post(withHistory({ mode: 'tutor' }));

        expect(res.status).toBe(200);
        expect(res.body.message).toBe('An agent reply.');
        expect(checkCalls()).toHaveLength(1);
        expect(MentalHealthFlag.createMentalHealthFlag).not.toHaveBeenCalled();

        answer(json(CONCERN));
        await checksDone();
        expect(MentalHealthFlag.createMentalHealthFlag).toHaveBeenCalledWith(expect.anything(), flagFields);
    });

    test('a preview runs the check, and the framework blocks the flag', async () => {
        const { checkCalls } = ai({ 'mental-health': () => json(CONCERN) });

        const res = await request(previewApp()).post('/').send({ courseId: 'C1', unitName: 'Unit 1', ...withHistory({ mode: 'tutor' }) });
        await checksDone();

        expect(res.status).toBe(200);
        expect(checkCalls()).toHaveLength(1);
        expect(MentalHealthFlag.createMentalHealthFlag).not.toHaveBeenCalled();
        expect(console.log).toHaveBeenCalledWith('🧾 [AGENT_AUDIT] mental-health-check/mental-health-flag blocked');
    });
});

/** Splits a server-sent event body into { event, data } frames. */
function parseEvents(text) {
    return text.split('\n\n').filter(Boolean).map(frame => {
        const event = (frame.match(/^event: (.*)$/m) || [])[1];
        const data = (frame.match(/^data: (.*)$/m) || [])[1];
        return { event, data: data && JSON.parse(data) };
    });
}

const streamed = (body, user) => post(body, user)
    .set('Accept', 'text/event-stream, application/json')
    .buffer(true)
    .parse((res, done) => {
        let text = '';
        res.setEncoding('utf8');
        res.on('data', chunk => { text += chunk; });
        res.on('end', () => done(null, text));
    });

describeWithFramework('progress streamed to the chat page', () => {
    test('sends each step’s status, then the usual response as the result', async () => {
        ai();

        const res = await streamed({ mode: 'tutor' });

        expect(res.status).toBe(200);
        expect(res.headers['content-type']).toContain('text/event-stream');
        const events = parseEvents(res.body);
        expect(events.filter(e => e.event === 'progress').map(e => e.data.status)).toEqual([
            agentChat.PROGRESS.tracker.status,
            agentChat.PROGRESS.courseSearch.status,
            agentChat.PROGRESS.tutor.status,
            agentChat.PROGRESS.writer.status
        ]);
        const result = events.at(-1);
        expect(result.event).toBe('result');
        expect(result.data.status).toBe(200);
        expect(result.data.body).toMatchObject({ success: true, message: 'An agent reply.', citations: [expect.any(Object)] });
    });

    test('an error after the stream starts comes back as the result, with its status', async () => {
        ai({ writer: () => ({ content: 'Not JSON.' }) });

        const res = await streamed({ mode: 'tutor' });

        const result = parseEvents(res.body).at(-1);
        expect(result).toEqual({
            event: 'result',
            data: { status: 500, body: expect.objectContaining({ success: false, message: 'Sorry, I encountered an error processing your message.' }) }
        });
    });

    test('a retrieval failure after the stream starts comes back as an error result', async () => {
        const { qdrant } = ai();
        qdrant.searchDocuments.mockRejectedValue(new Error('Service endpoint unreachable'));

        const res = await streamed({ mode: 'tutor' });

        const result = parseEvents(res.body).at(-1);
        expect(result.event).toBe('result');
        expect(result.data.status).toBeGreaterThanOrEqual(400);
        expect(result.data.body.success).toBe(false);
    });

    test('an unpublished unit is still a plain 400, before any stream', async () => {
        ai();

        const res = await streamed({ mode: 'tutor', unitName: 'Unit 2' });

        expect(res.status).toBe(400);
        expect(res.headers['content-type']).toContain('application/json');
    });

    test('the old path ignores the header and answers with JSON', async () => {
        delete process.env.AGENT_CHAT_MODES;
        ai();

        const res = await post({ mode: 'tutor' }).set('Accept', 'text/event-stream, application/json');

        expect(res.headers['content-type']).toContain('application/json');
        expect(res.body.message).toBe('An old-path reply.');
    });
});
