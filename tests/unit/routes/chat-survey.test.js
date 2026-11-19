const { memoryDb } = require('../helpers/memory-db');
const { makeRouteApp, request } = require('../helpers/route-app');
const chatRouter = require('../../../src/routes/chat');
const ChatSurveyResponse = require('../../../src/models/ChatSurveyResponse');

const student = { userId: 's1', role: 'student', displayName: 'Student One', username: 'student1' };
const blockedStudent = { userId: 'blocked', role: 'student' };
const instructor = { userId: 'i1', role: 'instructor', displayName: 'Instructor One' };
const otherInstructor = { userId: 'i2', role: 'instructor' };

function seededDb(extra = {}) {
    return memoryDb({
        courses: [
            {
                courseId: 'C1',
                courseName: 'BIOC 401',
                instructorId: 'i1',
                instructors: ['i1'],
                studentEnrollment: {
                    s1: { enrolled: true },
                    blocked: { enrolled: false }
                },
                status: 'active',
                chatSurveySettings: {
                    enabled: true,
                    triggerMessageCount: 10,
                    promptText: 'Did this chat help?',
                    introText: 'Please rate your experience',
                    accuracyPrompt: 'Was it accurate?',
                    satisfactionPrompt: 'Are you satisfied?',
                    allowFreeText: true
                }
            },
            {
                courseId: 'C2',
                courseName: 'BIOC 402',
                instructorId: 'i1',
                instructors: ['i1'],
                studentEnrollment: {
                    s1: { enrolled: true }
                },
                status: 'active',
                chatSurveySettings: {
                    enabled: false,
                    triggerMessageCount: 10,
                    promptText: 'Disabled survey',
                    introText: 'Disabled intro',
                    accuracyPrompt: 'Disabled A',
                    satisfactionPrompt: 'Disabled B',
                    allowFreeText: true
                }
            }
        ],
        ...extra
    });
}

function app(db, user = student) {
    return makeRouteApp(chatRouter, { db, user });
}

beforeAll(() => {
    jest.spyOn(console, 'log').mockImplementation(() => {});
    jest.spyOn(console, 'warn').mockImplementation(() => {});
    jest.spyOn(console, 'error').mockImplementation(() => {});
});
afterAll(() => jest.restoreAllMocks());

