/**
 * Canvas submission and grade synchronization for the Student Hub.
 *
 * The identity bridge is fixed and has no alternatives:
 *
 *     BiocBot user id -> BiocBot PUID <-> Canvas integration_id -> Canvas user id
 *
 * Canvas's submission and grade endpoints address students by internal
 * `user_id`, but that id is only ever obtained here from a fresh roster read of
 * the one course this BiocBot course is linked to. It is used for the duration
 * of a request and never stored, because a stored Canvas id is an invitation to
 * write a grade without re-checking who owns it — the same student is the same
 * Canvas user id in every course they take, so nothing downstream would notice.
 *
 * The other half of the boundary is the course. The browser sends BiocBot's own
 * link id; the Canvas course id is derived from the authorized link record on
 * the server. A Canvas course id arriving in a request body is ignored. If this
 * BiocBot course is linked to CHEM123 then every roster, assignment, submission,
 * grade, and attachment call in this module targets CHEM123 — a student who does
 * not appear on that roster is reported unmatched rather than looked for in
 * whatever else they happen to be enrolled in.
 */

const CourseModel = require('../models/Course');
const CanvasGradeRecord = require('../models/CanvasGradeRecord');
const exportOperations = require('./canvasGradeExportOperations');
const { getGradeSource } = require('./lmsGradeImport');
const { hasSystemAdminAccess } = require('./authorization');

const AUDIT_COLLECTION = 'canvas_grade_audit';

/**
 * Namespacing keeps a BiocBot link id from ever being mistaken for a Canvas
 * course id, in either direction: a bare number is rejected by the parser, so a
 * client that sends `10` hoping to reach Canvas course 10 gets a 400 rather
 * than a course.
 */
const COURSE_INTEGRATION_PREFIX = 'canvas';

/**
 * Submission attachments are student uploads buffered whole in memory, so the
 * ceiling is a deployment decision rather than something to inherit.
 */
const DEFAULT_ATTACHMENT_MAX_BYTES = 25 * 1024 * 1024;

class CanvasGradeSyncError extends Error {
    constructor(message, { code, statusCode = 400, details = null } = {}) {
        super(message);
        this.name = 'CanvasGradeSyncError';
        this.code = code;
        this.statusCode = statusCode;
        this.details = details;
    }
}

/** BiocBot's own identifier for a Canvas link, as sent by the browser. */
function buildCourseIntegrationId(biocbotCourseId) {
    return `${COURSE_INTEGRATION_PREFIX}:${biocbotCourseId}`;
}

/**
 * @param {string} value - A candidate link id
 * @returns {Object|null} `{ provider, biocbotCourseId }`, or null when malformed
 */
function parseCourseIntegrationId(value) {
    const raw = String(value || '').trim();
    if (!raw) return null;
    const separator = raw.indexOf(':');
    if (separator <= 0) return null;
    const provider = raw.slice(0, separator);
    const biocbotCourseId = raw.slice(separator + 1);
    if (provider !== COURSE_INTEGRATION_PREFIX || !biocbotCourseId) return null;
    return { provider, biocbotCourseId };
}

function attachmentMaxBytes(env = process.env) {
    const configured = Number(env.CANVAS_SUBMISSION_ATTACHMENT_MAX_BYTES);
    if (Number.isSafeInteger(configured) && configured > 0) return configured;
    return DEFAULT_ATTACHMENT_MAX_BYTES;
}

/**
 * Authorizes the caller against one BiocBot Canvas link and derives everything
 * downstream from the stored record.
 *
 * This is the only place a Canvas course id enters the system for these routes.
 * Callers pass the request's link id and nothing else about the course; the
 * returned `canvasCourseId` is read from the link, so no later step can be
 * pointed somewhere else.
 *
 * @param {Object} params - `{ db, user, courseIntegrationId }`
 * @returns {Promise<Object>} `{ courseIntegrationId, course, canvasCourseId, source }`
 * @throws {CanvasGradeSyncError} When the id is malformed, the course is
 * missing, the caller is not an instructor on it, or it is not linked to Canvas
 */
async function resolveCourseIntegration({ db, user, courseIntegrationId }) {
    const parsed = parseCourseIntegrationId(courseIntegrationId);
    if (!parsed) {
        throw new CanvasGradeSyncError(
            'A BiocBot Canvas integration id is required',
            { code: 'invalid-integration-id', statusCode: 400 }
        );
    }

    const course = await CourseModel.getCourseById(db, parsed.biocbotCourseId);
    if (!course) {
        throw new CanvasGradeSyncError('BiocBot course not found', {
            code: 'course-not-found',
            statusCode: 404
        });
    }

    const allowed = hasSystemAdminAccess(user)
        || (user?.role === 'instructor'
            && await CourseModel.userHasCourseAccess(db, course.courseId, user.userId, 'instructor'));
    if (!allowed) {
        throw new CanvasGradeSyncError('You can only manage Canvas grades for your own courses', {
            code: 'forbidden',
            statusCode: 403
        });
    }

    const source = getGradeSource(course, 'canvas');
    if (!source?.courseId) {
        throw new CanvasGradeSyncError('This BiocBot course is not linked to a Canvas course', {
            code: 'not-linked',
            statusCode: 400
        });
    }

    return {
        courseIntegrationId: buildCourseIntegrationId(course.courseId),
        course,
        canvasCourseId: String(source.courseId),
        source
    };
}

