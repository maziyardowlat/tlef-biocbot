const mockValidateApiKey = jest.fn();
const mockValidateProviderKey = jest.fn();
const mockBuildKeySubdocument = jest.fn();
const mockDecryptApiKey = jest.fn();

// Keep the real provider-state readers so the per-surface `llmCredentials`
// storage, legacy `llmApiKey` compatibility, and provider selection are all
// exercised for real. Only crypto and the network probe are stubbed.
jest.mock('../../../src/services/llmKeyStore', () => {
    const actual = jest.requireActual('../../../src/services/llmKeyStore');
    return {
        ...actual,
        validateApiKey: mockValidateApiKey,
        validateProviderKey: mockValidateProviderKey,
        buildKeySubdocument: mockBuildKeySubdocument,
        decryptApiKey: mockDecryptApiKey
    };
});

const { memoryDb } = require('../helpers/memory-db');
const { makeRouteApp, request } = require('../helpers/route-app');
const settingsRouter = require('../../../src/routes/settings');

const admin = {
    userId: 'admin1',
    role: 'instructor',
    email: ' ADMIN@Example.com ',
    permissions: { systemAdmin: true }
};
const instructor = { userId: 'i1', role: 'instructor' };

function app({ db = memoryDb({ settings: [] }), user = admin, locals = {} } = {}) {
    return makeRouteApp(settingsRouter, { db, user, locals });
}

beforeEach(() => {
    mockValidateApiKey.mockResolvedValue({ ok: true, status: 'valid' });
    mockValidateProviderKey.mockResolvedValue({ ok: true, status: 'valid', provider: 'openai' });
    mockBuildKeySubdocument.mockImplementation((apiKey, userId, provider) => ({
        ciphertext: `encrypted:${apiKey}`,
        last4: String(apiKey).slice(-4),
        status: 'valid',
        provider: provider || 'openai',
        updatedById: userId,
        validatedAt: new Date('2026-01-01T00:00:00Z'),
        updatedAt: new Date('2026-01-01T00:00:00Z')
    }));
    mockDecryptApiKey.mockReturnValue('decrypted-key');
    jest.spyOn(console, 'error').mockImplementation(() => {});
});

afterEach(() => jest.restoreAllMocks());

describe('GET /academic-api-enabled', () => {
    test('returns the persisted feature gate and fails closed without a database', async () => {
        const db = memoryDb({ settings: [{ _id: 'global', academicApiEnabled: true }] });
        expect((await request(app({ db })).get('/academic-api-enabled')).body)
            .toEqual({ success: true, enabled: true });
        expect((await request(app({ db: null })).get('/academic-api-enabled')).body)
            .toEqual({ success: true, enabled: false });
    });
});

