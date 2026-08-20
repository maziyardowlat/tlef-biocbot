#!/usr/bin/env node

/**
 * Draft new entries for the instructor-facing export change log.
 *
 * The curated file (src/data/export-change-log.json) is the source of truth and
 * is never written by this script. This only produces a draft for a human to
 * edit and paste in, so instructors never read unreviewed wording.
 *
 * Usage:
 *   node scripts/draft-export-change-log.js [options]
 *
 * Options:
 *   --since YYYY-MM-DD  Look at commits after this date (default: the newest entry's date)
 *   --out PATH          Write the draft to a file instead of stdout
 *   --no-llm            Print the commit digest only, without calling the LLM
 *   --help              Show this help
 */

require('dotenv').config();

const fs = require('fs');
const path = require('path');
const { execFileSync } = require('child_process');
const exportChangeLog = require('../src/services/exportChangeLog');

// Commits outside these paths cannot change what an export contains.
const EXPORT_RELEVANT_PATHS = [
    'public/student/scripts',
    'public/common/scripts/assessment-scoring.js',
    'public/instructor/scripts/downloads.js',
    'src/routes/students.js',
    'src/routes/superchats.js',
    'src/routes/chat.js',
    'src/services/exportChangeLog.js',
    'documentation/instructors'
];

function parseArgs(argv) {
    const options = { useLlm: true };
    for (let index = 0; index < argv.length; index++) {
        const arg = argv[index];
        if (arg === '--since') {
            options.since = argv[++index];
        } else if (arg === '--out') {
            options.out = argv[++index];
        } else if (arg === '--no-llm') {
            options.useLlm = false;
        } else if (arg === '--help' || arg === '-h') {
            options.help = true;
        } else {
            throw new Error(`Unknown option: ${arg}`);
        }
    }
    return options;
}

function printHelp() {
    console.log(`Usage: node scripts/draft-export-change-log.js [options]

Drafts change log entries from recent commits. The curated file is never
modified - review the draft and paste the entries you want into
src/data/export-change-log.json.

Options:
  --since YYYY-MM-DD  Look at commits after this date (default: newest entry's date)
  --out PATH          Write the draft to a file instead of stdout
  --no-llm            Print the commit digest only, without calling the LLM
  --help              Show this help`);
}

/**
 * Collect export-relevant commits since a date, with the files they touched.
 * @param {string} since - Start date (YYYY-MM-DD)
 * @returns {Array<Object>} Commits with hash, date, subject and files
 */
function collectCommits(since) {
    const separator = '<<<COMMIT>>>';
    const output = execFileSync('git', [
        'log',
        `--since=${since}`,
        '--no-merges',
        '--date=short',
        `--pretty=format:${separator}%h|%ad|%s`,
        '--name-only',
        '--',
        ...EXPORT_RELEVANT_PATHS
    ], { encoding: 'utf8', cwd: path.join(__dirname, '..') });

    return output
        .split(separator)
        .map(block => block.trim())
        .filter(Boolean)
        .map(block => {
            const [header, ...fileLines] = block.split('\n');
            const [hash, date, ...subjectParts] = header.split('|');
            return {
                hash,
                date,
                subject: subjectParts.join('|'),
                files: fileLines.map(line => line.trim()).filter(Boolean)
            };
        });
}

/**
 * Format the commits for the prompt (and for --no-llm review).
 * @param {Array<Object>} commits - Commits from collectCommits
 * @returns {string} Readable digest
 */
function formatDigest(commits) {
    return commits.map(commit => {
        const files = commit.files.slice(0, 12).join('\n    ');
        const more = commit.files.length > 12 ? `\n    ...and ${commit.files.length - 12} more files` : '';
        return `${commit.date} ${commit.hash} ${commit.subject}\n    ${files}${more}`;
    }).join('\n\n');
}

