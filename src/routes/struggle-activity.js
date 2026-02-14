/**
 * Struggle Activity Routes
 * 
 * API endpoints for fetching struggle activity history from MongoDB.
 * Used by instructor dashboard for polling and displaying student struggle activity.
 */

const express = require('express');
const router = express.Router();
const StruggleActivity = require('../models/StruggleActivity');

/**
 * GET /api/struggle-activity/:courseId
 * Fetch struggle activity history for a specific course
 * 
 * Query params:
 * - limit: Maximum number of entries to return (default: 100)
 * - state: Filter by state ('Active' or 'Inactive')
 */
router.get('/:courseId', async (req, res) => {
    try {
        const { courseId } = req.params;
        const limit = parseInt(req.query.limit) || 100;
        const state = req.query.state; // Optional filter
        
        if (!courseId) {
            return res.status(400).json({ 
                success: false, 
                message: 'Course ID is required' 
            });
        }
        
        const db = req.app.locals.db;
        
        const activities = await StruggleActivity.getActivityByCourse(db, courseId, {
            limit,
            state
        });
        
        res.json({
            success: true,
            data: activities,
            count: activities.length
        });
        
    } catch (error) {
        console.error('Error fetching struggle activity:', error);
        res.status(500).json({
            success: false,
            message: 'Failed to fetch struggle activity',
            error: error.message
        });
    }
});

/**
 * GET /api/struggle-activity/student/:userId
 * Fetch struggle activity history for a specific student
 * 
 * Query params:
 * - limit: Maximum number of entries to return (default: 50)
 */
router.get('/student/:userId', async (req, res) => {
    try {
        const { userId } = req.params;
        const limit = parseInt(req.query.limit) || 50;
        
        if (!userId) {
            return res.status(400).json({ 
                success: false, 
                message: 'User ID is required' 
            });
        }
        
        const db = req.app.locals.db;
        
        const activities = await StruggleActivity.getActivityByStudent(db, userId, {
            limit
        });
        
        res.json({
            success: true,
            data: activities,
            count: activities.length
        });
        
    } catch (error) {
        console.error('Error fetching student struggle activity:', error);
        res.status(500).json({
            success: false,
            message: 'Failed to fetch student struggle activity',
            error: error.message
        });
    }
});

module.exports = router;
