/**
 * Settings Routes
 * Handles settings-related API endpoints
 */

const express = require('express');
const router = express.Router();
const configService = require('../services/config');
const prompts = require('../services/prompts');

/**
 * GET /api/settings/can-delete-all
 * Check if the current user is allowed to see the delete all button
 * Returns true if the user's email is in the CAN_SEE_DELETE_ALL_BUTTON env variable
 */
router.get('/can-delete-all', async (req, res) => {
    try {
        // Check if user is authenticated
        if (!req.user) {
            return res.status(401).json({
                success: false,
                error: 'Not authenticated',
                canDeleteAll: false
            });
        }

        // Get user's email
        const userEmail = req.user.email;
        if (!userEmail) {
            return res.json({
                success: true,
                canDeleteAll: false
            });
        }

        // Get allowed emails from config
        const allowedEmails = configService.getAllowedDeleteButtonEmails();
        
        // Check if user's email is in the allowed list
        const canDeleteAll = allowedEmails.includes(userEmail);

        res.json({
            success: true,
            canDeleteAll: canDeleteAll
        });

    } catch (error) {
        console.error('Error checking delete all permission:', error);
        res.status(500).json({
            success: false,
            error: 'Failed to check delete all permission',
            canDeleteAll: false
        });
    }
});


/**
 * GET /api/settings/prompts
 * Get current system prompts (merged with defaults) for a specific course
 */
router.get('/prompts', async (req, res) => {
    try {
        const db = req.app.locals.db;
        if (!db) {
            return res.status(503).json({ success: false, message: 'Database connection not available' });
        }

        const courseId = req.query.courseId;
        
        // If no courseId provided, return defaults (or could return global default if we kept it)
        if (!courseId) {
            return res.json({
                success: true,
                prompts: { ...prompts.DEFAULT_PROMPTS, additiveRetrieval: false },
                isCourseSpecific: false,
                courseId: null
            });
        }

        // Query the course document
        const course = await db.collection('courses').findOne({ courseId });

        // Retrieve prompts from course or use defaults
        const coursePrompts = course ? (course.prompts || {}) : {};
        
        const result = {
            base: coursePrompts.base || prompts.DEFAULT_PROMPTS.base,
            protege: coursePrompts.protege || prompts.DEFAULT_PROMPTS.protege,
            tutor: coursePrompts.tutor || prompts.DEFAULT_PROMPTS.tutor,
            // Course-level additive retrieval setting
            additiveRetrieval: course ? !!course.isAdditiveRetrieval : false
        };

        res.json({
            success: true,
            prompts: result,
            isCourseSpecific: true,
            courseId: courseId
        });
    } catch (error) {
        console.error('Error fetching prompts:', error);
        res.status(500).json({
            success: false,
            message: 'Failed to fetch prompts'
        });
    }
});

/**
 * POST /api/settings/prompts
 * Save custom system prompts for a specific course
 */
router.post('/prompts', async (req, res) => {
    try {
        const db = req.app.locals.db;
        if (!db) {
            return res.status(503).json({ success: false, message: 'Database connection not available' });
        }

        const { base, protege, tutor, additiveRetrieval, courseId } = req.body;

        if (!courseId) {
            return res.status(400).json({ success: false, message: 'courseId is required to save settings' });
        }

        // Validation - ensure they are strings (prompts) and boolean (additiveRetrieval)
        if (typeof base !== 'string' || typeof protege !== 'string' || typeof tutor !== 'string') {
            return res.status(400).json({ success: false, message: 'Invalid prompt format' });
        }

        // Update the course document directly
        await db.collection('courses').updateOne(
            { courseId: courseId },
            { 
                $set: { 
                    'prompts.base': base, 
                    'prompts.protege': protege, 
                    'prompts.tutor': tutor,
                    isAdditiveRetrieval: !!additiveRetrieval,
                    updatedAt: new Date()
                } 
            }
        );

        res.json({
            success: true,
            message: 'Course settings saved successfully',
            courseId: courseId
        });
    } catch (error) {
        console.error('Error saving prompts:', error);
        res.status(500).json({
            success: false,
            message: 'Failed to save prompts'
        });
    }
});

/**
 * POST /api/settings/prompts/reset
 * Reset system prompts to defaults for a specific course
 */
router.post('/prompts/reset', async (req, res) => {
    try {
        const db = req.app.locals.db;
        if (!db) {
            return res.status(503).json({ success: false, message: 'Database connection not available' });
        }

        const { courseId } = req.body;
        
        if (!courseId) {
            return res.status(400).json({ success: false, message: 'courseId is required to reset settings' });
        }

        // Unset the prompts field and isAdditiveRetrieval in the course document
        await db.collection('courses').updateOne(
            { courseId: courseId },
            { 
                $unset: { prompts: "" },
                $set: { isAdditiveRetrieval: false } // Default to false
            }
        );

        res.json({
            success: true,
            message: 'Course settings reset to user defaults',
            prompts: prompts.DEFAULT_PROMPTS,
            courseId: courseId
        });
    } catch (error) {
        console.error('Error resetting prompts:', error);
        res.status(500).json({
            success: false,
            message: 'Failed to reset prompts'
        });
    }
});

/**
 * GET /api/settings/global
 * Get global settings (e.g. login restrictions)
 * Requires can-delete-all permission to view
 */
router.get('/global', async (req, res) => {
    try {
        const db = req.app.locals.db;
        if (!db) {
            return res.status(503).json({ success: false, message: 'Database connection not available' });
        }

        // Check authentication
        if (!req.user) {
            return res.status(401).json({ success: false, error: 'Not authenticated' });
        }

        // Check permission
        const userEmail = req.user.email;
        const allowedEmails = configService.getAllowedDeleteButtonEmails();
        const hasPermission = userEmail && allowedEmails.includes(userEmail);

        if (!hasPermission) {
            return res.status(403).json({ success: false, error: 'Access denied' });
        }

        // Get global settings
        const settings = await db.collection('settings').findOne({ _id: 'global' });

        res.json({
            success: true,
            settings: settings || { allowLocalLogin: true } // Default to true
        });

    } catch (error) {
        console.error('Error fetching global settings:', error);
        res.status(500).json({ success: false, error: 'Failed to fetch global settings' });
    }
});

/**
 * POST /api/settings/global
 * Update global settings
 * Requires can-delete-all permission
 */
router.post('/global', async (req, res) => {
    try {
        const db = req.app.locals.db;
        if (!db) {
            return res.status(503).json({ success: false, message: 'Database connection not available' });
        }

        // Check authentication
        if (!req.user) {
            return res.status(401).json({ success: false, error: 'Not authenticated' });
        }

        // Check permission
        const userEmail = req.user.email;
        const allowedEmails = configService.getAllowedDeleteButtonEmails();
        const hasPermission = userEmail && allowedEmails.includes(userEmail);

        if (!hasPermission) {
            return res.status(403).json({ success: false, error: 'Access denied' });
        }

        const { allowLocalLogin } = req.body;

        // Update settings
        await db.collection('settings').updateOne(
            { _id: 'global' },
            { 
                $set: { 
                    allowLocalLogin: !!allowLocalLogin,
                    updatedAt: new Date(),
                    updatedBy: userEmail
                } 
            },
            { upsert: true }
        );

        res.json({
            success: true,
            message: 'Global settings updated',
            settings: { allowLocalLogin: !!allowLocalLogin }
        });

    } catch (error) {
        console.error('Error updating global settings:', error);
        res.status(500).json({ success: false, error: 'Failed to update global settings' });
    }
});

module.exports = router;
