'use strict';

/**
 * Keeps the outcome of each student chat request for a while, so a page that
 * reloads while BiocBot is writing a reply can still show the reply.
 *
 * POST /api/chat returns the reply only in its response; the page saves it
 * after the response arrives. A reload aborts that request, but the server
 * still finishes the run, so without this the finished reply was dropped.
 *
 * There is one entry per student, course and conversation. A new request in
 * the same conversation replaces the last one. Entries live in this process's
 * memory, like the practice-question store in routes/chat.js: a reload is
 * served by the same process, and a reply only needs to outlive the reload.
 * The reply is not written anywhere else, so nothing new is stored at rest.
 */

/** How long an entry is kept after its last change. */
const KEEP_MS = 30 * 60 * 1000;
/** The oldest entries go first past this many, to bound memory. */
const MAX_ENTRIES = 1000;
/** Session ids are short; anything longer isn't one. */
const MAX_ID_LENGTH = 200;

/** @type {Map<string, { state: 'pending' | 'ready' | 'failed', isExplanationRequest: boolean, body: Object | null, updatedAt: number }>} */
const entries = new Map();

function keyFor(userId, courseId, conversationId) {
    const ids = [userId, courseId, conversationId];
    if (!ids.every(id => typeof id === 'string' && id.length > 0 && id.length <= MAX_ID_LENGTH)) return null;
    return JSON.stringify(ids);
}

/** Map order is last-change order, so expired entries are at the front. */
function put(key, entry) {
    entries.delete(key);
    entries.set(key, entry);
    for (const [oldKey, oldEntry] of entries) {
        if (entries.size <= MAX_ENTRIES && entry.updatedAt - oldEntry.updatedAt <= KEEP_MS) break;
        entries.delete(oldKey);
    }
}

/**
 * Record that a reply is being written for this conversation.
 * @param {{ userId?: string, courseId?: string, conversationId?: string, isExplanationRequest?: boolean }} request
 * @returns {((status: number, body: Object) => void) | null} Records the
 *   response the request ended with, or null when the request has no
 *   conversation to keep it for.
 */
function start({ userId, courseId, conversationId, isExplanationRequest }) {
    const key = keyFor(userId, courseId, conversationId);
    if (!key) return null;
    const entry = { state: 'pending', isExplanationRequest: !!isExplanationRequest, body: null, updatedAt: Date.now() };
    put(key, entry);
    return (status, body) => {
        // A newer request in the conversation has replaced this one.
        if (entries.get(key) !== entry) return;
        const ok = status >= 200 && status < 300 && !!body && body.success === true;
        put(key, { ...entry, state: ok ? 'ready' : 'failed', body: ok ? body : null, updatedAt: Date.now() });
    };
}

/**
 * The latest request's outcome for this conversation, or null when there is none.
 * @param {{ userId?: string, courseId?: string, conversationId?: string }} conversation
 */
function get({ userId, courseId, conversationId }) {
    const key = keyFor(userId, courseId, conversationId);
    const entry = key ? entries.get(key) : undefined;
    if (!entry) return null;
    if (Date.now() - entry.updatedAt > KEEP_MS) {
        entries.delete(key);
        return null;
    }
    return entry;
}

/** Forget every entry (tests). */
function clear() {
    entries.clear();
}

module.exports = { KEEP_MS, MAX_ENTRIES, start, get, clear };
