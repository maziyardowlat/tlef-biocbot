const EMBEDDING_VECTOR_SIZES = Object.freeze({
    'text-embedding-3-small': 1536,
    'text-embedding-ada-002': 1536,
    'nomic-embed-text': 768,
    'qwen3-embedding-0.6b': 1024
});

const LEGACY_COLLECTION_MODELS = new Set([
    'text-embedding-3-small',
    'text-embedding-ada-002',
    'nomic-embed-text'
]);

function positiveInteger(value, fallback) {
    if (value === undefined || value === null || value === '') return fallback;
    const parsed = Number(value);
    if (!Number.isInteger(parsed) || parsed <= 0) {
        throw new Error(`QDRANT_VECTOR_SIZE must be a positive integer, received: ${value}`);
    }
    return parsed;
}

function vectorSizeForEmbeddingModel(model, override = process.env.QDRANT_VECTOR_SIZE) {
    return EMBEDDING_VECTOR_SIZES[model] || positiveInteger(override, 768);
}

function modelCollectionSuffix(model) {
    if (!model || LEGACY_COLLECTION_MODELS.has(model)) return '';
    return `_${String(model).toLowerCase().replace(/[^a-z0-9]+/g, '_').replace(/^_+|_+$/g, '')}`;
}

function collectionNameForEmbedding(baseName, model, explicitName) {
    if (explicitName) return explicitName;
    return `${baseName}${modelCollectionSuffix(model)}`;
}

module.exports = {
    EMBEDDING_VECTOR_SIZES,
    collectionNameForEmbedding,
    positiveInteger,
    vectorSizeForEmbeddingModel
};
