/**
 * Authentication Routes
 * Handles user login, logout, and session management
 */

const express = require('express');
const router = express.Router();

// Middleware to parse JSON bodies
router.use(express.json());

/**
 * POST /api/auth/login
 * Authenticate user with username and password
 */
router.post('/login', async (req, res) => {
    try {
        const { username, password } = req.body;
        
        // Validate required fields
        if (!username || !password) {
            return res.status(400).json({
                success: false,
                error: 'Username and password are required'
            });
        }

        // Get auth service from app locals
        const authService = req.app.locals.authService;
        if (!authService) {
            return res.status(500).json({
                success: false,
                error: 'Authentication service not available'
            });
        }

        // Authenticate user
        const result = await authService.loginUser(username, password);
        
        if (!result.success) {
            return res.status(401).json({
                success: false,
                error: result.error
            });
        }

        // Create session
        req.session.userId = result.user.userId;
        req.session.userRole = result.user.role;
        req.session.userDisplayName = result.user.displayName;
        
        // Save session
        req.session.save((err) => {
            if (err) {
                console.error('Session save error:', err);
                return res.status(500).json({
                    success: false,
                    error: 'Failed to create session'
                });
            }

            console.log(`User logged in: ${result.user.userId} (${result.user.role})`);
            
            // Determine redirect based on role
            let redirectPath = '/login';
            if (result.user.role === 'instructor') {
                redirectPath = '/instructor';
            } else if (result.user.role === 'student') {
                redirectPath = '/student';
            } else if (result.user.role === 'ta') {
                redirectPath = '/ta';
            }
            
            res.json({
                success: true,
                user: authService.createSessionUser(result.user),
                redirect: redirectPath
            });
        });

    } catch (error) {
        console.error('Error in login endpoint:', error);
        res.status(500).json({
            success: false,
            error: 'Login failed. Please try again.'
        });
    }
});

/**
 * POST /api/auth/register
 * Register a new user account
 */
router.post('/register', async (req, res) => {
    try {
        const { username, password, email, role, displayName } = req.body;
        
        // Validate required fields
        if (!username || !password || !role) {
            return res.status(400).json({
                success: false,
                error: 'Username, password, and role are required'
            });
        }

        // Validate role
        if (!['instructor', 'student', 'ta'].includes(role)) {
            return res.status(400).json({
                success: false,
                error: 'Role must be "instructor", "student", or "ta"'
            });
        }

        // Get auth service from app locals
        const authService = req.app.locals.authService;
        if (!authService) {
            return res.status(500).json({
                success: false,
                error: 'Authentication service not available'
            });
        }

        // Register user
        const result = await authService.registerUser({
            username,
            password,
            email,
            role,
            displayName
        });
        
        if (!result.success) {
            return res.status(400).json({
                success: false,
                error: result.error
            });
        }

        console.log(`User registered: ${result.userId} (${role})`);
        
        res.json({
            success: true,
            message: 'Account created successfully',
            user: result.user
        });

    } catch (error) {
        console.error('Error in register endpoint:', error);
        res.status(500).json({
            success: false,
            error: 'Registration failed. Please try again.'
        });
    }
});

/**
 * POST /api/auth/logout
 * Logout user and destroy session
 */
router.post('/logout', (req, res) => {
    try {
        const userId = req.session.userId;
        
        // Destroy session
        req.session.destroy((err) => {
            if (err) {
                console.error('Session destroy error:', err);
                return res.status(500).json({
                    success: false,
                    error: 'Failed to logout'
                });
            }

            console.log(`User logged out: ${userId}`);
            
            res.json({
                success: true,
                message: 'Logged out successfully',
                redirect: '/login'
            });
        });

    } catch (error) {
        console.error('Error in logout endpoint:', error);
        res.status(500).json({
            success: false,
            error: 'Logout failed'
        });
    }
});

/**
 * GET /api/auth/me
 * Get current user information
 */
router.get('/me', async (req, res) => {
    try {
        console.log('Auth /me endpoint called');
        console.log('Session:', req.session);
        console.log('Session userId:', req.session?.userId);
        
        // Check if user is authenticated
        if (!req.session || !req.session.userId) {
            console.log('User not authenticated - no session or userId');
            return res.status(401).json({
                success: false,
                error: 'Not authenticated',
                redirect: '/login'
            });
        }

        // Get auth service from app locals
        const authService = req.app.locals.authService;
        if (!authService) {
            return res.status(500).json({
                success: false,
                error: 'Authentication service not available'
            });
        }

        // Get user details
        const user = await authService.getUserById(req.session.userId);
        if (!user) {
            // User not found, clear session
            req.session.destroy();
            return res.status(401).json({
                success: false,
                error: 'User not found',
                redirect: '/login'
            });
        }

        res.json({
            success: true,
            user: authService.createSessionUser(user)
        });

    } catch (error) {
        console.error('Error in me endpoint:', error);
        res.status(500).json({
            success: false,
            error: 'Failed to get user information'
        });
    }
});

/**
 * PUT /api/auth/preferences
 * Update user preferences
 */
