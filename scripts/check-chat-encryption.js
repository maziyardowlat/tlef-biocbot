#!/usr/bin/env node
'use strict';

require('dotenv').config({ quiet: true });

const { randomBytes } = require('node:crypto');
const { MongoClient } = require('mongodb');
const {
    BLIND_INDEXED_FIELDS,
    buildChatEncryptionConfig,
    requireEncryptionToolkit,
    resolveEncryptedFields
} = require('../src/config/chatEncryption');

/** Every configured value carries this, so stored plaintext is easy to spot. */
const SYNTHETIC_MARKER = 'synthetic-canary-plaintext';

/**
 * The synthetic document each collection is probed with. Every configured
 * field gets a value containing SYNTHETIC_MARKER; the operational fields around
 * them must survive as plaintext so existing filters and sorts keep working.
 *
 * @param {string} collectionName
 * @param {readonly string[]} fields
 */
function syntheticDocument(collectionName, fields) {
    /** @type {Record<string, any>} */
    const document = {
        canaryId: `synthetic-canary-${collectionName}`,
        courseId: 'SYNTH-101',
        studentId: 'synthetic-student',
        isDeleted: false,
        savedAt: new Date().toISOString()
    };
    for (const field of fields) {
        const text = `${SYNTHETIC_MARKER} ${collectionName}.${field}`;
        // A blind-indexed field holds an identifier, which is what gets looked up.
        document[field] = BLIND_INDEXED_FIELDS[collectionName]?.[field]
            ? text
            : { messages: [{ type: 'user', content: text }] };
    }
    return document;
}

async function main() {
    if (!process.env.MONGO_URI) {
        throw new Error('MONGO_URI is required for the synthetic encryption canary');
    }

    const { createEncryptedDb } = requireEncryptionToolkit();

    const databaseName = `biocbot-encryption-canary-${process.pid}-${Date.now()}`;
    const client = new MongoClient(process.env.MONGO_URI);
    let canaryDb;

    try {
        await client.connect();
        canaryDb = client.db(databaseName);

        const canaryEnv = {
            ...process.env,
            BIOCBOT_CHAT_ENCRYPTION_KEY: randomBytes(32).toString('base64'),
            BIOCBOT_BLIND_INDEX_KEY: randomBytes(32).toString('base64')
        };
        const protectedDb = await createEncryptedDb(canaryDb, buildChatEncryptionConfig({
            ...canaryEnv,
            BIOCBOT_CHAT_ENCRYPTION_READ_POLICY: 'mixed',
            BIOCBOT_CHAT_ENCRYPTION_QUERY_POLICY: 'mixed'
        }));
        // What an environment runs once every collection is migrated: lookups
        // use only the digest, and any plaintext left in a field is rejected.
        const strictDb = await createEncryptedDb(canaryDb, buildChatEncryptionConfig({
            ...canaryEnv,
            BIOCBOT_CHAT_ENCRYPTION_READ_POLICY: 'strict',
            BIOCBOT_CHAT_ENCRYPTION_QUERY_POLICY: 'encrypted'
        }));

        // Every configured collection is probed, not just the first one. A
        // collection added to the policy but missed here would otherwise pass a
        // green canary while writing plaintext in production.
        const report = {
            database: databaseName,
            collections: {}
        };

        for (const [collectionName, fields] of Object.entries(resolveEncryptedFields(process.env))) {
            const protectedCollection = protectedDb.collection(collectionName);
            const rawCollection = canaryDb.collection(collectionName);
            const document = syntheticDocument(collectionName, fields);

            await protectedCollection.insertOne(document);
            const raw = await rawCollection.findOne({ canaryId: document.canaryId });
            const roundTrip = await protectedCollection.findOne({ canaryId: document.canaryId });

            /** @type {Record<string, any>} */
            const storedFields = {};
            for (const field of fields) {
                const envelope = raw?.[field];
                storedFields[field] = {
                    isEnvelope: envelope?.__ubc_enc === 1,
                    algorithm: envelope?.alg,
                    keyId: envelope?.kid,
                    ivBytes: envelope?.iv?.buffer?.length,
                    tagBytes: envelope?.tag?.buffer?.length,
                    hasCiphertext: (envelope?.ct?.buffer?.length || 0) > 0
                };
            }

            /** @type {Record<string, any>} */
            const blindIndexes = {};
            for (const field of Object.keys(BLIND_INDEXED_FIELDS[collectionName] || {})) {
                const lookup = { [field]: document[field] };
                const [mixedHit, strictHit] = await Promise.all([
                    protectedCollection.findOne(lookup),
                    strictDb.collection(collectionName).findOne(lookup)
                ]);
                blindIndexes[field] = {
                    hasDigest: typeof raw?.[`${field}__bidx`] === 'string',
                    mixedLookupFindsRow: mixedHit?.canaryId === document.canaryId,
                    strictLookupFindsRow: strictHit?.canaryId === document.canaryId,
                    digestHiddenFromReads: !Object.hasOwn(mixedHit || {}, `${field}__bidx`)
                };
            }

            const collectionReport = {
                isProtected: protectedDb.isProtected(collectionName),
                operationalFieldsRemainQueryable:
                    raw?.canaryId === document.canaryId && raw?.courseId === document.courseId,
                storedFields,
                blindIndexes,
                plaintextPresentAtRest: JSON.stringify(raw).includes(SYNTHETIC_MARKER),
                protectedReadMatches: fields.every(
                    (field) => JSON.stringify(roundTrip?.[field]) === JSON.stringify(document[field])
                )
            };
            report.collections[collectionName] = collectionReport;

            if (
                !collectionReport.isProtected ||
                !collectionReport.operationalFieldsRemainQueryable ||
                !Object.values(storedFields).every((stored) => stored.isEnvelope) ||
                !Object.values(blindIndexes).every((index) => Object.values(index).every(Boolean)) ||
                collectionReport.plaintextPresentAtRest ||
                !collectionReport.protectedReadMatches
            ) {
                throw new Error(
                    `synthetic encryption canary did not meet its assertions for ${collectionName}`
                );
            }
        }

        console.log(JSON.stringify(report, null, 2));
    } finally {
        if (canaryDb) {
            await canaryDb.dropDatabase();
            console.log(`Removed synthetic canary database: ${databaseName}`);
        }
        await client.close();
    }
}

if (require.main === module) {
    main().catch((error) => {
        console.error(error.message);
        process.exitCode = 1;
    });
}
