// @ts-check
/**
 * API coverage for src/routes/user-agreement.js (69.69% → higher).
 *
 *   - GET  /api/user-agreement/status
 *   - POST /api/user-agreement/agree
 *
 * Mounted in src/server.js as `requireAuth → router`, so unauthenticated
 * requests are rejected with 401 before reaching the handler.
 *
 * The same userId/userType pair is upserted in the `userAgreements` collection,
 * so each test cleans up its rows for the calling user. Two different roles
 * (instructor, student) exercise both branches of the `role` discriminator.
 *
 * Per AGENTS.md, no production code is modified; bug-exposing tests are left
 * failing and reported in tests/e2e/FINDINGS.md.
 */

const { test, expect, request } = require('./fixtures/monocart');
const { TEST_USERS, storageStatePath } = require('./helpers/users');
const {
    withDb,
    getUserIdByUsername,
} = require('./helpers/courses-test');

let instructorId;
let studentId;

test.beforeAll(async () => {
    instructorId = await getUserIdByUsername(TEST_USERS.instructor.username);
    studentId = await getUserIdByUsername(TEST_USERS.student.username);
});

async function clearAgreements() {
    await withDb((db) =>
        db.collection('userAgreements').deleteMany({
            userId: { $in: [instructorId, studentId] },
        })
    );
}

test.beforeEach(async () => {
    await clearAgreements();
});

test.afterAll(async () => {
    await clearAgreements();
});

// ---------------------------------------------------------------------------
// GET /api/user-agreement/status
// ---------------------------------------------------------------------------
test.describe('GET /status', () => {
    test.describe('as instructor', () => {
        test.use({ storageState: storageStatePath('instructor') });

        test('returns hasAgreed:false with default version when no record exists', async ({ request: api }) => {
            const res = await api.get('/api/user-agreement/status');
            expect(res.ok()).toBeTruthy();
            const body = await res.json();
            expect(body.success).toBe(true);
            expect(body.data.hasAgreed).toBe(false);
            expect(body.data.agreementVersion).toBe('1.0');
            expect(body.data.agreedAt).toBeNull();
        });

        test('reflects a manually-seeded agreement row', async ({ request: api }) => {
            const agreedAt = new Date('2026-02-15T12:00:00Z');
            await withDb((db) =>
                db.collection('userAgreements').insertOne({
                    userId: instructorId,
                    userType: 'instructor',
                    hasAgreed: true,
                    agreementVersion: '3.5',
                    agreedAt,
                    createdAt: agreedAt,
                    updatedAt: agreedAt,
                })
            );
            const res = await api.get('/api/user-agreement/status');
            expect(res.ok()).toBeTruthy();
            const body = await res.json();
            expect(body.data.hasAgreed).toBe(true);
            expect(body.data.agreementVersion).toBe('3.5');
            expect(new Date(body.data.agreedAt).toISOString()).toBe(agreedAt.toISOString());
        });
    });

    test.describe('as student (role discriminator)', () => {
        test.use({ storageState: storageStatePath('student') });

        test('looks up the student row independently of the instructor row', async ({ request: api }) => {
            // Seed only an instructor row — the student status must still be
            // hasAgreed:false because the model filters by both userId AND role.
            await withDb((db) =>
                db.collection('userAgreements').insertOne({
                    userId: instructorId,
                    userType: 'instructor',
                    hasAgreed: true,
                    agreementVersion: '9.9',
                    agreedAt: new Date(),
                    createdAt: new Date(),
                    updatedAt: new Date(),
                })
            );
            const res = await api.get('/api/user-agreement/status');
            expect(res.ok()).toBeTruthy();
            const body = await res.json();
            expect(body.data.hasAgreed).toBe(false);
        });
    });
});

// ---------------------------------------------------------------------------
// POST /api/user-agreement/agree
// ---------------------------------------------------------------------------
test.describe('POST /agree', () => {
    test.use({ storageState: storageStatePath('instructor') });

    test('records the agreement with the supplied version', async ({ request: api }) => {
        const res = await api.post('/api/user-agreement/agree', {
            data: { agreementVersion: '2.4' },
        });
        expect(res.ok()).toBeTruthy();
        const body = await res.json();
        expect(body.success).toBe(true);
        expect(body.data.hasAgreed).toBe(true);
        expect(body.data.agreementVersion).toBe('2.4');
        expect(body.data.agreedAt).not.toBeNull();

        // Verify persistence: a follow-up GET reflects the change.
        const status = await api.get('/api/user-agreement/status');
        const sbody = await status.json();
        expect(sbody.data.hasAgreed).toBe(true);
        expect(sbody.data.agreementVersion).toBe('2.4');

        // And the row is in the DB with ipAddress/userAgent captured.
        const row = await withDb((db) =>
            db.collection('userAgreements').findOne({ userId: instructorId, userType: 'instructor' })
        );
        expect(row.hasAgreed).toBe(true);
        expect(row.ipAddress).toBeTruthy();
        expect(row.userAgent).toBeTruthy();
    });

    test('falls back to default version "1.0" when body omits agreementVersion', async ({ request: api }) => {
        const res = await api.post('/api/user-agreement/agree', { data: {} });
        expect(res.ok()).toBeTruthy();
        const body = await res.json();
        expect(body.data.agreementVersion).toBe('1.0');
    });

    test('an empty request body (no data field) still records the default', async ({ request: api }) => {
        // No `data` key — Playwright sends a request with no body. The route
        // should still succeed because `agreementVersion` has a default.
        const res = await api.post('/api/user-agreement/agree');
        expect(res.ok()).toBeTruthy();
        const body = await res.json();
        expect(body.data.hasAgreed).toBe(true);
        expect(body.data.agreementVersion).toBe('1.0');
    });

    test('a second POST updates the existing row (upsert path)', async ({ request: api }) => {
        const first = await api.post('/api/user-agreement/agree', {
            data: { agreementVersion: '1.0' },
        });
        expect(first.ok()).toBeTruthy();

        const second = await api.post('/api/user-agreement/agree', {
            data: { agreementVersion: '5.0' },
        });
        expect(second.ok()).toBeTruthy();
        const body = await second.json();
        expect(body.data.agreementVersion).toBe('5.0');

        // Only a single row exists for (userId, userType) thanks to the upsert.
        const rows = await withDb((db) =>
            db.collection('userAgreements').find({
                userId: instructorId,
                userType: 'instructor',
            }).toArray()
        );
        expect(rows).toHaveLength(1);
        expect(rows[0].agreementVersion).toBe('5.0');
    });
});

// ---------------------------------------------------------------------------
// Auth gate (requireAuth → 401 for unauthenticated callers)
// ---------------------------------------------------------------------------
test.describe('Auth', () => {
    test('unauthenticated GET /status returns 401', async ({ baseURL }) => {
        const api = await request.newContext({ baseURL });
        try {
            const res = await api.get('/api/user-agreement/status');
            expect(res.status()).toBe(401);
            const body = await res.json();
            expect(body.success).toBe(false);
        } finally {
            await api.dispose();
        }
    });

    test('unauthenticated POST /agree returns 401', async ({ baseURL }) => {
        const api = await request.newContext({ baseURL });
        try {
            const res = await api.post('/api/user-agreement/agree', {
                data: { agreementVersion: '1.0' },
            });
            expect(res.status()).toBe(401);
        } finally {
            await api.dispose();
        }
    });
});