/**
 * The BiocBot students belonging to this linked course.
 *
 * Anyone without a PUID is separated out rather than passed to the matcher: the
 * only key that can match a Canvas roster is the PUID, so an account without one
 * is unmatchable for a reason the instructor can actually fix, and saying so is
 * more useful than reporting them as absent from Canvas.
 *
 * @param {Object} db - MongoDB database instance
 * @param {Object} course - The BiocBot course
 * @returns {Promise<Object>} `{ students, withoutPuid }`
 */
async function listIntegrationStudents(db, course) {
    const enrollmentIds = Object.keys(course.studentEnrollment || {});
    const users = await db.collection('users').find({
        isActive: { $ne: false },
        isPreview: { $ne: true },
        $or: [
            { role: 'student', 'preferences.courseId': course.courseId },
            ...(enrollmentIds.length ? [{ userId: { $in: enrollmentIds } }] : [])
        ]
    }).project({ _id: 0, userId: 1, username: 1, displayName: 1, puid: 1 }).toArray();

    const students = [];
    const withoutPuid = [];
    for (const user of users) {
        const entry = {
            appUserId: String(user.userId),
            puid: String(user.puid || '').trim(),
            displayName: user.displayName || user.username || String(user.userId)
        };
        if (entry.puid) students.push(entry);
        else withoutPuid.push({ appUserId: entry.appUserId, displayName: entry.displayName });
    }
    return { students, withoutPuid };
}

/**
 * Builds a fresh roster match report for the linked course.
 *
 * Always fresh, and always from `matchCourseRoster` rather than a stored
 * mapping: the report stamps the course whose roster produced it, which is what
 * makes a later grade write refusable when it aims somewhere else.
 *
 * Both `appUserId` and `key` are supplied so that two BiocBot accounts holding
 * the same PUID come back as ambiguous instead of resolving to whichever was
 * read first.
 *
 * @param {Object} params - `{ canvasApi, client, canvasCourseId, students, explain }`
 * @returns {Promise<Object>} The toolkit's match report
 */
async function buildRosterReport({ canvasApi, client, canvasCourseId, students, explain = false }) {
    const appUsers = students.map((student) => ({
        appUserId: String(student.appUserId),
        key: student.puid
    }));

    let report = await canvasApi.matchCourseRoster(client, canvasCourseId, appUsers);

    // Best-effort: tells "dropped the course" apart from "never in it", which
    // the active roster alone cannot. A failure here is not a reason to fail the
    // whole operation — every appOnly entry simply stays `unknown`.
    if (explain && typeof canvasApi.explainUnmatched === 'function' && report.appOnly?.length) {
        try {
            report = await canvasApi.explainUnmatched(client, canvasCourseId, report);
        } catch (error) {
            console.warn('[canvas-grades] Could not classify unmatched students:', error.message);
        }
    }

    return report;
}

/**
 * Zero `integration_id` coverage across a non-empty roster is a permissions
 * problem wearing the costume of an empty course. Acting on it would report
 * every student as missing from Canvas.
 * @param {Object} report - A match report
 * @throws {CanvasGradeSyncError} When coverage is unusable
 */
function assertRosterCoverage(report) {
    const coverage = report.coverage || {};
    if (coverage.total > 0 && !coverage.integrationId) {
        throw new CanvasGradeSyncError(
            'Canvas returned this course roster without any integration_id values, so no student could be matched. '
            + 'This is almost always a missing SIS-read permission on the connected Canvas account rather than an empty course.',
            { code: 'roster-coverage', statusCode: 409, details: { coverage } }
        );
    }
}

/**
 * Loads one assignment and proves it belongs to the linked course.
 *
 * Reading the course's own assignment list is the check: an id that is not in
 * it cannot be reached, so an assignment from another Canvas course cannot be
 * targeted even by a caller who knows its id.
 *
 * @param {Object} params - `{ canvasApi, client, canvasCourseId, gradeItemId }`
 * @returns {Promise<Object>} The matching grade item
 * @throws {CanvasGradeSyncError} When the assignment is not in this course
 */
async function loadAssignment({ canvasApi, client, canvasCourseId, gradeItemId }) {
    const wanted = String(gradeItemId || '').trim();
    if (!wanted) {
        throw new CanvasGradeSyncError('An assignment is required', {
            code: 'assignment-required',
            statusCode: 400
        });
    }

    const assignments = await canvasApi.getGradeItems(client, canvasCourseId);
    const assignment = assignments.find((item) => String(item.id) === wanted);
    if (!assignment) {
        throw new CanvasGradeSyncError(
            'That assignment does not belong to the Canvas course this BiocBot course is linked to',
            { code: 'assignment-mismatch', statusCode: 400 }
        );
    }
    return assignment;
}

function assignmentFacts(assignment) {
    const raw = assignment?.raw || {};
    return {
        gradeItemId: String(assignment.id),
        name: assignment.name || '',
        maxScore: typeof assignment.maxScore === 'number' ? assignment.maxScore : null,
        gradingType: raw.grading_type || null,
        postManually: Boolean(raw.post_manually)
    };
}

