/**
 * Authentication Middleware
 * Handles session management and route protection
 */

const AuthService = require('../services/authService');

/**
 * Initialize authentication middleware
 * @param {Object} db - MongoDB database instance
 * @returns {Object} Middleware functions
 */
function createAuthMiddleware(db) {
    const authService = new AuthService(db);

    /**
     * Middleware to check if user is authenticated
     * @param {Object} req - Express request object
     * @param {Object} res - Express response object
     * @param {Function} next - Express next function
     */
    function requireAuth(req, res, next) {
        console.log('🔐 [AUTH] Checking authentication for:', req.path);
        console.log('🔐 [AUTH] Session exists:', !!req.session);
        console.log('🔐 [AUTH] User ID:', req.session?.userId);
        
        // Check if user is in session
        if (!req.session || !req.session.userId) {
            console.log('🔐 [AUTH] Authentication failed - no session or user ID');
            // If it's an API request, return JSON error
            if (req.path.startsWith('/api/')) {
                return res.status(401).json({
                    success: false,
                    error: 'Authentication required',
                    redirect: '/login'
                });
            }
            
            // For page requests, redirect to login
            return res.redirect('/login');
        }
        
        console.log('🔐 [AUTH] Authentication successful');

        // Set user information for routes that need it
        req.user = {
            userId: req.session.userId,
            role: req.session.userRole,
            displayName: req.session.userDisplayName
        };

        // User is authenticated, continue
        next();
    }

    /**
     * Middleware to check if user has specific role
     * @param {string} requiredRole - Required role ('instructor' or 'student')
     * @returns {Function} Middleware function
     */
    function requireRole(requiredRole) {
        return async (req, res, next) => {
            try {
                // First check if user is authenticated
                if (!req.session || !req.session.userId) {
                    if (req.path.startsWith('/api/')) {
                        return res.status(401).json({
                            success: false,
                            error: 'Authentication required',
                            redirect: '/login'
                        });
                    }
                    return res.redirect('/login');
                }

                // Get user details
                const user = await authService.getUserById(req.session.userId);
                if (!user) {
                    // User not found, clear session
                    req.session.destroy();
                    if (req.path.startsWith('/api/')) {
                        return res.status(401).json({
                            success: false,
                            error: 'User not found',
                            redirect: '/login'
                        });
                    }
                    return res.redirect('/login');
                }

                // Check role
                if (user.role !== requiredRole) {
                    if (req.path.startsWith('/api/')) {
                        return res.status(403).json({
                            success: false,
                            error: `Access denied. ${requiredRole} role required.`,
                            userRole: user.role
                        });
                    }
                    
                    // Redirect based on user's actual role
                    if (user.role === 'instructor') {
                        return res.redirect('/instructor');
                    } else if (user.role === 'student') {
                        return res.redirect('/student');
                    } else if (user.role === 'ta') {
                        return res.redirect('/ta');
                    } else {
                        return res.redirect('/login');
                    }
                }

                // Add user to request object for easy access
                req.user = user;
                next();

            } catch (error) {
                console.error('Error in requireRole middleware:', error);
                if (req.path.startsWith('/api/')) {
                    return res.status(500).json({
                        success: false,
                        error: 'Authentication error'
                    });
                }
                return res.redirect('/login');
            }
        };
    }

    /**
     * Middleware to require instructor role
     * @param {Object} req - Express request object
     * @param {Object} res - Express response object
     * @param {Function} next - Express next function
     */
    async function requireInstructor(req, res, next) {
        return requireRole('instructor')(req, res, next);
    }

    /**
     * Middleware to require student role
     * @param {Object} req - Express request object
     * @param {Object} res - Express response object
     * @param {Function} next - Express next function
     */
    function requireStudent(req, res, next) {
        return requireRole('student')(req, res, next);
    }

    /**
     * Middleware to require TA role
     * @param {Object} req - Express request object
     * @param {Object} res - Express response object
     * @param {Function} next - Express next function
     */
    function requireTA(req, res, next) {
        return requireRole('ta')(req, res, next);
    }

    /**
     * Middleware to require instructor or TA role (for shared instructor/TA pages)
     * @param {Object} req - Express request object
     * @param {Object} res - Express response object
     * @param {Function} next - Express next function
     */
    async function requireInstructorOrTA(req, res, next) {
        try {
            // First check if user is authenticated
            if (!req.session || !req.session.userId) {
                if (req.path.startsWith('/api/')) {
                    return res.status(401).json({
                        success: false,
                        error: 'Authentication required',
                        redirect: '/login'
                    });
                }
                return res.redirect('/login');
            }

            // Get user details
            const user = await authService.getUserById(req.session.userId);
            if (!user) {
                // User not found, clear session
                req.session.destroy();
                if (req.path.startsWith('/api/')) {
                    return res.status(401).json({
                        success: false,
                        error: 'User not found',
                        redirect: '/login'
                    });
                }
                return res.redirect('/login');
            }

            // Check role - allow both instructor and TA
            if (user.role !== 'instructor' && user.role !== 'ta') {
                if (req.path.startsWith('/api/')) {
                    return res.status(403).json({
                        success: false,
                        error: 'Access denied. Instructor or TA role required.',
                        userRole: user.role
                    });
                }
                
                // Redirect based on user's actual role
                if (user.role === 'instructor') {
                    return res.redirect('/instructor');
                } else if (user.role === 'student') {
                    return res.redirect('/student');
                } else if (user.role === 'ta') {
                    return res.redirect('/ta');
                } else {
                    return res.redirect('/login');
                }
            }

            // Add user to request object for easy access
            req.user = user;
            next();

        } catch (error) {
            console.error('Error in requireInstructorOrTA middleware:', error);
            if (req.path.startsWith('/api/')) {
                return res.status(500).json({
                    success: false,
                    error: 'Authentication error'
                });
            }
            return res.redirect('/login');
        }
    }

    /**
     * Middleware to populate user data in request
     * @param {Object} req - Express request object
     * @param {Object} res - Express response object
     * @param {Function} next - Express next function
     */
    async function populateUser(req, res, next) {
        try {
            if (req.session && req.session.userId) {
                const user = await authService.getUserById(req.session.userId);
                if (user) {
                    req.user = user;
                } else {
                    // User not found, clear session
                    req.session.destroy();
                }
            }
            next();
        } catch (error) {
            console.error('Error in populateUser middleware:', error);
            next();
        }
    }

    /**
     * Middleware to check if user is already authenticated
     * Redirects authenticated users away from login page
     * @param {Object} req - Express request object
     * @param {Object} res - Express response object
     * @param {Function} next - Express next function
     */
    function redirectIfAuthenticated(req, res, next) {
        if (req.session && req.session.userId) {
            // User is already authenticated, redirect to appropriate dashboard
            const userRole = req.session.userRole;
            if (userRole === 'instructor') {
                return res.redirect('/instructor');
            } else if (userRole === 'student') {
                return res.redirect('/student');
            } else if (userRole === 'ta') {
                return res.redirect('/ta');
            }
        }
        next();
    }

    /**
     * Middleware to ensure user has a course context (for instructors)
     * @param {Object} req - Express request object
     * @param {Object} res - Express response object
     * @param {Function} next - Express next function
     */
    async function requireCourseContext(req, res, next) {
        try {
            if (!req.user) {
                return res.redirect('/login');
            }

            // Only apply to instructor routes that need course context
            if (req.user.role === 'instructor') {
                const courseId = authService.getCurrentCourseId(req.user);
                if (!courseId) {
                    // No course context, redirect to onboarding or course selection
                    return res.redirect('/instructor/onboarding');
                }
                
                // Add course context to request
                req.courseId = courseId;
            }

            next();
        } catch (error) {
            console.error('Error in requireCourseContext middleware:', error);
            next();
        }
    }

    /**
     * Middleware to check TA permissions for specific features
     * @param {string} feature - Feature to check ('courses' or 'flags')
     */
    function requireTAPermission(feature) {
        return async (req, res, next) => {
            try {
                // Only apply to TAs
                if (req.user.role !== 'ta') {
                    return next();
                }

                const taId = req.user.userId;
                const courseId = req.query.courseId;

                if (!courseId) {
                    return res.status(400).json({
                        success: false,
                        message: 'Course ID is required to check TA permissions'
                    });
                }

                // Import CourseModel here to avoid circular dependency
                const CourseModel = require('../models/Course');

                // Check if TA has permission for this feature
                const hasPermission = await CourseModel.checkTAPermission(db, courseId, taId, feature);
                
                if (!hasPermission) {
                    const featureName = feature === 'courses' ? 'My Courses' : 'Flagged Content';
                    return res.status(403).json({
                        success: false,
                        message: `Access denied. You do not have permission to access ${featureName}. Contact your instructor.`
                    });
                }

                next();
            } catch (error) {
                console.error('Error checking TA permission:', error);
                return res.status(500).json({
                    success: false,
                    message: 'Error checking permissions'
                });
            }
        };
    }

    /**
     * Middleware to require that a student is enrolled in the course
     * If the user is not a student, this is a no-op.
     * Attempts to infer courseId from body, query, or params.
     */
    async function requireStudentEnrolled(req, res, next) {
        try {
            // Only enforce for students
            if (!req.user || req.user.role !== 'student') {
                return next();
            }

            // Try to infer courseId
            const courseId = (req.body && req.body.courseId) || req.query.courseId || req.params.courseId;
            if (!courseId) {
                // If we cannot determine course context, allow through
                // (endpoints without course context shouldn't be blocked here)
                return next();
            }

            // Import CourseModel lazily
            const CourseModel = require('../models/Course');

            // Default behavior: enrolled unless explicitly disabled in course settings
            const result = await CourseModel.getStudentEnrollment(db, courseId, req.user.userId);

            if (!result.success) {
                return res.status(404).json({
                    success: false,
                    message: 'Course not found'
                });
            }

            if (result.enrolled === false) {
                return res.status(403).json({
                    success: false,
                    message: 'Your access to this course is disabled by the instructor.'
                });
            }

            next();
        } catch (error) {
            console.error('Error in requireStudentEnrolled middleware:', error);
            return res.status(500).json({
                success: false,
                message: 'Enrollment check failed'
            });
        }
    }

    return {
        requireAuth,
        requireRole,
        requireInstructor,
        requireStudent,
        requireTA,
        requireInstructorOrTA,
        populateUser,
        redirectIfAuthenticated,
        requireCourseContext,
        requireTAPermission,
        requireStudentEnrolled,
        authService
    };
}

module.exports = createAuthMiddleware;
