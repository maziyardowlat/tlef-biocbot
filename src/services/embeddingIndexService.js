/**
 * Embedding index tracking
 *
 * A document's `status: 'uploaded'` says nothing about *which* embedding model
 * indexed it, so it cannot answer the only question that matters when a surface
 * switches platforms: "does this content already have current vectors for the
 * profile I am about to search?"
 *
 * Every document and Super Chat note therefore carries an `embeddingIndexes`
 * map keyed by embedding-profile key:
 *
 *   embeddingIndexes: {
 *     'openai:text-embedding-3-small:v1': {
 *       provider, model, collection, contentHash, indexFingerprint,
 *       status: 'ready' | 'pending' | 'failed' | 'missing',
 *       indexedAt, error
 *     },
 *     'ubc-llm-sandbox:qwen3-embedding-0_6b:v1': { ... }
 *   }
 *
 * Note the map key uses the profile's `storageKey`, which is the profile key
 * with dots replaced by underscores. MongoDB reads a dot in an update key as a
 * path separator, and `qwen3-embedding-0.6b` contains one — the raw key would
 * silently create a nested object instead of one map entry. Each record still
 * carries provider/model/revision, so the exact model is never ambiguous.
 *
 * Indexes for different profiles are independent: switching a course to Sandbox
 * adds a Qwen index and leaves the OpenAI one intact, so switching back reuses
 * the existing OpenAI vectors instead of re-embedding everything.
 */

const crypto = require('crypto');
const { chunkingSignature } = require('./embeddingConfig');

const INDEX_STATUSES = Object.freeze({
    READY: 'ready',
    PENDING: 'pending',
    FAILED: 'failed',
    MISSING: 'missing'
});

// MongoDB collection names (not Qdrant collections).
const DOCUMENTS_COLLECTION = 'documents';
const NOTES_COLLECTION = 'superchat_notes';

/**
 * Normalize extracted text before hashing so cosmetic differences (line
 * endings, trailing whitespace, BOM) do not mark an index stale.
 */
function normalizeContent(content) {
    return String(content || '')
        .replace(/^﻿/, '')
        .replace(/\r\n?/g, '\n')
        .replace(/[ \t]+$/gm, '')
        .trim();
}

/**
 * SHA-256 over the normalized extracted text.
 * @param {string} content
 * @returns {string} hex digest
 */
function contentHash(content) {
    return crypto.createHash('sha256').update(normalizeContent(content), 'utf8').digest('hex');
}

/**
 * Fingerprint covering everything that changes the resulting vectors: the
 * content itself, the embedding profile (provider + model + revision) and the
 * chunking configuration.
 *
 * @param {Object} options
 * @param {string} options.contentHash
 * @param {Object} options.profile - Embedding profile
 * @returns {string} hex digest
 */
function indexFingerprint({ contentHash: hash, profile }) {
    const parts = [
        hash,
        profile.key,
        profile.provider,
        profile.embeddingModel,
        profile.revision,
        chunkingSignature(profile.chunking)
    ];
    return crypto.createHash('sha256').update(parts.join('|'), 'utf8').digest('hex');
}

// Content indexed before per-profile tracking existed carries no
// `embeddingIndexes`. Notes retain authoritative Qdrant point ids, so those can
// still prove a legacy OpenAI index. Document lifecycle status cannot: this app
// uses `uploaded` as its terminal state and the old `parsed` branch is not part
// of ingestion. Legacy document records are therefore recovered from completed
// provider-migration evidence instead of guessing from `status`.
const LEGACY_PROFILE = Object.freeze({
    provider: 'openai',
    model: 'text-embedding-3-small',
    revision: 'v1',
    key: 'openai:text-embedding-3-small:v1',
    // No dots in this key, so the storage form is identical.
    storageKey: 'openai:text-embedding-3-small:v1'
});

function hasLegacyVectors(doc) {
    if (!doc || typeof doc !== 'object') return false;
    if (doc.noteId) return Array.isArray(doc.qdrantPointIds) && doc.qdrantPointIds.length > 0;
    return false;
}

function legacyIndexRecord(doc) {
    const { documentsCollectionBase, notesCollectionBase } = require('./embeddingConfig');
    const collection = doc.noteId ? notesCollectionBase() : documentsCollectionBase();
    const hash = contentHash(doc.content);
    const profile = {
        ...LEGACY_PROFILE,
        embeddingModel: LEGACY_PROFILE.model,
        collection,
        chunking: undefined
    };

    return {
        provider: LEGACY_PROFILE.provider,
        model: LEGACY_PROFILE.model,
        revision: LEGACY_PROFILE.revision,
        collection,
        contentHash: hash,
        indexFingerprint: indexFingerprint({ contentHash: hash, profile }),
        status: INDEX_STATUSES.READY,
        indexedAt: doc.updatedAt || doc.createdAt || null,
        error: null,
        legacy: true
    };
}

