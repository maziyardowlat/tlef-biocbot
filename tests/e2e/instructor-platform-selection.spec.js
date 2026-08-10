// @ts-check
/**
 * Browser coverage for the AI platform selector.
 *
 * Instructors choose a platform label (OpenAI Chat GPT / UBC On-Premise LLM)
 * and enter that platform's
 * key — they never see or choose a chat or embedding model. Admins configure
 * models per platform on the same page, grouped by platform.
 *
 * These specs drive the real pages and mock only the platform-state APIs, so
 * they stay independent of whichever platform the local .env happens to name.
 */

require('dotenv').config();
const { MongoClient } = require('mongodb');
const { test, expect } = require('./fixtures/monocart');
const { TEST_USERS, storageStatePath } = require('./helpers/users');

const COURSE_ID = 'BIOC-E2E-PLATFORM';
const COURSE_NAME = 'BIOC E2E Platform Selection';

const GPT_HELP = 'Feel free to use your own OpenAI API key, or contact the support team for assistance.';
const SANDBOX_HELP = 'Contact the LTIC team to request a UBC LLM Sandbox API key.';

// Model names must never appear anywhere an instructor can see.
const MODEL_NAMES = [
    'gpt-4.1-mini', 'gpt-5-nano', 'gpt-5.4-nano', 'gpt-5.6-luna',
    'qwen3.6-35b-a3b', 'gpt-oss-120b',
    'text-embedding-3-small', 'text-embedding-3-large', 'qwen3-embedding-0.6b',
];

let instructorId;

async function withDb(fn) {
    if (!process.env.MONGO_URI) {
        throw new Error('MONGO_URI not set; cannot run platform selection e2e tests.');
    }
    const client = new MongoClient(process.env.MONGO_URI);
    await client.connect();
    try {
        return await fn(client.db());
    } finally {
        await client.close();
    }
}

async function setSystemAdmin(userId, isAdmin) {
    await withDb(async (db) => {
        await db.collection('users').updateOne(
            { userId },
            { $set: { 'permissions.systemAdmin': isAdmin === true, updatedAt: new Date() } }
        );
    });
}

async function seedCourse() {
    await withDb(async (db) => {
        await db.collection('courses').deleteMany({ courseId: COURSE_ID });
        await db.collection('courses').insertOne({
            courseId: COURSE_ID,
            courseName: COURSE_NAME,
            instructorId,
            instructors: [instructorId],
            status: 'active',
            isOnboardingComplete: true,
            activeLlmProvider: 'openai',
            llmCredentials: {
                openai: {
                    ciphertext: 'v1:seed:seed:seed',
                    last4: '1111',
                    status: 'valid',
                    provider: 'openai',
                    validatedAt: new Date(),
                    updatedAt: new Date(),
                },
            },
            lectures: [{ name: 'Unit 1', documents: [], isPublished: false }],
            courseStructure: { weeks: 1, lecturesPerWeek: 1, totalUnits: 1 },
            createdAt: new Date(),
            updatedAt: new Date(),
        });
    });
}

/**
 * Mock the course platform-state endpoints so the selector can be driven without
 * contacting a real provider.
 */
async function mockCourseKeyState(page, state) {
    const current = { ...state };

    await page.route('**/api/courses/*/llm-key', async (route) => {
        const request = route.request();
        if (request.method() === 'PUT') {
            const body = JSON.parse(request.postData() || '{}');
            current.llmProvider = body.llmProvider;
            current.llmKeysByProvider[body.llmProvider] = { status: 'valid', last4: '9999', validatedAt: new Date().toISOString() };
            await route.fulfill({
                status: 200,
                contentType: 'application/json',
                body: JSON.stringify({ success: true, message: 'Course API key saved', ...current, migration: null }),
            });
            return;
        }
        await route.fulfill({
            status: 200,
            contentType: 'application/json',
            body: JSON.stringify({ success: true, providers: [], ...current, migration: current.migration || null }),
        });
    });

    return current;
}

function baseState(overrides = {}) {
    return {
        llmProvider: 'openai',
        pendingLlmProvider: null,
        providerMigrationId: null,
        llmKey: { status: 'valid', last4: '1111', validatedAt: null, updatedAt: null },
        llmKeysByProvider: {
            openai: { status: 'valid', last4: '1111', validatedAt: null, updatedAt: null },
            'ubc-llm-sandbox': { status: 'missing', last4: null, validatedAt: null, updatedAt: null },
        },
        aiAvailable: true,
        ...overrides,
    };
}

