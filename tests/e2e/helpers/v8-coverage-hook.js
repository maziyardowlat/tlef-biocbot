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

    process.on('SIGUSR2', flushCoverage);

    for (const signal of ['SIGINT', 'SIGTERM']) {
        process.once(signal, () => {
            flushCoverage();
            process.exit(0);
        });
    }

    process.once('beforeExit', flushCoverage);
}
