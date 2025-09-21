/**
 * Flagged Questions API Routes
 * Handles student flags on questions and instructor responses
 */

const express = require('express');
const router = express.Router();

// Import the FlaggedQuestion model
const FlaggedQuestionModel = require('../models/FlaggedQuestion');

// Middleware for JSON parsing
router.use(express.json());

/**
 * POST /api/flags
 * Create a new flagged question (student flags a question)
 */
router.post('/', async (req, res) => {
    try {
        const {
            questionId,
            courseId,
            unitName,
            flagReason,
            flagDescription,
            questionContent
        } = req.body;
        
        // Get authenticated user information
        const user = req.user;
        if (!user) {
            return res.status(401).json({
                success: false,
                message: 'Authentication required'
            });
        }
        
        // Only students can flag questions
        if (user.role !== 'student') {
            return res.status(403).json({
                success: false,
                message: 'Only students can flag questions'
            });
        }
        
        // Validate required fields
        if (!questionId || !courseId || !unitName || !flagReason || !flagDescription) {
            return res.status(400).json({
                success: false,
                message: 'Missing required fields: questionId, courseId, unitName, flagReason, flagDescription'
            });
        }
        
        // Get database instance from app.locals
        const db = req.app.locals.db;
        if (!db) {
            return res.status(503).json({
                success: false,
                message: 'Database connection not available'
            });
        }
        
        // Create the flagged question with authenticated user info
        const result = await FlaggedQuestionModel.createFlaggedQuestion(db, {
            questionId,
            courseId,
            unitName,
            studentId: user.userId,
            studentName: user.displayName || user.username,
            flagReason,
            flagDescription,
            questionContent
        });
        
        if (!result.success) {
            return res.status(400).json({
                success: false,
                message: result.error || 'Failed to create flagged question'
            });
        }
        
        console.log(`Flagged question created by student ${user.userId} for question ${questionId}`);
        
        res.json({
            success: true,
            message: 'Question flagged successfully!',
            data: {
                flagId: result.flagId,
                createdAt: new Date().toISOString()
            }
        });
        
    } catch (error) {
        console.error('Error creating flagged question:', error);
        res.status(500).json({
            success: false,
            message: 'Internal server error while creating flagged question'
        });
    }
});

/**
 * GET /api/flags/course/:courseId
 * Get all flagged questions for a specific course
 */
router.get('/course/:courseId', async (req, res) => {
    try {
        const { courseId } = req.params;
        const { status } = req.query; // Optional status filter
        
        if (!courseId) {
            return res.status(400).json({
                success: false,
                message: 'Missing required parameter: courseId'
            });
        }
        
        // Get database instance from app.locals
        const db = req.app.locals.db;
        if (!db) {
            return res.status(503).json({
                success: false,
                message: 'Database connection not available'
            });
        }
        
        // Get flagged questions for the course
        const flags = await FlaggedQuestionModel.getFlaggedQuestionsForCourse(db, courseId, status);
        
        console.log(`Retrieved ${flags.length} flagged questions for course ${courseId}`);
        
        res.json({
            success: true,
            data: {
                courseId,
                flags,
                count: flags.length
            }
        });
        
    } catch (error) {
        console.error('Error retrieving flagged questions:', error);
        res.status(500).json({
            success: false,
            message: 'Internal server error while retrieving flagged questions'
        });
    }
});

/**
 * GET /api/flags/status/:status
 * Get flagged questions by status
 */
router.get('/status/:status', async (req, res) => {
    try {
        const { status } = req.params;
        
        if (!status) {
            return res.status(400).json({
                success: false,
                message: 'Missing required parameter: status'
            });
        }
        
        // Get database instance from app.locals
        const db = req.app.locals.db;
        if (!db) {
            return res.status(503).json({
                success: false,
                message: 'Database connection not available'
            });
        }
        
        // Get flagged questions by status
        const flags = await FlaggedQuestionModel.getFlaggedQuestionsByStatus(db, status);
        
        console.log(`Retrieved ${flags.length} flagged questions with status ${status}`);
        
        res.json({
            success: true,
            data: {
                status,
                flags,
                count: flags.length
            }
        });
        
    } catch (error) {
        console.error('Error retrieving flagged questions by status:', error);
        res.status(500).json({
            success: false,
            message: 'Internal server error while retrieving flagged questions'
        });
    }
});

/**
 * GET /api/flags/:flagId
 * Get a specific flagged question by ID
 */
router.get('/:flagId', async (req, res) => {
    try {
        const { flagId } = req.params;
        
        if (!flagId) {
            return res.status(400).json({
                success: false,
                message: 'Missing required parameter: flagId'
            });
        }
        
        // Get database instance from app.locals
        const db = req.app.locals.db;
        if (!db) {
            return res.status(503).json({
                success: false,
                message: 'Database connection not available'
            });
        }
        
        // Get the flagged question
        const flag = await FlaggedQuestionModel.getFlaggedQuestionById(db, flagId);
        
        if (!flag) {
            return res.status(404).json({
                success: false,
                message: 'Flagged question not found'
            });
        }
        
        console.log(`Retrieved flagged question: ${flagId}`);
        
        res.json({
            success: true,
            data: flag
        });
        
    } catch (error) {
        console.error('Error retrieving flagged question:', error);
        res.status(500).json({
            success: false,
            message: 'Internal server error while retrieving flagged question'
        });
    }
});

/**
 * PUT /api/flags/:flagId/response
 * Update instructor response to a flagged question
 */
