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
const ACTIVE_BLIND_INDEX_KEY_ID = 'user-lookup-2026-11';
const BLIND_INDEX_KEY_ENV = 'BIOCBOT_BLIND_INDEX_KEY';

/**
 * Every protected collection and the fields encrypted in it, in the order an
 * operator should migrate them.
 *
 * Most fields hold student- or instructor-written text, or text copied from a
 * chat: transcripts, chat titles (the app derives them from the first
 * question), mental-health flag excerpts, flagged responses, feedback previews,
 * survey comments, and quiz answers. The two LMS token collections hold each
 * instructor's Canvas OAuth tokens and Moodle web-service token, which the LMS
 * toolkit's token store only ever looks up by `userKey`.
 *
 * The rest says who a person is, or attaches something sensitive to them: the
 * `users` identity fields, the copies of names and emails saved on other
 * records, LMS grades and quiz results, what a student has been struggling
 * with, and the IP address and browser recorded when they accepted the terms.
 *
 * None of these is ever filtered, sorted, regex-searched, grouped, or indexed,
 * apart from the lookups listed in BLIND_INDEXED_FIELDS. That is what makes
 * encrypting them safe; a field that is must not be added here without a query
 * review.
 *
 * One key and one namespace cover them all. The migration CLI, the synthetic
 * canary, and the rollout runbook all read this map, so a field can never be
 * encrypted in one place and forgotten in another. The token collections are
 * listed under their default names; resolveEncryptedFields follows a
 * deployment that renames them.
 *
 * Note that the AAD binds each envelope to its own collection and field, so a
 * ciphertext cannot be moved between them even though they share a key.
 *
 * @type {Readonly<Record<string, readonly string[]>>}
 */
const ENCRYPTED_FIELDS = Object.freeze({
    chat_sessions: Object.freeze(['chatData', 'title', 'studentName']),
    student_super_course_chat_sessions: Object.freeze(['chatData', 'title', 'studentName']),
    instructor_chat_sessions: Object.freeze(['chatData', 'title', 'instructorName']),
    mentalHealthFlags: Object.freeze(['message', 'conversationContext', 'llmReason', 'studentName', 'concernLevel']),
    flaggedQuestions: Object.freeze(['questionContent', 'flagDescription', 'instructorResponse', 'studentName', 'reporterName', 'instructorName']),
    messageFeedback: Object.freeze(['messageContentPreview', 'studentName']),
    chatSurveyResponses: Object.freeze(['comment', 'studentName']),
    quizAttempts: Object.freeze(['studentAnswer', 'feedback', 'correct']),
    lms_canvas_tokens: Object.freeze(['tokens']),
    lms_moodle_tokens: Object.freeze(['tokens']),
    users: Object.freeze(['username', 'email', 'displayName', 'puid', 'samlId', 'academicStudentId', 'struggleState']),
    struggleActivity: Object.freeze(['studentName', 'topic']),
    lms_identity_mappings: Object.freeze(['externalLabel', 'externalEmail']),
    lms_grade_snapshots: Object.freeze(['score', 'grade']),
    userAgreements: Object.freeze(['ipAddress', 'userAgent'])
});

/**
 * The encrypted fields BiocBot still has to find a row by. Each stores a keyed
 * digest of its value beside the ciphertext, so an equality or $in lookup keeps
 * working; sorting, ranges, and regex searches do not. Login finds accounts by
 * PUID, SAML id, username, and email, and the roster syncs by PUID, email, and
 * student number.
 *
 * A digest shows which rows share a value, so only high-cardinality identifiers
 * belong here. None is unique: nothing enforces uniqueness on `users` today,
 * and basic and SAML accounts may legitimately share an email.
 *
 * Maps collection -> field -> the toolkit's normalizer for that value.
 *
 * @type {Readonly<Record<string, Readonly<Record<string, 'exact' | 'email'>>>>}
 */
const BLIND_INDEXED_FIELDS = Object.freeze({
    users: Object.freeze({
        username: 'exact',
        email: 'email',
        puid: 'exact',
        samlId: 'exact',
        academicStudentId: 'exact'
    })
});

