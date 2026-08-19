# Field-level encryption

BiocBot encrypts selected MongoDB fields with
[`ubc-genai-toolkit-encryption`](https://github.com/ubc/encryption-toolkit).
Values are encrypted before they are sent to MongoDB and decrypted after an
authorized BiocBot process reads them back. Routes and models keep working with
plaintext; only the database holds ciphertext.

**A person with only MongoDB access cannot read the protected fields. A person
who compromises both the BiocBot runtime and its encryption key can, because the
application must hold the key to use the data.**

---

## What is protected

Declared in [`src/config/encryption.config.js`](../src/config/encryption.config.js).

| Collection | Encrypted fields |
| --- | --- |
| `chat_sessions` | `chatData.messages.$[].content`, `studentName`, `title` |
| `instructor_chat_sessions` | `chatData.messages.$[].content`, `instructorName`, `title` |
| `student_super_course_chat_sessions` | `chatData.messages.$[].content`, `studentName`, `title` |
| `mentalHealthFlags` | `message`, `conversationContext.$[].content`, `llmReason`, `studentName` |
| `superchat_notes` | `title`, `content` |

Everything else — `courses`, `users`, `documents`, `questions`,
`flaggedQuestions`, `settings`, and the rest — is stored exactly as it was
before, and `db.collection()` returns an ordinary driver collection for it.

Inside the protected collections, the surrounding metadata stays plaintext on
purpose: `courseId`, `studentId`, `sessionId`, `status`, `concernLevel`,
`savedAt`, `createdAt`, message `type` and `timestamp`. The application filters,
sorts, and counts on those, and none of them is the sensitive part.

## What is *not* protected

These are properties of the approach, not gaps in the implementation:

- **The Qdrant copy.** `superchat_notes` content is also written to Qdrant as
  `chunkText` and `title` in a plaintext payload, and chat content is embedded
  for retrieval. Encrypting the MongoDB copy does not touch the vector store.
  Anyone with Qdrant access can still read that text.
- **GridFS.** Uploaded course material binaries live in the `documentFiles`
  bucket and are stored exactly as before; the toolkit has no GridFS support.
- **`connect-mongo` sessions.** Session documents are written by that library,
  not through the wrapper.
- **Logs, exports, and LLM calls.** Anything the application prints, exports, or
  sends to a model provider is plaintext at that point.
- **Authorization bugs.** Encryption is not access control. Returning a
  transcript to the wrong user is still a bug that encryption cannot catch.

---

## Turning it on

Encryption is **off by default**. Without the flag, BiocBot behaves exactly as it
did before, which is what local development and the test suites rely on.

```bash
npm run encryption:keygen
```

Put the printed value in that environment's secret store and set:

```
ENCRYPTION_ENABLED=true
BIOCBOT_DATA_ENCRYPTION_KEY=<the generated key>
```

On startup you will see which collections are protected:

```
🔐 Field-level encryption is ON for: chat_sessions, instructor_chat_sessions, …
```

If the flag is on and the key is missing or malformed, **startup fails** and the
process exits. That is deliberate: the alternative is a server that silently
writes plaintext into collections everyone now believes are encrypted.

### Handling the key

- Store it separately from the MongoDB credentials and **outside every database
  backup**. A backup holding both the ciphertext and the key protects nothing.
- Use a different key per environment, and a different key from the one
  encrypting LLM provider credentials. Reusing a key means one compromise breaks
  two systems.
- **There is no escrow.** Lose the key and the encrypted fields are gone.
- Each environment's data is bound to `namespace: 'tlef-biocbot'` and the key id
  `data-2026-01`. Changing the namespace, or renaming a configured field path,
  makes existing data undecryptable.

---

## Migrating data that already exists

New writes are encrypted from the moment the flag goes on. Rows already in the
database are not, and the current `readPolicy: 'mixed'` is what lets both forms
coexist while you migrate.

```bash
npm run encryption:plan                                    # read-only; counts, never values
npm run encryption:migrate -- --collection chat_sessions --dry-run
npm run encryption:migrate -- --collection chat_sessions --backup-confirmed --verify
npm run encryption:verify
```

Take a backup first — the migrate command refuses to write without
`--backup-confirmed`. The runner is idempotent, resumable, and lease-protected,
and it is safe against live writes. Follow the toolkit's
`docs/migration-runbook.md` rather than improvising; the order of the steps is
what keeps the rollout reversible.

Once `verify` passes across every collection, tighten the policies in
`src/config/encryption.config.js` from `mixed` to `strict` reads and `encrypted`
queries. That is the step that turns "new data is encrypted" into "no plaintext
is left".

**Turning the flag back off is not a rollback.** Data already encrypted stays
encrypted, and the app can no longer read it. The real options are to keep
`readPolicy: 'mixed'` deployed, run the guarded `decrypt` command, or restore a
pre-migration backup. Decide which one you would use *before* you migrate.

---

## Working with a protected field

An encrypted value has no order and no substrings, so the wrapper rejects
anything that would need them — loudly, before it reaches MongoDB, rather than
returning wrong results that look right.

| On a protected field | Status |
| --- | --- |
| `insertOne`, `replaceOne`, `updateOne`, `$set`, `$unset`, `$push` | works |
| `findOne` / `find`, projections that include or exclude the whole field | works |
| Sorting, filtering, or counting on the *plaintext* fields beside it | works |
| `{ field: 'value' }` equality | rejected — needs a blind index |
| `$regex`, `$gt`, `$lt`, `$ne`, `$nin` | rejected |
| `sort({ field: 1 })` | rejected |
| `updateMany` touching the field, `$addToSet`, update pipelines | rejected |
| `$group`, `$lookup`, `$unwind` — on the collection at all | rejected |

That last row is why `MentalHealthFlag.getMentalHealthFlagStats` counts with one
`countDocuments` per status instead of a `$group`: only `$match`, `$sort`,
`$skip`, `$limit`, and plain `$project` survive on a configured collection, no
matter which fields the stage touches.

Errors are typed and carry a stable `code`; they never contain values, keys, or
ciphertext.

```js
const { isEncryptionToolkitError } = require('ubc-genai-toolkit-encryption');

if (isEncryptionToolkitError(error) && error.code === 'ENCRYPTED_FIELD_QUERY_NOT_SUPPORTED') {
    // fix the query, or give the field a blind index
}
```

### Adding a field

1. **Audit every query against it** — `grep` for the field name across `src/`.
   If anything sorts, regex-searches, range-queries, or `$group`s on it, that
   code has to change first.
2. If it needs equality lookup (`findOne({ email })`), give it a `blindIndex`
   and add a blind-index key to the key provider. A blind index reveals which
   documents share a value, so use it for high-cardinality identifiers only —
   never for a role, a status, or a boolean.
3. Add it to `src/config/encryption.config.js`. The config validates on load, so
   a bad path fails at startup rather than mid-request.
4. Run `npm run encryption:plan`, then migrate and verify as above.

### Reaching the driver `Db`

`createEncryptedDb` returns a `ProtectedDb`, not a driver `Db` — that is what
stops a stray `db.collection(...)` from writing plaintext into a protected
collection. GridFS, `db.admin()`, and `db.dropCollection()` genuinely need the
object underneath. [`src/services/rawDb.js`](../src/services/rawDb.js) is the
only sanctioned way to get it, so unwrapping stays greppable. Do not use it to
reach ordinary collections.

`app.locals.db` is the protected handle; `app.locals.rawDb` is the driver one.

---

## Verifying it works

Look at a protected collection in Compass or `mongosh`:

- A field showing `{ __ubc_enc: 1, alg: 'A256GCM', kid: 'data-2026-01', … }` is
  correctly encrypted.
- A field showing readable text has not been migrated yet.
- You cannot decrypt anything from the shell, and neither can anyone else with
  the same access. That is the point.

Prefer `npm run encryption:plan` and `npm run encryption:verify` over eyeballing
collections — they classify every value and report counts without printing data.
