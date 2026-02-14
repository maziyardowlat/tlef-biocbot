/**
 * Struggle Activity API Routes
 * Provides endpoints for fetching persistent struggle activity history
 */

const express = require('express');
const router = express.Router();
const StruggleActivity = require('../models/StruggleActivity');

/**
 * GET /api/struggle-activity/:courseId
 * Get struggle activity history for a specific course
 * Query params:
 *   - limit: Maximum number of entries to return (default 100)
 */
router.get('/:courseId', async (req, res) => {
    try {
        const { courseId } = req.params;
        const limit = parseInt(req.query.limit) || 100;
        
        // Validate courseId
        if (!courseId) {
            return res.status(400).json({
                success: false,
                message: 'Course ID is required'
            });
        }
        
        // Get database connection
        const db = req.app.locals.db;
        if (!db) {
            return res.status(503).json({
                success: false,
                message: 'Database connection not available'
            });
        }
        
        // Fetch activity from database
        const activities = await StruggleActivity.getActivityByCourse(db, courseId, limit);
        
        console.log(`📊 [ACTIVITY_API] Fetched ${activities.length} activity entries for course ${courseId}`);
        
        res.json({
            success: true,
            data: activities
        });
        
    } catch (error) {
        console.error('❌ Error fetching struggle activity:', error);
        res.status(500).json({
            success: false,
            message: 'Failed to fetch struggle activity',
            error: process.env.NODE_ENV === 'development' ? error.message : undefined
        });
    }
});

/**
 * GET /api/struggle-activity/user/:userId
 * Get struggle activity history for a specific student
 * Query params:
 *   - limit: Maximum number of entries to return (default 50)
 */
router.get('/user/:userId', async (req, res) => {
    try {
        const { userId } = req.params;
        const limit = parseInt(req.query.limit) || 50;
        
        // Validate userId
        if (!userId) {
            return res.status(400).json({
                success: false,
                message: 'User ID is required'
            });
        }
        
        // Get database connection
        const db = req.app.locals.db;
        if (!db) {
            return res.status(503).json({
                success: false,
                message: 'Database connection not available'
            });
        }
        
        // Fetch activity from database
        const activities = await StruggleActivity.getActivityByUser(db, userId, limit);
        
        console.log(`📊 [ACTIVITY_API] Fetched ${activities.length} activity entries for user ${userId}`);
        
        res.json({
            success: true,
            data: activities
        });
        
    } catch (error) {
        console.error('❌ Error fetching user struggle activity:', error);
        res.status(500).json({
            success: false,
            message: 'Failed to fetch user struggle activity',
            error: process.env.NODE_ENV === 'development' ? error.message : undefined
        });
    }
});

module.exports = router;
