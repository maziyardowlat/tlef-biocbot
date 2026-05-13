// @ts-check
/**
 * Shared seed data for Student Hub e2e coverage.
 */

const { withDb } = require('./quiz');

const HUB_COURSE_ID = 'BIOC-E2E-STUDENT-HUB';
const HUB_COURSE_NAME = 'BIOC E2E Student Hub';
const HUB_OTHER_COURSE_ID = 'BIOC-E2E-STUDENT-HUB-OTHER';
const HUB_OTHER_COURSE_NAME = 'BIOC E2E Student Hub Other';
const HUB_UNRELATED_COURSE_ID = 'BIOC-E2E-STUDENT-HUB-UNRELATED';
const HUB_UNRELATED_COURSE_NAME = 'BIOC E2E Student Hub Unrelated';
const HUB_EMPTY_COURSE_ID = 'BIOC-E2E-STUDENT-HUB-EMPTY';
const HUB_EMPTY_COURSE_NAME = 'BIOC E2E Student Hub Empty';

const HUB_ACTIVE_STUDENT = {
    userId: 'user_e2e_student_hub_active',
    username: 'e2e_hub_active',
    email: 'e2e-hub-active@test.local',
    role: 'student',
    displayName: 'Student Hub Ada',
};

const HUB_XSS_STUDENT = {
    userId: 'user_e2e_student_hub_xss',
    username: 'e2e_hub_xss',
    email: 'e2e-hub-xss@test.local',
    role: 'student',
    displayName: '<img src=x onerror="window.__studentHubXss = true">',
};

const HUB_OTHER_STUDENT = {
    userId: 'user_e2e_student_hub_other',
    username: 'e2e_hub_other',
    email: 'e2e-hub-other@test.local',
    role: 'student',
    displayName: 'Student Hub Other Course',
};

const HUB_INACTIVE_STUDENT = {
    userId: 'user_e2e_student_hub_inactive',
    username: 'e2e_hub_inactive',
    email: 'e2e-hub-inactive@test.local',
    role: 'student',
    displayName: 'Student Hub Inactive Account',
};

const HUB_PROMOTE_TARGET = {
    userId: 'user_e2e_student_hub_promote_target',
    username: 'e2e_hub_promote_target',
    email: 'e2e-hub-promote-target@test.local',
    role: 'student',
    displayName: 'Student Hub Promote Target',
};

const HUB_PENDING_TA = {
    userId: 'user_e2e_student_hub_pending_ta',
    username: 'e2e_hub_pending_ta',
    email: 'e2e-hub-pending-ta@test.local',
    role: 'ta',
    displayName: 'Student Hub Pending TA',
};

const HUB_SYNTHETIC_USER_IDS = [
    HUB_ACTIVE_STUDENT.userId,
    HUB_XSS_STUDENT.userId,
    HUB_OTHER_STUDENT.userId,
    HUB_INACTIVE_STUDENT.userId,
    HUB_PROMOTE_TARGET.userId,
    HUB_PENDING_TA.userId,
];

const HUB_COURSE_IDS = [
    HUB_COURSE_ID,
    HUB_OTHER_COURSE_ID,
    HUB_UNRELATED_COURSE_ID,
    HUB_EMPTY_COURSE_ID,
];

