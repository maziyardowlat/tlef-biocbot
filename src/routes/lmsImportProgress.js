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

/** Ingestion phases (from documentIngestion) mapped onto the ids above. */
const PHASE_TO_STEP = Object.freeze({
    storing: 'store',
    extracting: 'extract',
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

/**
 * Returns a writer when the client asked for streaming progress, otherwise
 * `null` so the caller falls back to a normal JSON response. The caller owns
 * the decision of *when* to open the stream: do it only after every validation
 * that still needs a real HTTP status code (400/404/409), because a stream is
 * committed to `200` the moment its headers go out.
 */
function createImportProgressStream(req, res) {
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
            write({ type: 'step', step: stepId, ...(detail ? { detail } : {}) });
        },
        /** An ingestion progress listener that forwards phases as steps. */
        onIngestionProgress({ phase, ...details }) {
            if (phase === 'extracted') {
                write({ type: 'detail', step: 'extract', detail: describeExtraction(details) });
                return;
            }
            const stepId = PHASE_TO_STEP[phase];
            if (stepId) write({ type: 'step', step: stepId });
        },
        done(data) {
            write({ type: 'done', data });
            closed = true;
            res.end();
        },
        fail(error) {
            write({
                type: 'error',
                message: error?.message || 'LMS import failed',
                ...(error?.code ? { code: error.code } : {})
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