router.put('/:flagId/response', async (req, res) => {
    try {
        const { flagId } = req.params;
        const {
            response,
            flagStatus
        } = req.body;
        
        // Get authenticated user information
        const user = req.user;
        if (!user) {
            return res.status(401).json({
                success: false,
                message: 'Authentication required'
            });
        }
        
        // Only instructors can respond to flags
        if (user.role !== 'instructor') {
            return res.status(403).json({
                success: false,
                message: 'Only instructors can respond to flagged questions'
            });
        }
        
        if (!flagId || !response) {
            return res.status(400).json({
                success: false,
                message: 'Missing required fields: response'
            });
        }
        
        // Get database instance from app.locals
        const db = req.app.locals.db;
        if (!db) {
            return res.status(503).json({
                success: false,
                message: 'Database connection not available'
            });
        }
        
        // Update the instructor response with authenticated user info
        const result = await FlaggedQuestionModel.updateInstructorResponse(db, flagId, {
            response,
            instructorId: user.userId,
            instructorName: user.displayName || user.username,
            flagStatus
        });
        
        if (!result.success) {
            return res.status(400).json({
                success: false,
                message: result.error || 'Failed to update instructor response'
            });
        }
        
        console.log(`Instructor response updated for flag: ${flagId} by ${user.userId}`);
        
        res.json({
            success: true,
            message: 'Instructor response updated successfully!',
            data: {
                flagId,
                updatedAt: new Date().toISOString()
            }
        });
        
    } catch (error) {
        console.error('Error updating instructor response:', error);
        res.status(500).json({
            success: false,
            message: 'Internal server error while updating instructor response'
        });
    }
});

/**
 * PUT /api/flags/:flagId/status
 * Update flag status
 */
router.put('/:flagId/status', async (req, res) => {
    try {
        const { flagId } = req.params;
        const { status } = req.body;
        
        // Get authenticated user information
        const user = req.user;
        if (!user) {
            return res.status(401).json({
                success: false,
                message: 'Authentication required'
            });
        }
        
        // Only instructors can update flag status
        if (user.role !== 'instructor') {
            return res.status(403).json({
                success: false,
                message: 'Only instructors can update flag status'
            });
        }
        
        if (!flagId || !status) {
            return res.status(400).json({
                success: false,
                message: 'Missing required fields: status'
            });
        }
        
        // Get database instance from app.locals
        const db = req.app.locals.db;
        if (!db) {
            return res.status(503).json({
                success: false,
                message: 'Database connection not available'
            });
        }
        
        // Update the flag status with authenticated user info
        const result = await FlaggedQuestionModel.updateFlagStatus(db, flagId, status, user.userId);
        
        if (!result.success) {
            return res.status(400).json({
                success: false,
                message: result.error || 'Failed to update flag status'
            });
        }
        
        console.log(`Flag status updated to ${status} for flag: ${flagId} by ${user.userId}`);
        
        res.json({
            success: true,
            message: 'Flag status updated successfully!',
            data: {
                flagId,
                status,
                updatedAt: new Date().toISOString()
            }
        });
        
    } catch (error) {
        console.error('Error updating flag status:', error);
        res.status(500).json({
            success: false,
            message: 'Internal server error while updating flag status'
        });
    }
});

/**
 * GET /api/flags/stats/:courseId
 * Get flag statistics for a course
 */
router.get('/stats/:courseId', async (req, res) => {
    try {
        const { courseId } = req.params;
        
        if (!courseId) {
            return res.status(400).json({
                success: false,
                message: 'Missing required parameter: courseId'
            });
        }
        
        // Get database instance from app.locals
        const db = req.app.locals.db;
        if (!db) {
            return res.status(503).json({
                success: false,
                message: 'Database connection not available'
            });
        }
        
        // Get flag statistics
        const stats = await FlaggedQuestionModel.getFlagStatistics(db, courseId);
        
        console.log(`Retrieved flag statistics for course ${courseId}:`, stats);
        
        res.json({
            success: true,
            data: {
                courseId,
                statistics: stats
            }
        });
        
    } catch (error) {
        console.error('Error retrieving flag statistics:', error);
        res.status(500).json({
            success: false,
            message: 'Internal server error while retrieving flag statistics'
        });
    }
});

/**
 * DELETE /api/flags/:flagId
 * Delete a flagged question (for cleanup purposes)
 */
router.delete('/:flagId', async (req, res) => {
    try {
        const { flagId } = req.params;
        
        if (!flagId) {
            return res.status(400).json({
                success: false,
                message: 'Missing required parameter: flagId'
            });
        }
        
        // Get database instance from app.locals
        const db = req.app.locals.db;
        if (!db) {
            return res.status(503).json({
                success: false,
                message: 'Database connection not available'
            });
        }
        
        // Delete the flagged question
        const result = await FlaggedQuestionModel.deleteFlaggedQuestion(db, flagId);
        
        if (!result.success) {
            return res.status(400).json({
                success: false,
                message: result.error || 'Failed to delete flagged question'
            });
        }
        
        console.log(`Flagged question deleted: ${flagId}`);
        
        res.json({
            success: true,
            message: 'Flagged question deleted successfully!',
            data: {
                flagId,
                deletedCount: result.deletedCount
            }
        });
        
    } catch (error) {
        console.error('Error deleting flagged question:', error);
        res.status(500).json({
            success: false,
            message: 'Internal server error while deleting flagged question'
        });
    }
});

module.exports = router; 