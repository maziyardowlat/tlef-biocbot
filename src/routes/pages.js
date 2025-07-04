/**
 * Page-Serving Routes
 *
 * These routes are responsible for serving the main HTML shell of the single-page application.
 * They ensure that when a user navigates directly to a client-side route (like '/' or '/settings'),
 * the server responds with the main `index.html` file, allowing the client-side
 * JavaScript router to take over.
 */
const express = require('express');
const router = express.Router();
const path = require('path');
const requireAuth = require('../middleware/requireAuth');

// The home page route. Serves the main application shell.
// Authentication is not required here; the client-side code will handle
// rendering the login prompt if the user is not authenticated.
router.get('/', (req, res) => {
    res.sendFile(path.resolve(__dirname, '..', '..', 'public', 'index.html'));
});

// The settings page route. This route requires authentication.
// If the user is not logged in, the `requireAuth` middleware will redirect them
// to the login page. Otherwise, it serves the main application shell, and the
// client-side router will display the settings component.
router.get('/settings', requireAuth, (req, res) => {
    res.sendFile(path.resolve(__dirname, '..', '..', 'public', 'index.html'));
});

module.exports = router;