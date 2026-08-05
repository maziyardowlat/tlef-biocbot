const {
    canvas,
    createMongoTokenStore,
    moodle
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

function getMoodleConfigurationStatus(env = process.env) {
    return {
        enabled: Boolean(env.MOODLE_DOMAIN),
        missing: env.MOODLE_DOMAIN ? [] : ['MOODLE_DOMAIN']
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
    const canvasStatus = getCanvasConfigurationStatus(env);
    const moodleStatus = getMoodleConfigurationStatus(env);

    const canvasIntegration = canvasStatus.enabled
        ? {
            api: canvas,
            config: canvas.loadConfigFromEnv({
                tokenStore: createMongoTokenStore(() => db, {
                    collectionName: env.CANVAS_TOKEN_COLLECTION_NAME || 'lms_canvas_tokens'
                }),
                getUserKey: getBiocBotUserKey,
                basePath: '/api/lms/canvas/auth'
            })
        }
        : null;

    const moodleIntegration = moodleStatus.enabled
        ? {
            api: moodle,
            config: moodle.loadConfigFromEnv({
                tokenStore: createMongoTokenStore(() => db, {
                    collectionName: env.MOODLE_TOKEN_COLLECTION_NAME || 'lms_moodle_tokens'
                }),
                getUserKey: getBiocBotUserKey,
                basePath: '/api/lms/moodle/auth'
            })
        }
        : null;

    return {
        canvas: canvasIntegration,
        canvasStatus,
        moodle: moodleIntegration,
        moodleStatus
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

    await db.collection('lms_grade_snapshots').createIndex(
        { courseId: 1, provider: 1, externalCourseId: 1, localUserId: 1, gradeItemKey: 1 },
        { name: 'unique_lms_grade_snapshot', unique: true }
    );

    await db.collection('lms_identity_mappings').createIndex(
        { courseId: 1, provider: 1, externalCourseId: 1, externalUserId: 1 },
        { name: 'unique_lms_external_identity', unique: true }
    );

    await db.collection('lms_identity_mappings').createIndex(
        { courseId: 1, provider: 1, externalCourseId: 1, localUserId: 1 },
        { name: 'unique_lms_local_identity', unique: true }
    );
}

module.exports = {
    CANVAS_ENV_KEYS,
    createLmsIntegration,
    ensureLmsIndexes,
    getBiocBotUserKey,
    getCanvasConfigurationStatus,
    getMoodleConfigurationStatus
};
