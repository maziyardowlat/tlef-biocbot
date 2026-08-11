/**
 * Admin model settings
 *
 * The effective chat model, embedding model and reasoning effort for each
 * platform live in MongoDB:
 *
 *   {
 *     _id: 'llm',
 *     providers: {
 *       openai:            { chatModel, embeddingModel, embeddingRevision, reasoningEffort },
 *       'ubc-llm-sandbox': { chatModel, embeddingModel, embeddingRevision, reasoningEffort }
 *     },
 *     pendingEmbedding: { <provider>: { embeddingModel, embeddingRevision, migrationId, startedAt } }
 *   }
 *
 * Environment variables only supply bootstrap defaults for a fresh install.
 * After initialization the database is authoritative.
 *
 * Backward compatibility: the previous shape stored a single flat
 * `{ model, reasoningEffort }` pair for whatever `LLM_PROVIDER` happened to be.
 * That document is read as settings for the env-configured provider so an
 * upgrade never loses an admin's chosen model.
 */

const {
    DEFAULT_PROFILE_REVISION,
    buildEmbeddingProfile
} = require('./embeddingConfig');
const {
    SELECTABLE_PROVIDERS,
    normalizeProvider
} = require('./llmProviders');
const {
    allowedEmbeddingModelsForProvider,
    allowedModelsForProvider,
    configuredDefaultModel,
    configuredProvider,
    defaultEmbeddingModelForProvider,
    fallbackModelForProvider,
    normalizeReasoningEffort,
    supportsReasoning
} = require('./llmModels');

const SETTINGS_ID = 'llm';
const CACHE_TTL_MS = 30 * 1000;

let cache = null;
let cacheAt = 0;

function invalidateCache() {
    cache = null;
    cacheAt = 0;
}

/**
 * Env-derived defaults for a platform, used until an admin saves settings.
 */
function bootstrapDefaults(provider) {
    const chatModel = fallbackModelForProvider(provider, configuredDefaultModel(provider));
    return {
        chatModel,
        embeddingModel: defaultEmbeddingModelForProvider(provider),
        embeddingRevision: DEFAULT_PROFILE_REVISION,
        reasoningEffort: normalizeReasoningEffort(provider, chatModel)
    };
}

/**
 * Coerce a stored (or requested) settings fragment into a valid, complete
 * per-provider settings object.
 */
function normalizeProviderSettings(provider, stored) {
    const defaults = bootstrapDefaults(provider);
    const source = stored && typeof stored === 'object' ? stored : {};

    const chatModel = allowedModelsForProvider(provider).includes(source.chatModel)
        ? source.chatModel
        : defaults.chatModel;

    const embeddingModel = allowedEmbeddingModelsForProvider(provider).includes(source.embeddingModel)
        ? source.embeddingModel
        : defaults.embeddingModel;

    const embeddingRevision = typeof source.embeddingRevision === 'string' && source.embeddingRevision.trim()
        ? source.embeddingRevision.trim()
        : DEFAULT_PROFILE_REVISION;

    return {
        chatModel,
        embeddingModel,
        embeddingRevision,
        reasoningEffort: normalizeReasoningEffort(provider, chatModel, source.reasoningEffort)
    };
}

/**
 * Read the raw settings document and normalize it into a complete map keyed by
 * provider. Handles both the current `providers` shape and the legacy flat one.
 *
 * @param {Object|null} doc - The `_id: 'llm'` document (or null)
 * @returns {Object} { providers: {...}, pendingEmbedding: {...} }
 */