function buildCourseDoc({
    courseId,
    courseName,
    instructorId,
    tas = /** @type {string[]} */ ([]),
    studentEnrollment = /** @type {Record<string, any>} */ ({}),
    anonymizeStudents = /** @type {Record<string, any>} */ ({}),
    status = 'active',
    now = new Date(),
}) {
    return {
        courseId,
        courseName,
        courseCode: `${courseId}-S`,
        instructorCourseCode: `${courseId}-I`,
        instructorId,
        instructors: [instructorId],
        tas,
        taPermissions: {},
        courseDescription: '',
        assessmentCriteria: '',
        courseMaterials: [],
        approvedStruggleTopics: ['oxidative phosphorylation', 'enzyme kinetics'],
        courseStructure: { weeks: 1, lecturesPerWeek: 1, totalUnits: 1 },
        isOnboardingComplete: true,
        status,
        quizSettings: {
            enabled: true,
            testableUnits: 'all',
            allowLectureMaterialAccess: true,
            allowSourceAttributionDownloads: false,
        },
        anonymizeStudents,
        studentEnrollment,
        lectures: [
            {
                name: 'Unit 1',
                displayName: 'Unit 1',
                isPublished: true,
                learningObjectives: [],
                passThreshold: 0,
                createdAt: now,
                updatedAt: now,
                documents: [],
                assessmentQuestions: [],
            },
        ],
        createdAt: now,
        updatedAt: now,
    };
}

function buildStudentDoc(student, overrides = {}) {
    const now = new Date('2026-01-20T12:00:00.000Z');
    return {
        ...student,
        authProvider: 'local',
        isActive: true,
        preferences: {},
        createdAt: now,
        updatedAt: now,
        ...overrides,
    };
}

/**
 * @param {Object} args
 * @param {string} args.instructorId
 * @param {string} args.freshInstructorId
 * @param {string} args.taId
 * @param {Object} [args.options]
 * @param {boolean} [args.options.anonymizeStudents=false]
 * @param {boolean} [args.options.includeInactiveStudent=false]
 * @param {boolean} [args.options.includePendingTA=false]
 * @param {boolean} [args.options.assignTaToOtherCourse=false]
 */