router.put('/preferences', async (req, res) => {
    try {
        // Check if user is authenticated
        if (!req.session || !req.session.userId) {
            return res.status(401).json({
                success: false,
                error: 'Not authenticated',
                redirect: '/login'
            });
        }

        const { preferences } = req.body;
        
        if (!preferences || typeof preferences !== 'object') {
            return res.status(400).json({
                success: false,
                error: 'Preferences object is required'
            });
        }

        // Get auth service from app locals
        const authService = req.app.locals.authService;
        if (!authService) {
            return res.status(500).json({
                success: false,
                error: 'Authentication service not available'
            });
        }

        // Update preferences
        const result = await authService.updateUserPreferences(req.session.userId, preferences);
        
        if (!result.success) {
            return res.status(400).json({
                success: false,
                error: result.error
            });
        }

        res.json({
            success: true,
            message: 'Preferences updated successfully'
        });

    } catch (error) {
        console.error('Error in preferences endpoint:', error);
        res.status(500).json({
            success: false,
            error: 'Failed to update preferences'
        });
    }
});

/**
 * POST /api/auth/set-course
 * Set user's current course context
 */
router.post('/set-course', async (req, res) => {
    try {
        // Check if user is authenticated
        if (!req.session || !req.session.userId) {
            return res.status(401).json({
                success: false,
                error: 'Not authenticated',
                redirect: '/login'
            });
        }

        const { courseId } = req.body;
        
        if (!courseId) {
            return res.status(400).json({
                success: false,
                error: 'Course ID is required'
            });
        }

        // Get auth service from app locals
        const authService = req.app.locals.authService;
        if (!authService) {
            return res.status(500).json({
                success: false,
                error: 'Authentication service not available'
            });
        }

        // Set course context
        const result = await authService.setCurrentCourseId(req.session.userId, courseId);
        
        if (!result.success) {
            return res.status(400).json({
                success: false,
                error: result.error
            });
        }

        res.json({
            success: true,
            message: 'Course context updated successfully',
            courseId: courseId
        });

    } catch (error) {
        console.error('Error in set-course endpoint:', error);
        res.status(500).json({
            success: false,
            error: 'Failed to set course context'
        });
    }
});

/**
 * GET /api/users/tas
 * Get all Teaching Assistants (instructor only)
 */
router.get('/tas', async (req, res) => {
    try {
        console.log('🔍 [AUTH_TAS] Request received');
        console.log('🔍 [AUTH_TAS] Session:', req.session);
        console.log('🔍 [AUTH_TAS] User:', req.user);
        
        // Get authenticated user information
        const user = req.user;
        if (!user) {
            console.log('🔍 [AUTH_TAS] No user found, returning 401');
            return res.status(401).json({
                success: false,
                message: 'Authentication required'
            });
        }
        
        // Only instructors can view TAs
        if (user.role !== 'instructor') {
            return res.status(403).json({
                success: false,
                message: 'Only instructors can view TAs'
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
        
        // Get all users with TA role
        const usersCollection = db.collection('users');
        const tas = await usersCollection.find({ role: 'ta' })
            .project({
                userId: 1,
                username: 1,
                email: 1,
                displayName: 1,
                isActive: 1,
                createdAt: 1,
                lastLogin: 1
            })
            .sort({ createdAt: -1 })
            .toArray();
        
        console.log(`Retrieved ${tas.length} TAs`);
        
        res.json({
            success: true,
            data: tas
        });
        
    } catch (error) {
        console.error('Error fetching TAs:', error);
        res.status(500).json({
            success: false,
            message: 'Internal server error while fetching TAs'
        });
    }
});

/**
 * GET /api/auth/users/:userId
 * Get user details by ID (instructor only)
 */
router.get('/users/:userId', async (req, res) => {
    try {
        const { userId } = req.params;
        
        // Get authenticated user information
        const user = req.user;
        if (!user) {
            return res.status(401).json({
                success: false,
                message: 'Authentication required'
            });
        }
        
        // Only instructors can view user details
        if (user.role !== 'instructor') {
            return res.status(403).json({
                success: false,
                message: 'Only instructors can view user details'
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
        
        // Get user by ID
        const usersCollection = db.collection('users');
        const userData = await usersCollection.findOne({ userId })
            .project({
                userId: 1,
                username: 1,
                email: 1,
                displayName: 1,
                role: 1,
                isActive: 1,
                createdAt: 1,
                lastLogin: 1
            });
        
        if (!userData) {
            return res.status(404).json({
                success: false,
                message: 'User not found'
            });
        }
        
        console.log(`Retrieved user details for: ${userId}`);
        
        res.json({
            success: true,
            data: userData
        });
        
    } catch (error) {
        console.error('Error fetching user details:', error);
        res.status(500).json({
            success: false,
            message: 'Internal server error while fetching user details'
        });
    }
});

/**
 * DELETE /api/users/tas/:taId
 * Remove a TA from all courses (instructor only)
 */
router.delete('/tas/:taId', async (req, res) => {
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
        
        // Only instructors can remove TAs
        if (user.role !== 'instructor') {
            return res.status(403).json({
                success: false,
                message: 'Only instructors can remove TAs'
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
        
        // Remove TA from all courses
        const coursesCollection = db.collection('courses');
        const result = await coursesCollection.updateMany(
            { tas: taId },
            { $pull: { tas: taId } }
        );
        
        console.log(`Removed TA ${taId} from ${result.modifiedCount} courses`);
        
        res.json({
            success: true,
            message: 'TA removed from all courses successfully',
            data: {
                taId,
                modifiedCount: result.modifiedCount
            }
        });
        
    } catch (error) {
        console.error('Error removing TA:', error);
        res.status(500).json({
            success: false,
            message: 'Internal server error while removing TA'
        });
    }
});

module.exports = router;
