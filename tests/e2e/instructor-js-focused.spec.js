// @ts-check
/**
 * Focused browser coverage for public/instructor/scripts/instructor.js.
 *
 * These tests exercise client-side instructor document-page behavior with
 * mocked API edges so coverage can reach helper/error branches without changing
 * production code or depending on expensive document/AI processing.
 */

const path = require('path');
const { test, expect } = require('./fixtures/monocart');
const { storageStatePath } = require('./helpers/users');

const COURSE_ID = 'INSTRUCTOR-JS-FOCUSED';
const INSTRUCTOR_ID = 'e2e_instructor_id';

/**
 * @typedef {Window & Record<string, any>} InstructorWindow
 * @typedef {{
 *   textUploads: Record<string, any>[],
 *   fileUploads: number,
 *   savedTopics: Record<string, any>[],
 *   publishBodies: Record<string, any>[],
 *   objectiveBodies: Record<string, any>[],
 *   thresholdBodies: Record<string, any>[],
 *   bulkQuestions: Record<string, any>[],
 *   renamedUnits: Record<string, any>[],
 *   deletedDocuments: Record<string, any>[],
 *   removedDocuments: Record<string, any>[],
 *   questionUpdates: Record<string, any>[],
 *   generatedQuestions: Record<string, any>[],
 *   confirmedMaterials: Record<string, any>[],
 *   unitAdds: Record<string, any>[],
 *   unitDeletes: { pathname: string, body: Record<string, any> }[],
 *   cleanupRequests: Record<string, any>[],
 *   createdQuestions: Record<string, any>[],
 * }} InstructorRouteCaptures
 */

function focusedCourse(overrides = {}) {
    const now = new Date('2026-01-02T03:04:05.000Z');
    return {
        courseId: COURSE_ID,
        courseName: 'Instructor JS Focused Coverage',
        courseCode: 'FOCUS-STU',
        instructorCourseCode: 'FOCUS-INS',
        instructorId: INSTRUCTOR_ID,
        instructors: [INSTRUCTOR_ID],
        tas: [],
        approvedStruggleTopics: [
            { topic: 'Glycolysis', unitId: 'Unit 1', source: 'manual', createdAt: now.toISOString() },
            { topic: 'Oxidative Phosphorylation', unitId: 'Unit 2', source: 'manual', createdAt: now.toISOString() },
        ],
        courseStructure: { weeks: 2, lecturesPerWeek: 1, totalUnits: 2 },
        isOnboardingComplete: true,
        status: 'active',
        lectures: [
            {
                name: 'Unit 1',
                displayName: 'Metabolism',
                isPublished: true,
                learningObjectives: ['Explain glycolysis', 'Compare ATP yields'],
                passThreshold: 1,
                createdAt: now,
                updatedAt: now,
                documents: [
                    {
                        documentId: 'doc_lecture',
                        filename: '*Lecture Notes - Unit 1',
                        originalName: 'Lecture notes.txt',
                        documentType: 'lecture-notes',
                        type: 'lecture_notes',
                        contentType: 'text',
                        status: 'parsed',
                        lectureName: 'Unit 1',
                        courseId: COURSE_ID,
                        size: 123,
                        uploadDate: now.toISOString(),
                        metadata: { description: 'Core notes' },
                    },
                    {
                        documentId: 'doc_practice',
                        filename: '*Practice Questions/Tutorial - Unit 1',
                        originalName: 'Practice quiz.txt',
                        documentType: 'practice-quiz',
                        type: 'practice_q_tutorials',
                        contentType: 'text',
                        status: 'uploaded',
                        lectureName: 'Unit 1',
                        courseId: COURSE_ID,
                        size: 456,
                        uploadDate: now.toISOString(),
                        content: '1. Which step produces ATP?',
                    },
                ],
                assessmentQuestions: [
                    {
                        questionId: 'q_existing',
                        questionType: 'multiple-choice',
                        question: 'Which pathway begins glucose oxidation?',
                        options: { A: 'Glycolysis', B: 'Translation' },
                        correctAnswer: 'A',
                        learningObjective: 'Explain glycolysis',
                    },
                ],
            },
            {
                name: 'Unit 2',
                isPublished: false,
                learningObjectives: [],
                passThreshold: 0,
                createdAt: now,
                updatedAt: now,
                documents: [],
                assessmentQuestions: [],
            },
        ],
        ...overrides,
    };
}

