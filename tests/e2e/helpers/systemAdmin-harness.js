// @ts-nocheck
/**
 * Coverage harness for src/services/systemAdmin.js.
 *
 * Drives every documented branch of listSystemAdmins / grantSystemAdminByEmail /
 * revokeSystemAdminByEmail against an in-memory fake users collection so we
 * don't have to talk to MongoDB. The child process writes V8 coverage to
 * coverage-reports/.v8-server (set by the parent spec) which is merged into the
 * monocart report by tests/e2e/global-teardown.js.
 */

const assert = require('assert/strict');
const path = require('path');
const v8 = require('v8');

const systemAdmin = require(path.resolve(__dirname, '../../../src/services/systemAdmin'));

class FakeUsersCollection {
    constructor() {
        this.users = [];
        this.updates = [];
    }

    find(query) {
        const matches = this.users.filter((u) => {
            for (const [key, value] of Object.entries(query)) {
                const actual = key.split('.').reduce((acc, k) => (acc ? acc[k] : undefined), u);
                if (actual !== value) return false;
            }
            return true;
        });
        return {
            sort: () => ({
                toArray: async () => matches,
            }),
        };
    }

    async findOne(query) {
        return this.users.find((u) => {
            for (const [key, value] of Object.entries(query)) {
                const actual = key.split('.').reduce((acc, k) => (acc ? acc[k] : undefined), u);
                if (actual !== value) return false;
            }
            return true;
        }) || null;
    }

    async updateOne(filter, update) {
        const target = this.users.find((u) => u._id === filter._id);
        if (!target) return { matchedCount: 0, modifiedCount: 0 };

        this.updates.push({ filter, update });

        if (update.$set) {
            for (const [key, value] of Object.entries(update.$set)) {
                const keys = key.split('.');
                let obj = target;
                for (let i = 0; i < keys.length - 1; i++) {
                    if (!obj[keys[i]] || typeof obj[keys[i]] !== 'object') obj[keys[i]] = {};
                    obj = obj[keys[i]];
                }
                obj[keys[keys.length - 1]] = value;
            }
        }
        if (update.$unset) {
            for (const key of Object.keys(update.$unset)) {
                const keys = key.split('.');
                let obj = target;
                for (let i = 0; i < keys.length - 1; i++) {
                    if (!obj[keys[i]]) { obj = null; break; }
                    obj = obj[keys[i]];
                }
                if (obj) delete obj[keys[keys.length - 1]];
            }
        }
        return { matchedCount: 1, modifiedCount: 1 };
    }

    async countDocuments(query) {
        const matches = this.users.filter((u) => {
            for (const [key, value] of Object.entries(query)) {
                const actual = key.split('.').reduce((acc, k) => (acc ? acc[k] : undefined), u);
                if (actual !== value) return false;
            }
            return true;
        });
        return matches.length;
    }
}

function makeDb(usersCollection) {
    return {
        collection(name) {
            assert.equal(name, 'users');
            return usersCollection;
        },
    };
}

