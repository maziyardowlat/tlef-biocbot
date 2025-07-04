const express = require('express');
const router = express.Router();

// This file acts as an assembler for all API-specific routes.
// These routes are all mounted under the `/api` prefix in `server.js`.

// Log all API requests
router.use((req, res, next) => {
    console.log(`BIOCBOT API: ${req.method} ${req.originalUrl}`);
    next();
});

// Import all route modules
const healthRoutes = require('./health');
const timestampRoutes = require('./timestamp');
const echoRoutes = require('./echo');

// Mount routes
router.use(healthRoutes);
router.use(timestampRoutes);
router.use(echoRoutes);

module.exports = router;