function indexesOf(doc) {
    const stored = (doc && doc.embeddingIndexes && typeof doc.embeddingIndexes === 'object')
        ? doc.embeddingIndexes
        : {};

    if (Object.keys(stored).length > 0 || !hasLegacyVectors(doc)) return stored;
    return { [LEGACY_PROFILE.storageKey]: legacyIndexRecord(doc) };
}

function expectedCollectionFor(doc, profile) {
    return doc?.noteId ? profile.notesCollection : profile.collection;
}

/**
 * Does this content need (re)processing for the target profile?
 *
 * True when the index is missing, not ready, points at a different collection,
 * has a different content hash, or has a different fingerprint
 * (provider/model/revision/chunking changed).
 *
 * @param {Object} doc - Document or note with an optional `embeddingIndexes`
 * @param {Object} profile - Target embedding profile
 * @param {string} expectedHash - Current content hash
 * @returns {boolean}
 */
function needsIndexing(doc, profile, expectedHash) {
    const record = indexesOf(doc)[profile.storageKey];
    if (!record) return true;
    if (record.status !== INDEX_STATUSES.READY) return true;
    if (!record.collection || record.collection !== expectedCollectionFor(doc, profile)) return true;
    if (!record.contentHash || record.contentHash !== expectedHash) return true;

    const expectedFingerprint = indexFingerprint({ contentHash: expectedHash, profile });
    return record.indexFingerprint !== expectedFingerprint;
}

/**
 * Human-readable reason a target index needs work — surfaced in migration
 * progress so an instructor can see why an item is being re-embedded.
 */
function indexingReason(doc, profile, expectedHash) {
    const record = indexesOf(doc)[profile.storageKey];
    if (!record) return 'missing';
    if (record.status !== INDEX_STATUSES.READY) return record.status === INDEX_STATUSES.FAILED ? 'failed' : 'not-ready';
    if (!record.collection || record.collection !== expectedCollectionFor(doc, profile)) return 'collection-changed';
    if (record.contentHash !== expectedHash) return 'content-changed';
    if (record.indexFingerprint !== indexFingerprint({ contentHash: expectedHash, profile })) return 'profile-changed';
    return null;
}

/**
 * Every collection a piece of content has ever been indexed into. Deletion must
 * sweep all of these, not just the active profile's collection.
 *
 * @param {Object} doc
 * @returns {Array<{profileKey: string, collection: string, provider: string, model: string}>}
 */
function indexedCollections(doc) {
    const seen = new Map();
    for (const [profileKey, record] of Object.entries(indexesOf(doc))) {
        if (!record || !record.collection) continue;
        if (seen.has(record.collection)) continue;
        seen.set(record.collection, {
            profileKey,
            collection: record.collection,
            provider: record.provider || null,
            model: record.model || null,
            vectorSize: record.vectorSize || null
        });
    }
    return [...seen.values()];
}

function buildIndexRecord({ profile, hash, status, error = null, indexedAt = null, collection = null }) {
    return {
        provider: profile.provider,
        model: profile.embeddingModel,
        revision: profile.revision,
        vectorSize: profile.vectorSize,
        // Notes live in the profile's notes collection, documents in its
        // documents collection — the record must name the one actually holding
        // the vectors, because deletion sweeps every recorded collection.
        collection: collection || profile.collection,
        contentHash: hash,
        indexFingerprint: indexFingerprint({ contentHash: hash, profile }),
        status,
        indexedAt,
        error
    };
}

