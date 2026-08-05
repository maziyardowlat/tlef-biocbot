const {
    canvas,
    createMongoTokenStore
} = require('@ubc/ubc-genai-toolkit-lms-integration');

const CANVAS_ENV_KEYS = Object.freeze([
    'CANVAS_DOMAIN',
    'CANVAS_CLIENT_ID',
    'CANVAS_CLIENT_SECRET',
    'CANVAS_REDIRECT_URI'
]);

function getCanvasConfigurationStatus(env = process.env) {
    const configured = CANVAS_ENV_KEYS.filter((key) => Boolean(env[key]));
    const missing = CANVAS_ENV_KEYS.filter((key) => !env[key]);
    return {
        enabled: configured.length === CANVAS_ENV_KEYS.length,
        partial: configured.length > 0 && missing.length > 0,
        missing
    };
}

function getBiocBotUserKey(req) {
    if (!req.user?.userId) {
        throw new Error('An authenticated BiocBot user is required for LMS access');
    }
    return String(req.user.userId);
}

function createLmsIntegration(db) {
    const env = process.env;
    const status = getCanvasConfigurationStatus(env);
    if (!status.enabled) {
        return { canvas: null, canvasStatus: status };
    }

    const canvasConfig = canvas.loadConfigFromEnv({
        tokenStore: createMongoTokenStore(() => db, {
            collectionName: env.CANVAS_TOKEN_COLLECTION_NAME || 'lms_canvas_tokens'
        }),
        getUserKey: getBiocBotUserKey,
        basePath: '/api/lms/canvas/auth'
    });

    return {
        canvas: { api: canvas, config: canvasConfig },
        canvasStatus: status
    };
}

async function ensureLmsIndexes(db) {
    await db.collection('documents').createIndex(
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
}

module.exports = {
    CANVAS_ENV_KEYS,
    createLmsIntegration,
    ensureLmsIndexes,
    getBiocBotUserKey,
    getCanvasConfigurationStatus
};
