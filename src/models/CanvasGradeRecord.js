/**
 * Per-assignment Canvas grade records for the Student Hub Grades area.
 *
 * Separate from `lms_grade_snapshots`, which is a read-only mirror of a whole
 * course's gradebook. These rows are the working copy an instructor edits and
 * exports: they carry a local draft score and comment alongside whatever Canvas
 * last reported, plus the submission state for one assignment.
 *
 * Identity rules encoded here, because getting them wrong writes a real score
 * onto the wrong person:
 *
 *   - A row is keyed by (courseIntegrationId, gradeItemId, appUserId). The
 *     Canvas user id is deliberately NOT part of the key and is not stored:
 *     it is a per-request routing detail obtained from a fresh roster match,
 *     and persisting it invites a later write that skips the match entirely.
 *   - `puid` records which BiocBot-side key the match was made on, so an
 *     instructor looking at an unexpected grade can see the evidence.
 *   - Canvas-sourced values (`canvasScore`, `canvasGrade`) and instructor-authored
 *     values (`draftScore`, `draftComment`) live in different fields. An import
 *     therefore cannot destroy an unexported draft: the two never share a slot.
 */

const crypto = require('crypto');

const GRADE_RECORDS_COLLECTION = 'canvas_grade_records';

/** Sync states a row can be in. `draft` means "edited locally, not yet in Canvas". */
const SYNC_STATUS = Object.freeze({
    IMPORTED: 'imported',
    DRAFT: 'draft',
    EXPORTED: 'exported',
    FAILED: 'failed'
});

function collection(db) {
    return db.collection(GRADE_RECORDS_COLLECTION);
}

/**
 * PUIDs identify a person to the institution, and the Grades table only needs
 * enough of one to tell two rows apart. Nothing in BiocBot displays a full PUID
 * today, so the API returns this rather than the raw value.
 * @param {string} puid - The full PUID
 * @returns {string} A masked form showing at most the last four characters
 */
function maskPuid(puid) {
    const value = String(puid || '').trim();
    if (!value) return '';
    if (value.length <= 4) return '••••';
    return `••••${value.slice(-4)}`;
}

function toFiniteNumber(value) {
    if (value === null || value === undefined || value === '') return null;
    const parsed = typeof value === 'number' ? value : Number(String(value).trim());
    return Number.isFinite(parsed) ? parsed : null;
}

function toDate(value) {
    if (!value) return null;
    const date = value instanceof Date ? value : new Date(value);
    return Number.isNaN(date.getTime()) ? null : date;
}

/**
 * The identity half of a row. Every read and write goes through this so a query
 * cannot accidentally span two assignments or two linked courses.
 * @param {Object} scope - Scope values
 * @returns {Object} A Mongo filter naming exactly one row
 */
function recordKey({ courseIntegrationId, gradeItemId, appUserId }) {
    return {
        courseIntegrationId: String(courseIntegrationId),
        gradeItemId: String(gradeItemId),
        appUserId: String(appUserId)
    };
}

/**
 * Filter for every row belonging to one linked course and one assignment.
 * @param {Object} scope - Scope values
 * @returns {Object} A Mongo filter
 */
function assignmentScope({ courseIntegrationId, gradeItemId }) {
    return {
        courseIntegrationId: String(courseIntegrationId),
        gradeItemId: String(gradeItemId)
    };
}

async function ensureIndexes(db) {
    await collection(db).createIndex(
        { courseIntegrationId: 1, gradeItemId: 1, appUserId: 1 },
        { name: 'unique_canvas_grade_record', unique: true }
    );
    await collection(db).createIndex(
        { recordId: 1 },
        { name: 'unique_canvas_grade_record_id', unique: true }
    );
}

/**
 * Whether this row holds instructor work that Canvas has not yet been told
 * about. Import consults it before touching anything an instructor typed.
 * @param {Object} record - A stored record, or null
 * @returns {boolean} True when a draft exists that has not been exported
 */
function hasUnsyncedDraft(record) {
    if (!record) return false;
    const hasDraftValue = record.draftScore !== null && record.draftScore !== undefined;
    const hasComment = Boolean(String(record.draftComment || '').trim());
    if (!hasDraftValue && !hasComment) return false;
    return record.syncStatus !== SYNC_STATUS.EXPORTED;
}

/**
 * Applies one student's Canvas-side values without disturbing their draft.
 *
 * Returns the update document rather than writing, so the caller can batch. The
 * `$setOnInsert` half seeds the fields an import must not clobber on an existing
 * row — a draft written before the first import still survives it.
 *
 * @param {Object} params - Scope, identity, and the Canvas-side values to store
 * @returns {Object} A bulkWrite updateOne operation
 */
