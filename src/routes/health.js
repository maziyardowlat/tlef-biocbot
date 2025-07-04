const express = require('express');
const router = express.Router();
const { TLEF_SERVER_URL } = require('../services/tlef-client');

// Health check endpoint - useful for load balancers and monitoring
router.get('/health', (req, res) => {
    res.json({
        status: 'ok',
        service: 'biocbot',
        timestamp: new Date().toISOString()
    });
});

// Status endpoint - useful for debugging configuration
router.get('/status', (req, res) => {
    res.json({
        app: 'BIOCBOT',
        version: '0.1.0',
        environment: process.env.NODE_ENV || 'development',
        tlefServer: TLEF_SERVER_URL,
        tlefConfigured: !!process.env.BIOCBOT_API_KEY
    });
});

module.exports = router;