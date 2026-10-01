const express = require('express');

const CourseModel = require('../models/Course');
const { getGradeSource, setGradeSource } = require('../services/lmsGradeImport');
const { confirmLeftCanvasCourse, syncCourseRoster } = require('../services/lmsRosterMatch');
const { canvasEnrollmentOf, clearRosterEntries } = require('../services/lmsRosterEnrollment');
const {
    DEFAULT_PRUNE_MIN_INTEGRATION_COVERAGE,
    buildPruneSafety,
    describeCanvasEnrollment,
    effectiveRosterSource,
    isDropCandidate,
    persistCanvasSync,
    pruneCoverageThreshold,
    recordClassListSyncStatus,
    rosterExternalCourseId,
    runCanvasRosterSync
} = require('../services/canvasRosterSync');
const {
    requireManagedCourseMiddleware,
    requireSelectedProviderAuth
} = require('./lmsGrades');
const { lmsErrorResponse } = require('../services/lmsErrors');

function rosterSyncBusy(res, error) {
    return res.status(409).json({ success: false, code: error.code, message: error.message });
}

function createLmsRosterSyncRouter(integration, dependencies = {}) {
    const router = express.Router();
    const matchRoster = dependencies.matchRoster || syncCourseRoster;
    const confirmLeft = dependencies.confirmLeft || confirmLeftCanvasCourse;
    const saveGradeSource = dependencies.saveGradeSource || setGradeSource;
    // A stored token is not proof the account teaches a course, so the class
    // list only links courses Canvas lists the instructor as teaching.
    const listTeacherCourses = dependencies.listTeacherCourses
        || ((req) => req.lmsGradeIntegration.api.getCourses(req.canvasApi, { enrollment_type: 'teacher' }));
    const canvasConfigured = () => Boolean(integration.canvas);

    router.use(express.json());

    router.post(
        '/courses/:courseId/sync',
        requireManagedCourseMiddleware,
        requireSelectedProviderAuth(integration),
        async (req, res, next) => {
            try {
                const course = req.lmsGradeCourse;
                const provider = req.lmsGradeProvider;
                if (provider !== 'canvas') {
                    return res.status(400).json({
                        success: false,
                        provider,
                        code: 'ROSTER_PROVIDER_NOT_SUPPORTED',
                        message: 'Enrollment roster sync currently requires Canvas integration_id coverage'
                    });
                }
                const enrollment = canvasEnrollmentOf(course);
                const externalCourseId = rosterExternalCourseId(course, enrollment);
                if (!externalCourseId) {
                    return res.status(400).json({
                        success: false,
                        provider,
                        message: 'Link this BiocBot course to a Canvas course before syncing its roster'
                    });
                }

                const report = await runCanvasRosterSync({
                    db: req.app.locals.db,
                    course,
                    client: req.canvasApi,
                    syncedBy: req.user.userId,
                    enrollment,
                    externalCourseId,
                    matchRoster,
                    confirmLeft
                });
                if (!report) {
                    return res.status(404).json({
                        success: false,
                        provider,
                        message: 'Course not found while claiming Canvas roster ownership'
                    });
                }
                if (enrollment) {
                    await recordClassListSyncStatus(req.app.locals.db, course.courseId, { trigger: 'manual' });
                }

                return res.json({
                    success: true,
                    message: 'Canvas roster synced',
                    data: report
                });
            } catch (error) {
                if (error.code === 'ROSTER_SYNC_IN_PROGRESS') return rosterSyncBusy(res, error);
                return next(error);
            }
        }
    );

    router.get(
        '/courses/:courseId/class-list',
        requireManagedCourseMiddleware,
        async (req, res, next) => {
            try {
                return res.json({
                    success: true,
                    data: await describeCanvasEnrollment(req.app.locals.db, req.lmsGradeCourse, {
                        canvasConfigured: canvasConfigured()
                    })
                });
            } catch (error) {
                return next(error);
            }
        }
    );

    /**
     * Turns the class list on (or points it at another Canvas course): reads
     * the roster first and saves the setting only once that read succeeds, so
     * a Canvas failure leaves the course as it was. The same Canvas course
     * becomes the grade source, keeping enrollment and grades on one course.
     */
    router.put(
        '/courses/:courseId/class-list',
        requireManagedCourseMiddleware,
        requireSelectedProviderAuth(integration),
        async (req, res, next) => {
            try {
                const db = req.app.locals.db;
                const course = req.lmsGradeCourse;
                const provider = req.lmsGradeProvider;
                if (provider !== 'canvas') {
                    return res.status(400).json({
                        success: false,
                        provider,
                        code: 'ROSTER_PROVIDER_NOT_SUPPORTED',
                        message: 'Class lists can only come from Canvas'
                    });
                }
                const externalCourseId = String(req.body.externalCourseId || '').trim();
                if (!externalCourseId) {
                    return res.status(400).json({ success: false, provider, message: 'externalCourseId is required' });
                }

                const teacherCourses = await listTeacherCourses(req);
                const externalCourse = teacherCourses.find((candidate) => String(candidate.id) === externalCourseId);
                if (!externalCourse) {
                    return res.status(403).json({
                        success: false,
                        provider,
                        code: 'CANVAS_COURSE_NOT_TAUGHT',
                        message: 'Your Canvas account is not a teacher in that Canvas course'
                    });
                }

                const previous = canvasEnrollmentOf(course);
                const now = new Date();
                const settings = {
                    enabled: true,
                    externalCourseId,
                    name: externalCourse.name || '',
                    code: externalCourse.code || '',
                    allowCodeJoin: previous ? previous.allowCodeJoin : true,
                    enabledBy: String(req.user.userId),
                    enabledAt: previous?.externalCourseId === externalCourseId && previous.enabledAt
                        ? previous.enabledAt
                        : now
                };

                const report = await runCanvasRosterSync({
                    db,
                    course,
                    client: req.canvasApi,
                    syncedBy: req.user.userId,
                    enrollment: canvasEnrollmentOf({ canvasEnrollment: settings }),
                    externalCourseId,
                    matchRoster,
                    confirmLeft
                });
                if (!report) {
                    return res.status(404).json({ success: false, provider, message: 'BiocBot course not found' });
                }

                const gradeSource = getGradeSource(course, 'canvas');
                if (!gradeSource || gradeSource.inherited || gradeSource.courseId !== externalCourseId) {
                    await saveGradeSource({
                        db,
                        course,
                        provider: 'canvas',
                        externalCourse,
                        linkedBy: req.user.userId
                    });
                }
                await db.collection('courses').updateOne(
                    { courseId: course.courseId },
                    {
                        $set: {
                            canvasEnrollment: {
                                ...settings,
                                syncStatus: {
                                    lastAttemptAt: now,
                                    lastSuccessAt: now,
                                    lastTrigger: 'link',
                                    lastError: null
                                }
                            },
                            updatedAt: now
                        }
                    }
                );

                const fresh = await CourseModel.getCourseById(db, course.courseId);
                return res.json({
                    success: true,
                    message: 'Canvas class list linked',
                    data: {
                        sync: report,
                        classList: await describeCanvasEnrollment(db, fresh, { canvasConfigured: canvasConfigured() })
                    }
                });
            } catch (error) {
                if (error.code === 'ROSTER_SYNC_IN_PROGRESS') return rosterSyncBusy(res, error);
                return next(error);
            }
        }
    );

    /** Turns the course-code fallback on or off while the class list is on. */
    router.patch(
        '/courses/:courseId/class-list',
        requireManagedCourseMiddleware,
        async (req, res, next) => {
            try {
                if (typeof req.body.allowCodeJoin !== 'boolean') {
                    return res.status(400).json({ success: false, message: 'allowCodeJoin must be true or false' });
                }
                const db = req.app.locals.db;
                const courseId = req.lmsGradeCourse.courseId;
                const update = await db.collection('courses').updateOne(
                    { courseId, 'canvasEnrollment.enabled': true },
                    { $set: { 'canvasEnrollment.allowCodeJoin': req.body.allowCodeJoin, updatedAt: new Date() } }
                );
                if (!update.matchedCount) {
                    return res.status(409).json({
                        success: false,
                        code: 'CLASS_LIST_OFF',
                        message: 'The course code can only be turned off while the Canvas class list is on'
                    });
                }
                const fresh = await CourseModel.getCourseById(db, courseId);
                return res.json({
                    success: true,
                    message: req.body.allowCodeJoin ? 'Course code turned on' : 'Course code turned off',
                    data: await describeCanvasEnrollment(db, fresh, { canvasConfigured: canvasConfigured() })
                });
            } catch (error) {
                return next(error);
            }
        }
    );

    /**
     * Turns the class list off. Students already in the course keep their
     * access; new students go back to joining with the course code.
     */
    router.delete(
        '/courses/:courseId/class-list',
        requireManagedCourseMiddleware,
        async (req, res, next) => {
            try {
                const db = req.app.locals.db;
                const courseId = req.lmsGradeCourse.courseId;
                const now = new Date();
                const update = await db.collection('courses').updateOne(
                    { courseId, 'canvasEnrollment.enabled': true },
                    {
                        $set: {
                            'canvasEnrollment.enabled': false,
                            'canvasEnrollment.disabledAt': now,
                            'canvasEnrollment.disabledBy': String(req.user.userId),
                            rosterSource: 'manual',
                            updatedAt: now
                        }
                    }
                );
                if (update.matchedCount) await clearRosterEntries(db, courseId);

                const fresh = await CourseModel.getCourseById(db, courseId);
                return res.json({
                    success: true,
                    message: 'Canvas class list turned off. Students already in the course keep their access.',
                    data: await describeCanvasEnrollment(db, fresh, { canvasConfigured: canvasConfigured() })
                });
            } catch (error) {
                return next(error);
            }
        }
    );

    router.post(
        '/courses/:courseId/drop-unmatched',
        requireManagedCourseMiddleware,
        async (req, res, next) => {
            try {
                const db = req.app.locals.db;
                const course = await db.collection('courses').findOne({ courseId: req.params.courseId });
                const sync = course?.lmsRosterSync;
                const safety = buildPruneSafety(sync?.coverage, sync?.provider);

                if (effectiveRosterSource(course) !== 'canvas') {
                    return res.status(409).json({ success: false, code: 'ROSTER_SOURCE_CONFLICT', message: 'Canvas does not own this course roster' });
                }
                if (!safety.allowed) {
                    return res.status(409).json({
                        success: false,
                        code: 'ROSTER_PRUNE_UNSAFE',
                        message: 'Drop is disabled because the latest Canvas roster was empty or lacked sufficient integration_id coverage',
                        data: { prune: safety }
                    });
                }
                if (!req.body.syncToken || req.body.syncToken !== sync.syncToken) {
                    return res.status(409).json({ success: false, code: 'ROSTER_SYNC_STALE', message: 'The roster changed; sync again before dropping students' });
                }
                if (sync.prunedSyncToken === sync.syncToken) {
                    return res.status(409).json({ success: false, code: 'ROSTER_PRUNE_ALREADY_APPLIED', message: 'This roster sync was already applied' });
                }

                // Syncs stored before drops were limited to this Canvas course
                // carry no candidate list; they have to be re-run, not guessed at.
                if (!Array.isArray(sync.dropCandidateIds)) {
                    return res.status(409).json({ success: false, code: 'ROSTER_SYNC_STALE', message: 'Sync the Canvas roster again before dropping students' });
                }
                // An instructor who changed a student's access by hand since the
                // sync has taken that student out of Canvas's hands.
                const candidateIds = [...new Set(sync.dropCandidateIds.map(String))].filter((localUserId) => {
                    const enrollment = course.studentEnrollment?.[localUserId];
                    return enrollment?.source === 'canvas' && enrollment.enrolled !== false;
                });
                const now = new Date();
                const set = {
                    'lmsRosterSync.lastPrunedAt': now,
                    'lmsRosterSync.lastPrunedBy': String(req.user.userId),
                    'lmsRosterSync.lastPrunedCount': candidateIds.length,
                    'lmsRosterSync.prunedSyncToken': sync.syncToken,
                    updatedAt: now
                };
                for (const localUserId of candidateIds) {
                    set[`studentEnrollment.${localUserId}`] = {
                        ...(course.studentEnrollment?.[localUserId] || {}),
                        enrolled: false,
                        source: 'canvas',
                        droppedAt: now,
                        syncedAt: now,
                        updatedAt: now
                    };
                }

                const update = await db.collection('courses').updateOne(
                    { courseId: course.courseId, rosterSource: 'canvas', 'lmsRosterSync.syncToken': sync.syncToken },
                    { $set: set }
                );
                if (!update.matchedCount) {
                    return res.status(409).json({
                        success: false,
                        code: 'ROSTER_SYNC_STALE',
                        message: 'The roster changed while applying drops; sync again before retrying'
                    });
                }

                return res.json({
                    success: true,
                    message: `${candidateIds.length} student${candidateIds.length === 1 ? '' : 's'} marked as dropped`,
                    data: { droppedCount: candidateIds.length, droppedAt: now }
                });
            } catch (error) {
                return next(error);
            }
        }
    );

    router.use(async (error, req, res, next) => {
        if (res.headersSent) return next(error);
        console.error('LMS roster sync route error:', error);
        try {
            const { status, body } = await lmsErrorResponse(error, {
                provider: req.lmsGradeProvider || null,
                config: req.lmsGradeIntegration?.config,
                req,
                fallbackMessage: 'LMS roster sync failed'
            });
            return res.status(status).json(body);
        } catch (responseError) {
            return next(responseError);
        }
    });

    return router;
}

module.exports = {
    DEFAULT_PRUNE_MIN_INTEGRATION_COVERAGE,
    buildPruneSafety,
    createLmsRosterSyncRouter,
    effectiveRosterSource,
    isDropCandidate,
    persistCanvasSync,
    pruneCoverageThreshold
};
