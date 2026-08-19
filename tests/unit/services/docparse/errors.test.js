/**
 * The reason table is the whole point of this module: `failed` alone is not a
 * verdict, and branching on status instead of reason tells instructors their
 * lecture broke while the service is still parsing it.
 */
const {
    NON_FINAL_FAILURE_REASONS,
    describeReason,
    isFinal,
    isRetryable
} = require('../../../../src/services/docparse/errors');

describe('isFinal', () => {
    test('done and rejected are always final, whatever the reason', () => {
        expect(isFinal('done')).toBe(true);
        expect(isFinal('rejected', 'infected')).toBe(true);
        expect(isFinal('rejected', 'unsupported_type')).toBe(true);
    });

    test('failed on a transient reason is NOT final — the worker is still retrying', () => {
        expect(isFinal('failed', 'scan_unavailable')).toBe(false);
    });

    test('failed on a verdict reason is final', () => {
        expect(isFinal('failed', 'parse_error')).toBe(true);
        expect(isFinal('failed', 'retries_exhausted')).toBe(true);
    });

    test('failed with no reason is final, so an unknown failure cannot hang the poll loop', () => {
        expect(isFinal('failed')).toBe(true);
        expect(isFinal('failed', null)).toBe(true);
    });

    test('our own invented reasons are final — we stopped watching, so nothing will move', () => {
        expect(isFinal('failed', 'poll_timeout')).toBe(true);
        expect(isFinal('failed', 'tracker_error')).toBe(true);
        expect(isFinal('failed', 'not_found')).toBe(true);
    });

    test('in-flight states are not final', () => {
        for (const status of ['awaiting_upload', 'queued', 'processing']) {
            expect(isFinal(status)).toBe(false);
        }
    });

    test('scan_unavailable is the only non-final failure reason', () => {
        expect([...NON_FINAL_FAILURE_REASONS]).toEqual(['scan_unavailable']);
    });
});

describe('isRetryable', () => {
    test('separates transient faults from permanent verdicts', () => {
        expect(isRetryable('scan_unavailable')).toBe(true);
        expect(isRetryable('retries_exhausted')).toBe(true);
        expect(isRetryable('rate_limited')).toBe(true);
        expect(isRetryable('too_many_concurrent')).toBe(true);

        expect(isRetryable('infected')).toBe(false);
        expect(isRetryable('unsupported_type')).toBe(false);
        expect(isRetryable('parse_error')).toBe(false);
        expect(isRetryable('too_large')).toBe(false);
    });
});

describe('describeReason', () => {
    test('gives an instructor-facing sentence for every reason the service sends', () => {
        expect(describeReason('infected')).toMatch(/scanner/i);
        expect(describeReason('parse_error')).toMatch(/corrupt/i);
        expect(describeReason('too_large')).toMatch(/larger/i);
    });

    test('falls back rather than returning undefined for an unknown reason', () => {
        expect(describeReason('something_new')).toMatch(/unknown reason/i);
        expect(describeReason(null)).toMatch(/unknown reason/i);
    });
});
