// @ts-check
/**
 * Focused branch coverage for public/student/scripts/history.js lines 1-225.
 *
 * This spec intentionally stays on the history page but targets only the
 * storage, server mutation, and current-user helper branches declared before
 * the DOMContentLoaded bootstrap.
 */

const { test, expect } = require('./fixtures/monocart');
const { storageStatePath } = require('./helpers/users');
const { getUserIdByUsername } = require('./helpers/quiz');

const COURSE_ID = 'BIOC-E2E-HISTORY-BRANCHES';
const COURSE_NAME = 'BIOC E2E History Branches';

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
 * @param {Object} [options]
 * @param {boolean} [options.selectedCourse]
 */
async function openHistoryPage(page, options = {}) {
    const { selectedCourse = true } = options;

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
        if (arg.selectedCourse) {
            localStorage.setItem('selectedCourseId', arg.courseId);
            localStorage.setItem('selectedCourseName', arg.courseName);
        } else {
            localStorage.removeItem('selectedCourseId');
            localStorage.removeItem('selectedCourseName');
        }
    }, {
        studentId,
        courseId: COURSE_ID,
        courseName: COURSE_NAME,
        selectedCourse,
    });

    await page.goto('/student/history');
    await page.waitForFunction(() => typeof (/** @type {any} */ (window)).getChatHistory === 'function');
}

/**
 * @param {import('@playwright/test').Page} page
 */
async function clearCurrentUser(page) {
    await page.evaluate(() => {
        const w = /** @type {any} */ (window);
        w.currentUser = null;
        localStorage.removeItem('currentUser');
    });
}

/**
 * @param {import('@playwright/test').Page} page
 * @param {Array<{ id: string, title?: string }>} chats
 */
async function seedLocalHistory(page, chats) {
    await page.evaluate((arg) => {
        localStorage.setItem(`biocbot_chat_history_${arg.studentId}`, JSON.stringify(arg.chats));
    }, { studentId, chats });
}

test('returns empty history when no current student exists', async ({ page }) => {
    await openHistoryPage(page);
    await clearCurrentUser(page);

    const history = await page.evaluate(() => {
        const w = /** @type {any} */ (window);
        return w.getChatHistory();
    });

    expect(history).toEqual([]);
});

test('returns empty history when stored chat JSON is malformed', async ({ page }) => {
    await openHistoryPage(page);
    await page.evaluate((sid) => {
        localStorage.setItem(`biocbot_chat_history_${sid}`, '{not-json');
    }, studentId);

    const history = await page.evaluate(() => {
        const w = /** @type {any} */ (window);
        return w.getChatHistory();
    });

    expect(history).toEqual([]);
});

test('returns null when chat lookup throws', async ({ page }) => {
    await openHistoryPage(page);

    const result = await page.evaluate(() => {
        const w = /** @type {any} */ (window);
        const originalGetChatHistory = w.getChatHistory;
        w.getChatHistory = () => ({
            find() {
                throw new Error('forced find failure');
            },
        });
        try {
            return w.getChatById('chat-1');
        } finally {
            w.getChatHistory = originalGetChatHistory;
        }
    });

    expect(result).toBeNull();
});

test('delete short-circuits when no current student exists', async ({ page }) => {
    await openHistoryPage(page);
    await clearCurrentUser(page);

    const deleted = await page.evaluate(() => {
        const w = /** @type {any} */ (window);
        return w.deleteChatFromHistory('chat-1');
    });

    expect(deleted).toBe(false);
});

test('delete uses default course when no course is selected', async ({ page }) => {
    let deleteUrl = '';
    await page.route('**/api/students/*/*/sessions/*/own', async (route) => {
        if (route.request().method() !== 'DELETE') return route.fallback();
        deleteUrl = route.request().url();
        await route.fulfill({ json: { success: true } });
    });
    await openHistoryPage(page, { selectedCourse: false });
    await seedLocalHistory(page, [
        { id: 'chat-delete-default', title: 'Default course delete' },
        { id: 'keep-me', title: 'Keep me' },
    ]);

    const deleted = await page.evaluate(() => {
        const w = /** @type {any} */ (window);
        return w.deleteChatFromHistory('chat-delete-default');
    });
    const remainingIds = await page.evaluate((sid) => {
        return JSON.parse(localStorage.getItem(`biocbot_chat_history_${sid}`) || '[]').map((chat) => chat.id);
    }, studentId);

    expect(deleted).toBe(true);
    expect(deleteUrl).toContain('/api/students/BIOC202-1758488753872/');
    expect(remainingIds).toEqual(['keep-me']);
});

