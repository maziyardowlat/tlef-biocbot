const OPENAI_DEFAULT_MODEL = 'gpt-4.1-mini';
const SANDBOX_DEFAULT_MODEL = 'qwen3.6-35b-a3b';

const MODEL_PROFILES = Object.freeze({
    'gpt-4.1-mini': { providers: ['openai'], reasoningEfforts: [], defaultReasoningEffort: 'minimal' },
    'gpt-5-nano': { providers: ['openai'], reasoningEfforts: ['minimal', 'low', 'medium', 'high'], defaultReasoningEffort: 'minimal' },
    'gpt-5.4-nano': { providers: ['openai'], reasoningEfforts: ['none', 'low', 'medium', 'high', 'xhigh'], defaultReasoningEffort: 'low' },
    'gpt-5.6-luna': { providers: ['openai'], reasoningEfforts: ['none', 'low', 'medium', 'high', 'xhigh'], defaultReasoningEffort: 'low' },
    'qwen3.6-35b-a3b': {
        providers: ['ubc-llm-sandbox'],
        // `none` is important for short/structured calls: b3000 translates it
        // to chat_template_kwargs.enable_thinking=false for Qwen3 models.
        reasoningEfforts: ['none', 'low', 'medium', 'high'],
        defaultReasoningEffort: 'none',
        // The sandbox reports a 32K total context window. Reserving all 32K
        // for output leaves no room for BioCBot's system prompt or RAG context.
        maxOutputTokens: 4096
    },
    'gpt-oss-120b': {
        providers: ['ubc-llm-sandbox'],
        reasoningEfforts: ['low', 'medium', 'high'],
        defaultReasoningEffort: 'low'
    }
});

const PROVIDER_MODELS = Object.freeze({
    openai: ['gpt-4.1-mini', 'gpt-5-nano', 'gpt-5.4-nano', 'gpt-5.6-luna'],
    'ubc-llm-sandbox': ['qwen3.6-35b-a3b', 'gpt-oss-120b']
});

// --- Embedding models -------------------------------------------------------
// Sandbox surfaces must embed on the UBC Sandbox/B300 — never with OpenAI —
// so the allowed embedding models are strictly partitioned by provider.
const OPENAI_DEFAULT_EMBEDDING_MODEL = 'text-embedding-3-small';
const SANDBOX_DEFAULT_EMBEDDING_MODEL = 'qwen3-embedding-0.6b';

const PROVIDER_EMBEDDING_MODELS = Object.freeze({
    openai: ['text-embedding-3-small', 'text-embedding-3-large', 'text-embedding-ada-002'],
    'ubc-llm-sandbox': ['qwen3-embedding-0.6b']
});

function configuredProvider() {
    return process.env.LLM_PROVIDER || 'openai';
}

function allowedEmbeddingModelsForProvider(provider) {
    if (provider === 'ollama') {
        return process.env.LLM_EMBEDDING_MODEL ? [process.env.LLM_EMBEDDING_MODEL] : ['nomic-embed-text'];
    }
    const models = [...(PROVIDER_EMBEDDING_MODELS[provider] || PROVIDER_EMBEDDING_MODELS.openai)];
    // Mirror the chat-model policy: keep an explicitly configured sandbox model
    // selectable even if the gateway adds it before this app is updated.
    const configured = envEmbeddingModelForProvider(provider);
    if (provider === 'ubc-llm-sandbox' && configured && !models.includes(configured)) {
        models.push(configured);
    }
    return models;
}

/**
 * Read a provider-scoped embedding model from the environment.
 *
 * `LLM_EMBEDDING_MODEL` is the historical single-provider variable, so it is
 * only honoured when its value actually belongs to the provider being asked
 * about. Otherwise a deployment configured for the sandbox would silently hand
 * `qwen3-embedding-0.6b` to OpenAI surfaces.
 */
function envEmbeddingModelForProvider(provider) {
    const explicit = provider === 'ubc-llm-sandbox'
        ? process.env.SANDBOX_EMBEDDING_MODEL
        : process.env.OPENAI_EMBEDDING_MODEL;
    if (explicit) return explicit;

    const shared = process.env.LLM_EMBEDDING_MODEL;
    if (!shared) return null;
    const known = PROVIDER_EMBEDDING_MODELS[provider] || [];
    if (known.includes(shared)) return shared;
    // A sandbox deployment may point at a self-hosted embedding model that is
    // not in the table yet; trust it only when the env provider matches.
    if (provider === 'ubc-llm-sandbox' && configuredProvider() === 'ubc-llm-sandbox') return shared;
    if (provider === 'ollama') return shared;
    return null;
}

/**
 * Bootstrap default embedding model for a provider — used only until an admin
 * stores model settings in MongoDB.
 */
function defaultEmbeddingModelForProvider(provider) {
    if (provider === 'ollama') {
        return process.env.LLM_EMBEDDING_MODEL || 'nomic-embed-text';
    }
    return envEmbeddingModelForProvider(provider)
        || (provider === 'ubc-llm-sandbox'
            ? SANDBOX_DEFAULT_EMBEDDING_MODEL
            : OPENAI_DEFAULT_EMBEDDING_MODEL);
}

