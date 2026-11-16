/**
 * Student chat: posting a message to /api/chat and reading the response. It
 * has no DOM of its own, so a test can load it and post to the real route.
 */

/**
 * Post a chat message and return the response's status code and body. The
 * agent path streams each step's status while it writes the reply, and
 * onStatus gets each one's text for the status line.
 * @param {Object} requestBody - The body POST /api/chat reads
 * @param {{ signal?: AbortSignal|null, onStatus: (text: string) => void }} options
 * @returns {Promise<{ status: number, data: Object }>}
 */
async function requestChatReply(requestBody, { signal = null, onStatus }) {
    const fetchOptions = {
        method: 'POST',
        headers: {
            'Content-Type': 'application/json',
            // The agent path streams progress when asked; the old
            // path ignores this and answers with JSON as before.
            'Accept': 'text/event-stream, application/json'
        },
        body: JSON.stringify(requestBody)
    };

    if (signal) {
        fetchOptions.signal = signal;
    }

    const response = await fetch('/api/chat', fetchOptions);

    let status = response.status;
    let data;
    // A response with no headers (a test's fake fetch) reads as JSON.
    if ((response.headers?.get?.('Content-Type') || '').includes('text/event-stream')) {
        const result = await readChatProgressStream(response, update => onStatus(update && update.status));
        status = result.status;
        data = result.body || {};
    } else {
        data = await response.json();
    }
    return { status, data };
}

/**
 * Read a chat response sent as server-sent events: "progress" events while
 * the agents run, then one "result" event with the response's status and
 * body.
 * @param {Response} response
 * @param {(update: { step: string, label: string, status: string }) => void} onProgress
 * @returns {Promise<{ status: number, body: Object }>}
 */
async function readChatProgressStream(response, onProgress) {
    const reader = response.body.getReader();
    const decoder = new TextDecoder();
    let buffer = '';
    let result = null;
    const handleFrame = frame => {
        let event = 'message';
        let data = '';
        frame.split('\n').forEach(line => {
            if (line.startsWith('event:')) event = line.slice(6).trim();
            else if (line.startsWith('data:')) data += line.slice(5).trim();
        });
        if (!data) return;
        const payload = JSON.parse(data);
        if (event === 'progress') {
            try { onProgress(payload); } catch (error) { console.warn('Could not show chat progress:', error); }
        } else if (event === 'result') {
            result = payload;
        }
    };
    for (;;) {
        const { value, done } = await reader.read();
        if (done) break;
        buffer += decoder.decode(value, { stream: true });
        let boundary;
        while ((boundary = buffer.indexOf('\n\n')) !== -1) {
            handleFrame(buffer.slice(0, boundary));
            buffer = buffer.slice(boundary + 2);
        }
    }
    if (buffer.trim()) handleFrame(buffer);
    if (!result) throw new Error('The chat response ended before the reply arrived.');
    return result;
}
