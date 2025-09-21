/**
 * Onboarding Routes
 * Handles API endpoints for onboarding data management
 */

const express = require('express');
const router = express.Router();
const CourseModel = require('../models/Course');

/**
 * GET /api/onboarding/test
 * Test endpoint to verify onboarding routes are working
 */
router.get('/test', (req, res) => {
    res.json({
        success: true,
        message: 'Onboarding routes are working!',
        timestamp: new Date().toISOString()
    });
});

/**
 * POST /api/onboarding
 * Create or update onboarding data for a course
 */
router.post('/', async (req, res) => {
    // Get authenticated user information
    const user = req.user;
    if (!user) {
        return res.status(401).json({
            success: false,
            message: 'Authentication required'
        });
    }
    
    // Only instructors can create courses
    if (user.role !== 'instructor') {
        return res.status(403).json({
            success: false,
            message: 'Only instructors can create courses'
        });
    }
    
    const {
        courseId,
        courseName,
        courseDescription,
        learningOutcomes,
        assessmentCriteria,
        courseMaterials,
        unitFiles,
        courseStructure
    } = req.body;
    
    // Use authenticated user's ID
    const instructorId = user.userId;
    
    // Validate required fields
    if (!courseId || !courseName) {
        return res.status(400).json({
            success: false,
            message: 'Missing required fields: courseId, courseName'
        });
    }
    
    try {
        // Get database instance from app.locals
        const db = req.app.locals.db;
        if (!db) {
            return res.status(503).json({
                success: false,
                message: 'Database connection not available'
            });
        }
        
        // Prepare onboarding data
        const onboardingData = {
            courseId,
            courseName,
            instructorId,
            courseDescription: courseDescription || '',
            learningOutcomes: learningOutcomes || [],
            assessmentCriteria: assessmentCriteria || '',
            courseMaterials: courseMaterials || [],
            unitFiles: unitFiles || {},
            courseStructure: courseStructure || {}
        };
        
        // Save to database using Course model
        const result = await CourseModel.createCourseFromOnboarding(db, onboardingData);
        
        console.log(`Course ${result.created ? 'created' : 'updated'} from onboarding for course ${courseId}`);
        
        res.json({
            success: true,
            message: `Course ${result.created ? 'created' : 'updated'} successfully from onboarding`,
            data: {
                courseId,
                created: result.created,
                modifiedCount: result.modifiedCount,
                totalUnits: result.totalUnits,
                timestamp: new Date().toISOString()
            }
        });
        
    } catch (error) {
        console.error('Error saving onboarding data:', error);
        res.status(500).json({
            success: false,
            message: 'Internal server error while saving onboarding data'
        });
    }
});

/**
 * GET /api/onboarding/:courseId
 * Get onboarding data for a specific course
 */
router.get('/:courseId', async (req, res) => {
    const { courseId } = req.params;
    
    if (!courseId) {
        return res.status(400).json({
            success: false,
            message: 'Missing required parameter: courseId'
        });
    }
    
    try {
        // Get database instance from app.locals
        const db = req.app.locals.db;
        if (!db) {
            return res.status(503).json({
                success: false,
                message: 'Database connection not available'
            });
        }
        
        // Fetch course data
        const courseData = await CourseModel.getCourseWithOnboarding(db, courseId);
        
        if (!courseData) {
            return res.status(404).json({
                success: false,
                message: 'Course not found'
            });
        }
        
        res.json({
            success: true,
            data: courseData
        });
        
    } catch (error) {
        console.error('Error fetching onboarding data:', error);
        res.status(500).json({
            success: false,
            message: 'Internal server error while fetching onboarding data'
        });
    }
});

/**
 * GET /api/onboarding/instructor/:instructorId
 * Get all onboarding data for an instructor
 */
router.get('/instructor/:instructorId', async (req, res) => {
    const { instructorId } = req.params;
    
    if (!instructorId) {
        return res.status(400).json({
            success: false,
            message: 'Missing required parameter: instructorId'
        });
    }
    
    try {
        // Get database instance from app.locals
        const db = req.app.locals.db;
        if (!db) {
            return res.status(503).json({
                success: false,
                message: 'Database connection not available'
            });
        }
        
        // Fetch courses for instructor
        const collection = db.collection('courses');
        const courses = await collection.find({ instructorId }).toArray();
        
        res.json({
            success: true,
            data: {
                courses: courses,
                count: courses.length
            }
        });
        
    } catch (error) {
        console.error('Error fetching instructor onboarding data:', error);
        res.status(500).json({
            success: false,
            message: 'Internal server error while fetching instructor onboarding data'
        });
    }
});

/**
 * PUT /api/onboarding/:courseId/unit-files
 * Update unit files for a specific unit
 */
