/**
 * Export Change Log Routes
 *
 * Read-only access to the curated log of changes that affect downloaded student
 * chats. Gated to system admins to match the Download Chats page and the
 * /api/students download endpoints the log describes.
 *
 * - GET /api/export-change-log            change log JSON for the in-app modal
 * - GET /api/export-change-log/markdown   downloadable .md (change log + export guide)
 */

const express = require('express');
const router = express.Router();
const { hasSystemAdminAccess } = require('../services/authorization');
const exportChangeLog = require('../services/exportChangeLog');

// Same gate as the chat downloads in routes/students.js.
function requireDownloadAdmin(user, res) {
    if (!user) {
        res.status(401).json({
            success: false,
            message: 'Authentication required'
        });
        return false;
    }

    if (user.role !== 'instructor' || !hasSystemAdminAccess(user)) {
        res.status(403).json({
            success: false,
            message: 'Only system admins can access student chat download data'
        });
        return false;
    }

    return true;
}

/**
 * GET /api/export-change-log
 * Change log entries, newest first, for rendering in the app.
 */
router.get('/', (req, res) => {
    if (!requireDownloadAdmin(req.user, res)) return;

    try {
        res.json({ success: true, data: exportChangeLog.getChangeLog() });
    } catch (error) {
        console.error('Error loading export change log:', error);
        res.status(500).json({
            success: false,
            message: 'Unable to load the export change log'
        });
    }
});

/**
 * GET /api/export-change-log/markdown
 * The same content as a downloadable Markdown document, with the instructor
 * export guide appended.
 */
router.get('/markdown', (req, res) => {
    if (!requireDownloadAdmin(req.user, res)) return;

    try {
        const markdown = exportChangeLog.renderMarkdown();
        const fileName = exportChangeLog.buildFileName();
        res.setHeader('Content-Type', 'text/markdown; charset=utf-8');
        res.setHeader('Content-Disposition', `attachment; filename="${fileName}"`);
        res.send(markdown);
    } catch (error) {
        console.error('Error rendering export change log Markdown:', error);
        res.status(500).json({
            success: false,
            message: 'Unable to render the export change log'
        });
    }
});

module.exports = router;
