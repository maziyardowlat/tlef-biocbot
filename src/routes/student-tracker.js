const express = require('express');
const router = express.Router();
const User = require('../models/User');

/**
 * GET /api/student/struggle
 * Retrieve the current struggle state for the authenticated student.
 */
router.get('/', async (req, res) => {
    try {
        if (!req.user) {
            return res.status(401).json({ success: false, message: 'Unauthorized' });
        }

        const db = req.app.locals.db;
        const user = await User.getUserById(db, req.user.userId);

        if (!user) {
            return res.status(404).json({ success: false, message: 'User not found' });
        }

        const struggleState = user.struggleState || { topics: [] };

        res.json({
            success: true,
            struggleState
        });

    } catch (error) {
        console.error('❌ Error fetching struggle state:', error);
        res.status(500).json({ success: false, message: 'Internal server error' });
    }
});

/**
 * POST /api/student/struggle/reset
 * Reset struggle state for a specific topic or all topics.
 * Body: { topic: 'Microbiology' | 'ALL' }
 */
router.post('/reset', async (req, res) => {
    try {
        if (!req.user) {
            return res.status(401).json({ success: false, message: 'Unauthorized' });
        }

        const { topic } = req.body;
        if (!topic) {
            return res.status(400).json({ success: false, message: 'Topic is required' });
        }

        const db = req.app.locals.db;
        
        // Use courseId from request body (sent by frontend) or fallback to user preferences
        const courseId = requestCourseId || req.user.preferences?.courseId || null;
        
        console.log(`🔄 [TRACKER_API] Resetting struggle for user ${req.user.userId}, topic: ${topic}, courseId: ${courseId}`);

        const result = await User.resetUserStruggleState(db, req.user.userId, topic, courseId);

        if (result.success) {
            res.json({ success: true, message: 'Struggle state reset successfully' });
        } else {
            res.status(500).json({ success: false, message: 'Failed to reset state' });
        }

    } catch (error) {
        console.error('❌ Error resetting struggle state:', error);
        res.status(500).json({ success: false, message: 'Internal server error' });
    }
});

module.exports = router;
