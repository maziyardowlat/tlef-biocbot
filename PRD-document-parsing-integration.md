# PRD — Replace in-process document parsing with the UBC Document Parsing API

**Target branch:** `testing_document_rich` (cut from `main`)
**Requested by:** Rich
**Written:** 2026-08-19
**Status:** Ready to start. No code written yet.

---

## 0. Do these two things first

### 0.1 Cut the branch

This repo is currently on `re_scan`, **not** `main`, and `main` is at a different
commit. So do not branch from wherever HEAD happens to be:

```bash
git checkout main && git pull && git checkout -b testing_document_rich
```

Confirm with `git branch --show-current` before writing any code. All work in
this PRD lands on `testing_document_rich`.

### 0.2 Install the parsing API skill

The service team ships a Claude Skill that documents the whole API contract —
job states, error reasons, retry semantics, quotas, and a copy-paste Node
client. Install it so it loads automatically while you work:

```bash
mkdir -p .claude/skills/ubc-document-parsing && cp ~/ubc-document-parsing-api/docs/agent-skill.md .claude/skills/ubc-document-parsing/SKILL.md
```

Read it before designing anything. It is 541 lines and it answers most of the
questions this PRD deliberately does not repeat.

---

## 1. Why we are doing this

BIOCBOT parses documents **in-process** today, on the request thread, using
`ubc-genai-toolkit-document-parsing` v0.3.1. That has three problems:

1. **It blocks.** A 5-minute timeout races the parse inside the upload handler.
   Large lecture PDFs either time out or hold an HTTP connection open.
2. **It loses provenance.** By the time the toolkit hands back a Markdown
   string, page numbers and heading hierarchy are gone. Nothing downstream can
   recover them at any price — so chat answers cannot cite "page 4, under
   Methods".
3. **It runs the parser inside our process**, so Docling's memory and CPU cost
   land on the app server.

The parsing service fixes all three: it is async job+poll, it chunks the
document *while structure still exists* (so every chunk arrives with `pages`
and `headings`), and the heavy lifting happens in its own worker pool.

**The provenance gain is the point of this work.** If we finish and chunks
still have no `pages`/`headings` in Qdrant, we did it wrong.

---

## 2. What already exists — do not rebuild it

### 2.1 The service is already running locally

Verified 2026-08-19. Do **not** run `make up` — that is a ~17 GB image build
and 10+ minutes. It is already up:

| Container | Port | Status |
|---|---|---|
| gateway | `:8000` | healthy, `GET /healthz` → `{"status":"ok"}` |
| worker ×2 | — | up |
| redis | `:6379` | up |
| minio | `:9000-9001` | up |
| clamav | `:3310` | **healthy** (pipeline is fail-closed on scanning) |
| vlmstub | `:8099` | up (stub VLM for `describe_remote`) |

- Base URL: `http://localhost:8000`
- Dev API key (non-secret, seeded in the repo): `ubcdp_dev_secret`
- If it is ever down: `cd ~/ubc-document-parsing-api && make up`

### 2.2 Reference implementation to port from

`~/ubc-document-parsing-api-example-app/` is a working Express app that does
exactly this integration. Port from it rather than writing from scratch:

| File | Lines | What it gives you |
|---|---|---|
| `server/docparse/client.js` | 165 | `DocParseClient`, `DocParseError` — create/upload/poll/streamChunks |
| `server/docparse/tracker.js` | 132 | `JobTracker` — background polling, bounded concurrency |
| `server/docparse/errors.js` | 80 | `isFinal(status, reason)`, `isRetryable`, `describeReason`, `NON_FINAL_FAILURE_REASONS` |
| `server/routes/4-rag-ingest.js` | 74 | **The closest analogue to our use case** — streams NDJSON chunks in batches of 100 into a DB, with an explicit "THE SEAM" comment marking where embedding goes |
| `docs/app-server-tuning.md` | 229 | nginx/node limits — only needed for the proxied upload path |

⚠️ **The example app is ESM** (`export class`, `import`). BIOCBOT is CommonJS
(`"type": "commonjs"`). Convert to `require`/`module.exports` when porting — do
not add ESM to this repo for this.

---

## 3. Current BIOCBOT behaviour (what you are changing)

### 3.1 The ingestion service

`src/services/documentIngestion.js` (318 lines) exports:

```
MAX_DOCUMENT_BYTES        50 * 1024 * 1024
PPTX_MIME_TYPE
SUPPORTED_DOCUMENT_MIME_TYPES
createDocumentParser      builds DocumentParsingModule w/ imageConcurrency 4 + imageDescriber
createProgressEmitter
ingestDocument            save → index → markUnitStale
ingestFileBuffer          validate → gridfs → parse → build documentData → ingestDocument
isSupportedDocumentMimeType
parseDocumentBuffer       temp file → parser.parse() → 5-min timeout race
```

