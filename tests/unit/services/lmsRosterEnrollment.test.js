const { memoryDb } = require('../helpers/memory-db');
const {
    canvasEnrollmentOf,
    enrollStudentFromSavedRosters,
    isBlockedOutsideCanvas,
    listPendingRosterEntries,
    replaceRosterEntries
} = require('../../../src/services/lmsRosterEnrollment');

const NOW = new Date('2026-10-01T12:00:00Z');
const ada = { userId: 'stu-a', role: 'student', puid: 'PUID-A', email: 'ada@student.ubc.ca' };
const adaAccount = { userId: 'stu-a', role: 'student', puid: 'PUID-A', email: 'ada@student.ubc.ca' };

function rosterRow(overrides = {}) {
    return {
        courseId: 'BIOC-1',
        provider: 'canvas',
        externalCourseId: '10',
        externalUserId: '701',
        name: 'Ada',
        email: 'ada@student.ubc.ca',
        emailKey: 'ada@student.ubc.ca',
        integrationIdKey: 'puid-a',
        localUserId: null,
        syncedAt: new Date('2026-09-30'),
        ...overrides
    };
}

function classListCourse(overrides = {}) {
    return {
        courseId: 'BIOC-1',
        status: 'active',
        rosterSource: 'canvas',
        canvasEnrollment: { enabled: true, externalCourseId: '10' },
        studentEnrollment: {},
        ...overrides
    };
}

async function enrollmentOf(db, courseId, userId) {
    const course = await db.collection('courses').findOne({ courseId });
    return course.studentEnrollment?.[userId];
}

describe('enrollStudentFromSavedRosters', () => {
    test('enrolls a student whose PUID is on a saved class list and claims the row', async () => {
        const db = memoryDb({ users: [adaAccount], courses: [classListCourse()], lms_roster_entries: [rosterRow()] });

        expect(await enrollStudentFromSavedRosters(db, ada, { now: NOW })).toEqual(['BIOC-1']);

        expect(await enrollmentOf(db, 'BIOC-1', 'stu-a')).toEqual({
            enrolled: true,
            source: 'canvas',
            externalUserId: '701',
            externalCourseId: '10',
            joinedAt: NOW,
            syncedAt: NOW,
            updatedAt: NOW
        });
        expect((await db.collection('lms_roster_entries').findOne({ externalUserId: '701' })).localUserId).toBe('stu-a');
        // Nothing left to do on the next page load.
        expect(await enrollStudentFromSavedRosters(db, ada, { now: NOW })).toEqual([]);
    });

    test('matches PUIDs whatever their case', async () => {
        const db = memoryDb({
            users: [{ ...adaAccount, puid: 'puid-a' }],
            courses: [classListCourse()],
            lms_roster_entries: [rosterRow()]
        });
        expect(await enrollStudentFromSavedRosters(db, { ...ada, puid: 'puid-a' }, { now: NOW })).toEqual(['BIOC-1']);
    });

    test('falls back to email for a roster row that carries no PUID', async () => {
        const db = memoryDb({
            users: [adaAccount],
            courses: [classListCourse()],
            lms_roster_entries: [rosterRow({ integrationIdKey: null })]
        });
        expect(await enrollStudentFromSavedRosters(db, ada, { now: NOW })).toEqual(['BIOC-1']);
    });

    test('never matches by email a row that belongs to a different PUID', async () => {
        const db = memoryDb({
            users: [adaAccount],
            courses: [classListCourse()],
            lms_roster_entries: [rosterRow({ integrationIdKey: 'puid-someone-else' })]
        });
        expect(await enrollStudentFromSavedRosters(db, ada, { now: NOW })).toEqual([]);
        expect(await enrollmentOf(db, 'BIOC-1', 'stu-a')).toBeUndefined();
    });

    test('prefers the row holding their PUID over an email-only row', async () => {
        const db = memoryDb({
            users: [adaAccount],
            courses: [classListCourse()],
            lms_roster_entries: [
                rosterRow({ externalUserId: '700', integrationIdKey: null }),
                rosterRow({ externalUserId: '701', email: 'ada.alt@example.com', emailKey: 'ada.alt@example.com' })
            ]
        });
        expect(await enrollStudentFromSavedRosters(db, ada, { now: NOW })).toEqual(['BIOC-1']);
        expect((await enrollmentOf(db, 'BIOC-1', 'stu-a')).externalUserId).toBe('701');
    });

    test('leaves an email two BiocBot accounts share unresolved', async () => {
        const noPuid = { userId: 'stu-a', role: 'student', email: 'shared@example.com' };
        const db = memoryDb({
            users: [noPuid, { userId: 'stu-twin', role: 'student', email: 'shared@example.com' }],
            courses: [classListCourse()],
            lms_roster_entries: [rosterRow({ integrationIdKey: null, email: 'shared@example.com', emailKey: 'shared@example.com' })]
        });
        expect(await enrollStudentFromSavedRosters(db, noPuid, { now: NOW })).toEqual([]);
    });

    test('never changes an enrollment the course already has for the student', async () => {
        const blocked = { enrolled: false, updatedAt: new Date('2026-09-02') };
        const joined = { enrolled: true, joinedAt: new Date('2026-09-03') };
        const db = memoryDb({
            users: [adaAccount],
            courses: [
                classListCourse({ studentEnrollment: { 'stu-a': blocked } }),
                classListCourse({ courseId: 'BIOC-2', studentEnrollment: { 'stu-a': joined } })
            ],
            lms_roster_entries: [rosterRow(), rosterRow({ courseId: 'BIOC-2' })]
        });

        expect(await enrollStudentFromSavedRosters(db, ada, { now: NOW })).toEqual([]);
        expect(await enrollmentOf(db, 'BIOC-1', 'stu-a')).toEqual(blocked);
        expect(await enrollmentOf(db, 'BIOC-2', 'stu-a')).toEqual(joined);
    });

    test('ignores courses whose class list is off, inactive, deleted, or no longer Canvas-owned', async () => {
        const db = memoryDb({
            users: [adaAccount],
            courses: [
                classListCourse({ courseId: 'OFF', canvasEnrollment: { enabled: false, externalCourseId: '10' } }),
                classListCourse({ courseId: 'INACTIVE', status: 'inactive' }),
                classListCourse({ courseId: 'DELETED', status: 'deleted' }),
                classListCourse({ courseId: 'MANUAL', rosterSource: 'manual' }),
                classListCourse({ courseId: 'MOVED', canvasEnrollment: { enabled: true, externalCourseId: '99' } })
            ],
            lms_roster_entries: ['OFF', 'INACTIVE', 'DELETED', 'MANUAL', 'MOVED'].map((courseId) => rosterRow({ courseId }))
        });

        expect(await enrollStudentFromSavedRosters(db, ada, { now: NOW })).toEqual([]);
    });

    test('does nothing for non-students, deactivated accounts, or students with no PUID or email', async () => {
        const db = memoryDb({
            users: [{ ...adaAccount, isActive: false }],
            courses: [classListCourse()],
            lms_roster_entries: [rosterRow()]
        });
        expect(await enrollStudentFromSavedRosters(db, { ...ada, role: 'ta' })).toEqual([]);
        expect(await enrollStudentFromSavedRosters(db, { userId: 'stu-a', role: 'student' })).toEqual([]);
        expect(await enrollStudentFromSavedRosters(db, ada)).toEqual([]);
        expect(await enrollStudentFromSavedRosters(null, ada)).toEqual([]);
    });
});

