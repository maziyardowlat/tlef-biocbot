/**
 * TLEF Client Service
 *
 * This module creates and configures an HTTP client for communicating with TLEF-SERVER.
 * It handles authentication, logging, and provides a consistent interface for making
 * requests to TLEF-SERVER from anywhere in the BIOCBOT application.
 *
 * Security: API keys are kept server-side only and included automatically in all requests.
 */

const axios = require('axios');

// Get TLEF-SERVER URL from environment variable with fallback to localhost
const TLEF_SERVER_URL = process.env.TLEF_SERVER_URL || 'http://localhost:7135';

// Get BIOCBOT's API key for authenticating with TLEF-SERVER
const BIOCBOT_API_KEY = process.env.BIOCBOT_API_KEY;

/**
 * Create a configured axios instance for TLEF-SERVER communication
 *
 * This instance includes:
 * - Base URL for all requests
 * - Authentication headers that are automatically included
 * - Timeout to prevent hanging requests
 *
 * Usage example:
 *   const response = await tlefClient.get('/api/biocbot/timestamp');
 *   const data = await tlefClient.post('/api/biocbot/echo', { message: 'Hello' });
 */
const tlefClient = axios.create({
    baseURL: TLEF_SERVER_URL,

    // Default headers included in every request
    headers: {
        // API key for authentication - TLEF-SERVER will validate this
        'X-API-Key': BIOCBOT_API_KEY,

        // App identifier - helps TLEF-SERVER route and validate requests
        'X-App-ID': 'biocbot'
    },

    // 30 second timeout - prevents requests from hanging indefinitely
    // Adjust based on your longest expected operation (e.g., LLM calls might need longer)
    timeout: 30000
});

/**
 * Request Interceptor
 *
 * Interceptors allow us to run code before requests are sent or after responses are received.
 * This is useful for logging, adding auth tokens, or transforming requests/responses.
 */
tlefClient.interceptors.request.use(
    // Success handler - runs before request is sent
    (config) => {
        // Log outgoing requests for debugging
        console.log(`TLEF-SERVER Request: ${config.method?.toUpperCase()} ${config.url}`);

        // Must return the config object or the request won't proceed
        return config;
    },

    // Error handler - runs if there's an error creating the request
    (error) => {
        console.error('TLEF-SERVER Request Error:', error);

        // Reject the promise so calling code can handle the error
        return Promise.reject(error);
    }
);

// Export both the configured client and the URL (URL might be useful for logging/debugging)
module.exports = {
    tlefClient,
    TLEF_SERVER_URL
};

/**
 * USAGE NOTES:
 *
 * 1. Import this module wherever you need to call TLEF-SERVER:
 *    const { tlefClient } = require('../services/tlef-client');
 *
 * 2. Make requests using standard axios methods:
 *    - tlefClient.get(url)
 *    - tlefClient.post(url, data)
 *    - tlefClient.put(url, data)
 *    - tlefClient.delete(url)
 *
 * 3. Always handle errors appropriately:
 *    try {
 *      const response = await tlefClient.get('/endpoint');
 *    } catch (error) {
 *      if (error.response) {
 *        // TLEF-SERVER returned an error response
 *      } else if (error.request) {
 *        // Request was made but no response (network error, timeout)
 *      } else {
 *        // Error setting up the request
 *      }
 *    }
 *
 * 4. The API key is included automatically - never pass it in request body or params
 */