Flow today: `ingestFileBuffer` validates MIME + size, stores the raw file in
GridFS, calls `parseDocumentBuffer` (which short-circuits `text/plain` and
`text/markdown` to `buffer.toString('utf8')`), then calls `ingestDocument`,
which writes the Mongo doc and indexes into Qdrant.

### 3.2 Call sites that will ripple

| File | Line | Call |
|---|---|---|
| `src/routes/documents.js` | 229 | `ingestFileBuffer(...)` — manual instructor upload (multer) |
| `src/routes/documents.js` | 331 | `ingestDocument(...)` — text/link content, no file |
| `src/routes/canvasLms.js` | 59 | `ingestFile = ingestFileBuffer` — **injectable**, server-to-server |
| `src/routes/moodleLms.js` | 37 | `ingestFile = ingestFileBuffer` — **injectable**, server-to-server |

Canvas and Moodle inject the function, so they are cheap to retarget. The
manual upload path at `documents.js:229` is the one that actually changes shape.

### 3.3 Progress phases

`ingestFileBuffer` emits `storing → extracting → extracted → saving → indexing`.
`src/routes/lmsImportProgress.js` maps them onto UI steps:

```
storing → store, extracting → extract, saving → save, indexing → index
```
plus a special case on `extracted` that renders "N characters read" / "N slides read".

⚠️ **`extracting` becomes long-lived once parsing is async.** If you do nothing,
the import progress UI sits on "extract" for minutes with no movement. See R7.

### 3.4 The Qdrant seam — better than expected

`src/services/qdrantService.js`:

- `processAndStoreDocument(documentData)` (line 359) sanitizes content, chunks
  it with `ChunkingModule` from `ubc-genai-toolkit-chunking` (line 224),
  embeds, and stores.
- `storeChunks(documentData, chunks, embeddings, strategyUsed)` (line 522)
  **already spreads `documentData.chunkMetadata[i]` into the Qdrant payload.**

That last point matters: there is already a per-chunk metadata channel. The
PPTX slide path uses it today for `sourceUnit: 'slide'`, `slideNumber`, and
`describedImageCount`. **`pages` and `headings` from the service go in exactly
the same place** — no schema change needed in `storeChunks`.

---

## 4. Target behaviour

Replace `parseDocumentBuffer` with a call to the parsing service, and replace
`ChunkingModule` with service-side chunking, so that:

```
ingestFileBuffer
  → validate + GridFS (unchanged)
  → POST /v1/documents with options.chunk           (create job)
  → PUT the bytes to upload.url                     (ticket, not job_id)
  → return jobId immediately; poll in BACKGROUND
  → on terminal + done: GET /chunks (NDJSON stream)
  → embed in batches → qdrantService.storeChunks with pages/headings in chunkMetadata
  → mark document ready
```

---

## 5. Requirements

**R1 — Never await a parse in a request handler.**
The existing 5-minute `Promise.race` timeout in `parseDocumentBuffer` must be
deleted, not tuned. Return a `jobId` and poll in the background. The service's
own worker timeout is 1200s by default; our poll deadline must exceed it
(1_800_000 ms). This is the single most important requirement.

**R2 — Request chunking at create time.**
`options.chunk` cannot be added after the fact — reading `/chunks` on a job
that was created without it returns `409 not_chunked`, and the only fix is
resubmitting the whole document. Use `{ strategy: "word", max_words: 400,
overlap: 0 }` unless R11 says otherwise.

**R3 — Persist chunks immediately on terminal.**
Results live **1 hour from the terminal state**, then `410 expired`; the job
record 404s five minutes later. Fetch and store as soon as the job is `done`.
Do not defer to a later user action.

**R4 — Branch on `reason`, never on `status` alone.**
`failed` + `scan_unavailable` is **not final** — the worker retries up to three
times and can still reach `done`. Only `parse_error` and `retries_exhausted`
are final failures. `rejected` is always final. Telling an instructor their
lecture is broken on the first `failed` will sometimes be a lie.

**R5 — Treat a `404` mid-poll as terminal.**
There is no `expired` *status*; the record is deleted outright. A loop watching
only `done | failed | rejected` will spin to its own deadline.

**R6 — `metadata` is `null` until terminal.**
Reading `job.metadata.warnings` mid-poll throws a `TypeError`. Guard it.

