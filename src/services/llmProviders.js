/**
 * LLM Providers
 *
 * The single source of truth for which AI platforms BioCBot supports, what
 * instructors see them called, and the help text shown next to each platform's
 * API-key field.
 *
 * Instructors choose a *platform label* ("OpenAI Chat GPT" / "UBC On-Premise
 * LLM"). They never pick a chat or embedding model — system admins configure
 * those per platform in the Platforms and Models settings (see
 * services/adminModelSettings.js).
 */

const PROVIDERS = Object.freeze({
    OPENAI: 'openai',
    SANDBOX: 'ubc-llm-sandbox',
    PROXY: 'ubc-llm-proxy'
});

// Providers an instructor can select for a keyed surface. `ollama` remains
// supported as a local development runtime but is never offered in the UI.
const SELECTABLE_PROVIDERS = Object.freeze([
    PROVIDERS.OPENAI,
    PROVIDERS.SANDBOX,
    PROVIDERS.PROXY
]);

const DEFAULT_PROVIDER = PROVIDERS.OPENAI;

// Instructor-facing platform names. The internal provider ids above never
// change with these — only what a person reads.
const PROVIDER_LABELS = Object.freeze({
    [PROVIDERS.OPENAI]: 'OpenAI Chat GPT',
    [PROVIDERS.SANDBOX]: 'UBC On-Premise LLM',
    [PROVIDERS.PROXY]: 'UBC LLM Proxy',
    ollama: 'Ollama (local)'
});

const SUPPORT_EMAIL = 'LT.hub@ubc.ca';

const PROVIDER_HELP_TEXT = Object.freeze({
    [PROVIDERS.OPENAI]: 'Feel free to use your own OpenAI API key, or contact the support team for assistance.',
    [PROVIDERS.SANDBOX]: 'Contact the LTIC team to request a UBC LLM Sandbox API key.',
    [PROVIDERS.PROXY]: 'Enter the UBC LLM Proxy key issued for this AI surface. Available models are loaded from the proxy after the key is validated.'
});

const PROVIDER_KEY_PLACEHOLDERS = Object.freeze({
    [PROVIDERS.OPENAI]: 'sk-...',
    [PROVIDERS.SANDBOX]: 'UBC LLM Sandbox API key',
    [PROVIDERS.PROXY]: 'UBC LLM Proxy API key'
});

function isSelectableProvider(provider) {
    return SELECTABLE_PROVIDERS.includes(provider);
}

function isKnownProvider(provider) {
    return isSelectableProvider(provider) || provider === 'ollama';
}

/**
 * Coerce arbitrary input into a supported provider id.
 * @param {*} value - Raw value (request body, Mongo document, env var)
 * @param {string} fallback - Provider to use when `value` is not selectable
 * @returns {string} A selectable provider id
 */
function normalizeProvider(value, fallback = DEFAULT_PROVIDER) {
    const candidate = String(value || '').trim().toLowerCase();
    if (isSelectableProvider(candidate)) return candidate;
    return isSelectableProvider(fallback) ? fallback : DEFAULT_PROVIDER;
}

function providerLabel(provider) {
    return PROVIDER_LABELS[provider] || provider || 'Unknown';
}

function providerHelpText(provider) {
    return PROVIDER_HELP_TEXT[provider] || PROVIDER_HELP_TEXT[DEFAULT_PROVIDER];
}

function providerKeyPlaceholder(provider) {
    return PROVIDER_KEY_PLACEHOLDERS[provider] || 'API key';
}

/**
 * Platform options for the instructor-facing selector. Deliberately carries no
 * model names — instructors must not see or choose exact models.
 * @returns {Array<Object>}
 */
function providerCatalog() {
    return SELECTABLE_PROVIDERS.map(provider => ({
        provider,
        label: providerLabel(provider),
        helpText: providerHelpText(provider),
        keyPlaceholder: providerKeyPlaceholder(provider),
        supportEmail: SUPPORT_EMAIL
    }));
}

module.exports = {
    DEFAULT_PROVIDER,
    PROVIDERS,
    PROVIDER_HELP_TEXT,
    PROVIDER_KEY_PLACEHOLDERS,
    PROVIDER_LABELS,
    SELECTABLE_PROVIDERS,
    SUPPORT_EMAIL,
    isKnownProvider,
    isSelectableProvider,
    normalizeProvider,
    providerCatalog,
    providerHelpText,
    providerKeyPlaceholder,
    providerLabel
};
