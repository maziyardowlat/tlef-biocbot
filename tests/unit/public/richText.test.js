/**
 * Unit tests for the browser rich-text helper.
 *
 * Only the parsing half is exercised here: it is pure string work, so it runs
 * in Jest's node environment. Actual typesetting and molecule drawing need a
 * real browser and are covered by tests/e2e/rich-text-rendering.spec.js.
 */

const RichText = require('../../../public/common/scripts/rich-text');

describe('RichText.escapeHtml', () => {
    test('escapes every character that could start markup', () => {
        expect(RichText.escapeHtml('<img src=x onerror="alert(1)">'))
            .toBe('&lt;img src=x onerror=&quot;alert(1)&quot;&gt;');
        expect(RichText.escapeHtml("it's & so")).toBe('it&#39;s &amp; so');
    });

    test('null and undefined become an empty string', () => {
        expect(RichText.escapeHtml(null)).toBe('');
        expect(RichText.escapeHtml(undefined)).toBe('');
    });
});

describe('RichText.parseSmilesTags', () => {
    test('replaces a SMILES tag with a canvas carrying the string', () => {
        const html = RichText.parseSmilesTags('Benzene: [SMILES]C1=CC=CC=C1[/SMILES]');
        expect(html).toContain('Benzene: ');
        expect(html).toContain('<canvas class="rich-smiles"');
        expect(html).toContain('data-smiles="C1=CC=CC=C1"');
        expect(html).not.toContain('[SMILES]');
    });

    test('handles several tags in one string', () => {
        const html = RichText.parseSmilesTags('[SMILES]CCO[/SMILES] vs [SMILES]CC(=O)O[/SMILES]');
        expect(html.match(/<canvas/g)).toHaveLength(2);
        expect(html).toContain('data-smiles="CCO"');
        expect(html).toContain('data-smiles="CC(=O)O"');
        expect(html).toContain(' vs ');
    });

    test('leaves math delimiters untouched for KaTeX to pick up', () => {
        expect(RichText.parseSmilesTags('Water is \\( H_2O \\)')).toBe('Water is \\( H_2O \\)');
    });

    test('escapes markup in the surrounding text', () => {
        const html = RichText.parseSmilesTags('<script>alert(1)</script>[SMILES]CCO[/SMILES]');
        expect(html).toContain('&lt;script&gt;alert(1)&lt;/script&gt;');
        expect(html).not.toContain('<script>');
    });

    test('escapes a SMILES payload that tries to break out of the attribute', () => {
        const html = RichText.parseSmilesTags('[SMILES]CC" onload="alert(1)[/SMILES]');
        expect(html).not.toContain('onload="alert(1)"');
        expect(html).toContain('&quot; onload=&quot;alert(1)');
    });

    test('an empty tag body produces no canvas', () => {
        expect(RichText.parseSmilesTags('before [SMILES]   [/SMILES] after'))
            .toBe('before  after');
    });

    test('an unclosed tag stays visible as escaped text', () => {
        const html = RichText.parseSmilesTags('[SMILES]CCO but never closed');
        expect(html).toBe('[SMILES]CCO but never closed');
        expect(html).not.toContain('<canvas');
    });

    test('trims whitespace around the SMILES string', () => {
        expect(RichText.parseSmilesTags('[SMILES] CCO [/SMILES]')).toContain('data-smiles="CCO"');
    });

    test('empty input yields an empty string', () => {
        expect(RichText.parseSmilesTags('')).toBe('');
        expect(RichText.parseSmilesTags(null)).toBe('');
    });

    test('repeated calls are independent of the shared regex cursor', () => {
        const first = RichText.parseSmilesTags('[SMILES]CCO[/SMILES]');
        const second = RichText.parseSmilesTags('[SMILES]CCO[/SMILES]');
        expect(second).toBe(first);
    });
});

describe('RichText renderers without a DOM or libraries', () => {
    test('renderSmilesIn ignores a missing or non-element root', () => {
        expect(() => RichText.renderSmilesIn(null)).not.toThrow();
        expect(() => RichText.renderSmilesIn({})).not.toThrow();
    });

    test('renderKatexIn is a no-op when KaTeX auto-render is absent', () => {
        expect(() => RichText.renderKatexIn({ querySelectorAll: () => [] })).not.toThrow();
    });

    test('render returns a falsy element untouched', () => {
        expect(RichText.render(null, 'text')).toBeNull();
    });
});
