/**
 * Flags API Routes
 * Handles student flag submissions for bot responses
 */

const express = require('express');
const router = express.Router();

// Middleware to parse JSON bodies
router.use(express.json());

/**
 * POST /api/flags
 * Submit a flag for a bot response
 */
router.post('/', async (req, res) => {
    try {
        const { messageText, flagType, timestamp, studentId } = req.body;
        
        // Validate required fields
        if (!messageText || !flagType || !timestamp || !studentId) {
            return res.status(400).json({
                success: false,
                message: 'Missing required fields: messageText, flagType, timestamp, studentId'
            });
        }
        
        // Validate flag type
        const validFlagTypes = ['incorrectness', 'inappropriate', 'irrelevant'];
        if (!validFlagTypes.includes(flagType)) {
            return res.status(400).json({
                success: false,
                message: 'Invalid flag type. Must be one of: incorrectness, inappropriate, irrelevant'
            });
        }
        
        // TODO: In a real implementation, this would:
        // 1. Validate student permissions
        // 2. Store flag in database
        // 3. Notify instructors if needed
        // 4. Log for analytics
        
        // For now, return a mock success response
        const flagData = {
            id: `flag-${Date.now()}`,
            messageText: messageText,
            flagType: flagType,
            timestamp: timestamp,
            studentId: studentId,
            status: 'pending',
            createdAt: new Date().toISOString()
        };
        
        console.log('Flag submitted:', flagData);
        
        res.status(201).json({
            success: true,
            message: 'Flag submitted successfully',
            data: flagData
        });
        
    } catch (error) {
        console.error('Error submitting flag:', error);
        res.status(500).json({
            success: false,
            message: 'Internal server error'
        });
    }
});

/**
 * GET /api/flags
 * Get flags for an instructor (for dashboard)
 */
router.get('/', async (req, res) => {
    try {
        const instructorId = req.query.instructorId;
        const status = req.query.status || 'pending';
        
        if (!instructorId) {
            return res.status(400).json({
                success: false,
                message: 'instructorId is required'
            });
        }
        
        // TODO: In a real implementation, this would:
        // 1. Validate instructor permissions
        // 2. Query database for flags in instructor's courses
        // 3. Return filtered flags
        
        // Mock response for now
        const mockFlags = [
            {
                id: 'flag-1',
                messageText: 'The cell is the basic unit of life, and all living organisms are composed of one or more cells.',
                flagType: 'incorrectness',
                timestamp: '2024-01-15T10:30:00Z',
                studentId: 'student-123',
                status: 'pending',
                createdAt: '2024-01-15T10:30:00Z',
                courseId: 'course-1',
                courseName: 'Biology 302'
            },
            {
                id: 'flag-2',
                messageText: 'Photosynthesis is the process by which plants convert light energy into chemical energy.',
                flagType: 'irrelevant',
                timestamp: '2024-01-15T11:15:00Z',
                studentId: 'student-456',
                status: 'pending',
                createdAt: '2024-01-15T11:15:00Z',
                courseId: 'course-1',
                courseName: 'Biology 302'
            }
        ];
        
        res.json({
            success: true,
            data: mockFlags
        });
        
    } catch (error) {
        console.error('Error fetching flags:', error);
        res.status(500).json({
            success: false,
            message: 'Internal server error'
        });
    }
});

/**
 * PUT /api/flags/:flagId
 * Update flag status (approve/reject)
 */
router.put('/:flagId', async (req, res) => {
    try {
        const { flagId } = req.params;
        const { status, instructorComment } = req.body;
        const instructorId = req.query.instructorId;
        
        if (!instructorId) {
            return res.status(400).json({
                success: false,
                message: 'instructorId is required'
            });
        }
        
        if (!status || !['approved', 'rejected', 'pending'].includes(status)) {
            return res.status(400).json({
                success: false,
                message: 'Valid status is required: approved, rejected, or pending'
            });
        }
        
        // TODO: In a real implementation, this would:
        // 1. Validate instructor permissions for this flag
        // 2. Update flag status in database
        // 3. Notify student if needed
        // 4. Log the action
        
        console.log('Flag updated:', { flagId, status, instructorComment, instructorId });
        
        res.json({
            success: true,
            message: 'Flag status updated successfully'
        });
        
    } catch (error) {
        console.error('Error updating flag:', error);
        res.status(500).json({
            success: false,
            message: 'Internal server error'
        });
    }
});

/**
 * GET /api/flags/stats
 * Get flag statistics for dashboard
 */
router.get('/stats', async (req, res) => {
    try {
        const instructorId = req.query.instructorId;
        
        if (!instructorId) {
            return res.status(400).json({
                success: false,
                message: 'instructorId is required'
            });
        }
        
        // TODO: In a real implementation, this would:
        // 1. Query database for flag statistics
        // 2. Return aggregated data
        
        // Mock response for now
        const mockStats = {
            totalFlags: 15,
            pendingFlags: 8,
            approvedFlags: 4,
            rejectedFlags: 3,
            flagsByType: {
                incorrectness: 7,
                inappropriate: 3,
                irrelevant: 5
            },
            flagsToday: 3
        };
        
        res.json({
            success: true,
            data: mockStats
        });
        
    } catch (error) {
        console.error('Error fetching flag stats:', error);
        res.status(500).json({
            success: false,
            message: 'Internal server error'
        });
    }
});

module.exports = router; 