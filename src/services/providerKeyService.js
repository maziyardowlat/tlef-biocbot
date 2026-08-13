/**
 * Provider key operations, shared by every keyed surface
 *
 * The four surfaces — a course, the instructor Notes, the instructor Super
 * Course chat, and each student-facing Super Course bucket — all need the same
 * behaviour, and each keeps its own isolated credentials:
 *
 *   - save a key for a chosen platform (validated against THAT platform)
 *   - test the stored key for the active platform
 *   - explicitly prepare a stored platform, then activate it automatically
 *     only after all required vectors are ready
 *
 * Keys are never shared between surfaces, and no route ever returns ciphertext
 * or a decrypted key.
 */

const adminModelSettings = require('./adminModelSettings');
const { LLMModule } = require('ubc-genai-toolkit-llm');
const config = require('./config');
const migrations = require('./providerMigrationService');
const migrationRunner = require('./providerMigrationRunner');
const superCourse = require('./superCourseService');
const { buildEmbeddingProfile, vectorSizeForEmbeddingModel } = require('./embeddingConfig');
const { PROVIDERS, normalizeProvider, providerLabel } = require('./llmProviders');
const { PROXY_REASONING_EFFORTS } = require('./llmModels');
const {
    KEY_STATUSES,
    buildKeySubdocument,
    credentialForProvider,
    credentialSetFields,
    decryptApiKey,
    publicKeySummary,
    publicProviderKeyState,
    readProviderState,
    validateProviderKey
} = require('./llmKeyStore');

function errorCodeForStatus(status) {
    if (status === KEY_STATUSES.QUOTA_EXHAUSTED) return 'LLM_KEY_QUOTA';
    if (status === KEY_STATUSES.MISSING) return 'LLM_KEY_MISSING';
    return 'LLM_KEY_INVALID';
}

/**
 * Validate a key against the models the admin configured for that platform.
 */
async function validateForProvider(db, provider, apiKey) {
    const normalizedProvider = normalizeProvider(provider);
    const settings = await adminModelSettings.getProviderSettings(db, normalizedProvider);
    let endpoint = null;
    try {
        endpoint = config.getProviderInfra(normalizedProvider).endpoint;
    } catch (_) {
        endpoint = null;
    }

    const validation = await validateProviderKey({
        provider: normalizedProvider,
        apiKey,
        chatModel: settings.chatModel,
        embeddingModel: settings.embeddingModel,
        endpoint
    });

    if (!validation.ok || normalizedProvider !== PROVIDERS.PROXY) {
        return validation;
    }

    const current = await adminModelSettings.getProviderSettings(db, normalizedProvider, { force: true });
    if (current.chatModel || current.embeddingModel) {
        try {
            const listed = validation.models || [];
            for (const selected of [
                current.chatModel,
                current.lanes?.backend?.chatModel,
                current.embeddingModel
            ].filter(Boolean)) {
                if (!listed.includes(selected)) {
                    throw incompatibleModelError(
                        selected,
                        `The selected model is not available to this ${providerLabel(normalizedProvider)} key.`
                    );
                }
            }
            await validateProxyOperations({
                apiKey,
                endpoint,
                chatSelections: proxyChatSelectionsFromSettings(current),
                embeddingModel: current.embeddingModel
            });
        } catch (error) {
            return {
                ok: false,
                status: KEY_STATUSES.INVALID,
                provider: normalizedProvider,
                message: error.message,
                detail: error.cause?.message || error.message
            };
        }
    }

    await adminModelSettings.recordDiscoveredModels(db, normalizedProvider, validation.models);
    return validation;
}

function incompatibleModelError(model, detail, operation = null) {
    const action = operation ? ` for ${operation}` : '';
    const error = new Error(`${model} cannot be used${action} with the saved UBC LLM Proxy key. ${detail}`);
    error.code = 'MODEL_OPERATION_INCOMPATIBLE';
    return error;
}

