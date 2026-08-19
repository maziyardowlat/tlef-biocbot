/**
 * Unit tests for src/services/rawDb.js — the single sanctioned way to reach the
 * driver `Db` underneath the field-level encryption wrapper.
 */
const { resolveRawDb } = require('../../../src/services/rawDb');

describe('resolveRawDb', () => {
    test('returns an ordinary driver db unchanged', () => {
        const db = { collection: jest.fn(), admin: jest.fn() };

        expect(resolveRawDb(db)).toBe(db);
    });

    test('unwraps a protected db to the driver db underneath', () => {
        const raw = { collection: jest.fn() };
        const protectedDb = { collection: jest.fn(), getRawDb: () => raw };

        expect(resolveRawDb(protectedDb)).toBe(raw);
    });

    test('passes through null and undefined so callers keep their own guards', () => {
        expect(resolveRawDb(null)).toBeNull();
        expect(resolveRawDb(undefined)).toBeUndefined();
    });
});
