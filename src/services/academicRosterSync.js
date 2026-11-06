const { createId } = require('./id');
const { getAcademicApiClient } = require('./academicApi');
const { normalizeEmail } = require('./authorization');
const { buildPlaceholderStudent } = require('../models/User');

function normalizeText(value) {
    return typeof value === 'string' ? value.trim() : '';
}

function normalizeAcademicPerson(person = {}) {
    const puid = normalizeText(person.puid || person.PUID || person.puidId);
    const studentId = normalizeText(person.ID || person.Student_ID || person.studentId || person.student_id);
    const email = normalizeEmail(person.email || person.workEmail || person.personalEmail || person.Email);
    const preferredName = normalizeText(
        person.preferredName ||
        person.displayName ||
        person.name ||
        person.Preferred_Name ||
        person.Legal_Name
    );

    return {
        puid,
        studentId,
        email,
        preferredName
    };
}

function generateUserId() {
    return createId('user');
}

async function findExistingStudent(usersCollection, student) {
    const query = [];
    if (student.puid) query.push({ puid: student.puid });
    if (student.email) query.push({ email: student.email });
    if (student.studentId) query.push({ academicStudentId: student.studentId });

    if (query.length === 0) {
        return null;
    }

    return usersCollection.findOne({ $or: query });
}

async function upsertAcademicStudent(db, student, courseId) {
    const usersCollection = db.collection('users');
    const now = new Date();
    const existing = await findExistingStudent(usersCollection, student);

    if (existing) {
        const setFields = {
            updatedAt: now
        };

        if (student.puid && !existing.puid) setFields.puid = student.puid;
        if (student.studentId && !existing.academicStudentId) setFields.academicStudentId = student.studentId;
        if (student.email && !existing.email) setFields.email = student.email;
        if (student.preferredName && (!existing.displayName || existing.displayName === existing.username)) {
            setFields.displayName = student.preferredName;
        }
        if (!existing.preferences || !existing.preferences.courseId) {
            setFields['preferences.courseId'] = courseId;
        }

        await usersCollection.updateOne(
            { userId: existing.userId },
            { $set: setFields }
        );

        return {
            ...existing,
            ...setFields,
            preferences: {
                ...(existing.preferences || {}),
                courseId: setFields['preferences.courseId'] || existing.preferences?.courseId || null
            },
            created: false
        };
    }

    const user = buildPlaceholderStudent({
        username: student.email || student.puid || student.studentId || generateUserId(),
        puid: student.puid,
        email: student.email,
        displayName: student.preferredName,
        academicStudentId: student.studentId,
        courseId
    }, now);

    await usersCollection.insertOne(user);

    return {
        ...user,
        created: true
    };
}

/**
 * The accounts this course's academic sync enrolled earlier. Enrollment records
 * are keyed by user id and hold no identity: a course document is not encrypted
 * and its enrollment keys are dynamic, so `users` stays the only place that
 * says who an account is.
 * @param {Object} course
 * @returns {Set<string>}
 */
function getManagedEnrollmentUserIds(course = {}) {
    const enrollment = course.studentEnrollment || {};
    return new Set(
        Object.entries(enrollment)
            .filter(([, record]) => record && record.source === 'academicSync')
            .map(([userId]) => userId)
    );
}

const ENROLLMENT_IDENTITY_FIELDS = Object.freeze(['puid', 'studentId', 'email', 'displayName', 'academicSync']);

/**
 * Remove the copies of PUIDs, student numbers, emails, and names that earlier
 * academic syncs saved on enrollment records. Safe to run on every start: a
 * course with nothing left to remove is not written.
 * @param {Object} db - The raw database; `courses` is not encrypted
 * @returns {Promise<number>} How many courses changed
 */
