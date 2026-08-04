/**
 * Authentication Middleware
 * Handles session management and route protection
 */

const AuthService = require('../services/authService');
const { hasSystemAdminAccess } = require('../services/authorization');
const previewSession = require('../services/previewSession');
const PreviewState = require('../models/PreviewState');

/**
 * Initialize authentication middleware
 * @param {Object} db - MongoDB database instance
 * @returns {Object} Middleware functions
 */
function createAuthMiddleware(db) {
    const authService = new AuthService(db);

    /**
     * Middleware to check if user is authenticated
     * Works with Passport.js (checks req.user) and falls back to session-based auth
     * @param {Object} req - Express request object
     * @param {Object} res - Express response object
     * @param {Function} next - Express next function
     */
    async function requireAuth(req, res, next) {
        console.log('🔐 [AUTH] Checking authentication for:', req.path);
        console.log('🔐 [AUTH] Passport user:', !!req.user);
        console.log('🔐 [AUTH] Session exists:', !!req.session);
        console.log('🔐 [AUTH] User ID:', req.user?.userId || req.session?.userId);
        
        // Check if user is authenticated via Passport (preferred method)
        if (req.user) {
            console.log('🔐 [AUTH] Authentication successful via Passport');
            // User is authenticated via Passport, continue
            next();
            return;
        }
        
        // Fallback: Check if user is in session (backward compatibility)
        if (req.session && req.session.userId) {
            console.log('🔐 [AUTH] Authentication successful via session (fallback)');

            try {
                const user = await authService.getUserById(req.session.userId);

                if (!user) {
                    req.session.destroy(() => {});

                    if (req.originalUrl.startsWith('/api/')) {
                        return res.status(401).json({
                            success: false,
                            error: 'User not found',
                            redirect: '/login'
                        });
                    }

                    return res.redirect('/login');
                }

                req.user = user;
                next();
                return;
            } catch (error) {
                console.error('Error hydrating session user:', error);

                if (req.originalUrl.startsWith('/api/')) {
                    return res.status(500).json({
                        success: false,
                        error: 'Authentication error'
                    });
                }

                return res.redirect('/login');
            }
        }
        
        // No authentication found
        console.log('🔐 [AUTH] Authentication failed - no user or session');
        
        // If it's an API request, return JSON error
        if (req.originalUrl.startsWith('/api/')) {
            return res.status(401).json({
                success: false,
                error: 'Authentication required',
                redirect: '/login'
            });
        }
        
        // For page requests, redirect to login
        return res.redirect('/login');
    }

    /**
     * Middleware to check if user has specific role
     * Works with Passport.js (uses req.user) and falls back to session-based auth
     * @param {string} requiredRole - Required role ('instructor', 'student', or 'ta')
     * @returns {Function} Middleware function
     */
    function requireRole(requiredRole) {
        return async (req, res, next) => {
            try {
                let user = req.user;
                
                // If Passport hasn't populated req.user, try to get from session
                if (!user) {
                    if (!req.session || !req.session.userId) {
                        if (req.originalUrl.startsWith('/api/')) {
                            return res.status(401).json({
                                success: false,
                                error: 'Authentication required',
                                redirect: '/login'
                            });
                        }
                        return res.redirect('/login');
                    }

                    // Get user details from database
                    user = await authService.getUserById(req.session.userId);
                    if (!user) {
                        // User not found, clear session
                        req.session.destroy();
                        if (req.originalUrl.startsWith('/api/')) {
                            return res.status(401).json({
                                success: false,
                                error: 'User not found',
                                redirect: '/login'
                            });
                        }
                        return res.redirect('/login');
                    }
                    
                    // Set user in request for future use
                    req.user = user;
                }

                // Check role
                if (user.role !== requiredRole) {
                    if (req.originalUrl.startsWith('/api/')) {
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

                // User has required role, continue
                next();

            } catch (error) {
                console.error('Error in requireRole middleware:', error);
                if (req.originalUrl.startsWith('/api/')) {
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
     * Works with Passport.js (uses req.user) and falls back to session-based auth
     * @param {Object} req - Express request object
     * @param {Object} res - Express response object
     * @param {Function} next - Express next function
     */
    async function requireInstructorOrTA(req, res, next) {
        try {
            let user = req.user;
            
            // If Passport hasn't populated req.user, try to get from session
            if (!user) {
                if (!req.session || !req.session.userId) {
                    if (req.originalUrl.startsWith('/api/')) {
                        return res.status(401).json({
                            success: false,
                            error: 'Authentication required',
                            redirect: '/login'
                        });
                    }
                    return res.redirect('/login');
                }

                // Get user details from database
                user = await authService.getUserById(req.session.userId);
                if (!user) {
                    // User not found, clear session
                    req.session.destroy();
                    if (req.originalUrl.startsWith('/api/')) {
                        return res.status(401).json({
                            success: false,
                            error: 'User not found',
                            redirect: '/login'
                        });
                    }
                    return res.redirect('/login');
                }
                
                // Set user in request for future use
                req.user = user;
            }

            // Check role - allow both instructor and TA
            if (user.role !== 'instructor' && user.role !== 'ta') {
                if (req.originalUrl.startsWith('/api/')) {
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

            // User has required role, continue
            next();

        } catch (error) {
            console.error('Error in requireInstructorOrTA middleware:', error);
            if (req.originalUrl.startsWith('/api/')) {
                return res.status(500).json({
                    success: false,
                    error: 'Authentication error'
                });
            }
            return res.redirect('/login');
        }
    }

    /**
     * Middleware to require platform system admin access.
     */
    async function requireSystemAdmin(req, res, next) {
        try {
            let user = req.user;

            if (!user) {
                if (!req.session || !req.session.userId) {
                    if (req.originalUrl.startsWith('/api/')) {
                        return res.status(401).json({
                            success: false,
                            error: 'Authentication required',
                            redirect: '/login'
                        });
                    }
                    return res.redirect('/login');
                }

                user = await authService.getUserById(req.session.userId);
                if (!user) {
                    req.session.destroy();
                    if (req.originalUrl.startsWith('/api/')) {
                        return res.status(401).json({
                            success: false,
                            error: 'User not found',
                            redirect: '/login'
                        });
                    }
                    return res.redirect('/login');
                }

                req.user = user;
            }

            if (!hasSystemAdminAccess(user)) {
                if (req.originalUrl.startsWith('/api/')) {
                    return res.status(403).json({
                        success: false,
                        error: 'Access denied. System admin access required.'
                    });
                }

                return res.redirect('/instructor/home');
            }

            next();
        } catch (error) {
            console.error('Error in requireSystemAdmin middleware:', error);
            if (req.originalUrl.startsWith('/api/')) {
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
     * Works with Passport.js (req.user is already populated) and falls back to session
     * @param {Object} req - Express request object
     * @param {Object} res - Express response object
     * @param {Function} next - Express next function
     */
    async function populateUser(req, res, next) {
        try {
            // If Passport has already populated req.user, use it
            if (req.user) {
                next();
                return;
            }
            
            // Fallback: Populate from session if available
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
     * Middleware that swaps in a sandboxed student identity for "View as
     * Student" preview requests.
     *
     * Runs globally, before role gating, so that every downstream check —
     * requireStudent, per-user data lookups, analytics writes — sees a plain
     * student. The real user stays available on req.realUser for the preview
     * control endpoints themselves.
     *
     * A request is only converted when it carries the per-tab marker AND the
     * session holds a grant belonging to this same user; see
     * services/previewSession.js for why both are required.
     *
     * @param {Object} req - Express request object
     * @param {Object} res - Express response object
     * @param {Function} next - Express next function
     */
    async function resolvePreview(req, res, next) {
        try {
            // Cheap bail-out: unmarked requests are the overwhelming majority
            // and must not pay for a user lookup here.
            if (!previewSession.isPreviewMarked(req)) {
                return next();
            }

            let user = req.user;

            if (!user && req.session && req.session.userId) {
                user = await authService.getUserById(req.session.userId);
            }

            if (!user) {
                return next();
            }

            const grant = previewSession.resolveGrantForRequest(req, user);
            if (!grant) {
                // Marked but not granted (e.g. a student sending the header, or
                // a stale marker after the preview was stopped). Leave the
                // request exactly as it was and let normal role gating answer.
                return next();
            }

            // Load the sandbox's own record so the preview carries the state a
            // real student would have — most importantly the welcome-flow flag,
            // which the guided tour reads through /api/auth/me. A synthesized
            // user without it skips the entire first-run experience.
            let persisted = null;
            try {
                persisted = await authService.getUserById(grant.previewUserId);
            } catch (error) {
                console.error('Could not load preview user record:', error);
            }

            req.realUser = user;
            req.preview = {
                active: true,
                grant,
                courseId: grant.courseId,
                previewUserId: grant.previewUserId,
                settings: previewSession.normalizeSettings(grant.settings)
            };
            req.user = previewSession.buildPreviewUser(user, grant, persisted);

            next();
        } catch (error) {
            console.error('Error in resolvePreview middleware:', error);
            next();
        }
    }

    /**
     * Load the real user behind a request without disturbing an active preview swap.
     * @param {Object} req - Express request object
     * @returns {Promise<Object|null>} The real authenticated user, or null
     */
    async function loadRealUser(req) {
        if (req.realUser) {
            return req.realUser;
        }

        if (req.user && !req.user.isPreview) {
            return req.user;
        }

        if (req.session && req.session.userId) {
            return authService.getUserById(req.session.userId);
        }

        return null;
    }

    /**
     * Whether this request comes from someone holding a valid preview grant.
     *
     * Unlike resolvePreview this does not require the per-request marker, so it
     * must only gate responses that contain no user data — page shells and
     * static assets. Every data-bearing API keeps the stricter marker+grant
     * rule, because the marker is what confines the preview to one tab.
     *
     * @param {Object} req - Express request object
     * @returns {Promise<boolean>} True when a usable grant exists
     */
    async function hasPreviewGrant(req) {
        const grant = previewSession.getGrant(req);
        if (!grant || !grant.ownerUserId) {
            return false;
        }

        const user = await loadRealUser(req);
        if (!user || grant.ownerUserId !== user.userId) {
            return false;
        }

        return previewSession.canPreview(user);
    }

    /**
     * Gate for student *page* routes that also admits an active previewer.
     *
     * Browsers cannot attach headers to a top-level navigation, so a previewer
     * clicking through the student nav arrives unmarked. Rather than bounce
     * them out of the preview, redirect once to the same URL carrying the
     * marker — from there the client keeps the tab marked for its API calls.
     *
     * @param {Object} req - Express request object
     * @param {Object} res - Express response object
     * @param {Function} next - Express next function
     */
    async function requireStudentOrPreview(req, res, next) {
        try {
            if (req.user && req.user.role === 'student') {
                return next();
            }

            if (await hasPreviewGrant(req)) {
                // Guarantee the sandbox's user record exists before any page
                // script runs. Doing this on the page request rather than from
                // the client avoids a race where a page's first data call beats
                // the preview bootstrap and 404s on a missing user.
                try {
                    await PreviewState.ensurePreviewUser(db, req.realUser || req.user, previewSession.getGrant(req));
                } catch (error) {
                    console.error('Failed to prepare preview user record:', error);
                }

                if (previewSession.isPreviewMarked(req)) {
                    return next();
                }

                const separator = req.originalUrl.includes('?') ? '&' : '?';
                return res.redirect(`${req.originalUrl}${separator}preview=1`);
            }

            return requireStudent(req, res, next);
        } catch (error) {
            console.error('Error in requireStudentOrPreview middleware:', error);
            return requireStudent(req, res, next);
        }
    }

    /**
     * Gate for the static /student asset mount.
     *
     * Scripts and stylesheets are requested by the browser itself, with no
     * marker available, so a previewer is admitted on the grant alone. These
     * files are inert and identical for every student.
     *
     * @param {Object} req - Express request object
     * @param {Object} res - Express response object
     * @param {Function} next - Express next function
     */
    async function allowStudentAssets(req, res, next) {
        try {
            if (req.user && req.user.role === 'student') {
                return next();
            }

            if (await hasPreviewGrant(req)) {
                return next();
            }

            return requireStudent(req, res, next);
        } catch (error) {
            console.error('Error in allowStudentAssets middleware:', error);
            return requireStudent(req, res, next);
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
                let courseId = req.query.courseId ||
                    (req.body && req.body.courseId) ||
                    (req.params && req.params.courseId) ||
                    req.user.preferences?.courseId;

                if (!courseId) {
                    const CourseModel = require('../models/Course');
                    const courses = await CourseModel.getCoursesForUser(db, taId, 'ta');

                    if (courses.length === 1) {
                        courseId = courses[0].courseId;
                    }
                }

                if (!courseId) {
                    if (!req.originalUrl.startsWith('/api/')) {
                        return res.redirect('/ta');
                    }

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

            // A preview student has no enrollment record and never will —
            // enrolling it would put a fake student in the course roster. The
            // grant already proves the previewer has access to this course.
            if (previewSession.isPreviewRequest(req)) {
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
                const isCourseInactive = result.reason === 'course_inactive';
                return res.status(403).json({
                    success: false,
                    message: isCourseInactive
                        ? 'This course is currently deactivated by the instructor.'
                        : 'Your access to this course is disabled by the instructor.'
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

    /**
     * Middleware to block students from using inactive courses.
     * Instructors and TAs can still access inactive courses so they can manage/reactivate them.
     * Attempts to infer courseId from body, query, or params.
     */
    async function requireActiveCourseForNonInstructors(req, res, next) {
        try {
            if (!req.user || req.user.role === 'instructor' || req.user.role === 'ta') {
                return next();
            }

            // Allow students to inspect enrollment status for a stale/deactivated course
            if (req.user.role === 'student' && req.method === 'GET' && req.path.endsWith('/student-enrollment')) {
                return next();
            }

            const courseId = (req.body && req.body.courseId) || req.query.courseId || req.params.courseId;
            if (!courseId) {
                return next();
            }

            const CourseModel = require('../models/Course');
            // This guard must see deleted rows so it can actively deny them;
            // ordinary product reads use getCourseById(), which hides them.
            const course = await CourseModel.getCourseByIdIncludingDeleted(db, courseId);

            if (!course) {
                return next();
            }

            // Previewing an inactive course is legitimate: instructors check
            // how a course reads before switching it on. Deleted courses stay
            // blocked for everyone.
            if (course.status === 'inactive' && previewSession.isPreviewRequest(req)) {
                return next();
            }

            if (course.status === 'inactive' || course.status === 'deleted') {
                return res.status(403).json({
                    success: false,
                    message: 'This course is currently deactivated by the instructor.'
                });
            }

            next();
        } catch (error) {
            console.error('Error in requireActiveCourseForNonInstructors middleware:', error);
            return res.status(500).json({
                success: false,
                message: 'Course access check failed'
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
        requireSystemAdmin,
        resolvePreview,
        requireStudentOrPreview,
        allowStudentAssets,
        populateUser,
        redirectIfAuthenticated,
        requireCourseContext,
        requireTAPermission,
        requireStudentEnrolled,
        requireActiveCourseForNonInstructors,
        authService
    };
}

module.exports = createAuthMiddleware;