function proxyChatSelectionsFromSettings(settings) {
    const selections = [];
    const frontend = settings?.lanes?.frontend || settings;
    const backend = settings?.lanes?.backend || frontend;
    for (const lane of [frontend, backend]) {
        if (!lane?.chatModel) continue;
        if (!selections.some(item => item.model === lane.chatModel && item.reasoningEffort === lane.reasoningEffort)) {
            selections.push({ model: lane.chatModel, reasoningEffort: lane.reasoningEffort });
        }
    }
    return selections;
}

async function validateProxyOperations({ apiKey, endpoint, chatSelections = [], embeddingModel = null }) {
    if (process.env.BIOCBOT_TEST_LLM_STUB === '1') {
        return {
            vectorSize: embeddingModel
                ? vectorSizeForEmbeddingModel(
                    embeddingModel,
                    Number(process.env.BIOCBOT_TEST_PROXY_VECTOR_SIZE) || 8
                )
                : null
        };
    }

    const llm = new LLMModule({
        provider: PROVIDERS.PROXY,
        apiKey,
        endpoint,
        ...(embeddingModel ? { embeddingModel } : {})
    });

    for (const selection of chatSelections) {
        try {
            await llm.sendMessage('BiocBot model validation', {
                model: selection.model,
                reasoningEffort: selection.reasoningEffort,
                maxTokens: 16
            });
        } catch (cause) {
            const error = incompatibleModelError(
                selection.model,
                cause.message || 'The proxy rejected the chat request.',
                'chat'
            );
            error.cause = cause;
            throw error;
        }
    }

    let vectorSize = null;
    if (embeddingModel) {
        try {
            const response = await llm.embed(['BiocBot embedding validation'], { model: embeddingModel });
            const vector = response?.embeddings?.[0];
            if (!Array.isArray(vector) || vector.length === 0) {
                throw new Error('The proxy returned an empty or invalid embedding vector.');
            }
            vectorSize = vector.length;
        } catch (cause) {
            const error = incompatibleModelError(
                embeddingModel,
                cause.message || 'The proxy rejected the embedding request.',
                'embeddings'
            );
            error.cause = cause;
            throw error;
        }
    }

    return { vectorSize };
}

async function proxyValidationCredential(db) {
    const provider = PROVIDERS.PROXY;
    const candidates = [
        await db.collection('settings').findOne({ _id: 'notesLlm', [`llmCredentials.${provider}.status`]: KEY_STATUSES.VALID }),
        await db.collection('settings').findOne({ _id: 'superCourseChat', [`llmCredentials.${provider}.status`]: KEY_STATUSES.VALID }),
        await db.collection('courses').findOne({ [`llmCredentials.${provider}.status`]: KEY_STATUSES.VALID }),
        await db.collection('superchats').findOne({
            [`llmCredentials.${provider}.status`]: KEY_STATUSES.VALID,
            isDeleted: { $ne: true }
        })
    ];
    const doc = candidates.find(Boolean);
    const credential = doc && credentialForProvider(doc, provider);
    if (!credential?.ciphertext) {
        const error = new Error(
            'Save and validate a UBC LLM Proxy key on a course, Super Course, notes, or instructor chat before selecting proxy models.'
        );
        error.code = 'PROXY_KEY_REQUIRED';
        throw error;
    }
    return decryptApiKey(credential.ciphertext);
}

async function validateProxyChatSettings(db, selections) {
    const apiKey = await proxyValidationCredential(db);
    const endpoint = config.getProviderInfra(PROVIDERS.PROXY).endpoint;
    if (!endpoint) {
        const error = new Error('UBC_LLM_PROXY_ENDPOINT is not configured.');
        error.code = 'PROXY_ENDPOINT_MISSING';
        throw error;
    }
    return validateProxyOperations({ apiKey, endpoint, chatSelections: selections });
}

/**
 * Discover the normalized reasoning efforts accepted by one proxy model.
 *
 * `/models` deliberately returns no capability metadata, so this uses the
 * provider operation as the source of truth. Model ids and naming conventions
 * are never inspected. A small request is made for each toolkit-supported
 * effort and only successful values are returned to the admin UI.
 */
