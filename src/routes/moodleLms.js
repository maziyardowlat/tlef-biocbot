const express = require('express');

const {
    MAX_DOCUMENT_BYTES,
    SUPPORTED_DOCUMENT_MIME_TYPES,
    ingestFileBuffer,
    isSupportedDocumentMimeType
} = require('../services/documentIngestion');
const { resolveCourseAi, sendLlmKeyError } = require('./llmKeyMiddleware');
const { requireManagedCourse } = require('./canvasLms');
const { createImportProgressStream } = require('./lmsImportProgress');
const { createLmsImportDiagnostics } = require('../services/lmsImportDiagnostics');

function normalizeMoodleFile(file = {}) {
    const mimeType = file.mimeType || '';
    return {
        id: String(file.id ?? ''),
        name: file.name || file.filename || `Moodle file ${file.id ?? ''}`,
        filename: file.filename || file.name || '',
        mimeType,
        size: Number(file.size) || 0,
        createdAt: file.createdAt || null,
        updatedAt: file.updatedAt || null,
        supported: isSupportedDocumentMimeType(mimeType)
            && Number(file.size || 0) <= MAX_DOCUMENT_BYTES
    };
}

function getMoodleFileSource(course = {}) {
    return course.lmsFileSources?.moodle
        || (course.lmsSync?.provider === 'moodle' ? course.lmsSync : null);
}

