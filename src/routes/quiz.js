/**
 * Quiz Practice Routes
 * Student-facing API for the self-paced quiz practice page
 */

const express = require('express');
const router = express.Router();
const CourseModel = require('../models/Course');
const QuizAttempt = require('../models/QuizAttempt');
const DocumentModel = require('../models/Document');

router.use(express.json());

/**
 * GET /api/quiz/status
 * Lightweight check: is the quiz page enabled for this course?
 */
router.get('/status', async (req, res) => {
    try {
        const { courseId } = req.query;
        if (!courseId) {
            return res.status(400).json({ success: false, message: 'Missing courseId' });
        }

        const db = req.app.locals.db;
        if (!db) {
            return res.status(503).json({ success: false, message: 'Database connection not available' });
        }

        const settings = await CourseModel.getQuizSettings(db, courseId);
        res.json({ success: true, enabled: settings.enabled });
    } catch (error) {
        console.error('Error checking quiz status:', error);
        res.status(500).json({ success: false, message: 'Internal server error' });
    }
});

/**
 * GET /api/quiz/questions
 * Get all quiz-eligible questions for the student's course
 */
router.get('/questions', async (req, res) => {
    try {
        const { courseId } = req.query;
        if (!courseId) {
            return res.status(400).json({ success: false, message: 'Missing courseId' });
        }

        const db = req.app.locals.db;
        if (!db) {
            return res.status(503).json({ success: false, message: 'Database connection not available' });
        }

        // Check quiz settings
        const settings = await CourseModel.getQuizSettings(db, courseId);
        if (!settings.enabled) {
            return res.status(403).json({ success: false, message: 'Quiz practice is not enabled for this course' });
        }

        // getPublishedLectures returns an array of lecture name strings
        const publishedNames = await CourseModel.getPublishedLectures(db, courseId);
        if (!publishedNames || publishedNames.length === 0) {
            return res.json({ success: true, questions: [], units: [], allowLectureMaterialAccess: settings.allowLectureMaterialAccess });
        }

        // Get full course for display names
        const course = await CourseModel.getCourseWithOnboarding(db, courseId);
        const lecturesMap = {};
        if (course && course.lectures) {
            for (const lec of course.lectures) {
                lecturesMap[lec.name] = lec;
            }
        }

        // Filter to testable units only
        let testableNames;
        if (settings.testableUnits === 'all') {
            testableNames = publishedNames;
        } else {
            testableNames = publishedNames.filter(name => settings.testableUnits.includes(name));
        }

        // Gather questions from each testable unit
        const allQuestions = [];
        for (const unitName of testableNames) {
            const questions = await CourseModel.getAssessmentQuestions(db, courseId, unitName);
            if (questions && questions.length > 0) {
                for (const q of questions) {
                    if (q.isActive === false) continue; // skip soft-deleted

                    const sanitized = {
                        questionId: q.questionId,
                        lectureName: unitName,
                        questionType: q.questionType,
                        question: q.question,
                        options: q.options || {},
                        difficulty: q.difficulty || 'medium',
                        tags: q.tags || [],
                        points: q.points || 1
                    };

                    // MC/TF: include correctAnswer for client-side checking
                    if (q.questionType === 'multiple-choice' || q.questionType === 'true-false') {
                        sanitized.correctAnswer = q.correctAnswer;
                    }
                    // Short-answer: no correctAnswer sent (AI evaluates server-side)

                    allQuestions.push(sanitized);
                }
            }
        }

        // Build unit list with display names
        const units = testableNames.map(name => {
            const lecture = lecturesMap[name];
            return {
                name,
                displayName: lecture?.displayName || name
            };
        });

        res.json({
            success: true,
            questions: allQuestions,
            units,
            allowLectureMaterialAccess: settings.allowLectureMaterialAccess
        });
    } catch (error) {
        console.error('Error fetching quiz questions:', error);
        res.status(500).json({ success: false, message: 'Internal server error' });
    }
});

/**
 * POST /api/quiz/check-answer
 * AI evaluation for short-answer questions
 * Looks up the correct answer server-side so it's never exposed to the client
 */
router.post('/check-answer', async (req, res) => {
    try {
        const { courseId, questionId, lectureName, studentAnswer, studentName } = req.body;

        if (!courseId || !questionId || !lectureName || !studentAnswer) {
            return res.status(400).json({
                success: false,
                message: 'Missing required fields: courseId, questionId, lectureName, studentAnswer'
            });
        }

        const db = req.app.locals.db;
        if (!db) {
            return res.status(503).json({ success: false, message: 'Database connection not available' });
        }

        // Look up the question to get the correct answer server-side
        const questions = await CourseModel.getAssessmentQuestions(db, courseId, lectureName);
        const question = questions.find(q => q.questionId === questionId);
        if (!question) {
            return res.status(404).json({ success: false, message: 'Question not found' });
        }

        const llmService = req.app.locals.llm;
        if (!llmService) {
            return res.status(503).json({ success: false, message: 'LLM service not available' });
        }

        const result = await llmService.evaluateStudentAnswer(
            question.question,
            studentAnswer,
            question.correctAnswer,
            question.questionType,
            studentName || 'Student'
        );

        res.json({ success: true, data: result });
    } catch (error) {
        console.error('Error checking quiz answer:', error);
        res.status(500).json({ success: false, message: 'Internal server error while checking answer' });
    }
});