async function discoverProxyReasoningEfforts(db, model) {
    if (!model || typeof model !== 'string') {
        const error = new Error('Select a proxy model before checking reasoning support.');
        error.code = 'PROXY_MODEL_REQUIRED';
        throw error;
    }

    if (process.env.BIOCBOT_TEST_LLM_STUB === '1') {
        const configured = process.env.BIOCBOT_TEST_PROXY_REASONING_EFFORTS;
        return configured
            ? configured.split(',').map(value => value.trim()).filter(Boolean)
            : [...PROXY_REASONING_EFFORTS];
    }

    const apiKey = await proxyValidationCredential(db);
    const endpoint = config.getProviderInfra(PROVIDERS.PROXY).endpoint;
    if (!endpoint) {
        const error = new Error('UBC_LLM_PROXY_ENDPOINT is not configured.');
        error.code = 'PROXY_ENDPOINT_MISSING';
        throw error;
    }

    const llm = new LLMModule({ provider: PROVIDERS.PROXY, apiKey, endpoint });
    const supported = [];
    let firstFailure = null;

    for (const reasoningEffort of PROXY_REASONING_EFFORTS) {
        try {
            await llm.sendMessage('Reply with OK.', {
                model,
                reasoningEffort,
                maxTokens: 32
            });
            supported.push(reasoningEffort);
        } catch (error) {
            firstFailure ||= error;
        }
    }

    if (supported.length === 0) {
        const error = incompatibleModelError(
            model,
            firstFailure?.message || 'No supported reasoning efforts were detected.',
            'reasoning discovery'
        );
        error.cause = firstFailure;
        throw error;
    }

    return supported;
}

async function validateProxyEmbeddingModel(db, embeddingModel) {
    const apiKey = await proxyValidationCredential(db);
    const endpoint = config.getProviderInfra(PROVIDERS.PROXY).endpoint;
    if (!endpoint) {
        const error = new Error('UBC_LLM_PROXY_ENDPOINT is not configured.');
        error.code = 'PROXY_ENDPOINT_MISSING';
        throw error;
    }
    return validateProxyOperations({ apiKey, endpoint, embeddingModel });
}

/**
 * The embedding profile a provider would use for this surface, including the
 * decrypted key when one is supplied.
 */
async function embeddingProfileFor(db, provider, apiKey = null) {
    const normalizedProvider = normalizeProvider(provider);
    const settings = await adminModelSettings.getProviderSettings(db, normalizedProvider);
    if (!settings.embeddingModel || (normalizedProvider === PROVIDERS.PROXY && !settings.configured)) {
        const error = new Error(
            `${providerLabel(normalizedProvider)} is not fully configured. A system admin must select and save its chat and embedding models first.`
        );
        error.code = 'LLM_PROVIDER_UNCONFIGURED';
        throw error;
    }
    let endpoint = null;
    try {
        endpoint = config.getProviderInfra(normalizedProvider).endpoint;
    } catch (_) {
        endpoint = null;
    }
    return buildEmbeddingProfile({
        provider: normalizedProvider,
        embeddingModel: settings.embeddingModel,
        revision: settings.embeddingRevision,
        vectorSize: settings.vectorSize || undefined,
        endpoint,
        apiKey
    });
}

function evictScope(registry, scope) {
    if (!registry) return;
    if (scope.type === 'course') registry.evictCourse(scope.id);
    else if (scope.type === 'superchat') registry.evictSuperchat(scope.id);
    else if (scope.type === 'notes') registry.evictNotes();
    else if (scope.type === 'superCourseChat') registry.evictSuperCourseChat();
}

/**
 * Which courses' content a scope can retrieve. Determines what must be indexed
 * for the scope's embedding profile before the scope can serve answers.
 *
 * @returns {Promise<{courseIds: Array<string>, includeNotes: boolean}>}
 */
