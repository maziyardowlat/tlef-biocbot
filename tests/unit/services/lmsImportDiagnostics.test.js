const {
    createLmsImportDiagnostics,
    safeUrlHost,
    sanitizeDiagnosticText,
    summarizeError
} = require('../../../src/services/lmsImportDiagnostics');

describe('LMS import diagnostics', () => {
    afterEach(() => {
        jest.restoreAllMocks();
    });

    test('keeps only the host from signed LMS file URLs', () => {
        expect(safeUrlHost('https://files.example.edu/path/file.pdf?verifier=secret'))
            .toBe('https://files.example.edu');
        expect(safeUrlHost('javascript:alert(1)')).toBeNull();
    });

    test('redacts bearer tokens and URL query strings from log text', () => {
        const value = sanitizeDiagnosticText(
            'GET https://files.example.edu/file?X-Amz-Signature=secret with Bearer token-value'
        );
        expect(value).toBe('GET https://files.example.edu/file?[REDACTED] with Bearer [REDACTED]');
        expect(value).not.toContain('secret');
        expect(value).not.toContain('token-value');
    });

    test('logs a correlated failure while returning only safe browser fields', () => {
        const info = jest.spyOn(console, 'info').mockImplementation(() => {});
        const errorLog = jest.spyOn(console, 'error').mockImplementation(() => {});
        const diagnostics = createLmsImportDiagnostics({
            req: {
                method: 'POST',
                originalUrl: '/api/lms/canvas/courses/BIOC-1/import-file',
                user: { userId: 'instructor-1' }
            },
            provider: 'canvas',
            biocbotCourseId: 'BIOC-1',
            externalCourseId: '10',
            externalFileId: '31',
            fileUrl: 'https://files.example.edu/file?verifier=do-not-log',
            lmsDomain: 'canvas.example.edu',
            allowedDownloadHostSuffixes: ['files.example.edu']
        });

        diagnostics.step('download');
        const failure = new Error('Download failed at https://files.example.edu/file?token=secret');
        failure.name = 'CanvasApiError';
        failure.statusCode = 502;
        failure.provider = 'canvas';
        const browserDiagnostic = diagnostics.fail(failure);

        expect(browserDiagnostic).toMatchObject({
            reference: expect.any(String),
            provider: 'canvas',
            stage: 'download',
            errorName: 'CanvasApiError',
            statusCode: 502,
            fileHost: 'https://files.example.edu',
            lmsHost: 'https://canvas.example.edu',
            allowedDownloadHostSuffixes: ['files.example.edu'],
            toolkitVersion: expect.any(String)
        });
        expect(browserDiagnostic).not.toHaveProperty('stack');
        expect(info).toHaveBeenCalledTimes(2);
        const logged = errorLog.mock.calls[0][0];
        expect(logged).toContain(browserDiagnostic.reference);
        expect(logged).toContain('BIOC-1');
        expect(logged).toContain('?[REDACTED]');
        expect(logged).not.toContain('do-not-log');
        expect(logged).not.toContain('token=secret');
    });

    test('summarizes nested causes without copying arbitrary error properties', () => {
        const cause = Object.assign(new Error('socket failed'), { code: 'ECONNRESET', token: 'secret' });
        const error = new Error('download failed', { cause });
        error.response = { status: 502, data: { token: 'secret' } };

        expect(summarizeError(error)).toMatchObject({
            message: 'download failed',
            statusCode: 502,
            cause: { message: 'socket failed', code: 'ECONNRESET' }
        });
        expect(summarizeError(error)).not.toHaveProperty('response');
    });
});
