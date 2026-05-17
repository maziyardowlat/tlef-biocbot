// @ts-check
/**
 * Shared helpers for API-level coverage specs that target `src/routes/*` and
 * the underlying models. Each spec gets its own stable courseId prefix so
 * parallel-disabled runs don't trample one another.
 *
 * Conventions:
 *   - All test courses use the prefix `BIOC-E2E-API-*`.
 *   - `seedCourse()` is idempotent (delete-then-insert).
 *   - `cleanupCourses()` removes courses by id list.
 *   - DB access via MongoClient — relies on MONGO_URI being set in the env
 *     loaded by dotenv.
 */

require('dotenv').config();
const { MongoClient } = require('mongodb');

async function withDb(fn) {
    if (!process.env.MONGO_URI) {
        throw new Error('MONGO_URI not set; cannot run API-coverage tests.');
    }
    const client = new MongoClient(process.env.MONGO_URI);
    await client.connect();
    try {
        return await fn(client.db());
    } finally {
        await client.close();
    }
}

async function getUserIdByUsername(username) {
    return withDb(async (db) => {
        const u = await db.collection('users').findOne({ username });
        if (!u) throw new Error(`User ${username} not found in DB.`);
        return u.userId;
    });
}

/**
 * Insert a course document, replacing any pre-existing doc with the same
 * courseId. All optional fields default to reasonable values; pass overrides
 * via `overrides` to tweak.
 *
 * @param {Object} args
 * @param {string} args.courseId
 * @param {string} args.instructorId
 * @param {string} [args.courseName]
 * @param {string[]} [args.instructors]
 * @param {string[]} [args.tas]
 * @param {Object} [args.taPermissions]
 * @param {string} [args.status]
 * @param {string} [args.courseCode]
 * @param {string} [args.instructorCourseCode]
 * @param {Object} [args.studentEnrollment]
 * @param {Array} [args.lectures]
 * @param {Object} [args.overrides]
 */
async function seedCourse({
    courseId,
    instructorId,
    courseName = courseId,
    instructors,
    tas = [],
    taPermissions = {},
    status = 'active',
    courseCode = 'STUCD',
    instructorCourseCode = 'INSTCD',
    studentEnrollment = {},
    lectures,
    overrides = {},
}) {
    const now = new Date();
    const instructorList = instructors || [instructorId];
    const defaultLectures = lectures || [
        {
            name: 'Unit 1',
            displayName: 'Unit 1',
            isPublished: false,
            learningObjectives: [],
            passThreshold: 2,
            createdAt: now,
            updatedAt: now,
            documents: [],
            assessmentQuestions: [],
        },
        {
            name: 'Unit 2',
            displayName: 'Unit 2',
            isPublished: false,
            learningObjectives: [],
            passThreshold: 2,
            createdAt: now,
            updatedAt: now,
            documents: [],
            assessmentQuestions: [],
        },
    ];

    const doc = {
        courseId,
        courseName,
        courseCode,
        instructorCourseCode,
        instructorId,
        instructors: instructorList,
        tas,
        taPermissions,
        courseDescription: '',
        assessmentCriteria: '',
        courseMaterials: [],
        approvedStruggleTopics: [],
        courseStructure: {
            weeks: defaultLectures.length,
            lecturesPerWeek: 1,
            totalUnits: defaultLectures.length,
        },
        isOnboardingComplete: true,
        status,
        studentEnrollment,
        lectures: defaultLectures,
        createdAt: now,
        updatedAt: now,
        ...overrides,
    };

    await withDb(async (db) => {
        await db.collection('courses').deleteMany({ courseId });
        await db.collection('courses').insertOne(doc);
    });

    return doc;
}

async function cleanupCourses(courseIds) {
    if (!courseIds || !courseIds.length) return;
    await withDb(async (db) => {
        await db.collection('courses').deleteMany({ courseId: { $in: courseIds } });
        await db.collection('documents').deleteMany({ courseId: { $in: courseIds } });
        await db.collection('quizAttempts').deleteMany({ courseId: { $in: courseIds } });
        await db.collection('chat_sessions').deleteMany({ courseId: { $in: courseIds } });
    });
}

async function setStudentEnrollment(courseId, studentId, enrolled) {
    await withDb(async (db) => {
        await db.collection('courses').updateOne(
            { courseId },
            { $set: { [`studentEnrollment.${studentId}`]: { enrolled, enrolledAt: new Date() } } }
        );
    });
}

async function setCourseStatus(courseId, status) {
    await withDb(async (db) => {
        await db.collection('courses').updateOne(
            { courseId },
            { $set: { status, updatedAt: new Date() } }
        );
    });
}

/**
 * Remove all courses owned by an instructor (or where they appear in
 * instructors/tas arrays). Used to clear stale state between tests so that
 * routes which find-by-instructorId don't accidentally target the wrong doc.
 */
async function cleanupCoursesForUser(userId) {
    await withDb(async (db) => {
        const courses = await db.collection('courses').find(
            {
                $or: [
                    { instructorId: userId },
                    { instructors: userId },
                    { tas: userId },
                ],
            },
            { projection: { courseId: 1 } }
        ).toArray();
        const ids = courses.map((c) => c.courseId);
        if (ids.length === 0) return;
        await db.collection('courses').deleteMany({ courseId: { $in: ids } });
        await db.collection('documents').deleteMany({ courseId: { $in: ids } });
        await db.collection('quizAttempts').deleteMany({ courseId: { $in: ids } });
        await db.collection('chat_sessions').deleteMany({ courseId: { $in: ids } });
    });
}

module.exports = {
    withDb,
    getUserIdByUsername,
    seedCourse,
    cleanupCourses,
    cleanupCoursesForUser,
    setStudentEnrollment,
    setCourseStatus,
};