describe('saved roster rows', () => {
    test('a sync keeps only the rows it just read, for the course it read', async () => {
        const db = memoryDb({
            lms_roster_entries: [
                rosterRow({ externalUserId: '701' }),
                rosterRow({ externalUserId: '799', name: 'Left the course' }),
                rosterRow({ externalCourseId: '20', externalUserId: '801', name: 'Old Canvas course' }),
                rosterRow({ courseId: 'OTHER', externalUserId: '901', name: 'Another BiocBot course' })
            ]
        });

        await replaceRosterEntries(db, {
            courseId: 'BIOC-1',
            externalCourseId: '10',
            entries: [
                { externalUserId: '701', name: 'Ada', email: 'Ada@Student.ubc.ca', integrationId: 'PUID-A', localUserId: 'stu-a' },
                { externalUserId: '702', name: 'Bo', email: null, integrationId: null, localUserId: null }
            ],
            syncedAt: NOW
        });

        const rows = await db.collection('lms_roster_entries').find({}).toArray();
        expect(rows.map((row) => `${row.courseId}:${row.externalUserId}`).sort())
            .toEqual(['BIOC-1:701', 'BIOC-1:702', 'OTHER:901']);
        expect(rows.find((row) => row.externalUserId === '701')).toMatchObject({
            emailKey: 'ada@student.ubc.ca',
            integrationIdKey: 'puid-a',
            localUserId: 'stu-a'
        });
        expect(rows.find((row) => row.externalUserId === '702')).toMatchObject({
            emailKey: null,
            integrationIdKey: null,
            localUserId: null
        });
        expect(await listPendingRosterEntries(db, 'BIOC-1', '10')).toEqual([{ name: 'Bo', email: null }]);
    });
});

describe('class-list settings', () => {
    test('only an enabled class list with a Canvas course counts, and the code defaults to on', () => {
        expect(canvasEnrollmentOf(null)).toBeNull();
        expect(canvasEnrollmentOf({})).toBeNull();
        expect(canvasEnrollmentOf({ canvasEnrollment: { enabled: false, externalCourseId: '10' } })).toBeNull();
        expect(canvasEnrollmentOf({ canvasEnrollment: { enabled: true } })).toBeNull();
        expect(canvasEnrollmentOf({ canvasEnrollment: { enabled: true, externalCourseId: 10 } }))
            .toMatchObject({ enabled: true, externalCourseId: '10', allowCodeJoin: true });
        expect(canvasEnrollmentOf({ canvasEnrollment: { enabled: true, externalCourseId: '10', allowCodeJoin: false } }))
            .toMatchObject({ allowCodeJoin: false });
    });

    test('a block set by hand stands; a block Canvas applied does not', () => {
        expect(isBlockedOutsideCanvas({ enrolled: false })).toBe(true);
        expect(isBlockedOutsideCanvas({ enrolled: false, source: 'manual' })).toBe(true);
        expect(isBlockedOutsideCanvas({ enrolled: false, source: 'academicSync' })).toBe(true);
        expect(isBlockedOutsideCanvas({ enrolled: false, source: 'canvas', droppedAt: NOW })).toBe(false);
        expect(isBlockedOutsideCanvas({ enrolled: true })).toBe(false);
        expect(isBlockedOutsideCanvas(undefined)).toBe(false);
    });
});