async function setIndexRecord(db, collectionName, filter, profile, record) {
    const set = { [`embeddingIndexes.${profile.storageKey}`]: record, updatedAt: new Date() };
    const existing = await db.collection(collectionName).findOne(filter);
    const stored = existing?.embeddingIndexes && typeof existing.embeddingIndexes === 'object'
        ? existing.embeddingIndexes
        : {};

    // Repair records created while OpenAI and Proxy accidentally shared a
    // physical collection for text-embedding-3-small. Moving the target record
    // to its isolated collection cannot prove that the old collection still
    // contains the other provider's vectors: the last migration may have
    // overwritten them. Mark every colliding provider record stale so switching
    // back runs the normal preparation flow instead of trusting mixed vectors.
    const previousTarget = stored[profile.storageKey];
    if (previousTarget?.collection && previousTarget.collection !== record.collection) {
        for (const [otherKey, otherRecord] of Object.entries(stored)) {
            if (otherKey === profile.storageKey || !otherRecord || typeof otherRecord !== 'object') continue;
            if (otherRecord.collection !== previousTarget.collection) continue;
            if (otherRecord.provider === profile.provider) continue;
            set[`embeddingIndexes.${otherKey}.status`] = INDEX_STATUSES.MISSING;
            set[`embeddingIndexes.${otherKey}.error`] =
                `Re-index required: ${previousTarget.collection} was previously shared with ${profile.provider}.`;
        }
    }

    // A pre-profile-tracking note can have real GPT vectors represented only by
    // its stored point ids. Materialize that implicit GPT record before adding
    // the first non-GPT profile. Documents are deliberately excluded because
    // their lifecycle status is not evidence that vector storage succeeded.
    if (profile.storageKey !== LEGACY_PROFILE.storageKey) {
        const hasStoredIndexes = Object.keys(stored).length > 0;
        if (!hasStoredIndexes && hasLegacyVectors(existing)) {
            set[`embeddingIndexes.${LEGACY_PROFILE.storageKey}`] = legacyIndexRecord(existing);
        }
    }

    await db.collection(collectionName).updateOne(
        filter,
        { $set: set }
    );
}

/**
 * Mark a document/note as successfully indexed for a profile.
 */
async function markIndexReady(db, { collectionName, filter, profile, hash, collection = null }) {
    const record = buildIndexRecord({
        profile,
        hash,
        status: INDEX_STATUSES.READY,
        indexedAt: new Date(),
        collection
    });
    await setIndexRecord(db, collectionName, filter, profile, record);
    return record;
}

async function markIndexPending(db, { collectionName, filter, profile, hash, collection = null }) {
    const record = buildIndexRecord({ profile, hash, status: INDEX_STATUSES.PENDING, collection });
    await setIndexRecord(db, collectionName, filter, profile, record);
    return record;
}

/**
 * Record a failure. The previous profile's index is untouched, so the surface
 * keeps serving from whatever it was already using.
 */
async function markIndexFailed(db, { collectionName, filter, profile, hash, error, collection = null }) {
    const record = buildIndexRecord({
        profile,
        hash,
        status: INDEX_STATUSES.FAILED,
        error: error ? String(error.message || error).slice(0, 500) : 'Unknown error',
        collection
    });
    await setIndexRecord(db, collectionName, filter, profile, record);
    return record;
}

/**
 * Drop an index record — used when a profile's vectors are deleted.
 */
async function clearIndexRecord(db, { collectionName, filter, profileKey }) {
    await db.collection(collectionName).updateOne(
        filter,
        { $unset: { [`embeddingIndexes.${profileKey}`]: '' }, $set: { updatedAt: new Date() } }
    );
}

// --- Document / note helpers ------------------------------------------------

const documentFilter = (documentId) => ({ documentId });
const noteFilter = (noteId) => ({ noteId });

async function markDocumentIndexReady(db, documentId, profile, hash) {
    return markIndexReady(db, {
        collectionName: DOCUMENTS_COLLECTION,
        filter: documentFilter(documentId),
        profile,
        hash
    });
}

async function markDocumentIndexFailed(db, documentId, profile, hash, error) {
    return markIndexFailed(db, {
        collectionName: DOCUMENTS_COLLECTION,
        filter: documentFilter(documentId),
        profile,
        hash,
        error
    });
}

async function markNoteIndexReady(db, noteId, profile, hash) {
    return markIndexReady(db, {
        collectionName: NOTES_COLLECTION,
        filter: noteFilter(noteId),
        profile,
        hash,
        collection: profile.notesCollection
    });
}

async function markNoteIndexFailed(db, noteId, profile, hash, error) {
    return markIndexFailed(db, {
        collectionName: NOTES_COLLECTION,
        filter: noteFilter(noteId),
        profile,
        hash,
        error,
        collection: profile.notesCollection
    });
}

/**
 * Split a set of documents into the ones needing work for a profile and the
 * ones whose existing index can be reused untouched.
 *
 * @param {Array<Object>} docs - Documents with `content` and `embeddingIndexes`
 * @param {Object} profile
 * @returns {{stale: Array<Object>, current: Array<Object>}}
 */
function partitionByIndexState(docs, profile) {
    const stale = [];
    const current = [];
    for (const doc of docs || []) {
        const hash = contentHash(doc.content);
        if (needsIndexing(doc, profile, hash)) {
            stale.push({ doc, hash, reason: indexingReason(doc, profile, hash) });
        } else {
            current.push({ doc, hash });
        }
    }
    return { stale, current };
}