router.put('/:courseId/unit-files', async (req, res) => {
    const { courseId } = req.params;
    const { unitName, files } = req.body;
    
    if (!courseId || !unitName || !Array.isArray(files)) {
        return res.status(400).json({
            success: false,
            message: 'Missing required fields: courseId, unitName, files (array)'
        });
    }
    
    try {
        // Get database instance from app.locals
        const db = req.app.locals.db;
        if (!db) {
            return res.status(503).json({
                success: false,
                message: 'Database connection not available'
            });
        }
        
        // Update unit files in the course
        const collection = db.collection('courses');
        const result = await collection.updateOne(
            { 
                courseId,
                'lectures.name': unitName 
            },
            {
                $set: {
                    [`lectures.$.unitFiles`]: files,
                    'lectures.$.updatedAt': new Date(),
                    updatedAt: new Date()
                }
            }
        );
        
        console.log(`Unit files updated for ${courseId} - ${unitName}`);
        
        res.json({
            success: true,
            message: `Unit files updated for ${unitName}`,
            data: {
                courseId,
                unitName,
                filesCount: files.length,
                modifiedCount: result.modifiedCount,
                timestamp: new Date().toISOString()
            }
        });
        
    } catch (error) {
        console.error('Error updating unit files:', error);
        res.status(500).json({
            success: false,
            message: 'Internal server error while updating unit files'
        });
    }
});

/**
 * PUT /api/onboarding/:courseId
 * Update specific onboarding fields
 */
router.put('/:courseId', async (req, res) => {
    const { courseId } = req.params;
    const updates = req.body;
    
    if (!courseId || !updates || Object.keys(updates).length === 0) {
        return res.status(400).json({
            success: false,
            message: 'Missing required parameter: courseId or update data'
        });
    }
    
    try {
        // Get database instance from app.locals
        const db = req.app.locals.db;
        if (!db) {
            return res.status(503).json({
                success: false,
                message: 'Database connection not available'
            });
        }
        
        // Update course fields
        const collection = db.collection('courses');
        const result = await collection.updateOne(
            { courseId },
            {
                $set: {
                    ...updates,
                    updatedAt: new Date()
                }
            }
        );
        
        console.log(`Course fields updated for course ${courseId}`);
        
        res.json({
            success: true,
            message: 'Course fields updated successfully',
            data: {
                courseId,
                modifiedCount: result.modifiedCount,
                timestamp: new Date().toISOString()
            }
        });
        
    } catch (error) {
        console.error('Error updating onboarding fields:', error);
        res.status(500).json({
            success: false,
            message: 'Internal server error while updating onboarding fields'
        });
    }
});

/**
 * DELETE /api/onboarding/:courseId
 * Delete onboarding data for a course
 */
router.delete('/:courseId', async (req, res) => {
    const { courseId } = req.params;
    
    if (!courseId) {
        return res.status(400).json({
            success: false,
            message: 'Missing required parameter: courseId'
        });
    }
    
    try {
        // Get database instance from app.locals
        const db = req.app.locals.db;
        if (!db) {
            return res.status(503).json({
                success: false,
                message: 'Database connection not available'
            });
        }
        
        // Delete course data
        const collection = db.collection('courses');
        const result = await collection.deleteOne({ courseId });
        
        console.log(`Course deleted for course ${courseId}`);
        
        res.json({
            success: true,
            message: 'Course deleted successfully',
            data: {
                courseId,
                deletedCount: result.deletedCount,
                timestamp: new Date().toISOString()
            }
        });
        
    } catch (error) {
        console.error('Error deleting onboarding data:', error);
        res.status(500).json({
            success: false,
            message: 'Internal server error while deleting onboarding data'
        });
    }
});

/**
 * DELETE /api/onboarding/:courseId/unit/:unitName
 * Delete a unit from a course
 */
router.delete('/:courseId/unit/:unitName', async (req, res) => {
    const { courseId, unitName } = req.params;
    
    if (!courseId || !unitName) {
        return res.status(400).json({
            success: false,
            message: 'Missing required parameters: courseId, unitName'
        });
    }
    
    try {
        // Get database instance from app.locals
        const db = req.app.locals.db;
        if (!db) {
            return res.status(503).json({
                success: false,
                message: 'Database connection not available'
            });
        }
        
        // Delete the unit
        const result = await CourseModel.deleteUnit(db, courseId, unitName);
        
        res.json({
            success: true,
            message: `Unit ${unitName} deleted successfully`,
            data: result
        });
        
    } catch (error) {
        console.error('Error deleting unit:', error);
        res.status(500).json({
            success: false,
            message: 'Internal server error while deleting unit'
        });
    }
});

/**
 * GET /api/onboarding/stats
 * Get onboarding statistics
 */
router.get('/stats', async (req, res) => {
    try {
        // Get database instance from app.locals
        const db = req.app.locals.db;
        if (!db) {
            return res.status(503).json({
                success: false,
                message: 'Database connection not available'
                });
        }
        
        // Get course statistics (since we're now using courses instead of onboarding)
        const collection = db.collection('courses');
        const totalCourses = await collection.countDocuments();
        const totalInstructors = await collection.distinct('instructorId');
        
        const stats = {
            totalCourses,
            totalInstructors: totalInstructors.length,
            lastUpdated: new Date().toISOString()
        };
        
        res.json({
            success: true,
            data: stats
        });
        
    } catch (error) {
        console.error('Error fetching course stats:', error);
        res.status(500).json({
            success: false,
            message: 'Internal server error while fetching course stats'
        });
    }
});

module.exports = router;
