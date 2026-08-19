/**
 * BiocBot's entry point to the UBC Document Parsing API.
 *
 * Everything here is about the service itself — creating a job, handing over
 * the bytes, and collecting the chunks it produces. What BiocBot then DOES with
 * those chunks (write the Mongo document, embed, upsert into Qdrant) stays in
 * documentIngestion.js next to the rest of the ingestion logic.
 */

const { DocParseClient, DocParseError } = require('./client');
const { JobTracker } = require('./tracker');
const { buildJobOptions, getDocParseConfig, shouldUseDocParse } = require('./config');
const { describeReason, isFinal, isRetryable } = require('./errors');

// One client and one tracker per process. The tracker's bounded concurrency is
// only meaningful if every job shares it, and the service's per-app quota is
// process-wide too, so a per-request tracker would defeat both.
let cached = null;

function getDocParse(env = process.env) {
    const config = getDocParseConfig(env);
    if (!config.enabled) return null;

    if (!cached || cached.config.baseUrl !== config.baseUrl || cached.config.apiKey !== config.apiKey) {
        const client = new DocParseClient({ baseUrl: config.baseUrl, apiKey: config.apiKey });
        cached = { config, client, tracker: new JobTracker({ client, config }) };
    }
    // Poll timings may change between reads without needing a new client.
    cached.config = { ...config };
    cached.tracker.config = cached.config;
    return cached;
}

/** Test seam: drop the memoised client so the next call re-reads the env. */
function resetDocParse() {
    cached = null;
}

/**
 * Create the job and hand over the bytes.
 *
 * Returns as soon as the upload completes — which is a byte transfer to
 * localhost, not a parse — so this is safe to await inside a request handler.
 * The parse itself is watched by the tracker.
 */
async function submitDocument({ client, config, buffer, originalName, mimeType }) {
    const job = await client.createJob({
        filename: originalName,
        contentType: mimeType,
        options: buildJobOptions(config)
    });

    // The service's ceiling is authoritative and configured per app; ours is a
    // separate, stricter limit checked earlier in ingestFileBuffer. Catching a
    // mismatch here beats discovering it as a 413 halfway through the upload.
    if (job.maxBytes && buffer.length > job.maxBytes) {
        throw new DocParseError(
            `Document is ${buffer.length} bytes; the parsing service accepts at most ${job.maxBytes}.`,
            { status: 413, reason: 'too_large' }
        );
    }

    // upload.url is a PATH — the client prefixes it with the base URL. PUTting
    // to the job id instead returns 410 upload_expired.
    const upload = await client.uploadBuffer(job.uploadUrl, buffer);
    return { jobId: job.jobId, maxBytes: job.maxBytes, bytesReceived: upload.bytesReceived };
}

/**
 * Read every chunk of a finished job into the shape storeChunks wants.
 *
 * This is the payoff of the whole integration. The service chunked the document
 * while page numbers and the heading hierarchy still existed, so each chunk can
 * say it came from page 4 under "Methods". Markdown export throws that away and
 * nothing downstream can recover it, which is exactly why the in-process
 * parser's output cannot cite anything.
 *
 * Results live one hour from the terminal state and then 410, so callers must
 * do this as soon as the job is done rather than deferring to a later action.
 */
async function collectChunks({ client, jobId }) {
    const texts = [];
    const chunkMetadata = [];

    for await (const chunk of client.streamChunks(jobId)) {
        const text = typeof chunk.text === 'string' ? chunk.text : '';
        if (!text.trim()) continue;

        const metadata = { sourceUnit: 'docparse-chunk' };
        // `pages` and `headings` are OMITTED, not null, when unavailable, so a
        // null check takes the wrong branch. A DOCX or TXT having no pages is
        // the normal case and never an error.
        if ('pages' in chunk && Array.isArray(chunk.pages) && chunk.pages.length > 0) {
            metadata.pages = chunk.pages;
            metadata.pageNumber = chunk.pages[0];
        }
        if ('headings' in chunk && Array.isArray(chunk.headings) && chunk.headings.length > 0) {
            metadata.headings = chunk.headings;
        }

        texts.push(text);
        chunkMetadata.push(metadata);
    }

    return {
        texts,
        chunkMetadata,
        // Reassembled here rather than fetched from /content: with overlap 0 the
        // chunks are the document, and a second request would double the
        // transfer for a result we already hold.
        textContent: texts.join('\n\n')
    };
}

module.exports = {
    DocParseClient,
    DocParseError,
    JobTracker,
    collectChunks,
    describeReason,
    getDocParse,
    getDocParseConfig,
    isFinal,
    isRetryable,
    resetDocParse,
    shouldUseDocParse,
    submitDocument
};
