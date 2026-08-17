/**
 * Pure helpers behind the Canvas grade sync: identifier parsing, score
 * validation, masking, export fingerprints, and the error surface an
 * instructor sees.
 */

const canvasGradeSync = require('../../../src/services/canvasGradeSync');
const CanvasGradeRecord = require('../../../src/models/CanvasGradeRecord');
const { requireSameOrigin } = require('../../../src/routes/studentHubCanvasGrades');
const { canvas } = require('@ubc/ubc-genai-toolkit-lms-integration');

describe('course integration ids', () => {
    test('round-trips a BiocBot course id', () => {
        const id = canvasGradeSync.buildCourseIntegrationId('BIOC-1');
        expect(id).toBe('canvas:BIOC-1');
        expect(canvasGradeSync.parseCourseIntegrationId(id)).toEqual({
            provider: 'canvas',
            biocbotCourseId: 'BIOC-1'
        });
    });

    test('rejects anything that is not a namespaced BiocBot link id', () => {
        // A bare number is what a Canvas course id looks like, and it must not
        // be usable as a link id.
        for (const value of ['1001', '', null, undefined, 'moodle:BIOC-1', ':BIOC-1', 'canvas:']) {
            expect(canvasGradeSync.parseCourseIntegrationId(value)).toBeNull();
        }
    });
});

describe('draft score validation', () => {
    const points = { gradingType: 'points', maxScore: 10 };

    test('accepts an empty draft and a value within range', () => {
        expect(canvasGradeSync.validateDraftScore(null, points)).toBeNull();
        expect(canvasGradeSync.validateDraftScore(0, points)).toBeNull();
        expect(canvasGradeSync.validateDraftScore(10, points)).toBeNull();
    });

    test('rejects non-finite, negative, and over-maximum scores', () => {
        expect(canvasGradeSync.validateDraftScore(Number.NaN, points)).toMatch(/must be a number/);
        expect(canvasGradeSync.validateDraftScore(Infinity, points)).toMatch(/must be a number/);
        expect(canvasGradeSync.validateDraftScore(-1, points)).toMatch(/cannot be negative/);
        expect(canvasGradeSync.validateDraftScore(11, points)).toMatch(/exceed the assignment maximum of 10/);
    });

    test('leaves non-points grading modes to Canvas', () => {
        // Canvas parses percentage and letter grades itself; second-guessing the
        // ceiling here would reject valid input.
        expect(canvasGradeSync.validateDraftScore(150, { gradingType: 'percent', maxScore: 10 })).toBeNull();
    });
});

describe('grade inputs', () => {
    test('separates rows that carry no operation at all', () => {
        const { gradeInputs, exportable, skippedNoDraft } = canvasGradeSync.buildGradeInputs([
            { recordId: 'r1', puid: 'P1', displayName: 'One', draftScore: 8, draftComment: '' },
            { recordId: 'r2', puid: 'P2', displayName: 'Two', draftScore: null, draftComment: 'Good' },
            { recordId: 'r3', puid: 'P3', displayName: 'Three', draftScore: null, draftComment: '   ' }
        ]);

        // An empty grade is refused by the toolkit as `invalid-grade`, so it is
        // reported rather than allowed to take the whole export down.
        expect(skippedNoDraft).toEqual([{ recordId: 'r3', displayName: 'Three' }]);
        expect(exportable.map((record) => record.recordId)).toEqual(['r1', 'r2']);
        expect(gradeInputs).toEqual([
            { key: 'P1', postedGrade: 8 },
            { key: 'P2', comment: 'Good' }
        ]);
    });

    test('keys grades by PUID, never by a Canvas id', () => {
        const { gradeInputs } = canvasGradeSync.buildGradeInputs([
            { recordId: 'r1', puid: 'PUID-ALICE', draftScore: 9, draftComment: '' }
        ]);
        expect(gradeInputs[0].key).toBe('PUID-ALICE');
        expect(gradeInputs[0]).not.toHaveProperty('userId');
    });
});

describe('roster coverage', () => {
    test('blocks a non-empty roster that exposed no integration_id', () => {
        expect(() => canvasGradeSync.assertRosterCoverage({
            coverage: { total: 30, integrationId: 0, sisId: 30, email: 30, loginId: 30 }
        })).toThrow(/integration_id/);
    });

    test('allows an empty course and a partially covered roster', () => {
        expect(() => canvasGradeSync.assertRosterCoverage({
            coverage: { total: 0, integrationId: 0 }
        })).not.toThrow();
        expect(() => canvasGradeSync.assertRosterCoverage({
            coverage: { total: 30, integrationId: 29 }
        })).not.toThrow();
    });
});

