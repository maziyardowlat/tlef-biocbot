/**
 * Unwrapping the encrypted database wrapper.
 *
 * `createEncryptedDb` returns a `ProtectedDb`, not a driver `Db`. That is the
 * point — it is what stops a stray `db.collection(...)` from writing plaintext
 * into a protected collection. A few operations genuinely need the driver object
 * underneath it:
 *
 *   - `GridFSBucket` takes a `Db` and streams binaries the toolkit does not
 *     cover (field-level encryption has no GridFS support in v1).
 *   - `db.admin()` for the health-check ping.
 *   - `db.dropCollection()` in the destructive admin reset route.
 *
 * Every one of those bypasses encryption, so unwrapping lives here alone and is
 * greppable. Do not import this to reach ordinary collections.
 */

/**
 * Return the underlying driver `Db` for a database handle that may be wrapped.
 * @param {import('mongodb').Db|object} db - a driver Db or a ProtectedDb
 * @returns {import('mongodb').Db}
 */
function resolveRawDb(db) {
    if (db && typeof db.getRawDb === 'function') {
        return db.getRawDb();
    }
    return db;
}

module.exports = { resolveRawDb };
