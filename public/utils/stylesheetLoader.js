/**
 * Fetches a CSS file and constructs a CSSStyleSheet object from it.
 * This is designed to be used with the Constructable Stylesheets API.
 * Using a top-level await with this function ensures that styles are
 * parsed and ready before a component that uses them is defined.
 *
 * @param {string} path - The path to the CSS file.
 * @returns {Promise<CSSStyleSheet>} A promise that resolves to a CSSStyleSheet.
 */
export async function loadStylesheet(path) {
    const sheet = new CSSStyleSheet();
    try {
        const response = await fetch(path);
        if (response.ok) {
            const css = await response.text();
            sheet.replaceSync(css);
        } else {
            console.error(`Failed to load stylesheet at ${path}: ${response.status} ${response.statusText}`);
        }
    } catch (e) {
        console.error(`Failed to load stylesheet at ${path}:`, e);
    }
    return sheet;
}