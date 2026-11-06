/// <reference types="node" />
/// <reference types="jest" />

'use strict';

/**
 * Runs the code that reads and writes user data through the real encryption
 * toolkit, in both rollout modes: `mixed` while a deployment is migrating, and
 * `strict` once it has finished. The toolkit rejects a query it cannot run on
 * an encrypted field before it reaches the database, so these cases also prove
 * each query is one the wrapper accepts.
 */

const fs = require('node:fs');
const path = require('node:path');

const { initializeChatEncryption } = require('../../../src/services/chatEncryption');
const {
    BLIND_INDEXED_FIELDS,
    ENCRYPTED_FIELDS,
    loadEncryptionToolkit
} = require('../../../src/config/chatEncryption');
const { encryptedMemoryDb } = require('../helpers/encrypted-memory-db');
const User = require('../../../src/models/User');
const StruggleActivity = require('../../../src/models/StruggleActivity');
const FlaggedQuestion = require('../../../src/models/FlaggedQuestion');
const QuizAttempt = require('../../../src/models/QuizAttempt');
const UserAgreement = require('../../../src/models/UserAgreement');
const systemAdmin = require('../../../src/services/systemAdmin');
const academicRosterSync = require('../../../src/services/academicRosterSync');
const lmsRosterMatch = require('../../../src/services/lmsRosterMatch');
const lmsGradeImport = require('../../../src/services/lmsGradeImport');

const describeWithToolkit = loadEncryptionToolkit() ? describe : describe.skip;

const SYNTHETIC_KEY = Buffer.alloc(32, 7).toString('base64');
const SYNTHETIC_BLIND_INDEX_KEY = Buffer.alloc(32, 9).toString('base64');

const isEnvelope = (value) => value?.__ubc_enc === 1;

async function wrap(readPolicy, queryPolicy, seed = {}) {
    const rawDb = encryptedMemoryDb(seed);
    const db = /** @type {any} */ (await initializeChatEncryption(rawDb, {
        BIOCBOT_CHAT_ENCRYPTION_ENABLED: 'true',
        BIOCBOT_CHAT_ENCRYPTION_KEY: SYNTHETIC_KEY,
        BIOCBOT_BLIND_INDEX_KEY: SYNTHETIC_BLIND_INDEX_KEY,
        BIOCBOT_CHAT_ENCRYPTION_READ_POLICY: readPolicy,
        BIOCBOT_CHAT_ENCRYPTION_QUERY_POLICY: queryPolicy
    }));
    return { rawDb, db };
}

describe('server startup', () => {
    // Login writing around the wrapper does not fail: it stores plaintext, and
    // its lookups miss encrypted rows, so every returning student would get a
    // second account. This has no other symptom, so the order is pinned here.
    test('builds the encrypted database before anything that reads users', () => {
        const source = fs.readFileSync(path.join(__dirname, '../../../src/server.js'), 'utf8');
        const wrapper = source.indexOf('const runtimeDb = await initializeChatEncryption(db);');

        expect(wrapper).toBeGreaterThan(-1);
        for (const call of [
            'await initializePassportAuth(runtimeDb);',
            'await initializeAuth(runtimeDb);',
            'await initializeLms(runtimeDb);'
        ]) {
            expect(source.indexOf(call)).toBeGreaterThan(wrapper);
        }
        expect(source).toContain('initializePassport(runtimeDb)');
        expect(source).toContain('new AuthService(runtimeDb)');
        expect(source).toContain('createAuthMiddleware(runtimeDb)');
    });
});

describeWithToolkit('user data policy', () => {
    test('every blind-indexed field is also an encrypted field', () => {
        for (const [collection, fields] of Object.entries(BLIND_INDEXED_FIELDS)) {
            for (const field of Object.keys(fields)) {
                expect(ENCRYPTED_FIELDS[collection]).toContain(field);
            }
        }
    });

    test('refuses to start without the blind-index key, and names it', async () => {
        await expect(initializeChatEncryption(encryptedMemoryDb(), {
            BIOCBOT_CHAT_ENCRYPTION_ENABLED: 'true',
            BIOCBOT_CHAT_ENCRYPTION_KEY: SYNTHETIC_KEY
        })).rejects.toThrow('BIOCBOT_BLIND_INDEX_KEY');
    });
});

