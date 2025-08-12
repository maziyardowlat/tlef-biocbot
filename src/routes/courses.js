/**
 * Courses API Routes
 * Handles course creation, management, and instructor operations
 */

const express = require('express');
const router = express.Router();
const CourseModel = require('../models/Course');

// Middleware to parse JSON bodies
router.use(express.json());

/**
 * POST /api/courses
 * Create a new course for an instructor (updated for onboarding)
 */
router.post('/', async (req, res) => {
    try {
        const { course, weeks, lecturesPerWeek, contentTypes, instructorId } = req.body;
        
        // Validate required fields
        if (!course || !weeks || !lecturesPerWeek || !instructorId) {
            return res.status(400).json({
                success: false,
                message: 'Missing required fields: course, weeks, lecturesPerWeek, instructorId'
            });
        }
        
        // Validate weeks is a positive number
        if (isNaN(weeks) || weeks < 1 || weeks > 20) {
            return res.status(400).json({
                success: false,
                message: 'Weeks must be a number between 1 and 20'
            });
        }
        
        // Validate lectures per week
        if (isNaN(lecturesPerWeek) || lecturesPerWeek < 1 || lecturesPerWeek > 5) {
            return res.status(400).json({
                success: false,
                message: 'Lectures per week must be a number between 1 and 5'
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
        
        // Generate course ID
        const courseId = `${course.replace(/\s+/g, '-').toLowerCase()}-${Date.now()}`;
        
        // Create course structure
        const courseStructure = {
            weeks: parseInt(weeks),
            lecturesPerWeek: parseInt(lecturesPerWeek),
            totalUnits: weeks * lecturesPerWeek
        };
        
        // Prepare onboarding data for course creation
        const onboardingData = {
            courseId,
            courseName: course,
            instructorId,
            courseDescription: `Course: ${course}`,
            learningOutcomes: [],
            prerequisites: [],
            assessmentCriteria: '',
            courseMaterials: contentTypes || [],
            unitFiles: {},
            courseStructure
        };
        
        // Create course in database using Course model
        const result = await CourseModel.createCourseFromOnboarding(db, onboardingData);
        
        if (!result.success) {
            return res.status(500).json({
                success: false,
                message: 'Failed to create course in database'
            });
        }
        
        console.log('Course created in database:', { courseId, course, instructorId });
        
        res.status(201).json({
            success: true,
            message: 'Course created successfully',
            data: {
                id: courseId,
                name: course,
                weeks: parseInt(weeks),
                lecturesPerWeek: parseInt(lecturesPerWeek),
                contentTypes: contentTypes || [],
                instructorId: instructorId,
                createdAt: new Date().toISOString(),
                status: 'active',
                structure: generateCourseStructure(weeks, lecturesPerWeek, contentTypes),
                totalUnits: result.totalUnits
            }
        });
        
    } catch (error) {
        console.error('Error creating course:', error);
        res.status(500).json({
            success: false,
            message: 'Internal server error'
        });
    }
});

/**
 * Generate course structure based on weeks and content types
 */
function generateCourseStructure(weeks, lecturesPerWeek, contentTypes) {
    const structure = {
        weeks: [],
        specialFolders: []
    };
    
    // Generate week folders
    for (let week = 1; week <= weeks; week++) {
        structure.weeks.push({
            id: `week-${week}`,
            name: `Week ${week}`,
            lectures: lecturesPerWeek,
            documents: []
        });
    }
    
    // Generate special folders based on content types
    if (contentTypes.includes('syllabus')) {
        structure.specialFolders.push({
            id: 'syllabus',
            name: 'Syllabus & Schedule',
            type: 'syllabus'
        });
    }
    
    if (contentTypes.includes('practice-quizzes')) {
        structure.specialFolders.push({
            id: 'quizzes',
            name: 'Practice Quizzes',
            type: 'quiz'
        });
    }
    
    if (contentTypes.includes('readings')) {
        structure.specialFolders.push({
            id: 'readings',
            name: 'Required Readings',
            type: 'reading'
        });
    }
    
    return structure;
}

/**
 * POST /api/courses/:courseId/content
 * Upload content to a specific course
 */
router.post('/:courseId/content', async (req, res) => {
    try {
        const { courseId } = req.params;
        const { title, description, week, type, instructorId } = req.body;
        
        // Validate required fields
        if (!title || !week || !type || !instructorId) {
            return res.status(400).json({
                success: false,
                message: 'Missing required fields: title, week, type, instructorId'
            });
        }
        
        // TODO: In a real implementation, this would:
        // 1. Validate instructor permissions for this course
        // 2. Handle file upload (multipart/form-data)
        // 3. Process document (parse, chunk, embed)
        // 4. Store in database and vector store
        // 5. Update course structure
        
        const contentData = {
            id: `content-${Date.now()}`,
            courseId: courseId,
            title: title,
            description: description || '',
            week: parseInt(week),
            type: type,
            instructorId: instructorId,
            uploadedAt: new Date().toISOString(),
            status: 'processing',
            fileSize: req.body.fileSize || 0,
            fileName: req.body.fileName || ''
        };
        
        console.log('Content uploaded:', contentData);
        
        res.status(201).json({
            success: true,
            message: 'Content uploaded successfully',
            data: contentData
        });
        
    } catch (error) {
        console.error('Error uploading content:', error);
        res.status(500).json({
            success: false,
            message: 'Internal server error'
        });
    }
});

/**
 * GET /api/courses
 * Get all courses for an instructor
 */
router.get('/', async (req, res) => {
    try {
        const instructorId = req.query.instructorId;
        
        if (!instructorId) {
            return res.status(400).json({
                success: false,
                message: 'instructorId is required'
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
        
        // Query database for instructor's courses
        const collection = db.collection('courses');
        const courses = await collection.find({ instructorId }).toArray();
        
        // Transform the data to match expected format
        const transformedCourses = courses.map(course => ({
            id: course.courseId,
            name: course.courseName,
            weeks: course.courseStructure?.weeks || 0,
            lecturesPerWeek: course.courseStructure?.lecturesPerWeek || 0,
            instructorId: course.instructorId,
            createdAt: course.createdAt?.toISOString() || new Date().toISOString(),
            status: course.status || 'active',
            documentCount: course.lectures?.reduce((total, lecture) => total + (lecture.documents?.length || 0), 0) || 0,
            studentCount: 0, // TODO: Implement student tracking
            totalUnits: course.courseStructure?.totalUnits || 0
        }));
        
        res.json({
            success: true,
            data: transformedCourses
        });
        
    } catch (error) {
        console.error('Error fetching courses:', error);
        res.status(500).json({
            success: false,
            message: 'Internal server error'
        });
    }
});

/**
 * GET /api/courses/:courseId
 * Get specific course details
 */
router.get('/:courseId', async (req, res) => {
    try {
        const { courseId } = req.params;
        const instructorId = req.query.instructorId;
        
        if (!instructorId) {
            return res.status(400).json({
                success: false,
                message: 'instructorId is required'
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
        
        // Query database for course details
        const collection = db.collection('courses');
        const course = await collection.findOne({ courseId, instructorId });
        
        if (!course) {
            return res.status(404).json({
                success: false,
                message: 'Course not found'
            });
        }
        
        // Transform the data to match expected format
        const transformedCourse = {
            id: course.courseId,
            name: course.courseName,
            weeks: course.courseStructure?.weeks || 0,
            lecturesPerWeek: course.courseStructure?.lecturesPerWeek || 0,
            instructorId: course.instructorId,
            createdAt: course.createdAt?.toISOString() || new Date().toISOString(),
            status: course.status || 'active',
            documentCount: course.lectures?.reduce((total, lecture) => total + (lecture.documents?.length || 0), 0) || 0,
            studentCount: 0, // TODO: Implement student tracking
            structure: {
                weeks: course.lectures?.map((lecture, index) => ({
                    id: `week-${Math.floor(index / (course.courseStructure?.lecturesPerWeek || 1)) + 1}`,
                    name: `Week ${Math.floor(index / (course.courseStructure?.lecturesPerWeek || 1)) + 1}`,
                    lectures: course.courseStructure?.lecturesPerWeek || 0,
                    documents: lecture.documents?.length || 0
                })) || [],
                specialFolders: [
                    { id: 'syllabus', name: 'Syllabus & Schedule', type: 'syllabus' },
                    { id: 'quizzes', name: 'Practice Quizzes', type: 'quiz' }
                ]
            }
        };
        
        res.json({
            success: true,
            data: transformedCourse
        });
        
    } catch (error) {
        console.error('Error fetching course:', error);
        res.status(500).json({
            success: false,
            message: 'Internal server error'
        });
    }
});

/**
 * PUT /api/courses/:courseId
 * Update course details
 */
router.put('/:courseId', async (req, res) => {
    try {
        const { courseId } = req.params;
        const { name, weeks, lecturesPerWeek, status } = req.body;
        const instructorId = req.query.instructorId;
        
        if (!instructorId) {
            return res.status(400).json({
                success: false,
                message: 'instructorId is required'
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
        
        // Update course in database
        const collection = db.collection('courses');
        const updateData = {
            updatedAt: new Date()
        };
        
        if (name) updateData.courseName = name;
        if (status) updateData.status = status;
        if (weeks || lecturesPerWeek) {
            updateData.courseStructure = {
                weeks: weeks || 0,
                lecturesPerWeek: lecturesPerWeek || 0,
                totalUnits: (weeks || 0) * (lecturesPerWeek || 0)
            };
        }
        
        const result = await collection.updateOne(
            { courseId, instructorId },
            { $set: updateData }
        );
        
        if (result.matchedCount === 0) {
            return res.status(404).json({
                success: false,
                message: 'Course not found'
            });
        }
        
        console.log('Course updated in database:', { courseId, name, weeks, lecturesPerWeek, status, instructorId });
        
        res.json({
            success: true,
            message: 'Course updated successfully',
            modifiedCount: result.modifiedCount
        });
        
    } catch (error) {
        console.error('Error updating course:', error);
        res.status(500).json({
            success: false,
            message: 'Internal server error'
        });
    }
});

/**
 * DELETE /api/courses/:courseId
 * Delete a course (soft delete)
 */
router.delete('/:courseId', async (req, res) => {
    try {
        const { courseId } = req.params;
        const instructorId = req.query.instructorId;
        
        if (!instructorId) {
            return res.status(400).json({
                success: false,
                message: 'instructorId is required'
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
        
        // Soft delete course (set status to 'deleted')
        const collection = db.collection('courses');
        const result = await collection.updateOne(
            { courseId, instructorId },
            { 
                $set: { 
                    status: 'deleted',
                    updatedAt: new Date()
                } 
            }
        );
        
        if (result.matchedCount === 0) {
            return res.status(404).json({
                success: false,
                message: 'Course not found'
            });
        }
        
        console.log('Course soft deleted:', { courseId, instructorId });
        
        res.json({
            success: true,
            message: 'Course deleted successfully',
            modifiedCount: result.modifiedCount
        });
        
    } catch (error) {
        console.error('Error deleting course:', error);
        res.status(500).json({
            success: false,
            message: 'Internal server error'
        });
    }
});

module.exports = router; 