// @ts-check
/**
 * Focused coverage for src/services/llm.js.
 *
 * These tests drive a browser page against a compact Node harness that loads
 * the real LLMService class with deterministic test doubles for the provider,
 * config, and prompt dependencies. The harness process writes V8 coverage into
 * the same directory as the app server, so Monocart reports this as server-side
 * coverage for the actual production file without touching production code.
 */

const { test, expect, request } = require('./fixtures/monocart');
const { spawn } = require('child_process');
const path = require('path');
const net = require('net');
const { once } = require('events');

/** @type {import('child_process').ChildProcess|null} */
let harnessProc = null;
/** @type {import('@playwright/test').APIRequestContext|null} */
let pingApi = null;
/** @type {string} */
let harnessUrl = '';

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

async function runHarnessCase(page, name) {
    await page.goto(`${harnessUrl}/__ui`);
    const body = await page.evaluate(async (caseName) => {
        const res = await fetch('/__run', {
            method: 'POST',
            headers: { 'content-type': 'application/json' },
            body: JSON.stringify({ name: caseName }),
        });
        return res.json();
    }, name);
    expect(body.ok, body.error || '').toBe(true);
    return body.data;
}

test.describe.configure({ mode: 'serial' });

test.beforeAll(async () => {
    const port = await getFreePort();
    harnessUrl = `http://127.0.0.1:${port}`;
    const env = {
        ...process.env,
        LLM_HARNESS_PORT: String(port),
        NODE_V8_COVERAGE: path.resolve(__dirname, '../../coverage-reports/.v8-server'),
        BIOCBOT_COVERAGE_RUN_ID: process.env.BIOCBOT_COVERAGE_RUN_ID || String(Date.now()),
    };

    harnessProc = spawn(process.execPath, [
        path.resolve(__dirname, 'helpers/llm-service-harness.js'),
    ], { env, stdio: ['ignore', 'inherit', 'inherit'] });

    pingApi = await request.newContext({ baseURL: harnessUrl });
    const deadline = Date.now() + 15_000;
    while (Date.now() < deadline) {
        try {
            const res = await pingApi.get('/__ping', { failOnStatusCode: false });
            if (res.ok()) return;
        } catch { /* not listening yet */ }
        await new Promise((resolve) => setTimeout(resolve, 100));
    }
    throw new Error('LLM service harness did not become ready in time');
});

test.afterAll(async () => {
    if (pingApi) {
        try {
            await pingApi.dispose();
        } catch {
            // A failed test can remove Playwright's trace artifact before the
            // request context finalizes; harness shutdown still matters more.
        }
        pingApi = null;
    }
    if (harnessProc && harnessProc.pid && !harnessProc.killed) {
        harnessProc.kill('SIGTERM');
        await once(harnessProc, 'exit');
    }
});

test('model settings and provider option branches are exercised', async ({ page }) => {
    const data = await runHarnessCase(page, 'settings-and-options');

    expect(data.noEnvDefault).toEqual({ model: 'gpt-4.1-mini', reasoningEffort: 'minimal' });
    expect(data.cacheHit).toEqual(data.noEnvDefault);
    expect(data.invalidEnvDefault.model).toBe('gpt-4.1-mini');
    expect(data.configDefault.model).toBe('gpt-5-nano');
    expect(data.dbOverride).toEqual({ model: 'gpt-5.4-nano', reasoningEffort: 'high' });
    expect(data.invalidDbOverride.reasoningEffort).toBe('minimal');
    expect(data.dbFailure.model).toBe('gpt-5-nano');

    expect(data.nonGptOptions).toMatchObject({ model: 'gpt-4.1-mini', max_tokens: 123, temperature: 0.2 });
    expect(data.gpt5FloorOptions).toMatchObject({
        model: 'gpt-5-nano',
        max_completion_tokens: 2000,
        reasoning_effort: 'minimal',
    });
    expect(data.gpt5FloorOptions.temperature).toBeUndefined();
    expect(data.gpt5LargeBudget.max_completion_tokens).toBe(5000);
    expect(data.gpt54CoercedOptions).toMatchObject({
        model: 'gpt-5.4-nano',
        max_completion_tokens: 2000,
        reasoning_effort: 'low',
    });
    expect(data.xhighCoerced.reasoning_effort).toBe('high');
    expect(data.unknownEffortFallback.reasoning_effort).toBe('minimal');
    expect(data.missingEffortFallback.reasoning_effort).toBe('minimal');
    expect(data.coerceUnknownModel).toBe('minimal');
    expect(data.gptChecks).toEqual([true, false, false]);

    expect(data.providerOptions.ollama).toEqual({ num_ctx: 2048 });
    expect(data.providerOptions.openai).toEqual({ max_tokens: 32768 });
    expect(data.providerOptions.sandbox).toEqual({ num_ctx: 2048 });
    expect(data.providerOptions.unknown).toEqual({});
    expect(data.providerOptions.missing).toEqual({});
});

