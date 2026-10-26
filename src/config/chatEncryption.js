'use strict';

const TOOLKIT_PACKAGE = '@ubc/genai-toolkit-encryption';

/** @type {any} */
let encryptionToolkit;

/**
 * The toolkit is published to GitHub Packages, so an install without a registry
 * token (CI, a fresh clone) cannot fetch it — hence it being an optional
 * dependency. Requiring it lazily keeps this module importable when it is
 * absent: the server still boots and the unit suite still runs, and only a
 * deployment that has actually turned chat encryption on needs it present.
 *
 * @returns {any} The toolkit, or null when it is not installed
 */
function loadEncryptionToolkit() {
    if (encryptionToolkit === undefined) {
        try {
            encryptionToolkit = require(TOOLKIT_PACKAGE);
        } catch (error) {
            if (error.code !== 'MODULE_NOT_FOUND') {
                throw error;
            }
            encryptionToolkit = null;
        }
    }
    return encryptionToolkit;
}

/**
 * Same as loadEncryptionToolkit, for the call sites that cannot continue
 * without it: encryption was asked for, so a missing toolkit is a hard error
 * rather than a silent fall back to plaintext writes.
 *
 * @returns {any}
 */
function requireEncryptionToolkit() {
    const toolkit = loadEncryptionToolkit();
    if (toolkit) return toolkit;

    const error = new Error(
        `Student chat encryption requires ${TOOLKIT_PACKAGE}, an optional dependency published to ` +
        'GitHub Packages. Install it with a registry token, or set ' +
        'BIOCBOT_CHAT_ENCRYPTION_ENABLED=false.'
    );
    error.code = 'CHAT_ENCRYPTION_TOOLKIT_MISSING';
    throw error;
}

const CHAT_ENCRYPTION_NAMESPACE = 'tlef-biocbot';
const ACTIVE_CHAT_KEY_ID = 'student-chat-2026-01';

/**
 * Every protected collection and the fields encrypted in it, in the order an
 * operator should migrate them.
 *
 * Each field holds student- or instructor-written text, or text copied from a
 * chat: transcripts, chat titles (the app derives them from the first
 * question), mental-health flag excerpts, flagged responses, feedback previews,
 * survey comments, and quiz answers. None of them is ever filtered, sorted,
 * regex-searched, grouped, or indexed, which is what makes encrypting them safe;
 * a field that is must not be added here without a query review.
 *
 * One key and one namespace cover them all. The migration CLI, the synthetic
 * canary, and the rollout runbook all read this map, so a field can never be
 * encrypted in one place and forgotten in another.
 *
 * Note that the AAD binds each envelope to its own collection and field, so a
 * ciphertext cannot be moved between them even though they share a key.
 *
 * @type {Readonly<Record<string, readonly string[]>>}
 */
const ENCRYPTED_FIELDS = Object.freeze({
    chat_sessions: Object.freeze(['chatData', 'title']),
    student_super_course_chat_sessions: Object.freeze(['chatData', 'title']),
    instructor_chat_sessions: Object.freeze(['chatData', 'title']),
    mentalHealthFlags: Object.freeze(['message', 'conversationContext', 'llmReason']),
    flaggedQuestions: Object.freeze(['questionContent', 'flagDescription', 'instructorResponse']),
    messageFeedback: Object.freeze(['messageContentPreview']),
    chatSurveyResponses: Object.freeze(['comment']),
    quizAttempts: Object.freeze(['studentAnswer', 'feedback'])
});

/** @type {readonly string[]} */
const ENCRYPTED_COLLECTIONS = Object.freeze(Object.keys(ENCRYPTED_FIELDS));

/**
 * Build BiocBot's application-owned encryption policy.
 *
 * The rollout intentionally protects only the free-text fields listed in
 * ENCRYPTED_FIELDS. Operational fields (ids, names, statuses, timestamps) stay
 * plaintext so existing filters, sorts, retention, pseudonymization, and
 * dashboard queries keep their current semantics.
 *
 * @param {NodeJS.ProcessEnv | Record<string, string | undefined>} env
 * @returns {import('@ubc/genai-toolkit-encryption').EncryptionConfig}
 */
function buildChatEncryptionConfig(env = process.env) {
    const { defineEncryptionConfig, EnvironmentKeyProvider } = requireEncryptionToolkit();

    const readPolicy = /** @type {import('@ubc/genai-toolkit-encryption').ReadPolicy} */ (
        env.BIOCBOT_CHAT_ENCRYPTION_READ_POLICY || 'mixed'
    );
    const queryPolicy = /** @type {import('@ubc/genai-toolkit-encryption').QueryPolicy} */ (
        env.BIOCBOT_CHAT_ENCRYPTION_QUERY_POLICY || 'mixed'
    );

    return defineEncryptionConfig({
        namespace: CHAT_ENCRYPTION_NAMESPACE,
        keyProvider: new EnvironmentKeyProvider({
            activeEncryptionKey: {
                id: ACTIVE_CHAT_KEY_ID,
                env: 'BIOCBOT_CHAT_ENCRYPTION_KEY'
            },
            decryptionKeys: [],
            blindIndexKeys: [],
            env
        }),
        readPolicy,
        queryPolicy,
        writePolicy: 'encrypted',
        collections: Object.fromEntries(
            Object.entries(ENCRYPTED_FIELDS).map(([name, fields]) => [
                name,
                { fields: Object.fromEntries(fields.map((field) => [field, { encrypt: true }])) }
            ])
        ),
        database: {
            uriEnv: 'MONGO_URI'
        }
    });
}

module.exports = {
    ACTIVE_CHAT_KEY_ID,
    CHAT_ENCRYPTION_NAMESPACE,
    ENCRYPTED_COLLECTIONS,
    ENCRYPTED_FIELDS,
    TOOLKIT_PACKAGE,
    buildChatEncryptionConfig,
    loadEncryptionToolkit,
    requireEncryptionToolkit
};
