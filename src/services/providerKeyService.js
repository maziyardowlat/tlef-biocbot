/**
 * Provider key operations, shared by every keyed surface
 *
 * The four surfaces — a course, the instructor Notes, the instructor Super
 * Course chat, and each student-facing Super Course bucket — all need the same
 * behaviour, and each keeps its own isolated credentials:
 *
 *   - save a key for a chosen platform (validated against THAT platform)
 *   - test the stored key for the active platform
 *   - switch platforms, which stages the new credential and runs a migration
 *     before the new platform becomes active
 *
 * Keys are never shared between surfaces, and no route ever returns ciphertext
 * or a decrypted key.
 */

const adminModelSettings = require('./adminModelSettings');
const config = require('./config');
const migrations = require('./providerMigrationService');
const migrationRunner = require('./providerMigrationRunner');
const { buildEmbeddingProfile } = require('./embeddingConfig');
const { normalizeProvider, providerLabel } = require('./llmProviders');
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

    return validateProviderKey({
        provider: normalizedProvider,
        apiKey,
        chatModel: settings.chatModel,
        embeddingModel: settings.embeddingModel,
        endpoint
    });
}

/**
 * The embedding profile a provider would use for this surface, including the
 * decrypted key when one is supplied.
 */
async function embeddingProfileFor(db, provider, apiKey = null) {
    const normalizedProvider = normalizeProvider(provider);
    const settings = await adminModelSettings.getProviderSettings(db, normalizedProvider);
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
        // that themselves run on a different platform.
        const bucket = await db.collection('superchats').findOne({ superchatId: scope.id });
        const courseIds = Array.isArray(bucket && bucket.courseIds)
            ? bucket.courseIds
            : (Array.isArray(bucket && bucket.courses) ? bucket.courses.map(c => c.courseId || c) : []);
        return { courseIds: courseIds.filter(Boolean), includeNotes: !!(bucket && bucket.includeNotes) };
    }

    if (scope.type === 'superCourseChat') {
        // The instructor Super Course chat pools every course, plus Notes when
        // the chat is configured to include them.
        const courses = await db.collection('courses')
            .find({ isDeleted: { $ne: true } }, { projection: { courseId: 1 } })
            .toArray();
        const settings = await db.collection('settings').findOne({ _id: 'superCourseChat' });
        return {
            courseIds: courses.map(course => course.courseId).filter(Boolean),
            includeNotes: settings ? settings.includeNotes !== false : true
        };
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
 * Saving a key for the platform the surface already runs on activates it
 * immediately. Choosing a *different* platform stages the credential and starts
 * a migration — the surface keeps answering on its current platform until every
 * required index exists in the new platform's collection.
 *
 * @returns {Promise<Object>} Route-ready result (never contains key material)
 */
async function saveSurfaceKey(db, {
    scope,
    provider,
    apiKey,
    updatedBy = null,
    registry = null,
    allowMigration = true
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
    const isSwitch = allowMigration
        && hasExistingCredential
        && requestedProvider !== currentProvider;

    if (!isSwitch) {
        await db.collection(target.collection).updateOne(
            target.filter,
            { $set: { ...credentialSetFields(requestedProvider, credential), updatedAt: new Date() } },
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

    // --- Platform switch: stage, migrate, then activate ---------------------
    await db.collection(target.collection).updateOne(
        target.filter,
        {
            $set: {
                ...credentialSetFields(requestedProvider, credential, { activate: false }),
                pendingLlmProvider: requestedProvider,
                updatedAt: new Date()
            }
        }
    );

    const profile = await embeddingProfileFor(db, requestedProvider);
    const { courseIds, includeNotes } = await migrationScopeContent(db, scope);
    const { job } = await migrations.createMigration(db, {
        scope,
        kind: 'provider',
        fromProvider: currentProvider,
        toProvider: requestedProvider,
        profile,
        courseIds,
        includeNotes,
        requestedBy: updatedBy
    });

    await db.collection(target.collection).updateOne(
        target.filter,
        { $set: { providerMigrationId: job.migrationId, updatedAt: new Date() } }
    );

    // Do NOT hold the request open while a whole course is re-indexed.
    migrationRunner.startMigration(db, job.migrationId);

    const updated = await db.collection(target.collection).findOne(target.filter);
    return {
        ok: true,
        httpStatus: 202,
        body: {
            success: true,
            message: `Preparing course material for ${providerLabel(requestedProvider)}. `
                + `This surface keeps using ${providerLabel(currentProvider)} until preparation finishes.`,
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
 * Switch back to a platform whose credential is already stored, without asking
 * for the key again. Still runs a migration so any content added while the
 * other platform was active gets indexed for this one.
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

    const profile = await embeddingProfileFor(db, requestedProvider);
    const { courseIds, includeNotes } = await migrationScopeContent(db, scope);
    const { job } = await migrations.createMigration(db, {
        scope,
        kind: 'provider',
        fromProvider: state.activeProvider,
        toProvider: requestedProvider,
        profile,
        courseIds,
        includeNotes,
        requestedBy
    });

    await db.collection(target.collection).updateOne(
        target.filter,
        {
            $set: {
                pendingLlmProvider: requestedProvider,
                providerMigrationId: job.migrationId,
                updatedAt: new Date()
            }
        }
    );

    migrationRunner.startMigration(db, job.migrationId);
    evictScope(registry, scope);

    const updated = await db.collection(target.collection).findOne(target.filter);
    return {
        ok: true,
        httpStatus: 202,
        body: {
            success: true,
            message: `Preparing course material for ${providerLabel(requestedProvider)}.`,
            ...publicProviderKeyState(updated),
            migration: migrations.publicMigrationView(job)
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
    saveSurfaceKey,
    surfaceKeyState,
    switchToStoredProvider,
    testSurfaceKey,
    validateForProvider
};