/** The per-request scope every persisted row is stamped with. */
function buildScope({ integration, assignment }) {
    const facts = assignmentFacts(assignment);
    return {
        courseIntegrationId: integration.courseIntegrationId,
        biocbotCourseId: integration.course.courseId,
        canvasCourseId: integration.canvasCourseId,
        gradeItemId: facts.gradeItemId,
        gradeItemName: facts.name,
        maxScore: facts.maxScore,
        gradingType: facts.gradingType
    };
}

/**
 * Describes BiocBot students the roster could not place, in the terms an
 * instructor can act on. These are not "missing a submission" — they are not on
 * the selected Canvas course's active roster at all.
 * @param {Object} report - A match report
 * @param {Map} studentsByAppUserId - BiocBot students by id
 * @returns {Object[]} Unmatched descriptions
 */
function describeAppOnly(report, studentsByAppUserId) {
    const reasons = {
        'not-enrolled': 'Not enrolled in the linked Canvas course',
        'enrollment-ended': 'Enrollment in the linked Canvas course has ended',
        unknown: 'Not on the linked Canvas course\'s active roster'
    };
    return (report.appOnly || []).map((entry) => {
        const student = entry.appUserId ? studentsByAppUserId.get(String(entry.appUserId)) : null;
        return {
            appUserId: entry.appUserId || null,
            displayName: student?.displayName || entry.appUserId || '',
            puidMasked: CanvasGradeRecord.maskPuid(entry.key),
            reason: entry.reason || 'unknown',
            message: reasons[entry.reason] || reasons.unknown
        };
    });
}

function describeAmbiguous(report, studentsByAppUserId) {
    return (report.ambiguous || []).map((entry) => ({
        puidMasked: CanvasGradeRecord.maskPuid(entry.key),
        appUserIds: entry.appUserIds || [],
        displayNames: (entry.appUserIds || [])
            .map((id) => studentsByAppUserId.get(String(id))?.displayName || id),
        lmsUserCount: (entry.lmsUserIds || []).length,
        message: (entry.appUserIds || []).length > 1
            ? 'More than one BiocBot account claims this PUID, so no grade can be attributed'
            : 'More than one Canvas account carries this PUID, so no grade can be attributed'
    }));
}

/**
 * The roster half of every response: who matched, who did not, and why. Canvas
 * user ids are deliberately absent — the browser has no use for them and every
 * operation re-derives them from a fresh match.
 * @param {Object} report - A match report
 * @param {Map} studentsByAppUserId - BiocBot students by id
 * @param {Object[]} withoutPuid - BiocBot accounts with no PUID at all
 * @returns {Object} A safe roster summary
 */
function summarizeRoster(report, studentsByAppUserId, withoutPuid = []) {
    return {
        canvasCourseId: report.courseId,
        matchedCount: (report.matched || []).length,
        coverage: report.coverage,
        // Canvas people with no BiocBot account. Normal on a partly adopted
        // course, so it is reported as a count and names only.
        rosterOnly: (report.rosterOnly || []).map((entry) => ({ name: entry.name })),
        appOnly: describeAppOnly(report, studentsByAppUserId),
        ambiguous: describeAmbiguous(report, studentsByAppUserId),
        withoutPuid
    };
}

async function writeAudit(db, entry) {
    try {
        await db.collection(AUDIT_COLLECTION).insertOne({ ...entry, at: new Date() });
    } catch (error) {
        // An audit write must not take a completed Canvas operation down with it.
        console.error('[canvas-grades] Audit write failed:', error.message);
    }
}

/**
 * Imports Canvas grades for one assignment of the linked course.
 *
 * Every Canvas row is translated through the fresh match report before it can
 * reach a record; a Canvas `userId` is never compared against a BiocBot user id
 * or a PUID. Rows that cannot be placed are returned explicitly rather than
 * dropped, because a silently skipped grade looks exactly like a student who
 * was never graded.
 *
 * @param {Object} params - See the route that calls this
 * @returns {Promise<Object>} Import summary, roster summary, and stored rows
 */
