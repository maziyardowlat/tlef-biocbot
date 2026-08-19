/**
 * Configuration and routing rules for the UBC Document Parsing API.
 *
 * Two separate questions live here, and they are not the same question:
 *
 *   1. Is the integration switched on at all?  (`DOCPARSE_ENABLED` + a base URL
 *      and key.)  With it off, ingestion falls through to the in-process
 *      `ubc-genai-toolkit-document-parsing` path exactly as before.
 *   2. Should THIS document go to the service?  Only some formats should — see
 *      shouldUseDocParse below.
 */

const PDF_MIME_TYPE = 'application/pdf';

/**
 * MIME types we deliberately keep on the in-process parser even when the
 * service is enabled. Each is here for a concrete reason, not caution:
 *
 *   * PPTX / DOCX — our own `imageDescriber` (backed by the course LLM) runs on
 *     both today, and the PPTX path additionally records one chunk per slide
 *     with `slideNumber` and `describedImageCount`. The service's `image_mode`
 *     is PDF-only: DOCX and PPTX keep their `<!-- image -->` placeholders and
 *     report `image_description_unavailable` while still finishing `done`, so
 *     routing them to the service would silently drop every image description.
 *   * .doc / .rtf — the service detects by magic bytes and rejects both with
 *     `unsupported_type`. Sending them there is a straight regression.
 *   * text/plain, text/markdown — already short-circuited to
 *     `buffer.toString('utf8')`. There is nothing to parse and no reason to
 *     pay a network round trip.
 */
const IN_PROCESS_ONLY_MIME_TYPES = Object.freeze([
    'application/vnd.openxmlformats-officedocument.presentationml.presentation',
    'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
    'application/msword',
    'application/rtf',
    'text/plain',
    'text/markdown'
]);

/** Formats the service handles for us. PDF is where the provenance win is. */
const DOCPARSE_MIME_TYPES = Object.freeze([PDF_MIME_TYPE]);

function positiveInteger(value, fallback) {
    const parsed = Number.parseInt(value, 10);
    return Number.isFinite(parsed) && parsed > 0 ? parsed : fallback;
}

function isTruthy(value) {
    return ['1', 'true', 'yes', 'on'].includes(String(value || '').trim().toLowerCase());
}

/**
 * Read the integration's settings out of the environment.
 *
 * `enabled` requires a base URL and an API key as well as the flag: a half
 * configured service should fall back to the old path, not fail every upload.
 */
function getDocParseConfig(env = process.env) {
    const baseUrl = String(env.DOCPARSE_BASE_URL || '').trim();
    const apiKey = String(env.DOCPARSE_API_KEY || '').trim();

    return {
        enabled: isTruthy(env.DOCPARSE_ENABLED) && Boolean(baseUrl) && Boolean(apiKey),
        baseUrl,
        apiKey,
        pollIntervalMs: positiveInteger(env.DOCPARSE_POLL_INTERVAL_MS, 1000),
        pollMaxIntervalMs: positiveInteger(env.DOCPARSE_POLL_MAX_INTERVAL_MS, 5000),
        // Must exceed the service's own worker timeout (1200s default), or we
        // give up on jobs that are still running normally.
        pollTimeoutMs: positiveInteger(env.DOCPARSE_POLL_TIMEOUT_MS, 1800000),
        maxTrackedJobs: positiveInteger(env.DOCPARSE_MAX_TRACKED_JOBS, 10),
        chunkStrategy: String(env.DOCPARSE_CHUNK_STRATEGY || 'word').trim(),
        chunkMaxWords: positiveInteger(env.DOCPARSE_CHUNK_MAX_WORDS, 400),
        chunkOverlap: positiveInteger(env.DOCPARSE_CHUNK_OVERLAP, 0) || 0,
        embedBatchSize: positiveInteger(env.DOCPARSE_EMBED_BATCH_SIZE, 100),
        imageMode: String(env.DOCPARSE_IMAGE_MODE || 'describe_local').trim()
    };
}

/**
 * Build the `options` object for POST /v1/documents.
 *
 * `chunk` has to be here rather than added later: chunking happens during the
 * parse, and reading /chunks on a job created without it returns
 * `409 not_chunked` with no fix short of resubmitting the document.
 *
 * The cap is in WORDS, not tokens (roughly 1.3 tokens per English word). The
 * 400-word default is ~520 tokens, which fits every embedding model BiocBot
 * can be configured with — the narrowest window in `embeddingConfig` is far
 * wider than that. Raise `DOCPARSE_CHUNK_MAX_WORDS` for richer chunks only
 * after checking the model actually in use for the course.
 *
 * `structure` takes no size parameter at all, and every number is range-checked
 * at create time whether or not the strategy uses it, so sending `max_words`
 * alongside it is a 400 rather than a silently ignored field.
 */
function buildJobOptions(config) {
    const chunk = { strategy: config.chunkStrategy };
    if (config.chunkStrategy === 'word') {
        chunk.max_words = config.chunkMaxWords;
        chunk.overlap = config.chunkOverlap;
    } else if (config.chunkStrategy === 'character') {
        chunk.max_characters = config.chunkMaxWords;
        chunk.overlap = config.chunkOverlap;
    }

    return {
        chunk,
        image_mode: config.imageMode
    };
}

/**
 * Should this document go to the parsing service?
 *
 * Anything that answers false keeps today's behaviour exactly, which is also
 * what `DOCPARSE_ENABLED=false` gives every format.
 */
function shouldUseDocParse(mimeType, config) {
    if (!config || !config.enabled) return false;
    return DOCPARSE_MIME_TYPES.includes(String(mimeType || '').toLowerCase());
}

module.exports = {
    DOCPARSE_MIME_TYPES,
    IN_PROCESS_ONLY_MIME_TYPES,
    PDF_MIME_TYPE,
    buildJobOptions,
    getDocParseConfig,
    shouldUseDocParse
};