test('delete falls back to localStorage when server returns an error status', async ({ page }) => {
    await page.route('**/api/students/*/*/sessions/*/own', async (route) => {
        if (route.request().method() !== 'DELETE') return route.fallback();
        await route.fulfill({ status: 500, body: 'failed' });
    });
    await openHistoryPage(page);
    await seedLocalHistory(page, [
        { id: 'server-error-delete', title: 'Remove after 500' },
        { id: 'still-here', title: 'Still here' },
    ]);

    const deleted = await page.evaluate(() => {
        const w = /** @type {any} */ (window);
        return w.deleteChatFromHistory('server-error-delete');
    });
    const remainingIds = await page.evaluate((sid) => {
        return JSON.parse(localStorage.getItem(`biocbot_chat_history_${sid}`) || '[]').map((chat) => chat.id);
    }, studentId);

    expect(deleted).toBe(true);
    expect(remainingIds).toEqual(['still-here']);
});

test('delete falls back to localStorage when server reports unsuccessful JSON', async ({ page }) => {
    await page.route('**/api/students/*/*/sessions/*/own', async (route) => {
        if (route.request().method() !== 'DELETE') return route.fallback();
        await route.fulfill({ json: { success: false, message: 'nope' } });
    });
    await openHistoryPage(page);
    await seedLocalHistory(page, [
        { id: 'json-false-delete', title: 'Remove after false' },
    ]);

    const deleted = await page.evaluate(() => {
        const w = /** @type {any} */ (window);
        return w.deleteChatFromHistory('json-false-delete');
    });
    const remaining = await page.evaluate((sid) => {
        return JSON.parse(localStorage.getItem(`biocbot_chat_history_${sid}`) || '[]');
    }, studentId);

    expect(deleted).toBe(true);
    expect(remaining).toEqual([]);
});

test('title update short-circuits when no current student exists', async ({ page }) => {
    await openHistoryPage(page);
    await clearCurrentUser(page);

    const updated = await page.evaluate(() => {
        const w = /** @type {any} */ (window);
        return w.updateChatTitle('chat-1', 'New title');
    });

    expect(updated).toBe(false);
});

test('title update falls back to localStorage when server returns an error status', async ({ page }) => {
    await page.route('**/api/students/*/*/sessions/*/title', async (route) => {
        if (route.request().method() !== 'PUT') return route.fallback();
        await route.fulfill({ status: 500, body: 'failed' });
    });
    await openHistoryPage(page);
    await seedLocalHistory(page, [
        { id: 'server-error-title', title: 'Old title' },
    ]);

    const updated = await page.evaluate(() => {
        const w = /** @type {any} */ (window);
        return w.updateChatTitle('server-error-title', 'Fallback title');
    });
    const title = await page.evaluate((sid) => {
        const history = JSON.parse(localStorage.getItem(`biocbot_chat_history_${sid}`) || '[]');
        return history[0]?.title;
    }, studentId);

    expect(updated).toBe(true);
    expect(title).toBe('Fallback title');
});

test('title update falls back to localStorage when server reports unsuccessful JSON', async ({ page }) => {
    await page.route('**/api/students/*/*/sessions/*/title', async (route) => {
        if (route.request().method() !== 'PUT') return route.fallback();
        await route.fulfill({ json: { success: false, message: 'nope' } });
    });
    await openHistoryPage(page);
    await seedLocalHistory(page, [
        { id: 'json-false-title', title: 'Old title' },
    ]);

    const updated = await page.evaluate(() => {
        const w = /** @type {any} */ (window);
        return w.updateChatTitle('json-false-title', 'Fallback after false');
    });
    const title = await page.evaluate((sid) => {
        const history = JSON.parse(localStorage.getItem(`biocbot_chat_history_${sid}`) || '[]');
        return history[0]?.title;
    }, studentId);

    expect(updated).toBe(true);
    expect(title).toBe('Fallback after false');
});

