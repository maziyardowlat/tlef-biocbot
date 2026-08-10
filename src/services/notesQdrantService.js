/**
 * NotesQdrantService
 * Vector storage + search for platform-level Super Chat Notes.
 *
 * Notes live in their own Qdrant collection (`superchat_notes`), kept separate
 * from course-content vectors so they can be toggled/weighted independently and
 * deleted without ever touching lecture chunks.
 *
 * Embeddings + chunking are reused from the existing QdrantService so we don't
 * duplicate the (battle-tested) UBC GenAI toolkit initialization. The base
 * service can be shared from the caller to avoid paying init cost twice in the
 * Super Chat retrieval hot path.
 */

const { randomUUID } = require('crypto');
const QdrantService = require('./qdrantService');
const { notesCollectionBase } = require('./embeddingConfig');

// Notes at or below this length are stored as a single chunk (chunking short,
// coherent notes hurts retrieval quality). Longer notes use the toolkit chunker.
const SINGLE_CHUNK_MAX_CHARS = 1000;

// Default cosine threshold for the "similar note already exists" warning.
const DEFAULT_DUP_THRESHOLD = 0.88;

/**
 * Normalize whatever shape the embeddings provider returns into a flat number[].
 * Mirrors the defensive handling in QdrantService.searchDocuments.
 */
function normalizeVector(raw) {
    let vector = raw;
    if (Array.isArray(raw)) {
        if (raw.length > 0 && Array.isArray(raw[0])) {
            vector = raw[0];
        }
    } else if (raw && typeof raw === 'object') {
        if (Array.isArray(raw.embedding)) {
            vector = raw.embedding;
        } else if (Array.isArray(raw.data) && Array.isArray(raw.data[0])) {
            vector = raw.data[0];
        }
    }
    if (!Array.isArray(vector) || !vector.every(n => typeof n === 'number')) {
        throw new Error('Invalid embedding shape: expected number[]');
    }
    return vector;
}

class NotesQdrantService {
    /**
     * @param {Object} [options]
     * @param {Object} [options.embeddingProfile] - Explicit embedding profile.
     *   Notes get their own model-qualified collection per profile, exactly like
     *   course documents, so a Sandbox Super Course never reads OpenAI vectors.
     */
    constructor(options = {}) {
        this.base = null;
        this.client = null;
        this.embeddings = null;
        this.chunker = null;
        this.embeddingProfile = options.embeddingProfile || null;
        this.vectorSize = this.embeddingProfile ? this.embeddingProfile.vectorSize : null;
        this.collectionName = this.embeddingProfile
            ? this.embeddingProfile.notesCollection
            : notesCollectionBase();
        this.initialized = false;
    }

    /**
     * Initialize the service. Optionally reuse an already-initialized QdrantService
     * (shared client/embeddings/chunker) to avoid a second heavy init.
     *
     * A shared base must be running the SAME embedding profile — otherwise its
     * embeddings would write vectors from one model into another model's notes
     * collection.
     *
     * @param {QdrantService|null} sharedBase
     */
    async initialize(sharedBase = null) {
        if (this.initialized) return;

        if (sharedBase) {
            this.base = sharedBase;
        } else {
            this.base = new QdrantService(
                this.embeddingProfile ? { embeddingProfile: this.embeddingProfile } : {}
            );
            await this.base.initialize();
        }

        if (this.base.embeddingProfile) {
            if (this.embeddingProfile && this.base.embeddingProfile.key !== this.embeddingProfile.key) {
                throw new Error(
                    `Notes embedding profile ${this.embeddingProfile.key} does not match the shared Qdrant service `
                    + `profile ${this.base.embeddingProfile.key}; refusing to mix embedding models.`
                );
            }
            this.embeddingProfile = this.base.embeddingProfile;
            this.collectionName = this.embeddingProfile.notesCollection;
        }

        this.client = this.base.client;
        this.embeddings = this.base.embeddings;
        this.chunker = this.base.chunker;
        this.vectorSize = this.base.vectorSize;

        await this.ensureCollectionExists();
        this.initialized = true;
    }

    async ensureCollectionExists() {
        const collections = await this.client.getCollections();
        const exists = (collections.collections || []).some(col => col.name === this.collectionName);
        if (!exists) {
            await this.client.createCollection(this.collectionName, {
                vectors: { size: this.vectorSize, distance: 'Cosine' }
            });
            console.log(`✅ Created Qdrant collection: ${this.collectionName} (size=${this.vectorSize})`);
            return;
        }

        const info = await this.client.getCollection(this.collectionName);
        const existingVectorSize = info.config.params.vectors.size;
        if (existingVectorSize !== this.vectorSize) {
            throw new Error(
                `Qdrant notes collection ${this.collectionName} has ${existingVectorSize}-dimension vectors, ` +
                `but embedding profile ${this.embeddingProfile ? this.embeddingProfile.key : 'unknown'} returns ${this.vectorSize}. ` +
                'Bump the profile revision so a new collection is created; existing notes vectors are preserved.'
            );
        }
    }

