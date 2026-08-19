/**
 * The HTTP layer. Two of these guard against silent data loss: an unchecked
 * upload response reports success for bytes that never arrived, and an NDJSON
 * reader that assumes one packet per line drops chunks on a large document.
 */
const { Readable } = require('stream');

const { DocParseClient, DocParseError } = require('../../../../src/services/docparse/client');
const { collectChunks } = require('../../../../src/services/docparse');

const BASE = 'http://parsing.test';

function jsonResponse(status, body, headers = {}) {
    return {
        ok: status >= 200 && status < 300,
        status,
        headers: { get: (name) => headers[name] ?? null },
        json: async () => body
    };
}

/** An NDJSON body split at arbitrary byte boundaries, as TCP would deliver it. */
function ndjsonResponse(pieces) {
    return {
        ok: true,
        status: 200,
        headers: { get: () => null },
        body: Readable.from(pieces.map((piece) => Buffer.from(piece, 'utf8')))
    };
}

function clientWith(fetchImpl) {
    return new DocParseClient({ baseUrl: BASE, apiKey: 'test-key', fetchImpl });
}

describe('createJob', () => {
    test('returns the ticket path and the service ceiling', async () => {
        const fetchImpl = jest.fn(async () => jsonResponse(201, {
            job_id: 'abc',
            upload: { url: '/v1/uploads/ticket-1', ticket: 'ticket-1', max_bytes: 104857600 }
        }));

        const job = await clientWith(fetchImpl).createJob({ filename: 'lecture.pdf' });

        expect(job).toMatchObject({ jobId: 'abc', uploadUrl: '/v1/uploads/ticket-1', maxBytes: 104857600 });
        const [, init] = fetchImpl.mock.calls[0];
        expect(init.headers.Authorization).toBe('Bearer test-key');
    });

    test('re-sends the identical request after a 429 — no job was created', async () => {
        const fetchImpl = jest.fn()
            .mockResolvedValueOnce(jsonResponse(429, { reason: 'rate_limited' }, { 'Retry-After': '0' }))
            .mockResolvedValueOnce(jsonResponse(201, {
                job_id: 'abc',
                upload: { url: '/v1/uploads/t', ticket: 't', max_bytes: 100 }
            }));

        const job = await clientWith(fetchImpl).createJob({ filename: 'a.pdf' });

        expect(job.jobId).toBe('abc');
        expect(fetchImpl).toHaveBeenCalledTimes(2);
        expect(fetchImpl.mock.calls[0][1].body).toBe(fetchImpl.mock.calls[1][1].body);
    });

    test('gives up with the quota reason once attempts run out', async () => {
        const fetchImpl = jest.fn(async () =>
            jsonResponse(429, { reason: 'too_many_concurrent' }, { 'Retry-After': '0' }));

        await expect(clientWith(fetchImpl).createJob({ filename: 'a.pdf' }, { attempts: 2 }))
            .rejects.toMatchObject({ name: 'DocParseError', status: 429, reason: 'too_many_concurrent', retryable: true });
    });

    test('surfaces a rejected option as a non-retryable error', async () => {
        const fetchImpl = jest.fn(async () => jsonResponse(400, { reason: 'unsupported_option' }));

        await expect(clientWith(fetchImpl).createJob({ filename: 'a.pdf' }))
            .rejects.toMatchObject({ reason: 'unsupported_option', retryable: false });
    });
});

describe('uploadBuffer', () => {
    test('PUTs to the ticket path with no Authorization header', async () => {
        const fetchImpl = jest.fn(async () =>
            jsonResponse(200, { job_id: 'abc', status: 'queued', bytes_received: 3 }));

        const result = await clientWith(fetchImpl).uploadBuffer('/v1/uploads/t', Buffer.from('pdf'));

        expect(result).toEqual({ jobId: 'abc', status: 'queued', bytesReceived: 3 });
        const [url, init] = fetchImpl.mock.calls[0];
        expect(url).toBe(`${BASE}/v1/uploads/t`);
        expect(init.method).toBe('PUT');
        // The ticket is the credential; the key must never travel with it.
        expect(init.headers.Authorization).toBeUndefined();
        expect(init.headers['Content-Length']).toBe('3');
    });

    test('turns 413 into an error — fetch does not throw, and an unchecked response loses the file', async () => {
        const fetchImpl = jest.fn(async () => jsonResponse(413, { reason: 'too_large' }));

        await expect(clientWith(fetchImpl).uploadBuffer('/v1/uploads/t', Buffer.from('x')))
            .rejects.toMatchObject({ status: 413, reason: 'too_large' });
    });

    test('turns 410 upload_expired into an error too', async () => {
        const fetchImpl = jest.fn(async () => jsonResponse(410, { reason: 'upload_expired' }));

        await expect(clientWith(fetchImpl).uploadBuffer('/v1/uploads/t', Buffer.from('x')))
            .rejects.toMatchObject({ status: 410, reason: 'upload_expired' });
    });
});

