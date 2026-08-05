const express = require('express');

const CourseModel = require('../models/Course');
const { hasSystemAdminAccess } = require('../services/authorization');
const {
    getStoredGradeView,
    importProviderGrades,
    listGradeSources,
    normalizeProvider
} = require('../services/lmsGradeImport');

async function requireManagedCourse(req, res) {
    const db = req.app.locals.db;
    const course = await CourseModel.getCourseById(db, req.params.courseId);
    if (!course) {
        res.status(404).json({ success: false, message: 'BiocBot course not found' });
        return null;
    }

    const allowed = hasSystemAdminAccess(req.user)
        || (req.user?.role === 'instructor'
            && await CourseModel.userHasCourseAccess(db, course.courseId, req.user.userId, 'instructor'));
    if (!allowed) {
        res.status(403).json({ success: false, message: 'You can only manage grades for your own courses' });
        return null;
    }
    return course;
}

async function requireManagedCourseMiddleware(req, res, next) {
    try {
        const course = await requireManagedCourse(req, res);
        if (!course) return;
        req.lmsGradeCourse = course;
        next();
    } catch (error) {
        next(error);
    }
}

function requireSelectedProviderAuth(integration) {
    return async function selectedProviderAuth(req, res, next) {
        const provider = normalizeProvider(req.body?.provider);
        if (!provider) {
            return res.status(400).json({ success: false, message: 'provider must be canvas or moodle' });
        }
        const selected = integration[provider];
        if (!selected) {
            return res.status(404).json({
                success: false,
                provider,
                message: `${provider} integration is not configured for this BiocBot deployment`
            });
        }

        req.lmsGradeProvider = provider;
        req.lmsGradeIntegration = selected;
        return selected.api.requireAuth(selected.config)(req, res, next);
    };
}

function createLmsGradesRouter(integration, dependencies = {}) {
    const router = express.Router();
    const importGrades = dependencies.importGrades || importProviderGrades;
    const loadStoredGrades = dependencies.loadStoredGrades || getStoredGradeView;

    router.use(express.json());

    router.get('/courses/:courseId', async (req, res, next) => {
        try {
            const course = await requireManagedCourse(req, res);
            if (!course) return;

            const requested = normalizeProvider(req.query.provider);
            const sources = listGradeSources(course, integration);
            const provider = requested
                || sources.find((source) => source.linked && source.configured)?.provider
                || 'canvas';
            const view = await loadStoredGrades({ db: req.app.locals.db, course, provider });
            res.json({ success: true, data: { sources, ...view } });
        } catch (error) {
            next(error);
        }
    });

    router.post(
        '/courses/:courseId/import',
        requireManagedCourseMiddleware,
        requireSelectedProviderAuth(integration),
        async (req, res, next) => {
            try {
                const course = req.lmsGradeCourse;

                const provider = req.lmsGradeProvider;
                const selected = req.lmsGradeIntegration;
                const client = provider === 'canvas' ? req.canvasApi : req.moodleApi;
                const summary = await importGrades({
                    db: req.app.locals.db,
                    course,
                    provider,
                    api: selected.api,
                    client,
                    importedBy: req.user.userId
                });
                const view = await loadStoredGrades({
                    db: req.app.locals.db,
                    course,
                    provider
                });
                res.json({ success: true, message: 'LMS grades imported', data: { summary, ...view } });
            } catch (error) {
                next(error);
            }
        }
    );

    router.use((error, req, res, next) => {
        if (res.headersSent) return next(error);
        console.error('LMS grade route error:', error);
        const status = error.statusCode && error.statusCode >= 400 && error.statusCode < 600
            ? error.statusCode
            : 502;
        res.status(status).json({
            success: false,
            provider: req.lmsGradeProvider || null,
            message: error.message || 'LMS grade import failed'
        });
    });

    return router;
}

module.exports = {
    createLmsGradesRouter,
    requireManagedCourse,
    requireManagedCourseMiddleware,
    requireSelectedProviderAuth
};
