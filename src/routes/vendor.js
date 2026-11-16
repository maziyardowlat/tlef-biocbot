/**
 * Browser libraries served from installed packages.
 *
 * The pages' other libraries (KaTeX, Chart.js, SmilesDrawer) load from a CDN
 * at a pinned version. The agents framework is on GitHub Packages, which no
 * CDN serves, so its chat client is served from node_modules, at the version
 * package.json pins.
 */
const path = require('path');
const express = require('express');

const router = express.Router();

/**
 * The agents framework's chat client as a classic script, which sets
 * window.UbcAgentsChat for the student page (public/student/scripts/student-chat-request.js).
 * Null where the framework isn't installed. The agent path is off there too.
 * @returns {string|null}
 */
function agentsChatClientPath() {
    try {
        return require.resolve('@ubc/genai-toolkit-agents-chat/client.global.js');
    } catch (error) {
        if (error.code !== 'MODULE_NOT_FOUND') throw error;
        return null;
    }
}

const AGENTS_CHAT_CLIENT = agentsChatClientPath();

router.get('/agents-chat.js', (req, res) => {
    if (!AGENTS_CHAT_CLIENT) return res.sendStatus(404);
    // Sent from its own folder, so the folders above it (such as a
    // .claude/worktrees checkout) aren't checked for dotfiles.
    res.sendFile(path.basename(AGENTS_CHAT_CLIENT), { root: path.dirname(AGENTS_CHAT_CLIENT) });
});

module.exports = router;
