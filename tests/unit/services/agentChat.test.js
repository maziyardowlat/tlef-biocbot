/**
 * The agent chat path (agents framework PRD, Rung 2a) with a mocked model and
 * BiocBot's real default prompts. The framework comes from GitHub Packages, so
 * an install without a registry token skips the tests that run it.
 */
const agentChat = require('../../../src/services/agentChat');
const prompts = require('../../../src/services/prompts');

const frameworkInstalled = agentChat.loadFramework() !== null;
const describeWithFramework = frameworkInstalled ? describe : describe.skip;

const COURSE_CONTEXT = 'From Unit 1 (glycolysis.pdf):\nGlycolysis takes place in the cytosol and nets 2 ATP.';
const json = value => ({ content: JSON.stringify(value), stopReason: 'stop', model: 'mock-model', usage: { total_tokens: 7 } });

const PLAN = { approach: 'Guide them.', keyPoints: [{ point: 'Glycolysis nets 2 ATP.', unit: 'Unit 1' }], coverage: '', style: '', nextQuestion: 'Why?' };
const PROTEGE_PLAN = { verdict: 'incorrect', whatTheyGotRight: '', confusionToVoice: 'Where does it happen?', nextQuestion: 'Are you sure it is the mitochondria?' };

function step(systemPrompt) {
    if (systemPrompt.includes('mental health concern detector') || systemPrompt.includes('COURSE MH PROMPT')) return 'mental-health';
    if (systemPrompt.includes('analyzing student struggle')) return 'tracker';
    if (systemPrompt.includes('PLANNING STEP')) return 'tutor';
    if (systemPrompt.includes('WRITING STEP')) return 'writer';
    if (systemPrompt.includes('summarize, recap')) return 'summary-check';
    if (systemPrompt.includes('recover after its output was rejected')) return 'recovery';
    return 'unknown';
}

/** A model that answers by step, and keeps every call. */
function mockModel(answers = {}) {
    const calls = [];
    const defaults = {
        tracker: () => json({ isStruggling: false, mappedTopic: 'unmapped', matchConfidence: 0 }),
        tutor: (options) => json(options.systemPrompt.includes('confused student') ? PROTEGE_PLAN : PLAN),
        writer: () => json({ reply: 'A reply.' }),
        'summary-check': () => json({ isSummaryAttempt: true }),
        'mental-health': () => json({ concernLevel: 'no concern', reason: 'Ordinary study talk.' }),
        recovery: () => json({ retry: true, adjustment: 'Return only the JSON object.' })
    };
    const llm = {
        sendMessage: jest.fn(async (message, options) => {
            const name = step(options.systemPrompt);
            calls.push({ step: name, message: JSON.parse(message), options });
            const answer = answers[name] || defaults[name];
            if (!answer) throw new Error(`No answer for ${name}`);
            return answer(options, calls.filter(call => call.step === name).length);
        })
    };
    const callsTo = name => calls.filter(call => call.step === name);
    return { llm, calls, callsTo };
}

function setUp(overrides = {}) {
    let directive = { active: false };
    const struggles = [];
    const retrieve = jest.fn(async () => ({ contextText: COURSE_CONTEXT, coverageNote: 'The course context below only includes material from: Unit 1.' }));
    const options = {
        mode: 'tutor',
        message: 'Where does glycolysis happen?',
        history: [],
        coursePrompts: { ...prompts.DEFAULT_PROMPTS },
        runTracker: true,
        trackerContext: { courseId: 'C1', unitName: 'Unit 1', approvedTopics: ['Glycolysis'] },
        retrieve,
        recordStruggle: jest.fn(async analysis => {
            struggles.push(analysis.topic);
            directive = { active: true, topic: analysis.topic };
        }),
        directiveState: () => directive,
        ...overrides
    };
    return { options, retrieve, struggles };
}

beforeAll(() => {
    jest.spyOn(console, 'log').mockImplementation(() => {});
});
afterAll(() => jest.restoreAllMocks());

describe('which requests take the agent path', () => {
    test('an explanation request uses the explain prompts, even in protégé mode', () => {
        expect(agentChat.resolveAgentMode({ mode: 'protege', isExplanationRequest: true })).toBe('explain');
        expect(agentChat.resolveAgentMode({ mode: 'protege' })).toBe('protege');
        expect(agentChat.resolveAgentMode({})).toBe('tutor');
        expect(agentChat.resolveAgentMode({ mode: 'anything' })).toBe('tutor');
    });

    test('it is off unless AGENT_CHAT_MODES names the mode', () => {
        expect(agentChat.isAgentChatEnabled('tutor', {})).toBe(false);
        expect(agentChat.isAgentChatEnabled('protege', { AGENT_CHAT_MODES: 'tutor' })).toBe(false);
        expect(agentChat.isAgentChatEnabled('summary', { AGENT_CHAT_MODES: 'summary' })).toBe(false);
        expect(agentChat.isAgentChatEnabled('explain', { AGENT_CHAT_MODES: ' Tutor , explain' })).toBe(frameworkInstalled);
    });
});

