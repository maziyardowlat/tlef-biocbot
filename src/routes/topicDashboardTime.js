/**
 * Topic Dashboard Time Routes
 *
 * Lets the student-facing Topic Dashboard page report how long a student
 * was actively looking at it, and lets instructors/TAs read the resulting
 * per-student totals for a course (shown in Student Hub).
 */

const express = require('express');
const router = express.Router();
const TopicDashboardTime = require('../models/TopicDashboardTime');
const CourseModel = require('../models/Course');
const { hasSystemAdminAccess } = require('../services/authorization');

/**
 * POST /api/topic-dashboard-time/:courseId
 * Report an increment of active time on the Topic Dashboard for the
 * current user. Always attributed to req.user.userId - a client can never
 * report time on another student's behalf.
 */
router.post('/:courseId', async (req, res) => {
    try {
        const { courseId } = req.params;
        const user = req.user;
        if (!user) {
            return res.status(401).json({ success: false, message: 'Authentication required' });
        }

        const db = req.app.locals.db;
        if (!db) {
            return res.status(503).json({ success: false, message: 'Database connection not available' });
        }

        const durationMs = Number(req.body?.durationMs);
        if (!Number.isFinite(durationMs) || durationMs <= 0) {
            return res.status(400).json({ success: false, message: 'durationMs must be a positive number' });
        }

        await TopicDashboardTime.addVisitDuration(db, {
            userId: user.userId,
            courseId,
            durationMs
        });

        return res.json({ success: true });
    } catch (error) {
        console.error('Error recording topic dashboard time:', error);
        return res.status(500).json({ success: false, message: 'Internal server error while recording topic dashboard time' });
    }
});

/**
 * GET /api/topic-dashboard-time/:courseId
 * Instructor/TA view: cumulative Topic Dashboard time for every student
 * in the course, keyed by userId.
 */
router.get('/:courseId', async (req, res) => {
    try {
        const { courseId } = req.params;
        const user = req.user;
        if (!user) {
            return res.status(401).json({ success: false, message: 'Authentication required' });
        }
        if (user.role !== 'instructor' && user.role !== 'ta') {
            return res.status(403).json({ success: false, message: 'Only instructors and TAs can view topic dashboard time' });
        }

        const db = req.app.locals.db;
        if (!db) {
            return res.status(503).json({ success: false, message: 'Database connection not available' });
        }

        const accessRole = user.role === 'ta' ? 'ta' : 'instructor';
        const hasAccess = hasSystemAdminAccess(user)
            || await CourseModel.userHasCourseAccess(db, courseId, user.userId, accessRole);
        if (!hasAccess) {
            return res.status(403).json({ success: false, message: 'Access denied. You can only view courses you have access to.' });
        }

        if (user.role === 'ta') {
            const canAccessRoster = await CourseModel.checkTAPermission(db, courseId, user.userId, 'roster');
            if (!canAccessRoster) {
                return res.status(403).json({ success: false, message: 'Access denied. You do not have permission to view the student roster for this course.' });
            }
        }

        const totals = await TopicDashboardTime.getTotalsForCourse(db, courseId);
        return res.json({ success: true, data: totals });
    } catch (error) {
        console.error('Error fetching topic dashboard time:', error);
        return res.status(500).json({ success: false, message: 'Internal server error while fetching topic dashboard time' });
    }
});

module.exports = router;
