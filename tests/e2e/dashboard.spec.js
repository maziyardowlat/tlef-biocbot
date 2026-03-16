// @ts-check
require('dotenv').config();
const { test, expect } = require('@playwright/test');

/**
 * Student dashboard (topic performance) tests.
 * Expects the app to be running on localhost:8085 (npm run dev).
 */

// ── Helpers ──────────────────────────────────────────────────────────────────

async function loginAsStudent(page) {
  await page.goto('/login');
  await page.fill('#username', process.env.student_username);
  await page.fill('#password', process.env.student_password);
  await page.click('#login-btn');
  await page.waitForURL('**/student**', { timeout: 10000 });
}

// ── Dashboard UI tests ───────────────────────────────────────────────────────

test.describe('Student dashboard page', () => {
  test.beforeEach(async ({ page }) => {
    await loginAsStudent(page);
    await page.goto('/student/dashboard.html');
    await page.waitForLoadState('networkidle');
  });

  test('dashboard page loads with correct heading', async ({ page }) => {
    await expect(page.locator('h1')).toHaveText('Topic Dashboard');
  });

  test('has summary cards section', async ({ page }) => {
    const activeTopics = page.locator('#active-topics-count');
    const directiveStatus = page.locator('#directive-mode-status');

    await expect(activeTopics).toBeAttached();
    await expect(directiveStatus).toBeAttached();
  });

  test('has topics list container', async ({ page }) => {
    const container = page.locator('#topics-list-container');
    await expect(container).toBeAttached();
  });

  test('has reset all button', async ({ page }) => {
    const resetBtn = page.locator('#reset-all-btn');
    await expect(resetBtn).toBeAttached();
  });

  test('has confirmation modal in the DOM', async ({ page }) => {
    const modal = page.locator('#confirm-modal');
    await expect(modal).toBeAttached();

    // Modal should not be visible initially
    await expect(modal).not.toBeVisible();
  });

  test('sidebar navigation links are correct', async ({ page }) => {
    await expect(page.locator('nav.main-nav a[href="/student"]')).toBeVisible();
    await expect(page.locator('nav.main-nav a[href="/student/history"]')).toBeVisible();
    await expect(page.locator('nav.main-nav a[href="/student/dashboard.html"]')).toBeVisible();
  });
});
