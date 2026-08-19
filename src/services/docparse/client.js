/**
 * The UBC Document Parsing API surface, in one small class.
 *
 * The API is asynchronous by design — a large lecture PDF takes seconds to
 * minutes — so this client never waits for a parse. It creates jobs, streams
 * bytes, reads status, and streams results. Waiting is the tracker's job
 * (./tracker.js), and it happens in the background.
 *
 * Ported from the service team's reference app (server/docparse/client.js),
 * converted from ESM to CommonJS.
 */

const { Readable } = require('stream');

const { isRetryable } = require('./errors');

class DocParseError extends Error {
    constructor(message, { status, reason }) {
        super(message);
        this.name = 'DocParseError';
        this.code = 'DOCPARSE_ERROR';
        this.status = status;
        this.reason = reason;
        this.retryable = isRetryable(reason);
    }
}

class DocParseClient {
    constructor({ baseUrl, apiKey, fetchImpl = null }) {
        this.baseUrl = String(baseUrl || '').replace(/\/+$/, '');
        this.apiKey = apiKey;
        // Injectable so unit tests never need a live gateway.
        this.fetch = fetchImpl || ((...args) => fetch(...args));
    }

    /** Authenticated header. NEVER used on the upload leg — see uploadStream. */
    get authHeaders() {
        return { Authorization: `Bearer ${this.apiKey}` };
    }

    async failure(response) {
        let reason = null;
        try {
            reason = (await response.json()).reason || null;
        } catch (error) {
            /* non-JSON error body; reason stays null */
        }
        return new DocParseError(
            `Document Parsing API returned ${response.status}${reason ? ` (${reason})` : ''}`,
            { status: response.status, reason }
        );
    }

    /**
     * Step 1: create a job. Returns a single-use upload ticket valid ~15 minutes.
     *
     * `options.chunk` MUST be passed here — chunking happens during the parse
     * and cannot be requested afterwards. Reading /chunks on a job created
     * without it returns 409 not_chunked, and the only fix is resubmitting the
     * whole document.
     *
     * A 429 means NO job was created, so the fix is to re-send this same
     * request after Retry-After rather than building a new one.
     */
    async createJob({ filename, contentType = null, options = {} } = {}, { attempts = 3 } = {}) {
        let lastError = null;

        for (let attempt = 0; attempt < attempts; attempt++) {
            const response = await this.fetch(`${this.baseUrl}/v1/documents`, {
                method: 'POST',
                headers: { ...this.authHeaders, 'Content-Type': 'application/json' },
                body: JSON.stringify({ filename, content_type: contentType, options })
            });

            if (response.status === 429) {
                lastError = await this.failure(response);
                const waitSeconds = Number(response.headers?.get?.('Retry-After') || 30);
                await new Promise((resolve) => setTimeout(resolve, waitSeconds * 1000));
                continue;
            }
            if (!response.ok) throw await this.failure(response);

            const body = await response.json();
            return {
                jobId: body.job_id,
                uploadUrl: body.upload.url,
                ticket: body.upload.ticket,
                // The app's authoritative ceiling. Read it rather than
                // hard-coding 100 MB — it is configured per app.
                maxBytes: body.upload.max_bytes,
                expiresAt: body.upload.expires_at
            };
        }

        throw lastError || new DocParseError('Document Parsing API refused the job', {
            status: 429,
            reason: 'rate_limited'
        });
    }

    /**
     * Step 2: stream bytes to the gateway from this server.
     *
     * Note there is no Authorization header: the ticket in the URL is the
     * credential, which is what makes it safe to hand to a browser instead.
     * BiocBot already holds the bytes server-side (multer, or a server-to-server
     * LMS import), so we do this leg ourselves — see the PRD's phase 1.
     *
     * `duplex: 'half'` is required by fetch to send a streaming body; without it
     * Node buffers the entire file in memory before sending.
     */
    async uploadStream(uploadUrl, stream, { contentLength = null } = {}) {
        const headers = { 'Content-Type': 'application/octet-stream' };
        if (contentLength != null) headers['Content-Length'] = String(contentLength);

        const response = await this.fetch(`${this.baseUrl}${uploadUrl}`, {
            method: 'PUT',
            headers,
            body: Readable.toWeb(stream),
            duplex: 'half'
        });
        // 413 too_large and 410 upload_expired are ordinary outcomes and fetch
        // does not throw on either, so this check is what turns them into
        // errors. Without it we report success for an upload that never
        // happened, and the document silently ingests as empty.
        if (!response.ok) throw await this.failure(response);

        const body = await response.json();
        return { jobId: body.job_id, status: body.status, bytesReceived: body.bytes_received };
    }

    /** Convenience wrapper: upload a Buffer we already hold. */
    async uploadBuffer(uploadUrl, buffer) {
        return this.uploadStream(uploadUrl, Readable.from(buffer), { contentLength: buffer.length });
    }

    /** Step 3: one status read. Cheap and unmetered — poll this. */
    async getStatus(jobId) {
        const response = await this.fetch(`${this.baseUrl}/v1/documents/${jobId}`, {
            headers: this.authHeaders
        });
        if (!response.ok) throw await this.failure(response);
        return response.json();
    }

    /**
     * Step 4: the chunks, as an async iterator — the RAG ingestion path.
     *
     * The service returns NDJSON (one JSON object per line) so a consumer can
     * process chunks as they arrive rather than holding the whole result in
     * memory. `offset` lets a caller resume part-way through.
     */
    async *streamChunks(jobId, { offset = 0, limit = null } = {}) {
        const url = new URL(`${this.baseUrl}/v1/documents/${jobId}/chunks`);
        if (offset) url.searchParams.set('offset', String(offset));
        if (limit != null) url.searchParams.set('limit', String(limit));

        const response = await this.fetch(url, { headers: this.authHeaders });
        if (!response.ok) throw await this.failure(response);

        // A JSON object can be split across TCP packets, so hold the trailing
        // partial line back until the newline that completes it arrives.
        let buffer = '';
        for await (const piece of response.body) {
            buffer += Buffer.from(piece).toString('utf8');
            const lines = buffer.split('\n');
            buffer = lines.pop();
            for (const line of lines) if (line) yield JSON.parse(line);
        }
        if (buffer.trim()) yield JSON.parse(buffer); // body with no trailing newline
    }

    /** Optional: purge a result early rather than waiting for the 1-hour TTL. */
    async deleteJob(jobId) {
        const response = await this.fetch(`${this.baseUrl}/v1/documents/${jobId}`, {
            method: 'DELETE',
            headers: this.authHeaders
        });
        if (!response.ok && response.status !== 404) throw await this.failure(response);
    }
}

module.exports = {
    DocParseClient,
    DocParseError
};
