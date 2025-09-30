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
        
        const { course, weeks, lecturesPerWeek, contentTypes } = req.body;
        
        // Use authenticated user's ID
        const instructorId = user.userId;
        
        // Validate required fields
        if (!course || !weeks || !lecturesPerWeek) {
            return res.status(400).json({
                success: false,
                message: 'Missing required fields: course, weeks, lecturesPerWeek'
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
        // Get authenticated user information
        const user = req.user;
        if (!user) {
            return res.status(401).json({
                success: false,
                message: 'Authentication required'
            });
        }
        
        // Only instructors can access their courses
        if (user.role !== 'instructor') {
            return res.status(403).json({
                success: false,
                message: 'Only instructors can access courses'
            });
        }
        
        // Use authenticated user's ID
        const instructorId = user.userId;
        
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
 * Get course details (for instructors)
 */
router.get('/:courseId', async (req, res) => {
    try {
        const { courseId } = req.params;
        
        // Get authenticated user information
        const user = req.user;
        if (!user) {
            return res.status(401).json({
                success: false,
                message: 'Authentication required'
            });
        }
        
        // Use authenticated user's ID
        const instructorId = user.userId;
        
        // Check if user is instructor or student
        if (user.role === 'student') {
            console.log(`Student request for course: ${courseId}`);
            return await getCourseForStudent(req, res, courseId);
        }
        
        console.log(`Instructor request for course: ${courseId}, instructor: ${instructorId}`);
        
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
            isAdditiveRetrieval: !!course.isAdditiveRetrieval,
            instructorId: course.instructorId,
            createdAt: course.createdAt?.toISOString() || new Date().toISOString(),
            status: course.status || 'active',
            documentCount: course.lectures?.reduce((total, lecture) => total + (lecture.documents?.length || 0), 0) || 0,
            studentCount: 0, // TODO: Implement student tracking
            // Include lectures array that instructors expect (with documents)
            lectures: course.lectures?.map(lecture => ({
                id: lecture.id || lecture.name,
                name: lecture.name,
                isPublished: lecture.isPublished || false,
                documents: lecture.documents || [],
                questions: lecture.questions || []
            })) || [],
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
 * Helper function to get course data for students
 * @param {Object} req - Express request object
 * @param {Object} res - Express response object
 * @param {string} courseId - Course ID
 */
async function getCourseForStudent(req, res, courseId) {
    try {
        console.log(`Getting course data for student: ${courseId}`);
        
        // Get database instance from app.locals
        const db = req.app.locals.db;
        if (!db) {
            return res.status(503).json({
                success: false,
                message: 'Database connection not available'
            });
        }
        
        // Query database for course details (any instructor)
        const collection = db.collection('courses');
        const course = await collection.findOne({ courseId });
        
        if (!course) {
            console.log(`Course not found: ${courseId}`);
            return res.status(404).json({
                success: false,
                message: 'Course not found'
            });
        }
        
        console.log(`Course found: ${courseId}, lectures count: ${course.lectures?.length || 0}`);
        console.log('Raw course data from DB:', JSON.stringify(course, null, 2));
        console.log('Course lectures structure:', course.lectures);
        
        // Transform the data to include lectures array that students expect
        const transformedCourse = {
            id: course.courseId,
            name: course.courseName,
            weeks: course.courseStructure?.weeks || 0,
            lecturesPerWeek: course.courseStructure?.lecturesPerWeek || 0,
            isAdditiveRetrieval: !!course.isAdditiveRetrieval,
            createdAt: course.createdAt?.toISOString() || new Date().toISOString(),
            status: course.status || 'active',
            // Include lectures array that students expect
            lectures: course.lectures?.map(lecture => ({
                id: lecture.id || lecture.name,
                name: lecture.name,
                isPublished: lecture.isPublished || false,
                documents: lecture.documents || [],
                questions: lecture.questions || []
            })) || [],
            // Keep structure for compatibility
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
        
        console.log(`Transformed course data:`, {
            courseId: transformedCourse.id,
            name: transformedCourse.name,
            lecturesCount: transformedCourse.lectures.length,
            publishedLectures: transformedCourse.lectures.filter(l => l.isPublished).length,
            lecturesDetails: transformedCourse.lectures.map(l => ({ name: l.name, isPublished: l.isPublished, hasDocuments: l.documents.length > 0, hasQuestions: l.questions.length > 0 }))
        });
        console.log('Full transformed course data:', JSON.stringify(transformedCourse, null, 2));
        
        res.json({
            success: true,
            data: transformedCourse
        });
        
    } catch (error) {
        console.error('Error fetching course for student:', error);
        res.status(500).json({
            success: false,
            message: 'Internal server error'
        });
    }
}

/**
 * PUT /api/courses/:courseId
 * Update course details
 */
router.put('/:courseId', async (req, res) => {
    try {
        const { courseId } = req.params;
        const { name, weeks, lecturesPerWeek, status, isAdditiveRetrieval } = req.body;
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
        if (typeof isAdditiveRetrieval === 'boolean') updateData.isAdditiveRetrieval = isAdditiveRetrieval;
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
 * PUT /api/courses/:courseId/retrieval-mode
 * Update the course's additive retrieval setting (instructor-only)
 */
router.put('/:courseId/retrieval-mode', async (req, res) => {
    try {
        const { courseId } = req.params;
        const { isAdditiveRetrieval } = req.body;
        
        // Validate body
        if (typeof isAdditiveRetrieval !== 'boolean') {
            return res.status(400).json({
                success: false,
                message: 'isAdditiveRetrieval must be a boolean'
            });
        }
        
        // Auth check
        const user = req.user;
        if (!user) {
            return res.status(401).json({ success: false, message: 'Authentication required' });
        }
        if (user.role !== 'instructor') {
            return res.status(403).json({ success: false, message: 'Only instructors can update retrieval mode' });
        }
        
        // Get DB
        const db = req.app.locals.db;
        if (!db) {
            return res.status(503).json({ success: false, message: 'Database connection not available' });
        }
        
        // Update course owned by instructor
        const collection = db.collection('courses');
        const result = await collection.updateOne(
            { courseId, instructorId: user.userId },
            { $set: { isAdditiveRetrieval, updatedAt: new Date() } }
        );
        
        if (result.matchedCount === 0) {
            return res.status(404).json({ success: false, message: 'Course not found' });
        }
        
        res.json({ success: true, message: 'Retrieval mode updated', data: { courseId, isAdditiveRetrieval } });
    } catch (error) {
        console.error('Error updating retrieval mode:', error);
        res.status(500).json({ success: false, message: 'Internal server error' });
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

/**
 * POST /api/courses/:courseId/clear-documents
 * Clear all documents from a specific unit in the course structure
 */
router.post('/:courseId/clear-documents', async (req, res) => {
    try {
        const { courseId } = req.params;
        const { unitName, instructorId } = req.body;
        
        if (!unitName || !instructorId) {
            return res.status(400).json({
                success: false,
                message: 'Missing required fields: unitName, instructorId'
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
        
        // Get the courses collection
        const coursesCollection = db.collection('courses');
        
        // Clear all documents from the specified unit
        const result = await coursesCollection.updateOne(
            { 
                courseId: courseId,
                'lectures.name': unitName 
            },
            { 
                $set: { 
                    'lectures.$.documents': [],
                    'lectures.$.updatedAt': new Date(),
                    updatedAt: new Date()
                }
            }
        );
        
        console.log(`Cleared all documents from unit ${unitName} in course ${courseId}, modified: ${result.modifiedCount}`);
        
        res.json({
            success: true,
            message: `All documents cleared from ${unitName}`,
            data: {
                unitName,
                clearedCount: result.modifiedCount
            }
        });
        
    } catch (error) {
        console.error('Error clearing documents from unit:', error);
        res.status(500).json({
            success: false,
            message: 'Internal server error while clearing documents'
        });
    }
});

/**
 * POST /api/courses/course-materials/confirm
 * Confirm course materials for a specific unit/week
 * This marks the unit as having all required materials confirmed
 */
router.post('/course-materials/confirm', async (req, res) => {
    console.log('🔧 [BACKEND] Course materials confirm endpoint hit!');
    console.log('🔧 [BACKEND] Request body:', req.body);
    
    try {
        const { week, instructorId } = req.body;
        
        console.log('🔧 [BACKEND] Extracted data:', { week, instructorId });
        
        // Validate required fields
        if (!week || !instructorId) {
            console.log('❌ [BACKEND] Missing required fields');
            return res.status(400).json({
                success: false,
                message: 'Missing required fields: week, instructorId'
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
        
        // Get the courses collection
        const coursesCollection = db.collection('courses');
        
        // Find the course that contains this unit/week
        const course = await coursesCollection.findOne({
            instructorId: instructorId,
            'lectures.name': week
        });
        
        if (!course) {
            return res.status(404).json({
                success: false,
                message: `Course not found for instructor ${instructorId} with unit ${week}`
            });
        }
        
        // Update the unit to mark materials as confirmed
        const result = await coursesCollection.updateOne(
            { 
                courseId: course.courseId,
                'lectures.name': week 
            },
            { 
                $set: { 
                    'lectures.$.materialsConfirmed': true,
                    'lectures.$.materialsConfirmedAt': new Date(),
                    'lectures.$.updatedAt': new Date(),
                    updatedAt: new Date()
                }
            }
        );
        
        if (result.modifiedCount === 0) {
            return res.status(404).json({
                success: false,
                message: `Unit ${week} not found in course ${course.courseId}`
            });
        }
        
        console.log(`Course materials confirmed for unit ${week} in course ${course.courseId}`);
        
        res.json({
            success: true,
            message: `Course materials for ${week} confirmed successfully!`,
            data: {
                week,
                courseId: course.courseId,
                materialsConfirmed: true,
                confirmedAt: new Date().toISOString()
            }
        });
        
    } catch (error) {
        console.error('Error confirming course materials:', error);
        res.status(500).json({
            success: false,
            message: 'Internal server error while confirming course materials'
        });
    }
});

/**
 * GET /api/courses/available/all
 * Get all available courses for both students and instructors
 * This endpoint provides a unified way to get course information
 */
router.get('/available/all', async (req, res) => {
    try {
        // Get database instance from app.locals
        const db = req.app.locals.db;
        if (!db) {
            return res.status(503).json({
                success: false,
                message: 'Database connection not available'
            });
        }
        
        // Query database for all active courses
        const collection = db.collection('courses');
        const courses = await collection.find({ status: { $ne: 'deleted' } }).toArray();
        
        // Transform the data to match expected format for both sides
        const transformedCourses = courses.map(course => ({
            courseId: course.courseId,
            courseName: course.courseName || course.courseId,
            instructorId: course.instructorId,
            status: course.status || 'active',
            createdAt: course.createdAt?.toISOString() || new Date().toISOString()
        }));
        
        console.log(`Retrieved ${transformedCourses.length} available courses`);
        
        res.json({
            success: true,
            data: transformedCourses
        });
        
    } catch (error) {
        console.error('Error fetching available courses:', error);
        res.status(500).json({
            success: false,
            message: 'Internal server error while fetching available courses'
        });
    }
});

module.exports = router; 