const express = require('express');

const CourseModel = require('../models/Course');
const { hasSystemAdminAccess } = require('../services/authorization');
const {
    MAX_DOCUMENT_BYTES,
    SUPPORTED_DOCUMENT_MIME_TYPES,
    ingestFileBuffer,
    isSupportedDocumentMimeType
} = require('../services/documentIngestion');
const { resolveCourseAi, sendLlmKeyError } = require('./llmKeyMiddleware');
const { createImportProgressStream } = require('./lmsImportProgress');

function normalizeCanvasFile(file = {}) {
    const mimeType = file.mimeType || '';
    return {
        id: String(file.id ?? ''),
        name: file.name || file.filename || `Canvas file ${file.id ?? ''}`,
        filename: file.filename || file.name || '',
        mimeType,
        size: Number(file.size) || 0,
        createdAt: file.createdAt || null,
        updatedAt: file.updatedAt || null,
        supported: isSupportedDocumentMimeType(mimeType)
            && Number(file.size || 0) <= MAX_DOCUMENT_BYTES
    };
}

async function requireManagedCourse(req, res, courseId) {
    const db = req.app.locals.db;
    const user = req.user;
    const course = await CourseModel.getCourseById(db, courseId);

    if (!course) {
        res.status(404).json({ success: false, message: 'BiocBot course not found' });
        return null;
    }

    const hasAccess = hasSystemAdminAccess(user)
        || (user?.role === 'instructor'
            && await CourseModel.userHasCourseAccess(db, courseId, user.userId, 'instructor'));
    if (!hasAccess) {
        res.status(403).json({ success: false, message: 'You can only manage LMS imports for your own courses' });
        return null;
    }

    return course;
}

function getCanvasFileSource(course = {}) {
    return course.lmsFileSources?.canvas
        || (course.lmsSync?.provider === 'canvas' ? course.lmsSync : null);
}

