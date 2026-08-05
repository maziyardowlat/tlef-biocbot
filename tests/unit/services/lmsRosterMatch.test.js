const { memoryDb } = require('../helpers/memory-db');
const {
    fetchCanvasRoster,
    fetchMoodleRoster,
    matchCourseRoster,
    syncCourseRoster
} = require('../../../src/services/lmsRosterMatch');

const course = {
    courseId: 'BIOC-1',
    studentEnrollment: {}
};

function localUser(overrides = {}) {
    return {
        userId: 'user-1',
        role: 'student',
        isActive: true,
        preferences: { courseId: 'BIOC-1' },
        username: 'ada',
        email: 'ada@student.ubc.ca',
        displayName: 'Ada Lovelace',
        ...overrides
    };
}

function rosterEntry(overrides = {}) {
    return {
        externalUserId: '900',
        name: 'Ada Lovelace',
        email: 'ada@student.ubc.ca',
        username: 'ada',
        sisId: '',
        ...overrides
    };
}

async function runMatch(db, entries, provider = 'canvas') {
    return matchCourseRoster({
        db,
        course,
        provider,
        roster: { externalCourseId: '77', entries },
        matchedBy: 'inst-1'
    });
}

describe('LMS roster matching', () => {
    test('matches on email and records how the match was made', async () => {
        const db = memoryDb({ users: [localUser()] });
        const summary = await runMatch(db, [rosterEntry({ username: 'different-login' })]);

        expect(summary.matchedCount).toBe(1);
        expect(summary.matchedBy.email).toBe(1);
        expect(summary.unmatchedLmsStudents).toEqual([]);
        expect(summary.unmatchedBiocBotStudents).toEqual([]);

        const [mapping] = await db.collection('lms_identity_mappings').find({}).toArray();
        expect(mapping).toMatchObject({
            courseId: 'BIOC-1',
            provider: 'canvas',
            externalCourseId: '77',
            externalUserId: '900',
            localUserId: 'user-1',
            matchedBy: 'email',
            externalEmail: 'ada@student.ubc.ca'
        });
    });

    test('prefers the student number over the email when both are present', async () => {
        const db = memoryDb({
            users: [
                localUser({ userId: 'user-1', academicStudentId: '12345678', email: 'stale@ubc.ca' }),
                localUser({ userId: 'user-2', username: 'grace', email: 'ada@student.ubc.ca', displayName: 'Grace Hopper' })
            ]
        });
        const summary = await runMatch(db, [rosterEntry({ sisId: '12345678', username: '' })]);

        expect(summary.matchedBy.sis).toBe(1);
        const [mapping] = await db.collection('lms_identity_mappings').find({}).toArray();
        expect(mapping.localUserId).toBe('user-1');
    });

    test('ignores an email shared by two BiocBot accounts rather than guessing', async () => {
        const db = memoryDb({
            users: [
                localUser({ userId: 'user-1', username: 'ada1' }),
                localUser({ userId: 'user-2', username: 'ada2', displayName: 'Ada Twin' })
            ]
        });
        const summary = await runMatch(db, [rosterEntry({ username: '' })]);

        expect(summary.matchedCount).toBe(0);
        expect(summary.unmatchedLmsStudents).toEqual([
            expect.objectContaining({ externalUserId: '900', reason: 'no-biocbot-account' })
        ]);
        expect(summary.unmatchedBiocBotStudents).toHaveLength(2);
    });

    test('never matches on display name alone', async () => {
        const db = memoryDb({ users: [localUser({ username: 'zzz', email: 'zzz@ubc.ca' })] });
        const summary = await runMatch(db, [rosterEntry({ email: '', username: '' })]);

        expect(summary.matchedCount).toBe(0);
        expect(summary.unmatchedLmsStudents[0]).toMatchObject({ name: 'Ada Lovelace', reason: 'no-biocbot-account' });
    });

    test('reports a second LMS row claiming an already-matched account', async () => {
        const db = memoryDb({ users: [localUser()] });
        const summary = await runMatch(db, [
            rosterEntry({ externalUserId: '900' }),
            rosterEntry({ externalUserId: '901', username: '' })
        ]);

        expect(summary.matchedCount).toBe(1);
        expect(summary.unmatchedLmsStudents).toEqual([
            expect.objectContaining({ externalUserId: '901', reason: 'duplicate-biocbot-account' })
        ]);
    });

    test('drops mappings for students who left the LMS course', async () => {
        const db = memoryDb({
            users: [localUser()],
            lms_identity_mappings: [{
                courseId: 'BIOC-1',
                provider: 'canvas',
                externalCourseId: '77',
                externalUserId: '404',
                localUserId: 'user-gone'
            }]
        });
        await runMatch(db, [rosterEntry()]);

        const mappings = await db.collection('lms_identity_mappings').find({}).toArray();
        expect(mappings).toHaveLength(1);
        expect(mappings[0].externalUserId).toBe('900');
    });

    test('leaves preview sandboxes and inactive accounts out of matching', async () => {
        const db = memoryDb({
            users: [
                localUser({ userId: 'preview-1', isPreview: true }),
                localUser({ userId: 'gone-1', isActive: false })
            ]
        });
        const summary = await runMatch(db, [rosterEntry()]);

        expect(summary.matchedCount).toBe(0);
        expect(summary.unmatchedBiocBotStudents).toEqual([]);
    });
});

describe('LMS roster readers', () => {
    test('reads the Canvas roster as active student enrollments', async () => {
        const client = {
            get: jest.fn(async () => [
                { id: 900, name: 'Ada Lovelace', email: 'ada@student.ubc.ca', login_id: 'ada', sis_user_id: '12345678' }
            ])
        };
        const roster = await fetchCanvasRoster(client, '77');

        expect(client.get).toHaveBeenCalledWith('/courses/77/users', expect.objectContaining({
            enrollment_type: ['student']
        }));
        expect(roster).toEqual([{
            externalUserId: '900',
            name: 'Ada Lovelace',
            email: 'ada@student.ubc.ca',
            username: 'ada',
            sisId: '12345678'
        }]);
    });

    test('keeps only students from the Moodle enrolment list', async () => {
        const client = {
            call: jest.fn(async () => [
                { id: 5, fullname: 'Ada Lovelace', email: 'ada@student.ubc.ca', username: 'ada', roles: [{ shortname: 'student' }] },
                { id: 6, fullname: 'Prof Babbage', email: 'cb@ubc.ca', username: 'cb', roles: [{ shortname: 'editingteacher' }] }
            ])
        };
        const roster = await fetchMoodleRoster(client, '20');

        expect(client.call).toHaveBeenCalledWith('core_enrol_get_enrolled_users', { courseid: 20 });
        expect(roster.map((entry) => entry.name)).toEqual(['Ada Lovelace']);
    });

    test('syncCourseRoster fetches then reconciles in one call', async () => {
        const db = memoryDb({ users: [localUser()] });
        const client = {
            get: jest.fn(async () => [
                { id: 900, name: 'Ada Lovelace', email: 'ada@student.ubc.ca', login_id: 'ada' }
            ])
        };
        const summary = await syncCourseRoster({
            db,
            course,
            provider: 'canvas',
            client,
            externalCourseId: '77',
            matchedBy: 'inst-1'
        });

        expect(summary.matchedCount).toBe(1);
        expect(summary.rosterSize).toBe(1);
    });
});
