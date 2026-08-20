/**
 * Tests for src/services/exportChangeLog.js.
 *
 * The change log is instructor-facing prose shipped from a hand-edited JSON
 * file, so the value here is in the guarantees the app makes about that file:
 * it is validated rather than half-rendered, entries always reach the reader
 * newest first, and the download stays a single self-contained document with
 * the export guide appended below the change log.
 */
const fs = require('fs');
const exportChangeLog = require('../../../src/services/exportChangeLog');

beforeAll(() => {
    jest.spyOn(console, 'warn').mockImplementation(() => {});
});
afterAll(() => jest.restoreAllMocks());

describe('getChangeLog', () => {
    test('returns the curated entries newest first', () => {
        const changeLog = exportChangeLog.getChangeLog();

        expect(changeLog.title).toBeTruthy();
        expect(changeLog.entries.length).toBeGreaterThan(0);

        const dates = changeLog.entries.map(entry => entry.date);
        expect(dates).toEqual([...dates].sort((a, b) => b.localeCompare(a)));
    });

    test('every shipped entry carries the fields the UI renders', () => {
        exportChangeLog.getChangeLog().entries.forEach(entry => {
            expect(typeof entry.id).toBe('string');
            expect(entry.date).toMatch(/^\d{4}-\d{2}-\d{2}$/);
            expect(entry.title.length).toBeGreaterThan(0);
            expect(entry.summary.length).toBeGreaterThan(0);
        });
    });
});

describe('validateChangeLog', () => {
    const validEntry = {
        id: 'entry-one',
        date: '2026-07-14',
        title: 'A change',
        summary: 'What happened.'
    };

    test('accepts a well-formed document', () => {
        expect(() => exportChangeLog.validateChangeLog({
            title: 'Change Log',
            entries: [validEntry]
        })).not.toThrow();
    });

    test('rejects a document with no entries', () => {
        expect(() => exportChangeLog.validateChangeLog({ title: 'Change Log', entries: [] }))
            .toThrow(/at least one entry/);
    });

    test('rejects an entry missing a required field', () => {
        expect(() => exportChangeLog.validateChangeLog({
            title: 'Change Log',
            entries: [{ ...validEntry, summary: '   ' }]
        })).toThrow(/missing "summary"/);
    });

    test('rejects a malformed date', () => {
        expect(() => exportChangeLog.validateChangeLog({
            title: 'Change Log',
            entries: [{ ...validEntry, date: 'July 2026' }]
        })).toThrow(/YYYY-MM-DD/);
    });

    test('rejects duplicate entry ids', () => {
        expect(() => exportChangeLog.validateChangeLog({
            title: 'Change Log',
            entries: [validEntry, { ...validEntry, date: '2026-07-15' }]
        })).toThrow(/duplicate entry id/);
    });
});

describe('renderMarkdown', () => {
    test('renders the change log above the appended export guide', () => {
        const markdown = exportChangeLog.renderMarkdown();
        const changeLog = exportChangeLog.getChangeLog();

        expect(markdown.startsWith(`# ${changeLog.title}`)).toBe(true);
        expect(markdown).toContain('## Changes');
        expect(markdown).toContain('## Appendix: Interpreting the JSON Chat Export');
        expect(markdown.indexOf('## Changes')).toBeLessThan(markdown.indexOf('## Appendix'));
        expect(markdown.match(/Interpreting the JSON Chat Export/g)).toHaveLength(1);

        const newest = changeLog.entries[0];
        expect(markdown).toContain(`### ${newest.date} — ${newest.title}`);
    });

    test('omits the appendix when asked for the change log alone', () => {
        const markdown = exportChangeLog.renderMarkdown({ includeGuide: false });
        expect(markdown).toContain('## Changes');
        expect(markdown).not.toContain('## Appendix');
    });

    test('still renders the change log when the guide cannot be read', () => {
        const readFileSync = jest.spyOn(fs, 'readFileSync').mockImplementation((filePath, ...rest) => {
            if (String(filePath).endsWith('interpreting-chat-exports.md')) {
                throw new Error('ENOENT');
            }
            return jest.requireActual('fs').readFileSync(filePath, ...rest);
        });

        try {
            const markdown = exportChangeLog.renderMarkdown();
            expect(markdown).toContain('## Changes');
            expect(markdown).not.toContain('## Appendix');
        } finally {
            readFileSync.mockRestore();
        }
    });
});

describe('demoteHeadings', () => {
    test('pushes headings down one level so the guide reads as an appendix', () => {
        const demoted = exportChangeLog.demoteHeadings('# Title\n\n## Section\n\ntext\n');
        expect(demoted).toContain('## Title');
        expect(demoted).toContain('### Section');
    });

    test('leaves comment lines inside fenced code blocks alone', () => {
        const demoted = exportChangeLog.demoteHeadings('```\n# not a heading\n```\n# heading\n');
        expect(demoted).toContain('\n# not a heading\n');
        expect(demoted).toContain('## heading');
    });
});

describe('formatGuideAppendix', () => {
    test('removes the standalone title and demotes the remaining headings', () => {
        const appendix = exportChangeLog.formatGuideAppendix(
            '# Guide title\n\nIntroduction.\n\n## Section\n\nText.\n'
        );

        expect(appendix).not.toContain('Guide title');
        expect(appendix).toContain('Introduction.');
        expect(appendix).toContain('### Section');
    });
});

describe('buildFileName', () => {
    test('stamps the file name with the change log date', () => {
        const { lastUpdated } = exportChangeLog.getChangeLog();
        expect(exportChangeLog.buildFileName()).toBe(`biocbot-chat-export-change-log-${lastUpdated}.md`);
    });
});