describe('mending math that parsed wrong (PRD section 7.4, second finding)', () => {
    const raw = String.raw;
    test.each([
        ['\\? for \\)? inside open math', raw`Is it \( x^2 \? Yes.`, raw`Is it \( x^2 \)? Yes.`],
        ['a closed bracket before ? is left alone', raw`Is it \( x^2 \)? Yes.`, raw`Is it \( x^2 \)? Yes.`],
        ['\\? outside math is left alone', raw`What \? means`, raw`What \? means`],
        ['a doubled backslash in SMILES', raw`[SMILES]OC(=O)/C=C\\C(=O)O[/SMILES]`, raw`[SMILES]OC(=O)/C=C\C(=O)O[/SMILES]`],
        ['a doubled backslash in an untagged SMILES string', raw`maleate is OC(=O)/C=C\\C(=O)O.`, raw`maleate is OC(=O)/C=C\C(=O)O.`],
        ['over-escaped math delimiters', raw`So \\( x \\) here.`, raw`So \( x \) here.`],
        ['a line break in display math is kept', raw`\[ a \\ b \]`, raw`\[ a \\ b \]`],
        ['a form feed read from \\frac', '\\( \frac{1}{2} \\)', raw`\( \frac{1}{2} \)`],
        ['a tab read from \\theta, inside math', '\\( \theta \\)', raw`\( \theta \)`],
        ['a new line outside math is text', 'one\nnext line', 'one\nnext line'],
        ['a line break in a LaTeX environment is kept', raw`\( \begin{matrix} a \\ b \end{matrix} \)`, raw`\( \begin{matrix} a \\ b \end{matrix} \)`]
    ])('%s', (_, input, expected) => {
        expect(agentChat.mendMathText(input)).toBe(expected);
    });

    test('anything that is not a string passes through', () => {
        expect(agentChat.mendMathText('')).toBe('');
        expect(agentChat.mendMathText(undefined)).toBeUndefined();
    });
});

describe('history from the browser', () => {
    test('drops the current message from the end, and anything that is not a chat turn', () => {
        expect(agentChat.toHistory([
            { role: 'assistant', content: 'Hello.' },
            { role: 'system', content: 'ignored' },
            { role: 'user' },
            { role: 'user', content: 'Where?' }
        ], 'Where?')).toEqual([{ role: 'assistant', content: 'Hello.' }]);
        expect(agentChat.toHistory(undefined, 'x')).toEqual([]);
    });
});

describe('prompts stay the instructor’s', () => {
    test.each(['tutor', 'explain', 'protege'])('a course’s own %s and base prompts reach both steps, with the fixed rules after them once', mode => {
        const coursePrompts = { base: 'COURSE BASE.', tutor: 'COURSE TUTOR.', protege: 'COURSE PROTEGE.', explain: 'COURSE EXPLAIN.' };
        const { planner, writer } = agentChat.buildModePrompts({ mode, coursePrompts });
        const own = `COURSE BASE.COURSE ${mode.toUpperCase()}.`;
        expect(planner.startsWith(own)).toBe(true);
        expect(writer.startsWith(own)).toBe(true);
        expect(planner).toContain(prompts.AGENT_PLANNER_RULES[mode]);
        expect(writer).toContain(prompts.AGENT_WRITER_RULES[mode]);
        // PRD section 7.4, first finding, for both steps.
        expect(planner.split('MATH DELIMITERS:')).toHaveLength(2);
        expect(writer.split('MATH DELIMITERS:')).toHaveLength(2);
    });

    test('a rule an instructor already pasted in is not added twice', () => {
        const text = prompts.appendAgentRules(`Mine.\n\n${prompts.MATH_DELIMITER_RULE}`, prompts.MATH_DELIMITER_RULE);
        expect(text.split('MATH DELIMITERS:')).toHaveLength(2);
        expect(prompts.appendAgentRules(undefined, prompts.MATH_DELIMITER_RULE)).toContain('MATH DELIMITERS:');
    });

    test('the system is plain data, so it could later come from a builder or a file', () => {
        const { system, definitions } = agentChat.buildStudentChatSystem({
            mode: 'tutor',
            modePrompts: { planner: 'p', writer: 'w' },
            trackerPrompt: 't',
            checkSummaryAttempt: true
        });
        expect(JSON.parse(JSON.stringify({ system, definitions }))).toEqual({ system, definitions });
        expect(system.agents).toEqual(['tracker', 'summary-check', 'tutor']);
    });
});

