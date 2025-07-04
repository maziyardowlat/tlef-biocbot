const express = require('express');
const router = express.Router();
const { tlefClient } = require('../services/tlef-client');
const requireAuth = require('../middleware/requireAuth');

// Get timestamp from TLEF-SERVER - NOW REQUIRES AUTHENTICATION
router.get('/timestamp', requireAuth, async (req, res) => {
    try {
        // Include user context in the request to TLEF-SERVER
        const response = await tlefClient.get('/api/biocbot/timestamp', {
            headers: {
                // Add user context for audit logging
                'X-User-ID': req.user.puid,
                'X-User-Name': req.user.username,
                'X-User-Affiliation': req.user.affiliation
            }
        });

        // Add any BIOCBOT-specific processing here
        const enrichedData = {
            ...response.data,
            processedBy: 'BIOCBOT Backend',
            forwardedAt: new Date().toISOString(),
            requestedBy: {
                username: req.user.username,
                name: `${req.user.firstName} ${req.user.lastName}`,
                affiliation: req.user.affiliation
            }
        };

        res.json(enrichedData);
    } catch (error) {
        console.error('Error calling TLEF-SERVER:', error.message);
        res.status(error.response?.status || 500).json({
            error: 'Failed to communicate with TLEF-SERVER',
            message: error.message
        });
    }
});

module.exports = router;