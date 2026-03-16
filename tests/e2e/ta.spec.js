// @ts-check
require('dotenv').config();
const { test, expect } = require('@playwright/test');

/**
 * TA feature tests — home, settings, onboarding pages.
 * Expects the app to be running on localhost:8085 (npm run dev).
 */

// ── Helpers ──────────────────────────────────────────────────────────────────

async function loginAsTA(page) {
  await page.goto('/login');
  await page.fill('#username', process.env.ta_username);
  await page.fill('#password', process.env.ta_password);
  await page.click('#login-btn');
  await page.waitForURL('**/ta**', { timeout: 10000 });
}

async function apiLoginAsTA(request) {
  const response = await request.post('/api/auth/login', {
    data: { username: process.env.ta_username, password: process.env.ta_password },
  });
  expect(response.ok()).toBeTruthy();
  return response;
}

// ── TA Home page ─────────────────────────────────────────────────────────────

test.describe('TA home page', () => {
  test.beforeEach(async ({ page }) => {
    await loginAsTA(page);
  });

  test('TA home page loads with correct heading', async ({ page }) => {
    await expect(page.locator('h1')).toHaveText('TA Dashboard');
  });

  test('has courses container', async ({ page }) => {
    const container = page.locator('#courses-container');
    await expect(container).toBeAttached();
  });

  test('has quick actions section', async ({ page }) => {
    const quickActions = page.locator('.quick-actions');
    await expect(quickActions).toBeAttached();
  });

  test('has sidebar with navigation links', async ({ page }) => {
    await expect(page.locator('nav.main-nav')).toBeVisible();
  });

  test('shows user info in sidebar', async ({ page }) => {
    const userName = page.locator('#user-display-name');
    await expect(userName).toBeVisible();
    const nameText = await userName.innerText();
    expect(nameText.length).toBeGreaterThan(0);
  });
});

// ── TA Settings page ─────────────────────────────────────────────────────────

test.describe('TA settings page', () => {
  test.beforeEach(async ({ page }) => {
    await loginAsTA(page);
    await page.goto('/ta/settings');
    await page.waitForLoadState('networkidle');
  });

  test('settings page loads with correct heading', async ({ page }) => {
    await expect(page.locator('h1')).toHaveText('Settings');
  });

  test('shows account information section', async ({ page }) => {
    const emailField = page.locator('#ta-email');
    const idField = page.locator('#ta-id');

    await expect(emailField).toBeAttached();
    await expect(idField).toBeAttached();
  });

  test('has permissions status section', async ({ page }) => {
    const permStatus = page.locator('#permissions-status');
    await expect(permStatus).toBeAttached();
  });

  test('account fields are read-only', async ({ page }) => {
    const emailField = page.locator('#ta-email');
    if (await emailField.isVisible().catch(() => false)) {
      await expect(emailField).toBeDisabled();
    }
  });
});

// ── TA Onboarding page ───────────────────────────────────────────────────────

test.describe('TA onboarding page', () => {
  test.beforeEach(async ({ page }) => {
    await loginAsTA(page);
    await page.goto('/ta/onboarding');
    await page.waitForLoadState('networkidle');
  });

  test('onboarding page loads', async ({ page }) => {
    const body = await page.locator('body').innerText();
    expect(body.length).toBeGreaterThan(0);
    // Should not redirect to login
    expect(page.url()).not.toContain('/login');
  });

  test('has course selection form or completion card', async ({ page }) => {
    // Either the TA needs to select a course or they've already onboarded
    const courseForm = page.locator('#ta-course-selection-form');
    const completionCard = page.locator('#ta-onboarding-complete');

    const formVisible = await courseForm.isVisible().catch(() => false);
    const completeVisible = await completionCard.isVisible().catch(() => false);

    // One of these should be present
    expect(formVisible || completeVisible).toBeTruthy();
  });
});

// ── TA API tests ─────────────────────────────────────────────────────────────

test.describe('TA API', () => {
  test('TA can access auth/me endpoint', async ({ request }) => {
    await apiLoginAsTA(request);

    const res = await request.get('/api/auth/me');
    const body = await res.json();

    expect(body.success).toBeTruthy();
    expect(body.user.role).toBe('ta');
  });
});