async function migrationScopeContent(db, scope) {
    if (scope.type === 'course') {
        return { courseIds: [scope.id], includeNotes: false };
    }

    if (scope.type === 'notes') {
        return { courseIds: [], includeNotes: true };
    }

    if (scope.type === 'superchat') {
        // A bucket searches its member courses' content with ITS OWN profile,
        // so every member course needs an index in that profile — even courses
        // that themselves run on a different platform. Membership is course-side
        // (`course.superchatIds`), so it comes from the retrieval pool.
        const bucket = await db.collection('superchats').findOne({ superchatId: scope.id });
        return superCourse.superCourseContentScope(db, {
            superchatId: scope.id,
            settingsDoc: bucket
        });
    }

    if (scope.type === 'superCourseChat') {
        // The instructor Super Course chat pools every bucketed course, plus
        // Notes when the chat is configured to include them.
        const settings = await db.collection('settings').findOne({ _id: 'superCourseChat' });
        return superCourse.superCourseContentScope(db, { settingsDoc: settings });
    }

    return { courseIds: [], includeNotes: false };
}

async function loadSurface(db, scope) {
    const target = migrations.scopeTarget(scope);
    if (!target) throw new Error(`Unknown keyed surface: ${scope && scope.type}`);
    const doc = await db.collection(target.collection).findOne(target.filter);
    return { target, doc };
}

/**
 * Save a key for a surface.
 *
 * Saving/replacing a key never implicitly starts a migration. The only special
 * case is first-time setup: when the surface has no usable active credential,
 * the first valid key becomes active immediately.
 *
 * @returns {Promise<Object>} Route-ready result (never contains key material)
 */
async function saveSurfaceKey(db, {
    scope,
    provider,
    apiKey,
    updatedBy = null,
    registry = null
}) {
    const requestedProvider = normalizeProvider(provider);
    const { target, doc } = await loadSurface(db, scope);
    const state = readProviderState(doc);
    const currentProvider = state.activeProvider;
    const hasExistingCredential = !!(state.credentials[currentProvider] && state.credentials[currentProvider].ciphertext);

    const validation = await validateForProvider(db, requestedProvider, apiKey);
    if (!validation.ok) {
        return {
            ok: false,
            httpStatus: 400,
            body: {
                success: false,
                code: errorCodeForStatus(validation.status),
                message: validation.message || 'API key validation failed',
                detail: validation.detail,
                llmProvider: requestedProvider
            }
        };
    }

    const credential = buildKeySubdocument(apiKey, updatedBy, requestedProvider);
    const activate = !hasExistingCredential || requestedProvider === currentProvider;
    await db.collection(target.collection).updateOne(
        target.filter,
        {
            $set: {
                ...credentialSetFields(requestedProvider, credential, { activate }),
                updatedAt: new Date()
            }
        },
        { upsert: target.collection === 'settings' }
    );
    evictScope(registry, scope);

    const updated = await db.collection(target.collection).findOne(target.filter);
    return {
        ok: true,
        httpStatus: 200,
        body: {
            success: true,
            message: `${providerLabel(requestedProvider)} API key saved`,
            ...publicProviderKeyState(updated),
            migration: null
        }
    };
}

/**
 * Prepare all content visible to a surface for a stored provider. The current
 * provider remains active while work runs; the runner switches atomically only
 * after every item is ready. A newly copied surface can opt into being disabled
 * until this first preparation succeeds.
 */
