/**
 * Courses API Routes
 * Handles course creation, management, and instructor operations
 */

const express = require('express');
const router = express.Router();
const CourseModel = require('../models/Course');
const UserModel = require('../models/User');

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
 * GET /api/courses/statistics
 * Get aggregated statistics for all instructor courses
 * NOTE: This route must come before /:courseId to avoid route matching issues
 */
router.get('/statistics', async (req, res) => {
    try {
        // Get authenticated user information
        const user = req.user;
        if (!user) {
            return res.status(401).json({
                success: false,
                message: 'Authentication required'
            });
        }
        
        // Only instructors can access statistics
        if (user.role !== 'instructor') {
            return res.status(403).json({
                success: false,
                message: 'Only instructors can access statistics'
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
        
        // Get courseId from query params if provided
        const { courseId: requestedCourseId } = req.query;
        
        // Get all courses for this instructor
        const coursesCollection = db.collection('courses');
        let coursesQuery = {
            $or: [
                { instructorId: user.userId },
                { instructors: user.userId }
            ]
        };
        
        // If a specific courseId is requested, filter to that course
        if (requestedCourseId) {
            coursesQuery.courseId = requestedCourseId;
        }
        
        const courses = await coursesCollection.find(coursesQuery).toArray();
        
        if (courses.length === 0) {
            return res.json({
                success: true,
                data: {
                    totalStudents: 0,
                    totalSessions: 0,
                    modeDistribution: { tutor: 0, protege: 0 },
                    averageSessionLength: 0,
                    averageMessagesPerSession: 0,
                    averageMessageLength: 0
                }
            });
        }
        
        const courseIds = courses.map(c => c.courseId);
        
        // Get all chat sessions for these courses
        const chatSessionsCollection = db.collection('chat_sessions');
        const allSessions = await chatSessionsCollection.find({
            courseId: { $in: courseIds },
            $or: [
                { isDeleted: { $exists: false } },
                { isDeleted: false }
            ]
        }).toArray();
        
        // Calculate statistics
        const uniqueStudents = new Set();
        let totalMessages = 0;
        let totalMessageLength = 0;
        let messageCount = 0;
        let modeDistribution = { tutor: 0, protege: 0 };
        let totalSessionDurationMs = 0;
        let sessionsWithDuration = 0;
        
        allSessions.forEach(session => {
            // Count unique students
            if (session.studentId) {
                uniqueStudents.add(session.studentId);
            }
            
            // Get mode from chatData
            if (session.chatData && session.chatData.metadata) {
                const mode = session.chatData.metadata.currentMode || 'tutor';
                if (mode === 'protege' || mode === 'protégé') {
                    modeDistribution.protege++;
                } else {
                    modeDistribution.tutor++;
                }
            } else {
                // Default to tutor if mode not found
                modeDistribution.tutor++;
            }
            
            // Calculate message statistics
            if (session.chatData && session.chatData.messages && Array.isArray(session.chatData.messages)) {
                const messages = session.chatData.messages;
                totalMessages += messages.length;
                
                messages.forEach(msg => {
                    if (msg.content && typeof msg.content === 'string') {
                        totalMessageLength += msg.content.length;
                        messageCount++;
                    }
                });
            }
            
            // Calculate session duration
            if (session.chatData && session.chatData.messages && session.chatData.messages.length > 0) {
                const messages = session.chatData.messages;
                const firstUserMessage = messages.find(msg => msg.type === 'user');
                const lastBotMessage = messages.slice().reverse().find(msg => msg.type === 'bot');
                
                if (firstUserMessage && lastBotMessage && firstUserMessage.timestamp && lastBotMessage.timestamp) {
                    const start = new Date(firstUserMessage.timestamp);
                    const end = new Date(lastBotMessage.timestamp);
                    const durationMs = end - start;
                    
                    if (durationMs > 0) {
                        totalSessionDurationMs += durationMs;
                        sessionsWithDuration++;
                    }
                }
            }
        });
        
        // Calculate averages
        const totalSessions = allSessions.length;
        const averageSessionLength = sessionsWithDuration > 0 
            ? Math.round(totalSessionDurationMs / sessionsWithDuration / 1000) // in seconds
            : 0;
        const averageMessagesPerSession = totalSessions > 0 
            ? Math.round((totalMessages / totalSessions) * 10) / 10 
            : 0;
        const averageMessageLength = messageCount > 0 
            ? Math.round(totalMessageLength / messageCount) 
            : 0;
        
        // Format average session length
        const formatDuration = (seconds) => {
            if (seconds < 60) {
                return `${seconds}s`;
            } else if (seconds < 3600) {
                const minutes = Math.floor(seconds / 60);
                const secs = seconds % 60;
                return `${minutes}m ${secs}s`;
            } else {
                const hours = Math.floor(seconds / 3600);
                const minutes = Math.floor((seconds % 3600) / 60);
                return `${hours}h ${minutes}m`;
            }
        };
        
        res.json({
            success: true,
            data: {
                totalStudents: uniqueStudents.size,
                totalSessions: totalSessions,
                modeDistribution: modeDistribution,
                averageSessionLength: formatDuration(averageSessionLength),
                averageSessionLengthSeconds: averageSessionLength,
                averageMessagesPerSession: averageMessagesPerSession,
                averageMessageLength: averageMessageLength
            }
        });
        
    } catch (error) {
        console.error('Error fetching statistics:', error);
        res.status(500).json({
            success: false,
            message: 'Internal server error while fetching statistics'
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
        
        console.log(`${user.role} request for course: ${courseId}, user: ${instructorId}`);
        
        // Get database instance from app.locals
        const db = req.app.locals.db;
        if (!db) {
            return res.status(503).json({
                success: false,
                message: 'Database connection not available'
            });
        }
        
        // Query database for course details (check instructorId, instructors array, and tas array)
        const collection = db.collection('courses');
        const course = await collection.findOne({
            courseId: courseId,
            $or: [
                { instructorId: instructorId },
                { instructors: { $in: [instructorId] } },
                { tas: { $in: [instructorId] } }
            ]
        });
        
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
            // Include lectures array that instructors expect (with documents, learning objectives, and assessment questions)
            lectures: course.lectures?.map(lecture => ({
                id: lecture.id || lecture.name,
                name: lecture.name,
                isPublished: lecture.isPublished || false,
                documents: lecture.documents || [],
                questions: lecture.questions || [],
                learningObjectives: lecture.learningObjectives || [],
                assessmentQuestions: lecture.assessmentQuestions || [],
                passThreshold: lecture.passThreshold
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
                questions: lecture.questions || [],
                passThreshold: lecture.passThreshold
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
        
        // Check if user has access to this course (either as main instructor or in instructors array)
        const collection = db.collection('courses');
        const course = await collection.findOne({ courseId });
        
        if (!course) {
            return res.status(404).json({ success: false, message: 'Course not found' });
        }
        
        // Check if user is the main instructor or in the instructors array
        const hasAccess = course.instructorId === user.userId || 
                         (Array.isArray(course.instructors) && course.instructors.includes(user.userId));
        
        if (!hasAccess) {
            return res.status(403).json({ 
                success: false, 
                message: 'You do not have access to update this course' 
            });
        }
        
        // Update course
        const result = await collection.updateOne(
            { courseId },
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
            instructors: course.instructors || [course.instructorId],
            tas: course.tas || [],
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

/**
 * POST /api/courses/:courseId/instructors
 * Add an instructor to a course
 */
router.post('/:courseId/instructors', async (req, res) => {
    try {
        const { courseId } = req.params;
        const { instructorId } = req.body;
        
        // Get authenticated user information
        const user = req.user;
        if (!user) {
            return res.status(401).json({
                success: false,
                message: 'Authentication required'
            });
        }
        
        // Only instructors can add other instructors
        if (user.role !== 'instructor') {
            return res.status(403).json({
                success: false,
                message: 'Only instructors can add other instructors to courses'
            });
        }
        
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
        
        // Add instructor to course using Course model
        const result = await CourseModel.addInstructorToCourse(db, courseId, instructorId);
        
        if (!result.success) {
            return res.status(400).json({
                success: false,
                message: result.error || 'Failed to add instructor to course'
            });
        }
        
        console.log(`Added instructor ${instructorId} to course ${courseId}`);
        
        res.json({
            success: true,
            message: 'Instructor added to course successfully',
            data: {
                courseId,
                instructorId,
                modifiedCount: result.modifiedCount
            }
        });
        
    } catch (error) {
        console.error('Error adding instructor to course:', error);
        res.status(500).json({
            success: false,
            message: 'Internal server error while adding instructor to course'
        });
    }
});

/**
 * POST /api/courses/:courseId/tas
 * Add a TA to a course
 */
router.post('/:courseId/tas', async (req, res) => {
    try {
        const { courseId } = req.params;
        const { taId } = req.body;
        
        // Get authenticated user information
        const user = req.user;
        if (!user) {
            return res.status(401).json({
                success: false,
                message: 'Authentication required'
            });
        }
        
        // Only instructors can add TAs
        if (user.role !== 'instructor') {
            return res.status(403).json({
                success: false,
                message: 'Only instructors can add TAs to courses'
            });
        }
        
        if (!taId) {
            return res.status(400).json({
                success: false,
                message: 'taId is required'
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
        
        // Add TA to course using Course model
        const result = await CourseModel.addTAToCourse(db, courseId, taId);
        
        if (!result.success) {
            return res.status(400).json({
                success: false,
                message: result.error || 'Failed to add TA to course'
            });
        }
        
        console.log(`Added TA ${taId} to course ${courseId}`);
        
        res.json({
            success: true,
            message: 'TA added to course successfully',
            data: {
                courseId,
                taId,
                modifiedCount: result.modifiedCount
            }
        });
        
    } catch (error) {
        console.error('Error adding TA to course:', error);
        res.status(500).json({
            success: false,
            message: 'Internal server error while adding TA to course'
        });
    }
});

/**
 * POST /api/courses/:courseId/join
 * Allow TAs to join courses themselves
 */
router.post('/:courseId/join', async (req, res) => {
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
        
        // Only TAs can join courses themselves
        if (user.role !== 'ta') {
            return res.status(403).json({
                success: false,
                message: 'Only TAs can join courses'
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
        
        // Check if course exists
        const course = await CourseModel.getCourseById(db, courseId);
        if (!course) {
            return res.status(404).json({
                success: false,
                message: 'Course not found'
            });
        }
        
        // Add TA to course using Course model
        const result = await CourseModel.addTAToCourse(db, courseId, user.userId);
        
        if (!result.success) {
            return res.status(400).json({
                success: false,
                message: result.error || 'Failed to join course'
            });
        }
        
        console.log(`TA ${user.userId} joined course ${courseId}`);
        
        res.json({
            success: true,
            message: 'Successfully joined course',
            data: {
                courseId,
                taId: user.userId,
                courseName: course.courseName,
                modifiedCount: result.modifiedCount
            }
        });
        
    } catch (error) {
        console.error('Error joining course:', error);
        res.status(500).json({
            success: false,
            message: 'Internal server error while joining course'
        });
    }
});

/**
 * GET /api/courses/ta/:taId
 * Get all courses for a specific TA
 */
router.get('/ta/:taId', async (req, res) => {
    try {
        const { taId } = req.params;
        
        // Get authenticated user information
        const user = req.user;
        if (!user) {
            return res.status(401).json({
                success: false,
                message: 'Authentication required'
            });
        }
        
        // Only TAs can access their own courses
        if (user.role !== 'ta' || user.userId !== taId) {
            return res.status(403).json({
                success: false,
                message: 'Access denied. You can only view your own courses.'
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
        
        // Get courses for TA using Course model
        const courses = await CourseModel.getCoursesForUser(db, taId, 'ta');
        
        // Transform the data to match expected format
        const transformedCourses = courses.map(course => ({
            courseId: course.courseId,
            courseName: course.courseName,
            instructorId: course.instructorId,
            instructors: course.instructors || [course.instructorId],
            tas: course.tas || [],
            createdAt: course.createdAt?.toISOString() || new Date().toISOString(),
            updatedAt: course.updatedAt?.toISOString() || new Date().toISOString(),
            totalUnits: course.courseStructure?.totalUnits || 0
        }));
        
        console.log(`Retrieved ${transformedCourses.length} courses for TA ${taId}`);
        
        res.json({
            success: true,
            data: transformedCourses
        });
        
    } catch (error) {
        console.error('Error fetching TA courses:', error);
        res.status(500).json({
            success: false,
            message: 'Internal server error while fetching TA courses'
        });
    }
});

/**
 * PUT /api/courses/:courseId/ta-permissions/:taId
 * Update TA permissions for a specific course
 */
router.put('/:courseId/ta-permissions/:taId', async (req, res) => {
    try {
        const { courseId, taId } = req.params;
        const { canAccessCourses, canAccessFlags } = req.body;
        
        // Get authenticated user information
        const user = req.user;
        if (!user) {
            return res.status(401).json({
                success: false,
                message: 'Authentication required'
            });
        }
        
        // Only instructors can manage TA permissions
        if (user.role !== 'instructor') {
            return res.status(403).json({
                success: false,
                message: 'Only instructors can manage TA permissions'
            });
        }
        
        // Validate required fields
        if (typeof canAccessCourses !== 'boolean' || typeof canAccessFlags !== 'boolean') {
            return res.status(400).json({
                success: false,
                message: 'canAccessCourses and canAccessFlags must be boolean values'
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
        
        // Check if instructor has access to this course
        const hasAccess = await CourseModel.userHasCourseAccess(db, courseId, user.userId, 'instructor');
        if (!hasAccess) {
            return res.status(403).json({
                success: false,
                message: 'Access denied. You can only manage permissions for your own courses.'
            });
        }
        
        // Update TA permissions
        const result = await CourseModel.updateTAPermissions(db, courseId, taId, {
            canAccessCourses,
            canAccessFlags
        });
        
        if (!result.success) {
            return res.status(400).json({
                success: false,
                message: result.error || 'Failed to update TA permissions'
            });
        }
        
        console.log(`Updated TA permissions for ${taId} in course ${courseId}`);
        
        res.json({
            success: true,
            message: 'TA permissions updated successfully',
            data: {
                courseId,
                taId,
                canAccessCourses,
                canAccessFlags,
                modifiedCount: result.modifiedCount
            }
        });
        
    } catch (error) {
        console.error('Error updating TA permissions:', error);
        res.status(500).json({
            success: false,
            message: 'Internal server error while updating TA permissions'
        });
    }
});

/**
 * GET /api/courses/:courseId/ta-permissions/:taId
 * Get TA permissions for a specific course
 */
router.get('/:courseId/ta-permissions/:taId', async (req, res) => {
    try {
        const { courseId, taId } = req.params;
        
        // Get authenticated user information
        const user = req.user;
        if (!user) {
            return res.status(401).json({
                success: false,
                message: 'Authentication required'
            });
        }
        
        // Allow instructors to view any TA's permissions, or TAs to view their own permissions
        if (user.role !== 'instructor' && (user.role !== 'ta' || user.userId !== taId)) {
            return res.status(403).json({
                success: false,
                message: 'Access denied. You can only view your own permissions or instructors can view any TA permissions.'
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
        
        // Check if user has access to this course
        // For instructors: check instructor access
        // For TAs: check TA access
        const userRole = user.role === 'instructor' ? 'instructor' : 'ta';
        const hasAccess = await CourseModel.userHasCourseAccess(db, courseId, user.userId, userRole);
        if (!hasAccess) {
            return res.status(403).json({
                success: false,
                message: 'Access denied. You can only view permissions for courses you have access to.'
            });
        }
        
        // Get TA permissions
        const result = await CourseModel.getTAPermissions(db, courseId, taId);
        
        if (!result.success) {
            return res.status(400).json({
                success: false,
                message: result.error || 'Failed to get TA permissions'
            });
        }
        
        res.json({
            success: true,
            data: {
                courseId,
                taId,
                permissions: result.permissions
            }
        });
        
    } catch (error) {
        console.error('Error getting TA permissions:', error);
        res.status(500).json({
            success: false,
            message: 'Internal server error while getting TA permissions'
        });
    }
});

/**
 * GET /api/courses/:courseId/ta-permissions
 * Get all TA permissions for a specific course
 */
router.get('/:courseId/ta-permissions', async (req, res) => {
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
        
        // Only instructors can view TA permissions
        if (user.role !== 'instructor') {
            return res.status(403).json({
                success: false,
                message: 'Only instructors can view TA permissions'
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
        
        // Check if instructor has access to this course
        const hasAccess = await CourseModel.userHasCourseAccess(db, courseId, user.userId, 'instructor');
        if (!hasAccess) {
            return res.status(403).json({
                success: false,
                message: 'Access denied. You can only view permissions for your own courses.'
            });
        }
        
        // Get course details
        const course = await CourseModel.getCourseById(db, courseId);
        if (!course) {
            return res.status(404).json({
                success: false,
                message: 'Course not found'
            });
        }
        
        // Get permissions for all TAs in the course
        const taPermissions = {};
        if (course.tas && course.tas.length > 0) {
            for (const taId of course.tas) {
                const result = await CourseModel.getTAPermissions(db, courseId, taId);
                if (result.success) {
                    taPermissions[taId] = result.permissions;
                }
            }
        }
        
        res.json({
            success: true,
            data: {
                courseId,
                taPermissions
            }
        });
        
    } catch (error) {
        console.error('Error getting all TA permissions:', error);
        res.status(500).json({
            success: false,
            message: 'Internal server error while getting TA permissions'
        });
    }
});

/**
 * GET /api/courses/:courseId/students
 * List students associated with a course with enrollment status
 */
router.get('/:courseId/students', async (req, res) => {
    try {
        const { courseId } = req.params;

        // Auth
        const user = req.user;
        if (!user) {
            return res.status(401).json({ success: false, message: 'Authentication required' });
        }
        if (user.role !== 'instructor') {
            return res.status(403).json({ success: false, message: 'Only instructors can view students' });
        }

        // DB
        const db = req.app.locals.db;
        if (!db) {
            return res.status(503).json({ success: false, message: 'Database connection not available' });
        }

        // Check instructor access to the course
        const hasAccess = await CourseModel.userHasCourseAccess(db, courseId, user.userId, 'instructor');
        if (!hasAccess) {
            return res.status(403).json({ success: false, message: 'Access denied. You can only view your own courses.' });
        }

        // Gather students by union of:
        // 1) Users with role student whose preferences.courseId == courseId
        // 2) Students who have chat sessions in this course
        // 3) Students appearing in course.studentEnrollment overrides
        const usersCol = db.collection('users');
        const chatCol = db.collection('chat_sessions');
        const coursesCol = db.collection('courses');

        const [prefStudents, chatStudents, courseDoc] = await Promise.all([
            usersCol.find({ role: 'student', 'preferences.courseId': courseId, isActive: true })
                .project({ userId: 1, username: 1, email: 1, displayName: 1, createdAt: 1, lastLogin: 1 })
                .toArray(),
            chatCol.distinct('studentId', { courseId }),
            coursesCol.findOne({ courseId }, { projection: { studentEnrollment: 1, courseName: 1 } })
        ]);

        const enrollmentMap = (courseDoc && courseDoc.studentEnrollment) || {};

        const chatStudentUsers = chatStudents.length > 0
            ? await usersCol.find({ userId: { $in: chatStudents }, role: 'student', isActive: true })
                .project({ userId: 1, username: 1, email: 1, displayName: 1, createdAt: 1, lastLogin: 1 })
                .toArray()
            : [];

        // Merge and unique by userId
        const byId = new Map();
        [...prefStudents, ...chatStudentUsers].forEach(s => {
            byId.set(s.userId, s);
        });

        // Also include any students present only in enrollmentMap (no profile fetched yet)
        for (const studentId of Object.keys(enrollmentMap)) {
            if (!byId.has(studentId)) {
                byId.set(studentId, {
                    userId: studentId,
                    username: studentId,
                    email: null,
                    displayName: studentId,
                    createdAt: null,
                    lastLogin: null
                });
            }
        }

        const students = Array.from(byId.values()).map(s => ({
            userId: s.userId,
            username: s.username,
            email: s.email,
            displayName: s.displayName,
            lastLogin: s.lastLogin,
            createdAt: s.createdAt,
            // Default enrolled=true if no override exists
            enrolled: enrollmentMap[s.userId] ? !!enrollmentMap[s.userId].enrolled : true
        }));

        // Sort by displayName
        students.sort((a, b) => (a.displayName || '').localeCompare(b.displayName || ''));

        return res.json({
            success: true,
            data: {
                courseId,
                courseName: courseDoc?.courseName || courseId,
                students,
                totalStudents: students.length
            }
        });
    } catch (error) {
        console.error('Error listing course students:', error);
        return res.status(500).json({ success: false, message: 'Internal server error while listing students' });
    }
});

/**
 * PUT /api/courses/:courseId/student-enrollment/:studentId
 * Update a student's enrollment (enrolled=true/false) for a course
 */
router.put('/:courseId/student-enrollment/:studentId', async (req, res) => {
    try {
        const { courseId, studentId } = req.params;
        const { enrolled } = req.body;

        // Validate
        if (typeof enrolled !== 'boolean') {
            return res.status(400).json({ success: false, message: 'enrolled must be a boolean' });
        }

        // Auth
        const user = req.user;
        if (!user) {
            return res.status(401).json({ success: false, message: 'Authentication required' });
        }
        if (user.role !== 'instructor') {
            return res.status(403).json({ success: false, message: 'Only instructors can update enrollment' });
        }

        // DB
        const db = req.app.locals.db;
        if (!db) {
            return res.status(503).json({ success: false, message: 'Database connection not available' });
        }

        // Access check
        const hasAccess = await CourseModel.userHasCourseAccess(db, courseId, user.userId, 'instructor');
        if (!hasAccess) {
            return res.status(403).json({ success: false, message: 'Access denied. You can only manage your own courses.' });
        }

        const result = await CourseModel.updateStudentEnrollment(db, courseId, studentId, enrolled);
        if (!result.success) {
            return res.status(400).json({ success: false, message: result.error || 'Failed to update enrollment' });
        }

        return res.json({
            success: true,
            message: 'Student enrollment updated successfully',
            data: { courseId, studentId, enrolled }
        });
    } catch (error) {
        console.error('Error updating student enrollment:', error);
        return res.status(500).json({ success: false, message: 'Internal server error while updating enrollment' });
    }
});

/**
 * GET /api/courses/:courseId/student-enrollment
 * Get current student's enrollment status for the course
 */
router.get('/:courseId/student-enrollment', async (req, res) => {
    try {
        const { courseId } = req.params;
        const user = req.user;
        if (!user) {
            return res.status(401).json({ success: false, message: 'Authentication required' });
        }
        if (user.role !== 'student') {
            return res.status(403).json({ success: false, message: 'Only students can view their enrollment' });
        }

        const db = req.app.locals.db;
        if (!db) {
            return res.status(503).json({ success: false, message: 'Database connection not available' });
        }

        const result = await CourseModel.getStudentEnrollment(db, courseId, user.userId);
        if (!result.success) {
            return res.status(404).json({ success: false, message: 'Course not found' });
        }

        return res.json({ success: true, data: { courseId, enrolled: result.enrolled } });
    } catch (error) {
        console.error('Error getting student enrollment:', error);
        return res.status(500).json({ success: false, message: 'Internal server error while getting enrollment' });
    }
});

module.exports = router; 