function buildImportOperation({
    scope,
    appUserId,
    puid,
    displayName,
    canvas = {},
    submission = null,
    importedAt,
    importedBy,
    existing = null
}) {
    const key = recordKey({ ...scope, appUserId });
    const set = {
        biocbotCourseId: scope.biocbotCourseId,
        canvasCourseId: String(scope.canvasCourseId),
        gradeItemName: scope.gradeItemName || '',
        maxScore: toFiniteNumber(scope.maxScore),
        gradingType: scope.gradingType || null,
        puid: String(puid),
        displayName: displayName || '',
        lastImportedAt: importedAt,
        lastImportedBy: String(importedBy),
        updatedAt: importedAt
    };

    if (Object.prototype.hasOwnProperty.call(canvas, 'score')) {
        set.canvasScore = toFiniteNumber(canvas.score);
    }
    if (Object.prototype.hasOwnProperty.call(canvas, 'grade')) {
        set.canvasGrade = canvas.grade === null || canvas.grade === undefined ? null : String(canvas.grade);
    }
    if (canvas.gradedAt !== undefined) {
        set.canvasGradedAt = toDate(canvas.gradedAt);
    }

    if (submission) {
        set.submissionState = submission.workflowState || 'unsubmitted';
        set.submittedAt = toDate(submission.submittedAt);
        set.submissionAttempt = toFiniteNumber(submission.attempt);
        set.submissionLate = Boolean(submission.late);
        set.submissionMissing = Boolean(submission.missing);
        // Metadata only. Bytes are fetched on demand, per attachment, through
        // the course/assignment/student-scoped downloader.
        set.attachments = (submission.attachments || []).map((attachment) => ({
            id: String(attachment.id),
            filename: attachment.filename || '',
            displayName: attachment.displayName || attachment.filename || '',
            mimeType: attachment.mimeType || null,
            size: toFiniteNumber(attachment.size)
        }));
    }

    // A Canvas value that arrives while a draft is pending is not a reason to
    // discard the draft, but the instructor should be told the two disagree.
    // With no pending draft there is nothing to disagree with, so a flag left
    // over from an earlier import is cleared rather than shown forever.
    if (hasUnsyncedDraft(existing)) {
        const incoming = Object.prototype.hasOwnProperty.call(canvas, 'score')
            ? toFiniteNumber(canvas.score)
            : existing.canvasScore;
        set.draftConflict = incoming !== null && incoming !== undefined && incoming !== existing.draftScore;
    } else {
        set.draftConflict = false;
    }

    return {
        updateOne: {
            filter: key,
            update: {
                $set: set,
                $setOnInsert: {
                    recordId: crypto.randomUUID(),
                    source: 'canvas',
                    draftScore: null,
                    draftComment: '',
                    draftUpdatedAt: null,
                    draftUpdatedBy: null,
                    draftConflict: false,
                    syncStatus: SYNC_STATUS.IMPORTED,
                    syncError: null,
                    lastExportedAt: null,
                    createdAt: importedAt
                }
            },
            upsert: true
        }
    };
}

/**
 * Stores an instructor's local draft score/comment for one student.
 * @param {Object} params - Scope, the student, and the draft values
 * @returns {Promise<Object|null>} The stored record
 */
async function saveDraft(db, { scope, appUserId, puid, displayName, draftScore, draftComment, updatedBy }) {
    const now = new Date();
    const key = recordKey({ ...scope, appUserId });
    await collection(db).updateOne(
        key,
        {
            $set: {
                biocbotCourseId: scope.biocbotCourseId,
                canvasCourseId: String(scope.canvasCourseId),
                gradeItemName: scope.gradeItemName || '',
                maxScore: toFiniteNumber(scope.maxScore),
                gradingType: scope.gradingType || null,
                puid: String(puid),
                displayName: displayName || '',
                draftScore: toFiniteNumber(draftScore),
                draftComment: String(draftComment || ''),
                draftUpdatedAt: now,
                draftUpdatedBy: String(updatedBy),
                // The instructor has now seen and replaced the value, so any
                // previously flagged disagreement with Canvas is resolved.
                draftConflict: false,
                syncStatus: SYNC_STATUS.DRAFT,
                syncError: null,
                updatedAt: now
            },
            $setOnInsert: {
                recordId: crypto.randomUUID(),
                source: 'local',
                canvasScore: null,
                canvasGrade: null,
                canvasGradedAt: null,
                submissionState: null,
                submittedAt: null,
                attachments: [],
                lastImportedAt: null,
                lastExportedAt: null,
                createdAt: now
            }
        },
        { upsert: true }
    );

    return collection(db).findOne(key);
}

async function listForAssignment(db, scope) {
    return collection(db).find(assignmentScope(scope)).toArray();
}

