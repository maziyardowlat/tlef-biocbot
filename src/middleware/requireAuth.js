/**
 * Authentication Requirement Middleware
 *
 * Protects routes that require authentication
 */

const requireAuth = (req, res, next) => {
    if (req.isAuthenticated()) {
        // User is authenticated, continue
        return next();
    }

    // Not authenticated - return 401 for API routes
    if (req.path.startsWith('/api/')) {
        return res.status(401).json({
            error: 'Authentication required',
            loginUrl: '/auth/login'
        });
    }

    // For non-API routes, redirect to login
    res.redirect('/auth/login');
};

module.exports = requireAuth;