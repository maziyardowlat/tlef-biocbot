/**
 * Server-held prepared grade exports.
 *
 * A Canvas grade batch is an ordinary object whose `userId` values mean whatever
 * the holder says they mean, and a preflight is the evidence that an instructor
 * was shown the assignment's real posting policy. Round-tripping either through
 * a browser would let the client choose who gets graded and assert that review
 * happened. So preview stores both here and hands back only an opaque id.
 *
 * The id is a random 256-bit value rather than a guessable key, is bound to the
 * instructor, their session, and the integration it was prepared for, expires
 * quickly, and can be redeemed exactly once.
 */

const crypto = require('crypto');

const EXPORT_OPERATIONS_COLLECTION = 'canvas_grade_export_operations';

/**
 * Long enough for an instructor to read the preview and decide, short enough
 * that an abandoned preview cannot be confirmed later against a roster or an
 * assignment that has since changed.
 */
const DEFAULT_TTL_MS = 10 * 60 * 1000;

function collection(db) {
    return db.collection(EXPORT_OPERATIONS_COLLECTION);
}

async function ensureIndexes(db) {
    await collection(db).createIndex(
        { operationId: 1 },
        { name: 'unique_canvas_export_operation', unique: true }
    );
    // Mongo reaps abandoned previews on its own; the redemption path still
    // checks `expiresAt` itself, because TTL removal is only eventually prompt.
    await collection(db).createIndex(
        { expiresAt: 1 },
        { name: 'canvas_export_operation_ttl', expireAfterSeconds: 0 }
    );
}

/**
 * Stores a prepared export and returns its opaque id.
 *
 * @param {Object} db - MongoDB database instance
 * @param {Object} params - The prepared operation
 * @param {string} params.courseIntegrationId - BiocBot's link id
 * @param {string} params.canvasCourseId - Derived server-side, never from the client
 * @param {string} params.gradeItemId - Validated against the linked course
 * @param {string} params.instructorId - Who may redeem this
 * @param {string} params.sessionKey - The session that may redeem this
 * @param {Object} params.batch - The resolved batch, kept server-side
 * @param {Object} params.preflight - The preflight shown to the instructor
 * @param {boolean} params.allowPartial - Decided at preview, not at confirmation
 * @param {string[]} params.recordIds - Rows this export covers
 * @param {string[]} params.writeRecordIds - Rows Canvas will actually receive
 * @param {string[]} params.skippedRecordIds - Rows left out of the batch
 * @param {string} params.recordsFingerprint - Digest of those rows' values
 * @param {number} [params.ttlMs] - Lifetime override
 * @returns {Promise<Object>} `{ operationId, expiresAt }`
 */
async function createOperation(db, {
    courseIntegrationId,
    canvasCourseId,
    gradeItemId,
    instructorId,
    sessionKey,
    batch,
    preflight,
    allowPartial,
    recordIds,
    writeRecordIds = [],
    skippedRecordIds = [],
    recordsFingerprint,
    ttlMs = DEFAULT_TTL_MS
}) {
    const now = new Date();
    const operationId = crypto.randomBytes(32).toString('hex');
    const expiresAt = new Date(now.getTime() + ttlMs);

    await collection(db).insertOne({
        operationId,
        courseIntegrationId: String(courseIntegrationId),
        canvasCourseId: String(canvasCourseId),
        gradeItemId: String(gradeItemId),
        instructorId: String(instructorId),
        sessionKey: sessionKey ? String(sessionKey) : null,
        batch,
        preflight,
        allowPartial: Boolean(allowPartial),
        recordIds: recordIds.map((id) => String(id)),
        writeRecordIds: writeRecordIds.map((id) => String(id)),
        skippedRecordIds: skippedRecordIds.map((id) => String(id)),
        recordsFingerprint,
        createdAt: now,
        expiresAt,
        usedAt: null
    });

    return { operationId, expiresAt };
}

/**
 * Redeems a prepared export.
 *
 * The claim is a single atomic update on `usedAt`, so two confirmations racing
 * each other cannot both post the same batch. Binding is checked before the
 * claim, and every failure returns the same shape rather than throwing, because
 * the route turns each reason into a different instructor-facing message.
 *
 * @param {Object} db - MongoDB database instance
 * @param {Object} params - `{ operationId, instructorId, sessionKey, courseIntegrationId }`
 * @returns {Promise<Object>} `{ ok: true, operation }` or `{ ok: false, reason }`
 */
async function claimOperation(db, { operationId, instructorId, sessionKey, courseIntegrationId }) {
    const stored = await collection(db).findOne({ operationId: String(operationId) });
    if (!stored) {
        return { ok: false, reason: 'not-found' };
    }
    if (stored.usedAt) {
        return { ok: false, reason: 'already-used' };
    }
    if (new Date(stored.expiresAt).getTime() <= Date.now()) {
        return { ok: false, reason: 'expired' };
    }
    if (stored.instructorId !== String(instructorId)) {
        return { ok: false, reason: 'wrong-instructor' };
    }
    if (stored.sessionKey && sessionKey && stored.sessionKey !== String(sessionKey)) {
        return { ok: false, reason: 'wrong-session' };
    }
    if (stored.courseIntegrationId !== String(courseIntegrationId)) {
        return { ok: false, reason: 'wrong-integration' };
    }

    // Single-use is enforced here, not by the read above: only a conditional
    // update is safe against two confirmations arriving together.
    const claimed = await collection(db).findOneAndUpdate(
        { operationId: String(operationId), usedAt: null },
        { $set: { usedAt: new Date() } },
        { returnDocument: 'after' }
    );
    if (!claimed) {
        return { ok: false, reason: 'already-used' };
    }

    return { ok: true, operation: claimed };
}

/** Records how a redeemed operation finished, for the audit trail. */
async function recordOutcome(db, operationId, outcome) {
    await collection(db).updateOne(
        { operationId: String(operationId) },
        { $set: { outcome, completedAt: new Date() } }
    );
}

module.exports = {
    DEFAULT_TTL_MS,
    EXPORT_OPERATIONS_COLLECTION,
    claimOperation,
    collection,
    createOperation,
    ensureIndexes,
    recordOutcome
};
