/**
 * BiocBot field-level encryption configuration.
 *
 * Declares which collections and fields are encrypted before they reach MongoDB
 * and decrypted after they are read back. Everything not listed here is stored
 * exactly as it was before and comes back from `db.collection()` as an ordinary
 * driver collection.
 *
 * The namespace and every key id below are authenticated into each ciphertext.
 * Changing `namespace`, or a field's configured path, makes data already written
 * under the old value undecryptable — treat them as permanent once data exists.
 *
 * Phase 1 protects free-text a student or instructor typed, plus the names
 * attached to it. Fields chosen here were audited against every query in the
 * codebase: none of them is sorted on, range-queried, regex-searched, or used in
 * an equality filter, so no blind indexes are required. See ENCRYPTION.md before
 * adding a field.
 */

'use strict';

const { defineEncryptionConfig, EnvironmentKeyProvider } = require('ubc-genai-toolkit-encryption');

/**
 * Message content inside a saved chat transcript. `type`, `timestamp`, and
 * `sourceAttribution` stay plaintext — the transcript UI and the duration
 * calculation read them, and they carry no student writing.
 */
const CHAT_MESSAGE_FIELDS = {
    'chatData.messages.$[].content': { encrypt: true }
};

module.exports = defineEncryptionConfig({
    namespace: 'tlef-biocbot',

    keyProvider: new EnvironmentKeyProvider({
        activeEncryptionKey: {
            id: 'data-2026-01',
            env: 'BIOCBOT_DATA_ENCRYPTION_KEY'
        },
        // Retired keys stay listed until `rotate` has been verified, so
        // envelopes naming them remain readable.
        decryptionKeys: [],
        // No field in Phase 1 is looked up by value, so no blind-index key is
        // needed yet. Adding one is what unlocks equality queries on an
        // encrypted field (see ENCRYPTION.md, "Adding a field").
        blindIndexKeys: []
    }),

    // Rollout stage. `mixed` reads and queries tolerate rows written before the
    // migration ran; `encrypted` writes mean everything new is protected from
    // the moment this deploys. Move to strict/encrypted once `verify` passes.
    readPolicy: 'mixed',
    queryPolicy: 'mixed',
    writePolicy: 'encrypted',

    // GridFS binaries, `db.admin()`, and `db.dropCollection()` all need a driver
    // `Db`, which the wrapper is not. `src/services/rawDb.js` is the only place
    // allowed to unwrap one, and GridFS streams are outside this toolkit's scope
    // in either case.
    allowRawAccess: true,

    collections: {
        // Student chat transcripts, per course.
        chat_sessions: {
            fields: {
                ...CHAT_MESSAGE_FIELDS,
                studentName: { encrypt: true },
                title: { encrypt: true }
            }
        },

        // Instructor Super Course transcripts.
        instructor_chat_sessions: {
            fields: {
                ...CHAT_MESSAGE_FIELDS,
                instructorName: { encrypt: true },
                title: { encrypt: true }
            }
        },

        // Student Super Course transcripts.
        student_super_course_chat_sessions: {
            fields: {
                ...CHAT_MESSAGE_FIELDS,
                studentName: { encrypt: true },
                title: { encrypt: true }
            }
        },

        // AI-detected mental health concerns. The most sensitive collection in
        // the application: it stores the message that triggered the flag and the
        // surrounding conversation, and is readable only by instructors/admins.
        // `status`, `concernLevel`, and `courseId` stay plaintext because the
        // flag list filters and counts on them.
        mentalHealthFlags: {
            fields: {
                message: { encrypt: true },
                'conversationContext.$[].content': { encrypt: true },
                llmReason: { encrypt: true },
                studentName: { encrypt: true }
            }
        },

        // Platform-level instructor notes feeding Super Chat retrieval. The
        // Qdrant copy of this text is outside the toolkit entirely.
        superchat_notes: {
            fields: {
                title: { encrypt: true },
                content: { encrypt: true }
            }
        }
    },

    database: {
        uriEnv: 'MONGO_URI',
        databaseEnv: 'MONGO_DB_NAME'
    }
});