test.use({ storageState: storageStatePath('instructor'), acceptDownloads: true });

async function installInstructorRoutes(page, options = {}) {
    const course = options.course || focusedCourse();
    /** @type {InstructorRouteCaptures} */
    const captured = {
        textUploads: [],
        fileUploads: 0,
        savedTopics: [],
        publishBodies: [],
        objectiveBodies: [],
        thresholdBodies: [],
        bulkQuestions: [],
        renamedUnits: [],
        deletedDocuments: [],
        removedDocuments: [],
        questionUpdates: [],
        generatedQuestions: [],
        confirmedMaterials: [],
        unitAdds: [],
        unitDeletes: [],
        cleanupRequests: [],
        createdQuestions: [],
    };

    await page.route('**/api/**', async (route) => {
        const request = route.request();
        const url = new URL(request.url());
        const pathname = url.pathname;
        const method = request.method();

        if (pathname === '/api/settings/llm-tag') {
            await route.fulfill({ json: { success: true, llmIndex: 1, reasoningIndex: 2 } });
            return;
        }

        if (pathname === '/api/auth/me') {
            await route.fulfill({
                json: {
                    success: true,
                    user: {
                        userId: INSTRUCTOR_ID,
                        username: 'e2e_instructor',
                        displayName: 'Focused Instructor',
                        role: 'instructor',
                        permissions: { systemAdmin: true },
                    },
                },
            });
            return;
        }

        if (pathname === `/api/onboarding/${COURSE_ID}`) {
            await route.fulfill({ json: { success: true, data: course } });
            return;
        }

        if (pathname === `/api/onboarding/instructor/${INSTRUCTOR_ID}`) {
            await route.fulfill({ json: { success: true, data: { courses: [course] } } });
            return;
        }

        if (pathname === `/api/courses/${COURSE_ID}` && method === 'GET') {
            await route.fulfill({ json: { success: true, data: course } });
            return;
        }

        if (pathname === `/api/courses/${COURSE_ID}` && method === 'PUT') {
            await route.fulfill({ json: { success: true, data: course } });
            return;
        }

        if (pathname === `/api/courses/${COURSE_ID}/units` && method === 'POST') {
            captured.unitAdds.push(request.postDataJSON());
            await route.fulfill({ json: { success: true, message: 'Unit added' } });
            return;
        }

        if (pathname.startsWith(`/api/courses/${COURSE_ID}/units/`) && method === 'DELETE') {
            captured.unitDeletes.push({ pathname, body: request.postDataJSON() });
            await route.fulfill({ json: { success: true, message: 'Unit deleted' } });
            return;
        }

        if (pathname === `/api/courses/ta/${INSTRUCTOR_ID}`) {
            await route.fulfill({ json: { success: true, data: [{ courseId: COURSE_ID, courseName: course.courseName }] } });
            return;
        }

        if (pathname === `/api/courses/${COURSE_ID}/ta-permissions/${INSTRUCTOR_ID}`) {
            await route.fulfill({
                json: {
                    success: true,
                    data: { permissions: { canAccessCourses: true, canAccessFlags: false } },
                },
            });
            return;
        }

        if (pathname === `/api/courses/${COURSE_ID}/approved-topics` && method === 'GET') {
            await route.fulfill({
                json: {
                    success: true,
                    data: {
                        topics: [
                            { topic: 'Glycolysis', unitId: 'Unit 1', source: 'manual', createdAt: '2026-01-01T00:00:00.000Z' },
                            { topic: 'Oxidative Phosphorylation', unitId: 'Unit 2', source: 'manual', createdAt: '2026-01-01T00:00:00.000Z' },
                        ],
                    },
                },
            });
            return;
        }

        if (pathname === `/api/courses/${COURSE_ID}/approved-topics` && method === 'PUT') {
            captured.savedTopics.push(request.postDataJSON());
            await route.fulfill({
                json: {
                    success: true,
                    data: {
                        topics: request.postDataJSON().topics,
                    },
                },
            });
            return;
        }

        if (pathname === `/api/courses/${COURSE_ID}/extract-topics`) {
            await route.fulfill({
                json: {
                    success: true,
                    data: { topicLabels: ['Glycolysis', ' Citric Acid Cycle ', 'citric acid cycle', 'ATP Synthase'] },
                },
            });
            return;
        }

        if (pathname === '/api/struggle-activity/persistence/' + COURSE_ID) {
            await route.fulfill({
                json: {
                    success: true,
                    data: [
                        { topic: 'Glycolysis', studentCount: 3 },
                        { topic: 'Oxidative Phosphorylation', studentCount: 1 },
                    ],
                },
            });
            return;
        }

        if (pathname === '/api/documents/text') {
            captured.textUploads.push(request.postDataJSON());
            await route.fulfill({
                json: {
                    success: true,
                    message: 'Text uploaded',
                    data: {
                        documentId: 'doc_text_upload',
                        filename: 'Uploaded text.txt',
                        title: 'Additional Material - Unit 1',
                        qdrantProcessed: true,
                    },
                },
            });
            return;
        }

        if (pathname === '/api/documents/upload') {
            captured.fileUploads += 1;
            await route.fulfill({
                json: {
                    success: true,
                    message: 'File uploaded',
                    data: {
                        documentId: 'doc_file_upload',
                        filename: 'focused-notes.txt',
                        qdrantProcessed: false,
                    },
                },
            });
            return;
        }

        if (pathname === '/api/documents/doc_practice') {
            await route.fulfill({
                json: {
                    success: true,
                    data: {
                        documentId: 'doc_practice',
                        originalName: 'Practice quiz.txt',
                        documentType: 'practice-quiz',
                        contentType: 'text',
                        content: '1. Which step produces ATP?',
                        lectureName: 'Unit 1',
                        courseId: COURSE_ID,
                        size: 456,
                        uploadDate: '2026-01-02T03:04:05.000Z',
                    },
                },
            });
            return;
        }

        if (pathname === '/api/documents/doc_practice/extract-questions') {
            await route.fulfill({
                json: {
                    success: true,
                    data: {
                        wasChunked: true,
                        questions: [
                            {
                                questionType: 'multiple-choice',
                                question: 'Which pathway makes pyruvate?',
                                options: { A: 'Glycolysis', B: 'Replication' },
                                correctAnswer: 'A',
                                hasAnswer: true,
                            },
                            {
                                questionType: 'true-false',
                                question: 'ATP synthase uses a proton gradient.',
                                options: {},
                                correctAnswer: null,
                                hasAnswer: false,
                            },
                        ],
                    },
                },
            });
            return;
        }

        if (pathname === '/api/questions/bulk') {
            captured.bulkQuestions.push(request.postDataJSON());
            await route.fulfill({
                json: {
                    success: true,
                    data: { addedCount: request.postDataJSON().questions.length, autoLinkedCount: 1 },
                },
            });
            return;
        }

        if (pathname === '/api/documents/doc_lecture/download') {
            await route.fulfill({
                status: 200,
                headers: {
                    'Content-Type': 'text/plain',
                    'Content-Disposition': "attachment; filename*=UTF-8''Focused%20Lecture.txt",
                },
                body: 'lecture download body',
            });
            return;
        }

        if (pathname === '/api/documents/doc_lecture' && method === 'DELETE') {
            captured.deletedDocuments.push(request.postDataJSON());
            await route.fulfill({ json: { success: true } });
            return;
        }

        if (pathname === '/api/documents/cleanup-orphans') {
            captured.cleanupRequests.push(request.postDataJSON());
            await route.fulfill({
                json: { success: true, data: { totalOrphans: 2 } },
            });
            return;
        }

        if (pathname === `/api/courses/${COURSE_ID}/remove-document`) {
            captured.removedDocuments.push(request.postDataJSON());
            await route.fulfill({ json: { success: true } });
            return;
        }

        if (pathname === '/api/learning-objectives') {
            if (method === 'POST') {
                captured.objectiveBodies.push(request.postDataJSON());
                await route.fulfill({ json: { success: true, message: 'Objectives saved' } });
            } else {
                await route.fulfill({ json: { success: true, data: { objectives: ['Explain glycolysis'] } } });
            }
            return;
        }

        if (pathname === '/api/courses/course-materials/confirm') {
            captured.confirmedMaterials.push(request.postDataJSON());
            await route.fulfill({ json: { success: true, message: 'Materials confirmed' } });
            return;
        }

        if (pathname === '/api/lectures/publish-status') {
            await route.fulfill({
                json: { success: true, data: { publishStatus: { 'Unit 1': true, 'Unit 2': false } } },
            });
            return;
        }

        if (pathname === '/api/lectures/publish') {
            captured.publishBodies.push(request.postDataJSON());
            await route.fulfill({
                json: { success: true, message: 'Publish updated', data: request.postDataJSON() },
            });
            return;
        }

        if (pathname === '/api/lectures/pass-threshold') {
            if (method === 'POST') {
                captured.thresholdBodies.push(request.postDataJSON());
                await route.fulfill({ json: { success: true, message: 'Threshold saved' } });
            } else {
                await route.fulfill({ json: { success: true, data: { passThreshold: 1 } } });
            }
            return;
        }

        if (pathname === '/api/questions/lecture') {
            await route.fulfill({
                json: {
                    success: true,
                    data: {
                        questions: [
                            {
                                questionId: 'q_existing',
                                questionType: 'multiple-choice',
                                question: 'Which pathway begins glucose oxidation?',
                                options: { A: 'Glycolysis', B: 'Translation' },
                                correctAnswer: 'A',
                                learningObjective: 'Explain glycolysis',
                            },
                        ],
                    },
                },
            });
            return;
        }

        if (pathname === '/api/questions' && method === 'POST') {
            captured.createdQuestions.push(request.postDataJSON());
            await route.fulfill({
                json: {
                    success: true,
                    data: { questionId: 'q_created' },
                },
            });
            return;
        }

        if (pathname === '/api/questions/generate-ai') {
            const body = request.postDataJSON();
            captured.generatedQuestions.push(body);
            await route.fulfill({
                json: {
                    success: true,
                    data: body.regenerate
                        ? {
                            question: 'Regenerated question about glycolysis?',
                            options: { choices: ['Glucose', 'DNA', 'RNA', 'Protein'], correctAnswer: 'A' },
                            answer: 'A',
                            selectedLearningObjective: 'Compare ATP yields',
                            wasRegenerated: true,
                        }
                        : {
                            question: body.struggleTopic
                                ? `Generated from ${body.struggleTopic}?`
                                : 'AI generated glycolysis question?',
                            options: { A: 'Glycolysis', B: 'Translation', C: 'Splicing', D: 'Replication' },
                            answer: 'A',
                            selectedLearningObjective: 'Explain glycolysis',
                        },
                },
            });
            return;
        }

        if (pathname === '/api/questions/auto-link-learning-objectives') {
            await route.fulfill({
                json: { success: true, message: 'Auto-linked 1 question', data: { linkedCount: 1, unassignedCount: 0 } },
            });
            return;
        }

        if (pathname === '/api/questions/q_existing' && method === 'PUT') {
            captured.questionUpdates.push(request.postDataJSON());
            await route.fulfill({ json: { success: true, data: request.postDataJSON() } });
            return;
        }

        if (pathname === '/api/questions/q_existing' && method === 'DELETE') {
            await route.fulfill({ json: { success: true } });
            return;
        }

        if (pathname === `/api/courses/${COURSE_ID}/units/Unit%201/rename`) {
            captured.renamedUnits.push(request.postDataJSON());
            await route.fulfill({ json: { success: true, message: 'Unit renamed' } });
            return;
        }

        await route.fulfill({ json: { success: true, data: {} } });
    });

    return captured;
}