function createMoodleLmsRouter(
    integration,
    {
        ingestFile = ingestFileBuffer,
        resolveAi = resolveCourseAi
    } = {}
) {
    const router = express.Router();
    const { api: moodle, config } = integration;
    const requireMoodleAuth = moodle.requireAuth(config);

    router.use(express.json());
    router.use('/auth', moodle.createAuthRouter(config));

    router.get('/status', requireMoodleAuth, (req, res) => {
        res.json({ success: true, connected: true, provider: 'moodle' });
    });

    /**
     * Where to go in Moodle to get a token. Deliberately not behind
     * `requireMoodleAuth` — an instructor needs these links precisely when they
     * have no token yet. The router is already restricted to authenticated
     * instructors, and a Moodle hostname is not a secret.
     */
    router.get('/info', (req, res) => {
        const domain = moodle.baseUrl(config.moodleDomain);
        res.json({
            success: true,
            data: {
                domain,
                // Preferences → User account → Security keys. Only visible to
                // accounts holding moodle/webservice:createtoken.
                tokenUrl: `${domain}/user/managetoken.php`,
                // Site administration → Server → Web services → Manage tokens.
                // The fallback when the page above is missing, and the path an
                // admin has to use since their own Security keys page does not
                // generate tokens for them.
                manageTokensUrl: `${domain}/admin/webservice/tokens.php`
            }
        });
    });

    router.get('/courses', requireMoodleAuth, async (req, res, next) => {
        try {
            const courses = await moodle.getCourses(req.moodleApi);
            res.json({ success: true, data: courses });
        } catch (error) {
            next(error);
        }
    });

    router.get('/courses/:moodleCourseId/files', requireMoodleAuth, async (req, res, next) => {
        try {
            const files = await moodle.getCourseFiles(req.moodleApi, req.params.moodleCourseId);
            res.json({ success: true, data: (files || []).map(normalizeMoodleFile) });
        } catch (error) {
            next(error);
        }
    });

    router.get('/courses/:biocbotCourseId/link', requireMoodleAuth, async (req, res, next) => {
        try {
            const course = await requireManagedCourse(req, res, req.params.biocbotCourseId);
            if (!course) return;
            res.json({
                success: true,
                data: {
                    courseId: course.courseId,
                    lmsSync: getMoodleFileSource(course)
                }
            });
        } catch (error) {
            next(error);
        }
    });

    router.put('/courses/:biocbotCourseId/link', requireMoodleAuth, async (req, res, next) => {
        try {
            const course = await requireManagedCourse(req, res, req.params.biocbotCourseId);
            if (!course) return;

            const moodleCourseId = String(req.body.moodleCourseId || '').trim();
            if (!moodleCourseId) {
                return res.status(400).json({ success: false, message: 'moodleCourseId is required' });
            }
            const enrolledCourses = await moodle.getCourses(req.moodleApi);
            const moodleCourse = enrolledCourses.find((candidate) => String(candidate.id) === moodleCourseId);
            if (!moodleCourse) {
                return res.status(403).json({
                    success: false,
                    message: 'The connected Moodle account is not enrolled in that course'
                });
            }
            const now = new Date();
            const lmsSync = {
                provider: 'moodle',
                courseId: String(moodleCourse.id),
                name: moodleCourse.name || '',
                code: moodleCourse.code || '',
                linkedAt: now,
                linkedBy: req.user.userId
            };
            await req.app.locals.db.collection('courses').updateOne(
                { courseId: course.courseId },
                { $set: { 'lmsFileSources.moodle': lmsSync, updatedAt: now } }
            );
            res.json({ success: true, data: { courseId: course.courseId, lmsSync } });
        } catch (error) {
            next(error);
        }
    });

    router.post('/courses/:biocbotCourseId/import-file', requireMoodleAuth, async (req, res, next) => {
        let progress = null;
        let diagnostics = null;
        try {
            const db = req.app.locals.db;
            const course = await requireManagedCourse(req, res, req.params.biocbotCourseId);
            if (!course) return;
            const moodleSource = getMoodleFileSource(course);
            if (!moodleSource?.courseId) {
                return res.status(400).json({ success: false, message: 'This BiocBot course is not linked to Moodle' });
            }

            const moodleFileId = String(req.body.moodleFileId || '').trim();
            const lectureName = String(req.body.lectureName || '').trim();
            const documentType = String(req.body.documentType || 'lecture-notes').trim();
            if (!moodleFileId || !lectureName) {
                return res.status(400).json({
                    success: false,
                    message: 'moodleFileId and lectureName are required'
                });
            }
            if (!course.lectures?.some((lecture) => lecture.name === lectureName)) {
                return res.status(400).json({ success: false, message: 'Selected BiocBot unit does not exist' });
            }

            const moodleCourseId = String(moodleSource.courseId);
            const files = await moodle.getCourseFiles(req.moodleApi, moodleCourseId);
            const file = files.find((candidate) => String(candidate.id) === moodleFileId);
            if (!file) {
                return res.status(404).json({ success: false, message: 'Moodle course file not found' });
            }
            const normalized = normalizeMoodleFile(file);
            if (!isSupportedDocumentMimeType(normalized.mimeType)) {
                return res.status(400).json({ success: false, message: 'Moodle file type is not supported by BiocBot' });
            }
            if (normalized.size > MAX_DOCUMENT_BYTES) {
                return res.status(400).json({ success: false, message: 'Moodle file exceeds the 50 MB limit' });
            }

            const existing = await db.collection('documents').findOne({
                courseId: course.courseId,
                'metadata.lms.provider': 'moodle',
                'metadata.lms.externalCourseId': moodleCourseId,
                'metadata.lms.externalFileId': String(file.id)
            });
            if (existing) {
                return res.status(409).json({
                    success: false,
                    code: 'MOODLE_FILE_ALREADY_IMPORTED',
                    message: 'This Moodle file has already been imported',
                    data: { documentId: existing.documentId }
                });
            }

            const ai = await resolveAi(req, res, course.courseId);
            if (!ai) return;

            // Everything that can still fail with a meaningful HTTP status has
            // now passed, so it is safe to commit the response to 200 + stream.
            diagnostics = createLmsImportDiagnostics({
                req,
                provider: 'moodle',
                biocbotCourseId: course.courseId,
                externalCourseId: moodleCourseId,
                externalFileId: moodleFileId,
                fileUrl: file.raw?.content?.fileurl || file.raw?.fileurl || file.fileurl,
                lmsDomain: config.moodleDomain
            });
            progress = createImportProgressStream(req, res, { diagnostics });
            if (progress) progress.step('download', `${normalized.name} from Moodle`);
            else diagnostics.step('download', { detail: `${normalized.name} from Moodle` });
            const download = await moodle.downloadFile(
                req.moodleApi,
                moodleCourseId,
                moodleFileId,
                { maxBytes: MAX_DOCUMENT_BYTES }
            );
            const buffer = Buffer.from(download.data);
            const { result, courseResult, qdrantResult } = await ingestFile({
                db,
                ai,
                buffer,
                onProgress: progress?.onIngestionProgress || diagnostics.onIngestionProgress,
                originalName: normalized.filename || normalized.name,
                mimeType: normalized.mimeType,
                size: normalized.size || buffer.length,
                courseId: course.courseId,
                lectureName,
                documentType,
                instructorId: req.user.userId,
                title: req.body.title || normalized.name,
                metadata: {
                    description: req.body.description || '',
                    lms: {
                        provider: 'moodle',
                        externalCourseId: moodleCourseId,
                        externalFileId: String(file.id),
                        externalUpdatedAt: normalized.updatedAt,
                        importedAt: new Date()
                    }
                }
            });

            const data = {
                documentId: result.documentId,
                filename: result.filename,
                lectureName,
                linkedToCourse: courseResult.success,
                qdrantProcessed: qdrantResult?.success === true,
                chunksStored: qdrantResult?.chunksStored || 0
            };
            if (progress) return progress.done(data);
            diagnostics.done(data);
            res.status(201).json({
                success: true,
                message: 'Moodle file imported into BiocBot',
                data
            });
        } catch (error) {
            if (progress) return progress.fail(error);
            diagnostics?.fail(error);
            if (sendLlmKeyError(res, error)) return;
            next(error);
        }
    });

    router.use((error, req, res, next) => {
        if (res.headersSent) return next(error);
        console.error('Moodle LMS route error:', error);
        const status = error.statusCode && error.statusCode >= 400 && error.statusCode < 600
            ? error.statusCode
            : (error.code === 'DOCUMENT_TOO_LARGE' || error.code === 'UNSUPPORTED_DOCUMENT_TYPE' ? 400 : 502);
        res.status(status).json({
            success: false,
            provider: 'moodle',
            message: error.message || 'Moodle integration failed'
        });
    });

    return router;
}

module.exports = {
    createMoodleLmsRouter,
    getMoodleFileSource,
    normalizeMoodleFile
};
