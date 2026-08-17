/**
 * Student Hub Canvas grade routes.
 *
 * Every route here takes BiocBot's own link id and derives the Canvas course
 * from the authorized link record. None of them accepts a Canvas course id, a
 * Canvas user id, a resolved batch, a preflight object, or an attachment URL
 * from the browser: each of those is either re-derived server-side or held in
 * the database between the two steps of an export.
 */

const express = require('express');

const CanvasGradeRecord = require('../models/CanvasGradeRecord');
const canvasGradeSync = require('../services/canvasGradeSync');

/**
 * Same-origin guard for state-changing requests.
 *
 * BiocBot has no CSRF token middleware, and the session cookie is issued with
 * `SameSite=None` in production so the browser-sync proxy setup keeps working —
 * which means the browser will attach it to cross-site requests. Checking the
 * `Origin` (falling back to `Referer`) closes that for these routes without
 * introducing a token scheme the rest of the app does not have. Requests with
 * neither header are not browser form posts and are left alone.
 *
 * @param {string[]} allowedOrigins - Additional permitted origins
 * @returns {Function} Express middleware
 */
function requireSameOrigin(allowedOrigins = []) {
    const allowed = new Set(allowedOrigins);
    return function sameOriginGuard(req, res, next) {
        if (req.method === 'GET' || req.method === 'HEAD' || req.method === 'OPTIONS') {
            return next();
        }

        const stated = req.get('origin') || req.get('referer');
        if (!stated) return next();

        let origin;
        try {
            origin = new URL(stated).origin;
        } catch (error) {
            return res.status(403).json({
                success: false,
                code: 'bad-origin',
                message: 'This request could not be verified as coming from BiocBot.'
            });
        }

        const host = req.get('host');
        const selfOrigins = host ? [`https://${host}`, `http://${host}`] : [];
        if (allowed.has(origin) || selfOrigins.includes(origin)) {
            return next();
        }

        return res.status(403).json({
            success: false,
            code: 'bad-origin',
            message: 'This request could not be verified as coming from BiocBot.'
        });
    };
}

/**
 * Routine client-side outcomes rather than faults. A course with no Canvas link
 * is the normal state for most courses — the Grades area asks about it on every
 * page load and hides itself — so logging it as an error buries the failures
 * that do matter.
 */
const UNLOGGED_CODES = new Set(['not-linked', 'invalid-integration-id', 'forbidden', 'course-not-found']);

function sendError(res, error) {
    const { statusCode, body } = canvasGradeSync.describeError(error);
    if (!UNLOGGED_CODES.has(body.code)) {
        // Deliberately terse: Canvas error bodies can carry access tokens,
        // signed attachment URLs, and submission content.
        console.error('[canvas-grades] Operation failed:', {
            code: body.code,
            statusCode,
            name: error?.name
        });
    }
    return res.status(statusCode).json(body);
}

