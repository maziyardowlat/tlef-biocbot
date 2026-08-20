/**
 * Export Change Log Service
 *
 * Serves the curated list of changes that affect what a downloaded student chat
 * contains, or how it should be read. The source of truth is a reviewed JSON
 * file (src/data/export-change-log.json) rather than anything generated at
 * request time, so instructors only ever see wording a human has approved.
 * scripts/draft-export-change-log.js drafts new entries from recent commits for
 * that review.
 *
 * The downloadable Markdown appends the instructor export guide
 * (documentation/instructors/interpreting-chat-exports.md) so the file works as
 * a single self-contained document.
 */

const fs = require('fs');
const path = require('path');

const CHANGE_LOG_PATH = path.join(__dirname, '..', 'data', 'export-change-log.json');
const GUIDE_PATH = path.join(__dirname, '..', '..', 'documentation', 'instructors', 'interpreting-chat-exports.md');

// Cache the parsed file and re-read only when it changes on disk, so editing
// the change log does not require a restart.
let cachedChangeLog = null;
let cachedMtimeMs = null;

/**
 * Read, parse and validate the curated change log.
 * @returns {Object} The change log document
 * @throws {Error} When the file is missing or structurally invalid
 */
function loadChangeLog() {
    let stats;
    try {
        stats = fs.statSync(CHANGE_LOG_PATH);
    } catch (error) {
        throw new Error(`Export change log file is missing: ${CHANGE_LOG_PATH}`);
    }

    if (cachedChangeLog && cachedMtimeMs === stats.mtimeMs) {
        return cachedChangeLog;
    }

    let parsed;
    try {
        parsed = JSON.parse(fs.readFileSync(CHANGE_LOG_PATH, 'utf8'));
    } catch (error) {
        throw new Error(`Export change log file is not valid JSON: ${error.message}`);
    }

    validateChangeLog(parsed);

    cachedChangeLog = parsed;
    cachedMtimeMs = stats.mtimeMs;
    return parsed;
}

/**
 * Fail loudly on a malformed change log rather than shipping a half-empty
 * document to instructors.
 * @param {Object} changeLog - Parsed change log document
 */
function validateChangeLog(changeLog) {
    if (!changeLog || typeof changeLog !== 'object' || Array.isArray(changeLog)) {
        throw new Error('Export change log must be an object');
    }
    if (typeof changeLog.title !== 'string' || !changeLog.title.trim()) {
        throw new Error('Export change log requires a title');
    }
    if (!Array.isArray(changeLog.entries) || changeLog.entries.length === 0) {
        throw new Error('Export change log requires at least one entry');
    }

    const seenIds = new Set();
    changeLog.entries.forEach((entry, index) => {
        if (!entry || typeof entry !== 'object') {
            throw new Error(`Export change log entry ${index} must be an object`);
        }
        ['id', 'date', 'title', 'summary'].forEach(field => {
            if (typeof entry[field] !== 'string' || !entry[field].trim()) {
                throw new Error(`Export change log entry ${index} is missing "${field}"`);
            }
        });
        if (!/^\d{4}-\d{2}-\d{2}$/.test(entry.date)) {
            throw new Error(`Export change log entry "${entry.id}" needs a YYYY-MM-DD date`);
        }
        if (seenIds.has(entry.id)) {
            throw new Error(`Export change log has duplicate entry id "${entry.id}"`);
        }
        seenIds.add(entry.id);
    });
}

/**
 * Entries newest first, so the modal and the Markdown always agree on order
 * regardless of how the file happens to be sorted.
 * @param {Array} entries - Change log entries
 * @returns {Array} Sorted copy
 */
function sortEntries(entries) {
    return entries.slice().sort((a, b) => b.date.localeCompare(a.date));
}

/**
 * Get the change log for API responses.
 * @returns {Object} Change log with entries sorted newest first
 */
function getChangeLog() {
    const changeLog = loadChangeLog();
    return { ...changeLog, entries: sortEntries(changeLog.entries) };
}

/**
 * Read the instructor export guide that is appended to the download.
 * @returns {string|null} Guide Markdown, or null when it is unavailable
 */
function readGuide() {
    try {
        return fs.readFileSync(GUIDE_PATH, 'utf8');
    } catch (error) {
        console.warn('Export guide could not be read, continuing without the appendix:', error.message);
        return null;
    }
}

/**
 * Push the guide's headings one level down so it reads as an appendix of the
 * combined document instead of competing with its title. Fenced code blocks are
 * left alone.
 * @param {string} markdown - Guide Markdown
 * @returns {string} Guide Markdown with demoted headings
 */
function demoteHeadings(markdown) {
    let insideFence = false;
    return markdown.split('\n').map(line => {
        if (/^\s*```/.test(line)) {
            insideFence = !insideFence;
            return line;
        }
        if (insideFence) return line;
        return /^#{1,5} /.test(line) ? `#${line}` : line;
    }).join('\n');
}

/**
 * Render one entry as Markdown.
 * @param {Object} entry - Change log entry
 * @returns {string} Markdown block
 */
function renderEntry(entry) {
    const lines = [`### ${entry.date} — ${entry.title}`, ''];
    if (entry.area) lines.push(`**Area:** ${entry.area}`, '');
    lines.push(entry.summary, '');
    if (entry.exportImpact) lines.push(`**What you see in exports now:** ${entry.exportImpact}`, '');
    if (entry.beforeThisChange) lines.push(`**In exports of earlier sessions:** ${entry.beforeThisChange}`, '');
    if (Array.isArray(entry.references) && entry.references.length > 0) {
        lines.push(`**Reference:** ${entry.references.join(', ')}`, '');
    }
    return lines.join('\n');
}

/**
 * Render the downloadable Markdown document.
 * @param {Object} [options] - Rendering options
 * @param {boolean} [options.includeGuide=true] - Append the export guide
 * @returns {string} Markdown document
 */
function renderMarkdown(options = {}) {
    const { includeGuide = true } = options;
    const changeLog = getChangeLog();

    const sections = [`# ${changeLog.title}`, ''];
    if (changeLog.subtitle) sections.push(`_${changeLog.subtitle}_`, '');
    if (changeLog.lastUpdated) sections.push(`Last updated: ${changeLog.lastUpdated}`, '');
    if (Array.isArray(changeLog.intro)) {
        changeLog.intro.forEach(paragraph => sections.push(paragraph, ''));
    }

    sections.push('---', '', '## Changes', '');
    changeLog.entries.forEach(entry => sections.push(renderEntry(entry)));

    if (includeGuide) {
        const guide = readGuide();
        if (guide) {
            sections.push('---', '', '## Appendix: Interpreting the JSON Chat Export', '');
            sections.push(demoteHeadings(guide).trim(), '');
        }
    }

    return `${sections.join('\n').trim()}\n`;
}

/**
 * File name used for the download.
 * @returns {string} Markdown file name
 */
function buildFileName() {
    const changeLog = getChangeLog();
    const stamp = changeLog.lastUpdated || new Date().toISOString().slice(0, 10);
    return `biocbot-chat-export-change-log-${stamp}.md`;
}

module.exports = {
    getChangeLog,
    renderMarkdown,
    buildFileName,
    CHANGE_LOG_PATH,
    GUIDE_PATH,
    // Exported for tests
    demoteHeadings,
    validateChangeLog
};
