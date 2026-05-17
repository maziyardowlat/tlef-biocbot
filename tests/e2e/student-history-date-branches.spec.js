// @ts-check
/**
 * Focused branch coverage for public/student/scripts/history.js lines 1308-1364.
 */

const { test, expect } = require('./fixtures/monocart');
const { storageStatePath } = require('./helpers/users');
const { getUserIdByUsername } = require('./helpers/quiz');

const COURSE_ID = 'BIOC-E2E-HISTORY-DATES';
const COURSE_NAME = 'BIOC E2E History Dates';

let studentId;

test.use({ storageState: storageStatePath('student') });

test.beforeAll(async () => {
    studentId = await getUserIdByUsername('e2e_student');
});

test.beforeEach(async ({ page }) => {
    await page.route('**/api/user-agreement/status', async (route) => {
        await route.fulfill({
            json: {
                success: true,
                data: { hasAgreed: true },
            },
        });
    });

    await page.route('**/api/courses/*/student-enrollment', async (route) => {
        await route.fulfill({
            json: {
                success: true,
                data: { status: 'active' },
            },
        });
    });
});

/**
 * @param {import('@playwright/test').Page} page
 */
async function openHistoryPage(page) {
    await page.route('**/api/students/*/*/sessions/own', async (route) => {
        if (route.request().method() !== 'GET') return route.fallback();
        await route.fulfill({ json: { success: true, data: { sessions: [] } } });
    });

    await page.addInitScript((arg) => {
        localStorage.setItem('currentUser', JSON.stringify({
            userId: arg.studentId,
            username: 'e2e_student',
            displayName: 'E2E Student',
        }));
        localStorage.setItem('selectedCourseId', arg.courseId);
        localStorage.setItem('selectedCourseName', arg.courseName);
    }, {
        studentId,
        courseId: COURSE_ID,
        courseName: COURSE_NAME,
    });

    await page.goto('/student/history');
    await page.waitForFunction(() => typeof (/** @type {any} */ (window)).formatHistoryDate === 'function');
}

test('renders unknown date for invalid history date', async ({ page }) => {
    await openHistoryPage(page);

    const formatted = await page.evaluate(() => {
        const w = /** @type {any} */ (window);
        return w.formatHistoryDate('not-a-date');
    });

    expect(formatted).toBe('Unknown date');
});

test('renders today label for current-day history date', async ({ page }) => {
    await openHistoryPage(page);

    const formatted = await page.evaluate(() => {
        const w = /** @type {any} */ (window);
        return w.formatHistoryDate(new Date().toISOString());
    });

    expect(formatted).toMatch(/^Today, /);
});

test('renders yesterday label for one-day-old history date', async ({ page }) => {
    await openHistoryPage(page);

    const formatted = await page.evaluate(() => {
        const w = /** @type {any} */ (window);
        const yesterday = new Date(Date.now() - (25 * 60 * 60 * 1000));
        return w.formatHistoryDate(yesterday.toISOString());
    });

    expect(formatted).toMatch(/^Yesterday, /);
});

test('renders weekday label for recent history date', async ({ page }) => {
    await openHistoryPage(page);

    const formatted = await page.evaluate(() => {
        const w = /** @type {any} */ (window);
        const recent = new Date(Date.now() - (3 * 24 * 60 * 60 * 1000));
        return w.formatHistoryDate(recent.toISOString());
    });

    expect(formatted).toMatch(/^[A-Z][a-z]{2},? /);
});

test('renders calendar date for older history date', async ({ page }) => {
    await openHistoryPage(page);

    const formatted = await page.evaluate(() => {
        const w = /** @type {any} */ (window);
        const older = new Date(Date.now() - (10 * 24 * 60 * 60 * 1000));
        return w.formatHistoryDate(older.toISOString());
    });

    expect(formatted).toMatch(/^[A-Z][a-z]{2} \d{1,2}, \d{4}$/);
});

test('renders unknown date when date construction throws', async ({ page }) => {
    await openHistoryPage(page);

    const formatted = await page.evaluate(() => {
        const w = /** @type {any} */ (window);
        const OriginalDate = Date;
        Date = /** @type {DateConstructor} */ (/** @type {unknown} */ (function ThrowingDate() {
            throw new Error('forced date failure');
        }));
        try {
            return w.formatHistoryDate('2026-05-17T00:00:00.000Z');
        } finally {
            Date = OriginalDate;
        }
    });

    expect(formatted).toBe('Unknown date');
});

test('ignores clicks outside history items', async ({ page }) => {
    await openHistoryPage(page);

    const selectedTitle = await page.evaluate(() => {
        document.body.click();
        return document.getElementById('preview-title')?.textContent;
    });

    expect(selectedTitle).toBe('Select a Chat');
});

test('ignores delegated history item clicks without a chat id', async ({ page }) => {
    await openHistoryPage(page);

    const selectedTitle = await page.evaluate(() => {
        const item = document.createElement('div');
        item.className = 'chat-history-item';
        item.textContent = 'No chat id';
        document.body.appendChild(item);
        item.click();
        item.remove();
        return document.getElementById('preview-title')?.textContent;
    });

    expect(selectedTitle).toBe('Select a Chat');
});

test('opens chat preview from delegated history item click', async ({ page }) => {
    await openHistoryPage(page);
    await page.evaluate((sid) => {
        localStorage.setItem(`biocbot_chat_history_${sid}`, JSON.stringify([
            {
                id: 'delegated-click-chat',
                title: 'Delegated Click Chat',
                preview: 'Show this history item.',
                messageCount: 1,
                duration: '1 min',
                savedAt: new Date().toISOString(),
                unitName: 'Unit 1',
                timestamp: new Date().toISOString(),
                chatData: {
                    messages: [
                        {
                            type: 'user',
                            content: 'Show this history item.',
                            timestamp: new Date().toISOString(),
                        },
                    ],
                },
            },
        ]));
    }, studentId);

    const selectedTitle = await page.evaluate(() => {
        const w = /** @type {any} */ (window);
        w.loadChatHistoryFromLocalStorage();
        const item = /** @type {HTMLElement|null} */ (document.querySelector('[data-chat-id="delegated-click-chat"]'));
        if (!item) return null;
        item.click();
        return document.getElementById('preview-title')?.textContent;
    });

    expect(selectedTitle).toBe('Delegated Click Chat');
});