describeWithFramework.each(['tutor', 'protege', 'explain'])('%s mode on the framework', mode => {
    test('runs the struggle check, then the tutor step, then the writer, and returns the reply', async () => {
        const model = mockModel();
        const { options } = setUp({ mode, llm: model.llm });

        const outcome = await agentChat.runStudentChat(options);

        expect(outcome.run.usedFallback).toBe(false);
        expect(outcome.reply).toBe('A reply.');
        expect(model.calls.map(call => call.step)).toEqual(['tracker', 'tutor', 'writer']);
        expect(outcome.replyCall).toEqual({ model: 'mock-model', usage: { total_tokens: 7 } });
    });

    test('keeps each step on its lane, with JSON mode on', async () => {
        const model = mockModel();
        const { options } = setUp({ mode, llm: model.llm });

        await agentChat.runStudentChat(options);

        expect(model.callsTo('tracker')[0].options).toMatchObject({ lane: 'backend', maxTokens: 220, responseFormat: 'json' });
        expect(model.callsTo('tutor')[0].options).toMatchObject({ lane: 'frontend', responseFormat: 'json' });
        expect(model.callsTo('writer')[0].options).toMatchObject({ lane: 'frontend', maxTokens: 32768, temperature: 0.5, responseFormat: 'json' });
    });

    test('works with a recap as the first message and no history (decision 29)', async () => {
        const model = mockModel();
        const { options } = setUp({ mode, llm: model.llm, message: 'Last time I asked about glycolysis.', history: undefined });

        const outcome = await agentChat.runStudentChat(options);

        expect(outcome.reply).toBe('A reply.');
        expect(model.callsTo('writer')[0].message.history).toEqual([]);
    });

    test('continues a cut-off reply at the temperature the mode used before', async () => {
        const model = mockModel({
            writer: (options, count) => (count === 1
                ? { content: '{"reply":"The start of it', stopReason: 'length' }
                : json({ reply: ' and the rest.' }))
        });
        const { options } = setUp({ mode, llm: model.llm });

        const outcome = await agentChat.runStudentChat(options);

        expect(outcome.reply).toBe('The start of it and the rest.');
        // The response reports the call that finished the reply, as the old handler does.
        expect(outcome.run.modelCalls.summariser).toHaveLength(2);
        expect(outcome.replyCall).toEqual({ model: 'mock-model', usage: { total_tokens: 7 } });
        const continued = model.callsTo('writer')[1];
        expect(continued.options.temperature).toBe(mode === 'protege' ? 0.8 : 0.6);
        expect(continued.message.continuation).toEqual({
            instructions: prompts.AGENT_CONTINUATION_INSTRUCTIONS,
            tail: 'The start of it'
        });
    });

    test('mends math the model damaged before it reaches the student', async () => {
        const model = mockModel({ writer: () => ({ content: String.raw`{"reply":"So \( \Delta G < 0 \? Yes."}`, stopReason: 'stop' }) });
        const { options } = setUp({ mode, llm: model.llm });

        const outcome = await agentChat.runStudentChat(options);

        expect(outcome.reply).toBe(String.raw`So \( \Delta G < 0 \)? Yes.`);
    });

    test('tries a bad reply again once, then falls back', async () => {
        const model = mockModel({ writer: () => ({ content: 'Not JSON.' }) });
        const { options } = setUp({ mode, llm: model.llm });

        const outcome = await agentChat.runStudentChat(options);

        expect(outcome.run.usedFallback).toBe(true);
        expect(model.callsTo('writer')).toHaveLength(2);
        expect(model.callsTo('writer')[1].message.recovery).toMatchObject({ attempt: 1, adjustment: 'Return only the JSON object.' });
    });

    test('does not write a reply without the tutor step, and retrieves only once', async () => {
        const model = mockModel({ tutor: () => ({ content: '{"nothing": true}' }) });
        const { options, retrieve } = setUp({ mode, llm: model.llm });

        const outcome = await agentChat.runStudentChat(options);

        expect(outcome.run.usedFallback).toBe(true);
        expect(model.callsTo('tutor')).toHaveLength(2);
        expect(model.callsTo('writer')).toHaveLength(0);
        expect(retrieve).toHaveBeenCalledTimes(1);
    });

    test('a key error is reported and not retried', async () => {
        const keyError = Object.assign(new Error('bad key'), { name: 'LlmKeyError', code: 'LLM_KEY_INVALID' });
        const model = mockModel({ tutor: () => { throw keyError; } });
        const { options } = setUp({ mode, llm: model.llm });

        const outcome = await agentChat.runStudentChat(options);

        expect(outcome.run.usedFallback).toBe(true);
        expect(outcome.accessError).toBe(keyError);
        expect(outcome.failureCause).toBe(keyError);
        expect(model.callsTo('tutor')).toHaveLength(1);
    });

    test('still replies when the struggle check fails', async () => {
        const model = mockModel({ tracker: () => ({ content: 'Not JSON.' }) });
        const { options, struggles } = setUp({ mode, llm: model.llm });

        const outcome = await agentChat.runStudentChat(options);

        expect(outcome.run.usedFallback).toBe(false);
        expect(struggles).toEqual([]);
    });
});

