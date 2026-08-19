/**
 * The import progress stream, with attention to the phase the parsing service
 * introduced: `parsing` can last minutes, so it has to keep producing visible
 * movement without ever claiming a failure the service has not declared.
 */
const {
    IMPORT_STEP_IDS,
    createImportProgressStream,
    wantsProgressStream
} = require('../../../src/routes/lmsImportProgress');

/** Captures the NDJSON lines a handler writes. */
function fakeStream() {
    const lines = [];
    const req = { get: () => 'application/x-ndjson' };
    const res = {
        status: () => res,
        set: () => res,
        flushHeaders: () => {},
        writableEnded: false,
        write: (chunk) => lines.push(JSON.parse(chunk)),
        end: () => { res.writableEnded = true; }
    };
    return { lines, stream: createImportProgressStream(req, res), res };
}

describe('wantsProgressStream', () => {
    test('only streams when the client asked for NDJSON', () => {
        expect(wantsProgressStream({ get: () => 'application/x-ndjson' })).toBe(true);
        expect(wantsProgressStream({ get: () => 'application/json' })).toBe(false);
        expect(wantsProgressStream({ get: () => undefined })).toBe(false);
    });
});

describe('onIngestionProgress', () => {
    test('maps the ingestion phases onto step ids the UI already renders', () => {
        const { lines, stream } = fakeStream();

        for (const phase of ['storing', 'extracting', 'saving', 'indexing']) {
            stream.onIngestionProgress({ phase });
        }

        expect(lines.map((l) => l.step)).toEqual(['store', 'extract', 'save', 'index']);
        // Every id emitted must exist in the shared list, or the client renders
        // nothing for it.
        for (const line of lines) expect(IMPORT_STEP_IDS).toContain(line.step);
    });

    test('parsing updates the extract step in place rather than adding a step', () => {
        const { lines, stream } = fakeStream();

        stream.onIngestionProgress({ phase: 'extracting' });
        stream.onIngestionProgress({ phase: 'parsing', status: 'queued', polls: 1 });
        stream.onIngestionProgress({ phase: 'parsing', status: 'processing', polls: 7 });

        expect(lines[0]).toMatchObject({ type: 'step', step: 'extract' });
        expect(lines[1]).toMatchObject({ type: 'detail', step: 'extract' });
        expect(lines[1].detail).toMatch(/Queued at the parsing service/);
        expect(lines[2].detail).toMatch(/Parsing the document/);
        // The poll count is what makes a long parse visibly alive.
        expect(lines[2].detail).toContain('7');
    });

    test('a transient failure reads as retrying, never as a broken document', () => {
        const { lines, stream } = fakeStream();

        stream.onIngestionProgress({
            phase: 'parsing', status: 'failed', reason: 'scan_unavailable', polls: 3
        });

        expect(lines[0].detail).toMatch(/retrying/i);
        expect(lines[0].detail).not.toMatch(/failed/i);
    });

    test('a verdict failure says what actually went wrong', () => {
        const { lines, stream } = fakeStream();

        stream.onIngestionProgress({
            phase: 'parsing', status: 'failed', reason: 'parse_error', polls: 9
        });

        expect(lines[0].detail).toMatch(/Parsing failed/);
        expect(lines[0].detail).toMatch(/corrupt/i);
    });

    test('a rejected file is reported as rejected', () => {
        const { lines, stream } = fakeStream();

        stream.onIngestionProgress({ phase: 'parsing', status: 'rejected', reason: 'infected' });

        expect(lines[0].detail).toMatch(/rejected/i);
    });

    test('the in-process path still reports what it extracted', () => {
        const { lines, stream } = fakeStream();

        stream.onIngestionProgress({ phase: 'extracted', characters: 12345, slides: 0 });
        stream.onIngestionProgress({ phase: 'extracted', characters: 0, slides: 18 });

        expect(lines[0].detail).toBe('12,345 characters read');
        expect(lines[1].detail).toBe('18 slides read');
    });

    test('an unknown phase is ignored rather than emitting an unrenderable step', () => {
        const { lines, stream } = fakeStream();

        stream.onIngestionProgress({ phase: 'something-new' });

        expect(lines).toHaveLength(0);
    });
});

describe('terminal events', () => {
    test('done carries the payload and closes the stream', () => {
        const { lines, stream, res } = fakeStream();

        stream.done({ documentId: 'doc-1' });

        expect(lines.at(-1)).toEqual({ type: 'done', data: { documentId: 'doc-1' } });
        expect(res.writableEnded).toBe(true);
    });

    test('fail carries the message and code', () => {
        const { lines, stream } = fakeStream();

        stream.fail(Object.assign(new Error('nope'), { code: 'DOCPARSE_ERROR' }));

        expect(lines.at(-1)).toMatchObject({ type: 'error', message: 'nope', code: 'DOCPARSE_ERROR' });
    });

    test('nothing is written after the stream closes', () => {
        const { lines, stream } = fakeStream();

        stream.done({});
        const afterClose = lines.length;
        stream.onIngestionProgress({ phase: 'indexing' });

        expect(lines).toHaveLength(afterClose);
    });
});
