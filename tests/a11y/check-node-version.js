// @ts-check
/// <reference types="node" />
const major = Number(process.versions.node.split('.')[0]);
const supported = major >= 22;

if (!supported) {
    process.stderr.write(
        `Accessibility tests require Node.js >=22 (current: ${process.versions.node}).\n` +
        'Install Node 22 or later, then rerun "npm run test:a11y".\n'
    );
    process.exit(1);
}