    /**
     * Chunk a note's content. Short notes become a single chunk.
     * @param {string} content
     * @returns {Promise<Array<string>>}
     */
    async chunkNote(content) {
        const clean = String(content || '').trim();
        if (!clean) return [];
        if (clean.length <= SINGLE_CHUNK_MAX_CHARS) {
            return [clean];
        }

        const documents = [{ content: clean, metadata: { sourceId: 'superchat-note' } }];
        const chunkResp = await this.chunker.chunkDocuments(documents, {});
        const sorted = [...chunkResp.chunks].sort(
            (a, b) => a.metadata.chunkNumber - b.metadata.chunkNumber
        );
        return sorted.map(c => c.text).filter(text => text && text.trim());
    }

    async embedQuery(query) {
        const raw = await this.embeddings.embed(String(query || ''));
        return normalizeVector(raw);
    }

    /**
     * Embed + store a note's chunks. Returns the Qdrant point IDs created.
     * @param {string} noteId
     * @param {string} content
     * @param {Object} payloadMeta - { authorId, authorName, title, tags, createdAt }
     * @returns {Promise<Array<string>>}
     */
    async addNote(noteId, content, payloadMeta = {}) {
        await this.initialize();
        const chunks = await this.chunkNote(content);
        if (chunks.length === 0) return [];

        const embeddings = await this.base.generateEmbeddings(chunks);
        const points = [];
        const pointIds = [];
        const createdAt = payloadMeta.createdAt || new Date().toISOString();

        for (let i = 0; i < chunks.length; i++) {
            const id = randomUUID();
            pointIds.push(id);
            points.push({
                id,
                vector: embeddings[i],
                payload: {
                    noteId,
                    sourceType: 'note',
                    authorId: payloadMeta.authorId || null,
                    authorName: payloadMeta.authorName || null,
                    title: payloadMeta.title || null,
                    tags: Array.isArray(payloadMeta.tags) ? payloadMeta.tags : [],
                    createdAt,
                    chunkIndex: i,
                    totalChunks: chunks.length,
                    chunkText: chunks[i],
                    chunkLength: chunks[i].length
                }
            });
        }

        await this.base.assertNotCancelled();
        await this.client.upsert(this.collectionName, { points });
        return pointIds;
    }

    /**
     * Remove all Qdrant points belonging to a note.
     * @param {string} noteId
     */
    async deleteNote(noteId) {
        await this.initialize();
        await this.client.delete(this.collectionName, {
            filter: { must: [{ key: 'noteId', match: { value: noteId } }] }
        });
    }

    /**
     * Replace a note's chunks (delete old, add new). Returns new point IDs.
     */
    async updateNote(noteId, content, payloadMeta = {}) {
        await this.initialize();
        await this.deleteNote(noteId);
        return this.addNote(noteId, content, payloadMeta);
    }

    /**
     * Semantic search across note chunks.
     * @param {string} query
     * @param {number} limit
     * @param {Object} options - { minScore }
     * @returns {Promise<Array>} results tagged with sourceType: 'note'
     */
    async searchNotes(query, limit = 5, options = {}) {
        await this.initialize();
        if (!query || !limit || limit <= 0) return [];

        const queryVector = await this.embedQuery(query);
        const { points: results } = await this.client.query(this.collectionName, {
            query: queryVector,
            limit,
            with_payload: true,
            with_vector: false
        });

        let mapped = results.map(result => ({
            id: result.id,
            score: result.score,
            noteId: result.payload.noteId,
            authorId: result.payload.authorId,
            authorName: result.payload.authorName,
            title: result.payload.title,
            tags: result.payload.tags || [],
            createdAt: result.payload.createdAt,
            chunkText: result.payload.chunkText,
            sourceType: 'note'
        }));

        if (typeof options.minScore === 'number') {
            mapped = mapped.filter(item => item.score >= options.minScore);
        }
        return mapped;
    }

    /**
     * Find the single most-similar existing note to the given content, for the
     * "similar note already exists" warning. Returns null if nothing crosses
     * the threshold.
     * @param {string} content
     * @param {Object} options - { excludeNoteId, threshold }
     * @returns {Promise<Object|null>}
     */
    async findSimilarTo(content, options = {}) {
        await this.initialize();
        const excludeNoteId = options.excludeNoteId || null;
        const threshold = typeof options.threshold === 'number' ? options.threshold : DEFAULT_DUP_THRESHOLD;

        const probeText = String(content || '').slice(0, SINGLE_CHUNK_MAX_CHARS);
        if (!probeText.trim()) return null;

        const queryVector = await this.embedQuery(probeText);
        const searchParams = {
            query: queryVector,
            limit: 5,
            with_payload: true,
            with_vector: false
        };
        if (excludeNoteId) {
            searchParams.filter = {
                must_not: [{ key: 'noteId', match: { value: excludeNoteId } }]
            };
        }

        const { points: results } = await this.client.query(this.collectionName, searchParams);
        const top = results.find(result => result.score >= threshold);
        if (!top) return null;

        return {
            noteId: top.payload.noteId,
            authorName: top.payload.authorName,
            title: top.payload.title,
            createdAt: top.payload.createdAt,
            excerpt: String(top.payload.chunkText || '').slice(0, 240),
            score: top.score
        };
    }
}

module.exports = NotesQdrantService;
module.exports.NOTES_COLLECTION = notesCollectionBase();
module.exports.DEFAULT_DUP_THRESHOLD = DEFAULT_DUP_THRESHOLD;
