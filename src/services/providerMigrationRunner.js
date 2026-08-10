/**
 * Provider migration runner
 *
 * Executes the persistent jobs created by providerMigrationService: re-embeds
 * only the documents/notes that are missing or stale for the target embedding
 * profile, reports progress, runs a final consistency pass to pick up content
 * that changed while the migration ran, and only then activates the new
 * provider.
 *
 * The runner never runs inside an HTTP request. Routes create a job and return
 * immediately; this worker drains it in the background and is restarted at boot
 * so an interrupted migration resumes where it stopped.
 */

const { randomUUID } = require('crypto');

const QdrantService = require('./qdrantService');
const NotesQdrantService = require('./notesQdrantService');
const adminModelSettings = require('./adminModelSettings');
const config = require('./config');
const { buildEmbeddingProfile } = require('./embeddingConfig');
const { credentialForProvider, decryptApiKey } = require('./llmKeyStore');
const migrations = require('./providerMigrationService');

const { ITEM_STATUSES, MIGRATION_STATUSES, MAX_ATTEMPTS } = migrations;

const WORKER_ID = `worker_${randomUUID()}`;

/**
 * Which surface's encrypted credential pays for embedding a given item.
 *
 * - A provider switch embeds everything the switching surface can retrieve,
 *   using THAT surface's key (a Sandbox bucket indexes its member courses with
 *   the bucket's own Sandbox key, even when those courses run on GPT).
 * - An admin embedding-model change re-indexes content across many surfaces, so
 *   each item is embedded with its own owner's key.
 */
function credentialScopeForItem(job, item) {
    if (job.kind !== 'embedding-model') return job.scope;
    if (item && item.itemType === 'note') return { type: 'notes', id: 'notesLlm' };
    if (item && item.courseId) return { type: 'course', id: item.courseId };
    return job.scope;
}

/**
 * Rebuild the target embedding profile *with* a scoped API key. Jobs persist
 * only the key-free summary, so the key is re-read from the owning surface each
 * time the job is picked up.
 */
async function resolveTargetProfile(db, job, scope = job.scope) {
    const target = migrations.scopeTarget(scope);
    if (!target) throw new Error(`Unknown migration scope type: ${scope && scope.type}`);

    const doc = await db.collection(target.collection).findOne(target.filter);
    const provider = job.targetProfile.provider || job.toProvider;
    const credential = credentialForProvider(doc, provider);
    if (!credential || !credential.ciphertext) {
        throw new Error(`No stored ${provider} credential for ${migrations.scopeKey(scope)}`);
    }

    const infra = config.getProviderInfra(provider);
    return buildEmbeddingProfile({
        provider,
        embeddingModel: job.targetProfile.embeddingModel,
        revision: job.targetProfile.revision,
        endpoint: infra.endpoint,
        apiKey: decryptApiKey(credential.ciphertext)
    });
}

/**
 * Vector services bound to one embedding profile. Documents and notes share the
 * base service so the embeddings client is created once per key.
 */
async function createVectorServices(profile, { needNotes }) {
    const qdrant = new QdrantService({ embeddingProfile: profile });
    await qdrant.initialize();

    let notesQdrant = null;
    if (needNotes) {
        notesQdrant = new NotesQdrantService({ embeddingProfile: profile });
        await notesQdrant.initialize(qdrant);
    }

    return { qdrant, notesQdrant };
}

/**
 * Lazily builds and caches the vector services for each credential owner in a
 * job. All of them write into the SAME target collection — only the key that
 * pays for the embeddings differs.
 */
function createServiceResolver(db, job) {
    const cache = new Map();

    return async function servicesFor(item) {
        const scope = credentialScopeForItem(job, item);
        const key = migrations.scopeKey(scope);
        if (cache.has(key)) {
            const cached = cache.get(key);
            if (cached.error) throw cached.error;
            return cached;
        }

        try {
            const profile = await resolveTargetProfile(db, job, scope);
            const services = await createVectorServices(profile, {
                needNotes: !!job.includeNotes || (item && item.itemType === 'note')
            });
            const entry = { ...services, profile };
            cache.set(key, entry);
            return entry;
        } catch (error) {
            // Cache the failure so one broken surface does not re-probe the
            // provider once per item.
            cache.set(key, { error });
            throw error;
        }
    };
}

/**
 * Re-embed one document into the target profile's collection.
 *
 * Existing chunks for this document in THAT collection are removed first, so a
 * retry after a partial failure cannot leave duplicate chunks behind. Other
 * profiles' collections are untouched.
 */
