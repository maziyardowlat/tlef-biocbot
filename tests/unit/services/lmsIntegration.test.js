const {
    CANVAS_ENV_KEYS,
    createLmsIntegration,
    ensureLmsIndexes,
    getBiocBotUserKey,
    getCanvasConfigurationStatus,
    getLmsDiagnostics,
    parseCanvasScopes,
    withCanvasScopeStamp
} = require('../../../src/services/lmsIntegration');

describe('lmsIntegration configuration', () => {
    test('Canvas is enabled only when all required variables are present', () => {
        const complete = Object.fromEntries(CANVAS_ENV_KEYS.map((key) => [key, `${key}-value`]));
        expect(getCanvasConfigurationStatus(complete)).toEqual({
            enabled: true,
            partial: false,
            missing: [],
            invalidScopes: [],
            scopes: []
        });

        const partial = { CANVAS_DOMAIN: 'http://localhost:9100' };
        expect(getCanvasConfigurationStatus(partial)).toMatchObject({
            enabled: false,
            partial: true
        });
        expect(getCanvasConfigurationStatus(partial).missing).toContain('CANVAS_CLIENT_ID');
    });

    // The toolkit is an optional dependency from GitHub Packages, so an install
    // without a registry token leaves it absent. Nothing here may require it.
    test('reports both providers disabled without loading the toolkit when nothing is configured', () => {
        const previous = { ...process.env };
        for (const key of [...CANVAS_ENV_KEYS, 'MOODLE_DOMAIN']) delete process.env[key];

        try {
            expect(createLmsIntegration({})).toMatchObject({
                canvas: null,
                moodle: null,
                toolkitMissing: false
            });
        } finally {
            Object.assign(process.env, previous);
        }
    });

    test('disables LMS integration instead of throwing when the toolkit is not installed', () => {
        jest.isolateModules(() => {
            jest.doMock('@ubc/ubc-genai-toolkit-lms-integration', () => {
                const error = new Error('Cannot find module');
                error.code = 'MODULE_NOT_FOUND';
                throw error;
            }, { virtual: true });

            const service = require('../../../src/services/lmsIntegration');
            const previous = process.env.MOODLE_DOMAIN;
            process.env.MOODLE_DOMAIN = 'http://moodle.test';

            try {
                expect(service.loadLmsToolkit()).toBeNull();
                expect(service.createLmsIntegration({})).toMatchObject({
                    canvas: null,
                    moodle: null,
                    toolkitMissing: true
                });
            } finally {
                if (previous === undefined) delete process.env.MOODLE_DOMAIN;
                else process.env.MOODLE_DOMAIN = previous;
            }
        });
    });

    test('reads CANVAS_SCOPES separated by spaces, commas, or newlines', () => {
        expect(parseCanvasScopes('url:GET|/api/v1/courses, url:GET|/api/v1/courses/:course_id/users\nurl:GET|/api/v1/courses'))
            .toEqual({
                scopes: ['url:GET|/api/v1/courses', 'url:GET|/api/v1/courses/:course_id/users'],
                invalid: []
            });
        expect(parseCanvasScopes(undefined)).toEqual({ scopes: [], invalid: [] });
    });

    test('disables Canvas when CANVAS_SCOPES holds something that is not a Canvas scope', () => {
        const env = {
            ...Object.fromEntries(CANVAS_ENV_KEYS.map((key) => [key, `${key}-value`])),
            CANVAS_SCOPES: 'url:GET|/api/v1/courses /api/v1/users/self'
        };
        const status = getCanvasConfigurationStatus(env);

        expect(status).toMatchObject({ enabled: false, partial: true, missing: [], invalidScopes: ['/api/v1/users/self'] });
        expect(getLmsDiagnostics({ canvasStatus: status, canvas: null }).providers.canvas).toMatchObject({
            enabled: false,
            environment: 'partial',
            invalid: ['CANVAS_SCOPES']
        });
    });

    test('passes CANVAS_SCOPES to the toolkit and stamps stored tokens with them', () => {
        jest.isolateModules(() => {
            const loadConfigFromEnv = jest.fn((overrides) => overrides);
            jest.doMock('@ubc/ubc-genai-toolkit-lms-integration', () => ({
                canvas: { loadConfigFromEnv },
                createMongoTokenStore: () => ({ get: jest.fn(), set: jest.fn(), delete: jest.fn() }),
                moodle: { loadConfigFromEnv: jest.fn() }
            }), { virtual: true });
            const service = require('../../../src/services/lmsIntegration');
            const previous = { ...process.env };
            Object.assign(process.env, Object.fromEntries(CANVAS_ENV_KEYS.map((key) => [key, `${key}-value`])));
            process.env.CANVAS_SCOPES = 'url:GET|/api/v1/courses url:GET|/api/v1/courses/:course_id/users';
            delete process.env.MOODLE_DOMAIN;

            try {
                const integration = service.createLmsIntegration({});
                expect(loadConfigFromEnv).toHaveBeenCalledWith(expect.objectContaining({
                    basePath: '/api/lms/canvas/auth',
                    scopes: ['url:GET|/api/v1/courses', 'url:GET|/api/v1/courses/:course_id/users']
                }));
                expect(integration.canvas.config.tokenStore.get).toEqual(expect.any(Function));
            } finally {
                for (const key of Object.keys(process.env)) if (!(key in previous)) delete process.env[key];
                Object.assign(process.env, previous);
            }
        });
    });

    test('treats a token requested under a different scope set as not connected', async () => {
        const rows = new Map();
        const store = {
            get: jest.fn(async (key) => rows.get(key) ?? null),
            set: jest.fn(async (key, tokens) => { rows.set(key, tokens); }),
            delete: jest.fn(async (key) => { rows.delete(key); })
        };
        const scoped = withCanvasScopeStamp(store, ['url:GET|/api/v1/courses/:course_id/users', 'url:GET|/api/v1/courses']);

        await scoped.set('user-1', { accessToken: 'a', refreshToken: 'r' });
        expect(rows.get('user-1').scopeStamp).toBe('url:GET|/api/v1/courses url:GET|/api/v1/courses/:course_id/users');
        expect(await scoped.get('user-1')).toMatchObject({ accessToken: 'a' });

        // Issued before BiocBot asked for scopes, or under a different list.
        rows.set('user-2', { accessToken: 'old', refreshToken: 'r' });
        rows.set('user-3', { accessToken: 'other', refreshToken: 'r', scopeStamp: 'url:GET|/api/v1/courses' });
        expect(await scoped.get('user-2')).toBeNull();
        expect(await scoped.get('user-3')).toBeNull();
        expect(await scoped.get('nobody')).toBeNull();

        // With no scopes configured, tokens stored before stamping still work.
        expect(await withCanvasScopeStamp(store, []).get('user-2')).toMatchObject({ accessToken: 'old' });

        await scoped.delete('user-1');
        expect(store.delete).toHaveBeenCalledWith('user-1');
    });

    test('uses BiocBot userId as the token-store key', () => {
        expect(getBiocBotUserKey({ user: { userId: 'user-123' } })).toBe('user-123');
        expect(() => getBiocBotUserKey({})).toThrow('authenticated BiocBot user');
    });

    test('keeps the deployed LMS import index definition stable', async () => {
        const createIndex = jest.fn().mockResolvedValue('unique_lms_file_import');
        const db = {
            collection: jest.fn().mockReturnValue({ createIndex })
        };

        await ensureLmsIndexes(db);

        expect(db.collection).toHaveBeenCalledWith('documents');
        expect(createIndex).toHaveBeenCalledWith(
            {
                courseId: 1,
                'metadata.lms.provider': 1,
                'metadata.lms.externalCourseId': 1,
                'metadata.lms.externalFileId': 1
            },
            {
                name: 'unique_lms_file_import',
                unique: true,
                partialFilterExpression: { 'metadata.lms.provider': { $exists: true } }
            }
        );
    });
});