async function openCourseKeySettings(page) {
    await page.goto(`/instructor/settings?courseId=${COURSE_ID}`);
    await expect(page.locator('h1')).toHaveText('Settings', { timeout: 15_000 });
    await page.locator('.settings-tile[data-panel="course-basics"]').click();
    await expect(page.locator('#course-llm-key-section')).toBeVisible({ timeout: 15_000 });
}

test.beforeAll(async () => {
    const instructor = await withDb(async (db) =>
        db.collection('users').findOne({ username: TEST_USERS.instructor.username }));
    if (!instructor) throw new Error('E2E instructor user not found.');
    instructorId = instructor.userId;
});

test.afterAll(async () => {
    await withDb(async (db) => { await db.collection('courses').deleteMany({ courseId: COURSE_ID }); });
    await setSystemAdmin(instructorId, false);
});

test.describe('Instructor platform selection', () => {
    test.use({ storageState: storageStatePath('instructor') });

    test.beforeEach(async () => {
        await setSystemAdmin(instructorId, false);
        await seedCourse();
    });

    test('onboarding offers GPT and Sandbox with platform-specific help text', async ({ page }) => {
        await page.goto('/instructor/onboarding');
        await expect(page.locator('#onboarding-llm-platform')).toBeVisible({ timeout: 15_000 });

        // GPT is the default choice.
        await expect(page.locator('#onboarding-llm-provider-openai')).toBeChecked();
        await expect(page.locator('#onboarding-llm-platform-help')).toContainText(GPT_HELP);
        await expect(page.locator('#course-api-key-label')).toContainText('OpenAI Chat GPT');
        await expect(page.locator('#course-api-key')).toHaveAttribute('placeholder', 'sk-...');

        // Selecting Sandbox swaps the help text, label and placeholder.
        await page.locator('#onboarding-llm-provider-ubc-llm-sandbox').check();
        await expect(page.locator('#onboarding-llm-platform-help')).toHaveText(SANDBOX_HELP);
        await expect(page.locator('#course-api-key-label')).toContainText('UBC On-Premise LLM');
        await expect(page.locator('#course-api-key')).toHaveAttribute('placeholder', 'UBC LLM Sandbox API key');

        // Switching back restores the GPT copy.
        await page.locator('#onboarding-llm-provider-openai').check();
        await expect(page.locator('#onboarding-llm-platform-help')).toContainText(GPT_HELP);
    });

    test('onboarding never exposes a chat or embedding model name', async ({ page }) => {
        await page.goto('/instructor/onboarding');
        await expect(page.locator('#onboarding-llm-platform')).toBeVisible({ timeout: 15_000 });

        const visibleText = await page.locator('body').innerText();
        for (const modelName of MODEL_NAMES) {
            expect(visibleText).not.toContain(modelName);
        }
    });

    test('course settings show the platform selector, key status and help text', async ({ page }) => {
        await mockCourseKeyState(page, baseState());
        await openCourseKeySettings(page);

        await expect(page.locator('#course-llm-platform')).toBeVisible();
        await expect(page.locator('#course-llm-provider-openai')).toBeChecked();
        await expect(page.locator('#course-llm-platform-help')).toContainText(GPT_HELP);
        await expect(page.locator('#course-llm-key-status')).toContainText('Valid OpenAI Chat GPT key ending 1111');
        // No warning while the selected platform is the active one.
        await expect(page.locator('#course-llm-platform-change-note')).toBeHidden();
    });

    test('choosing a different platform warns that material must be prepared', async ({ page }) => {
        await mockCourseKeyState(page, baseState());
        await openCourseKeySettings(page);

        await page.locator('#course-llm-provider-ubc-llm-sandbox').check();

        await expect(page.locator('#course-llm-platform-help')).toHaveText(SANDBOX_HELP);
        await expect(page.locator('#course-llm-platform-change-note')).toBeVisible();
        await expect(page.locator('#course-llm-platform-change-note'))
            .toContainText('Course material must be prepared for the new platform');
        await expect(page.locator('#course-llm-platform-change-note')).toContainText('OpenAI Chat GPT keeps answering until then');
        // The status line follows the selected platform, not the active one.
        await expect(page.locator('#course-llm-key-status')).toContainText('No UBC On-Premise LLM key saved');
        await expect(page.locator('#course-llm-key-input')).toHaveAttribute('placeholder', 'UBC LLM Sandbox API key');
    });

    test('a saved platform key gets an explicit confirmed switch action without key re-entry', async ({ page }) => {
        let switchRequest = null;
        await mockCourseKeyState(page, baseState({
            llmKeysByProvider: {
                openai: { status: 'valid', last4: '1111', validatedAt: null, updatedAt: null },
                'ubc-llm-sandbox': { status: 'valid', last4: '2222', validatedAt: null, updatedAt: null },
            },
        }));
        await page.route('**/api/courses/*/llm-provider', async (route) => {
            switchRequest = JSON.parse(route.request().postData() || '{}');
            await route.fulfill({
                status: 202,
                contentType: 'application/json',
                body: JSON.stringify({
                    success: true,
                    message: 'Preparing course material for UBC On-Premise LLM.',
                    ...baseState({
                        pendingLlmProvider: 'ubc-llm-sandbox',
                        providerMigrationId: 'mig_saved_switch',
                        llmKeysByProvider: {
                            openai: { status: 'valid', last4: '1111' },
                            'ubc-llm-sandbox': { status: 'valid', last4: '2222' },
                        },
                    }),
                    migration: {
                        migrationId: 'mig_saved_switch', status: 'queued', toProvider: 'ubc-llm-sandbox',
                        total: 0, completed: 0, failed: 0, failures: [],
                    },
                }),
            });
        });

        await openCourseKeySettings(page);
        await page.locator('#course-llm-provider-ubc-llm-sandbox').check();

        await expect(page.locator('#save-course-llm-key')).toHaveText('Switch to Sandbox');
        await expect(page.locator('#course-llm-key-input'))
            .toHaveAttribute('placeholder', 'Optional: enter a replacement Sandbox key');

        page.once('dialog', async (dialog) => {
            expect(dialog.message()).toContain('Switch to Sandbox using the saved key?');
            await dialog.accept();
        });
        await page.locator('#save-course-llm-key').click();

        await expect.poll(() => switchRequest).toEqual({ llmProvider: 'ubc-llm-sandbox' });
        await expect(page.locator('#course-llm-key-input')).toHaveValue('');
    });

    test('a course key surface never exposes model names to an instructor', async ({ page }) => {
        await mockCourseKeyState(page, baseState());
        await openCourseKeySettings(page);

        // Admin model controls are hidden from a non-admin instructor entirely.
        await expect(page.locator('#llm-model-section')).toBeHidden();
        await expect(page.locator('#sandbox-llm-model-section')).toBeHidden();

        const visibleText = await page.locator('body').innerText();
        for (const modelName of MODEL_NAMES) {
            expect(visibleText).not.toContain(modelName);
        }
    });

    test('a running migration shows persistent progress and a retry control on failure', async ({ page }) => {
        await mockCourseKeyState(page, baseState({
            pendingLlmProvider: 'ubc-llm-sandbox',
            providerMigrationId: 'mig_e2e_1',
            migration: {
                migrationId: 'mig_e2e_1',
                status: 'running',
                toProvider: 'ubc-llm-sandbox',
                total: 4,
                completed: 1,
                failed: 0,
                currentItem: { itemType: 'document', itemId: 'd2', title: 'Lecture 2.pdf' },
                failures: [],
                targetProfile: { provider: 'ubc-llm-sandbox' },
            },
        }));

        // The poller asks for the migration; report a failed item on the next tick.
        await page.route('**/api/provider-migrations/mig_e2e_1', async (route) => {
            await route.fulfill({
                status: 200,
                contentType: 'application/json',
                body: JSON.stringify({
                    success: true,
                    migration: {
                        migrationId: 'mig_e2e_1',
                        status: 'failed',
                        toProvider: 'ubc-llm-sandbox',
                        total: 4,
                        completed: 3,
                        failed: 1,
                        currentItem: null,
                        failures: [{ itemType: 'document', itemId: 'd4', title: 'Lecture 4.pdf', error: 'provider rejected', attempts: 3 }],
                        targetProfile: { provider: 'ubc-llm-sandbox' },
                    },
                }),
            });
        });

        await openCourseKeySettings(page);

        // Initial state from the surface payload.
        await expect(page.locator('#course-llm-migration')).toBeVisible();
        await expect(page.locator('#course-llm-migration-status'))
            .toContainText('Preparing course material for UBC On-Premise LLM: 1 of 4 done');
        await expect(page.locator('#course-llm-migration-status')).toContainText('Lecture 2.pdf');
        // While migrating, the selector shows the platform being migrated TO.
        await expect(page.locator('#course-llm-provider-ubc-llm-sandbox')).toBeChecked();

        // After the poll, the failure and retry control appear.
        await expect(page.locator('#course-llm-migration-status'))
            .toContainText('stopped with 1 failure', { timeout: 15_000 });
        await expect(page.locator('#course-llm-migration-status'))
            .toContainText('The previous platform is still active');
        await expect(page.locator('#course-llm-migration-failures'))
            .toContainText('Lecture 4.pdf: provider rejected');
        await expect(page.locator('#course-llm-migration-retry')).toBeVisible();
    });

    test('retrying a failed migration calls the retry endpoint', async ({ page }) => {
        let retried = false;
        await mockCourseKeyState(page, baseState({
            pendingLlmProvider: 'ubc-llm-sandbox',
            providerMigrationId: 'mig_e2e_2',
            migration: {
                migrationId: 'mig_e2e_2',
                status: 'failed',
                toProvider: 'ubc-llm-sandbox',
                total: 2,
                completed: 1,
                failed: 1,
                currentItem: null,
                failures: [{ itemType: 'document', itemId: 'd2', title: 'Lecture 2.pdf', error: 'quota', attempts: 3 }],
                targetProfile: { provider: 'ubc-llm-sandbox' },
            },
        }));

        await page.route('**/api/provider-migrations/mig_e2e_2/retry', async (route) => {
            retried = true;
            await route.fulfill({
                status: 202,
                contentType: 'application/json',
                body: JSON.stringify({
                    success: true,
                    migration: {
                        migrationId: 'mig_e2e_2', status: 'queued', toProvider: 'ubc-llm-sandbox',
                        total: 2, completed: 1, failed: 0, failures: [], targetProfile: { provider: 'ubc-llm-sandbox' },
                    },
                }),
            });
        });

        await openCourseKeySettings(page);
        await expect(page.locator('#course-llm-migration-retry')).toBeVisible();
        await page.locator('#course-llm-migration-retry').click();

        await expect(page.locator('.notification.success', { hasText: 'Retrying failed items' }))
            .toBeVisible({ timeout: 10_000 });
        expect(retried).toBe(true);
        await expect(page.locator('#course-llm-migration-status'))
            .toContainText('Preparing course material for UBC On-Premise LLM: 1 of 2 done');
    });
});

