const express = require('express');
const router = express.Router();

// Middleware for JSON parsing
router.use(express.json());

/**
 * POST /api/mode-questions
 * Save mode calibration questions for an instructor
 */
router.post('/', (req, res) => {
    const { questions, threshold, instructorId } = req.body;
    
    // Validate required fields
    if (!questions || !Array.isArray(questions) || questions.length === 0) {
        return res.status(400).json({
            success: false,
            message: 'At least one question is required'
        });
    }
    
    if (typeof threshold !== 'number' || threshold < 50 || threshold > 90) {
        return res.status(400).json({
            success: false,
            message: 'Threshold must be between 50 and 90'
        });
    }
    
    if (!instructorId) {
        return res.status(400).json({
            success: false,
            message: 'Instructor ID is required'
        });
    }
    
    try {
        // Validate each question
        for (let i = 0; i < questions.length; i++) {
            const question = questions[i];
            
            if (!question.question || !question.question.trim()) {
                return res.status(400).json({
                    success: false,
                    message: `Question ${i + 1} cannot be empty`
                });
            }
            
            if (!question.options || !Array.isArray(question.options) || question.options.length !== 4) {
                return res.status(400).json({
                    success: false,
                    message: `Question ${i + 1} must have exactly 4 options`
                });
            }
            
            for (let j = 0; j < question.options.length; j++) {
                if (!question.options[j] || !question.options[j].trim()) {
                    return res.status(400).json({
                        success: false,
                        message: `Question ${i + 1}, Option ${j + 1} cannot be empty`
                    });
                }
            }
            
            if (typeof question.correctAnswer !== 'number' || question.correctAnswer < 0 || question.correctAnswer > 3) {
                return res.status(400).json({
                    success: false,
                    message: `Question ${i + 1} must have a valid correct answer (0-3)`
                });
            }
        }
        
        // In a real implementation, this would save to the database
        console.log(`Mode questions saved for instructor ${instructorId}:`, {
            questionsCount: questions.length,
            threshold,
            timestamp: new Date().toISOString()
        });
        
        res.json({
            success: true,
            message: 'Mode questions saved successfully',
            data: {
                questionsCount: questions.length,
                threshold,
                instructorId,
                savedAt: new Date().toISOString()
            }
        });
        
    } catch (error) {
        console.error('Error saving mode questions:', error);
        res.status(500).json({
            success: false,
            message: 'Internal server error while saving questions'
        });
    }
});

/**
 * GET /api/mode-questions
 * Get mode calibration questions for an instructor
 */
router.get('/', (req, res) => {
    const { instructorId } = req.query;
    
    if (!instructorId) {
        return res.status(400).json({
            success: false,
            message: 'Missing required parameter: instructorId'
        });
    }
    
    try {
        // In a real implementation, this would fetch from the database
        // Mock response with sample questions
        const mockQuestions = [
            {
                id: 1,
                question: "What is the primary function of enzymes in biochemical reactions?",
                options: [
                    "To slow down reactions",
                    "To speed up reactions",
                    "To change the direction of reactions",
                    "To prevent reactions from occurring"
                ],
                correctAnswer: 1
            },
            {
                id: 2,
                question: "Which of the following best describes the structure of an amino acid?",
                options: [
                    "A single carbon atom with various side chains",
                    "A central carbon atom with an amino group, carboxyl group, hydrogen, and R group",
                    "A chain of carbon atoms with oxygen at the end",
                    "A ring structure with nitrogen atoms"
                ],
                correctAnswer: 1
            },
            {
                id: 3,
                question: "What is the role of ATP in cellular processes?",
                options: [
                    "To provide structural support",
                    "To store and transfer energy",
                    "To act as a genetic material",
                    "To transport oxygen"
                ],
                correctAnswer: 1
            }
        ];
        
        res.json({
            success: true,
            data: {
                instructorId,
                questions: mockQuestions,
                threshold: 70,
                lastUpdated: new Date().toISOString()
            }
        });
        
    } catch (error) {
        console.error('Error fetching mode questions:', error);
        res.status(500).json({
            success: false,
            message: 'Internal server error while fetching questions'
        });
    }
});

/**
 * POST /api/mode-questions/calibrate
 * Calibrate a student's mode based on their answers
 */
router.post('/calibrate', (req, res) => {
    const { studentId, answers, instructorId } = req.body;
    
    if (!studentId || !answers || !Array.isArray(answers) || !instructorId) {
        return res.status(400).json({
            success: false,
            message: 'Missing required fields: studentId, answers, instructorId'
        });
    }
    
    try {
        // In a real implementation, this would:
        // 1. Fetch the instructor's questions and threshold
        // 2. Compare student answers with correct answers
        // 3. Calculate score percentage
        // 4. Determine mode based on threshold
        
        // Mock calculation
        const mockQuestions = [
            { correctAnswer: 1 },
            { correctAnswer: 1 },
            { correctAnswer: 1 }
        ];
        
        let correctAnswers = 0;
        for (let i = 0; i < answers.length && i < mockQuestions.length; i++) {
            if (answers[i] === mockQuestions[i].correctAnswer) {
                correctAnswers++;
            }
        }
        
        const score = (correctAnswers / mockQuestions.length) * 100;
        const threshold = 70; // In real implementation, fetch from database
        const mode = score >= threshold ? 'protege' : 'tutor';
        
        console.log(`Student ${studentId} calibrated: ${score}% -> ${mode} mode`);
        
        res.json({
            success: true,
            data: {
                studentId,
                score,
                threshold,
                mode,
                calibratedAt: new Date().toISOString()
            }
        });
        
    } catch (error) {
        console.error('Error calibrating student mode:', error);
        res.status(500).json({
            success: false,
            message: 'Internal server error while calibrating mode'
        });
    }
});

module.exports = router; 