async function importGrades({ db, canvasApi, client, integration, gradeItemId, actorId }) {
    const assignment = await loadAssignment({
        canvasApi,
        client,
        canvasCourseId: integration.canvasCourseId,
        gradeItemId
    });
    const scope = buildScope({ integration, assignment });

    const { students, withoutPuid } = await listIntegrationStudents(db, integration.course);
    const report = await buildRosterReport({
        canvasApi,
        client,
        canvasCourseId: integration.canvasCourseId,
        students,
        explain: true
    });
    assertRosterCoverage(report);

    const grades = await canvasApi.getGrades(client, {
        courseId: integration.canvasCourseId,
        gradeItemId: scope.gradeItemId
    });

    // `resolveSubmissions` guards the submission path this way; there is no
    // equivalent resolver for gradebook rows, so the same two checks are made
    // by hand. Today `getGrades` stamps both fields from the arguments above,
    // which makes this a guard against them ever diverging rather than a filter
    // that fires — but a row from the wrong course or assignment stored against
    // this one is exactly the failure nothing downstream would catch.
    for (const grade of grades) {
        if (grade.courseId !== undefined && String(grade.courseId) !== String(integration.canvasCourseId)) {
            throw new CanvasGradeSyncError(
                'Canvas returned grades for a different course than the linked one',
                { code: 'course-mismatch', statusCode: 502 }
            );
        }
        if (grade.gradeItemId !== undefined && String(grade.gradeItemId) !== scope.gradeItemId) {
            throw new CanvasGradeSyncError(
                'Canvas returned grades for a different assignment than the requested one',
                { code: 'assignment-mismatch', statusCode: 502 }
            );
        }
    }

    const matchByCanvasUserId = new Map(
        (report.matched || []).map((match) => [String(match.lmsUserId), match])
    );
    const studentsByAppUserId = new Map(students.map((student) => [student.appUserId, student]));
    const existingRows = await CanvasGradeRecord.listForAssignment(db, scope);
    const existingByAppUserId = new Map(existingRows.map((row) => [String(row.appUserId), row]));

    const importedAt = new Date();
    const operations = [];
    const unresolved = [];
    const preservedDrafts = [];

    for (const grade of grades) {
        const match = matchByCanvasUserId.get(String(grade.userId));
        if (!match) {
            // Deliberately not a Canvas user id in the response: it identifies a
            // person BiocBot has no account for, and the instructor cannot act
            // on the number anyway.
            unresolved.push({ reason: 'no-app-account' });
            continue;
        }

        const appUserId = String(match.appUserId);
        const student = studentsByAppUserId.get(appUserId);
        const existing = existingByAppUserId.get(appUserId) || null;
        if (CanvasGradeRecord.hasUnsyncedDraft(existing)) {
            preservedDrafts.push({
                appUserId,
                displayName: student?.displayName || appUserId,
                draftScore: existing.draftScore,
                canvasScore: typeof grade.score === 'number' ? grade.score : null
            });
        }

        operations.push(CanvasGradeRecord.buildImportOperation({
            scope,
            appUserId,
            puid: match.key,
            displayName: student?.displayName || match.name || appUserId,
            canvas: { score: grade.score ?? null, grade: grade.grade ?? null, gradedAt: grade.gradedAt },
            importedAt,
            importedBy: actorId,
            existing
        }));
    }

    if (operations.length) {
        await CanvasGradeRecord.collection(db).bulkWrite(operations);
    }

    await writeAudit(db, {
        action: 'canvas-grade-import',
        actorId: String(actorId),
        courseIntegrationId: scope.courseIntegrationId,
        canvasCourseId: scope.canvasCourseId,
        gradeItemId: scope.gradeItemId,
        importedCount: operations.length,
        unresolvedCount: unresolved.length
    });

    const rows = await CanvasGradeRecord.listForAssignment(db, scope);
    return {
        assignment: assignmentFacts(assignment),
        importedCount: operations.length,
        unresolved,
        preservedDrafts,
        roster: summarizeRoster(report, studentsByAppUserId, withoutPuid),
        records: rows.map(CanvasGradeRecord.toClientView)
    };
}

/**
 * Imports submission status and metadata for one assignment.
 *
 * Metadata only: attachments are listed, never downloaded in bulk. A whole
 * class's uploads is not something to pull in order to answer "who submitted?".
 *
 * The Canvas-to-BiocBot join is `resolveSubmissions`, not a hand-written one —
 * it validates that every row came from the expected course and assignment, and
 * a custom join would quietly accept a mixed result.
 *
 * @param {Object} params - See the route that calls this
 * @returns {Promise<Object>} Import summary, roster summary, and stored rows
 */
async function importSubmissions({ db, canvasApi, client, integration, gradeItemId, actorId }) {
    const assignment = await loadAssignment({
        canvasApi,
        client,
        canvasCourseId: integration.canvasCourseId,
        gradeItemId
    });
    const scope = buildScope({ integration, assignment });

    const { students, withoutPuid } = await listIntegrationStudents(db, integration.course);
    const report = await buildRosterReport({
        canvasApi,
        client,
        canvasCourseId: integration.canvasCourseId,
        students,
        explain: true
    });
    assertRosterCoverage(report);

    const submissions = await canvasApi.getSubmissions(client, {
        courseId: integration.canvasCourseId,
        gradeItemId: scope.gradeItemId,
        includeUnsubmitted: true
    });

    const resolved = canvasApi.resolveSubmissions(report, scope.gradeItemId, submissions);

    const studentsByAppUserId = new Map(students.map((student) => [student.appUserId, student]));
    const existingRows = await CanvasGradeRecord.listForAssignment(db, scope);
    const existingByAppUserId = new Map(existingRows.map((row) => [String(row.appUserId), row]));

    const importedAt = new Date();
    const operations = resolved.matched.map((entry) => {
        const appUserId = String(entry.appUserId);
        const student = studentsByAppUserId.get(appUserId);
        return CanvasGradeRecord.buildImportOperation({
            scope,
            appUserId,
            puid: entry.key,
            displayName: student?.displayName || appUserId,
            // Canvas returns the score alongside the submission; storing it here
            // keeps the two views of one assignment consistent without a second
            // gradebook read. Drafts are untouched either way.
            canvas: { score: entry.submission.score ?? null, grade: entry.submission.grade ?? null },
            submission: entry.submission,
            importedAt,
            importedBy: actorId,
            existing: existingByAppUserId.get(appUserId) || null
        });
    });

    if (operations.length) {
        await CanvasGradeRecord.collection(db).bulkWrite(operations);
    }

    await writeAudit(db, {
        action: 'canvas-submission-import',
        actorId: String(actorId),
        courseIntegrationId: scope.courseIntegrationId,
        canvasCourseId: scope.canvasCourseId,
        gradeItemId: scope.gradeItemId,
        importedCount: operations.length,
        unresolvedCount: resolved.unresolved.length
    });

    const rows = await CanvasGradeRecord.listForAssignment(db, scope);
    return {
        assignment: assignmentFacts(assignment),
        importedCount: operations.length,
        // Surfaced rather than dropped: a Canvas submission with no BiocBot
        // account is invisible work, which reads identically to no submission.
        unresolved: resolved.unresolved.map((entry) => ({ reason: entry.reason })),
        roster: summarizeRoster(report, studentsByAppUserId, withoutPuid),
        records: rows.map(CanvasGradeRecord.toClientView)
    };
}

