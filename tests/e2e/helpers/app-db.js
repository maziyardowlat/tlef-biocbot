// @ts-check
const { initializeChatEncryption, isChatEncryptionEnabled } = require('../../../src/services/chatEncryption');

/**
 * The database as the app sees it: seeded and inspected through the encrypted
 * wrapper when the server under test has field encryption on, so a helper can
 * still find a user by username and write what the app can read. With
 * encryption off, as in CI, this is the plain driver handle.
 *
 * @param {import('mongodb').MongoClient} client
 * @returns {Promise<any>}
 */
async function openAppDb(client) {
    return isChatEncryptionEnabled() ? initializeChatEncryption(client.db()) : client.db();
}

/**
 * Delete the test users whose username starts with a prefix. Matched here because
 * an encrypted username cannot be regex-searched, as the app itself cannot either.
 *
 * @param {any} db
 * @param {string} prefix
 */
async function deleteUsersByUsernamePrefix(db, prefix) {
    const users = await db.collection('users').find({}, { projection: { userId: 1, username: 1 } }).toArray();
    const userIds = users
        .filter((user) => String(user.username || '').startsWith(prefix))
        .map((user) => user.userId);
    if (userIds.length) {
        await db.collection('users').deleteMany({ userId: { $in: userIds } });
    }
}

module.exports = { deleteUsersByUsernamePrefix, openAppDb };
