/**
 * Student Dashboard Script
 * Handles fetching and managing struggle topics.
 */

document.addEventListener('DOMContentLoaded', async () => {
    // Auth check first
    if (!await checkAuth()) return;

    const topicsContainer = document.getElementById('topics-list-container');
    const activeCountEl = document.getElementById('active-topics-count');
    const directiveStatusEl = document.getElementById('directive-mode-status');
    const resetAllBtn = document.getElementById('reset-all-btn');
    
    // Modal elements
    const modal = document.getElementById('confirm-modal');
    const modalTitle = document.getElementById('modal-title');
    const modalMessage = document.getElementById('modal-message');
    const modalConfirmBtn = document.getElementById('modal-confirm-btn');
    const modalCancelBtn = document.getElementById('modal-cancel-btn');

    let currentStruggleState = null;
    let topicToReset = null;

    // Initialize
    fetchStruggleState();

    // Event Listeners
    resetAllBtn.addEventListener('click', () => showConfirmModal('ALL'));
    modalCancelBtn.addEventListener('click', hideModal);
    modalConfirmBtn.addEventListener('click', confirmReset);

    // Logout handling
    document.getElementById('logout-btn').addEventListener('click', (e) => {
        e.preventDefault();
        Auth.logout();
    });

    /**
     * Fetch struggle state from API
     */
    async function fetchStruggleState() {
        try {
            const response = await fetch('/api/student/struggle');
            const data = await response.json();

            if (data.success) {
                currentStruggleState = data.struggleState;
                renderDashboard(currentStruggleState);
            } else {
                console.error('Failed to fetch struggle state:', data.message);
                topicsContainer.innerHTML = '<p class="error-message">Failed to load topics. Please try again.</p>';
            }
        } catch (error) {
            console.error('Error fetching struggle state:', error);
            topicsContainer.innerHTML = '<p class="error-message">Error connecting to server.</p>';
        }
    }

    /**
     * Render the dashboard with current state
     */
    function renderDashboard(state) {
        if (!state || !state.topics || state.topics.length === 0) {
            topicsContainer.innerHTML = '<p class="empty-state">No struggle topics recorded yet. Great job!</p>';
            activeCountEl.textContent = '0';
            directiveStatusEl.textContent = 'Inactive';
            directiveStatusEl.className = 'summary-status inactive';
            return;
        }

        // Filter and sort topics (most recent struggle first)
        const sortedTopics = state.topics.sort((a, b) => new Date(b.lastStruggle) - new Date(a.lastStruggle));

        const activeTopics = sortedTopics.filter(t => t.isActive);
        activeCountEl.textContent = activeTopics.length;

        if (activeTopics.length > 0) {
            directiveStatusEl.textContent = 'Active';
            directiveStatusEl.className = 'summary-status active';
        } else {
            directiveStatusEl.textContent = 'Inactive';
            directiveStatusEl.className = 'summary-status inactive';
        }

        topicsContainer.innerHTML = '';

        sortedTopics.forEach(topic => {
            const card = document.createElement('div');
            card.className = `topic-card ${topic.isActive ? 'active-struggle' : ''}`;
            
            const lastDate = topic.lastStruggle ? new Date(topic.lastStruggle).toLocaleDateString() : 'N/A';

            card.innerHTML = `
                <div class="topic-info">
                    <h3>${capitalize(topic.topic)}</h3>
                    <div class="topic-meta">
                        <span class="struggle-count">Count: ${topic.count}</span>
                        <span class="last-seen">Last: ${lastDate}</span>
                    </div>
                </div>
                <div class="topic-status">
                    ${topic.isActive 
                        ? '<span class="status-badge alert">Directive Mode On</span>' 
                        : '<span class="status-badge normal">Monitoring</span>'}
                </div>
                <div class="topic-actions">
                    <button class="reset-btn" data-topic="${topic.topic}">Reset</button>
                </div>
            `;

            // Add listener to button
            card.querySelector('.reset-btn').addEventListener('click', () => showConfirmModal(topic.topic));
            
            topicsContainer.appendChild(card);
        });
    }

    /**
     * Show confirmation modal
     */
    function showConfirmModal(topic) {
        topicToReset = topic;
        modal.style.display = 'flex';
        
        if (topic === 'ALL') {
            modalTitle.textContent = 'Reset All Topics?';
            modalMessage.textContent = 'This will clear all your struggle history and disable Directive Mode for all topics. Are you sure?';
        } else {
            modalTitle.textContent = `Reset "${capitalize(topic)}"?`;
            modalMessage.textContent = 'This will reset the struggle count for this topic and disable Directive Mode if active. Are you sure?';
        }
    }

    function hideModal() {
        modal.style.display = 'none';
        topicToReset = null;
    }

    /**
     * Execute reset API call
     */
    async function confirmReset() {
        if (!topicToReset) return;

        try {
            const response = await fetch('/api/student/struggle/reset', {
                method: 'POST',
                headers: {
                    'Content-Type': 'application/json'
                },
                body: JSON.stringify({ topic: topicToReset })
            });

            const result = await response.json();

            if (result.success) {
                // Refresh data
                await fetchStruggleState();
                hideModal();
            } else {
                alert('Failed to reset: ' + result.message);
            }
        } catch (error) {
            console.error('Error resetting topic:', error);
            alert('Error connecting to server.');
        }
    }

    /**
     * Helper: Check Auth
     */
    async function checkAuth() {
        if (window.Auth && typeof window.Auth.checkAuth === 'function') {
            try {
                const user = await window.Auth.checkAuth();
                if (!user) {
                    window.location.href = '/login.html';
                    return false;
                }
                // Update specific UI if needed
                const nameEl = document.getElementById('user-display-name');
                if (nameEl && user.displayName) nameEl.textContent = user.displayName;
                return true;
            } catch (e) {
                window.location.href = '/login.html';
                return false;
            }
        }
        return true;
    }

    function capitalize(str) {
        return str.charAt(0).toUpperCase() + str.slice(1);
    }
});