/**
 * Downloads one attachment from one student's submission.
 *
 * Course, assignment, and student are all derived server-side: the course from
 * the authorized link, the assignment from that course's own list, and the
 * Canvas user id from a fresh roster match on the requesting record's PUID.
 * The browser supplies only application-level ids, and no URL is accepted.
 *
 * @param {Object} params - See the route that calls this
 * @returns {Promise<Object>} `{ download, filename, record }`
 */
async function downloadAttachment({ db, canvasApi, client, integration, gradeItemId, recordId, attachmentId, maxBytes }) {
    const assignment = await loadAssignment({
        canvasApi,
        client,
        canvasCourseId: integration.canvasCourseId,
        gradeItemId
    });
    const scope = buildScope({ integration, assignment });

    const record = await CanvasGradeRecord.collection(db).findOne({
        ...CanvasGradeRecord.assignmentScope(scope),
        recordId: String(recordId)
    });
    if (!record) {
        throw new CanvasGradeSyncError('No imported submission for that student and assignment', {
            code: 'record-not-found',
            statusCode: 404
        });
    }

    const attachment = (record.attachments || []).find((item) => String(item.id) === String(attachmentId));
    if (!attachment) {
        throw new CanvasGradeSyncError('That attachment is not listed on this student\'s submission', {
            code: 'attachment-not-found',
            statusCode: 404
        });
    }

    // A fresh match, not the stored row: the point of a download is to read one
    // named student's work, and the Canvas id that identifies them has to come
    // from the roster of the course being read.
    const { students } = await listIntegrationStudents(db, integration.course);
    const report = await buildRosterReport({
        canvasApi,
        client,
        canvasCourseId: integration.canvasCourseId,
        students
    });
    assertRosterCoverage(report);

    const match = (report.matched || []).find((entry) => String(entry.appUserId) === String(record.appUserId));
    if (!match) {
        throw new CanvasGradeSyncError(
            'That student is no longer matched on the linked Canvas course roster',
            { code: 'not-matched', statusCode: 409 }
        );
    }

    const ceiling = Number.isSafeInteger(maxBytes) && maxBytes > 0 ? maxBytes : attachmentMaxBytes();
    const download = await canvasApi.downloadSubmissionAttachment(client, {
        courseId: integration.canvasCourseId,
        gradeItemId: scope.gradeItemId,
        userId: match.lmsUserId,
        attachmentId: String(attachment.id),
        maxBytes: ceiling
    });

    return {
        download,
        filename: download.filename || attachment.displayName || attachment.filename || 'submission',
        record
    };
}

/**
 * Turns the stored rows into the grade inputs the toolkit resolves.
 *
 * Keyed by PUID, never by a Canvas id: `resolveGradeWrites` performs the
 * translation, and doing it here would mean trusting a stored Canvas id.
 * Rows with neither a score nor a comment carry no operation, so they are
 * separated out and reported instead of being sent — an empty operation is a
 * refusal (`invalid-grade`) that would otherwise take the whole export down.
 *
 * @param {Object[]} records - Local records selected for export
 * @returns {Object} `{ gradeInputs, exportable, skippedNoDraft }`
 */
function buildGradeInputs(records) {
    const exportable = [];
    const skippedNoDraft = [];

    for (const record of records) {
        const hasScore = record.draftScore !== null && record.draftScore !== undefined;
        const comment = String(record.draftComment || '').trim();
        if (!hasScore && !comment) {
            skippedNoDraft.push({
                recordId: record.recordId,
                displayName: record.displayName || record.appUserId
            });
            continue;
        }
        exportable.push(record);
    }

    const gradeInputs = exportable.map((record) => {
        const input = { key: record.puid };
        if (record.draftScore !== null && record.draftScore !== undefined) {
            input.postedGrade = record.draftScore;
        }
        const comment = String(record.draftComment || '').trim();
        if (comment) input.comment = comment;
        return input;
    });

    return { gradeInputs, exportable, skippedNoDraft };
}

/**
 * Validates a draft score against what BiocBot can know about the assignment.
 *
 * Canvas parses the value according to the assignment's own grading type, so
 * this stays deliberately narrow: a finite number, not negative, and not above
 * the maximum for a points assignment. Anything subtler belongs to Canvas.
 *
 * @param {number|null} score - The draft score
 * @param {Object} facts - Assignment facts
 * @returns {string|null} An error message, or null when acceptable
 */