describe('privacy helpers', () => {
    test('masks all but the last four characters of a PUID', () => {
        expect(CanvasGradeRecord.maskPuid('12345678')).toBe('••••5678');
        expect(CanvasGradeRecord.maskPuid('abc')).toBe('••••');
        expect(CanvasGradeRecord.maskPuid('')).toBe('');
    });

    test('a client view carries no PUID and no Canvas id', () => {
        const view = CanvasGradeRecord.toClientView({
            recordId: 'r1',
            appUserId: 'u-alice',
            puid: 'PUID-ALICE',
            displayName: 'Alice',
            canvasScore: 8
        });
        const serialized = JSON.stringify(view);
        expect(serialized).not.toContain('PUID-ALICE');
        expect(view.puidMasked).toBe('••••LICE');
        expect(view).not.toHaveProperty('puid');
    });
});

describe('export fingerprints', () => {
    const rows = [
        { recordId: 'r1', appUserId: 'u1', puid: 'P1', draftScore: 8, draftComment: 'ok' },
        { recordId: 'r2', appUserId: 'u2', puid: 'P2', draftScore: 9, draftComment: '' }
    ];

    test('is stable regardless of row order', () => {
        expect(CanvasGradeRecord.fingerprintRecords(rows))
            .toBe(CanvasGradeRecord.fingerprintRecords([...rows].reverse()));
    });

    test('changes when a score or a comment changes', () => {
        const baseline = CanvasGradeRecord.fingerprintRecords(rows);
        expect(CanvasGradeRecord.fingerprintRecords([{ ...rows[0], draftScore: 7 }, rows[1]]))
            .not.toBe(baseline);
        expect(CanvasGradeRecord.fingerprintRecords([{ ...rows[0], draftComment: 'changed' }, rows[1]]))
            .not.toBe(baseline);
    });

    test('changes when a row is added or removed', () => {
        expect(CanvasGradeRecord.fingerprintRecords([rows[0]]))
            .not.toBe(CanvasGradeRecord.fingerprintRecords(rows));
    });
});

describe('draft preservation', () => {
    test('an exported draft is no longer unsynced', () => {
        expect(CanvasGradeRecord.hasUnsyncedDraft({ draftScore: 8, syncStatus: 'draft' })).toBe(true);
        expect(CanvasGradeRecord.hasUnsyncedDraft({ draftScore: 8, syncStatus: 'exported' })).toBe(false);
        expect(CanvasGradeRecord.hasUnsyncedDraft({ draftComment: 'note', syncStatus: 'draft' })).toBe(true);
        expect(CanvasGradeRecord.hasUnsyncedDraft({ draftScore: null, draftComment: '', syncStatus: 'draft' })).toBe(false);
        expect(CanvasGradeRecord.hasUnsyncedDraft(null)).toBe(false);
    });

    test('an import never writes into the draft fields', () => {
        const operation = CanvasGradeRecord.buildImportOperation({
            scope: {
                courseIntegrationId: 'canvas:BIOC-1',
                biocbotCourseId: 'BIOC-1',
                canvasCourseId: '1001',
                gradeItemId: '55',
                gradeItemName: 'Lab 1',
                maxScore: 10
            },
            appUserId: 'u-alice',
            puid: 'PUID-ALICE',
            displayName: 'Alice',
            canvas: { score: 5, grade: '5' },
            importedAt: new Date(),
            importedBy: 'inst-1',
            existing: { draftScore: 9, syncStatus: 'draft', canvasScore: 8 }
        });

        const set = operation.updateOne.update.$set;
        expect(set).not.toHaveProperty('draftScore');
        expect(set).not.toHaveProperty('draftComment');
        expect(set).not.toHaveProperty('syncStatus');
        // The disagreement is recorded so the instructor can decide.
        expect(set.draftConflict).toBe(true);
        expect(set.canvasScore).toBe(5);
    });
});