describeWithFramework('directive mode', () => {
    const struggling = { tracker: () => json({ isStruggling: true, mappedTopic: 'glycolysis', matchConfidence: 0.9 }) };

    test('reaches the tutor step in tutor mode, through a tool, with the course’s directive prompt', async () => {
        const model = mockModel(struggling);
        const { options, struggles } = setUp({ llm: model.llm, coursePrompts: { ...prompts.DEFAULT_PROMPTS, directive: 'COURSE DIRECTIVE.' } });

        await agentChat.runStudentChat(options);

        expect(struggles).toEqual(['Glycolysis']);
        const directive = model.callsTo('tutor')[0].message.toolResults['directive-state'];
        expect(directive).toMatchObject({ active: true, topic: 'Glycolysis' });
        expect(directive.instructions).toContain('Switch to DIRECTIVE MODE');
        expect(directive.instructions).toContain('COURSE DIRECTIVE.');
    });

    test.each(['protege', 'explain'])('stays out of %s mode', async mode => {
        const model = mockModel(struggling);
        const { options, struggles } = setUp({ mode, llm: model.llm });

        await agentChat.runStudentChat(options);

        expect(struggles).toEqual(['Glycolysis']);
        expect(model.callsTo('tutor')[0].message.toolResults['directive-state']).toBeUndefined();
    });

    test('an unapproved or unsure topic writes nothing', async () => {
        const model = mockModel({ tracker: () => json({ isStruggling: true, mappedTopic: 'Glycolysis', matchConfidence: 0.3 }) });
        const { options, struggles } = setUp({ llm: model.llm });

        await agentChat.runStudentChat(options);

        expect(struggles).toEqual([]);
        expect(model.callsTo('tutor')[0].message.toolResults['directive-state']).toEqual({ active: false });
    });

    test('still updates the struggle state in a preview, so an instructor sees directive mode (decision 21)', async () => {
        const model = mockModel(struggling);
        const { options, struggles } = setUp({ llm: model.llm, preview: true });

        await agentChat.runStudentChat(options);

        expect(struggles).toEqual(['Glycolysis']);
    });
});

describeWithFramework('protégé mode keeps the answers from the writer (decision 27)', () => {
    test('only the tutor step reads the course material', async () => {
        const model = mockModel();
        const { options } = setUp({ mode: 'protege', llm: model.llm });

        await agentChat.runStudentChat(options);

        expect(JSON.stringify(model.callsTo('tutor')[0].message)).toContain('cytosol');
        const writer = model.callsTo('writer')[0];
        expect(JSON.stringify(writer.message)).not.toContain('cytosol');
        expect(writer.message.agentResults.tutor).toEqual(PROTEGE_PLAN);
        // The persona is in the writer's instructions, in every mode.
        expect(writer.options.systemPrompt).toContain(prompts.DEFAULT_PROMPTS.protege);
    });
});

describeWithFramework('an explanation with an approved topic', () => {
    test('skips the struggle check when the route says so', async () => {
        const model = mockModel();
        const { options } = setUp({ mode: 'explain', llm: model.llm, runTracker: false });

        await agentChat.runStudentChat(options);

        expect(model.calls.map(call => call.step)).toEqual(['tutor', 'writer']);
    });
});

describeWithFramework('the summary check', () => {
    test('does not run unless the client asks', async () => {
        const model = mockModel();
        const { options } = setUp({ llm: model.llm });

        await agentChat.runStudentChat(options);

        expect(model.callsTo('summary-check')).toHaveLength(0);
    });

    test('adds the reprompt line when the message was not a summary', async () => {
        const model = mockModel({ 'summary-check': () => json({ isSummaryAttempt: false }) });
        const { options } = setUp({ llm: model.llm, checkSummaryAttempt: true });

        const outcome = await agentChat.runStudentChat(options);

        expect(outcome.reply).toBe(`A reply.${agentChat.REPROMPT_TEXT}`);
        expect(model.callsTo('summary-check')[0].options).toMatchObject({ lane: 'backend', responseFormat: 'json' });
    });

    test.each([
        ['was a summary', () => json({ isSummaryAttempt: true })],
        ['failed', () => ({ content: 'Not JSON.' })]
    ])('adds nothing when the check %s', async (_, answer) => {
        const model = mockModel({ 'summary-check': answer });
        const { options } = setUp({ llm: model.llm, checkSummaryAttempt: true });

        const outcome = await agentChat.runStudentChat(options);

        expect(outcome.reply).toBe('A reply.');
    });
});