async function prepareStoredProvider(db, {
    scope,
    provider,
    requestedBy = null,
    disableUntilReady = false
}) {
    const requestedProvider = normalizeProvider(provider);
    const { target, doc } = await loadSurface(db, scope);
    const state = readProviderState(doc);
    const credential = state.credentials[requestedProvider];

    if (!credential || !credential.ciphertext) {
        return {
            ok: false,
            httpStatus: 400,
            body: {
                success: false,
                code: 'LLM_KEY_MISSING',
                message: `Save a ${providerLabel(requestedProvider)} API key before preparing material.`
            }
        };
    }
    if (credential.status !== KEY_STATUSES.VALID) {
        return {
            ok: false,
            httpStatus: 400,
            body: {
                success: false,
                code: errorCodeForStatus(credential.status),
                message: `The saved ${providerLabel(requestedProvider)} key must be valid before preparing material.`
            }
        };
    }

    const active = await migrations.findActiveMigration(db, scope);
    if (active) {
        return {
            ok: false,
            httpStatus: 409,
            body: {
                success: false,
                code: 'LLM_MIGRATION_ACTIVE',
                message: 'Course material is already being prepared.',
                migration: migrations.publicMigrationView(active)
            }
        };
    }

    let profile;
    try {
        profile = await embeddingProfileFor(db, requestedProvider);
    } catch (error) {
        if (error.code !== 'LLM_PROVIDER_UNCONFIGURED') throw error;
        return {
            ok: false,
            httpStatus: 409,
            body: { success: false, code: error.code, message: error.message }
        };
    }
    const { courseIds, includeNotes } = await migrationScopeContent(db, scope);
    const { job } = await migrations.createMigration(db, {
        scope,
        kind: 'prepare',
        fromProvider: state.activeProvider,
        toProvider: requestedProvider,
        profile,
        courseIds,
        includeNotes,
        requestedBy
    });

    // Nothing needs rebuilding: activate synchronously so a copied course that
    // reused current target-profile vectors never flashes a preparing state.
    if ((job.totals?.total || 0) === 0) {
        await migrations.activateProvider(db, scope, requestedProvider);
        await migrations.finishMigration(
            db,
            job.migrationId,
            migrations.MIGRATION_STATUSES.COMPLETED
        );
        const completedJob = await migrations.getMigration(db, job.migrationId);
        const updated = await db.collection(target.collection).findOne(target.filter);
        return {
            ok: true,
            httpStatus: 200,
            body: {
                success: true,
                message: `${providerLabel(requestedProvider)} material is ready.`,
                ...publicProviderKeyState(updated),
                migration: migrations.publicMigrationView(completedJob)
            }
        };
    }

    await db.collection(target.collection).updateOne(
        target.filter,
        {
            $set: {
                pendingLlmProvider: requestedProvider,
                providerMigrationId: job.migrationId,
                ...(disableUntilReady ? { aiPreparationRequired: true } : {}),
                updatedAt: new Date()
            }
        }
    );
    migrationRunner.startMigration(db, job.migrationId);

    const updated = await db.collection(target.collection).findOne(target.filter);
    return {
        ok: true,
        httpStatus: 202,
        body: {
            success: true,
            message: `Preparing course material for ${providerLabel(requestedProvider)}. `
                + `It will switch automatically when preparation finishes.`,
            ...publicProviderKeyState(updated),
            migration: migrations.publicMigrationView(job)
        }
    };
}

/**
 * Re-validate the stored key for a surface's chosen platform and persist the
 * resulting status.
 */
async function testSurfaceKey(db, { scope, provider = null, registry = null }) {
    const { target, doc } = await loadSurface(db, scope);
    const state = readProviderState(doc);
    const targetProvider = provider ? normalizeProvider(provider) : state.activeProvider;
    const credential = credentialForProvider(doc, targetProvider);

    if (!credential || !credential.ciphertext) {
        return {
            ok: false,
            httpStatus: 400,
            body: {
                success: false,
                code: 'LLM_KEY_MISSING',
                message: `No ${providerLabel(targetProvider)} API key is saved for this surface.`,
                llmProvider: targetProvider
            }
        };
    }

    const validation = await validateForProvider(db, targetProvider, decryptApiKey(credential.ciphertext));
    const now = new Date();
    const status = validation.ok ? KEY_STATUSES.VALID : validation.status;

    const set = {
        [`llmCredentials.${targetProvider}.status`]: status,
        [`llmCredentials.${targetProvider}.updatedAt`]: now,
        updatedAt: now
    };
    if (validation.ok) set[`llmCredentials.${targetProvider}.validatedAt`] = now;
    if (targetProvider === 'openai' && doc && doc.llmApiKey) {
        set['llmApiKey.status'] = status;
        set['llmApiKey.updatedAt'] = now;
        if (validation.ok) set['llmApiKey.validatedAt'] = now;
    }

    await db.collection(target.collection).updateOne(target.filter, { $set: set });
    evictScope(registry, scope);

    return {
        ok: validation.ok,
        httpStatus: validation.ok ? 200 : 400,
        body: {
            success: validation.ok,
            code: validation.ok ? undefined : errorCodeForStatus(status),
            message: validation.ok
                ? `${providerLabel(targetProvider)} API key is valid`
                : validation.message,
            llmProvider: targetProvider,
            llmKey: {
                ...publicKeySummary(credential),
                status,
                validatedAt: validation.ok ? now : credential.validatedAt,
                updatedAt: now
            },
            aiAvailable: validation.ok
        }
    };
}