/**
 * Delete a document's vectors from EVERY collection it was ever indexed into,
 * not just the surface's currently-active one. Leaving vectors behind in an old
 * profile's collection would resurrect deleted content the moment a surface
 * switched back to that platform.
 *
 * The legacy OpenAI collection is always swept as a fallback, because documents
 * indexed before per-profile tracking existed carry no `embeddingIndexes`.
 *
 * @param {Object} db
 * @param {Object} doc - Document (needs documentId, courseId, embeddingIndexes)
 * @param {Function} serviceFactory - async (record) => QdrantService for that collection
 * @returns {Promise<{deleted: Array<Object>, errors: Array<Object>}>}
 */
async function deleteDocumentFromAllCollections(db, doc, serviceFactory) {
    const { buildEmbeddingProfile, documentsCollectionBase } = require('./embeddingConfig');

    const targets = indexedCollections(doc);
    const legacyCollection = documentsCollectionBase();
    if (!targets.some(target => target.collection === legacyCollection)) {
        // Always sweep the legacy collection. A pre-tracking GPT document may
        // now have an explicit Sandbox record but no explicit OpenAI record;
        // limiting the fallback to an empty map would leave its GPT chunks
        // behind and resurrect the deleted document after a switch back.
        targets.push({
            profileKey: LEGACY_PROFILE.storageKey,
            collection: legacyCollection,
            provider: 'openai',
            model: 'text-embedding-3-small'
        });
    }

    const deleted = [];
    const errors = [];

    for (const target of targets) {
        try {
            const profile = buildEmbeddingProfile({
                provider: target.provider || 'openai',
                embeddingModel: target.model || 'text-embedding-3-small',
                revision: (target.profileKey || '').split(':').pop() || undefined,
                vectorSize: target.vectorSize || undefined
            });
            const service = await serviceFactory(target, profile);
            if (!service) continue;
            const result = await service.deleteDocumentChunks(doc.documentId, doc.courseId);
            deleted.push({ collection: target.collection, profileKey: target.profileKey, result });
        } catch (error) {
            errors.push({ collection: target.collection, profileKey: target.profileKey, error: error.message });
        }
    }

    if (db && doc.documentId) {
        await db.collection(DOCUMENTS_COLLECTION).updateOne(
            { documentId: doc.documentId },
            { $set: { embeddingIndexes: {}, updatedAt: new Date() } }
        ).catch(() => {});
    }

    return { deleted, errors };
}

/**
 * Delete a note's vectors from EVERY notes collection it was ever indexed into.
 *
 * Notes have the same problem documents do: deleting only from the collection
 * the Notes surface happens to use today leaves the other platform's vectors in
 * place, and a deleted note would reappear the moment the surface switched
 * back.
 *
 * @param {Object} db
 * @param {Object} note - Note document (needs noteId and embeddingIndexes)
 * @param {Function} deleter - async (collectionName, noteId) => boolean deleted
 * @returns {Promise<{deleted: Array<Object>, errors: Array<Object>}>}
 */
async function deleteNoteFromAllCollections(db, note, deleter) {
    const { notesCollectionBase } = require('./embeddingConfig');

    const targets = indexedCollections(note);
    const legacyCollection = notesCollectionBase();
    if (!targets.some(target => target.collection === legacyCollection)) {
        // As with documents, an explicit Sandbox record must not hide an older
        // untracked GPT vector during deletion.
        targets.push({
            profileKey: LEGACY_PROFILE.storageKey,
            collection: legacyCollection,
            provider: 'openai',
            model: 'text-embedding-3-small'
        });
    }

    const deleted = [];
    const errors = [];

    for (const target of targets) {
        try {
            const removed = await deleter(target.collection, note.noteId);
            if (removed !== false) deleted.push({ collection: target.collection, profileKey: target.profileKey });
        } catch (error) {
            errors.push({ collection: target.collection, profileKey: target.profileKey, error: error.message });
        }
    }

    if (db && note.noteId) {
        await db.collection(NOTES_COLLECTION).updateOne(
            { noteId: note.noteId },
            { $set: { embeddingIndexes: {}, updatedAt: new Date() } }
        ).catch(() => {});
    }

    return { deleted, errors };
}

module.exports = {
    DOCUMENTS_COLLECTION,
    INDEX_STATUSES,
    deleteDocumentFromAllCollections,
    deleteNoteFromAllCollections,
    NOTES_COLLECTION,
    buildIndexRecord,
    clearIndexRecord,
    contentHash,
    indexFingerprint,
    indexedCollections,
    indexesOf,
    indexingReason,
    markDocumentIndexFailed,
    markDocumentIndexReady,
    markIndexFailed,
    markIndexPending,
    markIndexReady,
    markNoteIndexFailed,
    markNoteIndexReady,
    needsIndexing,
    normalizeContent,
    partitionByIndexState
};
