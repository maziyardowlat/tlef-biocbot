const express = require('express');
const router = express.Router();

// Import the Course model instead of Question model
const CourseModel = require('../models/Course');

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
        
        // Create question in the course structure using Course model
        const result = await CourseModel.updateAssessmentQuestions(
            db, 
            courseId, 
            lectureName, 
            questionData, 
            instructorId
        );
        
        if (!result.success) {
            return res.status(400).json({
                success: false,
                message: result.error || 'Failed to create question'
            });
        }
        
        console.log(`Question created for ${lectureName} by instructor ${instructorId}`);
        
        res.json({
            success: true,
            message: 'Question created successfully!',
            data: {
                questionId: result.questionId,
                question: questionData.question,
                questionType: questionData.questionType,
                createdAt: new Date().toISOString(),
                created: result.created
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
        
        // Fetch questions from the course structure using Course model
        const questions = await CourseModel.getAssessmentQuestions(db, courseId, lectureName);
        
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
 * Get a specific question by ID (search across all courses)
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
        
        // Search for the question across all courses
        const collection = db.collection('courses');
        const course = await collection.findOne({
            'lectures.assessmentQuestions.questionId': questionId
        });
        
        if (!course) {
            return res.status(404).json({
                success: false,
                message: 'Question not found'
            });
        }
        
        // Find the specific question
        let foundQuestion = null;
        for (const lecture of course.lectures || []) {
            if (lecture.assessmentQuestions) {
                foundQuestion = lecture.assessmentQuestions.find(q => q.questionId === questionId);
                if (foundQuestion) break;
            }
        }
        
        if (!foundQuestion) {
            return res.status(404).json({
                success: false,
                message: 'Question not found'
            });
        }
        
        res.json({
            success: true,
            data: foundQuestion
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
        const { courseId, lectureName, instructorId } = req.body;
        
        if (!questionId || !courseId || !lectureName || !instructorId) {
            return res.status(400).json({
                success: false,
                message: 'Missing required fields: questionId, courseId, lectureName, instructorId'
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
        
        // Prepare the updated question data
        const questionData = {
            ...updateData,
            questionId: questionId
        };
        
        // Update question in the course structure using Course model
        const result = await CourseModel.updateAssessmentQuestions(
            db, 
            courseId, 
            lectureName, 
            questionData, 
            instructorId
        );
        
        if (!result.success) {
            return res.status(400).json({
                success: false,
                message: result.error || 'Failed to update question'
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
 * Delete a question (remove from course structure)
 */
router.delete('/:questionId', async (req, res) => {
    try {
        const { questionId } = req.params;
        const { instructorId, courseId, lectureName } = req.body;
        
        if (!questionId || !instructorId || !courseId || !lectureName) {
            return res.status(400).json({
                success: false,
                message: 'Missing required fields: questionId, instructorId, courseId, lectureName'
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
        
        // Delete the question from the course structure using Course model
        const result = await CourseModel.deleteAssessmentQuestion(
            db, 
            courseId, 
            lectureName, 
            questionId, 
            instructorId
        );
        
        if (!result.success) {
            return res.status(400).json({
                success: false,
                message: result.error || 'Failed to delete question'
            });
        }
        
        console.log(`Question deleted: ${questionId} by instructor ${instructorId}`);
        
        res.json({
            success: true,
            message: 'Question deleted successfully!',
            data: {
                questionId,
                deletedCount: result.deletedCount
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
        
        // Get course data to calculate statistics
        const collection = db.collection('courses');
        const course = await collection.findOne({ courseId });
        
        if (!course || !course.lectures) {
            return res.json({
                success: true,
                data: {
                    courseId,
                    totalQuestions: 0,
                    totalPoints: 0,
                    typeBreakdown: []
                }
            });
        }
        
        // Calculate statistics from the course structure
        let totalQuestions = 0;
        let totalPoints = 0;
        const typeBreakdown = {};
        
        for (const lecture of course.lectures) {
            if (lecture.assessmentQuestions) {
                for (const question of lecture.assessmentQuestions) {
                    totalQuestions++;
                    totalPoints += question.points || 1;
                    
                    const type = question.questionType;
                    if (!typeBreakdown[type]) {
                        typeBreakdown[type] = { count: 0, points: 0 };
                    }
                    typeBreakdown[type].count++;
                    typeBreakdown[type].points += question.points || 1;
                }
            }
        }
        
        const stats = {
            totalQuestions,
            totalPoints,
            typeBreakdown: Object.entries(typeBreakdown).map(([type, data]) => ({
                type,
                count: data.count,
                points: data.points
            }))
        };
        
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
        
        let insertedCount = 0;
        const insertedIds = [];
        
        // Create each question individually using the Course model
        for (const question of questions) {
            const questionData = {
                ...question,
                metadata: {
                    source: 'ai-generated',
                    aiGenerated: true,
                    reviewStatus: 'draft',
                    ...question.metadata
                }
            };
            
            const result = await CourseModel.updateAssessmentQuestions(
                db, 
                courseId, 
                lectureName, 
                questionData, 
                instructorId
            );
            
            if (result.success) {
                insertedCount++;
                insertedIds.push(result.questionId);
            }
        }
        
        console.log(`Bulk created ${insertedCount} questions for ${lectureName}`);
        
        res.json({
            success: true,
            message: `${insertedCount} questions created successfully!`,
            data: {
                courseId,
                lectureName,
                insertedCount,
                insertedIds
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
