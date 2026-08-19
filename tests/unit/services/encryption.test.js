/**
 * Unit tests for src/services/encryption.js — the startup gate that decides
 * whether the database handed to routes is encrypted.
 */
const mockCreateEncryptedDb = jest.fn();

jest.mock('ubc-genai-toolkit-encryption', () => {
    const actual = jest.requireActual('ubc-genai-toolkit-encryption');
    return {
        ...actual,
        createEncryptedDb: (...args) => mockCreateEncryptedDb(...args)
    };
});

const { isEncryptionEnabled, protectDatabase } = require('../../../src/services/encryption');

const ORIGINAL_ENABLED = process.env.ENCRYPTION_ENABLED;
const ORIGINAL_KEY = process.env.BIOCBOT_DATA_ENCRYPTION_KEY;

beforeAll(() => {
    jest.spyOn(console, 'log').mockImplementation(() => {});
    jest.spyOn(console, 'error').mockImplementation(() => {});
});

afterAll(() => {
    process.env.ENCRYPTION_ENABLED = ORIGINAL_ENABLED;
    process.env.BIOCBOT_DATA_ENCRYPTION_KEY = ORIGINAL_KEY;
    jest.restoreAllMocks();
});

beforeEach(() => {
    mockCreateEncryptedDb.mockReset();
    delete process.env.ENCRYPTION_ENABLED;
});

describe('isEncryptionEnabled', () => {
    test('is off when the flag is unset', () => {
        expect(isEncryptionEnabled()).toBe(false);
    });

    test('is on for the literal string true, ignoring case and padding', () => {
        process.env.ENCRYPTION_ENABLED = ' TRUE ';
        expect(isEncryptionEnabled()).toBe(true);
    });

    test('treats every other value as off rather than guessing', () => {
        for (const value of ['1', 'yes', 'on', 'false', '']) {
            process.env.ENCRYPTION_ENABLED = value;
            expect(isEncryptionEnabled()).toBe(false);
        }
    });
});

describe('protectDatabase', () => {
    test('returns the database untouched when encryption is off', async () => {
        const db = { collection: jest.fn() };

        await expect(protectDatabase(db)).resolves.toBe(db);
        expect(mockCreateEncryptedDb).not.toHaveBeenCalled();
    });

    test('wraps the database with the BiocBot configuration when encryption is on', async () => {
        process.env.ENCRYPTION_ENABLED = 'true';
        const db = { collection: jest.fn() };
        const wrapped = { collection: jest.fn(), getRawDb: () => db };
        mockCreateEncryptedDb.mockResolvedValue(wrapped);

        await expect(protectDatabase(db)).resolves.toBe(wrapped);

        const [passedDb, config] = mockCreateEncryptedDb.mock.calls[0];
        expect(passedDb).toBe(db);
        expect(config.namespace).toBe('tlef-biocbot');
        expect(config.writePolicy).toBe('encrypted');
        expect(Object.keys(config.collections)).toEqual(expect.arrayContaining([
            'chat_sessions',
            'mentalHealthFlags',
            'superchat_notes'
        ]));
    });

    test('rethrows rather than falling back to plaintext when the key is unusable', async () => {
        process.env.ENCRYPTION_ENABLED = 'true';
        const failure = new Error('environment variable is not set');
        mockCreateEncryptedDb.mockRejectedValue(failure);

        await expect(protectDatabase({ collection: jest.fn() })).rejects.toBe(failure);
    });
});
