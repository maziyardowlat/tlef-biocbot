const { memoryDb } = require('../helpers/memory-db');
const { createOrGetSAMLUser } = require('../../../src/models/User');
const {
    confirmLeftCanvasCourse,
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
        loginId: 'ada',
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
        const summary = await runMatch(db, [rosterEntry({ loginId: 'different-login' })]);

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

    test('prefers Canvas integration_id matched to PUID over every fallback', async () => {
        const db = memoryDb({
            users: [
                localUser({ userId: 'user-1', puid: 'puid-ada', email: 'stale@ubc.ca' }),
                localUser({ userId: 'user-2', username: 'grace', email: 'ada@student.ubc.ca' })
            ]
        });
        const summary = await runMatch(db, [rosterEntry({ integrationId: 'puid-ada' })]);

        expect(summary.matchedBy.integration).toBe(1);
        const [mapping] = await db.collection('lms_identity_mappings').find({}).toArray();
        expect(mapping.localUserId).toBe('user-1');
    });

    test('never compares Canvas sisId to a BiocBot PUID', async () => {
        const db = memoryDb({ users: [localUser({ puid: '12345678', academicStudentId: '' })] });
        const summary = await runMatch(db, [rosterEntry({ sisId: '12345678', email: '', loginId: '' })]);

        expect(summary.matchedCount).toBe(0);
    });

    test('falls back to email when the BiocBot account has no PUID yet', async () => {
        const db = memoryDb({ users: [localUser({ puid: '' })] });
        const summary = await runMatch(db, [rosterEntry({ integrationId: 'puid-ada' })]);

        expect(summary.matchedCount).toBe(1);
        expect(summary.matchedBy.email).toBe(1);
    });

    test('refuses an email match when the Canvas row and the account carry different PUIDs', async () => {
        const db = memoryDb({ users: [localUser({ puid: 'puid-someone-else' })] });
        const summary = await runMatch(db, [rosterEntry({ integrationId: 'puid-ada' })]);

        expect(summary.matchedCount).toBe(0);
        expect(summary.unmatchedLmsStudents).toEqual([
            expect.objectContaining({ externalUserId: '900', reason: 'no-biocbot-account' })
        ]);
        expect(await db.collection('lms_identity_mappings').find({}).toArray()).toEqual([]);
    });

    test('never matches on student number, username, or the email name before the @', async () => {
        const db = memoryDb({
            users: [
                localUser({ userId: 'user-1', academicStudentId: '12345678', email: 'one@ubc.ca', username: 'someone' }),
                localUser({ userId: 'user-2', username: 'ada', email: 'two@ubc.ca' }),
                localUser({ userId: 'user-3', username: 'lovelace', email: 'three@ubc.ca' })
            ]
        });
        const summary = await runMatch(db, [
            rosterEntry({ externalUserId: '900', sisId: '12345678', email: '', loginId: '' }),
            rosterEntry({ externalUserId: '901', email: '', loginId: 'ada' }),
            rosterEntry({ externalUserId: '902', email: 'lovelace@student.ubc.ca', loginId: '' })
        ]);

        expect(summary.matchedCount).toBe(0);
        expect(summary.matchedBy).toEqual({ integration: 0, email: 0 });
    });

    test('lets a PUID match win even when an email-only row for the same account comes first', async () => {
        const db = memoryDb({ users: [localUser({ puid: 'puid-ada' })] });
        const summary = await runMatch(db, [
            rosterEntry({ externalUserId: '901', name: 'Ada (guest account)' }),
            rosterEntry({ externalUserId: '900', integrationId: 'puid-ada' })
        ]);

        expect(summary.matchedBy).toEqual({ integration: 1, email: 0 });
        expect(summary.unmatchedLmsStudents).toEqual([
            expect.objectContaining({ externalUserId: '901', reason: 'duplicate-biocbot-account' })
        ]);
        const [mapping] = await db.collection('lms_identity_mappings').find({}).toArray();
        expect(mapping).toMatchObject({ externalUserId: '900', localUserId: 'user-1', matchedBy: 'integration' });
    });

    test('never gives an account to an email row when another roster row carries its PUID', async () => {
        // Two accounts share the PUID, so the PUID row cannot claim either one;
        // the email row still must not take the account that PUID belongs to.
        const db = memoryDb({
            users: [
                localUser({ userId: 'user-1', puid: 'puid-ada' }),
                localUser({ userId: 'user-2', puid: 'puid-ada', email: 'other@ubc.ca' })
            ]
        });
        const summary = await runMatch(db, [
            rosterEntry({ externalUserId: '901' }),
            rosterEntry({ externalUserId: '900', integrationId: 'puid-ada', email: '' })
        ]);

        expect(summary.matchedCount).toBe(0);
    });

    test('moves an account to its new LMS user id without breaking the one-row-per-account index', async () => {
        const db = memoryDb({
            users: [localUser({ puid: 'puid-ada' })],
            lms_identity_mappings: [{
                courseId: 'BIOC-1',
                provider: 'canvas',
                externalCourseId: '77',
                externalUserId: '901',
                localUserId: 'user-1',
                matchedBy: 'username'
            }]
        });
        // The real collection has a unique index on the local user; fail the
        // way Mongo would if a write ever leaves two rows for one account.
        const mappings = db.collection('lms_identity_mappings');
        const bulkWrite = mappings.bulkWrite.bind(mappings);
        mappings.bulkWrite = async (operations) => {
            const result = await bulkWrite(operations);
            const localIds = (await mappings.find({}).toArray()).map((mapping) => mapping.localUserId);
            if (new Set(localIds).size !== localIds.length) throw new Error('E11000 duplicate key error');
            return result;
        };

        await runMatch(db, [rosterEntry({ externalUserId: '900', integrationId: 'puid-ada' })]);

        const rows = await mappings.find({}).toArray();
        expect(rows).toEqual([expect.objectContaining({ externalUserId: '900', localUserId: 'user-1', matchedBy: 'integration' })]);
    });

    test('ignores an email shared by two BiocBot accounts rather than guessing', async () => {
        const db = memoryDb({
            users: [
                localUser({ userId: 'user-1', username: 'ada1' }),
                localUser({ userId: 'user-2', username: 'ada2', displayName: 'Ada Twin' })
            ]
        });
        const summary = await runMatch(db, [rosterEntry({ loginId: '' })]);

        expect(summary.matchedCount).toBe(0);
        expect(summary.unmatchedLmsStudents).toEqual([
            expect.objectContaining({ externalUserId: '900', reason: 'no-biocbot-account' })
        ]);
        expect(summary.unmatchedBiocBotStudents).toHaveLength(2);
    });

    test('never matches on display name alone', async () => {
        const db = memoryDb({ users: [localUser({ username: 'zzz', email: 'zzz@ubc.ca' })] });
        const summary = await runMatch(db, [rosterEntry({ email: '', loginId: '' })]);

        expect(summary.matchedCount).toBe(0);
        expect(summary.unmatchedLmsStudents[0]).toMatchObject({ name: 'Ada Lovelace', reason: 'no-biocbot-account' });
    });

    test('reports a second LMS row claiming an already-matched account', async () => {
        const db = memoryDb({ users: [localUser()] });
        const summary = await runMatch(db, [
            rosterEntry({ externalUserId: '900' }),
            rosterEntry({ externalUserId: '901', loginId: '' })
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

describe('Canvas roster sync enrollment (provisionAccounts)', () => {
    async function runSync(db, entries) {
        return matchCourseRoster({
            db,
            course,
            provider: 'canvas',
            roster: { externalCourseId: '77', entries },
            matchedBy: 'inst-1',
            provisionAccounts: true
        });
    }

    const users = (db) => db.collection('users').find({}).toArray();

    test('finds a student who signed in for another course by PUID, whatever its casing', async () => {
        const db = memoryDb({
            users: [localUser({ userId: 'user-9', puid: 'PUID-ADA', preferences: { courseId: 'OTHER-1' } })]
        });

        // A grade-only match still sees only this course's students.
        expect((await runMatch(db, [rosterEntry({ integrationId: 'puid-ada' })])).matchedCount).toBe(0);

        const summary = await runSync(db, [rosterEntry({ integrationId: 'puid-ada' })]);

        expect(summary.matchedCount).toBe(1);
        expect(summary.matchedBy.integration).toBe(1);
        expect(summary.createdAccounts).toEqual([]);
        const [mapping] = await db.collection('lms_identity_mappings').find({}).toArray();
        expect(mapping.localUserId).toBe('user-9');
        // Their own course choice is theirs; enrollment is the sync's job.
        expect((await users(db))[0].preferences.courseId).toBe('OTHER-1');
    });

    test('creates a placeholder for a student who never signed in, and CWL login lands on it', async () => {
        const db = memoryDb({ users: [] });

        const graded = await runMatch(db, [rosterEntry({ integrationId: 'PUID-NEW' })]);
        expect(graded.unmatchedLmsStudents[0].reason).toBe('no-biocbot-account');
        expect(await users(db)).toEqual([]);

        const summary = await runSync(db, [rosterEntry({ integrationId: 'PUID-NEW', email: 'New@Student.UBC.ca', name: 'New Student' })]);

        expect(summary.matchedCount).toBe(1);
        expect(summary.unmatchedLmsStudents).toEqual([]);
        const [placeholder] = await users(db);
        expect(placeholder).toMatchObject({
            username: 'PUID-NEW',
            puid: 'PUID-NEW',
            email: 'new@student.ubc.ca',
            displayName: 'New Student',
            role: 'student',
            authProvider: 'saml',
            isActive: true,
            lastLogin: null,
            studentOnboardingComplete: false,
            preferences: expect.objectContaining({ courseId: 'BIOC-1' })
        });
        expect(summary.createdAccounts).toEqual([{ localUserId: placeholder.userId, name: 'New Student' }]);
        const [mapping] = await db.collection('lms_identity_mappings').find({}).toArray();
        expect(mapping).toMatchObject({ localUserId: placeholder.userId, matchedBy: 'integration' });

        const login = await createOrGetSAMLUser(db, {
            samlId: 'PUID-NEW',
            puid: 'PUID-NEW',
            email: 'new@student.ubc.ca',
            username: 'PUID-NEW',
            displayName: 'New Student',
            role: 'student'
        });
        expect(login.user.userId).toBe(placeholder.userId);
        expect(await users(db)).toHaveLength(1);
    });

    test('a second sync reuses the placeholder instead of making another', async () => {
        const db = memoryDb({ users: [] });
        await runSync(db, [rosterEntry({ integrationId: 'PUID-NEW' })]);
        const again = await runSync(db, [rosterEntry({ integrationId: 'PUID-NEW' })]);

        expect(again.createdAccounts).toEqual([]);
        expect(again.matchedCount).toBe(1);
        expect(await users(db)).toHaveLength(1);
    });

    test('never creates an account for a row without a PUID', async () => {
        const db = memoryDb({ users: [] });
        const summary = await runSync(db, [rosterEntry({ integrationId: '', email: 'nopuid@student.ubc.ca' })]);

        expect(summary.matchedCount).toBe(0);
        expect(summary.unmatchedLmsStudents).toEqual([expect.objectContaining({ externalUserId: '900', reason: 'missing-puid' })]);
        expect(await users(db)).toEqual([]);
    });

    test('leaves instructor, TA, and deactivated accounts holding the PUID alone', async () => {
        const db = memoryDb({
            users: [
                localUser({ userId: 'inst-9', role: 'instructor', puid: 'PUID-A', email: 'a@ubc.ca', preferences: {} }),
                localUser({ userId: 'ta-9', role: 'ta', puid: 'PUID-B', email: 'b@ubc.ca', preferences: {} }),
                localUser({ userId: 'gone-9', puid: 'PUID-C', email: 'c@ubc.ca', isActive: false, preferences: {} })
            ]
        });
        const summary = await runSync(db, [
            rosterEntry({ externalUserId: '901', integrationId: 'PUID-A', email: '' }),
            rosterEntry({ externalUserId: '902', integrationId: 'puid-b', email: '' }),
            rosterEntry({ externalUserId: '903', integrationId: 'PUID-C', email: '' })
        ]);

        expect(summary.matchedCount).toBe(0);
        expect(summary.unmatchedLmsStudents.map((row) => row.reason)).toEqual([
            'puid-on-other-account',
            'puid-on-other-account',
            'puid-on-other-account'
        ]);
        expect(await users(db)).toHaveLength(3);
    });

    test('will not create a second account for an email another account already uses', async () => {
        const db = memoryDb({
            users: [localUser({ userId: 'legacy-1', puid: '', email: 'ada@student.ubc.ca', preferences: { courseId: 'OTHER-1' } })]
        });
        const summary = await runSync(db, [rosterEntry({ integrationId: 'PUID-ADA' })]);

        expect(summary.matchedCount).toBe(0);
        expect(summary.unmatchedLmsStudents).toEqual([expect.objectContaining({ reason: 'email-on-other-account' })]);
        expect(await users(db)).toHaveLength(1);
    });

    test('an account from outside the course never costs a course student their email match', async () => {
        const db = memoryDb({
            users: [
                localUser({ userId: 'user-1', puid: '' }),
                // Same email, pulled in only because their PUID is on the roster.
                localUser({ userId: 'user-9', puid: 'PUID-GRACE', preferences: { courseId: 'OTHER-1' } })
            ]
        });
        const summary = await runSync(db, [
            rosterEntry({ externalUserId: '900', integrationId: 'PUID-ADA' }),
            rosterEntry({ externalUserId: '901', integrationId: 'PUID-GRACE', email: 'grace@student.ubc.ca' })
        ]);

        const mappings = await db.collection('lms_identity_mappings').find({}).toArray();
        expect(Object.fromEntries(mappings.map((m) => [m.externalUserId, [m.localUserId, m.matchedBy]]))).toEqual({
            900: ['user-1', 'email'],
            901: ['user-9', 'integration']
        });
        expect(summary.createdAccounts).toEqual([]);
    });

    test('two roster rows with one PUID make one account, and the second is reported', async () => {
        const db = memoryDb({ users: [] });
        const summary = await runSync(db, [
            rosterEntry({ externalUserId: '900', integrationId: 'PUID-TWIN', email: '' }),
            rosterEntry({ externalUserId: '901', integrationId: 'puid-twin', email: '' })
        ]);

        expect(summary.matchedCount).toBe(1);
        expect(summary.unmatchedLmsStudents).toEqual([
            expect.objectContaining({ externalUserId: '901', reason: 'duplicate-biocbot-account' })
        ]);
        expect(await users(db)).toHaveLength(1);
    });
});

describe('LMS roster readers', () => {
    test('asks Canvas per student whether any student enrollment in the course remains', async () => {
        const client = {
            getAll: jest.fn(async (path, query) => {
                if (query.user_id === '902') throw new Error('Canvas API request returned 403');
                // 901 moved to a section the syncing teacher cannot see.
                return query.user_id === '901' ? [{ user_id: 901, course_section_id: 12 }] : [];
            })
        };
        const warn = jest.spyOn(console, 'warn').mockImplementation(() => {});

        const left = await confirmLeftCanvasCourse(client, '77', ['900', '901', '902', '900']);

        expect([...left]).toEqual(['900']);
        expect(client.getAll).toHaveBeenCalledTimes(3);
        expect(client.getAll).toHaveBeenCalledWith('/courses/77/enrollments', {
            user_id: '900',
            type: ['StudentEnrollment'],
            state: ['active', 'invited']
        });
        expect(warn).toHaveBeenCalledWith(expect.stringContaining('user 902'));
        warn.mockRestore();
    });

    test('reads the Canvas roster as active student enrollments', async () => {
        const client = {
            getAll: jest.fn(async () => [
                { id: 900, name: 'Ada Lovelace', email: 'ada@student.ubc.ca', integration_id: 'puid-ada', login_id: 'ada', sis_user_id: '12345678' }
            ])
        };
        const toolkit = {
            canvas: {
                getCourseUsers: jest.fn(async (apiClient, courseId) => {
                    const users = await apiClient.getAll(`/courses/${courseId}/users`, {
                        enrollment_type: ['student'],
                        enrollment_state: ['active', 'invited'],
                        include: ['email']
                    });
                    return users.map((user) => ({
                        id: String(user.id),
                        name: user.name,
                        email: user.email,
                        integrationId: user.integration_id,
                        sisId: user.sis_user_id,
                        loginId: user.login_id,
                        raw: user
                    }));
                })
            },
            rosterFieldCoverage: jest.fn((users) => ({
                total: users.length,
                integrationId: users.filter((user) => user.integrationId).length,
                sisId: users.filter((user) => user.sisId).length,
                email: users.filter((user) => user.email).length,
                loginId: users.filter((user) => user.loginId).length
            }))
        };
        const db = memoryDb({ users: [localUser()] });
        const summary = await syncCourseRoster({
            db,
            course,
            provider: 'canvas',
            client,
            externalCourseId: '77',
            matchedBy: 'inst-1',
            toolkit
        });

        expect(summary.matchedCount).toBe(1);
        expect(summary.rosterSize).toBe(1);
        expect(summary.coverage).toEqual({ total: 1, integrationId: 1, sisId: 1, email: 1, loginId: 1 });
        expect(client.getAll).toHaveBeenCalledWith('/courses/77/users', expect.objectContaining({
            enrollment_type: ['student']
        }));
        expect(toolkit.canvas.getCourseUsers).toHaveBeenCalledWith(client, '77');
        expect(toolkit.rosterFieldCoverage).toHaveBeenCalled();
    });
});
