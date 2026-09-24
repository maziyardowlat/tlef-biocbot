let lmsToolkit;
let lmsToolkitLoadError;

/**
 * The toolkit is published to GitHub Packages, so an install without a registry
 * token (CI, a fresh clone) cannot fetch it — hence it being an optional
 * dependency. Requiring it lazily keeps this module importable when it is
 * absent: the server still boots and the unit suite still runs, and only a
 * deployment that has actually configured Canvas or Moodle needs it present.
 * @returns {Object|null} The toolkit, or null when it is not installed
 */
function loadLmsToolkit() {
    if (lmsToolkit === undefined) {
        try {
            lmsToolkit = require('@ubc/ubc-genai-toolkit-lms-integration');
        } catch (error) {
            if (error.code !== 'MODULE_NOT_FOUND') {
                throw error;
            }
            lmsToolkitLoadError = error;
            lmsToolkit = null;
        }
    }
    return lmsToolkit;
}

const CANVAS_ENV_KEYS = Object.freeze([
    'CANVAS_DOMAIN',
    'CANVAS_CLIENT_ID',
    'CANVAS_CLIENT_SECRET',
    'CANVAS_REDIRECT_URI'
]);

// Canvas names each developer-key scope after one API route, e.g.
// url:GET|/api/v1/courses/:course_id/users.
const CANVAS_SCOPE_PATTERN = /^url:(GET|POST|PUT|PATCH|DELETE)\|\/api\/v1\/\S+$/;

/**
 * The Canvas scopes BiocBot asks for when an instructor connects, from
 * CANVAS_SCOPES (separated by spaces, commas, or newlines). Empty means no
 * `scope` parameter is sent, which only works while the developer key does not
 * enforce scopes.
 */
function parseCanvasScopes(value = '') {
    const scopes = String(value).split(/[\s,]+/).filter(Boolean);
    return {
        scopes: [...new Set(scopes)],
        invalid: scopes.filter((scope) => !CANVAS_SCOPE_PATTERN.test(scope))
    };
}

function getCanvasConfigurationStatus(env = process.env) {
    const configured = CANVAS_ENV_KEYS.filter((key) => Boolean(String(env[key] || '').trim()));
    const missing = CANVAS_ENV_KEYS.filter((key) => !String(env[key] || '').trim());
    // A malformed scope makes Canvas refuse every connection with
    // invalid_scope, so it disables Canvas as surely as a missing key does.
    const { scopes, invalid } = parseCanvasScopes(env.CANVAS_SCOPES);
    return {
        enabled: configured.length === CANVAS_ENV_KEYS.length && invalid.length === 0,
        partial: configured.length > 0 && (missing.length > 0 || invalid.length > 0),
        missing,
        invalidScopes: invalid,
        scopes
    };
}

/**
 * Canvas fixes a token's scopes when it is issued, and refreshing keeps them.
 * A token issued before CANVAS_SCOPES changed — or before BiocBot asked for any
 * scopes — therefore fails every request its old scopes do not cover while
 * still looking connected. Stamping each stored token with the scope set it
 * was requested under makes such a token read as "not connected", so the
 * instructor is asked to connect again instead of meeting a wall of 401s.
 */
function withCanvasScopeStamp(tokenStore, scopes) {
    const stamp = [...new Set(scopes)].sort().join(' ');
    return {
        async get(userKey) {
            const tokens = await tokenStore.get(userKey);
            if (!tokens) return tokens;
            return (tokens.scopeStamp ?? '') === stamp ? tokens : null;
        },
        set(userKey, tokens) {
            return tokenStore.set(userKey, { ...tokens, scopeStamp: stamp });
        },
        delete(userKey) {
            return tokenStore.delete(userKey);
        }
    };
}

function getMoodleConfigurationStatus(env = process.env) {
    const enabled = Boolean(String(env.MOODLE_DOMAIN || '').trim());
    return {
        enabled,
        partial: false,
        missing: enabled ? [] : ['MOODLE_DOMAIN']
    };
}

function getProviderDiagnostic(status, mounted) {
    const environment = status.enabled ? 'complete' : (status.partial ? 'partial' : 'absent');
    let reason = null;
    if (!mounted) {
        reason = status.enabled ? 'toolkit_unavailable' : `environment_${environment}`;
    }
    return {
        enabled: Boolean(mounted),
        environment,
        missing: status.missing,
        // Key names only, like `missing` — never the configured values.
        invalid: status.invalidScopes?.length ? ['CANVAS_SCOPES'] : [],
        reason
    };
}

/**
 * Non-secret deployment state suitable for startup logs and authenticated
 * diagnostics. Values and URLs are deliberately omitted; only key names and
 * package/provider availability are reported.
 */
function getLmsDiagnostics(integration = {}) {
    const toolkit = integration.toolkitStatus
        || (integration.toolkitMissing ? 'missing' : 'not-required');
    return {
        toolkit,
        toolkitErrorCode: integration.toolkitError?.code || null,
        providers: {
            canvas: getProviderDiagnostic(integration.canvasStatus || getCanvasConfigurationStatus(), integration.canvas),
            moodle: getProviderDiagnostic(integration.moodleStatus || getMoodleConfigurationStatus(), integration.moodle)
        }
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
    const disabled = {
        canvas: null,
        canvasStatus,
        moodle: null,
        moodleStatus,
        toolkitMissing: false,
        toolkitStatus: 'not-required',
        toolkitError: null
    };

    // Nothing is configured, so the toolkit is never needed - don't load it.
    if (!canvasStatus.enabled && !moodleStatus.enabled) {
        return disabled;
    }

    const toolkit = loadLmsToolkit();
    if (!toolkit) {
        // Configured but unusable. Reported as disabled rather than thrown so a
        // missing optional dependency cannot stop the rest of the app booting.
        return {
            ...disabled,
            toolkitMissing: true,
            toolkitStatus: 'missing',
            toolkitError: lmsToolkitLoadError || null
        };
    }

    const { canvas, createMongoTokenStore, moodle } = toolkit;

    const canvasIntegration = canvasStatus.enabled
        ? {
            api: canvas,
            config: canvas.loadConfigFromEnv({
                tokenStore: withCanvasScopeStamp(
                    createMongoTokenStore(() => db, {
                        collectionName: env.CANVAS_TOKEN_COLLECTION_NAME || 'lms_canvas_tokens'
                    }),
                    canvasStatus.scopes
                ),
                getUserKey: getBiocBotUserKey,
                basePath: '/api/lms/canvas/auth',
                // Toolkit 1.3.0+ sends these as one space-delimited scope param
                // and omits it when the list is empty.
                scopes: canvasStatus.scopes
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
        moodleStatus,
        toolkitMissing: false,
        toolkitStatus: 'loaded',
        toolkitError: null
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
    getLmsDiagnostics,
    getMoodleConfigurationStatus,
    loadLmsToolkit,
    parseCanvasScopes,
    withCanvasScopeStamp
};
