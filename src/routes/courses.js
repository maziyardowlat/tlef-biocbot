/**
 * Courses API Routes
 * Handles course creation, management, and instructor operations
 */

const express = require('express');
const router = express.Router();

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
        
        // TODO: In a real implementation, this would:
        // 1. Validate instructor permissions
        // 2. Check if course already exists for this instructor
        // 3. Create course in database
        // 4. Set up initial course structure with weeks
        // 5. Create folder structure based on content types
        
        // For now, return a mock success response
        const courseData = {
            id: `course-${Date.now()}`,
            name: course,
            weeks: parseInt(weeks),
            lecturesPerWeek: parseInt(lecturesPerWeek),
            contentTypes: contentTypes || [],
            instructorId: instructorId,
            createdAt: new Date().toISOString(),
            status: 'active',
            structure: generateCourseStructure(weeks, lecturesPerWeek, contentTypes)
        };
        
        console.log('Course created:', courseData);
        
        res.status(201).json({
            success: true,
            message: 'Course created successfully',
            data: courseData
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
        
        // TODO: In a real implementation, this would:
        // 1. Validate instructor permissions
        // 2. Query database for instructor's courses
        // 3. Return course list with metadata
        
        // Mock response for now
        const mockCourses = [
            {
                id: 'course-1',
                name: 'BIOC 202',
                weeks: 16,
                lecturesPerWeek: 2,
                instructorId: instructorId,
                createdAt: '2024-01-15T10:00:00Z',
                status: 'active',
                documentCount: 15,
                studentCount: 45
            },
            {
                id: 'course-2',
                name: 'BIOC 303',
                weeks: 12,
                lecturesPerWeek: 3,
                instructorId: instructorId,
                createdAt: '2024-01-20T14:30:00Z',
                status: 'active',
                documentCount: 8,
                studentCount: 32
            }
        ];
        
        res.json({
            success: true,
            data: mockCourses
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
        
        // TODO: In a real implementation, this would:
        // 1. Validate instructor permissions for this course
        // 2. Query database for course details
        // 3. Return course with full metadata
        
        // Mock response for now
        const mockCourse = {
            id: courseId,
            name: 'BIOC 202',
            weeks: 16,
            lecturesPerWeek: 2,
            instructorId: instructorId,
            createdAt: '2024-01-15T10:00:00Z',
            status: 'active',
            documentCount: 15,
            studentCount: 45,
            structure: {
                weeks: [
                    { id: 'week-1', name: 'Week 1', lectures: 2, documents: 3 },
                    { id: 'week-2', name: 'Week 2', lectures: 2, documents: 4 },
                    { id: 'week-3', name: 'Week 3', lectures: 2, documents: 2 }
                ],
                specialFolders: [
                    { id: 'syllabus', name: 'Syllabus & Schedule', type: 'syllabus' },
                    { id: 'quizzes', name: 'Practice Quizzes', type: 'quiz' }
                ]
            }
        };
        
        res.json({
            success: true,
            data: mockCourse
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
        
        // TODO: In a real implementation, this would:
        // 1. Validate instructor permissions for this course
        // 2. Update course in database
        // 3. Return updated course data
        
        console.log('Course updated:', { courseId, name, weeks, lecturesPerWeek, status, instructorId });
        
        res.json({
            success: true,
            message: 'Course updated successfully'
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
        
        // TODO: In a real implementation, this would:
        // 1. Validate instructor permissions for this course
        // 2. Soft delete course (set status to 'deleted')
        // 3. Archive associated documents
        
        console.log('Course deleted:', { courseId, instructorId });
        
        res.json({
            success: true,
            message: 'Course deleted successfully'
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