test('title update syncs localStorage when the server succeeds', async ({ page }) => {
    await page.route('**/api/students/*/*/sessions/*/title', async (route) => {
        if (route.request().method() !== 'PUT') return route.fallback();
        await route.fulfill({ json: { success: true } });
    });
    await openHistoryPage(page);
    await seedLocalHistory(page, [
        { id: 'server-success-title', title: 'Old title' },
    ]);

    const updated = await page.evaluate(() => {
        const w = /** @type {any} */ (window);
        return w.updateChatTitle('server-success-title', 'Server title');
    });
    const title = await page.evaluate((sid) => {
        const history = JSON.parse(localStorage.getItem(`biocbot_chat_history_${sid}`) || '[]');
        return history[0]?.title;
    }, studentId);

    expect(updated).toBe(true);
    expect(title).toBe('Server title');
});

test('title update returns false when fallback cannot find the chat', async ({ page }) => {
    await page.route('**/api/students/*/*/sessions/*/title', async (route) => {
        if (route.request().method() !== 'PUT') return route.fallback();
        await route.fulfill({ status: 500, body: 'failed' });
    });
    await openHistoryPage(page);
    await seedLocalHistory(page, [
        { id: 'other-chat', title: 'Other chat' },
    ]);

    const updated = await page.evaluate(() => {
        const w = /** @type {any} */ (window);
        return w.updateChatTitle('missing-chat', 'No match');
    });

    expect(updated).toBe(false);
});

test('title update returns false when fallback localStorage parsing fails', async ({ page }) => {
    await page.route('**/api/students/*/*/sessions/*/title', async (route) => {
        if (route.request().method() !== 'PUT') return route.fallback();
        await route.fulfill({ status: 500, body: 'failed' });
    });
    await openHistoryPage(page);
    await page.evaluate((sid) => {
        localStorage.setItem(`biocbot_chat_history_${sid}`, '{not-json');
    }, studentId);

    const updated = await page.evaluate(() => {
        const w = /** @type {any} */ (window);
        return w.updateChatTitle('bad-json-title', 'Nope');
    });

    expect(updated).toBe(false);
});

test('current user prefers window.currentUser when present', async ({ page }) => {
    await openHistoryPage(page);

    const user = await page.evaluate(() => {
        const w = /** @type {any} */ (window);
        w.currentUser = { userId: 'window-user', displayName: 'Window User' };
        return w.getCurrentUser();
    });

    expect(user).toEqual({ userId: 'window-user', displayName: 'Window User' });
});

test('current user resolves through an external auth helper', async ({ page }) => {
    await openHistoryPage(page);

    const user = await page.evaluate(() => {
        const w = /** @type {any} */ (window);
        const historyGetCurrentUser = w.getCurrentUser;
        const originalWindowGetter = w.getCurrentUser;
        w.currentUser = null;
        localStorage.removeItem('currentUser');
        w.getCurrentUser = () => ({ userId: 'auth-helper-user', displayName: 'Auth Helper' });
        try {
            return historyGetCurrentUser();
        } finally {
            w.getCurrentUser = originalWindowGetter;
        }
    });

    expect(user).toEqual({ userId: 'auth-helper-user', displayName: 'Auth Helper' });
});

test('current user returns null when stored user JSON is malformed', async ({ page }) => {
    await openHistoryPage(page);

    const user = await page.evaluate(() => {
        const w = /** @type {any} */ (window);
        w.currentUser = null;
        localStorage.setItem('currentUser', '{not-json');
        return w.getCurrentUser();
    });

    expect(user).toBeNull();
});

test('current student id falls back to localStorage currentUser', async ({ page }) => {
    await openHistoryPage(page);

    const resolvedStudentId = await page.evaluate(() => {
        const w = /** @type {any} */ (window);
        w.currentUser = null;
        localStorage.setItem('currentUser', JSON.stringify({ userId: 'stored-student-id' }));
        return w.getCurrentStudentId();
    });

    expect(resolvedStudentId).toBe('stored-student-id');
});

test('current student id returns null when stored currentUser has no userId', async ({ page }) => {
    await openHistoryPage(page);

    const resolvedStudentId = await page.evaluate(() => {
        const w = /** @type {any} */ (window);
        w.currentUser = null;
        localStorage.setItem('currentUser', JSON.stringify({ displayName: 'No ID' }));
        return w.getCurrentStudentId();
    });

    expect(resolvedStudentId).toBeNull();
});

test('current student id returns null when currentUser JSON parsing throws', async ({ page }) => {
    await openHistoryPage(page);

    const resolvedStudentId = await page.evaluate(() => {
        const w = /** @type {any} */ (window);
        w.currentUser = null;
        localStorage.setItem('currentUser', '{not-json');
        return w.getCurrentStudentId();
    });

    expect(resolvedStudentId).toBeNull();
});