test.describe('Admin platform and model settings', () => {
    test.use({ storageState: storageStatePath('instructor') });

    test.beforeEach(async () => {
        await seedCourse();
        await setSystemAdmin(instructorId, true);
    });

    test('model controls are grouped by platform, each with its own collection', async ({ page }) => {
        await page.route('**/api/settings/llm', async (route) => {
            if (route.request().method() !== 'GET') return route.continue();
            await route.fulfill({
                status: 200,
                contentType: 'application/json',
                body: JSON.stringify({
                    success: true,
                    platforms: [
                        {
                            provider: 'openai', label: 'OpenAI Chat GPT',
                            chatModel: 'gpt-5-nano', embeddingModel: 'text-embedding-3-small',
                            reasoningEffort: 'minimal', supportsReasoning: true,
                            allowedModels: ['gpt-4.1-mini', 'gpt-5-nano'],
                            allowedEmbeddingModels: ['text-embedding-3-small', 'text-embedding-3-large'],
                            reasoningEffortsByModel: { 'gpt-5-nano': ['minimal', 'low'], 'gpt-4.1-mini': [] },
                            defaultReasoningEffortByModel: { 'gpt-5-nano': 'minimal' },
                            collection: 'biocbot_documents', vectorSize: 1536, pendingEmbedding: null,
                        },
                        {
                            provider: 'ubc-llm-sandbox', label: 'UBC On-Premise LLM',
                            chatModel: 'qwen3.6-35b-a3b', embeddingModel: 'qwen3-embedding-0.6b',
                            reasoningEffort: 'none', supportsReasoning: true,
                            allowedModels: ['qwen3.6-35b-a3b', 'gpt-oss-120b'],
                            allowedEmbeddingModels: ['qwen3-embedding-0.6b'],
                            reasoningEffortsByModel: { 'qwen3.6-35b-a3b': ['none', 'low'] },
                            defaultReasoningEffortByModel: { 'qwen3.6-35b-a3b': 'none' },
                            collection: 'biocbot_documents_qwen3_embedding_0_6b', vectorSize: 1024,
                            pendingEmbedding: null,
                        },
                    ],
                    settings: { model: 'gpt-5-nano', reasoningEffort: 'minimal', provider: 'openai' },
                }),
            });
        });

        await page.goto(`/instructor/settings?courseId=${COURSE_ID}`);
        await expect(page.locator('h1')).toHaveText('Settings', { timeout: 15_000 });
        await page.locator('.settings-tile[data-panel="admin-platform"]').click();

        // GPT group.
        await expect(page.locator('#llm-model-section')).toBeVisible();
        await expect(page.locator('#llm-model-section h3')).toHaveText('OpenAI Chat GPT models');
        await expect(page.locator('#llm-model-select')).toHaveValue('gpt-5-nano');
        await expect(page.locator('#llm-embedding-select')).toHaveValue('text-embedding-3-small');
        await expect(page.locator('#llm-embedding-collection')).toContainText('biocbot_documents (1536 dimensions)');

        // Sandbox group, with its own separate collection and dimensionality.
        await expect(page.locator('#sandbox-llm-model-section')).toBeVisible();
        await expect(page.locator('#sandbox-llm-model-section h3')).toHaveText('UBC On-Premise LLM models');
        await expect(page.locator('#sandbox-llm-model-select')).toHaveValue('qwen3.6-35b-a3b');
        await expect(page.locator('#sandbox-llm-embedding-select')).toHaveValue('qwen3-embedding-0.6b');
        await expect(page.locator('#sandbox-llm-embedding-collection'))
            .toContainText('biocbot_documents_qwen3_embedding_0_6b (1024 dimensions)');

        // Each platform only offers its own models.
        await expect(page.locator('#llm-model-select option[value="qwen3.6-35b-a3b"]')).toHaveCount(0);
        await expect(page.locator('#sandbox-llm-model-select option[value="gpt-5-nano"]')).toHaveCount(0);
        await expect(page.locator('#llm-embedding-select option[value="qwen3-embedding-0.6b"]')).toHaveCount(0);
    });

    test('a staged embedding change is shown with a cancel control', async ({ page }) => {
        await page.route('**/api/settings/llm', async (route) => {
            if (route.request().method() !== 'GET') return route.continue();
            await route.fulfill({
                status: 200,
                contentType: 'application/json',
                body: JSON.stringify({
                    success: true,
                    platforms: [{
                        provider: 'openai', label: 'OpenAI Chat GPT',
                        chatModel: 'gpt-4.1-mini', embeddingModel: 'text-embedding-3-small',
                        reasoningEffort: 'minimal', supportsReasoning: false,
                        allowedModels: ['gpt-4.1-mini'],
                        allowedEmbeddingModels: ['text-embedding-3-small', 'text-embedding-3-large'],
                        reasoningEffortsByModel: {}, defaultReasoningEffortByModel: {},
                        collection: 'biocbot_documents', vectorSize: 1536,
                        pendingEmbedding: { embeddingModel: 'text-embedding-3-large', migrationId: 'mig_admin_1' },
                    }],
                    settings: { model: 'gpt-4.1-mini', provider: 'openai' },
                }),
            });
        });

        await page.goto(`/instructor/settings?courseId=${COURSE_ID}`);
        await expect(page.locator('h1')).toHaveText('Settings', { timeout: 15_000 });
        await page.locator('.settings-tile[data-panel="admin-platform"]').click();

        await expect(page.locator('#llm-embedding-pending')).toBeVisible();
        await expect(page.locator('#llm-embedding-pending')).toContainText('Staged: text-embedding-3-large');
        await expect(page.locator('#llm-embedding-pending'))
            .toContainText('text-embedding-3-small stays active until re-indexing finishes');
        await expect(page.locator('#rollback-llm-embedding')).toBeVisible();
    });
});