function normalizeSettingsDocument(doc) {
    const providersSource = (doc && doc.providers && typeof doc.providers === 'object')
        ? doc.providers
        : {};

    // Legacy flat document: { model, reasoningEffort } for the env provider.
    const legacyProvider = normalizeProvider(configuredProvider(), null);
    const hasLegacyFlat = doc && !doc.providers && typeof doc.model === 'string';

    const providers = {};
    for (const provider of SELECTABLE_PROVIDERS) {
        let source = providersSource[provider];
        if (!source && hasLegacyFlat && provider === legacyProvider) {
            source = { chatModel: doc.model, reasoningEffort: doc.reasoningEffort };
        }
        providers[provider] = normalizeProviderSettings(provider, source);
    }

    const pendingEmbedding = {};
    const pendingSource = (doc && doc.pendingEmbedding && typeof doc.pendingEmbedding === 'object')
        ? doc.pendingEmbedding
        : {};
    for (const provider of SELECTABLE_PROVIDERS) {
        const pending = pendingSource[provider];
        if (pending && pending.embeddingModel) {
            pendingEmbedding[provider] = {
                embeddingModel: pending.embeddingModel,
                embeddingRevision: pending.embeddingRevision || DEFAULT_PROFILE_REVISION,
                migrationId: pending.migrationId || null,
                startedAt: pending.startedAt || null
            };
        }
    }

    return { providers, pendingEmbedding };
}

/**
 * Effective model settings for every platform, read from MongoDB with a short
 * TTL cache. Falls back to env bootstrap defaults when the DB is unavailable.
 *
 * @param {Object} db - MongoDB database handle
 * @param {Object} [options] - { force: true } to bypass the cache
 */
async function getAllProviderSettings(db, options = {}) {
    const now = Date.now();
    if (!options.force && cache && (now - cacheAt) < CACHE_TTL_MS) {
        return cache;
    }

    let doc = null;
    if (db) {
        try {
            doc = await db.collection('settings').findOne({ _id: SETTINGS_ID });
        } catch (error) {
            // Runtime callers keep serving on bootstrap defaults when Mongo
            // hiccups; the admin screen asks to see the failure instead.
            if (options.throwOnError) throw error;
            console.warn('⚠️ Could not load admin model settings, using bootstrap defaults:', error.message);
        }
    }

    const normalized = normalizeSettingsDocument(doc);
    cache = normalized;
    cacheAt = now;
    return normalized;
}

/**
 * Effective settings for a single platform.
 */
async function getProviderSettings(db, provider, options = {}) {
    const normalizedProvider = normalizeProvider(provider);
    const all = await getAllProviderSettings(db, options);
    return all.providers[normalizedProvider];
}


/**
 * Build the active embedding profile for a platform, optionally binding a
 * decrypted, surface-scoped API key and the provider endpoint.
 */
async function getEmbeddingProfile(db, provider, { apiKey = null, endpoint = null, force = false } = {}) {
    const normalizedProvider = normalizeProvider(provider);
    const settings = await getProviderSettings(db, normalizedProvider, { force });
    return buildEmbeddingProfile({
        provider: normalizedProvider,
        embeddingModel: settings.embeddingModel,
        revision: settings.embeddingRevision,
        endpoint,
        apiKey
    });
}

/**
 * Persist chat-side settings for one platform. Chat model and reasoning effort
 * take effect immediately — no re-indexing is involved.
 */
async function saveChatSettings(db, provider, { chatModel, reasoningEffort }, updatedBy = null) {
    const normalizedProvider = normalizeProvider(provider);
    if (!allowedModelsForProvider(normalizedProvider).includes(chatModel)) {
        const error = new Error(
            `Invalid chat model for ${normalizedProvider}. Allowed: ${allowedModelsForProvider(normalizedProvider).join(', ')}`
        );
        error.code = 'INVALID_CHAT_MODEL';
        throw error;
    }

    const effort = normalizeReasoningEffort(normalizedProvider, chatModel, reasoningEffort);
    await db.collection('settings').updateOne(
        { _id: SETTINGS_ID },
        {
            $set: {
                [`providers.${normalizedProvider}.chatModel`]: chatModel,
                [`providers.${normalizedProvider}.reasoningEffort`]: effort,
                updatedAt: new Date(),
                updatedBy
            }
        },
        { upsert: true }
    );

    invalidateCache();
    return { chatModel, reasoningEffort: effort, supportsReasoning: supportsReasoning(normalizedProvider, chatModel) };
}

