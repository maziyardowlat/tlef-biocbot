/**
 * Unit tests for the preview-specific behaviour in the Course model.
 *
 * A "View as Student" sandbox has no enrollment record and must never gain one:
 * an entry in course.studentEnrollment surfaces in the instructor's Student Hub
 * as a student named after the sandbox's internal id.
 */
const { memoryDb } = require('../helpers/memory-db');
const CourseModel = require('../../../src/models/Course');
const previewSession = require('../../../src/services/previewSession');

const COURSE_ID = 'BIOC-302';
const OTHER_COURSE_ID = 'BIOC-303';
const PREVIEW_ID = previewSession.buildPreviewUserId('inst-1', COURSE_ID);

beforeAll(() => {
    jest.spyOn(console, 'log').mockImplementation(() => {});
});

afterAll(() => {
    jest.restoreAllMocks();
});

/**
 * Database seeded with two active courses.
 * @returns {Object} Memory database
 */
function seedDb() {
    return memoryDb({
        courses: [
            { courseId: COURSE_ID, courseCode: 'JOIN-1', status: 'active', studentEnrollment: {} },
            { courseId: OTHER_COURSE_ID, courseCode: 'JOIN-2', status: 'active', studentEnrollment: {} }
        ]
    });
}

describe('userHasCourseAccess with a preview identity', () => {
    test('grants access to the course the preview id encodes', async () => {
        const db = seedDb();

        await expect(
            CourseModel.userHasCourseAccess(db, COURSE_ID, PREVIEW_ID, 'student')
        ).resolves.toBe(true);
    });

    test('refuses any other course, so a preview cannot roam', async () => {
        const db = seedDb();

        await expect(
            CourseModel.userHasCourseAccess(db, OTHER_COURSE_ID, PREVIEW_ID, 'student')
        ).resolves.toBe(false);
    });

    test('a real unenrolled student is still refused', async () => {
        const db = seedDb();

        await expect(
            CourseModel.userHasCourseAccess(db, COURSE_ID, 'real-student', 'student')
        ).resolves.toBe(false);
    });
});

describe('getStudentEnrollment with a preview identity', () => {
    // Several route handlers check enrollment here directly rather than through
    // userHasCourseAccess, so this is the choke point that keeps the student
    // pages from 403ing during a preview.
    test('reports enrolled in the course the preview id encodes', async () => {
        const db = seedDb();

        const result = await CourseModel.getStudentEnrollment(db, COURSE_ID, PREVIEW_ID);

        expect(result).toMatchObject({ success: true, enrolled: true, preview: true });
    });

    test('reports not enrolled in any other course', async () => {
        const db = seedDb();

        const result = await CourseModel.getStudentEnrollment(db, OTHER_COURSE_ID, PREVIEW_ID);

        expect(result.enrolled).toBe(false);
    });

    test('allows previewing an inactive course, which a real student cannot enter', async () => {
        const db = memoryDb({
            courses: [{ courseId: COURSE_ID, status: 'inactive', studentEnrollment: { 'real-student': { enrolled: true } } }]
        });

        const preview = await CourseModel.getStudentEnrollment(db, COURSE_ID, PREVIEW_ID);
        const real = await CourseModel.getStudentEnrollment(db, COURSE_ID, 'real-student');

        expect(preview.enrolled).toBe(true);
        expect(real.enrolled).toBe(false);
    });

    test('refuses a deleted course, which is gone for everyone', async () => {
        const db = memoryDb({
            courses: [{ courseId: COURSE_ID, status: 'deleted', studentEnrollment: {} }]
        });

        const result = await CourseModel.getStudentEnrollment(db, COURSE_ID, PREVIEW_ID);

        expect(result.enrolled).toBe(false);
    });
});

describe('joinCourse with a preview identity', () => {
    test('succeeds without writing an enrollment record', async () => {
        const db = seedDb();

        const result = await CourseModel.joinCourse(db, COURSE_ID, PREVIEW_ID, 'JOIN-1');

        expect(result.success).toBe(true);
        expect(result.preview).toBe(true);

        const course = await db.collection('courses').findOne({ courseId: COURSE_ID });
        expect(course.studentEnrollment).toEqual({});
    });

    test('refuses to join a course outside the preview grant', async () => {
        const db = seedDb();

        const result = await CourseModel.joinCourse(db, OTHER_COURSE_ID, PREVIEW_ID, 'JOIN-2');

        expect(result.success).toBe(false);

        const course = await db.collection('courses').findOne({ courseId: OTHER_COURSE_ID });
        expect(course.studentEnrollment).toEqual({});
    });

    test('a real student still enrolls normally', async () => {
        const db = seedDb();

        const result = await CourseModel.joinCourse(db, COURSE_ID, 'real-student', 'JOIN-1');

        expect(result.success).toBe(true);

        const course = await db.collection('courses').findOne({ courseId: COURSE_ID });
        expect(course.studentEnrollment['real-student']).toBeDefined();
    });
});
