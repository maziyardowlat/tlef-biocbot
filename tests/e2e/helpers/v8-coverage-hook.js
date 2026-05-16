// @ts-check
const fs = require('fs');
const path = require('path');
const v8 = require('v8');

const coverageDir = process.env.NODE_V8_COVERAGE && path.resolve(process.env.NODE_V8_COVERAGE);
const serverInfoFile = coverageDir && path.join(coverageDir, 'server-info.json');
const runId = process.env.BIOCBOT_COVERAGE_RUN_ID || '';

function flushCoverage() {
    if (!coverageDir) return;
    try {
        v8.takeCoverage();
    } catch {
        // Coverage reporting must never change server behavior under test.
    }
}

if (coverageDir && serverInfoFile) {
    fs.mkdirSync(coverageDir, { recursive: true });
    fs.writeFileSync(serverInfoFile, JSON.stringify({
        pid: process.pid,
        runId,
        startedAt: new Date().toISOString(),
    }, null, 2));
    // Visible at server boot so it's obvious when instrumentation is active.
    console.log(`[v8-coverage] enabled — pid=${process.pid} dir=${coverageDir}`);

    process.on('SIGUSR2', flushCoverage);
    // Do NOT install SIGINT/SIGTERM handlers that call process.exit(0):
    // that path skips Node's built-in NODE_V8_COVERAGE auto-dump on exit.
    // Letting the default signal behavior run preserves the dump.
}