function validateDraftScore(score, facts) {
    if (score === null || score === undefined) return null;
    if (!Number.isFinite(score)) return 'Score must be a number';
    if (score < 0) return 'Score cannot be negative';
    if (facts.gradingType === 'points' && typeof facts.maxScore === 'number' && score > facts.maxScore) {
        return `Score cannot exceed the assignment maximum of ${facts.maxScore}`;
    }
    return null;
}

/**
 * Step one of the export: resolve, preflight, and store the result server-side.
 *
 * Nothing is written to Canvas here. What comes back is a summary and an opaque
 * id; the batch and the preflight stay in the database, because a client that
 * could edit either could choose who gets graded and claim that review happened.
 *
 * A refusal is not an error page. When Canvas would refuse a partial export, the
 * instructor still needs to see who could not be placed and why, so the blocked
 * case returns the same shaped preview with `blocked` set and no operation id.
 *
 * @param {Object} params - See the route that calls this
 * @returns {Promise<Object>} A preview summary
 */
async function previewGradeExport({
    db,
    canvasApi,
    client,
    integration,
    gradeItemId,
    recordIds,
    allowPartial = false,
    actorId,
    sessionKey
}) {
    const assignment = await loadAssignment({
        canvasApi,
        client,
        canvasCourseId: integration.canvasCourseId,
        gradeItemId
    });
    const scope = buildScope({ integration, assignment });
    const facts = assignmentFacts(assignment);

    const selected = await CanvasGradeRecord.listSelectedForExport(db, scope, recordIds);
    if (!selected.length) {
        throw new CanvasGradeSyncError('No local grades were selected for export', {
            code: 'empty-batch',
            statusCode: 400
        });
    }

    const { gradeInputs, exportable, skippedNoDraft } = buildGradeInputs(selected);
    if (!gradeInputs.length) {
        throw new CanvasGradeSyncError('None of the selected students have a draft score or comment to export', {
            code: 'empty-batch',
            statusCode: 400
        });
    }

    const invalid = exportable
        .map((record) => ({ record, message: validateDraftScore(record.draftScore, facts) }))
        .filter((entry) => entry.message);
    if (invalid.length) {
        throw new CanvasGradeSyncError('One or more draft scores are not valid for this assignment', {
            code: 'invalid-grade',
            statusCode: 400,
            details: invalid.map((entry) => ({
                recordId: entry.record.recordId,
                displayName: entry.record.displayName,
                message: entry.message
            }))
        });
    }

    const { students, withoutPuid } = await listIntegrationStudents(db, integration.course);
    const studentsByAppUserId = new Map(students.map((student) => [student.appUserId, student]));
    const report = await buildRosterReport({
        canvasApi,
        client,
        canvasCourseId: integration.canvasCourseId,
        students,
        explain: true
    });
    assertRosterCoverage(report);

    const batch = canvasApi.resolveGradeWrites(report, scope.gradeItemId, gradeInputs);

    // A PUID in the batch's `unresolved` list belongs to someone the roster
    // could not place. Names come from BiocBot's own records so the instructor
    // reads a person rather than an identifier.
    const puidToRecord = new Map(exportable.map((record) => [String(record.puid).toLowerCase(), record]));
    const unresolved = (batch.unresolved || []).map((entry) => {
        const record = puidToRecord.get(String(entry.key).toLowerCase());
        return {
            displayName: record?.displayName || '',
            puidMasked: CanvasGradeRecord.maskPuid(entry.key),
            reason: entry.reason
        };
    });

    const roster = summarizeRoster(report, studentsByAppUserId, withoutPuid);
    const basePreview = {
        canvasCourse: {
            id: integration.canvasCourseId,
            name: integration.source.name || '',
            code: integration.source.code || ''
        },
        assignment: facts,
        matchedCount: batch.writes.length,
        unresolvedCount: unresolved.length,
        unresolved,
        skippedNoDraft,
        allowPartial: Boolean(allowPartial),
        roster,
        // The posting policy has to be known before the write to be worth
        // anything: under automatic posting a comment is visible the instant it
        // lands, with no review step.
        postManually: facts.postManually,
        visibilityWarning: facts.postManually
            ? 'This assignment posts grades manually, so exported scores and comments stay hidden from students until you post them in Canvas.'
            : 'This assignment posts grades automatically. Exported scores and comments become visible to students immediately.'
    };

    let preflight;
    try {
        preflight = await canvasApi.preflightGradeExport(client, {
            courseId: integration.canvasCourseId,
            gradeItemId: scope.gradeItemId,
            batch,
            allowPartial
        });
    } catch (error) {
        if (error?.reason === 'partial-export') {
            // Expected whenever anyone could not be placed and partial export
            // has not been acknowledged. Show the whole picture and offer the
            // acknowledgement rather than returning a bare failure.
            return {
                ...basePreview,
                blocked: true,
                blockedReason: 'partial-export',
                message: 'Some selected students could not be matched on the linked Canvas course roster, '
                    + 'so nothing will be exported. Review them below, or acknowledge that only matched students should receive grades.',
                canAcknowledgePartial: batch.writes.length > 0,
                preparedOperationId: null
            };
        }
        throw error;
    }

    // The preflight read is authoritative for the values shown; the assignment
    // could have changed between listing it and preflighting it.
    const previewFacts = {
        ...facts,
        name: preflight.assignmentName || facts.name,
        maxScore: typeof preflight.maxScore === 'number' ? preflight.maxScore : facts.maxScore,
        gradingType: preflight.gradingType || facts.gradingType,
        postManually: preflight.postManually
    };

    // Which rows Canvas will actually receive. On a partial export the rest are
    // skipped, and marking them exported afterwards would claim a grade reached
    // Canvas for someone who was never in the batch.
    const unresolvedKeys = new Set((batch.unresolved || []).map((entry) => String(entry.key).toLowerCase()));
    const isSkipped = (record) => unresolvedKeys.has(String(record.puid).toLowerCase());
    const recordIdsForOperation = exportable.map((record) => String(record.recordId));
    const writeRecordIds = exportable.filter((record) => !isSkipped(record)).map((record) => String(record.recordId));
    const skippedRecordIds = exportable.filter(isSkipped).map((record) => String(record.recordId));

    const { operationId, expiresAt } = await exportOperations.createOperation(db, {
        courseIntegrationId: scope.courseIntegrationId,
        canvasCourseId: scope.canvasCourseId,
        gradeItemId: scope.gradeItemId,
        instructorId: actorId,
        sessionKey,
        batch,
        preflight,
        allowPartial,
        recordIds: recordIdsForOperation,
        writeRecordIds,
        skippedRecordIds,
        recordsFingerprint: CanvasGradeRecord.fingerprintRecords(exportable)
    });

    await writeAudit(db, {
        action: 'canvas-grade-export-preview',
        actorId: String(actorId),
        courseIntegrationId: scope.courseIntegrationId,
        canvasCourseId: scope.canvasCourseId,
        gradeItemId: scope.gradeItemId,
        matchedCount: batch.writes.length,
        unresolvedCount: unresolved.length,
        allowPartial: Boolean(allowPartial)
    });

    return {
        ...basePreview,
        assignment: previewFacts,
        postManually: previewFacts.postManually,
        visibilityWarning: previewFacts.postManually
            ? 'This assignment posts grades manually, so exported scores and comments stay hidden from students until you post them in Canvas.'
            : 'This assignment posts grades automatically. Exported scores and comments become visible to students immediately.',
        blocked: false,
        blockedReason: null,
        preparedOperationId: operationId,
        expiresAt
    };
}

