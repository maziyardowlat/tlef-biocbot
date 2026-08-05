// @ts-check
/**
 * Keeps the first-time agreement modal out of the way of specs that are not
 * about the agreement itself.
 *
 * agreement-modal.js auto-shows a blocking, non-dismissible overlay on every
 * /student/ page when the server reports the user has not agreed, and that
 * overlay swallows pointer events. Any spec that clicks or types on one of
 * those pages has to pin the status first.
 *
 * The stored agreement is shared across workers — and specs that exercise the
 * modal delete the row in afterEach — so stub the response instead of seeding.
 */

/**
 * Make the agreement status endpoint report an already-agreed user.
 * Call before page.goto().
 * @param {import('@playwright/test').Page} page
 */
async function stubAgreementAccepted(page) {
    await page.route('**/api/user-agreement/status', (route) => route.fulfill({
        status: 200,
        contentType: 'application/json',
        // Shape has to match the real route. A flat hasAgreed makes the modal's
        // status check throw, and it falls back to showing the dialog.
        body: JSON.stringify({
            success: true,
            data: { hasAgreed: true, agreementVersion: '1.0', agreedAt: null },
        }),
    }));
}

module.exports = { stubAgreementAccepted };
