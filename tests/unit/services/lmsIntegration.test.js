const {
    CANVAS_ENV_KEYS,
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
