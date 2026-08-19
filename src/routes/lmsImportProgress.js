/**
 * Streams step-by-step progress for a Canvas/Moodle file import.
 *
 * An import is one long request that does several distinct things (fetch the
 * file, store it, extract text, index it), so a single "importing…" spinner
 * tells the instructor nothing about where the time is going — or where it
 * failed. When the client asks for `application/x-ndjson` this writes one JSON
 * object per line as each step begins; every other client keeps the plain
 * single-shot JSON response.
 */

const { describeReason, isFinal } = require('../services/docparse/errors');

const NDJSON_CONTENT_TYPE = 'application/x-ndjson';

/**
 * The import steps in the order they run, shared with the instructor UI so both
 * sides agree on the ids. Labels live in the client; the server only names the
 * step it has reached and any specifics it alone knows (file size, chunk count).
 */
const IMPORT_STEP_IDS = Object.freeze([
    'download',
    'store',
    'extract',
    'save',
    'index'
]);

/**
 * Ingestion phases (from documentIngestion) mapped onto the ids above.
 *
 * `parsing` shares the `extract` step rather than adding a sixth one. It is the
 * same work from the instructor's point of view — the text is being pulled out
 * of the file — the difference is only that a remote service is doing it, and
 * that it now takes minutes rather than seconds. Sharing the step also keeps
 * the id list identical for the in-process path, which never emits `parsing`
 * and would otherwise show a step that could never complete.
 */
const PHASE_TO_STEP = Object.freeze({
    storing: 'store',
    extracting: 'extract',
    parsing: 'extract',
    saving: 'save',
    indexing: 'index'
});

function wantsProgressStream(req) {
    return String(req.get('accept') || '').includes(NDJSON_CONTENT_TYPE);
}

function describeExtraction({ characters = 0, slides = 0 }) {
    if (slides > 0) return `${slides} slides read`;
    if (characters > 0) return `${characters.toLocaleString('en-US')} characters read`;
    return 'No text could be extracted';
}

const PARSING_STATUS_LABELS = Object.freeze({
    awaiting_upload: 'Sending the file to the parsing service',
    queued: 'Queued at the parsing service',
    processing: 'Parsing the document',
    done: 'Parsed',
    rejected: 'The parsing service rejected this file'
});

/**
 * A line for the `extract` step while the parsing service works.
 *
 * Without this the step sits silent for however long the parse takes — which is
 * minutes for a real lecture, and up to 20 for an image-heavy one — and the
 * import looks frozen.
 */
function describeParsing({ status = '', reason = null, polls = 0 }) {
    const checks = polls > 0 ? ` · check ${polls}` : '';
    // `failed` on a transient reason is not a verdict: the service retries a job
    // up to three times and can still finish `done`. Reporting the first
    // `failed` as a failure tells an instructor their lecture broke while it is
    // in fact still being parsed.
    if (status === 'failed' && !isFinal(status, reason)) {
        return `Parsing service is retrying${checks}`;
    }
    if (status === 'failed') {
        return `Parsing failed: ${describeReason(reason)}`;
    }
    return `${PARSING_STATUS_LABELS[status] || 'Parsing the document'}${checks}`;
}

/**
 * Returns a writer when the client asked for streaming progress, otherwise
 * `null` so the caller falls back to a normal JSON response. The caller owns
 * the decision of *when* to open the stream: do it only after every validation
 * that still needs a real HTTP status code (400/404/409), because a stream is
 * committed to `200` the moment its headers go out.
 */
function createImportProgressStream(req, res, { diagnostics = null } = {}) {
    if (!wantsProgressStream(req)) return null;

    res.status(200);
    res.set({
        'Content-Type': `${NDJSON_CONTENT_TYPE}; charset=utf-8`,
        'Cache-Control': 'no-store',
        // Tells nginx not to buffer, which would defeat the whole point.
        'X-Accel-Buffering': 'no'
    });
    if (typeof res.flushHeaders === 'function') res.flushHeaders();

    let closed = false;
    function write(event) {
        if (closed || res.writableEnded) return;
        res.write(`${JSON.stringify(event)}\n`);
        if (typeof res.flush === 'function') res.flush();
    }

    return {
        /** Marks `stepId` as the step now running; earlier steps are complete. */
        step(stepId, detail = '') {
            diagnostics?.step(stepId, detail ? { detail } : {});
            write({ type: 'step', step: stepId, ...(detail ? { detail } : {}) });
        },
        /** An ingestion progress listener that forwards phases as steps. */
        onIngestionProgress({ phase, ...details }) {
            diagnostics?.onIngestionProgress({ phase, ...details });
            if (phase === 'extracted') {
                write({ type: 'detail', step: 'extract', detail: describeExtraction(details) });
                return;
            }
            // A detail rather than a step: `extracting` already moved the UI to
            // this step, and these arrive repeatedly as the job progresses.
            if (phase === 'parsing') {
                write({ type: 'detail', step: 'extract', detail: describeParsing(details) });
                return;
            }
            const stepId = PHASE_TO_STEP[phase];
            if (stepId) write({ type: 'step', step: stepId });
        },
        done(data) {
            diagnostics?.done(data);
            write({ type: 'done', data });
            closed = true;
            res.end();
        },
        fail(error) {
            const diagnostic = diagnostics?.fail(error) || null;
            write({
                type: 'error',
                message: error?.message || 'LMS import failed',
                ...(error?.code ? { code: error.code } : {}),
                ...(diagnostic ? { diagnostic } : {})
            });
            closed = true;
            res.end();
        }
    };
}

module.exports = {
    IMPORT_STEP_IDS,
    NDJSON_CONTENT_TYPE,
    createImportProgressStream,
    wantsProgressStream
};
