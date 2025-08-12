const express = require('express');
const router = express.Router();

// Import the Question model
const QuestionModel = require('../models/Question');

// Middleware for JSON parsing
router.use(express.json());

/**
 * POST /api/questions
 * Create a new assessment question
 */
router.post('/', async (req, res) => {
    try {
        const { 
            courseId, 
            lectureName, 
            instructorId, 
            questionType, 
            question, 
            options, 
            correctAnswer, 
            explanation,
            difficulty,
            tags,
            points,
            metadata
        } = req.body;
        
        // Validate required fields
        if (!courseId || !lectureName || !instructorId || !questionType || !question || !correctAnswer) {
            return res.status(400).json({
                success: false,
                message: 'Missing required fields: courseId, lectureName, instructorId, questionType, question, correctAnswer'
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
        
        // Prepare question data
        const questionData = {
            courseId,
            lectureName,
            instructorId,
            questionType,
            question,
            options: options || {},
            correctAnswer,
            explanation: explanation || '',
            difficulty: difficulty || 'medium',
            tags: tags || [],
            points: points || 1,
            metadata: {
                source: 'manual',
                aiGenerated: false,
                reviewStatus: 'draft',
                ...metadata
            }
        };
        
        // Create question in MongoDB
        const result = await QuestionModel.createQuestion(db, questionData);
        
        console.log(`Question created for ${lectureName} by instructor ${instructorId}`);
        
        res.json({
            success: true,
            message: 'Question created successfully!',
            data: {
                questionId: result.questionId,
                question: result.question,
                questionType: result.questionType,
                createdAt: result.createdAt
            }
        });
        
    } catch (error) {
        console.error('Error creating question:', error);
        res.status(500).json({
            success: false,
            message: 'Internal server error while creating question',
            error: error.message
        });
    }
});

/**
 * GET /api/questions/lecture
 * Get all questions for a specific lecture/unit
 */
router.get('/lecture', async (req, res) => {
    try {
        const { courseId, lectureName } = req.query;
        
        if (!courseId || !lectureName) {
            return res.status(400).json({
                success: false,
                message: 'Missing required parameters: courseId, lectureName'
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
        
        // Fetch questions from MongoDB
        const questions = await QuestionModel.getQuestionsForLecture(db, courseId, lectureName);
        
        res.json({
            success: true,
            data: {
                courseId,
                lectureName,
                questions: questions,
                count: questions.length
            }
        });
        
    } catch (error) {
        console.error('Error fetching questions:', error);
        res.status(500).json({
            success: false,
            message: 'Internal server error while fetching questions'
        });
    }
});

/**
 * GET /api/questions/:questionId
 * Get a specific question by ID
 */
router.get('/:questionId', async (req, res) => {
    try {
        const { questionId } = req.params;
        
        if (!questionId) {
            return res.status(400).json({
                success: false,
                message: 'Missing required parameter: questionId'
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
        
        // Fetch question from MongoDB
        const question = await QuestionModel.getQuestionById(db, questionId);
        
        if (!question) {
            return res.status(404).json({
                success: false,
                message: 'Question not found'
            });
        }
        
        res.json({
            success: true,
            data: question
        });
        
    } catch (error) {
        console.error('Error fetching question:', error);
        res.status(500).json({
            success: false,
            message: 'Internal server error while fetching question'
        });
    }
});

/**
 * PUT /api/questions/:questionId
 * Update an existing question
 */
router.put('/:questionId', async (req, res) => {
    try {
        const { questionId } = req.params;
        const updateData = req.body;
        
        if (!questionId) {
            return res.status(400).json({
                success: false,
                message: 'Missing required parameter: questionId'
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
        
        // Update question in MongoDB
        const result = await QuestionModel.updateQuestion(db, questionId, updateData);
        
        if (result.matchedCount === 0) {
            return res.status(404).json({
                success: false,
                message: 'Question not found'
            });
        }
        
        console.log(`Question updated: ${questionId}`);
        
        res.json({
            success: true,
            message: 'Question updated successfully!',
            data: {
                questionId,
                updatedCount: result.modifiedCount
            }
        });
        
    } catch (error) {
        console.error('Error updating question:', error);
        res.status(500).json({
            success: false,
            message: 'Internal server error while updating question',
            error: error.message
        });
    }
});

/**
 * DELETE /api/questions/:questionId
 * Delete a question (soft delete)
 */
router.delete('/:questionId', async (req, res) => {
    try {
        const { questionId } = req.params;
        const { instructorId } = req.body;
        
        if (!questionId || !instructorId) {
            return res.status(400).json({
                success: false,
                message: 'Missing required fields: questionId, instructorId'
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
        
        // Verify the question exists and belongs to the instructor
        const question = await QuestionModel.getQuestionById(db, questionId);
        if (!question) {
            return res.status(404).json({
                success: false,
                message: 'Question not found'
            });
        }
        
        if (question.instructorId !== instructorId) {
            return res.status(403).json({
                success: false,
                message: 'You do not have permission to delete this question'
            });
        }
        
        // Soft delete the question
        const result = await QuestionModel.deleteQuestion(db, questionId);
        
        console.log(`Question deleted: ${questionId} by instructor ${instructorId}`);
        
        res.json({
            success: true,
            message: 'Question deleted successfully!',
            data: {
                questionId,
                deletedCount: result.modifiedCount
            }
        });
        
    } catch (error) {
        console.error('Error deleting question:', error);
        res.status(500).json({
            success: false,
            message: 'Internal server error while deleting question'
        });
    }
});

/**
 * GET /api/questions/stats
 * Get question statistics for a course
 */
router.get('/stats', async (req, res) => {
    try {
        const { courseId } = req.query;
        
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
        
        // Fetch question statistics from MongoDB
        const stats = await QuestionModel.getQuestionStats(db, courseId);
        
        res.json({
            success: true,
            data: {
                courseId,
                stats
            }
        });
        
    } catch (error) {
        console.error('Error fetching question stats:', error);
        res.status(500).json({
            success: false,
            message: 'Internal server error while fetching question stats'
        });
    }
});

/**
 * POST /api/questions/bulk
 * Bulk create questions (for AI-generated questions)
 */
router.post('/bulk', async (req, res) => {
    try {
        const { courseId, lectureName, instructorId, questions } = req.body;
        
        if (!courseId || !lectureName || !instructorId || !questions || !Array.isArray(questions)) {
            return res.status(400).json({
                success: false,
                message: 'Missing required fields: courseId, lectureName, instructorId, questions (array)'
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
        
        // Prepare questions data with course and lecture info
        const questionsData = questions.map(q => ({
            ...q,
            courseId,
            lectureName,
            instructorId,
            metadata: {
                source: 'ai-generated',
                aiGenerated: true,
                reviewStatus: 'draft',
                ...q.metadata
            }
        }));
        
        // Bulk create questions in MongoDB
        const result = await QuestionModel.bulkCreateQuestions(db, questionsData);
        
        console.log(`Bulk created ${result.insertedCount} questions for ${lectureName}`);
        
        res.json({
            success: true,
            message: `${result.insertedCount} questions created successfully!`,
            data: {
                courseId,
                lectureName,
                insertedCount: result.insertedCount,
                insertedIds: result.insertedIds
            }
        });
        
    } catch (error) {
        console.error('Error bulk creating questions:', error);
        res.status(500).json({
            success: false,
            message: 'Internal server error while bulk creating questions',
            error: error.message
        });
    }
});

module.exports = router;
