const crypto = require('crypto');
const express = require('express');

const { getGradeSource } = require('../services/lmsGradeImport');
const { syncCourseRoster } = require('../services/lmsRosterMatch');
const {
    requireManagedCourseMiddleware,
    requireSelectedProviderAuth
} = require('./lmsGrades');

const DEFAULT_PRUNE_MIN_INTEGRATION_COVERAGE = 0.8;

function pruneCoverageThreshold(env = process.env) {
    const configured = Number(env.LMS_ROSTER_PRUNE_MIN_INTEGRATION_COVERAGE);
    return Number.isFinite(configured) && configured >= 0 && configured <= 1
        ? configured
        : DEFAULT_PRUNE_MIN_INTEGRATION_COVERAGE;
}

function effectiveRosterSource(course = {}) {
    if (course.rosterSource) return course.rosterSource;
    // Legacy academic-linked courses predate rosterSource. Treating them as
    // manual would let Canvas claim them before the migration field is written.
    if (Array.isArray(course.academicSync?.sectionIds) && course.academicSync.sectionIds.length) {
        return 'academicSync';
    }
    return 'manual';
}

function buildPruneSafety(coverage = {}, provider = 'canvas', env = process.env) {
    const total = Number(coverage.total) || 0;
    const integrationId = Number(coverage.integrationId) || 0;
    const integrationIdRatio = total ? integrationId / total : 0;
    const threshold = pruneCoverageThreshold(env);
    const allowed = provider === 'canvas' && total > 0 && integrationIdRatio >= threshold;

    return {
        allowed,
        threshold,
        integrationIdRatio,
        reason: allowed
            ? null
            : (total === 0
                ? 'empty-roster'
                : (provider !== 'canvas' ? 'provider-not-supported' : 'insufficient-integration-id-coverage'))
    };
}

async function claimCanvasRosterOwnership(db, course) {
    if (effectiveRosterSource(course) === 'academicSync') {
        return false;
    }

    const result = await db.collection('courses').updateOne(
        {
            courseId: course.courseId,
            rosterSource: { $ne: 'academicSync' },
            'academicSync.sectionIds.0': { $exists: false }
        },
        { $set: { rosterSource: 'canvas', updatedAt: new Date() } }
    );
    return result.matchedCount > 0;
}

async function persistCanvasSync({ db, course, externalCourseId, report, syncedBy }) {
    const mappings = await db.collection('lms_identity_mappings').find({
        courseId: course.courseId,
        provider: 'canvas',
        externalCourseId: String(externalCourseId)
    }).toArray();
    const freshCourse = await db.collection('courses').findOne({ courseId: course.courseId });
    const existingEnrollment = freshCourse?.studentEnrollment || {};
    const now = new Date();
    const syncToken = crypto.randomUUID();
    const prune = buildPruneSafety(report.coverage, 'canvas');
    const set = {
        rosterSource: 'canvas',
        lmsRosterSync: {
            provider: 'canvas',
            externalCourseId: String(externalCourseId),
            lastSyncAt: now,
            syncedBy: String(syncedBy),
            syncToken,
            coverage: report.coverage,
            prune,
            unmatchedLocalUserIds: report.unmatchedBiocBotStudents.map((student) => String(student.localUserId))
        },
        updatedAt: now
    };

    for (const mapping of mappings) {
        const localUserId = String(mapping.localUserId);
        set[`studentEnrollment.${localUserId}`] = {
            ...(existingEnrollment[localUserId] || {}),
            enrolled: true,
            source: 'canvas',
            externalUserId: String(mapping.externalUserId),
            syncedAt: now,
            updatedAt: now
        };
        delete set[`studentEnrollment.${localUserId}`].droppedAt;
    }

    await db.collection('courses').updateOne(
        { courseId: course.courseId, rosterSource: 'canvas' },
        { $set: set }
    );

    return { syncToken, prune };
}

function createLmsRosterSyncRouter(integration, dependencies = {}) {
    const router = express.Router();
    const matchRoster = dependencies.matchRoster || syncCourseRoster;

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
                if (effectiveRosterSource(course) === 'academicSync') {
                    return res.status(409).json({
                        success: false,
                        provider,
                        code: 'ROSTER_SOURCE_CONFLICT',
                        message: 'This course roster is managed by Academic Sync and cannot also be managed by Canvas'
                    });
                }

                const source = getGradeSource(course, provider);
                if (!source) {
                    return res.status(400).json({
                        success: false,
                        provider,
                        message: 'Link this BiocBot course to a Canvas course before syncing its roster'
                    });
                }

                if (!await claimCanvasRosterOwnership(req.app.locals.db, course)) {
                    return res.status(409).json({
                        success: false,
                        provider,
                        code: 'ROSTER_SOURCE_CONFLICT',
                        message: 'Another roster source claimed this course; reload before trying again'
                    });
                }

                const report = await matchRoster({
                    db: req.app.locals.db,
                    course: { ...course, rosterSource: 'canvas' },
                    provider,
                    client: req.canvasApi,
                    externalCourseId: source.courseId,
                    matchedBy: req.user.userId
                });
                const safety = await persistCanvasSync({
                    db: req.app.locals.db,
                    course,
                    externalCourseId: source.courseId,
                    report,
                    syncedBy: req.user.userId
                });

                return res.json({
                    success: true,
                    message: 'Canvas roster synced',
                    data: { ...report, rosterSource: 'canvas', ...safety }
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

                const candidateIds = [...new Set((sync.unmatchedLocalUserIds || []).map(String))];
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

    router.use((error, req, res, next) => {
        if (res.headersSent) return next(error);
        console.error('LMS roster sync route error:', error);
        const status = error.statusCode && error.statusCode >= 400 && error.statusCode < 600
            ? error.statusCode
            : 502;
        return res.status(status).json({
            success: false,
            provider: req.lmsGradeProvider || null,
            message: error.message || 'LMS roster sync failed'
        });
    });

    return router;
}

module.exports = {
    DEFAULT_PRUNE_MIN_INTEGRATION_COVERAGE,
    buildPruneSafety,
    createLmsRosterSyncRouter,
    effectiveRosterSource,
    persistCanvasSync,
    pruneCoverageThreshold
};
