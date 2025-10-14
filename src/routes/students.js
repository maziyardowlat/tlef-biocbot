/**
 * Students API Routes
 * Handles student data and saved chat sessions for instructors
 */

const express = require('express');
const router = express.Router();

// Middleware to parse JSON bodies
router.use(express.json());

/**
 * Calculate duration from session data (first user message to last bot response)
 * @param {Object} session - The session object with chatData
 * @returns {string} Duration in human readable format
 */
function calculateDurationFromSessionData(session) {
    if (!session || !session.chatData || !session.chatData.messages || session.chatData.messages.length === 0) {
        return '0s';
    }
    
    const messages = session.chatData.messages;
    
    // Find the first user message (student message)
    const firstUserMessage = messages.find(msg => msg.type === 'user');
    if (!firstUserMessage || !firstUserMessage.timestamp) {
        return '0s';
    }
    
    // Find the last bot message
    const lastBotMessage = messages.slice().reverse().find(msg => msg.type === 'bot');
    if (!lastBotMessage || !lastBotMessage.timestamp) {
        // If no bot message found, use the last message
        const lastMessage = messages[messages.length - 1];
        if (!lastMessage || !lastMessage.timestamp) {
            return '0s';
        }
        const start = new Date(firstUserMessage.timestamp);
        const end = new Date(lastMessage.timestamp);
        const diffMs = end - start;
        
        const hours = Math.floor(diffMs / (1000 * 60 * 60));
        const minutes = Math.floor((diffMs % (1000 * 60 * 60)) / (1000 * 60));
        const seconds = Math.floor((diffMs % (1000 * 60)) / 1000);
        
        if (hours > 0) {
            return `${hours}h ${minutes}m ${seconds}s`;
        } else if (minutes > 0) {
            return `${minutes}m ${seconds}s`;
        } else {
            return `${seconds}s`;
        }
    }
    
    const start = new Date(firstUserMessage.timestamp);
    const end = new Date(lastBotMessage.timestamp);
    const diffMs = end - start;
    
    const hours = Math.floor(diffMs / (1000 * 60 * 60));
    const minutes = Math.floor((diffMs % (1000 * 60 * 60)) / (1000 * 60));
    const seconds = Math.floor((diffMs % (1000 * 60)) / 1000);
    
    if (hours > 0) {
        return `${hours}h ${minutes}m ${seconds}s`;
    } else if (minutes > 0) {
        return `${minutes}m ${seconds}s`;
    } else {
        return `${seconds}s`;
    }
}

/**
 * GET /api/students/:courseId
 * Get all students who have saved chat sessions for a specific course
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
        
        // Only instructors can access student data
        if (user.role !== 'instructor') {
            return res.status(403).json({
                success: false,
                message: 'Only instructors can access student data'
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
        
        // Verify the instructor has access to this course
        const coursesCollection = db.collection('courses');
        const course = await coursesCollection.findOne({ 
            courseId: courseId, 
            instructorId: user.userId 
        });
        
        if (!course) {
            return res.status(404).json({
                success: false,
                message: 'Course not found or access denied'
            });
        }
        
        // Get saved chat sessions for this course (excluding soft deleted)
        const chatSessionsCollection = db.collection('chat_sessions');
        const chatSessions = await chatSessionsCollection.find({ 
            courseId: courseId,
            $or: [
                { isDeleted: { $exists: false } }, // Legacy sessions without isDeleted field
                { isDeleted: false } // Non-deleted sessions
            ]
        }).sort({ savedAt: -1 }).toArray();
        
        // Group chat sessions by student
        const studentsMap = new Map();
        
        chatSessions.forEach(session => {
            
            const studentId = session.studentId;
            let studentName = session.studentName || 'Unknown Student';
            
            // If studentName is an object, try to extract the actual name
            if (typeof studentName === 'object' && studentName !== null) {
                studentName = studentName.displayName || 
                             studentName.name || 
                             studentName.studentName || 
                             'Unknown Student';
            }
            
            // Ensure studentName is a string
            if (typeof studentName !== 'string') {
                studentName = 'Unknown Student';
            }
            
            if (!studentsMap.has(studentId)) {
                studentsMap.set(studentId, {
                    studentId: studentId,
                    studentName: studentName,
                    courseId: courseId,
                    courseName: course.courseName,
                    totalSessions: 0,
                    lastActivity: null,
                    sessions: []
                });
            }
            
            const student = studentsMap.get(studentId);
            student.totalSessions++;
            // Recalculate duration from actual message timestamps
            const calculatedDuration = calculateDurationFromSessionData(session);
            
            student.sessions.push({
                sessionId: session.sessionId,
                title: session.title || `Chat Session ${student.totalSessions}`,
                unitName: session.unitName,
                savedAt: session.savedAt,
                messageCount: session.messageCount || 0,
                duration: calculatedDuration
            });
            
            // Update last activity
            if (!student.lastActivity || new Date(session.savedAt) > new Date(student.lastActivity)) {
                student.lastActivity = session.savedAt;
            }
        });
        
        // Convert map to array and sort by last activity
        const students = Array.from(studentsMap.values()).sort((a, b) => 
            new Date(b.lastActivity) - new Date(a.lastActivity)
        );
        
        console.log(`Retrieved ${students.length} students with saved chats for course ${courseId}`);
        
        res.json({
            success: true,
            data: {
                courseId: courseId,
                courseName: course.courseName,
                students: students,
                totalStudents: students.length,
                totalSessions: chatSessions.length
            }
        });
        
    } catch (error) {
        console.error('Error fetching students:', error);
        res.status(500).json({
            success: false,
            message: 'Internal server error while fetching students'
        });
    }
});

/**
 * GET /api/students/:courseId/:studentId/sessions/own
 * Get all saved chat sessions for a specific student in a course (student access)
 */
