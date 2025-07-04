/**
 * BIOCBOT Server
 *
 * This is the main entry point for the BIOCBOT backend server.
 * It serves the static frontend files and provides API endpoints that
 * communicate with TLEF-SERVER for LLM and other services.
 *
 * Architecture:
 * Browser → BIOCBOT Frontend → BIOCBOT Backend (this file) → TLEF-SERVER → External APIs
 */

require('dotenv').config();
const express = require('express');
const path = require('path');

// Import middleware
const sessionMiddleware = require('./middleware/session');
const { passport } = require('./middleware/passport');

// Create Express application instance
const app = express();
const PORT = process.env.PORT || 8001;

// Import routes
const apiRoutes = require('./routes');
const authRoutes = require('./routes/auth');
const pageRoutes = require('./routes/pages');

/**
 * MIDDLEWARE CONFIGURATION
 * Order matters! Session must come before passport
 */

// Body parsing middleware (needed for SAML POST)
app.use(express.urlencoded({ extended: false }));
app.use(express.json());

// Session middleware - must be before passport
app.use(sessionMiddleware);

// Passport middleware
app.use(passport.initialize());
app.use(passport.session());

// Serve static files from the public directory
app.use(express.static(path.join(__dirname, '..', 'public')));

// Request logging middleware
app.use((req, res, next) => {
    console.log(`[BIOCBOT] ${new Date().toISOString()} ${req.method} ${req.path} - User: ${req.user?.username || 'anonymous'}`);
    next();
});

/**
 * ROUTE MOUNTING
 * The order of route mounting is important.
 * More specific routes (like /api and /auth) should come before
 * more general, page-serving routes.
 */

// Authentication routes (no /api prefix as they serve HTML too)
app.use('/auth', authRoutes);

// API routes are assembled in `src/routes/index.js` and mounted under /api
app.use('/api', apiRoutes);

// Page-serving routes are for the SPA and are mounted at the root.
// They must come after the API and auth routes.
app.use('/', pageRoutes);

// Final 404 handler for any requests that do not match a route
app.use((req, res) => {
    // If it's an API path, send a JSON 404
    if (req.path.startsWith('/api/')) {
        return res.status(404).json({ error: 'API endpoint not found' });
    }
    // For all other paths, send a simple text 404
    res.status(404).send('404: Page Not Found');
});

/**
 * SERVER STARTUP
 */

app.listen(PORT, () => {
    console.log(`[BIOCBOT] running on http://localhost:${PORT}`);
    console.log(`[BIOCBOT] Health check: http://localhost:${PORT}/api/health`);
    console.log(`[BIOCBOT] Environment: ${process.env.NODE_ENV || 'development'}`);
    console.log('--------------------------------');
});