function createCanvasLmsRouter(
    integration,
    {
        ingestFile = ingestFileBuffer,
        resolveAi = resolveCourseAi
    } = {}
) {
    const router = express.Router();
    const { api: canvas, config } = integration;
    const requireCanvasAuth = canvas.requireAuth(config);

    router.use(express.json());
    router.use('/auth', (req, res, next) => {
        const returnTo = req.query?.returnTo;
        if (returnTo && (!returnTo.startsWith('/') || returnTo.startsWith('//'))) {
            return res.status(400).send('Canvas OAuth returnTo must be a local application path.');
        }
        next();
    }, canvas.createAuthRouter(config));

    router.get('/status', requireCanvasAuth, (req, res) => {
        res.json({ success: true, connected: true, provider: 'canvas' });
    });

    router.get('/courses', requireCanvasAuth, async (req, res, next) => {
        try {
            const courses = await canvas.getCourses(req.canvasApi, { enrollment_type: 'teacher' });
            res.json({ success: true, data: courses });
        } catch (error) {
            next(error);
        }
    });

    router.get('/courses/:canvasCourseId/sections', requireCanvasAuth, async (req, res, next) => {
        try {
            const sections = await canvas.getCourseSections(req.canvasApi, req.params.canvasCourseId);
            res.json({ success: true, data: sections });
        } catch (error) {
            next(error);
        }
    });

    router.get('/courses/:canvasCourseId/files', requireCanvasAuth, async (req, res, next) => {
        try {
            const files = await canvas.getCourseFiles(req.canvasApi, req.params.canvasCourseId, {
                contentTypes: SUPPORTED_DOCUMENT_MIME_TYPES,
                sort: 'updated_at',
                order: 'desc'
            });
            res.json({
                success: true,
                data: (files || []).map(normalizeCanvasFile)
            });
        } catch (error) {
            next(error);
        }
    });

    router.get('/courses/:biocbotCourseId/link', requireCanvasAuth, async (req, res, next) => {
        try {
            const course = await requireManagedCourse(req, res, req.params.biocbotCourseId);
            if (!course) return;
            res.json({
                success: true,
                data: {
                    courseId: course.courseId,
                    lmsSync: getCanvasFileSource(course)
                }
            });
        } catch (error) {
            next(error);
        }
    });

    router.put('/courses/:biocbotCourseId/link', requireCanvasAuth, async (req, res, next) => {
        try {
            const course = await requireManagedCourse(req, res, req.params.biocbotCourseId);
            if (!course) return;

            const canvasCourseId = String(req.body.canvasCourseId || '').trim();
            if (!canvasCourseId) {
                return res.status(400).json({ success: false, message: 'canvasCourseId is required' });
            }

            const teachingCourses = await canvas.getCourses(req.canvasApi, { enrollment_type: 'teacher' });
            const canvasCourse = teachingCourses.find((candidate) => String(candidate.id) === canvasCourseId);
            if (!canvasCourse) {
                return res.status(403).json({
                    success: false,
                    message: 'The connected Canvas account is not a teacher for that course'
                });
            }
            const now = new Date();
            const lmsSync = {
                provider: 'canvas',
                courseId: String(canvasCourse.id),
                name: canvasCourse.name || '',
                code: canvasCourse.code || '',
                linkedAt: now,
                linkedBy: req.user.userId
            };
            await req.app.locals.db.collection('courses').updateOne(
                { courseId: course.courseId },
                { $set: { lmsSync, 'lmsFileSources.canvas': lmsSync, updatedAt: now } }
            );
            res.json({ success: true, data: { courseId: course.courseId, lmsSync } });
        } catch (error) {
            next(error);
        }
    });

    router.post('/courses/:biocbotCourseId/import-file', requireCanvasAuth, async (req, res, next) => {
        let progress = null;
        try {
            const db = req.app.locals.db;
            const course = await requireManagedCourse(req, res, req.params.biocbotCourseId);
            if (!course) return;
            const canvasSource = getCanvasFileSource(course);
            if (!canvasSource?.courseId) {
                return res.status(400).json({ success: false, message: 'This BiocBot course is not linked to Canvas' });
            }

            const canvasFileId = String(req.body.canvasFileId || '').trim();
            const lectureName = String(req.body.lectureName || '').trim();
            const documentType = String(req.body.documentType || 'lecture-notes').trim();
            if (!canvasFileId || !lectureName) {
                return res.status(400).json({
                    success: false,
                    message: 'canvasFileId and lectureName are required'
                });
            }
            if (!course.lectures?.some((lecture) => lecture.name === lectureName)) {
                return res.status(400).json({ success: false, message: 'Selected BiocBot unit does not exist' });
            }

            const canvasCourseId = String(canvasSource.courseId);
            const files = await canvas.getCourseFiles(req.canvasApi, canvasCourseId, {
                contentTypes: SUPPORTED_DOCUMENT_MIME_TYPES
            });
            const file = files.find((candidate) => String(candidate.id) === canvasFileId);
            if (!file) {
                return res.status(404).json({ success: false, message: 'Canvas course file not found' });
            }
            const normalized = normalizeCanvasFile(file);
            if (!isSupportedDocumentMimeType(normalized.mimeType)) {
                return res.status(400).json({ success: false, message: 'Canvas file type is not supported by BiocBot' });
            }
            if (normalized.size > MAX_DOCUMENT_BYTES) {
                return res.status(400).json({ success: false, message: 'Canvas file exceeds the 50 MB limit' });
            }

            const existing = await db.collection('documents').findOne({
                courseId: course.courseId,
                'metadata.lms.provider': 'canvas',
                'metadata.lms.externalCourseId': canvasCourseId,
                'metadata.lms.externalFileId': String(file.id)
            });
            if (existing) {
                return res.status(409).json({
                    success: false,
                    code: 'CANVAS_FILE_ALREADY_IMPORTED',
                    message: 'This Canvas file has already been imported',
                    data: { documentId: existing.documentId }
                });
            }

            const ai = await resolveAi(req, res, course.courseId);
            if (!ai) return;

            // Everything that can still fail with a meaningful HTTP status has
            // now passed, so it is safe to commit the response to 200 + stream.
            progress = createImportProgressStream(req, res);
            progress?.step('download', `${normalized.name} from Canvas`);
            const download = await canvas.downloadFile(
                req.canvasApi,
                canvasCourseId,
                canvasFileId,
                { maxBytes: MAX_DOCUMENT_BYTES }
            );
            const buffer = Buffer.from(download.data);
            const { result, courseResult, qdrantResult } = await ingestFile({
                db,
                ai,
                buffer,
                onProgress: progress?.onIngestionProgress,
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
                        provider: 'canvas',
                        externalCourseId: canvasCourseId,
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
            res.status(201).json({
                success: true,
                message: 'Canvas file imported into BiocBot',
                data
            });
        } catch (error) {
            if (progress) return progress.fail(error);
            if (sendLlmKeyError(res, error)) return;
            next(error);
        }
    });

    router.use((error, req, res, next) => {
        if (res.headersSent) return next(error);
        console.error('Canvas LMS route error:', error);
        const status = error.statusCode && error.statusCode >= 400 && error.statusCode < 600
            ? error.statusCode
            : (error.code === 'DOCUMENT_TOO_LARGE' || error.code === 'UNSUPPORTED_DOCUMENT_TYPE' ? 400 : 502);
        res.status(status).json({
            success: false,
            provider: 'canvas',
            message: error.message || 'Canvas integration failed'
        });
    });

    return router;
}

module.exports = {
    createCanvasLmsRouter,
    getCanvasFileSource,
    normalizeCanvasFile,
    requireManagedCourse
};
