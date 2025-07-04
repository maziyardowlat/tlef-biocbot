const express = require('express');
const router = express.Router();
const { tlefClient } = require('../services/tlef-client');

// Echo message via TLEF-SERVER
router.post('/echo', async (req, res) => {
    try {
        const { message } = req.body;

        if (!message) {
            return res.status(400).json({ error: 'Message is required' });
        }

        const response = await tlefClient.post('/api/biocbot/echo', {
            message
        });

        // Add any BIOCBOT-specific processing
        const enrichedData = {
            ...response.data,
            processedBy: 'BIOCBOT Backend',
            originalLength: message.length
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