describeWithToolkit.each([
    ['mixed', 'mixed'],
    ['strict', 'encrypted']
])('user data under %s reads', (readPolicy, queryPolicy) => {
    const samlProfile = {
        samlId: 'nameid-confidential',
        puid: 'PUID-CONFIDENTIAL',
        email: 'Secret.Student@ubc.ca',
        username: 'secret-username',
        displayName: 'Secret Student',
        role: 'student'
    };

    function expectNoIdentityAtRest(rawDb, collection) {
        const stored = JSON.stringify(rawDb.stored(collection)).toLowerCase();
        for (const value of ['nameid-confidential', 'puid-confidential', 'secret.student@ubc.ca', 'secret-username', 'secret student']) {
            expect(stored).not.toContain(value);
        }
    }

    test('CWL login stores identity encrypted and finds the same account next time', async () => {
        const { rawDb, db } = await wrap(readPolicy, queryPolicy);

        const first = await User.createOrGetSAMLUser(db, samlProfile);
        expect(first.success).toBe(true);
        expect(first.user).toMatchObject({ puid: 'PUID-CONFIDENTIAL', displayName: 'Secret Student' });

        const [stored] = rawDb.stored('users');
        expectNoIdentityAtRest(rawDb, 'users');
        for (const field of ['username', 'email', 'displayName', 'puid', 'samlId']) {
            expect(isEnvelope(stored[field])).toBe(true);
        }
        for (const field of ['username', 'email', 'puid', 'samlId']) {
            expect(typeof stored[`${field}__bidx`]).toBe('string');
        }
        expect(stored).not.toHaveProperty('displayName__bidx');
        expect(stored).toMatchObject({ role: 'student', authProvider: 'saml', isActive: true });

        const again = await User.createOrGetSAMLUser(db, samlProfile);
        expect(again.user.userId).toBe(first.user.userId);

        // The email alone finds it too, whatever its case.
        const byEmail = await User.createOrGetSAMLUser(db, {
            samlId: 'another-nameid',
            email: 'secret.student@UBC.ca',
            role: 'student'
        });
        expect(byEmail.user.userId).toBe(first.user.userId);

        expect(rawDb.stored('users')).toHaveLength(1);
        expect(await User.getUserByPuid(db, 'PUID-CONFIDENTIAL')).toMatchObject({ userId: first.user.userId });
    });

    test('a SAML profile with no display name or username still creates an account', async () => {
        const { rawDb, db } = await wrap(readPolicy, queryPolicy);

        const result = await User.createOrGetSAMLUser(db, { samlId: 'n1', email: 'only@ubc.ca' });

        expect(result.success).toBe(true);
        expect(result.user.displayName).toBe('only@ubc.ca');
        expect(rawDb.stored('users')).toHaveLength(1);
    });

    test('local login finds accounts by username or email', async () => {
        const { rawDb, db } = await wrap(readPolicy, queryPolicy);
        const created = await User.createUser(db, {
            username: 'secret-username',
            email: 'Secret.Student@ubc.ca',
            password: 'correct-password',
            role: 'student',
            displayName: 'Secret Student'
        });
        expect(created.success).toBe(true);
        expectNoIdentityAtRest(rawDb, 'users');

        for (const login of ['secret-username', 'SECRET.STUDENT@ubc.ca']) {
            const result = await User.authenticateUser(db, login, 'correct-password');
            expect(result).toMatchObject({ success: true, user: { userId: created.userId } });
        }
        expect(await User.authenticateUser(db, 'secret-username', 'wrong-password')).toMatchObject({ success: false });
        expect(await User.createUser(db, { username: 'secret-username', password: 'x', role: 'student' }))
            .toMatchObject({ success: false, error: 'User already exists with this username' });
        expect(await User.createUser(db, { username: 'other', email: 'secret.student@ubc.ca', password: 'x', role: 'student' }))
            .toMatchObject({ success: false, error: 'User already exists with this email address' });
    }, 30000); // Each password hash is deliberately slow.

    test('system admins are granted and revoked by email, and listed in email order', async () => {
        const { db } = await wrap(readPolicy, queryPolicy);
        for (const [username, email] of [['b', 'b@ubc.ca'], ['a', 'a@ubc.ca'], ['c', 'c@ubc.ca']]) {
            await db.collection('users').insertOne({
                _id: `id-${username}`,
                userId: `user-${username}`,
                username,
                email,
                displayName: username,
                role: 'instructor',
                isActive: true
            });
        }

        await systemAdmin.grantSystemAdminByEmail(db, 'B@ubc.ca', { grantedBy: 'granting-user' });
        await systemAdmin.grantSystemAdminByEmail(db, 'a@ubc.ca', { grantedBy: 'granting-user' });

        expect((await systemAdmin.listSystemAdmins(db)).map((admin) => admin.email)).toEqual(['a@ubc.ca', 'b@ubc.ca']);

        await systemAdmin.revokeSystemAdminByEmail(db, 'b@ubc.ca');
        expect((await systemAdmin.listSystemAdmins(db)).map((admin) => admin.email)).toEqual(['a@ubc.ca']);
    });

    test('struggle state and history are encrypted, and the weekly chart still counts them', async () => {
        const now = new Date();
        const { rawDb, db } = await wrap(readPolicy, queryPolicy);
        const { userId } = await User.createUser(db, {
            username: 'secret-username',
            email: 'secret.student@ubc.ca',
                        role: 'student',
            displayName: 'Secret Student',
            courseId: 'BIOC-1'
        });

        for (let attempt = 0; attempt < 3; attempt += 1) {
            await User.updateUserStruggleState(db, userId, { topic: 'Confidential Topic', isStruggling: true }, 'BIOC-1');
        }
        await User.updateUserStruggleState(db, userId, { topic: 'Other Topic', isStruggling: true }, 'BIOC-1');

        const [storedUser] = rawDb.stored('users');
        expect(isEnvelope(storedUser.struggleState)).toBe(true);
        const [storedActivity] = rawDb.stored('struggleActivity');
        expect(isEnvelope(storedActivity.studentName)).toBe(true);
        expect(isEnvelope(storedActivity.topic)).toBe(true);
        expect(storedActivity).toMatchObject({ userId, courseId: 'BIOC-1', state: 'Active' });
        expect(JSON.stringify(rawDb.stored('struggleActivity')).toLowerCase()).not.toMatch(/confidential topic|secret student/);

        const user = await User.getUserById(db, userId);
        expect(user.struggleState.topics.map((topic) => topic.topic)).toEqual(['confidential topic', 'other topic']);

        expect(await StruggleActivity.getWeeklyActiveTopics(db, 'BIOC-1', { weeks: 1 })).toEqual([{
            weekStart: expect.any(Date),
            topics: [{ topic: 'confidential topic', studentCount: 1 }],
            totalCount: 1
        }]);
        const [{ weekStart }] = await StruggleActivity.getWeeklyActiveTopics(db, 'BIOC-1', { weeks: 1 });
        expect(weekStart.getUTCDay()).toBe(1);
        expect(weekStart.getTime()).toBeLessThanOrEqual(now.getTime());

        await User.resetUserStruggleState(db, userId, 'Confidential Topic', 'BIOC-1');
        expect((await User.getUserById(db, userId)).struggleState.topics.map((topic) => topic.topic)).toEqual(['other topic']);

        await User.resetUserStruggleState(db, userId, 'ALL', 'BIOC-1');
        expect((await User.getUserById(db, userId)).struggleState.topics).toEqual([]);
    });

    test('quiz results are encrypted, and a wrong answer still counts as wrong', async () => {
        const { rawDb, db } = await wrap(readPolicy, queryPolicy);
        const attempt = { studentId: 'stu-1', courseId: 'BIOC-1', questionId: 'q1', lectureName: 'Unit 1', questionType: 'mcq', studentAnswer: 'B' };

        await QuizAttempt.saveAttempt(db, { ...attempt, correct: true });
        await QuizAttempt.saveAttempt(db, { ...attempt, correct: false });

        for (const stored of rawDb.stored('quizAttempts')) {
            expect(isEnvelope(stored.correct)).toBe(true);
        }
        expect(await QuizAttempt.getAttemptStats(db, 'stu-1', 'BIOC-1')).toMatchObject({
            totalAttempts: 2,
            correctCount: 1,
            accuracy: 50,
            unitBreakdown: { 'Unit 1': { total: 2, correct: 1 } }
        });
    });

    test('the IP address and browser on an agreement are encrypted, and the stats still count', async () => {
        const { rawDb, db } = await wrap(readPolicy, queryPolicy);
        const details = { hasAgreed: true, agreementVersion: '1.0', ipAddress: '203.0.113.7', userAgent: 'Secret Browser' };

        await UserAgreement.createOrUpdateUserAgreement(db, 'stu-1', 'student', details);
        await UserAgreement.createOrUpdateUserAgreement(db, 'stu-2', 'student', { ...details, hasAgreed: false });
        await UserAgreement.createOrUpdateUserAgreement(db, 'inst-1', 'instructor', details);

        const [stored] = rawDb.stored('userAgreements');
        expect(isEnvelope(stored.ipAddress)).toBe(true);
        expect(isEnvelope(stored.userAgent)).toBe(true);
        expect(JSON.stringify(rawDb.stored('userAgreements'))).not.toMatch(/203\.0\.113\.7|Secret Browser/);

        expect(await UserAgreement.getUserAgreement(db, 'stu-1', 'student')).toMatchObject({ hasAgreed: true });
        expect(await UserAgreement.getAgreementStats(db, 'student')).toEqual({
            totalUsers: 2,
            agreedUsers: 1,
            pendingUsers: 1,
            agreementRate: 50
        });
    });

    test('a flag saved without question content or a description still works', async () => {
        const { rawDb, db } = await wrap(readPolicy, queryPolicy);

        const created = await FlaggedQuestion.createFlaggedQuestion(db, {
            questionId: 'q1',
            courseId: 'BIOC-1',
            studentId: 'stu-1',
            studentName: 'Secret Student',
            reporterId: 'stu-1',
            reporterName: 'Secret Student',
            flagReason: 'unclear'
        });

        expect(created.success).toBe(true);
        const [stored] = rawDb.stored('flaggedQuestions');
        expect(stored).toMatchObject({ questionContent: null, flagDescription: null });
        expect(isEnvelope(stored.studentName)).toBe(true);
        expect(isEnvelope(stored.reporterName)).toBe(true);
    });

    test('an academic roster sync matches returning students and keeps courses free of identity', async () => {
        const { rawDb, db } = await wrap(readPolicy, queryPolicy, {
            courses: [{
                courseId: 'BIOC-1',
                academicSync: { academicPeriod: 'AP-1', sectionIds: ['SEC-1'] },
                studentEnrollment: {}
            }]
        });
        const roster = [{
            puid: 'PUID-CONFIDENTIAL',
            ID: 'STUDENT-NUMBER-1',
            email: 'secret.student@ubc.ca',
            preferredName: 'Secret Student'
        }];
        const academicApi = { getStudentsFromSections: jest.fn(async () => roster) };

        expect(await academicRosterSync.syncCourseRoster(db, 'BIOC-1', { academicApi })).toMatchObject({ added: 1, updated: 0 });
        expect(await academicRosterSync.syncCourseRoster(db, 'BIOC-1', { academicApi })).toMatchObject({ added: 0, updated: 1 });

        expect(rawDb.stored('users')).toHaveLength(1);
        const atRest = JSON.stringify([rawDb.stored('users'), rawDb.stored('courses')]);
        expect(atRest).not.toMatch(/PUID-CONFIDENTIAL|STUDENT-NUMBER-1|secret\.student|Secret Student/);

        const stillMatches = await User.getUserByPuid(db, 'PUID-CONFIDENTIAL');
        expect(stillMatches).toMatchObject({ academicStudentId: 'STUDENT-NUMBER-1' });
    });

    test('an LMS roster sync finds accounts by PUID and encrypts the LMS name and email', async () => {
        const { rawDb, db } = await wrap(readPolicy, queryPolicy);
        await User.createOrGetSAMLUser(db, samlProfile);
        const toolkit = {
            canvas: {
                getCourseUsers: jest.fn(async () => [
                    { id: '501', name: 'Secret Student', email: 'secret.student@ubc.ca', integrationId: 'PUID-CONFIDENTIAL' },
                    // A first-time student with no email released by the LMS.
                    { id: '502', name: 'New Student', integrationId: 'PUID-NEW' }
                ])
            },
            rosterFieldCoverage: () => ({})
        };

        const report = await lmsRosterMatch.syncCourseRoster({
            db,
            course: { courseId: 'BIOC-1', studentEnrollment: {} },
            provider: 'canvas',
            client: {},
            externalCourseId: '77',
            matchedBy: 'instructor-1',
            provisionAccounts: true,
            toolkit
        });

        expect(report.matchedCount).toBe(2);
        // The account from the login above is matched rather than duplicated.
        expect(rawDb.stored('users')).toHaveLength(2);

        const mappings = rawDb.stored('lms_identity_mappings');
        expect(mappings).toHaveLength(2);
        const withEmail = mappings.find((mapping) => mapping.externalUserId === '501');
        expect(isEnvelope(withEmail.externalLabel)).toBe(true);
        expect(isEnvelope(withEmail.externalEmail)).toBe(true);
        expect(mappings.find((mapping) => mapping.externalUserId === '502').externalEmail).toBeNull();
        expect(JSON.stringify([rawDb.stored('users'), mappings])).not.toMatch(/PUID-CONFIDENTIAL|PUID-NEW|Secret Student|New Student/);

        const stored = await db.collection('lms_identity_mappings').findOne({ externalUserId: '501' });
        expect(stored).toMatchObject({ externalLabel: 'Secret Student', externalEmail: 'secret.student@ubc.ca' });
    });

    test('imported LMS grades are encrypted and the gradebook still reads them', async () => {
        const course = {
            courseId: 'BIOC-1',
            lmsGradeSources: { moodle: { courseId: '77', name: 'Biochem' } }
        };
        const { rawDb, db } = await wrap(readPolicy, queryPolicy, {
            courses: [course],
            lms_identity_mappings: []
        });
        const { userId } = await User.createUser(db, {
            username: 'secret-username',
            email: 'secret.student@ubc.ca',
                        role: 'student',
            displayName: 'Secret Student'
        });
        await db.collection('lms_identity_mappings').insertOne({
            courseId: 'BIOC-1',
            provider: 'moodle',
            externalCourseId: '77',
            externalUserId: '501',
            localUserId: userId,
            externalLabel: 'Secret Student',
            externalEmail: 'secret.student@ubc.ca',
            matchedBy: 'email'
        });
        const api = {
            getGradeItems: jest.fn(async () => [{ id: 'quiz-1', name: 'Quiz 1', maxScore: 100 }]),
            getGrades: jest.fn(async () => [
                { userId: '501', gradeItemId: 'quiz-1', score: 87.5, grade: 'SECRET-GRADE' },
                { userId: '501', score: null, grade: null }
            ])
        };

        await lmsGradeImport.importProviderGrades({ db, course, provider: 'moodle', api, client: {}, importedBy: 'instructor-1' });

        const snapshots = rawDb.stored('lms_grade_snapshots');
        expect(snapshots).toHaveLength(2);
        const quiz = snapshots.find((snapshot) => snapshot.gradeItemKey === 'quiz-1');
        expect(isEnvelope(quiz.score)).toBe(true);
        expect(isEnvelope(quiz.grade)).toBe(true);
        expect(quiz).toMatchObject({ courseId: 'BIOC-1', localUserId: userId, maxScore: 100 });
        expect(JSON.stringify(snapshots)).not.toMatch(/87\.5|SECRET-GRADE/);
        // A missing grade stays null, so the score type survives the round trip below.
        expect(snapshots.find((snapshot) => snapshot.gradeItemKey !== 'quiz-1').score).toBeNull();

        const view = await lmsGradeImport.getStoredGradeView({ db, course, provider: 'moodle' });
        expect(view.students).toHaveLength(1);
        expect(view.students[0]).toMatchObject({
            displayName: 'Secret Student',
            externalEmail: 'secret.student@ubc.ca'
        });
        expect(view.students[0].grades['quiz-1']).toMatchObject({ score: 87.5, grade: 'SECRET-GRADE' });
    });
});

describeWithToolkit('accounts created before the rollout', () => {
    test('under mixed reads a plaintext account is still found, so nobody gets a second one', async () => {
        const { rawDb, db } = await wrap('mixed', 'mixed', {
            users: [{
                userId: 'legacy-user',
                username: 'legacy-username',
                email: 'legacy@ubc.ca',
                displayName: 'Legacy Student',
                puid: 'PUID-LEGACY',
                samlId: 'legacy-nameid',
                authProvider: 'saml',
                role: 'student',
                isActive: true,
                lastLogin: new Date('2026-01-01')
            }]
        });

        const result = await User.createOrGetSAMLUser(db, {
            samlId: 'legacy-nameid',
            puid: 'PUID-LEGACY',
            email: 'legacy@ubc.ca',
            username: 'legacy-username',
            displayName: 'Legacy Student',
            role: 'student'
        });

        expect(result.user.userId).toBe('legacy-user');
        expect(rawDb.stored('users')).toHaveLength(1);
    });
});