describeWithFramework('progress for the student (shown while they wait)', () => {
    test('reports each visible step as it starts, in order', async () => {
        const model = mockModel();
        const updates = [];
        const { options } = setUp({ llm: model.llm, onProgress: update => updates.push(update) });

        await agentChat.runStudentChat(options);

        expect(updates.map(({ step, status }) => [step, status])).toEqual([
            ['tracker', agentChat.PROGRESS.tracker.status],
            ['tutor', agentChat.PROGRESS.courseSearch.status],
            ['tutor', agentChat.PROGRESS.tutor.status],
            ['summariser', agentChat.PROGRESS.writer.status]
        ]);
    });

    test('keeps the same order without the struggle check', async () => {
        const model = mockModel();
        const updates = [];
        const { options } = setUp({ llm: model.llm, runTracker: false, onProgress: update => updates.push(update.status) });

        await agentChat.runStudentChat(options);

        expect(updates).toEqual([
            agentChat.PROGRESS.courseSearch.status,
            agentChat.PROGRESS.tutor.status,
            agentChat.PROGRESS.writer.status
        ]);
    });

    test('the writer status is on the summariser config', () => {
        const { system } = agentChat.buildStudentChatSystem({
            mode: 'tutor', modePrompts: { planner: 'p', writer: 'w' }, trackerPrompt: 't'
        });
        expect(system.summariser.progress).toBe(agentChat.PROGRESS.writer);
    });

    test('a listener that throws does not change the reply', async () => {
        const model = mockModel();
        const { options } = setUp({ llm: model.llm, onProgress: () => { throw new Error('broken listener'); } });

        const outcome = await agentChat.runStudentChat(options);

        expect(outcome.run.usedFallback).toBe(false);
        expect(outcome.reply).toBe('A reply.');
    });

    test('the summary check stays out of view', () => {
        const { system } = agentChat.buildStudentChatSystem({
            mode: 'tutor', modePrompts: { planner: 'p', writer: 'w' }, trackerPrompt: 't', checkSummaryAttempt: true
        });
        expect(system.visibleAgents).toEqual(['tracker', 'tutor', 'summariser']);
    });
});

// The mental-health check (2b). Every message and reason below is made up.
const LLMService = require('../../../src/services/llm');

const MH_PROMPT = prompts.DEFAULT_MENTAL_HEALTH_DETECTION_PROMPT;
const CONVERSATION = Object.freeze([
    { role: 'assistant', content: "I'm BiocBot in Tutor Mode. We're discussing Unit 1 this week. How can I help you today?" },
    { role: 'user', content: 'What does PFK-1 do in glycolysis?' },
    { role: 'assistant', content: 'It catalyses the committed step.' },
    { role: 'user', content: 'Thanks. Honestly I have not slept properly in days and nothing seems worth it.' }
]);
const CURRENT = CONVERSATION[3].content;
// The last assistant message, then the last two student messages.
const TRIMMED = [CONVERSATION[2], CONVERSATION[1], CONVERSATION[3]];
const IDENTIFIERS = Object.freeze({ courseId: 'C1', unitName: 'Unit 1', userId: 's1', studentName: 'Test Student' });
const CONCERN = Object.freeze({ concernLevel: 'high concern', reason: 'A made-up reason for a test.' });
const CHECK_DEFINITION = Object.freeze({
    id: 'mental-health-check',
    version: '1.0.0',
    mode: 'async',
    prompt: MH_PROMPT,
    outputSchema: {
        type: 'object',
        required: ['concernLevel', 'reason'],
        properties: {
            concernLevel: { type: 'string', enum: ['no concern', 'low concern', 'high concern'] },
            reason: { type: 'string' }
        }
    },
    llmOptions: { lane: 'backend', temperature: 0.1, maxTokens: 256, responseFormat: 'json' },
    timeoutMs: 60000,
    tools: { reads: ['mental-health-context'], writes: ['mental-health-flag'] }
});

/** setUp, plus the check, run for a signed-in student with a conversation so far. */
function withCheck(overrides = {}) {
    const saveFlag = jest.fn(async () => ({ success: true }));
    const setup = setUp({
        message: CURRENT,
        history: CONVERSATION,
        identifiers: IDENTIFIERS,
        mentalHealthCheck: { prompt: MH_PROMPT, conversationMessages: CONVERSATION, saveFlag },
        ...overrides
    });
    return { ...setup, saveFlag };
}