async function migrateDocument(db, item, { qdrant, profile }) {
    const doc = await db.collection('documents').findOne({ documentId: item.itemId });
    if (!doc || doc.isDeleted) {
        return { skipped: true, reason: 'deleted' };
    }
    if (!doc.content || !String(doc.content).trim()) {
        return { skipped: true, reason: 'no-content' };
    }

    await qdrant.deleteDocumentChunks(item.itemId, doc.courseId);

    const result = await qdrant.processAndStoreDocument({
        courseId: doc.courseId,
        lectureName: doc.lectureName,
        documentId: doc.documentId,
        content: doc.content,
        fileName: doc.filename || doc.originalName,
        mimeType: doc.mimeType,
        documentType: doc.documentType,
        type: doc.type
    });

    if (!result || result.success !== true) {
        throw new Error((result && result.error) || 'Document indexing failed');
    }

    await migrations.markItemIndexed(db, item, profile);
    return { skipped: false };
}

async function migrateNote(db, item, { notesQdrant, profile }) {
    const note = await db.collection('superchat_notes').findOne({ noteId: item.itemId });
    if (!note || note.isDeleted) {
        return { skipped: true, reason: 'deleted' };
    }
    if (!note.content || !String(note.content).trim()) {
        return { skipped: true, reason: 'no-content' };
    }

    // updateNote deletes this note's points in the target collection first, so
    // re-running after a failure is safe.
    await notesQdrant.updateNote(note.noteId, note.content, {
        authorId: note.authorId,
        authorName: note.authorName,
        title: note.title,
        tags: note.tags,
        createdAt: note.createdAt ? new Date(note.createdAt).toISOString() : undefined
    });

    await migrations.markItemIndexed(db, item, profile);
    return { skipped: false };
}

async function processItem(db, item, context) {
    if (item.itemType === 'note') {
        return migrateNote(db, item, context);
    }
    return migrateDocument(db, item, context);
}

/**
 * Drain one migration job to completion.
 *
 * @param {Object} db
 * @param {string} migrationId
 * @param {Object} [options] - { onProgress }
 * @returns {Promise<Object|null>} The finished job document
 */