async function stripEnrollmentIdentity(db) {
    const courses = db.collection('courses');
    const rows = await courses
        .find({ studentEnrollment: { $exists: true } }, { projection: { courseId: 1, studentEnrollment: 1 } })
        .toArray();

    let changed = 0;
    for (const { _id, studentEnrollment } of rows) {
        /** @type {Record<string, ''>} */
        const unset = {};
        for (const [userId, record] of Object.entries(studentEnrollment || {})) {
            for (const field of ENROLLMENT_IDENTITY_FIELDS) {
                if (record && Object.hasOwn(record, field)) {
                    unset[`studentEnrollment.${userId}.${field}`] = '';
                }
            }
        }
        if (Object.keys(unset).length) {
            await courses.updateOne({ _id }, { $unset: unset });
            changed += 1;
        }
    }
    return changed;
}

async function syncCourseRoster(db, courseId, options = {}) {
    const coursesCollection = db.collection('courses');
    const course = await coursesCollection.findOne({ courseId });

    if (!course) {
        return { success: false, error: 'Course not found' };
    }

    const academicPeriod = options.academicPeriod || course.academicSync?.academicPeriod;
    const sectionIds = Array.isArray(options.sectionIds) && options.sectionIds.length > 0
        ? options.sectionIds
        : course.academicSync?.sectionIds;

    if (!academicPeriod || !Array.isArray(sectionIds) || sectionIds.length === 0) {
        return { success: false, error: 'Course is not linked to academic sections' };
    }

    const api = options.academicApi || getAcademicApiClient();
    const roster = await api.getStudentsFromSections(sectionIds, academicPeriod);
    const incoming = new Map();
    const skipped = [];

    for (const rawStudent of roster || []) {
        const student = normalizeAcademicPerson(rawStudent);
        if (!student.puid) {
            skipped.push({ reason: 'missing_puid', student });
            continue;
        }
        incoming.set(student.puid, student);
    }

    if ((roster || []).length > 0 && incoming.size === 0) {
        return {
            success: false,
            error: 'Roster contained students, but none included a PUID. No enrollment changes were made.',
            skipped: skipped.length
        };
    }

    const managedBefore = getManagedEnrollmentUserIds(course);
    const now = new Date();
    const summary = {
        success: true,
        courseId,
        academicPeriod,
        sectionIds,
        incomingCount: incoming.size,
        added: 0,
        updated: 0,
        removed: 0,
        skipped: skipped.length
    };

    const syncedUserIds = new Set();
    for (const student of incoming.values()) {
        const user = await upsertAcademicStudent(db, student, courseId);
        syncedUserIds.add(user.userId);

        await coursesCollection.updateOne(
            { courseId },
            {
                $set: {
                    [`studentEnrollment.${user.userId}`]: {
                        enrolled: true,
                        source: 'academicSync',
                        syncedAt: now,
                        updatedAt: now
                    },
                    updatedAt: now
                }
            }
        );

        if (managedBefore.has(user.userId)) {
            summary.updated += 1;
        } else {
            summary.added += 1;
        }
    }

    for (const userId of managedBefore) {
        if (syncedUserIds.has(userId)) continue;

        await coursesCollection.updateOne(
            { courseId },
            {
                $set: {
                    [`studentEnrollment.${userId}.enrolled`]: false,
                    [`studentEnrollment.${userId}.droppedAt`]: now,
                    [`studentEnrollment.${userId}.syncedAt`]: now,
                    [`studentEnrollment.${userId}.updatedAt`]: now,
                    updatedAt: now
                }
            }
        );
        summary.removed += 1;
    }

    await coursesCollection.updateOne(
        { courseId },
        {
            $set: {
                academicSync: {
                    ...(course.academicSync || {}),
                    academicPeriod,
                    sectionIds,
                    lastSyncAt: now,
                    lastSyncSummary: summary
                },
                rosterSource: 'academicSync',
                updatedAt: now
            }
        }
    );

    return summary;
}

module.exports = {
    normalizeAcademicPerson,
    stripEnrollmentIdentity,
    syncCourseRoster,
    upsertAcademicStudent
};
