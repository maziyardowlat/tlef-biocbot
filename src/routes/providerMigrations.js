/**
 * Provider migration API
 *
 * Progress, failures and retry controls for the persistent jobs that prepare a
 * surface's course material for a new platform. Migrations run in the
 * background, so the UI polls these endpoints instead of holding a request
 * open while an entire course is re-indexed.
 */

const express = require('express');
const router = express.Router();

const migrations = require('../services/providerMigrationService');
const migrationRunner = require('../services/providerMigrationRunner');
const { hasSystemAdminAccess } = require('../services/authorization');

router.use(express.json());

function requireDb(req, res) {
    const db = req.app.locals.db;
    if (!db) {
        res.status(503).json({ success: false, message: 'Database connection not available' });
        return null;
    }
    return db;
}

/**
 * A user may see a migration when they are a system admin, or an instructor of
 * the course the migration belongs to.
 */
async function canAccessMigration(db, req, job) {
    if (!job) return false;
    if (hasSystemAdminAccess(req.user)) return true;
    if (job.scope && job.scope.type === 'course') {
        const course = await db.collection('courses').findOne({ courseId: job.scope.id });
        if (!course) return false;
        const userId = req.user && req.user.userId;
        return course.instructorId === userId
            || (Array.isArray(course.instructors) && course.instructors.includes(userId));
    }
    return false;
}

/**
 * GET /api/provider-migrations/:migrationId
 * Persistent progress: total, completed, failed and the current item.
 */
router.get('/:migrationId', async (req, res) => {
    try {
        const db = requireDb(req, res);
        if (!db) return;

        const job = await migrations.getMigration(db, req.params.migrationId);
        if (!job) {
            return res.status(404).json({ success: false, message: 'Migration not found' });
        }
        if (!await canAccessMigration(db, req, job)) {
            return res.status(403).json({ success: false, message: 'You do not have access to this migration' });
        }

        res.json({ success: true, migration: migrations.publicMigrationView(job) });
    } catch (error) {
        console.error('Error fetching migration:', error);
        res.status(500).json({ success: false, message: 'Failed to fetch migration' });
    }
});

/**
 * POST /api/provider-migrations/:migrationId/retry
 * Re-queue only the items that failed, then resume the job.
 */
router.post('/:migrationId/retry', async (req, res) => {
    try {
        const db = requireDb(req, res);
        if (!db) return;

        const job = await migrations.getMigration(db, req.params.migrationId);
        if (!job) {
            return res.status(404).json({ success: false, message: 'Migration not found' });
        }
        if (!await canAccessMigration(db, req, job)) {
            return res.status(403).json({ success: false, message: 'You do not have access to this migration' });
        }

        const requeued = await migrations.retryMigration(db, req.params.migrationId);

        // Re-mark the surface as migrating so the UI keeps showing progress.
        const target = migrations.scopeTarget(job.scope);
        if (target && job.toProvider) {
            await db.collection(target.collection).updateOne(
                target.filter,
                {
                    $set: {
                        pendingLlmProvider: job.toProvider,
                        providerMigrationId: job.migrationId,
                        updatedAt: new Date()
                    }
                }
            );
        }

        migrationRunner.startMigration(db, req.params.migrationId);

        res.status(202).json({
            success: true,
            message: 'Retrying failed items',
            migration: migrations.publicMigrationView(requeued)
        });
    } catch (error) {
        console.error('Error retrying migration:', error);
        res.status(500).json({ success: false, message: 'Failed to retry migration' });
    }
});

/**
 * GET /api/provider-migrations
 * All migrations (system admins) — used by the admin Platforms and Models
 * screen to show the impact of an embedding-model change.
 */
router.get('/', async (req, res) => {
    try {
        const db = requireDb(req, res);
        if (!db) return;

        if (!hasSystemAdminAccess(req.user)) {
            return res.status(403).json({ success: false, message: 'System administrator access required' });
        }

        const query = {};
        if (req.query.status) query.status = req.query.status;
        if (req.query.active === 'true') query.status = { $in: migrations.ACTIVE_STATUSES };

        const jobs = await db.collection(migrations.MIGRATIONS_COLLECTION)
            .find(query)
            .sort({ createdAt: -1 })
            .limit(100)
            .toArray();

        res.json({
            success: true,
            migrations: jobs.map(job => migrations.publicMigrationView(job))
        });
    } catch (error) {
        console.error('Error listing migrations:', error);
        res.status(500).json({ success: false, message: 'Failed to list migrations' });
    }
});

module.exports = router;
