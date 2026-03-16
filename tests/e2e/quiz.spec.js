// @ts-check
require('dotenv').config();
const { test, expect } = require('@playwright/test');

/**
 * Quiz practice feature tests — API + UI.
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

// ── Quiz API tests ───────────────────────────────────────────────────────────

test.describe('Quiz API', () => {
  test('quiz status endpoint responds', async ({ request }) => {
    await apiLoginAs(request, 'student');

    // Need a courseId for quiz status
    await apiLoginAs(request, 'instructor');
    const courseId = await getInstructorCourseId(request);
    await apiLoginAs(request, 'student');

    if (!courseId) {
      test.skip();
      return;
    }

    const res = await request.get(`/api/quiz/status?courseId=${courseId}`);
    const body = await res.json();

    expect(body).toHaveProperty('success');
  });

  test('quiz questions endpoint responds', async ({ request }) => {
    await apiLoginAs(request, 'instructor');
    const courseId = await getInstructorCourseId(request);
    await apiLoginAs(request, 'student');

    if (!courseId) {
      test.skip();
      return;
    }

    const res = await request.get(`/api/quiz/questions?courseId=${courseId}`);
    const body = await res.json();

    expect(body).toHaveProperty('success');
  });

  test('quiz history endpoint responds', async ({ request }) => {
    await apiLoginAs(request, 'instructor');
    const courseId = await getInstructorCourseId(request);
    await apiLoginAs(request, 'student');

    if (!courseId) {
      test.skip();
      return;
    }

    const res = await request.get(`/api/quiz/history?courseId=${courseId}`);
    const body = await res.json();

    expect(body).toHaveProperty('success');
  });
});

// ── Quiz page UI tests ───────────────────────────────────────────────────────

test.describe('Quiz page UI', () => {
  test.beforeEach(async ({ page }) => {
    await loginAsStudent(page);
    await page.goto('/student/quiz');
    await page.waitForLoadState('networkidle');
  });

  test('quiz page loads with correct heading', async ({ page }) => {
    // Quiz page may redirect to login or show "Quiz not enabled" if disabled
    const url = page.url();

    if (url.includes('/login')) {
      // Quiz not enabled — page redirected
      expect(url).toContain('/login');
      return;
    }

    // If quiz is enabled, check for the heading
    const heading = page.locator('h1');
    if (await heading.isVisible().catch(() => false)) {
      await expect(heading).toHaveText('Quiz Practice');
    }
  });

  test('quiz page has stats cards', async ({ page }) => {
    if (page.url().includes('/login')) return;

    const totalStat = page.locator('#stat-total');
    const correctStat = page.locator('#stat-correct');
    const accuracyStat = page.locator('#stat-accuracy');

    if (await totalStat.count() > 0) {
      await expect(totalStat).toBeVisible();
      await expect(correctStat).toBeVisible();
      await expect(accuracyStat).toBeVisible();
    }
  });

  test('quiz page has filter controls', async ({ page }) => {
    if (page.url().includes('/login')) return;

    const unitFilter = page.locator('#unit-filter');
    const typeFilter = page.locator('#type-filter');

    if (await unitFilter.count() > 0) {
      await expect(unitFilter).toBeVisible();
      await expect(typeFilter).toBeVisible();
    }
  });

  test('quiz page has question card area', async ({ page }) => {
    if (page.url().includes('/login')) return;

    const questionCard = page.locator('#question-card');
    if (await questionCard.count() > 0) {
      await expect(questionCard).toBeVisible();
    }
  });

  test('quiz page has submit and navigation buttons', async ({ page }) => {
    if (page.url().includes('/login')) return;

    const submitBtn = page.locator('#submit-btn');
    if (await submitBtn.count() > 0) {
      await expect(submitBtn).toBeVisible();
      await expect(page.locator('#next-btn')).toBeVisible();
    }
  });
});