describe('chat survey routes', () => {
    test('GET /survey-settings requires an enrolled student and returns course settings', async () => {
        expect((await request(app(seededDb(), null)).get('/survey-settings?courseId=C1')).status).toBe(401);
        expect((await request(app(seededDb(), instructor)).get('/survey-settings?courseId=C1')).status).toBe(403);
        expect((await request(app(seededDb())).get('/survey-settings')).status).toBe(400);

        const blocked = await request(app(seededDb(), blockedStudent)).get('/survey-settings?courseId=C1');
        expect(blocked.status).toBe(403);

        const res = await request(app(seededDb())).get('/survey-settings?courseId=C1&conversationId=session-1');
        expect(res.status).toBe(200);
        expect(res.body.data.settings).toMatchObject({
            enabled: true,
            triggerMessageCount: 10,
            promptText: 'Did this chat help?',
            introText: 'Please rate your experience',
            accuracyPrompt: 'Was it accurate?',
            satisfactionPrompt: 'Are you satisfied?',
            allowFreeText: true
        });
        expect(res.body.data.settingsFingerprint).toHaveLength(24);
        expect(res.body.data.response).toBeNull();
    });

    test('GET /survey-settings includes an existing response for the current session', async () => {
        const settings = {
            enabled: true,
            triggerMessageCount: 10,
            promptText: 'Did this chat help?',
            introText: 'Please rate your experience',
            accuracyPrompt: 'Was it accurate?',
            satisfactionPrompt: 'Are you satisfied?',
            allowFreeText: true
        };
        const fingerprint = ChatSurveyResponse.buildSettingsFingerprint(settings);
        const db = seededDb({
            [ChatSurveyResponse.COLLECTION_NAME]: [
                {
                    responseId: 'r1',
                    courseId: 'C1',
                    studentId: 's1',
                    conversationId: 'session-1',
                    settingsFingerprint: fingerprint,
                    shownAt: new Date('2026-01-01'),
                    updatedAt: new Date('2026-01-01')
                }
            ]
        });

        const res = await request(app(db)).get('/survey-settings?courseId=C1&conversationId=session-1');
        expect(res.status).toBe(200);
        expect(res.body.data.response).toMatchObject({
            responseId: 'r1',
            courseId: 'C1',
            studentId: 's1',
            conversationId: 'session-1'
        });
    });

    test('POST /survey records a star rating without requiring comment text', async () => {
        const db = seededDb();
        const settingsResponse = await request(app(db)).get('/survey-settings?courseId=C1&conversationId=session-1');
        const fingerprint = settingsResponse.body.data.settingsFingerprint;

        const res = await request(app(db)).post('/survey').send({
            courseId: 'C1',
            unitName: 'Unit 1',
            conversationId: 'session-1',
            eventType: 'submitted',
            settingsFingerprint: fingerprint,
            ratingAccuracy: 4,
            ratingSatisfaction: 3,
            comment: '',
            messageCountAtPrompt: 10
        });

        expect(res.status).toBe(200);
        expect(res.body.data.response).toMatchObject({
            courseId: 'C1',
            studentId: 's1',
            studentName: 'Student One',
            ratingAccuracy: 4,
            ratingSatisfaction: 3,
            comment: null,
            lastEvent: 'submitted',
            messageCountAtPrompt: 10
        });

        const stored = await db.collection(ChatSurveyResponse.COLLECTION_NAME).find({}).toArray();
        expect(stored).toHaveLength(1);
    });

    test('POST /survey validates access, enabled setting, fingerprint, and star rating', async () => {
        const db = seededDb();
        const settingsResponse = await request(app(db)).get('/survey-settings?courseId=C1&conversationId=session-1');
        const fingerprint = settingsResponse.body.data.settingsFingerprint;

        const blocked = await request(app(db, blockedStudent)).post('/survey').send({
            courseId: 'C1',
            conversationId: 'session-1',
            eventType: 'shown',
            settingsFingerprint: fingerprint
        });
        expect(blocked.status).toBe(403);

        const disabled = await request(app(db)).post('/survey').send({
            courseId: 'C2',
            conversationId: 'session-1',
            eventType: 'shown'
        });
        expect(disabled.status).toBe(400);
        expect(disabled.body.message).toBe('Chat survey is not enabled for this course');

        const stale = await request(app(db)).post('/survey').send({
            courseId: 'C1',
            conversationId: 'session-1',
            eventType: 'shown',
            settingsFingerprint: 'stale'
        });
        expect(stale.status).toBe(409);

        const missingRating = await request(app(db)).post('/survey').send({
            courseId: 'C1',
            conversationId: 'session-1',
            eventType: 'submitted',
            settingsFingerprint: fingerprint
        });
        expect(missingRating.status).toBe(400);
        expect(missingRating.body.message).toBe('ratingAccuracy must be an integer from 1 to 5');
    });

    test('GET /survey/course/:courseId lists and exports survey responses for course instructors', async () => {
        const db = seededDb({
            [ChatSurveyResponse.COLLECTION_NAME]: [
                {
                    responseId: 'r1',
                    courseId: 'C1',
                    studentId: 's1',
                    studentName: 'A, Student',
                    conversationId: 'session-1',
                    ratingAccuracy: 5,
                    ratingSatisfaction: 4,
                    comment: 'Useful',
                    shownAt: new Date('2026-01-01'),
                    submittedAt: new Date('2026-01-02'),
                    updatedAt: new Date('2026-01-02')
                }
            ]
        });

        const denied = await request(app(db, otherInstructor)).get('/survey/course/C1');
        expect(denied.status).toBe(403);

        const list = await request(app(db, instructor)).get('/survey/course/C1');
        expect(list.status).toBe(200);
        expect(list.body.data.responses.map(item => item.responseId)).toEqual(['r1']);
        expect(list.body.data.stats).toMatchObject({
            total: 1,
            submitted: 1,
            averageAccuracy: 5,
            averageSatisfaction: 4
        });

        const exported = await request(app(db, instructor)).get('/survey/course/C1/export');
        expect(exported.status).toBe(200);
        expect(exported.headers['content-type']).toMatch(/text\/csv/);
        expect(exported.headers['content-disposition']).toContain('chat-survey-responses-C1.csv');
        expect(exported.text).toContain('responseId,courseId,unitName');
        expect(exported.text).toContain('"A, Student"');
    });

    describe('GET /survey/course/:courseId/export/anonymized', () => {
        const systemAdmin = { userId: 'admin1', role: 'instructor', permissions: { systemAdmin: true } };
        const mapping = (studentId, pseudonym) => ({ scopeType: 'course', scopeId: 'C1', studentId, pseudonym });
        const surveyResponse = (responseId, studentId, studentName) => ({
            responseId,
            courseId: 'C1',
            studentId,
            studentName,
            conversationId: `session-${responseId}`,
            ratingAccuracy: 5,
            ratingSatisfaction: 4,
            comment: 'Useful',
            shownAt: new Date('2026-01-01'),
            submittedAt: new Date('2026-01-02'),
            updatedAt: new Date('2026-01-02')
        });
        const parseCsv = text => {
            const [headerLine, ...lines] = text.split('\n');
            const headers = headerLine.split(',');
            return {
                headers,
                rows: lines.map(line => Object.fromEntries(line.split(',').map((cell, i) => [headers[i], cell])))
            };
        };

        test('is refused for anyone who is not a system admin', async () => {
            const db = seededDb({
                student_pseudonyms: [mapping('s1', 'AB12'), mapping('blocked', 'CD34')],
                [ChatSurveyResponse.COLLECTION_NAME]: [surveyResponse('r1', 's1', 'Student One')]
            });

            const asInstructor = await request(app(db, instructor)).get('/survey/course/C1/export/anonymized');
            expect(asInstructor.status).toBe(403);
            expect(asInstructor.text).not.toContain('s1');

            const asStudent = await request(app(db, student)).get('/survey/course/C1/export/anonymized');
            expect(asStudent.status).toBe(403);
        });

        test('is blocked while a student in the course has no anonymization ID', async () => {
            const db = seededDb({
                student_pseudonyms: [mapping('s1', 'AB12')],
                [ChatSurveyResponse.COLLECTION_NAME]: [surveyResponse('r1', 's1', 'Student One')]
            });

            const res = await request(app(db, systemAdmin)).get('/survey/course/C1/export/anonymized');
            expect(res.status).toBe(409);
            expect(res.body.missingStudentIds).toEqual(['blocked']);
        });

        test('replaces student IDs with their codes and drops the name column', async () => {
            const db = seededDb({
                student_pseudonyms: [mapping('s1', 'AB12'), mapping('blocked', 'CD34')],
                [ChatSurveyResponse.COLLECTION_NAME]: [surveyResponse('r1', 's1', 'Student One')]
            });

            const res = await request(app(db, systemAdmin)).get('/survey/course/C1/export/anonymized');
            expect(res.status).toBe(200);
            expect(res.headers['content-type']).toMatch(/text\/csv/);
            expect(res.headers['content-disposition']).toContain('chat-survey-responses-anonymized-C1.csv');
            expect(res.headers['x-omitted-survey-responses']).toBe('0');

            const { headers, rows } = parseCsv(res.text);
            expect(headers).toContain('studentId');
            expect(headers).not.toContain('studentName');
            expect(rows).toHaveLength(1);
            expect(rows[0]).toMatchObject({ responseId: 'r1', studentId: 'AB12' });
            expect(res.text).not.toContain('Student One');
        });

        test('leaves out a response whose student has no code instead of exporting the real ID', async () => {
            // "ghost" answered a survey but is not enrolled, has no saved chat
            // and no course preference, so the scope check above never sees
            // them and reports the course as complete.
            const db = seededDb({
                student_pseudonyms: [mapping('s1', 'AB12'), mapping('blocked', 'CD34')],
                [ChatSurveyResponse.COLLECTION_NAME]: [
                    surveyResponse('r1', 's1', 'Student One'),
                    surveyResponse('r2', 'ghost-puid-999', 'Ghost Student')
                ]
            });

            const res = await request(app(db, systemAdmin)).get('/survey/course/C1/export/anonymized');
            expect(res.status).toBe(200);
            expect(res.headers['x-omitted-survey-responses']).toBe('1');

            const { rows } = parseCsv(res.text);
            expect(rows.map(row => row.responseId)).toEqual(['r1']);
            expect(res.text).not.toContain('ghost-puid-999');
            expect(res.text).not.toContain('Ghost Student');
        });
    });
});
