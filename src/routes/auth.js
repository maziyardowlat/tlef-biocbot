/**
 * Authentication Routes
 * Handles user login, logout, and session management
 * Uses Passport.js for authentication strategies
 */

const express = require('express');
const passport = require('passport');
const router = express.Router();

// Middleware to parse JSON bodies
router.use(express.json());

/**
 * POST /api/auth/login
 * Authenticate user with username and password using Passport Local Strategy
 */
router.post('/login', (req, res, next) => {
    // Validate required fields before Passport authentication
    const { username, password } = req.body;
    
    if (!username || !password) {
        return res.status(400).json({
            success: false,
            error: 'Username and password are required'
        });
    }

    // Use Passport's local strategy for authentication
    passport.authenticate('local', (err, user, info) => {
        if (err) {
            console.error('Error in Passport authentication:', err);
            return res.status(500).json({
                success: false,
                error: 'Login failed. Please try again.'
            });
        }

        if (!user) {
            // Authentication failed
            return res.status(401).json({
                success: false,
                error: info && info.message ? info.message : 'Invalid username or password'
            });
        }

        // Log user in (creates session via Passport)
        req.login(user, (loginErr) => {
            if (loginErr) {
                console.error('Error logging in user:', loginErr);
                return res.status(500).json({
                    success: false,
                    error: 'Failed to create session'
                });
            }

            // Get auth service for creating session user object
            const authService = req.app.locals.authService;
            
            // Also store role in session for backward compatibility
            req.session.userId = user.userId;
            req.session.userRole = user.role;
            req.session.userDisplayName = user.displayName;

            console.log(`User logged in: ${user.userId} (${user.role})`);
            
            // Determine redirect based on role
            let redirectPath = '/login';
            if (user.role === 'instructor') {
                redirectPath = '/instructor/home';
            } else if (user.role === 'student') {
                redirectPath = '/student';
            } else if (user.role === 'ta') {
                redirectPath = '/ta';
            }
            
            res.json({
                success: true,
                user: authService ? authService.createSessionUser(user) : {
                    userId: user.userId,
                    username: user.username,
                    email: user.email,
                    role: user.role,
                    displayName: user.displayName,
                    authProvider: user.authProvider,
                    preferences: user.preferences
                },
                redirect: redirectPath
            });
        });
    })(req, res, next);
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
 * Logout user and destroy session using Passport
 */
router.post('/logout', (req, res) => {
    try {
        const userId = req.user ? req.user.userId : req.session.userId;
        
        // Use Passport's logout method
        req.logout((err) => {
            if (err) {
                console.error('Passport logout error:', err);
            }
            
            // Destroy session
            req.session.destroy((destroyErr) => {
                if (destroyErr) {
                    console.error('Session destroy error:', destroyErr);
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
 * Uses Passport's req.user if available, falls back to session
 */
router.get('/me', async (req, res) => {
    try {
        console.log('Auth /me endpoint called');
        console.log('Passport user:', req.user);
        console.log('Session:', req.session);
        console.log('Session userId:', req.session?.userId);
        
        // Check if user is authenticated via Passport
        // Passport populates req.user after deserialization
        let user = req.user;
        
        // Fallback to session-based auth for backward compatibility
        if (!user && req.session && req.session.userId) {
            const authService = req.app.locals.authService;
            if (authService) {
                user = await authService.getUserById(req.session.userId);
            }
        }
        
        if (!user) {
            console.log('User not authenticated - no user found');
            return res.status(401).json({
                success: false,
                error: 'Not authenticated',
                redirect: '/login'
            });
        }

        // Get auth service for creating session user object
        const authService = req.app.locals.authService;
        if (!authService) {
            return res.status(500).json({
                success: false,
                error: 'Authentication service not available'
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

/**
 * GET /api/auth/saml
 * Initiate SAML authentication flow
 * Redirects to SAML Identity Provider
 */
router.get('/saml', passport.authenticate('saml', {
    failureRedirect: '/login?error=saml_failed'
}));

/**
 * POST /api/auth/saml/callback
 * SAML callback endpoint (called by IdP after authentication)
 */
router.post('/saml/callback',
    passport.authenticate('saml', {
        failureRedirect: '/login?error=saml_failed',
        session: true
    }),
    (req, res) => {
        // Successful SAML authentication
        // Determine redirect based on role
        let redirectPath = '/login';
        if (req.user && req.user.role) {
            if (req.user.role === 'instructor') {
                redirectPath = '/instructor/home';
            } else if (req.user.role === 'student') {
                redirectPath = '/student';
            } else if (req.user.role === 'ta') {
                redirectPath = '/ta';
            }
        }
        
        // Store role in session for backward compatibility
        if (req.user) {
            req.session.userId = req.user.userId;
            req.session.userRole = req.user.role;
            req.session.userDisplayName = req.user.displayName;
        }
        
        res.redirect(redirectPath);
    }
);

/**
 * GET /api/auth/methods
 * Get available authentication methods
 * Returns which auth methods are configured and available
 */
router.get('/methods', (req, res) => {
    try {
        const methods = {
            local: true, // Local auth is always available
            saml: false,
            ubcshib: false
        };

        // Check if SAML is configured
        if (process.env.SAML_ENTRY_POINT && 
            process.env.SAML_ISSUER && 
            process.env.SAML_CALLBACK_URL && 
            process.env.SAML_CERT) {
            methods.saml = true;
        }

        // Check if UBC Shibboleth is configured
        // Uses generic SAML_ variables (not UBC_SAML_ prefix)
        const ubcShibIssuer = process.env.SAML_ISSUER;
        const ubcShibCallbackUrl = process.env.SAML_CALLBACK_URL;
        if (ubcShibIssuer && ubcShibCallbackUrl) {
            methods.ubcshib = true;
        }

        res.json({
            success: true,
            methods: methods
        });
    } catch (error) {
        console.error('Error getting auth methods:', error);
        res.status(500).json({
            success: false,
            error: 'Failed to get authentication methods'
        });
    }
});

/**
 * GET /api/auth/ubcshib
 * Initiate UBC Shibboleth authentication flow
 * Redirects to UBC's Shibboleth Identity Provider
 */
router.get('/ubcshib', (req, res, next) => {
    // Check if required environment variables are set
    if (!process.env.SAML_ISSUER || !process.env.SAML_CALLBACK_URL) {
        console.error('❌ UBC Shibboleth not configured - missing environment variables');
        console.error('   Required: SAML_ISSUER and SAML_CALLBACK_URL');
        return res.status(503).json({
            success: false,
            error: 'UBC Shibboleth authentication is not configured. Please contact the administrator.'
        });
    }
    
    // Use Passport's authenticate middleware
    // This will throw an error if strategy isn't registered, so we catch it
    try {
        passport.authenticate('ubcshib', {
            failureRedirect: '/login?error=ubcshib_failed'
        })(req, res, next);
    } catch (error) {
        console.error('❌ UBC Shibboleth strategy not registered:', error.message);
        console.error('   Make sure passport-ubcshib is installed and environment variables are set');
        return res.status(503).json({
            success: false,
            error: 'UBC Shibboleth authentication is not configured. Please contact the administrator.'
        });
    }
});

/**
 * POST /api/auth/ubcshib/callback
 * UBC Shibboleth callback endpoint (called by UBC IdP after authentication)
 */
router.post('/ubcshib/callback',
    passport.authenticate('ubcshib', {
        failureRedirect: '/login?error=ubcshib_failed',
        session: true
    }),
    (req, res) => {
        // Successful UBC Shibboleth authentication
        // Determine redirect based on role
        let redirectPath = '/login';
        if (req.user && req.user.role) {
            if (req.user.role === 'instructor') {
                redirectPath = '/instructor/home';
            } else if (req.user.role === 'student') {
                redirectPath = '/student';
            } else if (req.user.role === 'ta') {
                redirectPath = '/ta';
            }
        }
        
        // Store role in session for backward compatibility
        if (req.user) {
            req.session.userId = req.user.userId;
            req.session.userRole = req.user.role;
            req.session.userDisplayName = req.user.displayName;
        }
        
        res.redirect(redirectPath);
    }
);

module.exports = router;