describe('getStatus', () => {
    test('raises a 404 as a DocParseError the tracker can recognise as terminal', async () => {
        const fetchImpl = jest.fn(async () => jsonResponse(404, { reason: 'not_found' }));

        await expect(clientWith(fetchImpl).getStatus('gone'))
            .rejects.toMatchObject({ status: 404, reason: 'not_found' });
    });

    test('copes with a non-JSON error body rather than masking the status', async () => {
        const fetchImpl = jest.fn(async () => ({
            ok: false,
            status: 502,
            headers: { get: () => null },
            json: async () => { throw new SyntaxError('not json'); }
        }));

        await expect(clientWith(fetchImpl).getStatus('x'))
            .rejects.toMatchObject({ status: 502, reason: null });
    });
});

describe('streamChunks', () => {
    test('reassembles JSON objects split across packet boundaries', async () => {
        const fetchImpl = jest.fn(async () => ndjsonResponse([
            '{"index":0,"text":"alpha","pa',
            'ges":[1],"headings":["Intro"]}\n{"index":1,',
            '"text":"beta","pages":[2]}\n'
        ]));

        const chunks = [];
        for await (const chunk of clientWith(fetchImpl).streamChunks('job')) chunks.push(chunk);

        expect(chunks).toHaveLength(2);
        expect(chunks[0]).toMatchObject({ index: 0, text: 'alpha', pages: [1], headings: ['Intro'] });
        expect(chunks[1]).toMatchObject({ index: 1, text: 'beta', pages: [2] });
    });

    test('yields a final line that arrives without a trailing newline', async () => {
        const fetchImpl = jest.fn(async () => ndjsonResponse(['{"index":0,"text":"only"}']));

        const chunks = [];
        for await (const chunk of clientWith(fetchImpl).streamChunks('job')) chunks.push(chunk);

        expect(chunks).toEqual([{ index: 0, text: 'only' }]);
    });

    test('reports 409 not_chunked rather than yielding nothing', async () => {
        const fetchImpl = jest.fn(async () => jsonResponse(409, { reason: 'not_chunked' }));

        const iterate = async () => {
            for await (const chunk of clientWith(fetchImpl).streamChunks('job')) void chunk;
        };
        await expect(iterate()).rejects.toMatchObject({ status: 409, reason: 'not_chunked' });
    });

    test('passes offset through so ingestion can resume', async () => {
        const fetchImpl = jest.fn(async () => ndjsonResponse(['{"index":40,"text":"x"}\n']));

        const chunks = [];
        for await (const c of clientWith(fetchImpl).streamChunks('job', { offset: 40 })) chunks.push(c);

        expect(String(fetchImpl.mock.calls[0][0])).toContain('offset=40');
    });
});

describe('collectChunks', () => {
    test('carries pages and headings into the metadata that reaches Qdrant', async () => {
        const client = clientWith(async () => ndjsonResponse([
            '{"index":0,"text":"intro","pages":[1],"headings":["Introduction"]}\n',
            '{"index":1,"text":"method","pages":[4,5],"headings":["Methods","Assay"]}\n'
        ]));

        const { texts, chunkMetadata, textContent } = await collectChunks({ client, jobId: 'job' });

        expect(texts).toEqual(['intro', 'method']);
        expect(chunkMetadata[0]).toEqual({
            sourceUnit: 'docparse-chunk', pages: [1], pageNumber: 1, headings: ['Introduction']
        });
        expect(chunkMetadata[1]).toEqual({
            sourceUnit: 'docparse-chunk', pages: [4, 5], pageNumber: 4, headings: ['Methods', 'Assay']
        });
        expect(textContent).toBe('intro\n\nmethod');
    });

    test('omits pages and headings when the format has none — that is normal, not an error', async () => {
        const client = clientWith(async () => ndjsonResponse([
            '{"index":0,"text":"plain docx text"}\n'
        ]));

        const { chunkMetadata } = await collectChunks({ client, jobId: 'job' });

        expect(chunkMetadata[0]).toEqual({ sourceUnit: 'docparse-chunk' });
        expect('pages' in chunkMetadata[0]).toBe(false);
    });

    test('skips blank chunks so they never reach the embedder', async () => {
        const client = clientWith(async () => ndjsonResponse([
            '{"index":0,"text":"real"}\n{"index":1,"text":"   "}\n{"index":2,"text":""}\n'
        ]));

        const { texts, chunkMetadata } = await collectChunks({ client, jobId: 'job' });

        expect(texts).toEqual(['real']);
        expect(chunkMetadata).toHaveLength(1);
    });

    test('keeps texts and metadata index-aligned, which is what storeChunks assumes', async () => {
        const client = clientWith(async () => ndjsonResponse([
            '{"index":0,"text":"a","pages":[1]}\n{"index":1,"text":"  "}\n{"index":2,"text":"c","pages":[3]}\n'
        ]));

        const { texts, chunkMetadata } = await collectChunks({ client, jobId: 'job' });

        expect(texts).toHaveLength(chunkMetadata.length);
        expect(chunkMetadata[1].pageNumber).toBe(3);
    });
});