const lines = spy => spy.mock.calls.map(args => args.join(' '));

describe('the mental-health check’s definition (2b)', () => {
    test.each(['tutor', 'explain', 'protege'])('the %s system lists it, as an async agent the student does not see', mode => {
        const { system, definitions } = agentChat.buildStudentChatSystem({
            mode, modePrompts: { planner: 'p', writer: 'w' }, trackerPrompt: 't', mentalHealthPrompt: MH_PROMPT
        });

        expect(system.agents).toContain('mental-health-check');
        expect(system.visibleAgents).not.toContain('mental-health-check');
        // No progress, and no context.history: it reads only its read tool.
        expect(definitions.find(({ id }) => id === 'mental-health-check')).toEqual(CHECK_DEFINITION);
        expect(JSON.parse(JSON.stringify(definitions))).toEqual(definitions);
    });

    test('its levels are the ones the default prompt asks for', () => {
        expect(agentChat.CONCERN_LEVELS).toEqual(['no concern', 'low concern', 'high concern']);
        agentChat.CONCERN_LEVELS.forEach(level => expect(MH_PROMPT).toContain(`"${level}"`));
    });

    test('JSON mode is on only when the prompt mentions JSON, which the provider requires', () => {
        const optionsFor = mentalHealthPrompt => agentChat.buildStudentChatSystem({
            mode: 'tutor', modePrompts: { planner: 'p', writer: 'w' }, mentalHealthPrompt
        }).definitions.find(({ id }) => id === 'mental-health-check').llmOptions;

        expect(optionsFor('COURSE MH PROMPT: answer with a json object.')).toMatchObject({ responseFormat: 'json' });
        expect(optionsFor('COURSE MH PROMPT: say how worried to be.')).not.toHaveProperty('responseFormat');
    });

    test('without a prompt there is no check', () => {
        const { system } = agentChat.buildStudentChatSystem({ mode: 'tutor', modePrompts: { planner: 'p', writer: 'w' } });
        expect(system.agents).toEqual(['tutor']);
    });
});

describe('the conversation the check reads is trimmed as the old check trims it', () => {
    test.each([
        ['the browser’s history, which ends with the current message', CONVERSATION, TRIMMED],
        ['an empty history: the current message alone', [], [{ role: 'user', content: CURRENT }]],
        ['no history at all', undefined, [{ role: 'user', content: CURRENT }]],
        ['no assistant message', [CONVERSATION[1], CONVERSATION[3]], [CONVERSATION[1], CONVERSATION[3]]],
        ['one student message so far', CONVERSATION.slice(0, 2), CONVERSATION.slice(0, 2)]
    ])('%s', (_, sent, expected) => {
        expect(agentChat.trimMentalHealthContext(sent, CURRENT)).toEqual(expected);
    });

    test('keeps the entries the browser sent, as the old check saves them', () => {
        expect(agentChat.trimMentalHealthContext(CONVERSATION, CURRENT)[0]).toBe(CONVERSATION[2]);
    });

    test.each([
        ['ends with the current message, which the framework sends as `message`', TRIMMED, agentChat.serializeConversation(TRIMMED.slice(0, 2))],
        ['is only the current message', [{ role: 'user', content: CURRENT }], ''],
        ['doesn’t end with the current message, so it is all kept', TRIMMED.slice(0, 2), agentChat.serializeConversation(TRIMMED.slice(0, 2))]
    ])('the model’s text, when the conversation %s', (_, conversation, expected) => {
        expect(agentChat.mentalHealthContextText(conversation, CURRENT)).toBe(expected);
    });
});

