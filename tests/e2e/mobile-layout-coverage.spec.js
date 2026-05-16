// @ts-check
/**
 * Focused browser coverage for public/common/scripts/mobile-layout.js.
 *
 * The script wires the mobile sidebar collapse toggle that is loaded only by
 * the student pages. Each test uses a compact harness page (served via
 * `page.route`) so we exercise the production script in isolation — there is
 * no dependency on auth, course state, or any other shared fixture.
 */

const { test, expect } = require('./fixtures/monocart');

const harnessPath = '/__coverage-mobile-layout';

/**
 * @typedef {import('@playwright/test').Page} Page
 */

/**
 * @param {Page} page
 * @param {{ includeLogoContainer?: boolean, bodyClass?: string, extraMarkup?: string }} [options]
 */
async function installHarness(page, options = {}) {
    const {
        includeLogoContainer = true,
        bodyClass = '',
        extraMarkup = '',
    } = options;
    await page.route(`**${harnessPath}**`, (route) => route.fulfill({
        contentType: 'text/html',
        body: `<!doctype html>
            <html lang="en">
            <head><title>Mobile Layout Harness</title></head>
            <body class="${bodyClass}">
                ${includeLogoContainer
                    ? '<div class="logo-container"><h2>BiocBot</h2></div>'
                    : '<div class="not-the-logo"><h2>BiocBot</h2></div>'}
                ${extraMarkup}
                <script src="/common/scripts/mobile-layout.js"></script>
            </body>
            </html>`,
    }));
}

test.describe('mobile-layout.js focused browser coverage', () => {
    test('appends a single toggle button inside .logo-container with the initial collapse icon', async ({ page }) => {
        await installHarness(page);
        await page.goto(harnessPath);

        const toggle = page.locator('.logo-container > .mobile-header-toggle');
        await expect(toggle).toHaveCount(1);
        await expect(toggle).toHaveAttribute('title', 'Toggle Header');
        await expect(toggle.locator('.toggle-icon')).toHaveText('▲');
        await expect.poll(() => page.evaluate(() => document.body.classList.contains('mobile-collapsed'))).toBe(false);
    });

    test('toggles the mobile-collapsed class and swaps the icon on each click', async ({ page }) => {
        await installHarness(page);
        await page.goto(harnessPath);

        const toggle = page.locator('.mobile-header-toggle');
        const icon = toggle.locator('.toggle-icon');

        await toggle.click();
        await expect.poll(() => page.evaluate(() => document.body.classList.contains('mobile-collapsed'))).toBe(true);
        await expect(icon).toHaveText('▼');

        await toggle.click();
        await expect.poll(() => page.evaluate(() => document.body.classList.contains('mobile-collapsed'))).toBe(false);
        await expect(icon).toHaveText('▲');

        await toggle.click();
        await expect.poll(() => page.evaluate(() => document.body.classList.contains('mobile-collapsed'))).toBe(true);
        await expect(icon).toHaveText('▼');
    });

    test('stops click propagation so logo-container click listeners do not fire', async ({ page }) => {
        await installHarness(page);
        await page.goto(harnessPath);

        await page.evaluate(() => {
            const testWindow = /** @type {any} */ (window);
            testWindow.__logoContainerClicks = 0;
            const container = document.querySelector('.logo-container');
            if (container) {
                container.addEventListener('click', () => {
                    testWindow.__logoContainerClicks += 1;
                });
            }
        });

        await page.locator('.mobile-header-toggle').click();
        await page.locator('.mobile-header-toggle').click();

        const bubbled = await page.evaluate(() => /** @type {any} */ (window).__logoContainerClicks);
        expect(bubbled).toBe(0);
        await expect.poll(() => page.evaluate(() => document.body.classList.contains('mobile-collapsed'))).toBe(false);
    });

    test('does nothing and throws no errors when the page has no .logo-container', async ({ page }) => {
        /** @type {string[]} */
        const pageErrors = [];
        page.on('pageerror', (err) => pageErrors.push(err.message));

        await installHarness(page, { includeLogoContainer: false });
        await page.goto(harnessPath);
        await page.waitForLoadState('domcontentloaded');
        await page.waitForFunction(() => document.readyState === 'complete');

        await expect(page.locator('.mobile-header-toggle')).toHaveCount(0);
        await expect(page.locator('.toggle-icon')).toHaveCount(0);
        expect(pageErrors).toEqual([]);
    });

    test('PRODUCT BUG: initial icon ignores body already in mobile-collapsed state', async ({ page }) => {
        // The file comments document an intent to persist the collapsed state
        // ("Save preference?" / "Check saved preference? (Optional, maybe later)").
        // If something else (a future persistence shim, a server-rendered class,
        // or another script) marks the body as `mobile-collapsed` before init,
        // initMobileLayout still hardcodes the icon to ▲ (the "click to collapse"
        // arrow). The icon then disagrees with the actual UI state until the
        // user clicks once. A consistent initial render should pick ▼ when the
        // body already has `mobile-collapsed`.
        await installHarness(page, { bodyClass: 'mobile-collapsed' });
        await page.goto(harnessPath);

        const icon = page.locator('.mobile-header-toggle .toggle-icon');
        await expect(icon).toHaveCount(1);
        await expect(icon).toHaveText('▼');
    });
});