router.get('/:courseId/:studentId/sessions/own', async (req, res) => {
    try {
        console.log('🔍 [STUDENT_SESSIONS_OWN] Route hit!');
        console.log('🔍 [STUDENT_SESSIONS_OWN] Request path:', req.path);
        console.log('🔍 [STUDENT_SESSIONS_OWN] Request params:', req.params);
        
        const { courseId, studentId } = req.params;
        
        // Get authenticated user information
        const user = req.user;
        if (!user) {
            return res.status(401).json({
                success: false,
                message: 'Authentication required'
            });
        }
        
        // Debug logging
        console.log('🔍 [STUDENT_SESSIONS] User object:', user);
        console.log('🔍 [STUDENT_SESSIONS] User role:', user.role);
        console.log('🔍 [STUDENT_SESSIONS] User ID:', user.userId);
        console.log('🔍 [STUDENT_SESSIONS] Requested student ID:', studentId);
        
        // Students can only access their own chat sessions
        if (user.role === 'student' && user.userId !== studentId) {
            console.log('🔍 [STUDENT_SESSIONS] Access denied - student trying to access different student ID');
            return res.status(403).json({
                success: false,
                message: 'You can only access your own chat sessions'
            });
        }
        
        // Instructors can access any student's sessions
        if (user.role !== 'instructor' && user.role !== 'student') {
            return res.status(403).json({
                success: false,
                message: 'Access denied'
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
        
        // For students, verify they have access to this course
        if (user.role === 'student') {
            // Check if the student has access to this course
            // This could be enhanced with a proper enrollment check in the future
            const coursesCollection = db.collection('courses');
            const course = await coursesCollection.findOne({ courseId: courseId });
            
            if (!course) {
                return res.status(404).json({
                    success: false,
                    message: 'Course not found'
                });
            }
        }
        
        // For instructors, verify they have access to this course
        if (user.role === 'instructor') {
            const coursesCollection = db.collection('courses');
            const course = await coursesCollection.findOne({ 
                courseId: courseId, 
                instructorId: user.userId 
            });
            
            if (!course) {
                return res.status(404).json({
                    success: false,
                    message: 'Course not found or access denied'
                });
            }
        }
        
        // Get all chat sessions for this student in this course (excluding soft deleted)
        const chatSessionsCollection = db.collection('chat_sessions');
        const sessions = await chatSessionsCollection.find({ 
            courseId: courseId,
            studentId: studentId,
            $or: [
                { isDeleted: { $exists: false } }, // Legacy sessions without isDeleted field
                { isDeleted: false } // Non-deleted sessions
            ]
        }).sort({ savedAt: -1 }).toArray();
        
        console.log(`Retrieved ${sessions.length} sessions for student ${studentId} in course ${courseId}`);
        
        // Recalculate duration for each session
        const sessionsWithCalculatedDuration = sessions.map(session => ({
            ...session,
            duration: calculateDurationFromSessionData(session)
        }));
        
        res.json({
            success: true,
            data: {
                courseId: courseId,
                studentId: studentId,
                studentName: sessions[0]?.studentName || 'Unknown Student',
                sessions: sessionsWithCalculatedDuration
            }
        });
        
    } catch (error) {
        console.error('Error fetching student sessions:', error);
        res.status(500).json({
            success: false,
            message: 'Internal server error while fetching student sessions'
        });
    }
});

/**
 * GET /api/students/:courseId/:studentId/sessions
 * Get all saved chat sessions for a specific student in a course
 */
router.get('/:courseId/:studentId/sessions', async (req, res) => {
    try {
        const { courseId, studentId } = req.params;
        
        // Get authenticated user information
        const user = req.user;
        if (!user) {
            return res.status(401).json({
                success: false,
                message: 'Authentication required'
            });
        }
        
        // Only instructors can access student data
        if (user.role !== 'instructor') {
            return res.status(403).json({
                success: false,
                message: 'Only instructors can access student data'
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
        
        // Verify the instructor has access to this course
        const coursesCollection = db.collection('courses');
        const course = await coursesCollection.findOne({ 
            courseId: courseId, 
            instructorId: user.userId 
        });
        
        if (!course) {
            return res.status(404).json({
                success: false,
                message: 'Course not found or access denied'
            });
        }
        
        // Get all chat sessions for this student in this course (excluding soft deleted)
        const chatSessionsCollection = db.collection('chat_sessions');
        const sessions = await chatSessionsCollection.find({ 
            courseId: courseId,
            studentId: studentId,
            $or: [
                { isDeleted: { $exists: false } }, // Legacy sessions without isDeleted field
                { isDeleted: false } // Non-deleted sessions
            ]
        }).sort({ savedAt: -1 }).toArray();
        
        console.log(`Retrieved ${sessions.length} sessions for student ${studentId} in course ${courseId}`);
        
        // Recalculate duration for each session
        const sessionsWithCalculatedDuration = sessions.map(session => ({
            ...session,
            duration: calculateDurationFromSessionData(session)
        }));
        
        res.json({
            success: true,
            data: {
                courseId: courseId,
                studentId: studentId,
                studentName: sessions[0]?.studentName || 'Unknown Student',
                sessions: sessionsWithCalculatedDuration
            }
        });
        
    } catch (error) {
        console.error('Error fetching student sessions:', error);
        res.status(500).json({
            success: false,
            message: 'Internal server error while fetching student sessions'
        });
    }
});

/**
 * GET /api/students/:courseId/:studentId/sessions/:sessionId
 * Get a specific chat session data for download
 */
router.get('/:courseId/:studentId/sessions/:sessionId', async (req, res) => {
    try {
        const { courseId, studentId, sessionId } = req.params;
        
        // Get authenticated user information
        const user = req.user;
        if (!user) {
            return res.status(401).json({
                success: false,
                message: 'Authentication required'
            });
        }
        
        // Only instructors can access student data
        if (user.role !== 'instructor') {
            return res.status(403).json({
                success: false,
                message: 'Only instructors can access student data'
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
        
        // Verify the instructor has access to this course
        const coursesCollection = db.collection('courses');
        const course = await coursesCollection.findOne({ 
            courseId: courseId, 
            instructorId: user.userId 
        });
        
        if (!course) {
            return res.status(404).json({
                success: false,
                message: 'Course not found or access denied'
            });
        }
        
        // Get the specific chat session (excluding soft deleted)
        const chatSessionsCollection = db.collection('chat_sessions');
        const session = await chatSessionsCollection.findOne({ 
            courseId: courseId,
            studentId: studentId,
            sessionId: sessionId,
            $or: [
                { isDeleted: { $exists: false } }, // Legacy sessions without isDeleted field
                { isDeleted: false } // Non-deleted sessions
            ]
        });
        
        if (!session) {
            return res.status(404).json({
                success: false,
                message: 'Chat session not found'
            });
        }
        
        console.log(`Retrieved chat session ${sessionId} for student ${studentId}`);
        
        res.json({
            success: true,
            data: session
        });
        
    } catch (error) {
        console.error('Error fetching chat session:', error);
        res.status(500).json({
            success: false,
            message: 'Internal server error while fetching chat session'
        });
    }
});

/**
 * DELETE /api/students/:courseId/:studentId/sessions/:sessionId/own
 * Delete a specific chat session for a student (student access)
 */
router.delete('/:courseId/:studentId/sessions/:sessionId/own', async (req, res) => {
    try {
        const { courseId, studentId, sessionId } = req.params;
        
        if (!courseId || !studentId || !sessionId) {
            return res.status(400).json({
                success: false,
                error: 'Course ID, Student ID, and Session ID are required'
            });
        }

        // Get authenticated user information
        const user = req.user;
        if (!user) {
            return res.status(401).json({
                success: false,
                error: 'Authentication required'
            });
        }

        // Students can only delete their own chat sessions
        if (user.role === 'student' && user.userId !== studentId) {
            return res.status(403).json({
                success: false,
                error: 'You can only delete your own chat sessions'
            });
        }

        // Instructors can delete any student's sessions
        if (user.role !== 'instructor' && user.role !== 'student') {
            return res.status(403).json({
                success: false,
                error: 'Access denied'
            });
        }

        const db = req.app.locals.db;
        if (!db) {
            return res.status(500).json({
                success: false,
                error: 'Database connection not available'
            });
        }

        const chatSessionsCollection = db.collection('chat_sessions');
        
        // Find the session to ensure it belongs to the student and is not already deleted
        const session = await chatSessionsCollection.findOne({
            sessionId: sessionId,
            courseId: courseId,
            studentId: studentId,
            $or: [
                { isDeleted: { $exists: false } }, // Legacy sessions without isDeleted field
                { isDeleted: false } // Non-deleted sessions
            ]
        });

        if (!session) {
            return res.status(404).json({
                success: false,
                error: 'Chat session not found or does not belong to this student'
            });
        }

        // Soft delete the session by setting isDeleted to true
        const result = await chatSessionsCollection.updateOne({
            sessionId: sessionId,
            courseId: courseId,
            studentId: studentId
        }, {
            $set: {
                isDeleted: true,
                deletedAt: new Date()
            }
        });

        if (result.matchedCount === 0) {
            return res.status(404).json({
                success: false,
                error: 'Chat session not found'
            });
        }

        console.log(`Soft deleted chat session ${sessionId} for student ${studentId} in course ${courseId}`);

        res.json({
            success: true,
            message: 'Chat session deleted successfully',
            data: { sessionId, courseId, studentId }
        });

    } catch (error) {
        console.error('Error deleting chat session:', error);
        res.status(500).json({
            success: false,
            error: 'Failed to delete chat session'
        });
    }
});

/**
 * DELETE /api/students/:courseId/:studentId/sessions/:sessionId
 * Delete a specific chat session for a student (instructor access)
 */
router.delete('/:courseId/:studentId/sessions/:sessionId', async (req, res) => {
    try {
        const { courseId, studentId, sessionId } = req.params;
        
        if (!courseId || !studentId || !sessionId) {
            return res.status(400).json({
                success: false,
                error: 'Course ID, Student ID, and Session ID are required'
            });
        }

        const db = req.app.locals.db;
        if (!db) {
            return res.status(500).json({
                success: false,
                error: 'Database connection not available'
            });
        }

        const chatSessionsCollection = db.collection('chat_sessions');
        
        // Find the session to ensure it belongs to the student and is not already deleted
        const session = await chatSessionsCollection.findOne({
            sessionId: sessionId,
            courseId: courseId,
            studentId: studentId,
            $or: [
                { isDeleted: { $exists: false } }, // Legacy sessions without isDeleted field
                { isDeleted: false } // Non-deleted sessions
            ]
        });

        if (!session) {
            return res.status(404).json({
                success: false,
                error: 'Chat session not found or does not belong to this student'
            });
        }

        // Soft delete the session by setting isDeleted to true
        const result = await chatSessionsCollection.updateOne({
            sessionId: sessionId,
            courseId: courseId,
            studentId: studentId
        }, {
            $set: {
                isDeleted: true,
                deletedAt: new Date()
            }
        });

        if (result.matchedCount === 0) {
            return res.status(404).json({
                success: false,
                error: 'Chat session not found'
            });
        }

        console.log(`Soft deleted chat session ${sessionId} for student ${studentId} in course ${courseId}`);

        res.json({
            success: true,
            message: 'Chat session deleted successfully',
            data: { sessionId, courseId, studentId }
        });

    } catch (error) {
        console.error('Error deleting chat session:', error);
        res.status(500).json({
            success: false,
            error: 'Failed to delete chat session'
        });
    }
});

module.exports = router;