/** Filenames come from student uploads, so they are reduced to something inert. */
function safeFilename(filename) {
    const cleaned = String(filename || 'submission')
        .replace(/[\r\n"\\]/g, '')
        .replace(/[/\\]/g, '_')
        .trim();
    return cleaned || 'submission';
}

/**
 * @param {Object} canvasIntegration - `{ api, config }` from createLmsIntegration
 * @param {Object} [options] - `{ allowedOrigins }`
 * @returns {Object} An Express router
 */
function createStudentHubCanvasGradesRouter(canvasIntegration, options = {}) {
    const router = express.Router();
    const canvasApi = canvasIntegration.api;

    router.use(express.json());
    router.use(requireSameOrigin(options.allowedOrigins || []));

    /**
     * Authorizes the caller against the BiocBot link named in the request and
     * attaches the resolved integration. Runs before the Canvas token check so
     * an unauthorized caller never reaches Canvas at all.
     */
    async function withIntegration(req, res, next) {
        try {
            const courseIntegrationId = req.body?.courseIntegrationId
                || req.query?.courseIntegrationId;
            req.canvasIntegrationContext = await canvasGradeSync.resolveCourseIntegration({
                db: req.app.locals.db,
                user: req.user,
                courseIntegrationId
            });
            return next();
        } catch (error) {
            return sendError(res, error);
        }
    }

    /** Attaches `req.canvasApi` for the connected instructor. */
    function withCanvasAuth(req, res, next) {
        return canvasApi.requireAuth(canvasIntegration.config)(req, res, next);
    }

    const scoped = [withIntegration, withCanvasAuth];

    /**
     * Resolves a BiocBot course id to the link id the rest of these routes take.
     * Lets the Student Hub avoid constructing the identifier itself.
     */
    router.get('/link/:courseId', async (req, res) => {
        try {
            const integration = await canvasGradeSync.resolveCourseIntegration({
                db: req.app.locals.db,
                user: req.user,
                courseIntegrationId: canvasGradeSync.buildCourseIntegrationId(req.params.courseId)
            });
            return res.json({
                success: true,
                data: {
                    courseIntegrationId: integration.courseIntegrationId,
                    canvasCourse: {
                        id: integration.canvasCourseId,
                        name: integration.source.name || '',
                        code: integration.source.code || '',
                        inherited: Boolean(integration.source.inherited)
                    }
                }
            });
        } catch (error) {
            return sendError(res, error);
        }
    });

    /** Assignments, read only from the linked course. */
    router.get('/assignments', ...scoped, async (req, res) => {
        try {
            const { canvasCourseId } = req.canvasIntegrationContext;
            const assignments = await canvasApi.getGradeItems(req.canvasApi, canvasCourseId);
            return res.json({
                success: true,
                data: {
                    canvasCourseId,
                    assignments: assignments.map((assignment) => canvasGradeSync.assignmentFacts(assignment))
                }
            });
        } catch (error) {
            return sendError(res, error);
        }
    });

    /** The stored table for one assignment, with no Canvas call. */
    router.get('/grades', ...scoped, async (req, res) => {
        try {
            const integration = req.canvasIntegrationContext;
            const assignment = await canvasGradeSync.loadAssignment({
                canvasApi,
                client: req.canvasApi,
                canvasCourseId: integration.canvasCourseId,
                gradeItemId: req.query.gradeItemId
            });
            const scope = canvasGradeSync.buildScope({ integration, assignment });
            const rows = await CanvasGradeRecord.listForAssignment(req.app.locals.db, scope);
            return res.json({
                success: true,
                data: {
                    assignment: canvasGradeSync.assignmentFacts(assignment),
                    records: rows.map(CanvasGradeRecord.toClientView)
                }
            });
        } catch (error) {
            return sendError(res, error);
        }
    });

    router.post('/grades/import', ...scoped, async (req, res) => {
        try {
            const data = await canvasGradeSync.importGrades({
                db: req.app.locals.db,
                canvasApi,
                client: req.canvasApi,
                integration: req.canvasIntegrationContext,
                gradeItemId: req.body.gradeItemId,
                actorId: req.user.userId
            });
            return res.json({ success: true, message: 'Canvas grades imported', data });
        } catch (error) {
            return sendError(res, error);
        }
    });

    router.post('/submissions/import', ...scoped, async (req, res) => {
        try {
            const data = await canvasGradeSync.importSubmissions({
                db: req.app.locals.db,
                canvasApi,
                client: req.canvasApi,
                integration: req.canvasIntegrationContext,
                gradeItemId: req.body.gradeItemId,
                actorId: req.user.userId
            });
            return res.json({ success: true, message: 'Canvas submissions imported', data });
        } catch (error) {
            return sendError(res, error);
        }
    });

    /** Saves one student's local draft score and comment. Never touches Canvas. */
    router.put('/grades/draft', ...scoped, async (req, res) => {
        try {
            const integration = req.canvasIntegrationContext;
            const assignment = await canvasGradeSync.loadAssignment({
                canvasApi,
                client: req.canvasApi,
                canvasCourseId: integration.canvasCourseId,
                gradeItemId: req.body.gradeItemId
            });
            const scope = canvasGradeSync.buildScope({ integration, assignment });
            const facts = canvasGradeSync.assignmentFacts(assignment);

            const appUserId = String(req.body.appUserId || '').trim();
            if (!appUserId) {
                return res.status(400).json({
                    success: false,
                    code: 'app-user-required',
                    message: 'A BiocBot student is required'
                });
            }

            // The PUID is read from BiocBot's own record, never from the request.
            const { students } = await canvasGradeSync.listIntegrationStudents(
                req.app.locals.db,
                integration.course
            );
            const student = students.find((entry) => entry.appUserId === appUserId);
            if (!student) {
                return res.status(404).json({
                    success: false,
                    code: 'student-not-found',
                    message: 'That student is not in this BiocBot course, or has no PUID recorded'
                });
            }

            const draftScore = CanvasGradeRecord.toFiniteNumber(req.body.draftScore);
            const invalid = canvasGradeSync.validateDraftScore(draftScore, facts);
            if (invalid) {
                return res.status(400).json({ success: false, code: 'invalid-grade', message: invalid });
            }

            const record = await CanvasGradeRecord.saveDraft(req.app.locals.db, {
                scope,
                appUserId,
                puid: student.puid,
                displayName: student.displayName,
                draftScore,
                draftComment: req.body.draftComment,
                updatedBy: req.user.userId
            });

            return res.json({
                success: true,
                message: 'Draft saved',
                data: { record: CanvasGradeRecord.toClientView(record) }
            });
        } catch (error) {
            return sendError(res, error);
        }
    });

    /**
     * On-demand attachment download. The browser names a local record and an
     * attachment listed on it; course, assignment, and Canvas user id are all
     * derived server-side, and no URL is accepted.
     */
    router.post('/submissions/attachment', ...scoped, async (req, res) => {
        try {
            const { download, filename } = await canvasGradeSync.downloadAttachment({
                db: req.app.locals.db,
                canvasApi,
                client: req.canvasApi,
                integration: req.canvasIntegrationContext,
                gradeItemId: req.body.gradeItemId,
                recordId: req.body.recordId,
                attachmentId: req.body.attachmentId,
                maxBytes: canvasGradeSync.attachmentMaxBytes()
            });

            res.setHeader('Content-Type', download.contentType || 'application/octet-stream');
            res.setHeader('Content-Disposition', `attachment; filename="${safeFilename(filename)}"`);
            return res.send(Buffer.from(download.data));
        } catch (error) {
            return sendError(res, error);
        }
    });

    /**
     * Step one of an export. Returns a summary and an opaque id; the resolved
     * batch and the preflight stay server-side.
     */
    router.post('/grade-exports/preview', ...scoped, async (req, res) => {
        try {
            const data = await canvasGradeSync.previewGradeExport({
                db: req.app.locals.db,
                canvasApi,
                client: req.canvasApi,
                integration: req.canvasIntegrationContext,
                gradeItemId: req.body.gradeItemId,
                recordIds: Array.isArray(req.body.recordIds) ? req.body.recordIds : null,
                // A partial export is a decision made at preview, so that the
                // acknowledgement and the batch it applies to are stored together.
                allowPartial: req.body.allowPartial === true,
                actorId: req.user.userId,
                sessionKey: req.sessionID || null
            });
            return res.json({ success: true, data });
        } catch (error) {
            return sendError(res, error);
        }
    });

    /** Step two. Everything that matters is loaded from the prepared operation. */
    router.post('/grade-exports/:preparedOperationId/confirm', ...scoped, async (req, res) => {
        try {
            const data = await canvasGradeSync.confirmGradeExport({
                db: req.app.locals.db,
                canvasApi,
                client: req.canvasApi,
                integration: req.canvasIntegrationContext,
                preparedOperationId: req.params.preparedOperationId,
                actorId: req.user.userId,
                sessionKey: req.sessionID || null
            });
            return res.json({ success: data.success, data });
        } catch (error) {
            return sendError(res, error);
        }
    });

    return router;
}

module.exports = { createStudentHubCanvasGradesRouter, requireSameOrigin, safeFilename };
