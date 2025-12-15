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
 * Get current system prompts (merged with defaults)
 */
router.get('/prompts', async (req, res) => {
    try {
        const db = req.app.locals.db;
        if (!db) {
            return res.status(503).json({ success: false, message: 'Database connection not available' });
        }

        const settingsCol = db.collection('settings');
        const globalPrompts = await settingsCol.findOne({ _id: 'global_prompts' });

        // Merge saved prompts with defaults
        const result = {
            base: (globalPrompts && globalPrompts.base) || prompts.DEFAULT_PROMPTS.base,
            protege: (globalPrompts && globalPrompts.protege) || prompts.DEFAULT_PROMPTS.protege,
            tutor: (globalPrompts && globalPrompts.tutor) || prompts.DEFAULT_PROMPTS.tutor,
            additiveRetrieval: (globalPrompts && globalPrompts.additiveRetrieval) || false
        };

        res.json({
            success: true,
            prompts: result
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
 * Save custom system prompts
 */
router.post('/prompts', async (req, res) => {
    try {
        const db = req.app.locals.db;
        if (!db) {
            return res.status(503).json({ success: false, message: 'Database connection not available' });
        }

        const { base, protege, tutor, additiveRetrieval } = req.body;

        // Validation - ensure they are strings (prompts) and boolean (additiveRetrieval)
        if (typeof base !== 'string' || typeof protege !== 'string' || typeof tutor !== 'string') {
            return res.status(400).json({ success: false, message: 'Invalid prompt format' });
        }

        const settingsCol = db.collection('settings');
        
        await settingsCol.updateOne(
            { _id: 'global_prompts' },
            { 
                $set: { 
                    base, 
                    protege, 
                    tutor,
                    additiveRetrieval: !!additiveRetrieval,
                    updatedAt: new Date(),
                    updatedBy: req.user.email
                } 
            },
            { upsert: true }
        );

        res.json({
            success: true,
            message: 'Prompts saved successfully'
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
 * Reset system prompts to defaults
 */
router.post('/prompts/reset', async (req, res) => {
    try {
        const db = req.app.locals.db;
        if (!db) {
            return res.status(503).json({ success: false, message: 'Database connection not available' });
        }

        const settingsCol = db.collection('settings');
        
        // deleteOne/deleteMany would remove the document
        // We can just remove the document entirely since it only stores prompts for now
        await settingsCol.deleteOne({ _id: 'global_prompts' });

        res.json({
            success: true,
            message: 'Prompts reset to defaults',
            prompts: prompts.DEFAULT_PROMPTS
        });
    } catch (error) {
        console.error('Error resetting prompts:', error);
        res.status(500).json({
            success: false,
            message: 'Failed to reset prompts'
        });
    }
});

module.exports = router;