/**
 * Stage an embedding-model change. The previous profile stays active until the
 * migration completes — this only records the intent.
 */
async function stagePendingEmbedding(db, provider, { embeddingModel, embeddingRevision, migrationId }) {
    const normalizedProvider = normalizeProvider(provider);
    if (!allowedEmbeddingModelsForProvider(normalizedProvider).includes(embeddingModel)) {
        const error = new Error(
            `Invalid embedding model for ${normalizedProvider}. Allowed: ${allowedEmbeddingModelsForProvider(normalizedProvider).join(', ')}`
        );
        error.code = 'INVALID_EMBEDDING_MODEL';
        throw error;
    }

    const pending = {
        embeddingModel,
        embeddingRevision: embeddingRevision || DEFAULT_PROFILE_REVISION,
        migrationId: migrationId || null,
        startedAt: new Date()
    };

    await db.collection('settings').updateOne(
        { _id: SETTINGS_ID },
        { $set: { [`pendingEmbedding.${normalizedProvider}`]: pending, updatedAt: new Date() } },
        { upsert: true }
    );

    invalidateCache();
    return pending;
}

/**
 * Promote a staged embedding model to active. Called only once every required
 * index for the new profile is current. Old collections are never deleted, so
 * rollback is a matter of re-activating the previous model.
 *
 * @param {Object} [expected] - The profile the finished migration actually
 *   prepared, as `{ embeddingModel, embeddingRevision }`. A job must never
 *   activate a model it did not index: if an admin stages model B while model
 *   A is still running, A completing would otherwise promote B before B has any
 *   vectors. When the staged model no longer matches, the staged change is left
 *   alone for its own migration to finish.
 */
async function activatePendingEmbedding(db, provider, expected = null) {
    const normalizedProvider = normalizeProvider(provider);
    const doc = await db.collection('settings').findOne({ _id: SETTINGS_ID });
    const { pendingEmbedding } = normalizeSettingsDocument(doc);
    const pending = pendingEmbedding[normalizedProvider];
    if (!pending) return null;

    if (expected) {
        const revision = expected.embeddingRevision || DEFAULT_PROFILE_REVISION;
        if (pending.embeddingModel !== expected.embeddingModel
            || pending.embeddingRevision !== revision) {
            console.warn(
                `⚠️ Not activating ${normalizedProvider} embedding model ${expected.embeddingModel}: `
                + `${pending.embeddingModel} is staged instead`
            );
            return null;
        }
    }

    await db.collection('settings').updateOne(
        { _id: SETTINGS_ID },
        {
            $set: {
                [`providers.${normalizedProvider}.embeddingModel`]: pending.embeddingModel,
                [`providers.${normalizedProvider}.embeddingRevision`]: pending.embeddingRevision,
                updatedAt: new Date()
            },
            $unset: { [`pendingEmbedding.${normalizedProvider}`]: '' }
        }
    );

    invalidateCache();
    return pending;
}

async function clearPendingEmbedding(db, provider) {
    const normalizedProvider = normalizeProvider(provider);
    await db.collection('settings').updateOne(
        { _id: SETTINGS_ID },
        { $unset: { [`pendingEmbedding.${normalizedProvider}`]: '' }, $set: { updatedAt: new Date() } }
    );
    invalidateCache();
}

module.exports = {
    CACHE_TTL_MS,
    SETTINGS_ID,
    activatePendingEmbedding,
    bootstrapDefaults,
    clearPendingEmbedding,
    getAllProviderSettings,
    getEmbeddingProfile,
    getProviderSettings,
    invalidateCache,
    normalizeProviderSettings,
    normalizeSettingsDocument,
    saveChatSettings,
    stagePendingEmbedding
};