**R7 — Keep the progress UI honest.**
Add a phase for "waiting on the parsing service" (suggest `parsing`, carrying
the service `status` and a poll count) and map it in `PHASE_TO_STEP` in
`src/routes/lmsImportProgress.js`. Otherwise Canvas/Moodle imports look frozen.

**R8 — Carry `pages` and `headings` into Qdrant.**
Populate `documentData.chunkMetadata[i]` with the chunk's `pages` and
`headings`. Test presence with `"pages" in chunk` — the fields are **omitted,
not null**, when unavailable, so a null check takes the wrong branch. A DOCX or
TXT having no pages is normal, not an error.

**R9 — Read `upload.max_bytes` from the create response.**
Do not hardcode. Our `MAX_DOCUMENT_BYTES` is 50 MB; the service is configured
for 100 MB. Decide whether to raise ours (see R12) but read the ceiling from
the response either way.

**R10 — Check the upload response.**
`413 too_large` and `410 upload_expired` are ordinary outcomes and `fetch()`
does **not** throw on either. An unchecked response reports success for an
upload that never happened — silent data loss.

**R11 — Match `max_words` to our embedding window.**
The cap is in **words, not tokens** (~1.3 tokens per English word). Check the
model configured in `src/services/embeddingConfig.js` before accepting the 400
default: a 512-token window is ~380 words, an 8192-token window ~6000.

**R12 — Keep the old path behind a flag.**
Add something like `DOCPARSE_ENABLED`. When false, fall through to the existing
`ubc-genai-toolkit-document-parsing` code. This lets us A/B the output quality
on real BIOC lecture material and roll back without a revert.

---

## 6. Known mismatches — decide these before coding

These are places where the service does **not** behave like our current parser.
Each needs an explicit decision; none of them should be discovered at runtime.

### 6.1 File format support regresses

The service detects by **magic bytes**, so renaming does not help.

| MIME | BIOCBOT today | Service | Result |
|---|---|---|---|
| `application/pdf` | accepted | supported | fine |
| `.docx` | accepted | supported | fine |
| `.pptx` | accepted | supported | fine |
| `text/plain` | accepted (short-circuit) | supported | keep the short-circuit — no need to call the service |
| `text/markdown` | accepted (short-circuit) | detected as `text` | keep the short-circuit |
| **`application/msword` (.doc)** | **accepted** | **rejected `unsupported_type`** | ⚠️ **regression** |
| **`application/rtf`** | **accepted** | **not supported** | ⚠️ **regression** |
| `.xlsx` | not accepted | supported | optional gain |

**Decision needed:** do legacy `.doc` and `.rtf` keep the old in-process path
permanently, or do we drop support and tell instructors to re-save as `.docx`?
Recommend: keep the old path for those two MIME types, since the flag from R12
already gives you the branch.

### 6.2 PPTX image descriptions are lost

This is the biggest functional regression and needs a real decision.

- **Today:** `createDocumentParser` passes an `imageDescriber` backed by
  `ai.llm.describeImage`, with `imageConcurrency: 4`. It runs on **both** PDF
  pages and PPTX slides, and the PPTX path records `describedImageCount` per
  slide.
- **Service:** `options.image_mode` supports `describe_local` (SmolVLM-256M,
  offline) and `describe_remote`. **Both are PDF-only.** DOCX and PPTX keep
  their placeholders and report `image_description_unavailable` — the job still
  finishes `done`, so this will not look like an error.

**Options:** (a) accept the loss for PPTX, (b) keep our own describer for PPTX
only, (c) hybrid — service for text extraction, our describer for images.
Recommend (b) short-term.

Also: never treat `image_description_unavailable` as a failure. The job is
`done` and the extracted text is intact.

### 6.3 The PPTX per-slide path has no direct equivalent

`ingestFileBuffer` builds `indexSlides` from `parsedSlides`, storing one chunk
per slide tagged `sourceUnit: 'slide'`, `slideNumber`, `describedImageCount`,
strategy `'pptx-slide'`.

The service has no slide concept — but PPTX chunks **do** carry `pages`, and
for PPTX a page should be a slide. **Verify this empirically** with a real
BIOC deck before assuming it, then map `pages[0] → slideNumber` to preserve the
existing payload shape.

---

## 7. Landmines

**CORS will bite you if you go direct-to-browser.**
BIOCBOT serves on `:8050` (`TLEF_BIOCBOT_PORT`). The service's
`allowed_origins` in `~/ubc-document-parsing-api/apps.example.yaml` lists only
`http://localhost:3000`, `:3366`, and `:8090`. A missing origin does **not**
look like an auth error — you get a `400` on the `OPTIONS` preflight, before
any `PUT`, and the browser blocks it.