const CLAIM_MESSAGES = Object.freeze({
    'not-found': 'That export preview is no longer available. Preview the export again.',
    'already-used': 'That export has already been confirmed. Preview the export again to send more grades.',
    expired: 'That export preview has expired. Preview the export again.',
    'wrong-instructor': 'That export preview belongs to another instructor.',
    'wrong-session': 'That export preview was prepared in a different session. Preview the export again.',
    'wrong-integration': 'That export preview was prepared for a different Canvas course link.'
});

/**
 * Step two: redeem the prepared operation and write it to Canvas.
 *
 * The batch and preflight come from the database, never from the request. The
 * rows are re-read and re-fingerprinted first, so a draft edited in another tab
 * after the preview cannot be exported under an approval given for different
 * numbers.
 *
 * Canvas applies grades asynchronously, so acceptance is not completion: the
 * result reported here is the one `waitForProgress` returns, and a failed job is
 * stored as failed.
 *
 * @param {Object} params - See the route that calls this
 * @returns {Promise<Object>} The completed or failed export result
 */
async function confirmGradeExport({
    db,
    canvasApi,
    client,
    integration,
    preparedOperationId,
    actorId,
    sessionKey
}) {
    const claim = await exportOperations.claimOperation(db, {
        operationId: preparedOperationId,
        instructorId: actorId,
        sessionKey,
        courseIntegrationId: integration.courseIntegrationId
    });
    if (!claim.ok) {
        throw new CanvasGradeSyncError(CLAIM_MESSAGES[claim.reason] || 'That export preview cannot be used', {
            code: `prepared-operation-${claim.reason}`,
            statusCode: claim.reason === 'not-found' ? 404 : 409
        });
    }

    const operation = claim.operation;
    const scope = {
        courseIntegrationId: operation.courseIntegrationId,
        gradeItemId: operation.gradeItemId
    };

    // Belt and braces: the operation stores the course it was prepared against,
    // and it must still be the course the link resolves to now.
    if (String(operation.canvasCourseId) !== String(integration.canvasCourseId)) {
        throw new CanvasGradeSyncError(
            'The Canvas course linked to this BiocBot course changed after the preview. Review the export again.',
            { code: 'course-mismatch', statusCode: 409 }
        );
    }

    const current = await CanvasGradeRecord.listSelectedForExport(db, scope, operation.recordIds);
    if (current.length !== operation.recordIds.length
        || CanvasGradeRecord.fingerprintRecords(current) !== operation.recordsFingerprint) {
        throw new CanvasGradeSyncError(
            'The selected grades changed after the preview. Review the export again.',
            { code: 'records-changed', statusCode: 409 }
        );
    }

    const queued = await canvasApi.postGrades(client, {
        courseId: integration.canvasCourseId,
        gradeItemId: operation.gradeItemId,
        batch: operation.batch,
        preflight: operation.preflight,
        allowPartial: operation.allowPartial
    });

    // `postGrades` returning means Canvas accepted the batch, not that it
    // applied it. Only the Progress result can say which students were graded.
    const result = await canvasApi.waitForProgress(client, queued.progressId);
    const succeeded = result.workflowState === 'completed';

    // Only the rows that were in the batch. On an acknowledged partial export
    // the skipped students keep their drafts and are not claimed as exported.
    const writeRecordIds = operation.writeRecordIds || operation.recordIds;
    await CanvasGradeRecord.markExportOutcome(db, scope, writeRecordIds, {
        status: succeeded ? CanvasGradeRecord.SYNC_STATUS.EXPORTED : CanvasGradeRecord.SYNC_STATUS.FAILED,
        error: succeeded ? null : (result.message || 'Canvas reported the grade export as failed')
    });
    await CanvasGradeRecord.markSkipped(db, scope, operation.skippedRecordIds || []);

    await exportOperations.recordOutcome(db, operation.operationId, {
        workflowState: result.workflowState,
        message: result.message || null
    });

    await writeAudit(db, {
        action: 'canvas-grade-export-confirm',
        actorId: String(actorId),
        courseIntegrationId: operation.courseIntegrationId,
        canvasCourseId: operation.canvasCourseId,
        gradeItemId: operation.gradeItemId,
        writeCount: operation.batch.writes.length,
        workflowState: result.workflowState,
        succeeded
    });

    const rows = await CanvasGradeRecord.listForAssignment(db, scope);
    return {
        success: succeeded,
        workflowState: result.workflowState,
        message: result.message || null,
        completion: result.completion ?? null,
        postManually: queued.postManually,
        writeCount: operation.batch.writes.length,
        records: rows.map(CanvasGradeRecord.toClientView)
    };
}