async function resetStudentHubData({ instructorId, freshInstructorId, taId, options = {} }) {
    const {
        anonymizeStudents = false,
        includeInactiveStudent = false,
        includePendingTA = false,
        assignTaToOtherCourse = false,
    } = options;
    const now = new Date('2026-01-20T12:00:00.000Z');

    await withDb(async (db) => {
        await db.collection('courses').deleteMany({ courseId: { $in: HUB_COURSE_IDS } });
        await db.collection('chat_sessions').deleteMany({ courseId: { $in: HUB_COURSE_IDS } });
        await db.collection('users').deleteMany({ userId: { $in: HUB_SYNTHETIC_USER_IDS } });

        await db.collection('users').updateOne(
            { userId: taId },
            {
                $set: {
                    role: 'ta',
                    isActive: true,
                    invitedCourses: [],
                    updatedAt: now,
                },
            }
        );

        const users = [
            buildStudentDoc(HUB_ACTIVE_STUDENT, {
                preferences: { courseId: HUB_COURSE_ID },
                struggleState: {
                    topics: [
                        {
                            topic: 'oxidative phosphorylation',
                            count: 3,
                            lastStruggle: new Date('2026-01-19T15:00:00.000Z'),
                            isActive: true,
                        },
                        {
                            topic: 'enzyme kinetics',
                            count: 1,
                            lastStruggle: new Date('2026-01-18T10:00:00.000Z'),
                            isActive: false,
                        },
                    ],
                },
            }),
            buildStudentDoc(HUB_XSS_STUDENT, {
                preferences: { courseId: HUB_COURSE_ID },
            }),
            buildStudentDoc(HUB_OTHER_STUDENT, {
                preferences: { courseId: HUB_OTHER_COURSE_ID },
            }),
            buildStudentDoc(HUB_PROMOTE_TARGET, {
                preferences: { courseId: HUB_UNRELATED_COURSE_ID },
            }),
        ];

        if (includeInactiveStudent) {
            users.push(buildStudentDoc(HUB_INACTIVE_STUDENT, {
                isActive: false,
                preferences: { courseId: HUB_COURSE_ID },
            }));
        }

        if (includePendingTA) {
            users.push(buildStudentDoc(HUB_PENDING_TA, {
                role: 'ta',
                invitedCourses: [HUB_COURSE_ID],
                preferences: { courseId: HUB_COURSE_ID },
            }));
        }

        await db.collection('users').insertMany(users);

        const mainEnrollment = {
            [HUB_ACTIVE_STUDENT.userId]: { enrolled: true, enrolledAt: now },
            [HUB_XSS_STUDENT.userId]: { enrolled: true, enrolledAt: now },
        };

        if (includeInactiveStudent) {
            mainEnrollment[HUB_INACTIVE_STUDENT.userId] = { enrolled: true, enrolledAt: now };
        }

        if (includePendingTA) {
            mainEnrollment[HUB_PENDING_TA.userId] = { enrolled: true, enrolledAt: now };
        }

        await db.collection('courses').insertMany([
            buildCourseDoc({
                courseId: HUB_COURSE_ID,
                courseName: HUB_COURSE_NAME,
                instructorId,
                tas: [taId],
                studentEnrollment: mainEnrollment,
                anonymizeStudents: {
                    [instructorId]: {
                        enabled: anonymizeStudents,
                        updatedAt: now,
                    },
                },
                now,
            }),
            buildCourseDoc({
                courseId: HUB_OTHER_COURSE_ID,
                courseName: HUB_OTHER_COURSE_NAME,
                instructorId,
                tas: assignTaToOtherCourse ? [taId] : [],
                studentEnrollment: {
                    [HUB_OTHER_STUDENT.userId]: { enrolled: true, enrolledAt: now },
                },
                anonymizeStudents: {
                    [instructorId]: {
                        enabled: false,
                        updatedAt: now,
                    },
                },
                now,
            }),
            buildCourseDoc({
                courseId: HUB_UNRELATED_COURSE_ID,
                courseName: HUB_UNRELATED_COURSE_NAME,
                instructorId: freshInstructorId,
                studentEnrollment: {
                    [HUB_PROMOTE_TARGET.userId]: { enrolled: true, enrolledAt: now },
                },
                anonymizeStudents: {
                    [freshInstructorId]: {
                        enabled: false,
                        updatedAt: now,
                    },
                },
                now,
            }),
            buildCourseDoc({
                courseId: HUB_EMPTY_COURSE_ID,
                courseName: HUB_EMPTY_COURSE_NAME,
                instructorId,
                studentEnrollment: {},
                anonymizeStudents: {
                    [instructorId]: {
                        enabled: false,
                        updatedAt: now,
                    },
                },
                now,
            }),
        ]);
    });
}

async function cleanupStudentHubData() {
    await withDb(async (db) => {
        await db.collection('courses').deleteMany({ courseId: { $in: HUB_COURSE_IDS } });
        await db.collection('chat_sessions').deleteMany({ courseId: { $in: HUB_COURSE_IDS } });
        await db.collection('users').deleteMany({ userId: { $in: HUB_SYNTHETIC_USER_IDS } });
    });
}

async function getHubCourse(courseId = HUB_COURSE_ID) {
    return withDb((db) => db.collection('courses').findOne({ courseId }));
}

async function getHubUser(userId) {
    return withDb((db) => db.collection('users').findOne({ userId }));
}

module.exports = {
    HUB_COURSE_ID,
    HUB_COURSE_NAME,
    HUB_OTHER_COURSE_ID,
    HUB_OTHER_COURSE_NAME,
    HUB_UNRELATED_COURSE_ID,
    HUB_UNRELATED_COURSE_NAME,
    HUB_EMPTY_COURSE_ID,
    HUB_EMPTY_COURSE_NAME,
    HUB_ACTIVE_STUDENT,
    HUB_XSS_STUDENT,
    HUB_OTHER_STUDENT,
    HUB_INACTIVE_STUDENT,
    HUB_PROMOTE_TARGET,
    HUB_PENDING_TA,
    resetStudentHubData,
    cleanupStudentHubData,
    getHubCourse,
    getHubUser,
};
