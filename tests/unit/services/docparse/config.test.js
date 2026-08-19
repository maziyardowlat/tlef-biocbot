/**
 * Which documents go to the parsing service, and what we ask it for.
 *
 * The routing table is the load-bearing part: sending PPTX or DOCX there would
 * silently drop every image description, and .doc/.rtf are rejected outright.
 */
const {
    DOCPARSE_MIME_TYPES,
    PDF_MIME_TYPE,
    buildJobOptions,
    getDocParseConfig,
    shouldUseDocParse
} = require('../../../../src/services/docparse/config');

const LIVE = {
    DOCPARSE_ENABLED: 'true',
    DOCPARSE_BASE_URL: 'http://localhost:8000',
    DOCPARSE_API_KEY: 'ubcdp_dev_secret'
};

const PPTX = 'application/vnd.openxmlformats-officedocument.presentationml.presentation';
const DOCX = 'application/vnd.openxmlformats-officedocument.wordprocessingml.document';

describe('getDocParseConfig', () => {
    test('is disabled by default, so an unconfigured deployment keeps the old path', () => {
        expect(getDocParseConfig({}).enabled).toBe(false);
    });

    test('stays disabled when the flag is on but the service is only half configured', () => {
        expect(getDocParseConfig({ DOCPARSE_ENABLED: 'true' }).enabled).toBe(false);
        expect(getDocParseConfig({ ...LIVE, DOCPARSE_API_KEY: '' }).enabled).toBe(false);
        expect(getDocParseConfig({ ...LIVE, DOCPARSE_BASE_URL: '' }).enabled).toBe(false);
    });

    test('DOCPARSE_ENABLED=false disables it even when fully configured', () => {
        expect(getDocParseConfig({ ...LIVE, DOCPARSE_ENABLED: 'false' }).enabled).toBe(false);
    });

    test('accepts the usual truthy spellings of the flag', () => {
        for (const value of ['true', 'TRUE', '1', 'yes', 'on']) {
            expect(getDocParseConfig({ ...LIVE, DOCPARSE_ENABLED: value }).enabled).toBe(true);
        }
    });

    test('the default poll deadline exceeds the service worker timeout of 1200s', () => {
        expect(getDocParseConfig(LIVE).pollTimeoutMs).toBeGreaterThan(1200 * 1000);
        expect(getDocParseConfig(LIVE).embedBatchSize).toBe(100);
    });

    test('accepts a bounded embedding/upsert batch size override', () => {
        expect(getDocParseConfig({ ...LIVE, DOCPARSE_EMBED_BATCH_SIZE: '25' }).embedBatchSize).toBe(25);
        expect(getDocParseConfig({ ...LIVE, DOCPARSE_EMBED_BATCH_SIZE: '0' }).embedBatchSize).toBe(100);
    });

    test('rejects non-positive overrides rather than polling with a zero interval', () => {
        const config = getDocParseConfig({
            ...LIVE,
            DOCPARSE_POLL_INTERVAL_MS: '0',
            DOCPARSE_POLL_TIMEOUT_MS: 'not-a-number'
        });
        expect(config.pollIntervalMs).toBe(1000);
        expect(config.pollTimeoutMs).toBe(1800000);
    });
});

describe('shouldUseDocParse', () => {
    const config = getDocParseConfig(LIVE);

    test('PDF is the format the service handles for us', () => {
        expect(shouldUseDocParse(PDF_MIME_TYPE, config)).toBe(true);
        expect(DOCPARSE_MIME_TYPES).toEqual([PDF_MIME_TYPE]);
    });

    test('PPTX and DOCX stay in-process so their image descriptions survive', () => {
        expect(shouldUseDocParse(PPTX, config)).toBe(false);
        expect(shouldUseDocParse(DOCX, config)).toBe(false);
    });

    test('legacy .doc and .rtf stay in-process — the service rejects them outright', () => {
        expect(shouldUseDocParse('application/msword', config)).toBe(false);
        expect(shouldUseDocParse('application/rtf', config)).toBe(false);
    });

    test('text and markdown stay on the existing short-circuit', () => {
        expect(shouldUseDocParse('text/plain', config)).toBe(false);
        expect(shouldUseDocParse('text/markdown', config)).toBe(false);
    });

    test('nothing routes to the service while it is disabled', () => {
        const off = getDocParseConfig({});
        expect(shouldUseDocParse(PDF_MIME_TYPE, off)).toBe(false);
        expect(shouldUseDocParse(PDF_MIME_TYPE, null)).toBe(false);
    });

    test('is case-insensitive about the MIME type', () => {
        expect(shouldUseDocParse('APPLICATION/PDF', config)).toBe(true);
    });
});

describe('buildJobOptions', () => {
    test('always requests chunking — it cannot be added after the job is created', () => {
        const options = buildJobOptions(getDocParseConfig(LIVE));
        expect(options.chunk).toEqual({ strategy: 'word', max_words: 400, overlap: 0 });
        expect(options.image_mode).toBe('describe_local');
    });

    test('sends no size parameter under `structure`, which range-checks unused fields', () => {
        const options = buildJobOptions(getDocParseConfig({
            ...LIVE,
            DOCPARSE_CHUNK_STRATEGY: 'structure'
        }));
        expect(options.chunk).toEqual({ strategy: 'structure' });
        expect(options.chunk.max_words).toBeUndefined();
    });

    test('character strategy caps characters rather than words', () => {
        const options = buildJobOptions(getDocParseConfig({
            ...LIVE,
            DOCPARSE_CHUNK_STRATEGY: 'character',
            DOCPARSE_CHUNK_MAX_WORDS: '2000'
        }));
        expect(options.chunk).toEqual({ strategy: 'character', max_characters: 2000, overlap: 0 });
    });

    test('the default word cap stays well inside the narrowest embedding window', () => {
        // ~1.3 tokens per English word, so 400 words is ~520 tokens.
        const { chunkMaxWords } = getDocParseConfig(LIVE);
        expect(Math.ceil(chunkMaxWords * 1.3)).toBeLessThan(2048);
    });
});