/**
 * Loads the rows an export names, re-scoped to the authorized integration and
 * assignment. Ids supplied by the browser therefore cannot reach a row in
 * another course or another assignment even if they name one.
 * @param {Object} db - MongoDB database instance
 * @param {Object} scope - The authorized integration/assignment scope
 * @param {string[]} recordIds - Record ids selected in the UI
 * @returns {Promise<Object[]>} Matching records
 */
async function listSelectedForExport(db, scope, recordIds) {
    const filter = assignmentScope(scope);
    if (Array.isArray(recordIds) && recordIds.length) {
        filter.recordId = { $in: recordIds.map((id) => String(id)) };
    }
    return collection(db).find(filter).toArray();
}

/**
 * A stable digest of the values an export is about to send.
 *
 * Recomputed at confirmation and compared with the value stored at preview, so
 * a draft edited in another tab between the two steps cannot be exported under
 * a preview the instructor approved for different numbers.
 *
 * @param {Object[]} records - The records being exported
 * @returns {string} A hex digest
 */
function fingerprintRecords(records) {
    const canonical = records
        .map((record) => [
            String(record.recordId),
            String(record.appUserId),
            String(record.puid),
            record.draftScore === null || record.draftScore === undefined ? '' : String(record.draftScore),
            String(record.draftComment || '')
        ].join(' '))
        .sort()
        .join('');
    return crypto.createHash('sha256').update(canonical).digest('hex');
}

/**
 * Records the outcome of an export attempt against the rows it covered.
 * @param {Object} db - MongoDB database instance
 * @param {Object} scope - The authorized integration/assignment scope
 * @param {string[]} recordIds - Rows the export covered
 * @param {Object} outcome - `{ status, error, exportedAt }`
 * @returns {Promise<void>}
 */
async function markExportOutcome(db, scope, recordIds, { status, error = null, exportedAt = new Date() }) {
    if (!recordIds.length) return;
    await collection(db).updateMany(
        { ...assignmentScope(scope), recordId: { $in: recordIds.map((id) => String(id)) } },
        {
            $set: {
                syncStatus: status,
                syncError: error,
                lastExportedAt: status === SYNC_STATUS.EXPORTED ? exportedAt : null,
                updatedAt: new Date()
            }
        }
    );
}

/**
 * Marks rows that an acknowledged partial export deliberately left out.
 *
 * They stay `draft`: the instructor's work is still unsent, and calling it
 * exported would hide a grade that never reached Canvas behind a green tick.
 *
 * @param {Object} db - MongoDB database instance
 * @param {Object} scope - The authorized integration/assignment scope
 * @param {string[]} recordIds - Rows left out of the batch
 * @returns {Promise<void>}
 */
async function markSkipped(db, scope, recordIds) {
    if (!recordIds.length) return;
    await collection(db).updateMany(
        { ...assignmentScope(scope), recordId: { $in: recordIds.map((id) => String(id)) } },
        {
            $set: {
                syncStatus: SYNC_STATUS.DRAFT,
                syncError: 'Skipped: not matched on the linked Canvas course roster',
                updatedAt: new Date()
            }
        }
    );
}

/**
 * Shapes one row for the browser. Drops the full PUID and never includes a
 * Canvas user id — the table has no use for either.
 * @param {Object} record - A stored record
 * @returns {Object} A safe view model
 */
function toClientView(record) {
    return {
        recordId: record.recordId,
        appUserId: record.appUserId,
        displayName: record.displayName || record.appUserId,
        puidMasked: maskPuid(record.puid),
        source: record.source,
        canvasScore: record.canvasScore ?? null,
        canvasGrade: record.canvasGrade ?? null,
        maxScore: record.maxScore ?? null,
        gradingType: record.gradingType || null,
        draftScore: record.draftScore ?? null,
        draftComment: record.draftComment || '',
        draftConflict: Boolean(record.draftConflict),
        submissionState: record.submissionState || null,
        submittedAt: record.submittedAt || null,
        submissionLate: Boolean(record.submissionLate),
        submissionMissing: Boolean(record.submissionMissing),
        attachments: (record.attachments || []).map((attachment) => ({
            id: attachment.id,
            displayName: attachment.displayName,
            mimeType: attachment.mimeType,
            size: attachment.size
        })),
        syncStatus: record.syncStatus || SYNC_STATUS.IMPORTED,
        syncError: record.syncError || null,
        lastImportedAt: record.lastImportedAt || null,
        lastExportedAt: record.lastExportedAt || null
    };
}

module.exports = {
    GRADE_RECORDS_COLLECTION,
    SYNC_STATUS,
    assignmentScope,
    buildImportOperation,
    collection,
    ensureIndexes,
    fingerprintRecords,
    hasUnsyncedDraft,
    listForAssignment,
    listSelectedForExport,
    markExportOutcome,
    markSkipped,
    maskPuid,
    recordKey,
    saveDraft,
    toClientView,
    toFiniteNumber
};