test('service lifecycle methods use initialized and error paths', async ({ page }) => {
    const data = await runHarnessCase(page, 'lifecycle');

    expect(data.createdReady).toBe(true);
    expect(data.createdProvider).toBe('fake-openai');
    expect(data.createFailure).toContain('harness config failure');
    expect(data.sendResponse).toBe('hello from send');
    expect(data.sendOptions).toMatchObject({
        systemPrompt: 'Base system prompt from harness',
        custom: true,
        model: 'gpt-4.1-mini',
    });
    expect(data.secondResponse).toBe('second response');
    expect(data.sendFailure).toContain('send boom');
    expect(data.conversationMessages).toEqual([
        { role: 'system', content: 'Base system prompt from harness' },
        { role: 'user', content: 'user turn' },
    ]);
    expect(data.conversationResponse).toBe('conversation reply');
    expect(data.conversationSendOptions).toMatchObject({ local: true, model: 'gpt-4.1-mini' });
    expect(data.initializedConversationMessages).toEqual([
        { role: 'system', content: 'Base system prompt from harness' },
    ]);
    expect(data.externalConversationResponse).toBe('external conversation reply');
    expect(data.externalConversationRecord.messages).toEqual([
        { role: 'user', content: 'first user turn' },
    ]);
    expect(data.externalConversationRecord.sendOptions[0]).toMatchObject({ model: 'gpt-4.1-mini' });
    expect(data.conversationCreateFailure).toContain('conversation creation failure');
    expect(data.conversationSendFailure).toContain('conversation send failure');
    expect(data.models).toEqual(['gpt-4.1-mini', 'gpt-5-nano']);
    expect(data.modelsFailure).toContain('models failure');
    expect(data.notInitializedProvider).toBe('Not initialized');
    expect(data.systemPrompt).toBe('Base system prompt from harness');
    expect(data.readyFalse).toBe(false);
    expect(data.statusBefore).toMatchObject({
        provider: 'Not initialized',
        isConnected: false,
        isInitialized: false,
    });
    expect(data.connectionTrue).toBe(true);
    expect(data.connectionFalse).toBe(false);
    expect(data.connectionFalseNoContent).toBe(false);
    expect(data.connectionCatch).toBe(false);
});

