const crypto = require('crypto');

let toolkitVersion = null;
try {
    toolkitVersion = require('@ubc/ubc-genai-toolkit-lms-integration/package.json').version;
} catch {
    // The LMS package is optional; diagnostics must remain importable when it is absent.
}

const PHASE_TO_STEP = Object.freeze({
    storing: 'store',
    extracting: 'extract',
    extracted: 'extract',
    saving: 'save',
    indexing: 'index'
});

/**
 * Removes credentials and signed query strings before text reaches a log.
 * Canvas file URLs commonly carry verifier or S3 signature parameters, so a
 * full URL is never useful enough to justify recording those values.
 */
function sanitizeDiagnosticText(value) {
    return String(value ?? '')
        .replace(/\bBearer\s+[^\s,;]+/gi, 'Bearer [REDACTED]')
        .replace(/(https?:\/\/[^\s?#]+)\?[^\s#]*/gi, '$1?[REDACTED]')
        .replace(/([?&](?:access_token|token|verifier|signature|x-amz-[^=]+)=)[^&\s]+/gi, '$1[REDACTED]');
}

/** Returns only protocol + hostname + port; paths and queries are omitted. */
function safeUrlHost(value) {
    const text = String(value || '').trim();
    if (!text) return null;
    try {
        const url = new URL(text.includes('://') ? text : `https://${text}`);
        if (!['http:', 'https:'].includes(url.protocol)) return null;
        return `${url.protocol}//${url.host}`;
    } catch {
        return null;
    }
}

function errorStatus(error) {
    const candidate = error?.statusCode ?? error?.status ?? error?.response?.status;
    const status = Number(candidate);
    return Number.isInteger(status) && status >= 100 && status <= 599 ? status : null;
}

function summarizeError(error, depth = 0) {
    if (!error) return { name: 'Error', message: 'LMS import failed' };
    const summary = {
        name: sanitizeDiagnosticText(error.name || error.constructor?.name || 'Error'),
        message: sanitizeDiagnosticText(error.message || String(error))
    };
    if (error.code !== undefined) summary.code = sanitizeDiagnosticText(error.code);
    const statusCode = errorStatus(error);
    if (statusCode) summary.statusCode = statusCode;
    if (error.provider) summary.provider = sanitizeDiagnosticText(error.provider);
    if (error.stack) summary.stack = sanitizeDiagnosticText(error.stack);
    if (depth < 2 && error.cause && error.cause !== error) {
        summary.cause = summarizeError(error.cause, depth + 1);
    }
    return summary;
}

function publicErrorDiagnostic(error, context) {
    const summary = summarizeError(error);
    return {
        reference: context.reference,
        provider: context.provider,
        stage: context.stage,
        errorName: summary.name,
        ...(summary.code ? { code: summary.code } : {}),
        ...(summary.statusCode ? { statusCode: summary.statusCode } : {}),
        ...(context.fileHost ? { fileHost: context.fileHost } : {}),
        ...(context.lmsHost ? { lmsHost: context.lmsHost } : {}),
        ...(context.allowedDownloadHostSuffixes.length
            ? { allowedDownloadHostSuffixes: context.allowedDownloadHostSuffixes }
            : {}),
        ...(toolkitVersion ? { toolkitVersion } : {}),
        occurredAt: new Date().toISOString()
    };
}

function log(level, payload) {
    const line = `[LMS import] ${JSON.stringify(payload)}`;
    if (level === 'error') console.error(line);
    else console.info(line);
}

/**
 * Produces one correlation reference for a complete import and records every
 * external/ingestion boundary. The browser receives only publicDiagnostic;
 * stacks and course/user identifiers stay in server logs.
 */
function createLmsImportDiagnostics({
    req,
    provider,
    biocbotCourseId,
    externalCourseId,
    externalFileId,
    fileUrl,
    lmsDomain,
    allowedDownloadHostSuffixes = []
}) {
    const context = {
        reference: crypto.randomUUID(),
        provider,
        stage: 'prepare',
        biocbotCourseId: String(biocbotCourseId || ''),
        externalCourseId: String(externalCourseId || ''),
        externalFileId: String(externalFileId || ''),
        userId: String(req?.user?.userId || ''),
        method: String(req?.method || ''),
        path: sanitizeDiagnosticText(req?.originalUrl || req?.url || ''),
        fileHost: safeUrlHost(fileUrl),
        lmsHost: safeUrlHost(lmsDomain),
        toolkitVersion,
        allowedDownloadHostSuffixes: Array.isArray(allowedDownloadHostSuffixes)
            ? allowedDownloadHostSuffixes.map((host) => String(host).trim()).filter(Boolean)
            : []
    };
    let finished = false;

    log('info', { event: 'started', ...context });

    function recordStep(stage, detail = {}) {
        if (finished) return;
        context.stage = stage;
        log('info', {
            event: 'step',
            ...context,
            detail: Object.fromEntries(Object.entries(detail).map(([key, value]) => [
                key,
                typeof value === 'string' ? sanitizeDiagnosticText(value) : value
            ]))
        });
    }

    return {
        get reference() {
            return context.reference;
        },
        step: recordStep,
        onIngestionProgress({ phase, ...detail }) {
            const stage = PHASE_TO_STEP[phase];
            if (stage) recordStep(stage, { phase, ...detail });
        },
        done(data = {}) {
            if (finished) return;
            finished = true;
            context.stage = 'done';
            log('info', {
                event: 'completed',
                ...context,
                documentId: data.documentId || null,
                chunksStored: Number(data.chunksStored) || 0
            });
        },
        fail(error) {
            const diagnostic = publicErrorDiagnostic(error, context);
            if (!finished) {
                finished = true;
                log('error', {
                    event: 'failed',
                    ...context,
                    error: summarizeError(error),
                    publicDiagnostic: diagnostic
                });
            }
            return diagnostic;
        }
    };
}

module.exports = {
    createLmsImportDiagnostics,
    errorStatus,
    publicErrorDiagnostic,
    safeUrlHost,
    sanitizeDiagnosticText,
    summarizeError
};