Note `npm run dev` starts browser-sync proxying on its default `:3000`, which
*is* allowlisted — so it may appear to work by accident. Do not rely on that.

**The registry is baked into the gateway image.** `apps.example.yaml` is
`COPY`ed in, not mounted. Editing it and restarting does nothing:

```bash
cd ~/ubc-document-parsing-api && docker compose up --build -d gateway
```

**`PUT` to the ticket, not the job id.** `upload.url` is a **path** — prefix it
with the base URL. PUTting to the `job_id` returns `410 upload_expired`.

**Never send `DOCPARSE_API_KEY` to a browser.** The ticket exists precisely so
the client can upload without it. The key is server-side only.

**Quotas:** 120 job creations/min, 20 concurrent. Status polls, content reads
and chunk reads are **not** metered, so polling is free. A `429` means **no job
was created** — re-send the *identical* request after `Retry-After` rather than
building a new one.

---

## 8. Recommended phasing

**Phase 1 — proxied upload, no CORS work.**
We already have the bytes server-side: `documents.js` receives them via multer,
and the Canvas/Moodle importers are server-to-server with **no browser at all**
(the skill's "prefer direct browser upload" advice explicitly does not apply to
those). So phase 1 keeps `ingestFileBuffer`'s buffer signature, and the server
streams the bytes to the ticket itself. Zero registry changes, zero gateway
rebuild, smallest possible diff.

**Phase 2 — direct browser upload for the manual instructor path only.**
This is where the 100 MB ceiling and the "bytes never touch our server" win
actually land. Requires adding `http://localhost:8050` to `allowed_origins`
**and** rebuilding the gateway. Do not start here.

Suggested order within phase 1:
1. Port `docparse/{client,tracker,errors}.js` to CommonJS under `src/services/`.
2. Add env config + `DOCPARSE_ENABLED` flag.
3. Rework `parseDocumentBuffer` → create/upload/poll, behind the flag.
4. Wire chunk streaming into `storeChunks` via `chunkMetadata`.
5. Add the `parsing` progress phase.
6. Update tests.

---

## 9. Configuration to add

Add to `.env` and `.env-example`:

```
DOCPARSE_ENABLED=true
DOCPARSE_BASE_URL=http://localhost:8000
DOCPARSE_API_KEY=ubcdp_dev_secret
DOCPARSE_POLL_INTERVAL_MS=1000
DOCPARSE_POLL_MAX_INTERVAL_MS=5000
DOCPARSE_POLL_TIMEOUT_MS=1800000
DOCPARSE_MAX_TRACKED_JOBS=10
DOCPARSE_CHUNK_STRATEGY=word
DOCPARSE_CHUNK_MAX_WORDS=400
DOCPARSE_IMAGE_MODE=describe_local
```

`DOCPARSE_API_KEY` is a backend secret. Confirm `.env` is gitignored before
committing anything.

---

## 10. Acceptance criteria

1. `git branch --show-current` is `testing_document_rich`, cut from `main`.
2. A real BIOC lecture PDF uploaded through the instructor UI produces Qdrant
   points whose payloads contain **non-empty `pages` and `headings`**.
3. No request handler awaits a parse. The upload endpoint returns in well under
   a second regardless of document size.
4. A document that takes longer than 5 minutes to parse **succeeds** (this
   fails today).
5. `failed` + `scan_unavailable` does not surface an error to the instructor
   while the job is still retrying.
6. Killing the gateway mid-parse surfaces a clear error and does not leave the
   Mongo document in a permanently "processing" state.
7. `DOCPARSE_ENABLED=false` restores today's behaviour exactly.
8. Existing suites pass: `npm run test:unit` and the documents/RAG e2e specs
   (`tests/unit/routes/documents.test.js`,
   `tests/e2e/documents-api-error-branches.spec.js`,
   `tests/e2e/routes-documents-api.spec.js`,
   `tests/e2e/chat-rag-documents.spec.js`,
   `tests/e2e/rag-documents-coverage-branches.spec.js`).
   Note `documents-api-error-branches.spec.js:77` asserts that a garbage-bytes
   PDF makes `docParser.parse` throw while the document is still stored — that
   assertion needs rewriting against the new failure shape.

---

## 11. Out of scope

- Deploying against any non-local parsing service, or onboarding a production
  `app_id` / key (that is a reviewed config change on the service side).
- Removing `ubc-genai-toolkit-document-parsing` from `package.json` — the flag
  keeps it alive until we have compared quality on real material.
- Changing the embedding model or the Qdrant collection schema.
- The `documents.js:331` text/link path — it has no file and no parse.
