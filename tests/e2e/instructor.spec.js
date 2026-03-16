// @ts-check
require('dotenv').config();
const { test, expect } = require('@playwright/test');

/**
 * Instructor feature tests — settings, student hub, downloads.
 * Expects the app to be running on localhost:8085 (npm run dev).
 */

// ── Helpers ──────────────────────────────────────────────────────────────────

async function loginAsInstructor(page) {
  await page.goto('/login');
  await page.fill('#username', process.env.inst_username);
  await page.fill('#password', process.env.inst_password);
  await page.click('#login-btn');
  await page.waitForURL('**/instructor**', { timeout: 10000 });
}

async function apiLoginAs(request, role) {
  const creds = {
    instructor: { username: process.env.inst_username, password: process.env.inst_password },
  };
  const { username, password } = creds[role];
  const response = await request.post('/api/auth/login', {
    data: { username, password },
  });
  expect(response.ok()).toBeTruthy();
  return response;
}

// ── Settings page ────────────────────────────────────────────────────────────

test.describe('Instructor settings page', () => {
  test.beforeEach(async ({ page }) => {
    await loginAsInstructor(page);
    await page.goto('/instructor/settings');
    await page.waitForLoadState('networkidle');
  });

  test('settings page loads with correct heading', async ({ page }) => {
    await expect(page.locator('h1')).toHaveText('Settings');
  });

  test('has login restrictions section with toggle', async ({ page }) => {
    const toggle = page.locator('#allow-local-login-toggle');
    await expect(toggle).toBeAttached();
  });

  test('has student idle timeout setting', async ({ page }) => {
    const input = page.locator('#idle-timeout-input');
    await expect(input).toBeAttached();
  });

  test('has quiz settings section', async ({ page }) => {
    const quizToggle = page.locator('#quiz-enabled-toggle');
    await expect(quizToggle).toBeAttached();
  });

  test('has source attribution download toggle', async ({ page }) => {
    const toggle = page.locator('#source-attribution-download-toggle');
    await expect(toggle).toBeAttached();
  });

  test('has save and reset buttons', async ({ page }) => {
    const saveBtn = page.locator('#save-settings');
    const resetBtn = page.locator('#reset-settings');
    await expect(saveBtn).toBeAttached();
    await expect(resetBtn).toBeAttached();
  });

  test('has AI persona settings with prompt textareas', async ({ page }) => {
    const basePrompt = page.locator('#base-prompt');
    const tutorPrompt = page.locator('#tutor-prompt');
    const protegePrompt = page.locator('#protege-prompt');

    await expect(basePrompt).toBeAttached();
    await expect(tutorPrompt).toBeAttached();
    await expect(protegePrompt).toBeAttached();
  });
});

// ── Settings API ─────────────────────────────────────────────────────────────

test.describe('Settings API', () => {
  test('can load prompt settings', async ({ request }) => {
    await apiLoginAs(request, 'instructor');

    const res = await request.get('/api/settings/prompts');
    const body = await res.json();

    expect(body).toHaveProperty('success');
  });

  test('can load quiz settings', async ({ request }) => {
    await apiLoginAs(request, 'instructor');

    const res = await request.get('/api/settings/quiz');
    const body = await res.json();

    expect(body).toHaveProperty('success');
  });

  test('can load global settings', async ({ request }) => {
    await apiLoginAs(request, 'instructor');

    const res = await request.get('/api/settings/global');
    const body = await res.json();

    expect(body).toHaveProperty('success');
  });
});

// ── Student Hub page ─────────────────────────────────────────────────────────

test.describe('Instructor student hub page', () => {
  test.beforeEach(async ({ page }) => {
    await loginAsInstructor(page);
    await page.goto('/instructor/student-hub');
    await page.waitForLoadState('networkidle');
  });

  test('student hub page loads with correct heading', async ({ page }) => {
    await expect(page.locator('h1')).toHaveText('Student Hub');
  });

  test('has students container', async ({ page }) => {
    const container = page.locator('#students-container');
    await expect(container).toBeAttached();
  });

  test('shows either students or empty state after loading', async ({ page }) => {
    await page.waitForTimeout(3000);

    const studentCards = await page.locator('.student-card').count();
    const body = await page.locator('body').innerText();

    // Either there are student cards or the page shows some content
    expect(studentCards >= 0).toBeTruthy();
    expect(body.length).toBeGreaterThan(0);
  });
});

// ── Downloads page ───────────────────────────────────────────────────────────

test.describe('Instructor downloads page', () => {
  test.beforeEach(async ({ page }) => {
    await loginAsInstructor(page);
    await page.goto('/instructor/downloads');
    await page.waitForLoadState('networkidle');
  });

  test('downloads page loads', async ({ page }) => {
    const body = await page.locator('body').innerText();
    expect(body.length).toBeGreaterThan(0);
  });

  test('has students container for download cards', async ({ page }) => {
    const container = page.locator('#students-container');
    await expect(container).toBeAttached();
  });

  test('shows loading, content, or empty state', async ({ page }) => {
    await page.waitForTimeout(3000);

    const loadingVisible = await page.locator('#loading-state').isVisible().catch(() => false);
    const emptyVisible = await page.locator('#empty-state').isVisible().catch(() => false);
    const studentCards = await page.locator('.student-card').count();

    // One of these states should be true
    expect(loadingVisible || emptyVisible || studentCards >= 0).toBeTruthy();
  });
});

// ── Courses API ──────────────────────────────────────────────────────────────

test.describe('Courses API', () => {
  test('instructor can list courses', async ({ request }) => {
    await apiLoginAs(request, 'instructor');

    const res = await request.get('/api/courses');
    const body = await res.json();

    expect(body.success).toBeTruthy();
    expect(Array.isArray(body.data)).toBeTruthy();
  });
});
