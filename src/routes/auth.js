/**
 * Authentication Routes
 *
 * Handles SAML login, logout, and callback routes
 */

const express = require('express');
const { passport, samlStrategy } = require('../middleware/passport');
const router = express.Router();

// Initiate SAML login
router.get('/login', (req, res, next) => {
    console.log('Initiating SAML authentication...');
    passport.authenticate('saml', {
        failureRedirect: '/auth/login-failed',
        successRedirect: '/'
    })(req, res, next);
});

// SAML callback endpoint
router.post('/saml/callback', (req, res, next) => {
    console.log('SAML callback received');
    passport.authenticate('saml', {
        failureRedirect: '/auth/login-failed',
        failureFlash: false
    })(req, res, next);
}, (req, res) => {
    console.log('Authentication successful for user:', req.user.username);
    // Redirect to frontend after successful login
    res.redirect('/');
});

// Login failed endpoint
router.get('/login-failed', (req, res) => {
    res.status(401).send(`
        <html>
            <body>
                <h1>Login Failed</h1>
                <p>SAML authentication failed. Please check the logs for details.</p>
                <a href="/">Return to Home</a>
            </body>
        </html>
    `);
});

// Logout endpoint
router.get('/logout', (req, res, next) => {
    if (!req.user) {
        return res.redirect('/');
    }

    // This is the SAML Single Log-Out flow
    samlStrategy.logout(req, (err, requestUrl) => {
        if (err) {
            console.error('SAML logout error:', err);
            return next(err);
        }

        // 1. Terminate the local passport session
        req.logout((logoutErr) => {
            if (logoutErr) {
                console.error('Passport logout error:', logoutErr);
                return next(logoutErr);
            }
            // 2. Destroy the server-side session
            req.session.destroy((sessionErr) => {
                if (sessionErr) {
                    console.error('Session destruction error:', sessionErr);
                    return next(sessionErr);
                }
                // 3. Redirect to the SAML IdP to terminate that session
                res.redirect(requestUrl);
            });
        });
    });
});

// The SAML IdP will redirect the user back to this URL after a successful logout.
// This endpoint can be configured in your IdP's settings and should match SAML_LOGOUT_CALLBACK_URL.
router.get('/logout/callback', (req, res) => {
    // The local session is already destroyed.
    // We can perform any additional cleanup here if needed.
    // For now, just redirect to the home page.
    res.redirect('/');
});

// Get current user info (API endpoint)
router.get('/me', (req, res) => {
    if (req.isAuthenticated()) {
        res.json({
            authenticated: true,
            user: {
                username: req.user.username,
                firstName: req.user.firstName,
                lastName: req.user.lastName,
                affiliation: req.user.affiliation,
                puid: req.user.puid
            }
        });
    } else {
        res.json({ authenticated: false });
    }
});

module.exports = router;