test('assessment, evaluation, and mental-health LLM paths are covered', async ({ page }) => {
    const data = await runHarnessCase(page, 'assessment');

    expect(data.generatedTrueFalse).toMatchObject({
        type: 'true-false',
        question: 'Harness true false?',
        answer: 'true',
    });
    expect(data.generatedInitialized).toMatchObject({ type: 'true-false', answer: 'true' });
    expect(data.generatedCustom).toMatchObject({
        type: 'multiple-choice',
        answer: 'B',
    });
    expect(data.generatedCustomSend.message).toContain('multiple-choice ATP powers cellular work. Unit 2');
    expect(data.generatedCustomSend.options.systemPrompt).toBe('custom multiple-choice system');
    expect(data.generatedEmptyFailure).toContain('No response content received from LLM');
    expect(data.generatedTimeoutFailure).toContain('timed out');
    expect(data.regenerated).toMatchObject({
        type: 'short-answer',
        answer: 'Expected harness answer',
    });
    expect(data.regeneratedInitialized).toMatchObject({ type: 'true-false', answer: 'true' });
    expect(data.regeneratedEmptyFailure).toContain('No response content received from LLM during regeneration');
    expect(data.regeneratedTimeoutFailure).toContain('timed out');
    expect(data.evaluationJson).toEqual({ correct: true, feedback: 'Correct, Ada' });
    expect(data.evaluationNoJson).toMatchObject({ correct: true });
    expect(data.evaluationInvalidJson).toMatchObject({ correct: false, feedback: '{bad json}' });
    expect(data.evaluationFailure).toContain('harness send failure');
    expect(data.mentalHealthValid).toEqual({ concernLevel: 'medium', reason: 'Needs support' });
    expect(data.mentalHealthDefaults).toEqual({ concernLevel: 'no concern', reason: '' });
    expect(data.mentalHealthEmpty.reason).toBe('No response from detection model');
    expect(data.mentalHealthNoJson.reason).toBe('Failed to parse detection response');
    expect(data.mentalHealthInvalidJson.reason).toBe('Failed to parse detection response');
    expect(data.mentalHealthFailure.reason).toContain('Detection error: harness send failure');
});

test('prompt builders, schemas, and parser fallbacks are covered', async ({ page }) => {
    const data = await runHarnessCase(page, 'prompts-and-parsing');

    expect(data.customPrompts[0]).toBe('true-false LO Material Unit 1');
    expect(data.customPrompts[1]).toBe('multiple-choice  Material Unit 1');
    expect(data.customPrompts[2]).toBe('short-answer LO Material Unit 1');
    expect(data.customUnsupported).toContain('Unsupported question type: essay');
    expect(data.customTemplateFallback).toContain('default true-false');
    expect(data.defaultPrompts).toEqual([
        'default true-false LO Material Unit 1',
        'default multiple-choice LO Material Unit 1',
        'default short-answer LO Material Unit 1',
    ]);
    expect(data.defaultUnsupported).toContain('Unsupported question type: essay');

    expect(data.regenPrompts[0]).toContain('A) A1');
    expect(data.regenPrompts[1]).toContain('No question text');
    expect(data.regenPrompts[1]).toContain('No option A');
    expect(data.regenPrompts[2]).toContain('Correct Answer: No answer');
    expect(data.regenPrompts[3]).toContain('Expected Answer: No answer');
    expect(data.regenPrompts[4]).toContain('Question Type: essay');
    expect(data.schemas[0]).toContain('"type": "true-false"');
    expect(data.schemas[1]).toContain('"type": "multiple-choice"');
    expect(data.schemas[2]).toContain('"type": "short-answer"');
    expect(data.schemas[3]).toBe('{}');

    expect(data.parsed.trueFalse).toMatchObject({ type: 'true-false', answer: 'false' });
    expect(data.parsed.multipleChoice).toMatchObject({ type: 'multiple-choice', answer: 'B' });
    expect(data.parsed.shortAnswerWithPoints.keyPoints).toEqual(['point one']);
    expect(data.parsed.shortAnswerWithoutPoints.keyPoints).toBeUndefined();
    expect(data.parsed.unknownType).toMatchObject({ type: 'essay', question: 'Q?' });
    expect(data.parseFallbacks.noJsonTrueFalse.answer).toBe('true');
    expect(data.parseFallbacks.invalidJsonMultipleChoice.options).toEqual({
        A: 'Option A',
        B: 'Option B',
        C: 'Option C',
        D: 'Option D',
    });
    expect(data.parseFallbacks.missingRequiredShortAnswer.answer).toBe('Please review the generated content.');
    expect(data.parseFallbacks.badTrueFalse.question).toContain('Error parsing');
    expect(data.parseFallbacks.missingMultipleChoiceFields.answer).toBe('A');
    expect(data.parseFallbacks.incompleteMultipleChoiceOptions.answer).toBe('A');
    expect(data.parseFallbacks.missingShortAnswerExpected.answer).toBe('Please review the generated content.');
});
