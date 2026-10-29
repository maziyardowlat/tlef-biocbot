// @ts-check
/// <reference types="node" />
const [major, minor, patch] = process.versions.node.split('.').map(Number);
const supported = major > 22 || (major === 22 && (minor > 23 || (minor === 23 && patch >= 4)));

if (!supported) {
    process.stderr.write(
        `Accessibility tests require Node.js >=22.23.4 (current: ${process.versions.node}).\n` +
        'Install Node 22.23.4 and run "nvm use" (which reads .nvmrc), then rerun "npm run test:a11y".\n'
    );
    process.exit(1);
}