async function runMigration(db, migrationId, options = {}) {
    const claimed = await migrations.claimMigration(db, migrationId, WORKER_ID);
    if (!claimed) {
        // Another worker holds a live lease on this job.
        return migrations.getMigration(db, migrationId);
    }

    let job = await migrations.getMigration(db, migrationId);

    // Key-free profile used for planning (what is stale, which collection).
    // The keyed profile per item comes from servicesFor().
    const profile = buildEmbeddingProfile({
        provider: job.targetProfile.provider,
        embeddingModel: job.targetProfile.embeddingModel,
        revision: job.targetProfile.revision
    });
    const servicesFor = createServiceResolver(db, job);

    // Two passes: the queued work, then a consistency pass that catches uploads
    // and edits that landed while the first pass was running.
    for (let pass = 0; pass < 2; pass += 1) {
        job = await migrations.getMigration(db, migrationId);
        if (!job || job.status === MIGRATION_STATUSES.CANCELLED) break;

        let queue = (job.items || []).filter(item => item.status === ITEM_STATUSES.PENDING);

        if (pass === 1) {
            const remaining = await migrations.findRemainingWork(db, job, profile);
            if (remaining.length === 0) break;

            // Merge the newly-discovered work into the persisted job so progress
            // totals stay honest and a restart still sees it.
            const known = new Set((job.items || []).map(item => `${item.itemType}:${item.itemId}`));
            const additions = remaining.filter(item => !known.has(`${item.itemType}:${item.itemId}`));
            const refreshed = remaining.filter(item => known.has(`${item.itemType}:${item.itemId}`));

            const mergedItems = (job.items || []).map((item) => {
                const match = refreshed.find(r => r.itemType === item.itemType && r.itemId === item.itemId);
                if (!match) return item;
                // Content changed since the first pass: re-queue with the new
                // hash and a fresh attempt budget.
                if (match.contentHash !== item.contentHash) {
                    return {
                        ...item,
                        contentHash: match.contentHash,
                        status: ITEM_STATUSES.PENDING,
                        attempts: 0,
                        error: null
                    };
                }
                // Same content: the consistency pass exists to catch uploads and
                // edits, not to hand an exhausted item extra attempts. Retrying
                // a genuine failure is an explicit user action.
                return item;
            }).concat(additions);

            await db.collection(migrations.MIGRATIONS_COLLECTION).updateOne(
                { migrationId },
                {
                    $set: {
                        items: mergedItems,
                        'totals.total': mergedItems.length,
                        'totals.completed': mergedItems.filter(i => i.status === ITEM_STATUSES.DONE || i.status === ITEM_STATUSES.SKIPPED).length,
                        updatedAt: new Date()
                    }
                }
            );
            queue = mergedItems.filter(item => item.status === ITEM_STATUSES.PENDING);
        }

        for (const item of queue) {
            await migrations.heartbeat(db, migrationId, {
                itemType: item.itemType,
                itemId: item.itemId,
                title: item.title || null
            });

            try {
                const services = await servicesFor(item);
                const outcome = await processItem(db, item, { ...services, profile });
                await migrations.recordItemResult(db, migrationId, item.itemId, item.itemType, {
                    status: outcome.skipped ? ITEM_STATUSES.SKIPPED : ITEM_STATUSES.DONE,
                    attempts: (item.attempts || 0) + 1,
                    error: null,
                    skipReason: outcome.reason || null
                });
            } catch (error) {
                const attempts = (item.attempts || 0) + 1;
                await migrations.markItemFailed(db, item, profile, error);
                await migrations.recordItemResult(db, migrationId, item.itemId, item.itemType, {
                    status: attempts >= MAX_ATTEMPTS ? ITEM_STATUSES.FAILED : ITEM_STATUSES.PENDING,
                    attempts,
                    error: String(error.message || error).slice(0, 500)
                });
                console.error(`❌ Migration ${migrationId}: ${item.itemType} ${item.itemId} failed (attempt ${attempts}):`, error.message);

                // A retryable item stays pending; give it its remaining attempts
                // inside this same pass rather than waiting for a manual retry.
                if (attempts < MAX_ATTEMPTS) {
                    queue.push({ ...item, attempts });
                }
            }

            if (typeof options.onProgress === 'function') {
                try {
                    options.onProgress(await migrations.getMigration(db, migrationId));
                } catch (_) {
                    // A progress listener must never break a migration.
                }
            }
        }
    }

    job = await migrations.getMigration(db, migrationId);
    const failed = (job.items || []).filter(item => item.status === ITEM_STATUSES.FAILED);

    if (failed.length > 0) {
        // When every item failed the same way — a missing credential, an
        // unreachable endpoint — report that cause rather than a bare count.
        const distinctErrors = [...new Set(failed.map(item => item.error).filter(Boolean))];
        const summary = distinctErrors.length === 1
            ? distinctErrors[0]
            : `${failed.length} item(s) could not be indexed`;

        await migrations.finishMigration(db, migrationId, MIGRATION_STATUSES.FAILED, new Error(summary));
        // The previous provider stays active; its vectors and credential are
        // untouched, so the surface keeps working.
        await migrations.abandonPendingProvider(db, job.scope);
        return migrations.getMigration(db, migrationId);
    }

    if (job.kind === 'provider' && job.toProvider) {
        try {
            await migrations.activateProvider(db, job.scope, job.toProvider);
        } catch (error) {
            await migrations.finishMigration(db, migrationId, MIGRATION_STATUSES.FAILED, error);
            await migrations.abandonPendingProvider(db, job.scope);
            return migrations.getMigration(db, migrationId);
        }
    }

    if (job.kind === 'embedding-model') {
        await adminModelSettings.activatePendingEmbedding(db, job.targetProfile.provider);
    }

    await migrations.finishMigration(db, migrationId, MIGRATION_STATUSES.COMPLETED);
    return migrations.getMigration(db, migrationId);
}

/**
 * Fire-and-forget wrapper so an HTTP handler never waits for a whole course to
 * be re-indexed.
 */
function startMigration(db, migrationId, options = {}) {
    setImmediate(() => {
        runMigration(db, migrationId, options).catch((error) => {
            console.error(`❌ Migration ${migrationId} crashed:`, error.message);
            migrations.finishMigration(db, migrationId, MIGRATION_STATUSES.FAILED, error).catch(() => {});
        });
    });
}

/**
 * Resume every unfinished migration at boot. Jobs survive restarts precisely
 * because their state lives in MongoDB rather than in process memory.
 */
async function resumePendingMigrations(db) {
    if (!db) return [];
    const pending = await db.collection(migrations.MIGRATIONS_COLLECTION)
        .find({ status: { $in: migrations.ACTIVE_STATUSES } })
        .toArray();

    for (const job of pending) {
        console.log(`♻️ Resuming migration ${job.migrationId} (${job.scopeKey} -> ${job.targetProfileKey})`);
        startMigration(db, job.migrationId);
    }
    return pending.map(job => job.migrationId);
}

module.exports = {
    WORKER_ID,
    createVectorServices,
    migrateDocument,
    migrateNote,
    resolveTargetProfile,
    resumePendingMigrations,
    runMigration,
    startMigration
};