describeWithFramework('the model reads what the old check sent it', () => {
    test('the same system prompt and model settings, and every message the old check sent, once, in its order', async () => {
        // BiocBot's real LLM service, with only the provider mocked.
        const provider = {
            sendMessage: jest.fn(async (message, options) => {
                const name = step(options.systemPrompt);
                const answers = { 'mental-health': { concernLevel: 'no concern', reason: 'Fine.' }, tutor: PLAN, writer: { reply: 'A reply.' } };
                return { content: JSON.stringify(answers[name]) };
            })
        };
        const config = { provider: 'openai', defaultModel: 'gpt-4.1-mini' };
        const service = Object.assign(new LLMService({ llmConfig: config }), { llmConfig: config, llm: provider, isInitialized: true });

        await service.analyzeMentalHealth(TRIMMED, MH_PROMPT);
        const [oldText, oldOptions] = provider.sendMessage.mock.calls[0];
        provider.sendMessage.mockClear();

        const { options } = withCheck({ llm: service, runTracker: false });
        const outcome = await agentChat.runStudentChat(options);
        await outcome.run.asyncDone;

        const [message, newOptions] = provider.sendMessage.mock.calls.find(([, sent]) => step(sent.systemPrompt) === 'mental-health');
        // The framework always sends the current message, so the read tool's
        // text is the old text up to it: together they are the old text.
        const sent = JSON.parse(message);
        expect(Object.keys(sent)).toEqual(['message', 'toolResults']);
        expect(sent.message).toBe(CURRENT);
        expect(`${sent.toolResults['mental-health-context']}\n\n[user]: ${sent.message}`).toBe(oldText);
        expect(oldText).toBe(TRIMMED.map(entry => `[${entry.role}]: ${entry.content}`).join('\n\n'));
        // JSON mode is the one addition.
        const { responseFormat, ...rest } = newOptions;
        expect(responseFormat).toBe('json');
        expect(rest).toEqual(oldOptions);
    });
});

