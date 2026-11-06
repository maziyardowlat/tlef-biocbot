# Student chat encryption rollout

BiocBot uses `@ubc/genai-toolkit-encryption` to encrypt chat transcripts, other
student- or instructor-written text, stored LMS tokens, and user data (who a
person is, their LMS grades, and what they have been struggling with) in
MongoDB. Application code continues to read and write normal JavaScript objects;
MongoDB stores an authenticated AES-256-GCM envelope in place of each configured
field.

## Protected collections

One policy, one key, one namespace covers all of them:

| Collection | Encrypted fields | Written by |
| --- | --- | --- |
| `chat_sessions` | `chatData`, `title`, `studentName` | student course chat |
| `student_super_course_chat_sessions` | `chatData`, `title`, `studentName` | student Super Course chat |
| `instructor_chat_sessions` | `chatData`, `title`, `instructorName` | instructor Super Course chat |
| `mentalHealthFlags` | `message`, `conversationContext`, `llmReason`, `studentName`, `concernLevel` | wellbeing check on student messages |
| `flaggedQuestions` | `questionContent`, `flagDescription`, `instructorResponse`, `studentName`, `reporterName`, `instructorName` | flag button and instructor replies |
| `messageFeedback` | `messageContentPreview`, `studentName` | thumbs up/down on a bot reply |
| `chatSurveyResponses` | `comment`, `studentName` | end-of-chat survey |
| `quizAttempts` | `studentAnswer`, `feedback`, `correct` | quiz answers, their AI feedback, and whether each was right |
| `lms_canvas_tokens` | `tokens` | instructor connecting Canvas (OAuth access and refresh tokens) |
| `lms_moodle_tokens` | `tokens` | instructor connecting Moodle (web-service token) |
| `users` | `username`, `email`, `displayName`, `puid`, `samlId`, `academicStudentId`, `struggleState` | login, roster syncs, struggle tracking |
| `struggleActivity` | `studentName`, `topic` | struggle tracking |
| `lms_identity_mappings` | `externalLabel`, `externalEmail` | roster sync (the student's name and email in the LMS) |
| `lms_grade_snapshots` | `score`, `grade` | grade import |
| `userAgreements` | `ipAddress`, `userAgent` | accepting the terms |

Chat titles are encrypted because the app builds them from the first 50
characters of the student's first question.

The LMS tokens are credentials: a Moodle web-service token, or a Canvas refresh
token together with the Canvas client secret, acts as that instructor in the
LMS. The LMS toolkit's token store only looks them up by `userKey`, so they need
no blind index. A deployment that renames these collections with
`CANVAS_TOKEN_COLLECTION_NAME` or `MOODLE_TOKEN_COLLECTION_NAME` keeps them
protected under the new name; use that name wherever this guide says
`lms_canvas_tokens` or `lms_moodle_tokens`.

The map lives in `ENCRYPTED_FIELDS` in `src/config/chatEncryption.js` and is
the single source the config, the synthetic canary, and the tests all read. Add
a field there and it is protected everywhere at once — but only after checking
that nothing filters, sorts, regex-searches, groups, or indexes on it. The
toolkit rejects all of those on an encrypted field, and it rejects `$group`
anywhere on a protected collection; that is why the flag, mental-health, and
quiz statistics count in code instead of with an aggregation.

AI provider API keys are encrypted separately, with
`BIOCBOT_KEY_ENCRYPTION_SECRET`, not by this policy.

The rollout deliberately leaves opaque ids (`userId`, `courseId`, `studentId`,
`instructorId`, `superchatId`, `sessionId`, `flagId`), `role`, `unitName`,
statuses, `flagReason`, `messageCount`, `duration`, `savedAt`,
timestamps, and deletion flags in plaintext. They remain available for existing
filters, sorts, retention jobs, pseudonymization, and dashboards — including the
`distinct('studentId', …)` query behind Super Course pseudonyms. A record's
`studentId` says nothing about who the student is without the encrypted `users`
row.

### Finding users: blind indexes

`users` is searched by value: login by PUID, SAML id, username, and email, and
the roster syncs by PUID, email, and student number. Those five fields therefore
also store a keyed digest (`puid__bidx` and so on) under a second secret,
`BIOCBOT_BLIND_INDEX_KEY`. The wrapper rewrites an equality or `$in` lookup to
compare digests, so the code that does the lookup does not change. Digests are
removed from every document the wrapper returns.

They cost two things:

- Someone with database access can see which rows share a value, though not what
  the value is. That is why only high-cardinality identifiers have one. None is
  unique, because nothing enforces uniqueness on `users` today.
- There is no sorting, range, or substring search on these fields. The system
  admin list sorts in the application for this reason. A future "search users by
  name" feature would have to read and match in the application as well.

**`BIOCBOT_BLIND_INDEX_KEY` cannot be changed casually.** The toolkit has no
online rotation for it: a new key means lookups stop finding existing accounts,
and CWL login would then create duplicates, until every digest is rebuilt. Keep
it with the data key, separately from database backups.

### Identity kept out of plaintext stores

Some places cannot use field encryption, so they no longer hold identity:

- `courses.studentEnrollment` is keyed by user id, and the toolkit cannot address
  a dynamic key. Academic roster sync used to copy each student's PUID, student
  number, email, and name there; it now stores only the enrollment state and
  finds its students by user id. `stripEnrollmentIdentity` removes older copies
  on every server start.
- The `sessions` collection, which `connect-mongo` writes directly. Sessions hold
  the user id and role, not the display name. Sessions saved before this release
  expire within 24 hours.
- `settings` and `providerMigrations` record who made a change as a user id, not
  an email.
- Logging on the login, session, chat, quiz evaluation, struggle-tracking, and
  document search paths carries user ids, not names, emails, PUIDs, SAML assertions,
  request bodies, or student messages. This is not a guarantee about every log line
  in the application; the field encryption does not cover logs.

### Not covered

- `superchat_notes` and the Super Chat notes Qdrant collection hold each note's
  text and its author's name. The toolkit cannot encrypt a vector payload, and
  retrieval needs the text, so this waits for a decision about Qdrant as a whole.
- `documents` and Qdrant course material, which are course content.
- `persistenceTopics`, which holds topic names and opaque student ids per course.
- Admin emails written before this release: `updatedBy` in `settings` until that
  setting is next saved, `requestedBy` in `providerMigrations`, and
  `permissions.systemAdminGrantedBy` on `users`. Whatever older backups and logs
  already contain is not covered either.

Each envelope's additional authenticated data binds it to its own namespace,
collection, field, and key id, so a ciphertext cannot be moved between these
collections or fields even though they share a key.

## Security boundary

A person with MongoDB access but without the application key cannot decrypt the
configured fields. Someone who compromises both the running application
and its key can decrypt it because BiocBot must possess the key to show chat
history. The wrapper does not protect plaintext in logs, exports, browser
storage, Qdrant, application memory, or third-party calls.

The assessment-summary repair script now uses the protected database wrapper,
but its pre-change JSON backup is still an intentional plaintext export. The
file is created with owner-only permissions and must be handled under the
applicable data-retention and transfer policy.

Only writes through the protected wrapper are encrypted. Anything that writes a
configured collection on the raw `Db` stores plaintext, and the canary cannot
see that because it writes through the wrapper itself. This is why the server
builds the wrapper before the LMS integration and hands it to the token stores,
and why `scripts/seed-local-lms-grades.js` opens the database the same way.

The server builds the wrapper first, before Passport and the auth service: login
reads and writes `users` constantly, and on the raw `Db` it would miss encrypted
rows and give a returning student a second account.

The chat encryption key must be independent from
`BIOCBOT_KEY_ENCRYPTION_SECRET`, MongoDB credentials, and
`BIOCBOT_BLIND_INDEX_KEY`, and those two encryption keys must differ from each
other. Keep them outside source control and separate from database backups.

## Local canary

Run the synthetic real-MongoDB canary first:

```bash
npm run encryption:canary
```

It creates a uniquely named temporary database, writes one synthetic document
through the wrapper **into every collection in `ENCRYPTED_FIELDS`**, with a
marker string in every configured field. It verifies that each configured field
is stored as an envelope, that the marker appears nowhere at rest, that a
protected read returns the original values, and that every blind-indexed field
stores a digest and can be looked up in both mixed and strict modes. It reports
only non-sensitive structural metadata and drops the temporary database. A field
added to the policy but not actually protected fails the canary instead of
passing it silently.

1. Generate two dedicated keys, by running this twice:

   ```bash
   node -e "console.log(require('node:crypto').randomBytes(32).toString('base64'))"
   ```

2. Put the values in the local secret environment as
   `BIOCBOT_CHAT_ENCRYPTION_KEY` and `BIOCBOT_BLIND_INDEX_KEY`. Set:

   ```text
   BIOCBOT_CHAT_ENCRYPTION_ENABLED=true
   BIOCBOT_CHAT_ENCRYPTION_READ_POLICY=mixed
   BIOCBOT_CHAT_ENCRYPTION_QUERY_POLICY=mixed
   ```

3. Start BiocBot and save a new student chat. Chat history and instructor views
   should look unchanged because reads are decrypted transparently.

4. Inspect MongoDB only for structure. `chatData` and `title` should each be an
   object containing `__ubc_enc`, `alg`, `kid`, `iv`, `tag`, and `ct`; neither
   may contain the original `messages` or title text. The same holds for the
   fields listed above in any flag, feedback, survey, or quiz record created
   while testing. Do not copy ciphertext, binary fields, or source documents
   into tickets or logs.

## Existing-data workflow

All commands load `.env` through `src/config/encryption.js`. `plan`, dry-run,
and verify are read-only for application data. Run them from the repository
root.

### Every command names its own collection

The npm scripts **no longer hardcode a collection**. Each invocation must state
its scope with `-- --collection <name>`.

This is deliberate. The toolkit declares `--collection` as a repeatable option,
so passing the flag twice *accumulates* rather than overriding:

```bash
# What the old hardcoded script did with an extra flag:
#   plan --collection chat_sessions --collection student_super_course_chat_sessions
#   -> scope resolves to BOTH collections
```

For `plan` that is merely surprising. For `migrate` it silently widens the blast
radius to a collection the operator never named. With the flag removed from the
scripts, a bare invocation now fails loudly instead:

```text
collection scope is required: pass --collection <name> one or more times,
or --all-configured to opt in to every configured collection
```

`--all-configured` is available for the read-only commands
(`encryption:plan:all`, `encryption:verify:all`) and refuses to combine with
`--collection`. Migrations are intentionally left one collection at a time.

### `student_super_course_chat_sessions`

```bash
# 1. Plan and dry-run (read-only)
npm run encryption:plan -- --collection student_super_course_chat_sessions
npm run encryption:migrate:dry-run -- --collection student_super_course_chat_sessions

# 2. Bounded canary, after a tested backup that does not contain the key
npm run encryption:migrate -- --collection student_super_course_chat_sessions --max-documents 25 --backup-confirmed --verify
npm run encryption:status
npm run encryption:verify -- --collection student_super_course_chat_sessions

# 3. Full migration, then verification
npm run encryption:migrate -- --collection student_super_course_chat_sessions --backup-confirmed --verify
npm run encryption:verify -- --collection student_super_course_chat_sessions
```

### `instructor_chat_sessions`

```bash
# 1. Plan and dry-run (read-only)
npm run encryption:plan -- --collection instructor_chat_sessions
npm run encryption:migrate:dry-run -- --collection instructor_chat_sessions

# 2. Bounded canary, after a tested backup that does not contain the key
npm run encryption:migrate -- --collection instructor_chat_sessions --max-documents 25 --backup-confirmed --verify
npm run encryption:status
npm run encryption:verify -- --collection instructor_chat_sessions

# 3. Full migration, then verification
npm run encryption:migrate -- --collection instructor_chat_sessions --backup-confirmed --verify
npm run encryption:verify -- --collection instructor_chat_sessions
```

### `chat_sessions`

Unchanged apart from naming the collection explicitly:

```bash
npm run encryption:plan -- --collection chat_sessions
npm run encryption:migrate:dry-run -- --collection chat_sessions
npm run encryption:migrate -- --collection chat_sessions --max-documents 25 --backup-confirmed --verify
npm run encryption:migrate -- --collection chat_sessions --backup-confirmed --verify
npm run encryption:verify -- --collection chat_sessions
```

### Chat titles in already-migrated chats

`title` joined the policy after `chatData`. A chat collection migrated before
that still has plaintext titles; running its commands above again encrypts only
the titles. The migration checks each configured field separately and skips
values already in their target state, so `chatData` is not re-encrypted.

Use toolkit `0.1.1` or later for these reruns. In `0.1.0`, a rerun resumed
after a finished checkpoint and could skip older documents while still
reporting `completed`. If chat migrations were rerun under `0.1.0`, run
`npm run encryption:plan:all` after upgrading; it counts any plaintext left in
configured fields without printing values.

### `users`

Create the digest indexes first, so lookups stay fast as digests are written.
`ensure-indexes` never drops anything. Existing accounts keep signing in
throughout: under mixed queries, a lookup matches either the digest or the
plaintext value.

```bash
npm run encryption:plan -- --collection users
npm run encryption:ensure-indexes -- --collection users --dry-run
npm run encryption:ensure-indexes -- --collection users --backup-confirmed
npm run encryption:migrate:dry-run -- --collection users
npm run encryption:migrate -- --collection users --max-documents 25 --backup-confirmed --verify
npm run encryption:migrate -- --collection users --backup-confirmed --verify
npm run encryption:verify -- --collection users
```

### Free-text and user data collections

`mentalHealthFlags`, `flaggedQuestions`, `messageFeedback`,
`chatSurveyResponses`, `quizAttempts`, `struggleActivity`,
`lms_identity_mappings`, `lms_grade_snapshots`, and `userAgreements` follow the
same sequence. Run it once per collection, substituting its name. The chat
collections need their commands above run again as well, to encrypt `studentName`
and `instructorName`; values already encrypted are skipped.

```bash
npm run encryption:plan -- --collection mentalHealthFlags
npm run encryption:migrate:dry-run -- --collection mentalHealthFlags
npm run encryption:migrate -- --collection mentalHealthFlags --max-documents 25 --backup-confirmed --verify
npm run encryption:migrate -- --collection mentalHealthFlags --backup-confirmed --verify
npm run encryption:verify -- --collection mentalHealthFlags
```

Run each collection's canary, review it, and only then remove `--max-documents`.
Migrate one collection at a time so a failure is scoped to one dataset.

### LMS token collections

`lms_canvas_tokens` and `lms_moodle_tokens` follow the same sequence. Tokens
stored before encryption was turned on keep working under mixed reads, so
instructors stay connected while the migration runs.

```bash
npm run encryption:plan -- --collection lms_canvas_tokens
npm run encryption:migrate:dry-run -- --collection lms_canvas_tokens
npm run encryption:migrate -- --collection lms_canvas_tokens --max-documents 25 --backup-confirmed --verify
npm run encryption:migrate -- --collection lms_canvas_tokens --backup-confirmed --verify
npm run encryption:verify -- --collection lms_canvas_tokens
```

Then the same commands with `--collection lms_moodle_tokens`. A database
backup taken before this migration still holds the tokens in plaintext, so
handle it as a credential store until it expires.

The toolkit migration is idempotent, resumable, lease-protected, and checks for
concurrent changes before updating a document. Its checkpoint collection is
`_ubc_encryption_migrations` and contains operational metadata, not chat data or
keys.

### Schema fingerprint changes

Every change to `ENCRYPTED_FIELDS` changes the configuration's schema
fingerprint — adding the two Super Course chat collections did, adding the
titles and free-text collections did again, and so did adding the LMS token
collections and the user data. Two consequences:

- The default migration id derives from the fingerprint, so it changes too. Any
  checkpoint from an earlier migration is not resumed by default, and
  `npm run encryption:status` reports it with
  `schemaMatchesCurrentConfig: false`. That row is historical; it is not an
  error. Passing an explicit `--migration-id` from before the change would raise
  a lease error — start a new id instead.
- **Existing ciphertext is unaffected.** The fingerprint is migration metadata
  only; it is not part of the additional authenticated data. Envelopes written
  under the previous single-collection policy still decrypt, which
  `tests/unit/services/chatEncryption.test.js` asserts directly.

## Moving from mixed to strict

Keep mixed reads while plaintext and encrypted documents coexist. The policies
are global, not per collection, so strict mode requires **every configured
collection** to be fully migrated and verified first. Only then should staging
change to:

```text
BIOCBOT_CHAT_ENCRYPTION_READ_POLICY=strict
BIOCBOT_CHAT_ENCRYPTION_QUERY_POLICY=encrypted
```

Both switches move together: the toolkit rejects a `strict` read policy
alongside a `mixed` query policy at configuration time.

Restart and exercise save, history, continue-chat, instructor download, student
analytics, deletion, title update, and pseudonym flows — for the course chat,
the student Super Course chat, and the instructor Super Course chat — then the
mental-health flag list and stats, flagged questions and their stats, message
feedback, the chat survey, and quiz attempts and stats, then connecting,
importing from, and disconnecting Canvas and Moodle. Also sign in with CWL and
with a local account, run an LMS and an academic roster sync, import grades, open
the Student Hub and the weekly struggle chart, and list, grant, and revoke a
system admin. Strict reads fail closed
if any configured value is plaintext, malformed, tampered with, or encrypted
under an unavailable key.

### Adding a collection to an environment that is already strict

A collection newly added to `ENCRYPTED_FIELDS` still holds plaintext when the
release that adds it is deployed. Under strict reads every one of those rows
fails with `PLAINTEXT_VALUE_REJECTED`. For the LMS token collections that means
every instructor who connected Canvas or Moodle earlier gets an error on each
LMS request, not a "not connected" prompt. So, in a strict environment:

1. Set the environment back to `mixed` / `mixed`, then deploy the release.
2. Migrate and verify the new collections as described above.
3. Run `npm run encryption:plan:all` to confirm nothing plaintext is left, then
   switch back to `strict` / `encrypted`.

An environment that is still on mixed reads needs no change; deploy, then
migrate. The new collections use the existing `BIOCBOT_CHAT_ENCRYPTION_KEY`.

### Adding `BIOCBOT_BLIND_INDEX_KEY` to an environment that already has encryption on

**Set this secret before deploying the release that adds user data.** A server
with encryption enabled refuses to start without it, and says so by name:
`environment variable BIOCBOT_BLIND_INDEX_KEY is not set`. Generate it the same
way as the data key, and do not reuse that key. Also add it wherever the migration
commands run.

## Staging gate

Before staging deployment:

- Pin and install toolkit version `0.1.1` from UBC GitHub Packages.
- Inject both dedicated keys through the staging secret manager; never commit
  them.
- Confirm the keys and MongoDB backup are stored separately.
- Capture a tested pre-migration backup and a restore point.
- Run the test suite and a local encrypted-write/raw-storage canary.
- Deploy mixed-read/encrypted-write mode first.
- Confirm newly written records are encrypted at rest and readable in every UI,
  for every collection in the table above.
- Run plan, dry-run, a small migration canary, full migration, and verification
  — separately for each collection in the table above.
- Switch to strict/encrypted policies in a later deployment after verification.
- Monitor typed toolkit authentication and plaintext-rejection failures.

Turning the feature flag off does not decrypt records already migrated. Recovery
requires keeping the key and mixed decryption available, using the toolkit's
guarded `decrypt` workflow with explicit plaintext confirmation, or restoring a
pre-migration backup.