async function openInstructorDocuments(page, options = {}) {
    const captured = await installInstructorRoutes(page, options);
    await page.goto(`/instructor/documents?courseId=${COURSE_ID}`);
    await expect(page.locator('#course-title')).toHaveText('Instructor JS Focused Coverage', { timeout: 15_000 });
    await expect(page.locator('.accordion-item[data-unit-name="Unit 1"]')).toBeVisible();
    await page.waitForFunction(() => {
        const instructorWindow = /** @type {InstructorWindow} */ (window);
        return [
            'openUploadModal',
            'handleUpload',
            'showInlineTopicReview',
            'openQuestionModal',
            'generateAIQuestionContent',
            'showQuestionReviewModal',
            'openRenameUnitInput',
        ].every((name) => typeof instructorWindow[name] === 'function');
    });
    return captured;
}

async function notification(page, text) {
    await expect(page.locator('.notification').filter({ hasText: text }).last()).toBeVisible({ timeout: 10_000 });
}

test.describe('instructor.js focused browser coverage', () => {
    test('uploads pasted content, reviews deduped topics, and saves merged topic entries', async ({ page }) => {
        const captured = await openInstructorDocuments(page);

        await page.locator('.add-content-btn.additional-material').first().click();
        await expect(page.locator('#upload-modal')).toHaveClass(/show/);

        await page.locator('button.method-btn', { hasText: 'Paste content directly' }).click();
        await page.locator('#text-input').fill('Pasted instructor material about ATP production.');
        await page.locator('#upload-btn').click();

        await expect(page.locator('#topic-review-section')).toBeVisible({ timeout: 10_000 });
        await expect(page.locator('#upload-topic-review-list .topic-review-item')).toHaveCount(2);
        await expect(page.locator('#upload-topic-existing-note')).toContainText('2 existing topics');

        await page.locator('#upload-topic-review-list .topic-review-item').first().locator('.topic-review-remove').click();
        await page.locator('#upload-topic-new-input').fill('  NADH Shuttles  ');
        await page.locator('#upload-topic-add-btn').click();
        await page.locator('#save-topics-btn').click();

        await expect(page.locator('#upload-modal')).not.toHaveClass(/show/);
        expect(captured.textUploads).toHaveLength(1);
        expect(captured.savedTopics).toHaveLength(1);
        expect(captured.savedTopics[0].topics.map((topic) => topic.topic)).toEqual([
            'Glycolysis',
            'Oxidative Phosphorylation',
            'ATP Synthase',
            'NADH Shuttles',
        ]);
    });

    test('uploads a file into a required placeholder and prevents closing while upload is active', async ({ page }) => {
        const captured = await openInstructorDocuments(page);

        await page.evaluate(() => {
            const instructorWindow = /** @type {InstructorWindow} */ (window);
            instructorWindow.openUploadModal('Unit 2', 'lecture-notes');
        });
        await page.locator('button.method-btn', { hasText: 'Upload a file' }).click();

        await page.evaluate(() => {
            const instructorWindow = /** @type {InstructorWindow} */ (window);
            instructorWindow.handleFileUpload(new File(['notes'], 'focused-notes.txt', { type: 'text/plain' }));
        });

        await expect(page.locator('#file-name')).toHaveText('focused-notes.txt');
        await expect(page.locator('#file-size')).toHaveText('5 Bytes');

        await page.locator('#upload-loading-indicator').evaluate((el) => {
            const htmlElement = /** @type {HTMLElement} */ (el);
            htmlElement.style.display = 'block';
        });
        await page.locator('#upload-modal .modal-close').click();
        await notification(page, 'Please wait for the upload to complete before closing.');

        await page.locator('#upload-loading-indicator').evaluate((el) => {
            const htmlElement = /** @type {HTMLElement} */ (el);
            htmlElement.style.display = 'none';
        });
        await page.locator('#upload-btn').click();

        await expect(page.locator('#topic-review-section')).toBeVisible({ timeout: 10_000 });
        expect(captured.fileUploads).toBe(1);
        await expect(page.locator('.file-item[data-document-id="doc_file_upload"] .status-text')).toHaveText('Uploaded');
    });

    test('saves objectives, confirms materials, publishes, thresholds, renames, and updates summary', async ({ page }) => {
        const captured = await openInstructorDocuments(page);
        page.on('dialog', (dialog) => dialog.accept());

        await page.locator('#objective-input-unit-1').fill('Describe substrate-level phosphorylation');
        await page.locator('.add-objective-btn-inline').first().click();
        await expect(page.locator('#objectives-list-unit-1')).toContainText('Describe substrate-level phosphorylation');

        await page.locator('#objectives-list-unit-1 .remove-objective').last().click();
        await expect(page.locator('#objectives-list-unit-1')).not.toContainText('Describe substrate-level phosphorylation');

        await page.locator('.learning-objectives-section .save-btn').first().click();
        await page.locator('.course-materials-section .save-btn').first().click();
        await page.evaluate(() => {
            const instructorWindow = /** @type {InstructorWindow} */ (window);
            const toggle = /** @type {HTMLInputElement} */ (document.getElementById('publish-unit-2'));
            toggle.checked = true;
            instructorWindow.togglePublish('Unit 2', true);
            instructorWindow.updatePublishedSummary();
        });
        await page.locator('#pass-threshold-unit-1').fill('1');
        await page.locator('.assessment-questions-section .save-btn').first().click();
        await page.locator('.unit-rename-btn').first().click();
        await page.locator('.unit-rename-input').first().fill('Energy Flow');
        await page.locator('.unit-save-btn').first().click();

        await expect.poll(() => captured.objectiveBodies.length).toBe(1);
        await expect.poll(() => captured.confirmedMaterials.length).toBe(1);
        await expect.poll(() => captured.publishBodies.length).toBeGreaterThan(0);
        await expect.poll(() => captured.thresholdBodies.length).toBe(1);
        await expect.poll(() => captured.renamedUnits.length).toBe(1);
        await expect(page.locator('.folder-name').first()).toHaveText('1. Energy Flow');
        await expect(page.locator('#published-units-summary')).toContainText('Currently, 2 of the 2 Units are Published.');
    });

    test('drives AI generation, struggle-topic generation, regeneration, objective edit, and auto-link flow', async ({ page }) => {
        const captured = await openInstructorDocuments(page);

        await page.locator('.add-question-btn').first().click();
        await expect(page.locator('#question-modal')).toHaveClass(/show/);
        await page.locator('#question-type').selectOption('multiple-choice');

        await expect(page.locator('#ai-generate-btn')).toBeEnabled();
        await page.locator('#ai-generate-btn').click();
        await expect(page.locator('#question-text')).toHaveValue('AI generated glycolysis question?', { timeout: 10_000 });
        await expect(page.locator('#learning-objective-select')).toHaveValue('Explain glycolysis');

        await page.locator('#ai-generate-btn').click();
        await expect(page.locator('#regenerate-modal')).toHaveClass(/show/);
        await page.locator('#regenerate-feedback').fill('Make it more specific.');
        await page.locator('#regenerate-submit-btn').click();
        await expect(page.locator('#question-text')).toHaveValue('Regenerated question about glycolysis?', { timeout: 10_000 });
        await expect(page.locator('#learning-objective-select')).toHaveValue('Compare ATP yields');

        await page.locator('#struggle-topic-panel').evaluate((el) => {
            const details = /** @type {HTMLDetailsElement} */ (el);
            details.open = true;
        });
        await page.locator('#show-all-struggle-topics-toggle').click();
        await expect(page.locator('#struggle-topic-select')).toContainText('Oxidative Phosphorylation', { timeout: 10_000 });
        await page.locator('#struggle-topic-select').selectOption('Oxidative Phosphorylation');
        await page.locator('#topic-generate-btn').click();
        await expect(page.locator('#question-text')).toHaveValue('Generated from Oxidative Phosphorylation?', { timeout: 10_000 });

        await page.evaluate(() => {
            const instructorWindow = /** @type {InstructorWindow} */ (window);
            instructorWindow.closeQuestionModal();
            instructorWindow.updateQuestionsDisplay('Unit 1');
        });
        await page.locator('.edit-question-btn').first().click();
        await expect(page.locator('#question-learning-objective-modal')).toHaveClass(/show/);
        await page.locator('#edit-learning-objective-select').selectOption('Compare ATP yields');
        await page.locator('#question-learning-objective-modal .btn-primary').click();

        await page.locator('.auto-link-btn').first().click();
        await expect(page.locator('#auto-link-confirmation-modal')).toHaveClass(/show/);
        await page.locator('#auto-link-confirmation-modal .btn-primary').click();

        await expect.poll(() => captured.questionUpdates.length).toBe(1);
        await expect.poll(() => captured.generatedQuestions.length).toBeGreaterThanOrEqual(3);
        await notification(page, 'Auto-linked 1 question');
    });

    test('views practice documents, extracts questions, fills missing answers, and bulk saves selections', async ({ page }) => {
        const captured = await openInstructorDocuments(page);

        await page.locator('button.action-button.view').filter({ hasText: 'View' }).nth(1).click();
        await expect(page.locator('.document-modal')).toContainText('Practice quiz.txt');
        await page.locator('.document-modal button', { hasText: 'Find Assessment Questions' }).click();

        await expect(page.locator('.question-review-modal')).toBeVisible({ timeout: 10_000 });
        await expect(page.locator('#qr-selected-count')).toHaveText('1 question selected');
        await page.locator('.missing-answer-input').selectOption('True');
        await expect(page.locator('#qr-selected-count')).toHaveText('2 questions selected');
        await page.locator('.qr-no-btn').first().click();
        await expect(page.locator('#qr-selected-count')).toHaveText('1 question selected');
        await page.locator('#qr-save-btn').click();

        await expect(page.locator('.question-review-modal')).toHaveCount(0, { timeout: 10_000 });
        expect(captured.bulkQuestions).toHaveLength(1);
        expect(captured.bulkQuestions[0].questions).toHaveLength(1);
        expect(captured.bulkQuestions[0].questions[0].correctAnswer).toBe('True');
    });

    test('covers unit management, TA permissions, direct question save/delete, cleanup, and helper branches', async ({ page }) => {
        const captured = await openInstructorDocuments(page);

        await page.evaluate(async (courseId) => {
            const instructorWindow = /** @type {InstructorWindow} */ (window);

            const fileInput = /** @type {HTMLInputElement} */ (document.getElementById('file-input'));
            fileInput.addEventListener('click', () => {
                fileInput.dataset.clicked = 'true';
            }, { once: true });
            instructorWindow.triggerFileInput();

            const sectionHeader = /** @type {HTMLElement} */ (document.querySelector('.section-header'));
            instructorWindow.toggleSection(sectionHeader, new Event('click'));
            instructorWindow.toggleSection(sectionHeader, null);

            const matches = instructorWindow.findElementsContainingText('.folder-name', 'metabolism');
            if (matches.length === 0) throw new Error('Expected folder-name match');

            await instructorWindow.addNewUnit();
            instructorWindow.openDeleteUnitModal('Unit 2');
            instructorWindow.closeDeleteUnitModal();
            instructorWindow.openDeleteUnitModal('Unit 2');
            await instructorWindow.confirmDeleteUnit();
        });

        await expect.poll(() => captured.unitAdds.length).toBe(1);
        await expect.poll(() => captured.unitDeletes.length).toBe(1);

        await page.evaluate(async (courseId) => {
            const instructorWindow = /** @type {InstructorWindow} */ (window);
            const reviewPromise = instructorWindow.runTopicReviewAfterUpload(courseId, 'doc_topic', 'Topic source');
            await new Promise((resolve, reject) => {
                const startedAt = Date.now();
                const timer = setInterval(() => {
                    const saveButton = /** @type {HTMLButtonElement | null} */ (document.querySelector('#topic-review-save-btn'));
                    if (saveButton) {
                        clearInterval(timer);
                        saveButton.click();
                        resolve(undefined);
                    } else if (Date.now() - startedAt > 5000) {
                        clearInterval(timer);
                        reject(new Error('Topic review modal did not open'));
                    }
                }, 25);
            });
            await reviewPromise;
        }, COURSE_ID);

        await page.evaluate(async () => {
            const instructorWindow = /** @type {InstructorWindow} */ (window);
            instructorWindow.setupTANavigationHandlers();
            await instructorWindow.updateTANavigationBasedOnPermissions();
            if (!instructorWindow.hasPermissionForFeature('courses')) {
                throw new Error('Expected courses permission');
            }
            if (instructorWindow.hasPermissionForFeature('flags')) {
                throw new Error('Expected flags permission to be denied');
            }
            if (instructorWindow.getSelectedCourseIdForTA() !== 'INSTRUCTOR-JS-FOCUSED') {
                throw new Error('Expected selected TA course from URL');
            }
        });

        await page.evaluate(async (courseId) => {
            const instructorWindow = /** @type {InstructorWindow} */ (window);
            await instructorWindow.removeDocumentFromCourseStructure('doc_lecture', courseId, 'e2e_instructor_id');
            await instructorWindow.cleanupOrphanedDocuments();
            await instructorWindow.deleteAssessmentQuestion('q_existing', 'Unit 1');
            await instructorWindow.reloadPassThresholds();

            instructorWindow.openQuestionModal('Unit 1');
            /** @type {HTMLSelectElement} */ (document.getElementById('question-type')).value = 'short-answer';
            instructorWindow.updateQuestionForm();
            /** @type {HTMLTextAreaElement} */ (document.getElementById('question-text')).value = 'What is glycolysis?';
            /** @type {HTMLTextAreaElement} */ (document.getElementById('sa-answer')).value = 'A pathway that oxidizes glucose.';
            await instructorWindow.saveQuestion();

            window.confirm = () => true;
            await instructorWindow.deleteQuestion('Unit 1', 'q_existing');

            const fallbackTf = instructorWindow.createFallbackAIContent('true-false', 'Unit 1');
            const fallbackMc = instructorWindow.createFallbackAIContent('multiple-choice', 'Unit 1');
            const fallbackSa = instructorWindow.createFallbackAIContent('short-answer', 'Unit 1');
            if (!fallbackTf.question || !fallbackMc.options || !fallbackSa.answer) {
                throw new Error('Expected fallback AI content for all supported types');
            }
            instructorWindow.checkLectureNotesUploaded('Unit 1');
        }, COURSE_ID);

        await expect.poll(() => captured.cleanupRequests.length).toBe(1);
        await expect.poll(() => captured.createdQuestions.length).toBe(1);
        expect(captured.createdQuestions[0].questionType).toBe('short-answer');
    });

    test('covers document download, delete cleanup, standalone topic modal, helper fallbacks, and empty course state', async ({ page }) => {
        const captured = await openInstructorDocuments(page);

        await page.evaluate(() => {
            const instructorWindow = /** @type {InstructorWindow} */ (window);
            URL.createObjectURL = () => 'blob:focused-download';
            URL.revokeObjectURL = () => {};
            instructorWindow.downloadDocument('doc_lecture');
        });
        await expect(page.locator('.notification')).not.toContainText('Error downloading document');

        page.on('dialog', (dialog) => dialog.accept());
        await page.locator('button.action-button.delete').filter({ hasText: 'Delete' }).first().click();
        await expect.poll(() => captured.deletedDocuments.length).toBe(1);
        await expect.poll(() => captured.removedDocuments.length).toBe(1);

        const modalTopics = page.evaluate(async (courseId) => {
            const instructorWindow = /** @type {InstructorWindow} */ (window);
            const promise = instructorWindow.openTopicReviewModal(
                courseId,
                'Manual source',
                ['Glycolysis'],
                ['Glycolysis', 'Fermentation'],
                'Unit 2'
            );
            const input = /** @type {HTMLInputElement} */ (document.querySelector('#topic-review-new-input'));
            const addButton = /** @type {HTMLButtonElement} */ (document.querySelector('#topic-review-add-btn'));
            const saveButton = /** @type {HTMLButtonElement} */ (document.querySelector('#topic-review-save-btn'));
            input.value = 'Lactate';
            addButton.click();
            saveButton.click();
            return promise;
        }, COURSE_ID);

        await expect(page.locator('#topic-review-modal')).not.toHaveClass(/show/);
        await expect(modalTopics).resolves.toEqual(expect.arrayContaining([
            expect.objectContaining({ topic: 'Fermentation', unitId: 'Unit 2', source: 'scraped' }),
            expect.objectContaining({ topic: 'Lactate', unitId: 'Unit 2', source: 'manual' }),
        ]));

        await page.evaluate(() => {
            const instructorWindow = /** @type {InstructorWindow} */ (window);
            instructorWindow.showEmptyCourseState();
            instructorWindow.updateFileStatus('lecture-notes', 'Unit 1', 'uploaded', 'notes.txt');
            instructorWindow.openRenameUnitInput('Missing Unit');
            instructorWindow.cancelRenameUnit('Missing Unit');
            instructorWindow.closeDocumentModal();
            instructorWindow.closeQuestionReviewModal();
            instructorWindow.stopPublishStatusPolling();
            instructorWindow.saveAssessment('Missing Unit');
        });

        await expect(page.locator('#course-title')).toHaveText('No Course Found');
        await expect(page.locator('.empty-course-state')).toContainText('Go to Onboarding');
    });
});
