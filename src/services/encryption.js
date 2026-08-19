/**
 * Field-level encryption bootstrap.
 *
 * Wraps the connected MongoDB `Db` once at startup so that the fields declared
 * in `src/config/encryption.config.js` are encrypted on the way in and decrypted
 * on the way out. Routes and models keep working with plaintext and need no
 * changes.
 *
 * Encryption is opt-in: without `ENCRYPTION_ENABLED=true` the application runs
 * exactly as it did before, which is what keeps local development and the test
 * suites working without key material. When it *is* enabled and the key is
 * missing or malformed, startup fails rather than quietly storing plaintext in a
 * collection everyone now assumes is protected.
 */

const { createEncryptedDb, isEncryptionToolkitError } = require('ubc-genai-toolkit-encryption');

/**
 * Whether encryption is turned on for this process.
 * @returns {boolean}
 */
function isEncryptionEnabled() {
    return String(process.env.ENCRYPTION_ENABLED || '').trim().toLowerCase() === 'true';
}

/**
 * Wrap a connected database with field-level encryption when it is enabled.
 *
 * @param {import('mongodb').Db} db - the connected driver database
 * @returns {Promise<import('mongodb').Db|object>} the protected database, or the
 *   original one when encryption is disabled
 * @throws when encryption is enabled but the configuration or key is unusable
 */
async function protectDatabase(db) {
    if (!isEncryptionEnabled()) {
        console.log('🔓 Field-level encryption is OFF (set ENCRYPTION_ENABLED=true to turn it on)');
        return db;
    }

    // Required lazily so a missing/invalid key only fails when encryption is
    // actually on — the config module reads the environment as it loads.
    const encryptionConfig = require('../config/encryption.config');

    try {
        const protectedDb = await createEncryptedDb(db, encryptionConfig);
        const collections = Object.keys(encryptionConfig.collections);
        console.log(`🔐 Field-level encryption is ON for: ${collections.join(', ')}`);
        return protectedDb;
    } catch (error) {
        // Toolkit errors are already redacted — they never carry keys or values.
        const detail = isEncryptionToolkitError(error)
            ? `${error.code}: ${error.message}`
            : error.message;
        console.error(`❌ Failed to enable field-level encryption — ${detail}`);
        throw error;
    }
}

module.exports = { isEncryptionEnabled, protectDatabase };