describe.each([
    {
        label: 'notes',
        base: '/notes-llm-key',
        id: 'notesLlm',
        evict: 'evictNotes',
        savedMessage: 'Notes API key saved',
        validMessage: 'Notes API key is valid'
    },
    {
        label: 'instructor Super Course',
        base: '/instructor-superchat-llm-key',
        id: 'superCourseChat',
        evict: 'evictSuperCourseChat',
        savedMessage: 'Instructor Super Course chat API key saved',
        validMessage: 'Instructor Super Course chat API key is valid'
    }
])('$label LLM key endpoints', ({ base, id, evict, savedMessage, validMessage }) => {
    test('GET enforces database and admin access', async () => {
        expect((await request(app({ db: null })).get(base)).status).toBe(503);
        expect((await request(app({ user: null })).get(base)).status).toBe(401);
        expect((await request(app({ user: instructor })).get(base)).status).toBe(403);
    });

    test('GET reports missing and valid saved keys, plus the platform catalog', async () => {
        let res = await request(app()).get(base);
        expect(res.body).toMatchObject({ success: true, aiAvailable: false, llmProvider: 'openai' });
        // Instructors/admins choose a platform label; no model names are exposed.
        expect(res.body.providers.map(p => p.provider)).toEqual(['openai', 'ubc-llm-sandbox']);
        expect(res.body.providers.map(p => p.label)).toEqual(['GPT', 'Sandbox']);
        expect(JSON.stringify(res.body)).not.toMatch(/text-embedding|gpt-5|qwen3/);

        // A legacy llmApiKey with no provider metadata reads as an OpenAI key.
        const db = memoryDb({ settings: [{ _id: id, llmApiKey: { ciphertext: 'cipher', status: 'valid', last4: '1234' } }] });
        res = await request(app({ db })).get(base);
        expect(res.body).toMatchObject({
            success: true,
            llmProvider: 'openai',
            llmKey: { status: 'valid', last4: '1234' },
            aiAvailable: true
        });
    });

    test('GET exposes a Sandbox surface with both stored platform keys', async () => {
        const db = memoryDb({ settings: [{
            _id: id,
            activeLlmProvider: 'ubc-llm-sandbox',
            llmCredentials: {
                openai: { ciphertext: 'c1', status: 'valid', last4: '1111' },
                'ubc-llm-sandbox': { ciphertext: 'c2', status: 'valid', last4: '2222' }
            }
        }] });
        const res = await request(app({ db })).get(base);
        expect(res.body).toMatchObject({
            llmProvider: 'ubc-llm-sandbox',
            llmKey: { last4: '2222' },
            llmKeysByProvider: { openai: { last4: '1111' }, 'ubc-llm-sandbox': { last4: '2222' } }
        });
        // Never leak ciphertext or decrypted keys.
        expect(JSON.stringify(res.body)).not.toMatch(/ciphertext|c1|c2/);
    });

    test('PUT maps invalid and quota validation failures', async () => {
        mockValidateProviderKey.mockResolvedValueOnce({
            ok: false,
            status: 'invalid',
            message: '',
            detail: 'bad key'
        });
        let res = await request(app()).put(base).send({ apiKey: 'bad' });
        expect(res.status).toBe(400);
        expect(res.body).toMatchObject({ code: 'LLM_KEY_INVALID', message: 'API key validation failed' });

        mockValidateProviderKey.mockResolvedValueOnce({
            ok: false,
            status: 'quota_exhausted',
            message: 'Quota exhausted'
        });
        res = await request(app()).put(base).send({ apiKey: 'spent' });
        expect(res.body).toMatchObject({ code: 'LLM_KEY_QUOTA', message: 'Quota exhausted' });
    });

    test('PUT validates a Sandbox key against the Sandbox platform', async () => {
        const db = memoryDb({ settings: [] });
        const res = await request(app({ db })).put(base).send({ apiKey: 'sbx-key', llmProvider: 'ubc-llm-sandbox' });
        expect(res.status).toBe(200);
        expect(mockValidateProviderKey).toHaveBeenCalledWith(expect.objectContaining({
            provider: 'ubc-llm-sandbox',
            apiKey: 'sbx-key',
            embeddingModel: 'qwen3-embedding-0.6b'
        }));
        const saved = await db.collection('settings').findOne({ _id: id });
        expect(saved.activeLlmProvider).toBe('ubc-llm-sandbox');
        expect(saved.llmCredentials['ubc-llm-sandbox']).toMatchObject({ provider: 'ubc-llm-sandbox' });
        // A Sandbox key never populates the legacy OpenAI field.
        expect(saved.llmApiKey).toBeUndefined();
    });

    test('PUT stores a validated key and evicts the corresponding runtime client', async () => {
        const db = memoryDb({ settings: [] });
        const registry = { [evict]: jest.fn() };
        const res = await request(app({ db, locals: { llmRegistry: registry } }))
            .put(base).send({ apiKey: 'secret' });

        expect(res.status).toBe(200);
        expect(res.body).toMatchObject({ success: true, message: savedMessage, aiAvailable: true });
        expect(mockBuildKeySubdocument).toHaveBeenCalledWith('secret', 'admin1', 'openai');
        expect(registry[evict]).toHaveBeenCalledTimes(1);
        expect(await db.collection('settings').findOne({ _id: id })).toMatchObject({
            activeLlmProvider: 'openai',
            llmCredentials: { openai: { ciphertext: 'encrypted:secret', status: 'valid' } },
            llmApiKey: { ciphertext: 'encrypted:secret', status: 'valid' },
            updatedBy: 'admin@example.com'
        });
    });

    test('PUT succeeds when no registry is installed', async () => {
        expect((await request(app()).put(base).send({ apiKey: 'secret' })).status).toBe(200);
    });

    test('test endpoint rejects each missing-key document shape', async () => {
        for (const doc of [null, { _id: id }, { _id: id, llmApiKey: {} }]) {
            const db = memoryDb({ settings: doc ? [doc] : [] });
            const res = await request(app({ db })).post(`${base}/test`);
            expect(res.status).toBe(400);
            expect(res.body.code).toBe('LLM_KEY_MISSING');
        }
    });

    test('test endpoint decrypts, validates, persists validity, and evicts', async () => {
        const db = memoryDb({ settings: [{
            _id: id,
            llmApiKey: { ciphertext: 'cipher', status: 'unknown', validatedAt: null }
        }] });
        const registry = { [evict]: jest.fn() };
        const res = await request(app({ db, locals: { llmRegistry: registry } }))
            .post(`${base}/test`);

        expect(res.status).toBe(200);
        expect(res.body).toMatchObject({ success: true, message: validMessage, aiAvailable: true });
        expect(mockDecryptApiKey).toHaveBeenCalledWith('cipher');
        expect(mockValidateProviderKey).toHaveBeenCalledWith(expect.objectContaining({
            provider: 'openai', apiKey: 'decrypted-key'
        }));
        expect(registry[evict]).toHaveBeenCalledTimes(1);
        expect(await db.collection('settings').findOne({ _id: id })).toMatchObject({
            llmCredentials: { openai: { status: 'valid', validatedAt: expect.any(Date) } },
            llmApiKey: { status: 'valid', validatedAt: expect.any(Date), updatedAt: expect.any(Date) }
        });
    });

    test.each([
        ['invalid', 'LLM_KEY_INVALID'],
        ['quota_exhausted', 'LLM_KEY_QUOTA']
    ])('test endpoint persists %s validation failures', async (status, code) => {
        const oldValidatedAt = new Date('2025-01-01T00:00:00Z');
        const db = memoryDb({ settings: [{
            _id: id,
            llmApiKey: { ciphertext: 'cipher', status: 'valid', validatedAt: oldValidatedAt }
        }] });
        mockValidateProviderKey.mockResolvedValue({ ok: false, status, message: 'Nope' });

        const res = await request(app({ db })).post(`${base}/test`);

        expect(res.status).toBe(400);
        expect(res.body).toMatchObject({ success: false, code, message: 'Nope', aiAvailable: false });
        expect(res.body.llmKey.status).toBe(status);
        expect(new Date(res.body.llmKey.validatedAt)).toEqual(oldValidatedAt);
    });

    test('test endpoint works without a registry', async () => {
        const db = memoryDb({ settings: [{ _id: id, llmApiKey: { ciphertext: 'cipher' } }] });
        expect((await request(app({ db })).post(`${base}/test`)).status).toBe(200);
    });
});

describe('key endpoint exception contracts', () => {
    const throwingDb = {
        collection: () => ({
            findOne: jest.fn().mockRejectedValue(new Error('db failed')),
            updateOne: jest.fn().mockRejectedValue(new Error('db failed'))
        })
    };

    test.each([
        ['get', '/notes-llm-key'],
        ['put', '/notes-llm-key'],
        ['post', '/notes-llm-key/test'],
        ['get', '/instructor-superchat-llm-key'],
        ['put', '/instructor-superchat-llm-key'],
        ['post', '/instructor-superchat-llm-key/test']
    ])('%s %s returns its stable 500 response', async (method, path) => {
        const res = await request(app({ db: throwingDb }))[method](path).send({ apiKey: 'secret' });
        expect(res.status).toBe(500);
        expect(res.body.success).toBe(false);
    });
});