async function run() {
    // ---- listSystemAdmins ----
    {
        const users = new FakeUsersCollection();
        users.users = [
            {
                _id: 'a',
                userId: 'u-alice',
                email: 'Alice@Example.com',
                role: 'instructor',
                baseRole: 'instructor',
                displayName: 'Alice',
                authProvider: 'local',
                createdAt: new Date('2026-01-01'),
                lastLogin: new Date('2026-02-01'),
                isActive: true,
                permissions: { systemAdmin: true },
            },
            {
                _id: 'b',
                userId: 'u-bob',
                email: 'bob@example.com',
                isActive: true,
                permissions: { systemAdmin: true },
            },
            {
                _id: 'c',
                userId: 'u-carol',
                email: 'carol@example.com',
                isActive: false,
                permissions: { systemAdmin: true },
            },
            {
                _id: 'd',
                userId: 'u-dave',
                email: 'dave@example.com',
                isActive: true,
                permissions: { systemAdmin: false },
            },
        ];
        const admins = await systemAdmin.listSystemAdmins(makeDb(users));
        assert.equal(admins.length, 2);
        assert.equal(admins[0].email, 'alice@example.com');
        assert.equal(admins[0].permissions.systemAdmin, true);
        assert.equal(admins[1].userId, 'u-bob');
    }

    // ---- grantSystemAdminByEmail: empty/invalid email ----
    {
        const users = new FakeUsersCollection();
        const r1 = await systemAdmin.grantSystemAdminByEmail(makeDb(users), '');
        assert.equal(r1.success, false);
        assert.match(r1.error || '', /valid email/i);

        const r2 = await systemAdmin.grantSystemAdminByEmail(makeDb(users), '   ');
        assert.equal(r2.success, false);

        const r3 = await systemAdmin.grantSystemAdminByEmail(makeDb(users), null);
        assert.equal(r3.success, false);
    }

    // ---- grantSystemAdminByEmail: user not found ----
    {
        const users = new FakeUsersCollection();
        const r = await systemAdmin.grantSystemAdminByEmail(makeDb(users), 'missing@example.com');
        assert.equal(r.success, false);
        assert.match(r.error, /not found/i);
    }

    // ---- grantSystemAdminByEmail: existing user, with grantedBy ----
    {
        const users = new FakeUsersCollection();
        users.users = [{ _id: '1', userId: 'u-x', email: 'x@example.com', isActive: true, permissions: {} }];
        const r = await systemAdmin.grantSystemAdminByEmail(makeDb(users), '  X@Example.COM  ', { grantedBy: 'admin@example.com' });
        assert.equal(r.success, true);
        assert.equal(r.email, 'x@example.com');
        assert.equal(users.users[0].permissions.systemAdmin, true);
        assert.equal(users.users[0].permissions.systemAdminGrantedBy, 'admin@example.com');
    }

    // ---- grantSystemAdminByEmail: existing user, default options ----
    {
        const users = new FakeUsersCollection();
        users.users = [{ _id: '1', userId: 'u-y', email: 'y@example.com', isActive: true, permissions: {} }];
        const r = await systemAdmin.grantSystemAdminByEmail(makeDb(users), 'y@example.com');
        assert.equal(r.success, true);
        assert.equal(users.users[0].permissions.systemAdminGrantedBy, null);
    }

    // ---- revokeSystemAdminByEmail: empty email ----
    {
        const users = new FakeUsersCollection();
        const r = await systemAdmin.revokeSystemAdminByEmail(makeDb(users), '');
        assert.equal(r.success, false);
    }

    // ---- revokeSystemAdminByEmail: admin not found ----
    {
        const users = new FakeUsersCollection();
        const r = await systemAdmin.revokeSystemAdminByEmail(makeDb(users), 'none@example.com');
        assert.equal(r.success, false);
        assert.match(r.error, /not found/i);
    }

    // ---- revokeSystemAdminByEmail: last remaining admin ----
    {
        const users = new FakeUsersCollection();
        users.users = [
            { _id: '1', userId: 'u-lone', email: 'lone@example.com', isActive: true, permissions: { systemAdmin: true } },
        ];
        const r = await systemAdmin.revokeSystemAdminByEmail(makeDb(users), 'lone@example.com');
        assert.equal(r.success, false);
        assert.match(r.error, /last remaining/i);
    }

    // ---- revokeSystemAdminByEmail: success ----
    {
        const users = new FakeUsersCollection();
        users.users = [
            { _id: '1', userId: 'u-1', email: 'a@example.com', isActive: true, permissions: { systemAdmin: true, systemAdminGrantedBy: 'foo' } },
            { _id: '2', userId: 'u-2', email: 'b@example.com', isActive: true, permissions: { systemAdmin: true } },
        ];
        const r = await systemAdmin.revokeSystemAdminByEmail(makeDb(users), '  A@Example.com  ');
        assert.equal(r.success, true);
        assert.equal(r.email, 'a@example.com');
        assert.equal(users.users[0].permissions.systemAdmin, undefined);
        assert.equal(users.users[0].permissions.systemAdminGrantedBy, undefined);
    }
}

run()
    .then(() => {
        try { v8.takeCoverage(); } catch { /* coverage disabled */ }
    })
    .catch((err) => {
        console.error(err);
        try { v8.takeCoverage(); } catch { /* coverage disabled */ }
        process.exitCode = 1;
    });