/**
 * POST /api/quiz/attempt
 * Record a quiz attempt
 */
router.post('/attempt', async (req, res) => {
    try {
        const { courseId, questionId, lectureName, questionType, studentAnswer, correct, feedback } = req.body;

        if (!courseId || !questionId || !lectureName || !questionType || studentAnswer === undefined || correct === undefined) {
            return res.status(400).json({ success: false, message: 'Missing required fields' });
        }

        const db = req.app.locals.db;
        if (!db) {
            return res.status(503).json({ success: false, message: 'Database connection not available' });
        }

        const studentId = req.user ? req.user.userId : null;
        if (!studentId) {
            return res.status(401).json({ success: false, message: 'User not authenticated' });
        }

        const result = await QuizAttempt.saveAttempt(db, {
            studentId,
            courseId,
            questionId,
            lectureName,
            questionType,
            studentAnswer: String(studentAnswer),
            correct: Boolean(correct),
            feedback: feedback || ''
        });

        res.json({ success: true, attemptId: result.attemptId });
    } catch (error) {
        console.error('Error recording quiz attempt:', error);
        res.status(500).json({ success: false, message: 'Internal server error' });
    }
});

/**
 * GET /api/quiz/history
 * Get student's quiz attempt stats
 */
router.get('/history', async (req, res) => {
    try {
        const { courseId } = req.query;
        if (!courseId) {
            return res.status(400).json({ success: false, message: 'Missing courseId' });
        }

        const db = req.app.locals.db;
        if (!db) {
            return res.status(503).json({ success: false, message: 'Database connection not available' });
        }

        const studentId = req.user ? req.user.userId : null;
        if (!studentId) {
            return res.status(401).json({ success: false, message: 'User not authenticated' });
        }

        const stats = await QuizAttempt.getAttemptStats(db, studentId, courseId);
        res.json({ success: true, stats });
    } catch (error) {
        console.error('Error fetching quiz history:', error);
        res.status(500).json({ success: false, message: 'Internal server error' });
    }
});

/**
 * GET /api/quiz/materials
 * Get documents for a unit (when student answers incorrectly)
 */
router.get('/materials', async (req, res) => {
    try {
        const { courseId, lectureName } = req.query;
        if (!courseId || !lectureName) {
            return res.status(400).json({ success: false, message: 'Missing courseId or lectureName' });
        }

        const db = req.app.locals.db;
        if (!db) {
            return res.status(503).json({ success: false, message: 'Database connection not available' });
        }

        // Check if material access is allowed
        const settings = await CourseModel.getQuizSettings(db, courseId);
        if (!settings.allowLectureMaterialAccess) {
            return res.status(403).json({ success: false, message: 'Lecture material access is not enabled' });
        }

        const documents = await DocumentModel.getDocumentsForLecture(db, courseId, lectureName);

        const materials = (documents || []).map(doc => ({
            documentId: doc.documentId,
            originalName: doc.originalName || doc.filename,
            mimeType: doc.mimeType,
            size: doc.size,
            documentType: doc.documentType
        }));

        res.json({ success: true, materials });
    } catch (error) {
        console.error('Error fetching quiz materials:', error);
        res.status(500).json({ success: false, message: 'Internal server error' });
    }
});

/**
 * GET /api/quiz/materials/:documentId/download
 * Download a specific document
 */
router.get('/materials/:documentId/download', async (req, res) => {
    try {
        const { documentId } = req.params;
        const { courseId } = req.query;

        if (!documentId || !courseId) {
            return res.status(400).json({ success: false, message: 'Missing documentId or courseId' });
        }

        const db = req.app.locals.db;
        if (!db) {
            return res.status(503).json({ success: false, message: 'Database connection not available' });
        }

        // Check if material access is allowed
        const settings = await CourseModel.getQuizSettings(db, courseId);
        if (!settings.allowLectureMaterialAccess) {
            return res.status(403).json({ success: false, message: 'Lecture material access is not enabled' });
        }

        const document = await DocumentModel.getDocumentById(db, documentId);
        if (!document) {
            return res.status(404).json({ success: false, message: 'Document not found' });
        }

        res.json({ success: true, data: document });
    } catch (error) {
        console.error('Error downloading quiz material:', error);
        res.status(500).json({ success: false, message: 'Internal server error' });
    }
});

module.exports = router;