function buildPrompt(existingEntries, digest, since) {
    const existing = existingEntries
        .map(entry => `- ${entry.date} [${entry.id}] ${entry.title}`)
        .join('\n');

    return `You are drafting entries for a change log that instructors and admins read alongside
downloaded BiocBot student chat transcripts. It covers only changes that alter what a
downloaded chat contains, or how it should be read. Ignore anything else: infrastructure,
tests, styling, instructor-side features that do not appear in an export.

Entries already in the change log (do not repeat these):
${existing}

Commits touching export-relevant code since ${since}:
${digest}

Write a JSON array of draft entries for the changes not already covered. Use exactly this
shape, and nothing else in your reply:

[
  {
    "id": "kebab-case-id",
    "date": "YYYY-MM-DD",
    "area": "Short grouping, e.g. Session boundaries",
    "title": "One line, plain English, no jargon",
    "summary": "2-4 sentences on what changed and why it matters to someone reading a transcript",
    "exportImpact": "What a reader sees in exports taken after this change, naming the JSON fields involved",
    "beforeThisChange": "What to expect in exports of sessions from before this change",
    "references": ["commit abc1234", "Issue #123"]
  }
]

Rules:
- Write for an instructor, not a developer. No code, no file paths in the prose.
- Only state what the commits actually support. If a commit is unclear, leave it out.
- Return [] if nothing in the commits affects exports.`;
}

/**
 * Pull the JSON array out of an LLM reply that may include prose or fences.
 * @param {string} content - Raw LLM reply
 * @returns {Array|null} Parsed entries, or null when no array could be read
 */
function extractJsonArray(content) {
    const fenced = content.match(/```(?:json)?\s*([\s\S]*?)```/i);
    const candidate = fenced ? fenced[1] : content;
    const start = candidate.indexOf('[');
    const end = candidate.lastIndexOf(']');
    if (start === -1 || end === -1 || end < start) return null;
    try {
        return JSON.parse(candidate.slice(start, end + 1));
    } catch (error) {
        return null;
    }
}

async function main() {
    const options = parseArgs(process.argv.slice(2));
    if (options.help) {
        printHelp();
        return;
    }

    const changeLog = exportChangeLog.getChangeLog();
    const since = options.since || changeLog.entries[0].date;
    const commits = collectCommits(since);

    if (commits.length === 0) {
        console.log(`No export-relevant commits since ${since}. Nothing to draft.`);
        return;
    }

    const digest = formatDigest(commits);

    if (!options.useLlm) {
        console.log(`Export-relevant commits since ${since}:\n\n${digest}`);
        return;
    }

    const LLMService = require('../src/services/llm');
    let reply;
    try {
        const llm = await LLMService.create();
        reply = await llm.sendMessage(buildPrompt(changeLog.entries, digest, since), {
            systemPrompt: 'You write precise, plain-English release notes for university instructors. You reply with JSON only.',
            temperature: 0.1
        });
    } catch (error) {
        console.error(`Could not reach the LLM: ${error.message}`);
        console.error('Re-run with --no-llm to review the commit digest by hand.');
        process.exitCode = 1;
        return;
    }

    const entries = extractJsonArray(reply && reply.content ? reply.content : '');
    if (!entries) {
        console.error('The model did not return a JSON array. Raw reply:\n');
        console.error(reply && reply.content);
        process.exitCode = 1;
        return;
    }

    const draft = JSON.stringify(entries, null, 4);
    if (options.out) {
        fs.mkdirSync(path.dirname(options.out), { recursive: true });
        fs.writeFileSync(options.out, `${draft}\n`);
        console.log(`Wrote ${entries.length} draft entr${entries.length === 1 ? 'y' : 'ies'} to ${options.out}`);
    } else {
        console.log(draft);
    }

    console.error('\nReview and edit these, then paste the ones you want into src/data/export-change-log.json');
    console.error('and update its "lastUpdated" date. This script never edits that file itself.');
}

main().catch(error => {
    console.error(error.message);
    process.exitCode = 1;
});