/**
 * @param {string} collection
 * @param {string} field
 * @returns {{ encrypt: true, blindIndex?: { field: string, keyId: string, normalize: string, unique: false } }}
 */
function buildFieldPolicy(collection, field) {
    const normalize = BLIND_INDEXED_FIELDS[collection]?.[field];
    if (!normalize) return { encrypt: true };
    return {
        encrypt: true,
        blindIndex: {
            field: `${field}__bidx`,
            keyId: ACTIVE_BLIND_INDEX_KEY_ID,
            normalize,
            unique: false
        }
    };
}

/** @type {readonly string[]} */
const ENCRYPTED_COLLECTIONS = Object.freeze(Object.keys(ENCRYPTED_FIELDS));

/**
 * The LMS token collections' default names and the variables that rename them.
 * The token stores and the encryption policy both resolve names through
 * getLmsTokenCollectionName, so a renamed collection cannot slip out of the
 * policy and keep its tokens in plaintext.
 */
const LMS_TOKEN_COLLECTIONS = Object.freeze({
    canvas: Object.freeze({ defaultName: 'lms_canvas_tokens', env: 'CANVAS_TOKEN_COLLECTION_NAME' }),
    moodle: Object.freeze({ defaultName: 'lms_moodle_tokens', env: 'MOODLE_TOKEN_COLLECTION_NAME' })
});

/**
 * @param {'canvas' | 'moodle'} provider
 * @param {NodeJS.ProcessEnv | Record<string, string | undefined>} env
 * @returns {string}
 */
function getLmsTokenCollectionName(provider, env = process.env) {
    const { defaultName, env: envName } = LMS_TOKEN_COLLECTIONS[provider];
    return env[envName] || defaultName;
}

/**
 * ENCRYPTED_FIELDS with the LMS token collections under the names this
 * deployment actually uses.
 *
 * @param {NodeJS.ProcessEnv | Record<string, string | undefined>} env
 * @returns {Record<string, readonly string[]>}
 */
function resolveEncryptedFields(env = process.env) {
    /** @type {Record<string, string>} */
    const renamed = Object.fromEntries(
        Object.entries(LMS_TOKEN_COLLECTIONS).map(([provider, { defaultName }]) => [
            defaultName,
            getLmsTokenCollectionName(/** @type {'canvas' | 'moodle'} */ (provider), env)
        ])
    );
    return Object.fromEntries(
        Object.entries(ENCRYPTED_FIELDS).map(([name, fields]) => [renamed[name] || name, fields])
    );
}

/**
 * Build BiocBot's application-owned encryption policy.
 *
 * The rollout protects the fields listed in ENCRYPTED_FIELDS. Operational
 * fields (opaque ids, statuses, timestamps) stay plaintext so existing filters,
 * sorts, retention, pseudonymization, and dashboard queries keep their current
 * semantics.
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
            blindIndexKeys: [{ id: ACTIVE_BLIND_INDEX_KEY_ID, env: BLIND_INDEX_KEY_ENV }],
            env
        }),
        readPolicy,
        queryPolicy,
        writePolicy: 'encrypted',
        collections: Object.fromEntries(
            Object.entries(resolveEncryptedFields(env)).map(([name, fields]) => [
                name,
                { fields: Object.fromEntries(fields.map((field) => [field, buildFieldPolicy(name, field)])) }
            ])
        ),
        database: {
            uriEnv: 'MONGO_URI'
        }
    });
}

module.exports = {
    ACTIVE_BLIND_INDEX_KEY_ID,
    ACTIVE_CHAT_KEY_ID,
    BLIND_INDEX_KEY_ENV,
    BLIND_INDEXED_FIELDS,
    CHAT_ENCRYPTION_NAMESPACE,
    ENCRYPTED_COLLECTIONS,
    ENCRYPTED_FIELDS,
    TOOLKIT_PACKAGE,
    buildChatEncryptionConfig,
    getLmsTokenCollectionName,
    loadEncryptionToolkit,
    requireEncryptionToolkit,
    resolveEncryptedFields
};
