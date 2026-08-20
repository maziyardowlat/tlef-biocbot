/**
 * Rich text rendering for AI-generated study content.
 *
 * Two independent mechanisms, ported from GRASP's RichText component:
 *
 *   1. KaTeX renders formulas — inline math and simple chemical notation
 *      written as \( H_2O \), \[ ... \], or \ce{...} via the mhchem extension.
 *   2. smiles-drawer renders molecules — a SMILES string wrapped in
 *      [SMILES]...[/SMILES] becomes a drawn 2D structure.
 *
 * Where this deliberately differs from GRASP: GRASP hands the parser's output
 * to dangerouslySetInnerHTML, so model output reaches the DOM as raw HTML.
 * Here every non-tag character is escaped before it is inserted, and the SMILES
 * payload only ever lands in an attribute value. Model output therefore stays
 * inert text, exactly as it was when these fields used textContent.
 *
 * Load order on a page: katex.min.js, mhchem.min.js, auto-render.min.js,
 * smiles-drawer.min.js, then this file. Every library is optional at runtime —
 * if one is missing the text still renders, just without typesetting.
 *
 * Usage:
 *   RichText.render(element, card.front);
 *
 * @module rich-text
 */

(function (global) {
    'use strict';

    // [SMILES]...[/SMILES], non-greedy so several tags in one string each match.
    const SMILES_TAG_PATTERN = /\[SMILES\]([\s\S]*?)\[\/SMILES\]/g;

    // A structure is drawn at this backing-store size and then scaled down by
    // CSS on narrow screens, which keeps the drawing crisp on high-DPI displays.
    const SMILES_CANVAS_WIDTH = 320;
    const SMILES_CANVAS_HEIGHT = 240;

    // \( \) and \[ \] come first: they are what the generation prompts ask for.
    // The dollar forms are kept for parity with GRASP, which accepts both.
    const KATEX_DELIMITERS = [
        { left: '\\(', right: '\\)', display: false },
        { left: '\\[', right: '\\]', display: true },
        { left: '$$', right: '$$', display: true },
        { left: '$', right: '$', display: false }
    ];

    const HTML_ESCAPES = {
        '&': '&amp;',
        '<': '&lt;',
        '>': '&gt;',
        '"': '&quot;',
        "'": '&#39;'
    };

    /**
     * Escape a string for insertion into HTML, as text or as an attribute value.
     *
     * String-based rather than the usual createElement/textContent trick so the
     * parsing half of this module stays pure and testable without a DOM.
     *
     * @param {string} value Untrusted text
     * @returns {string} HTML-safe text
     */
    function escapeHtml(value) {
        return String(value === null || value === undefined ? '' : value)
            .replace(/[&<>"']/g, character => HTML_ESCAPES[character]);
    }

    /**
     * Replace every [SMILES]...[/SMILES] tag with a canvas placeholder and
     * escape everything around it.
     *
     * The SMILES payload is carried in data-smiles rather than in the document
     * text, so renderSmilesIn can read it back verbatim.
     *
     * @param {string} text Raw model output
     * @returns {string} HTML safe to assign to innerHTML
     */
    function parseSmilesTags(text) {
        const source = String(text === null || text === undefined ? '' : text);
        let result = '';
        let lastIndex = 0;

        SMILES_TAG_PATTERN.lastIndex = 0;
        let match = SMILES_TAG_PATTERN.exec(source);
        while (match !== null) {
            result += escapeHtml(source.slice(lastIndex, match.index));

            const smiles = match[1].trim();
            if (smiles) {
                result += '<canvas class="rich-smiles" role="img"'
                    + ` width="${SMILES_CANVAS_WIDTH}" height="${SMILES_CANVAS_HEIGHT}"`
                    + ` data-smiles="${escapeHtml(smiles)}"`
                    + ` aria-label="Chemical structure for SMILES ${escapeHtml(smiles)}"></canvas>`;
            }

            lastIndex = match.index + match[0].length;
            match = SMILES_TAG_PATTERN.exec(source);
        }

        result += escapeHtml(source.slice(lastIndex));
        return result;
    }

    /**
     * Report an unusable SMILES string on the canvas itself.
     *
     * A bad structure must not cost the student the rest of the card, so the
     * failure is drawn in place and the surrounding text is left untouched.
     *
     * @param {HTMLCanvasElement} canvas Canvas that failed to draw
     * @returns {void}
     */
    function drawSmilesError(canvas) {
        canvas.classList.add('rich-smiles-error');
        canvas.setAttribute('aria-label', 'Chemical structure could not be drawn');
        try {
            const context = canvas.getContext('2d');
            if (!context) return;
            context.clearRect(0, 0, canvas.width, canvas.height);
            context.fillStyle = '#b91c1c';
            context.font = '14px system-ui, sans-serif';
            context.textAlign = 'center';
            context.textBaseline = 'middle';
            context.fillText('SMILES Error', canvas.width / 2, canvas.height / 2);
        } catch (error) {
            // A canvas with no 2d context (very old or headless environments)
            // still carries the error class and label, which is enough.
        }
    }

    /**
     * Draw every not-yet-drawn SMILES canvas inside a container.
     *
     * @param {Element} root Container holding canvas[data-smiles] elements
     * @returns {void}
     */
    function renderSmilesIn(root) {
        if (!root || typeof root.querySelectorAll !== 'function') return;

        const canvases = root.querySelectorAll('canvas[data-smiles]:not([data-smiles-drawn])');
        canvases.forEach(canvas => {
            // Marked before drawing so a re-render never redraws the same
            // canvas, and so a thrown error does not leave it queued forever.
            canvas.setAttribute('data-smiles-drawn', 'true');

            const smiles = canvas.getAttribute('data-smiles') || '';
            const library = global.SmilesDrawer;
            if (!library || typeof library.parse !== 'function') {
                drawSmilesError(canvas);
                return;
            }

            try {
                const drawer = new library.Drawer({
                    width: canvas.width,
                    height: canvas.height,
                    compactDrawing: false,
                    terminalCarbons: true
                });
                library.parse(
                    smiles,
                    tree => {
                        try {
                            drawer.draw(tree, canvas, 'light', false);
                        } catch (error) {
                            drawSmilesError(canvas);
                        }
                    },
                    () => drawSmilesError(canvas)
                );
            } catch (error) {
                drawSmilesError(canvas);
            }
        });
    }

    /**
     * Typeset the math delimiters inside a container.
     *
     * @param {Element} root Container whose text may contain math
     * @returns {void}
     */
    function renderKatexIn(root) {
        if (!root || typeof global.renderMathInElement !== 'function') return;
        try {
            global.renderMathInElement(root, {
                delimiters: KATEX_DELIMITERS,
                // Malformed math is shown as its own source in red instead of
                // aborting the render and blanking the card.
                throwOnError: false,
                // Never let model output reach \htmlData, \href, and friends.
                trust: false,
                ignoredTags: ['script', 'noscript', 'style', 'textarea', 'pre', 'code', 'option']
            });
        } catch (error) {
            // Leave the escaped source visible rather than losing the content.
        }
    }

    /**
     * Render model-authored text into an element: molecules drawn, math
     * typeset, everything else inserted as inert escaped text.
     *
     * @param {Element} element Target element, emptied first
     * @param {string} text Raw model output
     * @returns {Element} The same element, for chaining
     */
    function render(element, text) {
        if (!element) return element;
        element.innerHTML = parseSmilesTags(text);
        renderSmilesIn(element);
        renderKatexIn(element);
        return element;
    }

    global.RichText = {
        escapeHtml,
        parseSmilesTags,
        renderSmilesIn,
        renderKatexIn,
        render
    };

    if (typeof module !== 'undefined' && module.exports) {
        module.exports = global.RichText;
    }
})(typeof window !== 'undefined' ? window : globalThis);