/**
 * Instructor-facing text for the toolkit's export refusals.
 *
 * Each of these describes a write that Canvas would have accepted while being
 * wrong, so the message has to say what to do rather than just what failed.
 */
const EXPORT_REFUSAL_MESSAGES = Object.freeze({
    'roster-coverage': 'Canvas did not return integration_id for anyone on this course roster, so no student could be matched. '
        + 'The connected Canvas account most likely lacks permission to read SIS data.',
    'course-mismatch': 'These grades were prepared against a different Canvas course. Review the export again.',
    'assignment-mismatch': 'These grades were prepared for a different assignment. Review the export again.',
    'empty-batch': 'There are no grades to export.',
    'partial-export': 'Some students could not be matched, so nothing was exported. '
        + 'Review the unmatched students, or acknowledge a partial export.',
    'invalid-grade': 'At least one grade is not a value Canvas can accept for this assignment.',
    'preflight-stale': 'Canvas assignment settings changed; review the export again.',
    'unsupported-grading': 'This assignment uses anonymous or moderated grading, which cannot accept grades addressed by student.'
});

/**
 * Maps any error from this module or the toolkit onto a safe HTTP response.
 *
 * Canvas API and OAuth failures are reduced to a status and a generic sentence:
 * their bodies can carry access tokens, signed attachment URLs, and submission
 * content, none of which belongs in a response or a log.
 *
 * @param {Error} error - The thrown error
 * @returns {Object} `{ statusCode, body }`
 */
function describeError(error) {
    if (error instanceof CanvasGradeSyncError) {
        return {
            statusCode: error.statusCode,
            body: { success: false, code: error.code, message: error.message, details: error.details }
        };
    }

    if (error?.name === 'CanvasGradeExportError' || error?.reason in EXPORT_REFUSAL_MESSAGES) {
        const reason = error.reason;
        return {
            statusCode: reason === 'preflight-stale' ? 409 : 400,
            body: {
                success: false,
                code: reason,
                message: EXPORT_REFUSAL_MESSAGES[reason] || 'Canvas refused this grade export.'
            }
        };
    }

    if (error?.name === 'CanvasApiError') {
        const statusCode = error.statusCode === 401 || error.statusCode === 403 ? 502 : 502;
        return {
            statusCode,
            body: {
                success: false,
                code: 'canvas-api-error',
                message: `Canvas rejected the request (HTTP ${error.statusCode}). `
                    + 'Reconnect the Canvas account if this persists.'
            }
        };
    }

    if (error?.name === 'CanvasOAuthError') {
        return {
            statusCode: 502,
            body: {
                success: false,
                code: 'canvas-oauth-error',
                message: 'The Canvas connection could not be authorized. Reconnect the Canvas account.'
            }
        };
    }

    return {
        statusCode: 500,
        body: { success: false, code: 'canvas-grade-sync-error', message: 'The Canvas grade operation failed.' }
    };
}

async function ensureIndexes(db) {
    await CanvasGradeRecord.ensureIndexes(db);
    await exportOperations.ensureIndexes(db);
}

module.exports = {
    AUDIT_COLLECTION,
    COURSE_INTEGRATION_PREFIX,
    CanvasGradeSyncError,
    DEFAULT_ATTACHMENT_MAX_BYTES,
    EXPORT_REFUSAL_MESSAGES,
    assertRosterCoverage,
    assignmentFacts,
    attachmentMaxBytes,
    buildCourseIntegrationId,
    buildGradeInputs,
    buildRosterReport,
    buildScope,
    confirmGradeExport,
    describeError,
    downloadAttachment,
    ensureIndexes,
    importGrades,
    importSubmissions,
    listIntegrationStudents,
    loadAssignment,
    parseCourseIntegrationId,
    previewGradeExport,
    resolveCourseIntegration,
    summarizeRoster,
    validateDraftScore
};
