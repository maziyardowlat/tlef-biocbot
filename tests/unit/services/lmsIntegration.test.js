const {
    CANVAS_ENV_KEYS,
    createLmsIntegration,
    ensureLmsIndexes,
    getBiocBotUserKey,
    getCanvasConfigurationStatus
} = require('../../../src/services/lmsIntegration');

describe('lmsIntegration configuration', () => {
    test('Canvas is enabled only when all required variables are present', () => {
        const complete = Object.fromEntries(CANVAS_ENV_KEYS.map((key) => [key, `${key}-value`]));
        expect(getCanvasConfigurationStatus(complete)).toEqual({
            enabled: true,
            partial: false,
            missing: []
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