/**
 * Activate a stored provider only when all currently-visible content is already
 * prepared for it. Preparation is an explicit action, separate from switching.
 */
async function switchToStoredProvider(db, { scope, provider, requestedBy = null, registry = null }) {
    const requestedProvider = normalizeProvider(provider);
    const { target, doc } = await loadSurface(db, scope);
    const state = readProviderState(doc);
    const credential = state.credentials[requestedProvider];

    if (!credential || !credential.ciphertext) {
        return {
            ok: false,
            httpStatus: 400,
            body: {
                success: false,
                code: 'LLM_KEY_MISSING',
                message: `No ${providerLabel(requestedProvider)} API key is saved for this surface. Enter one to switch.`,
                llmProvider: state.activeProvider
            }
        };
    }

    if (requestedProvider === state.activeProvider) {
        return {
            ok: true,
            httpStatus: 200,
            body: {
                success: true,
                message: `Already using ${providerLabel(requestedProvider)}`,
                ...publicProviderKeyState(doc),
                migration: null
            }
        };
    }

    let profile;
    try {
        profile = await embeddingProfileFor(db, requestedProvider);
    } catch (error) {
        if (error.code !== 'LLM_PROVIDER_UNCONFIGURED') throw error;
        return {
            ok: false,
            httpStatus: 409,
            body: { success: false, code: error.code, message: error.message }
        };
    }
    const { courseIds, includeNotes } = await migrationScopeContent(db, scope);
    const { items } = await migrations.calculateWork({ db, profile, courseIds, includeNotes });
    if (items.length > 0) {
        return {
            ok: false,
            httpStatus: 409,
            body: {
                success: false,
                code: 'LLM_PROVIDER_NOT_PREPARED',
                message: `${items.length} item(s) still need to be prepared for ${providerLabel(requestedProvider)}. `
                    + `Choose “Prepare material for ${providerLabel(requestedProvider)}” first.`,
                llmProvider: state.activeProvider,
                needsPreparation: true,
                unpreparedCount: items.length
            }
        };
    }

    await migrations.activateProvider(db, scope, requestedProvider);
    await migrations.abandonPendingProvider(db, scope);
    evictScope(registry, scope);

    const updated = await db.collection(target.collection).findOne(target.filter);
    return {
        ok: true,
        httpStatus: 200,
        body: {
            success: true,
            message: `Now using ${providerLabel(requestedProvider)}.`,
            ...publicProviderKeyState(updated),
            migration: null
        }
    };
}

/**
 * Current provider + key status + in-flight migration for a surface.
 */
async function surfaceKeyState(db, scope) {
    const { doc } = await loadSurface(db, scope);
    const state = publicProviderKeyState(doc);
    const job = state.providerMigrationId
        ? await migrations.getMigration(db, state.providerMigrationId)
        : await migrations.findActiveMigration(db, scope);

    return {
        ...state,
        migration: migrations.publicMigrationView(job)
    };
}

module.exports = {
    embeddingProfileFor,
    errorCodeForStatus,
    evictScope,
    migrationScopeContent,
    prepareStoredProvider,
    saveSurfaceKey,
    surfaceKeyState,
    switchToStoredProvider,
    testSurfaceKey,
    validateForProvider,
    validateProxyChatSettings,
    validateProxyEmbeddingModel,
    discoverProxyReasoningEfforts
};