function isAllowedEmbeddingModel(provider, model) {
    return allowedEmbeddingModelsForProvider(provider).includes(model);
}

function configuredDefaultModel(provider = configuredProvider()) {
    if (provider === 'ubc-llm-sandbox') {
        return process.env.LLM_DEFAULT_MODEL || SANDBOX_DEFAULT_MODEL;
    }
    if (provider === 'ollama') {
        return process.env.OLLAMA_MODEL || null;
    }
    return process.env.OPENAI_MODEL || OPENAI_DEFAULT_MODEL;
}

function allowedModelsForProvider(provider, defaultModel = configuredDefaultModel(provider)) {
    if (provider === 'ollama') {
        return defaultModel ? [defaultModel] : [];
    }

    const models = [...(PROVIDER_MODELS[provider] || PROVIDER_MODELS.openai)];
    // The sandbox roster is intentionally open-ended. Keep a configured model
    // selectable even when the gateway adds it before this app is updated.
    if (provider === 'ubc-llm-sandbox' && defaultModel && !models.includes(defaultModel)) {
        models.push(defaultModel);
    }
    return models;
}

function fallbackModelForProvider(provider, defaultModel = configuredDefaultModel(provider)) {
    const allowed = allowedModelsForProvider(provider, defaultModel);
    if (defaultModel && allowed.includes(defaultModel)) return defaultModel;
    if (provider === 'ubc-llm-sandbox') return SANDBOX_DEFAULT_MODEL;
    return allowed[0] || OPENAI_DEFAULT_MODEL;
}

function modelProfile(provider, model) {
    const profile = MODEL_PROFILES[model];
    if (profile && profile.providers.includes(provider)) return profile;

    if (provider === 'ubc-llm-sandbox') {
        // b3000 deliberately lets the sandbox gateway judge newly-added
        // self-hosted models instead of maintaining a brittle toolkit allowlist.
        return {
            providers: [provider],
            reasoningEfforts: ['none', 'minimal', 'low', 'medium', 'high', 'xhigh', 'max'],
            defaultReasoningEffort: 'none'
        };
    }

    return { providers: [provider], reasoningEfforts: [], defaultReasoningEffort: 'minimal' };
}

function reasoningEffortsForModel(provider, model) {
    return [...modelProfile(provider, model).reasoningEfforts];
}

function supportsReasoning(provider, model) {
    return reasoningEffortsForModel(provider, model).length > 0;
}

function maxOutputTokensForModel(provider, model) {
    const value = modelProfile(provider, model).maxOutputTokens;
    return Number.isInteger(value) && value > 0 ? value : null;
}

function normalizeReasoningEffort(provider, model, requested) {
    const profile = modelProfile(provider, model);
    if (profile.reasoningEfforts.length === 0) return 'minimal';
    if (profile.reasoningEfforts.includes(requested)) return requested;
    if (requested === 'minimal' && profile.reasoningEfforts.includes('low')) return 'low';
    if (['xhigh', 'max'].includes(requested) && profile.reasoningEfforts.includes('high')) return 'high';
    return profile.defaultReasoningEffort;
}

function catalogForProvider(provider = configuredProvider(), defaultModel = configuredDefaultModel(provider)) {
    const allowedModels = allowedModelsForProvider(provider, defaultModel);
    return {
        provider,
        defaultModel: fallbackModelForProvider(provider, defaultModel),
        allowedModels,
        reasoningEffortsByModel: Object.fromEntries(
            allowedModels.map(model => [model, reasoningEffortsForModel(provider, model)])
        ),
        defaultReasoningEffortByModel: Object.fromEntries(
            allowedModels.map(model => [model, modelProfile(provider, model).defaultReasoningEffort])
        )
    };
}

/**
 * Full admin-facing catalog for a platform: chat models, embedding models and
 * reasoning efforts. Consumed by the Platforms and Models settings screen.
 */
function adminCatalogForProvider(provider) {
    const chat = catalogForProvider(provider, configuredDefaultModel(provider));
    return {
        ...chat,
        allowedEmbeddingModels: allowedEmbeddingModelsForProvider(provider),
        defaultEmbeddingModel: defaultEmbeddingModelForProvider(provider)
    };
}

module.exports = {
    OPENAI_DEFAULT_EMBEDDING_MODEL,
    OPENAI_DEFAULT_MODEL,
    PROVIDER_EMBEDDING_MODELS,
    SANDBOX_DEFAULT_EMBEDDING_MODEL,
    SANDBOX_DEFAULT_MODEL,
    adminCatalogForProvider,
    allowedEmbeddingModelsForProvider,
    allowedModelsForProvider,
    catalogForProvider,
    configuredDefaultModel,
    configuredProvider,
    defaultEmbeddingModelForProvider,
    envEmbeddingModelForProvider,
    fallbackModelForProvider,
    isAllowedEmbeddingModel,
    maxOutputTokensForModel,
    normalizeReasoningEffort,
    reasoningEffortsForModel,
    supportsReasoning
};
