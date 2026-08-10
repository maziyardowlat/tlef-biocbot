/**
 * Qdrant maintenance helpers for multi-profile collections.
 *
 * Deleting content, sweeping orphans and reporting diagnostics all have to
 * work across every collection a piece of content was ever indexed into, not
 * just the collection the surface happens to use today.
 */

const QdrantService = require('./qdrantService');
const { buildEmbeddingProfile, documentsCollectionBase } = require('./embeddingConfig');
const {
    deleteDocumentFromAllCollections,
    indexedCollections
} = require('./embeddingIndexService');
const { SELECTABLE_PROVIDERS } = require('./llmProviders');
const { PROVIDER_EMBEDDING_MODELS } = require('./llmModels');

/**
 * Lazily create (and cache) a read/delete-only QdrantService per collection.
 * These never create a missing collection.
 */
function createMaintenanceFactory() {
    const cache = new Map();
    return async (_target, profile) => {
        if (cache.has(profile.collection)) return cache.get(profile.collection);
        const service = new QdrantService({
            skipEmbeddings: true,
            createCollectionIfMissing: false,
            embeddingProfile: profile
        });
        await service.initialize();
        if (service.collectionMissing) {
            cache.set(profile.collection, null);
            return null;
        }
        cache.set(profile.collection, service);
        return service;
    };
}

/**
 * Remove one document's vectors from every collection recorded in its
 * `embeddingIndexes` (plus the legacy collection for pre-tracking documents).
 */
async function deleteDocumentEverywhere(db, doc) {
    return deleteDocumentFromAllCollections(db, doc, createMaintenanceFactory());
}

/**
 * Remove many documents' vectors, reusing one set of per-collection clients.
 */
async function deleteDocumentsEverywhere(db, docs) {
    const factory = createMaintenanceFactory();
    const results = [];
    for (const doc of docs || []) {
        results.push(await deleteDocumentFromAllCollections(db, doc, factory));
    }
    return results;
}

/**
 * Every collection this deployment could hold vectors in, across all platforms
 * and their allowed embedding models. Used by diagnostics so an admin can see
 * per-profile collection health rather than a single global collection.
 */
function knownDocumentCollections() {
    const seen = new Map();
    seen.set(documentsCollectionBase(), {
        collection: documentsCollectionBase(),
        provider: 'openai',
        embeddingModel: 'text-embedding-3-small'
    });

    for (const provider of SELECTABLE_PROVIDERS) {
        for (const embeddingModel of (PROVIDER_EMBEDDING_MODELS[provider] || [])) {
            const profile = buildEmbeddingProfile({ provider, embeddingModel });
            if (!seen.has(profile.collection)) {
                seen.set(profile.collection, {
                    collection: profile.collection,
                    provider,
                    embeddingModel,
                    vectorSize: profile.vectorSize,
                    profileKey: profile.key
                });
            }
        }
    }
    return [...seen.values()];
}

module.exports = {
    createMaintenanceFactory,
    deleteDocumentEverywhere,
    deleteDocumentsEverywhere,
    indexedCollections,
    knownDocumentCollections
};
