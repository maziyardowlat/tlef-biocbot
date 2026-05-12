// @ts-check
const fs = require('fs');
const path = require('path');
const { fileURLToPath } = require('url');
const { addCoverageReport } = require('monocart-reporter');

const NODE_V8_COVERAGE_DIR = path.resolve(__dirname, '../../test-results/.v8-coverage');
const APP_ROOT = path.resolve(__dirname, '../..');
const SERVER_INFO_FILE = path.join(NODE_V8_COVERAGE_DIR, 'server-info.json');

function isAppServerEntry(entry) {
    if (!entry || !entry.url || !entry.url.startsWith('file:')) return false;

    let filePath;
    try {
        filePath = fileURLToPath(entry.url);
    } catch {
        return false;
    }

    const relative = path.relative(APP_ROOT, filePath).replace(/\\/g, '/');
    return (
        !relative.startsWith('..') &&
        !path.isAbsolute(relative) &&
        /^(src|public)\/.+\.(js|css)$/.test(relative) &&
        !relative.includes('/node_modules/')
    );
}

function readCoverageFiles() {
    if (!fs.existsSync(NODE_V8_COVERAGE_DIR)) return [];
    return fs.readdirSync(NODE_V8_COVERAGE_DIR)
        .filter((file) => file.endsWith('.json'));
}

async function flushServerCoverage() {
    if (!fs.existsSync(SERVER_INFO_FILE)) return;

    const serverInfo = JSON.parse(fs.readFileSync(SERVER_INFO_FILE, 'utf8'));
    if (serverInfo.runId !== process.env.BIOCBOT_COVERAGE_RUN_ID) return;

    const pid = Number(serverInfo.pid);
    if (!Number.isInteger(pid) || pid <= 0) return;

    const before = new Set(readCoverageFiles());
    try {
        process.kill(pid, 'SIGUSR2');
    } catch {
        return;
    }

    const startedAt = Date.now();
    while (Date.now() - startedAt < 5000) {
        await new Promise((resolve) => setTimeout(resolve, 100));
        const after = readCoverageFiles();
        if (after.some((file) => !before.has(file))) return;
    }
}

module.exports = async function globalTeardown(config) {
    if (process.env.MONOCART_COVERAGE === '0') return;
    await flushServerCoverage();
    if (!fs.existsSync(NODE_V8_COVERAGE_DIR)) return;

    const files = readCoverageFiles();

    for (const file of files) {
        const filePath = path.join(NODE_V8_COVERAGE_DIR, file);
        const raw = JSON.parse(fs.readFileSync(filePath, 'utf8'));
        const coverageList = (raw.result || []).filter(isAppServerEntry);

        for (const entry of coverageList) {
            const sourcePath = fileURLToPath(entry.url);
            if (fs.existsSync(sourcePath)) {
                entry.source = fs.readFileSync(sourcePath, 'utf8');
            }
        }

        if (coverageList.length) {
            const testInfo = /** @type {import('@playwright/test').TestInfo} */ (
                /** @type {unknown} */ ({ config })
            );
            await addCoverageReport(coverageList, testInfo);
        }
    }
};
