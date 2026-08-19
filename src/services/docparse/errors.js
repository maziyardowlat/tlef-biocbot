/**
 * Failure reasons from the UBC Document Parsing API.
 *
 * Every terminal failure carries a stable, machine-readable `reason`. This
 * module turns those into the two things ingestion actually needs: is the job
 * finished, and what do we tell the instructor?
 *
 * Ported from the service team's reference app (server/docparse/errors.js),
 * converted from ESM to CommonJS.
 */

/**
 * Worth retrying. Everything else is permanent for this document — re-uploading
 * an infected or corrupt file changes nothing.
 *
 * Two kinds live in here, and they are retried DIFFERENTLY:
 *
 *   * `scan_unavailable` / `retries_exhausted` are transient infrastructure
 *     faults on a job that already exists. Retrying means a NEW job; the ticket
 *     and the uploaded bytes are long gone.
 *   * `too_many_concurrent` / `rate_limited` are quota refusals at create time,
 *     carrying a `Retry-After`. No job was created, so re-send the SAME request.
 */
const RETRYABLE = new Set([
    'scan_unavailable',
    'retries_exhausted',
    'too_many_concurrent',
    'rate_limited'
]);

const MESSAGES = Object.freeze({
    unsupported_option: 'The request used an option the parsing service does not support.',
    upload_expired: 'The upload link expired or was already used. Please upload the file again.',
    too_large: 'That file is larger than the parsing service will accept.',
    unsupported_type: 'That file type is not supported. Try PDF, DOCX, PPTX, TXT or MD.',
    infected: 'The malware scanner flagged this file, so it was not parsed.',
    scan_unavailable: 'The malware scanner is temporarily unavailable. Please try again shortly.',
    parse_error: 'The file could not be read — it may be corrupt.',
    retries_exhausted: 'Parsing failed repeatedly. Please try again.',
    not_found: 'The parsing job no longer exists.',
    expired: 'The parsed result expired before it could be stored (results are kept for one hour).',
    not_ready: 'Still parsing.',
    not_chunked: 'This document was parsed without chunking. Re-submit it with options.chunk.',
    too_many_concurrent: 'The parsing service is already handling as many BiocBot documents as it allows. Try again shortly.',
    rate_limited: 'Too many documents were submitted for parsing this minute. Try again shortly.',
    poll_timeout: 'The parsing service did not finish in time.',
    tracker_error: 'BiocBot lost contact with the parsing service.',
    result_error: 'BiocBot could not retrieve the parsed result.',
    persistence_error: 'BiocBot could not save the parsed document.',
    document_deleted: 'The document was deleted while parsing was in progress.'
});

/**
 * Reasons that mean "this attempt failed, but the job has not finished".
 *
 * The service writes `failed` the moment an attempt fails and retries a job up
 * to three times, so `failed` carrying one of these is not a verdict — a later
 * poll can still show `done`. Only after the last attempt does the reason
 * become `retries_exhausted`.
 */
const NON_FINAL_FAILURE_REASONS = new Set(['scan_unavailable']);

/**
 * Has this job stopped moving?
 *
 * Ask this rather than testing the status against a list of terminal states.
 * `failed` cannot answer the question by itself — see above — and treating the
 * first `failed` as final tells an instructor their lecture broke while the
 * service is still parsing it, and abandons a result that does arrive.
 *
 * Our own invented reasons (`poll_timeout`, `tracker_error`) are final, which
 * falls out of this correctly: we stopped watching, so nothing will move.
 */
function isFinal(status, reason = null) {
    if (status === 'done' || status === 'rejected') return true;
    if (status === 'failed') return !NON_FINAL_FAILURE_REASONS.has(reason);
    return false; // awaiting_upload, queued, processing
}

function isRetryable(reason) {
    return RETRYABLE.has(reason);
}

function describeReason(reason) {
    return MESSAGES[reason] || 'Parsing failed for an unknown reason.';
}

module.exports = {
    NON_FINAL_FAILURE_REASONS,
    describeReason,
    isFinal,
    isRetryable
};