describeWithFramework('the mental-health check on the framework', () => {
    let errors;
    beforeAll(() => {
        errors = jest.spyOn(console, 'error').mockImplementation(() => {});
    });
    const audit = () => lines(console.log).filter(line => line.includes('[AGENT_AUDIT] mental-health-check'));
    const failuresLogged = () => lines(errors).filter(line => line.includes('mental-health-check'));

    test.each(['high concern', 'low concern'])('"%s" saves a flag with the old check’s fields, and the audit log records the write', async concernLevel => {
        const model = mockModel({ 'mental-health': () => json({ ...CONCERN, concernLevel }) });
        const { options, saveFlag } = withCheck({ llm: model.llm });

        const outcome = await agentChat.runStudentChat(options);
        await outcome.run.asyncDone;

        expect(saveFlag).toHaveBeenCalledTimes(1);
        expect(saveFlag).toHaveBeenCalledWith({
            studentId: 's1',
            studentName: 'Test Student',
            courseId: 'C1',
            unitName: 'Unit 1',
            message: CURRENT,
            conversationContext: TRIMMED,
            concernLevel,
            llmReason: CONCERN.reason
        });
        expect(audit()).toEqual([
            '🧾 [AGENT_AUDIT] mental-health-check/mental-health-flag started',
            '🧾 [AGENT_AUDIT] mental-health-check/mental-health-flag completed'
        ]);
        expect(failuresLogged()).toEqual([]);
    });

    test('reads the trimmed conversation and the message, on the back-end lane, and never the history', async () => {
        const model = mockModel();
        const { options } = withCheck({ llm: model.llm });

        const outcome = await agentChat.runStudentChat(options);
        await outcome.run.asyncDone;

        const [call] = model.callsTo('mental-health');
        expect(call.message).toEqual({ message: CURRENT, toolResults: { 'mental-health-context': agentChat.serializeConversation(TRIMMED.slice(0, 2)) } });
        expect(call.options).toEqual({ ...CHECK_DEFINITION.llmOptions, systemPrompt: MH_PROMPT });
    });

    test('"no concern" saves no flag', async () => {
        const model = mockModel();
        const { options, saveFlag } = withCheck({ llm: model.llm });

        const outcome = await agentChat.runStudentChat(options);
        await outcome.run.asyncDone;

        expect(model.callsTo('mental-health')).toHaveLength(1);
        expect(saveFlag).not.toHaveBeenCalled();
        expect(failuresLogged()).toEqual([]);
    });

    test.each([
        ['invalid JSON', () => ({ content: 'The student seems fine to me.' }), 'invalid_json'],
        ['a missing concernLevel', () => json({ reason: 'No level given.' }), 'output_mismatch'],
        ['a level the flags page does not know', () => json({ concernLevel: 'moderate concern', reason: 'Made up.' }), 'output_mismatch'],
        ['a model error', () => { throw new Error('Model unavailable'); }, 'llm_failed']
    ])('%s saves no flag, and is logged as a failure, never as "no concern"', async (_, answer, code) => {
        const model = mockModel({ 'mental-health': answer });
        const { options, saveFlag } = withCheck({ llm: model.llm });

        const outcome = await agentChat.runStudentChat(options);
        await outcome.run.asyncDone;

        expect(outcome.run.usedFallback).toBe(false);
        expect(outcome.reply).toBe('A reply.');
        // Tried once more, as every agent is (decision 26), and failed again.
        expect(model.callsTo('mental-health')).toHaveLength(2);
        expect(saveFlag).not.toHaveBeenCalled();
        expect(audit()).toEqual([]);
        expect(failuresLogged()).toEqual([
            expect.stringMatching(new RegExp(`agent\\.failed mental-health-check ${code}: .*no flag was saved, and nothing was decided`))
        ]);
    });

    test('a timeout saves no flag, and is logged as a failure', async () => {
        jest.useFakeTimers({ doNotFake: ['queueMicrotask', 'nextTick', 'setImmediate'] });
        try {
            const model = mockModel({ 'mental-health': () => new Promise(() => {}) });
            const { options, saveFlag } = withCheck({ llm: model.llm });

            const outcome = await agentChat.runStudentChat(options);
            expect(outcome.reply).toBe('A reply.');
            await jest.advanceTimersByTimeAsync(agentChat.MENTAL_HEALTH.timeoutMs);
            await outcome.run.asyncDone;

            // A timeout isn't tried again (decision 10).
            expect(model.callsTo('mental-health')).toHaveLength(1);
            expect(saveFlag).not.toHaveBeenCalled();
            expect(failuresLogged()).toEqual([expect.stringContaining('agent.failed mental-health-check timeout')]);
        } finally {
            jest.useRealTimers();
        }
    });

    test('a flag that can’t be saved is logged with its tool, and isn’t tried again', async () => {
        const model = mockModel({ 'mental-health': () => json(CONCERN) });
        const { options, saveFlag } = withCheck({ llm: model.llm });
        saveFlag.mockRejectedValue(new Error('Database unavailable'));

        const outcome = await agentChat.runStudentChat(options);
        await outcome.run.asyncDone;

        expect(saveFlag).toHaveBeenCalledTimes(1);
        // Nothing retries once a write has started, so a flag can't be saved twice.
        expect(model.callsTo('mental-health')).toHaveLength(1);
        expect(audit()).toEqual([
            '🧾 [AGENT_AUDIT] mental-health-check/mental-health-flag started',
            '🧾 [AGENT_AUDIT] mental-health-check/mental-health-flag failed tool_failed'
        ]);
        expect(failuresLogged()).toEqual(expect.arrayContaining([
            expect.stringContaining('tool.failed mental-health-check/mental-health-flag tool_failed: Database unavailable'),
            expect.stringContaining('agent.failed mental-health-check tool_failed')
        ]));
        expect(failuresLogged()).toHaveLength(2);
    });

    test('a preview runs the check, and the framework blocks the flag (decision 21)', async () => {
        const model = mockModel({ 'mental-health': () => json(CONCERN) });
        const { options, saveFlag } = withCheck({ llm: model.llm, preview: true });

        const outcome = await agentChat.runStudentChat(options);
        await outcome.run.asyncDone;

        expect(model.callsTo('mental-health')).toHaveLength(1);
        expect(saveFlag).not.toHaveBeenCalled();
        expect(audit()).toEqual(['🧾 [AGENT_AUDIT] mental-health-check/mental-health-flag blocked']);
    });

    test('the reply comes back before the check finishes, and the flag after it', async () => {
        let answer;
        const model = mockModel({ 'mental-health': () => new Promise(resolve => { answer = resolve; }) });
        const { options, saveFlag } = withCheck({ llm: model.llm });

        const outcome = await agentChat.runStudentChat(options);

        expect(outcome.run.usedFallback).toBe(false);
        expect(outcome.reply).toBe('A reply.');
        expect(outcome.run.outputs).not.toHaveProperty('mental-health-check');
        expect(model.callsTo('mental-health')).toHaveLength(1);
        expect(saveFlag).not.toHaveBeenCalled();

        answer(json(CONCERN));
        await outcome.run.asyncDone;
        expect(saveFlag).toHaveBeenCalledTimes(1);
    });

    test('a failing check leaves the reply and the other steps as they were', async () => {
        const without = mockModel();
        const plain = await agentChat.runStudentChat(setUp({ llm: without.llm }).options);
        const failing = mockModel({ 'mental-health': () => { throw new Error('Model unavailable'); } });
        const { options } = withCheck({ llm: failing.llm, message: 'Where does glycolysis happen?' });

        const outcome = await agentChat.runStudentChat(options);
        await outcome.run.asyncDone;

        expect(outcome.reply).toBe(plain.reply);
        expect(outcome.run.failures).toEqual({});
        expect(failing.calls.map(call => call.step).filter(name => name !== 'mental-health')).toEqual(['tracker', 'tutor', 'writer']);
    });

    test('adds no progress for the student', async () => {
        const model = mockModel();
        const updates = [];
        const { options } = withCheck({ llm: model.llm, onProgress: update => updates.push(update.step) });

        const outcome = await agentChat.runStudentChat(options);
        await outcome.run.asyncDone;

        expect(updates).toEqual(['tracker', 'tutor', 'tutor', 'summariser']);
    });
});
