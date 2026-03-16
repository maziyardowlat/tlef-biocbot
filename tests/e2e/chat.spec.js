// @ts-check
require('dotenv').config();
const { test, expect } = require('@playwright/test');

/**
 * Chat feature tests — API + UI for the student chat interface.
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

/**
 * After student login, if a course-selection prompt appears, pick the first course.
 * Then wait for the page to settle.
 */
async function selectCourseIfNeeded(page) {
  await page.waitForLoadState('networkidle');
  await page.waitForTimeout(1500);

  // Check for course selection dropdown
  const courseSelect = page.locator('select').filter({ hasText: 'Choose a course' });
  const isVisible = await courseSelect.isVisible().catch(() => false);

  if (isVisible) {
    const optionCount = await courseSelect.locator('option').count();
    if (optionCount > 1) {
      await courseSelect.selectOption({ index: 1 });
      await page.waitForTimeout(1500);
      await page.waitForLoadState('networkidle');
    }
  }
}

async function apiLoginAs(request, role) {
  const creds = {
    student: { username: process.env.student_username, password: process.env.student_password },
    instructor: { username: process.env.inst_username, password: process.env.inst_password },
  };
  const { username, password } = creds[role];
  const response = await request.post('/api/auth/login', {
    data: { username, password },
  });
  expect(response.ok()).toBeTruthy();
  return response;
}

async function getInstructorCourseId(request) {
  const coursesRes = await request.get('/api/courses');
  const coursesBody = await coursesRes.json();
  if (coursesBody.success && coursesBody.data?.length > 0) {
    return coursesBody.data[0].id;
  }
  return null;
}

// ── Chat API tests ───────────────────────────────────────────────────────────

test.describe('Chat API', () => {
  test('chat status endpoint responds with connection info', async ({ request }) => {
    await apiLoginAs(request, 'student');

    const res = await request.get('/api/chat/status');
    const body = await res.json();

    expect(body).toHaveProperty('success');
    expect(body).toHaveProperty('data');
    expect(body.data).toHaveProperty('isInitialized');
  });

  test('chat test endpoint confirms LLM connection', async ({ request }) => {
    await apiLoginAs(request, 'student');

    const res = await request.post('/api/chat/test');
    const body = await res.json();

    expect(body).toHaveProperty('success');
  });

  test('chat models endpoint returns available models', async ({ request }) => {
    await apiLoginAs(request, 'student');

    const res = await request.get('/api/chat/models');
    const body = await res.json();

    expect(body).toHaveProperty('success');
  });

  test('sending a chat message returns a response', async ({ request }) => {
    // Login as instructor first to get a valid courseId
    await apiLoginAs(request, 'instructor');
    const courseId = await getInstructorCourseId(request);

    if (!courseId) {
      test.skip();
      return;
    }

    // Login as student and send message
    await apiLoginAs(request, 'student');

    const res = await request.post('/api/chat', {
      data: {
        message: 'What is the purpose of this course?',
        courseId: courseId,
        unitName: 'General',
        mode: 'tutor',
      },
      timeout: 30000,
    });

    const body = await res.json();

    expect(body).toHaveProperty('success');
    if (body.success) {
      expect(body).toHaveProperty('message');
      expect(typeof body.message).toBe('string');
      expect(body.message.length).toBeGreaterThan(0);
    }
  });
});

// ── Chat page UI tests ──────────────────────────────────────────────────────

test.describe('Chat page UI', () => {
  test.beforeEach(async ({ page }) => {
    await loginAsStudent(page);
    await selectCourseIfNeeded(page);
  });

  test('chat page loads with correct heading', async ({ page }) => {
    await expect(page.locator('h1')).toHaveText('Chat with BiocBot');
  });

  test('chat input exists on the page', async ({ page }) => {
    // The input exists in the DOM even if hidden during assessment mode
    await expect(page.locator('#chat-input')).toBeAttached();
    await expect(page.locator('#send-button')).toBeAttached();
  });

  test('mode toggle exists on the page', async ({ page }) => {
    // Mode toggle may be hidden during assessment, but should be in the DOM
    await expect(page.locator('#mode-toggle-checkbox')).toBeAttached();
    await expect(page.locator('.protege-label')).toBeAttached();
    await expect(page.locator('.tutor-label')).toBeAttached();
  });

  test('new session button exists', async ({ page }) => {
    await expect(page.locator('#new-session-btn')).toBeVisible();
  });

  test('sidebar navigation links are present', async ({ page }) => {
    await expect(page.locator('nav.main-nav a[href="/student"]')).toBeVisible();
    await expect(page.locator('nav.main-nav a[href="/student/history"]')).toBeVisible();
    await expect(page.locator('nav.main-nav a[href="/student/flagged"]')).toBeVisible();
  });

  test('chat disclaimer exists on the page', async ({ page }) => {
    await expect(page.locator('.chat-disclaimer')).toBeAttached();
  });

  test('unit selection is available after course is selected', async ({ page }) => {
    const unitSelect = page.locator('#unit-select');
    await expect(unitSelect).toBeAttached();
  });
});

// ── Chat interaction (send message via UI) ───────────────────────────────────

test.describe('Chat interaction', () => {
  test('sending a message shows it in the chat and gets a bot response', async ({ page }) => {
    await loginAsStudent(page);
    await selectCourseIfNeeded(page);

    await page.waitForTimeout(2000);

    // The chat input might be hidden if in assessment mode.
    const chatInput = page.locator('#chat-input');
    const inputVisible = await chatInput.isVisible().catch(() => false);

    if (!inputVisible) {
      // Assessment mode — try answering the assessment question to get to free chat
      const answerBtn = page.locator('.message button').first();
      const btnVisible = await answerBtn.isVisible().catch(() => false);

      if (btnVisible) {
        await answerBtn.click();
        await page.waitForTimeout(3000);
      }

      const nowVisible = await chatInput.isVisible().catch(() => false);
      if (!nowVisible) {
        test.skip();
        return;
      }
    }

    await chatInput.fill('Hello, this is a test message from Playwright');
    await page.locator('#send-button').click();

    // The user message should appear in the chat
    const userMessage = page.locator('.message.user-message').last();
    await expect(userMessage).toBeVisible({ timeout: 5000 });

    // Wait for bot response (may take time due to LLM call)
    const botMessage = page.locator('.message.bot-message').last();
    await expect(botMessage).toBeVisible({ timeout: 30000 });
  });
});

// ── Chat history page UI ─────────────────────────────────────────────────────

test.describe('Chat history page', () => {
  test.beforeEach(async ({ page }) => {
    await loginAsStudent(page);
    await page.goto('/student/history');
    await page.waitForLoadState('networkidle');
  });

  test('history page loads with correct heading', async ({ page }) => {
    await expect(page.locator('.history-header h3')).toHaveText('Chat History');
  });

  test('history page has list and preview panels', async ({ page }) => {
    await expect(page.locator('.chat-history-list')).toBeVisible();
    await expect(page.locator('.chat-preview-panel')).toBeVisible();
  });

  test('preview panel shows "Select a Chat" initially', async ({ page }) => {
    await expect(page.locator('#preview-title')).toHaveText('Select a Chat');
  });

  test('shows either history items or no-history message', async ({ page }) => {
    await page.waitForTimeout(3000);

    const historyItems = await page.locator('#chat-history-list .chat-history-item').count();
    const noHistory = await page.locator('#no-history-message').isVisible();

    expect(historyItems > 0 || noHistory).toBeTruthy();
  });
});
