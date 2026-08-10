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

function configuredProvider() {
    return process.env.LLM_PROVIDER || 'openai';
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
        )
    };
}

module.exports = {
    OPENAI_DEFAULT_MODEL,
    SANDBOX_DEFAULT_MODEL,
    allowedModelsForProvider,
    catalogForProvider,
    configuredDefaultModel,
    configuredProvider,
    fallbackModelForProvider,
    maxOutputTokensForModel,
    normalizeReasoningEffort,
    reasoningEffortsForModel,
    supportsReasoning
};
