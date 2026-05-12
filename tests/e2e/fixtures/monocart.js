// @ts-check
const base = require('@playwright/test');
const { addCoverageReport } = require('monocart-reporter');

const monocartFixtures = /** @type {any} */ ({
    monocartCoverage: [async ({ page }, use, testInfo) => {
        const isChromium = testInfo.project.name === 'chromium';
        const coverageEnabled = process.env.MONOCART_COVERAGE !== '0';
        let started = false;

        if (coverageEnabled && isChromium && page.coverage) {
            try {
                await Promise.all([
                    page.coverage.startJSCoverage({ resetOnNavigation: false }),
                    page.coverage.startCSSCoverage({ resetOnNavigation: false }),
                ]);
                started = true;
            } catch (error) {
                await testInfo.attach('monocart-browser-coverage-start-error', {
                    body: Buffer.from(error && error.stack ? error.stack : String(error)),
                    contentType: 'text/plain',
                });
            }
        }

        await use();

        if (!started) return;

        try {
            const [jsCoverage, cssCoverage] = await Promise.all([
                page.coverage.stopJSCoverage(),
                page.coverage.stopCSSCoverage(),
            ]);
            const coverageList = [...jsCoverage, ...cssCoverage];
            if (coverageList.length) {
                await addCoverageReport(coverageList, testInfo);
            }
        } catch (error) {
            await testInfo.attach('monocart-browser-coverage-stop-error', {
                body: Buffer.from(error && error.stack ? error.stack : String(error)),
                contentType: 'text/plain',
            });
        }
    }, { scope: 'test', auto: true }],
});

const test = base.test.extend(monocartFixtures);

module.exports = {
    ...base,
    test,
};