describe('error surface', () => {
    test('every toolkit refusal reason maps to instructor-facing text', () => {
        const reasons = [
            'roster-coverage', 'course-mismatch', 'assignment-mismatch', 'empty-batch',
            'partial-export', 'invalid-grade', 'preflight-stale', 'unsupported-grading'
        ];
        for (const reason of reasons) {
            const error = new canvas.CanvasGradeExportError('raw toolkit text', reason);
            const { statusCode, body } = canvasGradeSync.describeError(error);
            expect(body.code).toBe(reason);
            expect(body.message).toBe(canvasGradeSync.EXPORT_REFUSAL_MESSAGES[reason]);
            expect(statusCode).toBe(reason === 'preflight-stale' ? 409 : 400);
        }
    });

    test('preflight-stale reads as the instruction the task calls for', () => {
        const { body } = canvasGradeSync.describeError(
            new canvas.CanvasGradeExportError('...', 'preflight-stale')
        );
        expect(body.message).toBe('Canvas assignment settings changed; review the export again.');
    });

    test('a Canvas API failure never echoes its body', () => {
        const error = new canvas.CanvasApiError(
            'Canvas said: {"access_token":"secret-abc","errors":[{"message":"nope"}]}',
            403
        );
        const { statusCode, body } = canvasGradeSync.describeError(error);
        expect(statusCode).toBe(502);
        expect(body.message).not.toMatch(/secret-abc/);
        expect(body.message).toMatch(/HTTP 403/);
    });

    test('an OAuth failure does not leak its detail either', () => {
        const error = new canvas.CanvasOAuthError('refresh failed', 'invalid_grant', 'token secret-xyz revoked');
        const { statusCode, body } = canvasGradeSync.describeError(error);
        expect(statusCode).toBe(502);
        expect(body.code).toBe('canvas-oauth-error');
        expect(JSON.stringify(body)).not.toMatch(/secret-xyz/);
    });

    test('an unexpected error becomes a generic 500', () => {
        const { statusCode, body } = canvasGradeSync.describeError(
            new Error('Mongo connection string mongodb://user:pw@host failed')
        );
        expect(statusCode).toBe(500);
        expect(body.message).toBe('The Canvas grade operation failed.');
    });
});

describe('same-origin guard', () => {
    function run(guard, req) {
        const res = {
            statusCode: null,
            body: null,
            status(code) { this.statusCode = code; return this; },
            json(payload) { this.body = payload; return this; }
        };
        const next = jest.fn();
        guard({ get: (header) => req.headers[header.toLowerCase()] || undefined, method: req.method || 'POST' }, res, next);
        return { res, next };
    }

    const guard = requireSameOrigin(['http://localhost:3002']);

    test('allows a same-host origin', () => {
        const { next } = run(guard, { headers: { origin: 'https://biocbot.example.edu', host: 'biocbot.example.edu' } });
        expect(next).toHaveBeenCalled();
    });

    test('allows a configured proxy origin', () => {
        const { next } = run(guard, { headers: { origin: 'http://localhost:3002', host: 'localhost:8080' } });
        expect(next).toHaveBeenCalled();
    });

    test('refuses a foreign origin', () => {
        const { res, next } = run(guard, { headers: { origin: 'https://evil.example', host: 'biocbot.example.edu' } });
        expect(next).not.toHaveBeenCalled();
        expect(res.statusCode).toBe(403);
        expect(res.body.code).toBe('bad-origin');
    });

    test('falls back to the referer when no origin is sent', () => {
        const { res } = run(guard, { headers: { referer: 'https://evil.example/page', host: 'biocbot.example.edu' } });
        expect(res.statusCode).toBe(403);
    });

    test('leaves reads and non-browser requests alone', () => {
        expect(run(guard, { method: 'GET', headers: { origin: 'https://evil.example', host: 'x' } }).next)
            .toHaveBeenCalled();
        expect(run(guard, { headers: { host: 'biocbot.example.edu' } }).next).toHaveBeenCalled();
    });
});

describe('attachment ceiling', () => {
    test('defaults when unset and honours a positive safe integer', () => {
        expect(canvasGradeSync.attachmentMaxBytes({})).toBe(canvasGradeSync.DEFAULT_ATTACHMENT_MAX_BYTES);
        expect(canvasGradeSync.attachmentMaxBytes({ CANVAS_SUBMISSION_ATTACHMENT_MAX_BYTES: '1024' })).toBe(1024);
    });

    test('ignores values Canvas would reject anyway', () => {
        for (const value of ['0', '-5', 'lots', '1.5']) {
            expect(canvasGradeSync.attachmentMaxBytes({ CANVAS_SUBMISSION_ATTACHMENT_MAX_BYTES: value }))
                .toBe(canvasGradeSync.DEFAULT_ATTACHMENT_MAX_BYTES);
        }
    });
});
