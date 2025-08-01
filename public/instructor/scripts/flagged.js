/**
 * Flagged Content Management JavaScript
 * Handles displaying and moderating student-flagged responses
 */

/**
 * Application state management
 */
const appState = {
    flags: [],
    filteredFlags: [],
    currentFilters: {
        flagType: 'all',
        status: 'pending'
    },
    stats: {
        totalFlags: 0,
        pendingFlags: 0,
        flagsToday: 0
    }
};

/**
 * Initialize the flagged content page
 */
document.addEventListener('DOMContentLoaded', function() {
    initializeEventListeners();
    loadFlaggedContent();
    loadFlagStats();
});

/**
 * Set up event listeners for the page
 */
function initializeEventListeners() {
    // Filter controls
    const flagTypeFilter = document.getElementById('flag-type-filter');
    const statusFilter = document.getElementById('status-filter');
    const refreshButton = document.getElementById('refresh-flags');
    
    if (flagTypeFilter) {
        flagTypeFilter.addEventListener('change', handleFilterChange);
    }
    
    if (statusFilter) {
        statusFilter.addEventListener('change', handleFilterChange);
    }
    
    if (refreshButton) {
        refreshButton.addEventListener('click', handleRefresh);
    }
}

/**
 * Handle filter changes and update the displayed content
 */
function handleFilterChange() {
    const flagTypeFilter = document.getElementById('flag-type-filter');
    const statusFilter = document.getElementById('status-filter');
    
    // Update current filters
    appState.currentFilters.flagType = flagTypeFilter.value;
    appState.currentFilters.status = statusFilter.value;
    
    // Apply filters and re-render
    applyFilters();
    renderFlaggedContent();
}

/**
 * Handle refresh button click
 */
function handleRefresh() {
    const refreshButton = document.getElementById('refresh-flags');
    refreshButton.textContent = 'Refreshing...';
    refreshButton.disabled = true;
    
    Promise.all([loadFlaggedContent(), loadFlagStats()])
        .finally(() => {
            refreshButton.textContent = 'Refresh';
            refreshButton.disabled = false;
        });
}

/**
 * Fetch flagged content from the API
 */
async function loadFlaggedContent() {
    try {
        showLoadingState();
        
        // TODO: Replace with actual instructor ID from auth
        const instructorId = 'instructor-123';
        
        const response = await fetch(`/api/flags?instructorId=${instructorId}`, {
            method: 'GET',
            headers: {
                'Content-Type': 'application/json',
                // 'Authorization': `Bearer ${getAuthToken()}` // TODO: Add when auth is implemented
            }
        });
        
        if (!response.ok) {
            throw new Error(`HTTP error! status: ${response.status}`);
        }
        
        const result = await response.json();
        
        if (result.success) {
            appState.flags = result.data || [];
            applyFilters();
            renderFlaggedContent();
        } else {
            throw new Error(result.message || 'Failed to load flagged content');
        }
        
    } catch (error) {
        console.error('Error loading flagged content:', error);
        showErrorState('Failed to load flagged content. Please try again.');
    }
}

/**
 * Fetch flag statistics from the API
 */
async function loadFlagStats() {
    try {
        // TODO: Replace with actual instructor ID from auth
        const instructorId = 'instructor-123';
        
        const response = await fetch(`/api/flags/stats?instructorId=${instructorId}`, {
            method: 'GET',
            headers: {
                'Content-Type': 'application/json',
                // 'Authorization': `Bearer ${getAuthToken()}` // TODO: Add when auth is implemented
            }
        });
        
        if (!response.ok) {
            throw new Error(`HTTP error! status: ${response.status}`);
        }
        
        const result = await response.json();
        
        if (result.success) {
            appState.stats = result.data;
            updateStatsDisplay();
        }
        
    } catch (error) {
        console.error('Error loading flag stats:', error);
        // Don't show error for stats, just use defaults
    }
}

/**
 * Apply current filters to the flags data
 */
function applyFilters() {
    const { flagType, status } = appState.currentFilters;
    
    appState.filteredFlags = appState.flags.filter(flag => {
        const matchesFlagType = flagType === 'all' || flag.flagType === flagType;
        const matchesStatus = status === 'all' || flag.status === status;
        
        return matchesFlagType && matchesStatus;
    });
}

/**
 * Render the flagged content list
 */
function renderFlaggedContent() {
    const flaggedList = document.getElementById('flagged-list');
    const loadingState = document.getElementById('loading-state');
    const emptyState = document.getElementById('empty-state');
    
    // Hide loading state
    if (loadingState) {
        loadingState.style.display = 'none';
    }
    
    if (!flaggedList) return;
    
    // Clear existing content
    flaggedList.innerHTML = '';
    
    if (appState.filteredFlags.length === 0) {
        // Show empty state
        if (emptyState) {
            emptyState.style.display = 'block';
        }
        return;
    }
    
    // Hide empty state
    if (emptyState) {
        emptyState.style.display = 'none';
    }
    
    // Render each flagged item
    appState.filteredFlags.forEach(flag => {
        const flagElement = createFlagElement(flag);
        flaggedList.appendChild(flagElement);
    });
}

/**
 * Create a DOM element for a single flagged item
 * @param {Object} flag - The flag data object
 * @returns {HTMLElement} The created flag element
 */
function createFlagElement(flag) {
    const flagDiv = document.createElement('div');
    flagDiv.className = 'flagged-item';
    flagDiv.setAttribute('data-flag-id', flag.id);
    
    // Format timestamp for display
    const timestamp = formatTimestamp(flag.timestamp || flag.createdAt);
    
    // Create flag type display text
    const flagTypeDisplay = getFlagTypeDisplay(flag.flagType);
    
    flagDiv.innerHTML = `
        <div class="flag-header">
            <div class="flag-meta">
                <div class="flag-type ${flag.flagType}">${flagTypeDisplay}</div>
                <div class="flag-student-info">Flagged by: Student ${flag.studentId}</div>
                <div class="flag-timestamp">${timestamp}</div>
            </div>
            <div class="flag-status">
                <span class="status-badge ${flag.status}">${getStatusDisplayText(flag.status)}</span>
            </div>
        </div>
        
        <div class="flag-content">
            <div class="flag-content-label">Flagged Response:</div>
            <div class="flag-message">${escapeHtml(flag.messageText)}</div>
        </div>
        
        <div class="flag-actions">
            ${createActionButtons(flag)}
        </div>
    `;
    
    return flagDiv;
}

/**
 * Create action buttons based on flag status
 * @param {Object} flag - The flag data object
 * @returns {string} HTML for action buttons
 */
function createActionButtons(flag) {
    if (flag.status === 'pending') {
        return `
            <button class="action-btn approve-btn" onclick="showApprovalForm('${flag.id}')">
                Approve
            </button>
            <button class="action-btn dismiss-btn" onclick="handleFlagAction('${flag.id}', 'rejected')">
                Dismiss
            </button>
            <div id="approval-form-${flag.id}" class="approval-form" style="display: none;">
                <div class="form-header">
                    <h4>Send Follow-up to Student</h4>
                    <p class="form-description">This message will be sent to the student who flagged this content.</p>
                </div>
                <div class="form-group">
                    <label for="message-content-${flag.id}">Message:</label>
                    <textarea id="message-content-${flag.id}" class="message-textarea" rows="4">Thanks for flagging this, please follow up on this email or come to my office hours if you are still working on this topic</textarea>
                </div>
                <div class="form-actions">
                    <button class="action-btn send-approve-btn" onclick="sendApprovalMessage('${flag.id}')">
                        Send & Approve
                    </button>
                    <button class="action-btn cancel-btn" onclick="hideApprovalForm('${flag.id}')">
                        Cancel
                    </button>
                </div>
                <!-- Hidden email field for backend processing -->
                <input type="hidden" id="student-email-${flag.id}" value="student.${flag.studentId}@university.edu">
            </div>
        `;
    } else {
        return `
            <button class="action-btn view-btn" onclick="viewFlagDetails('${flag.id}')">
                View Details
            </button>
        `;
    }
}

/**
 * Show the approval form for a specific flag
 * @param {string} flagId - The flag ID
 */
function showApprovalForm(flagId) {
    const approvalForm = document.getElementById(`approval-form-${flagId}`);
    const approveButton = document.querySelector(`[data-flag-id="${flagId}"] .approve-btn`);
    const dismissButton = document.querySelector(`[data-flag-id="${flagId}"] .dismiss-btn`);
    
    if (approvalForm) {
        approvalForm.style.display = 'block';
        approvalForm.scrollIntoView({ behavior: 'smooth', block: 'nearest' });
        
        // Hide the action buttons while form is open
        if (approveButton) approveButton.style.display = 'none';
        if (dismissButton) dismissButton.style.display = 'none';
    }
}

/**
 * Hide the approval form for a specific flag
 * @param {string} flagId - The flag ID
 */
function hideApprovalForm(flagId) {
    const approvalForm = document.getElementById(`approval-form-${flagId}`);
    const approveButton = document.querySelector(`[data-flag-id="${flagId}"] .approve-btn`);
    const dismissButton = document.querySelector(`[data-flag-id="${flagId}"] .dismiss-btn`);
    
    if (approvalForm) {
        approvalForm.style.display = 'none';
        
        // Show the action buttons again
        if (approveButton) approveButton.style.display = 'inline-block';
        if (dismissButton) dismissButton.style.display = 'inline-block';
    }
}

/**
 * Send approval message and approve the flag
 * @param {string} flagId - The flag ID
 */
async function sendApprovalMessage(flagId) {
    try {
        const emailInput = document.getElementById(`student-email-${flagId}`);
        const messageTextarea = document.getElementById(`message-content-${flagId}`);
        
        if (!emailInput || !messageTextarea) {
            throw new Error('Form elements not found');
        }
        
        const studentEmail = emailInput.value.trim(); // Hidden field, automatically generated
        const messageContent = messageTextarea.value.trim();
        
        if (!messageContent) {
            alert('Please enter a message to send to the student.');
            return;
        }
        
        // Disable form while processing
        const sendButton = document.querySelector(`[data-flag-id="${flagId}"] .send-approve-btn`);
        const cancelButton = document.querySelector(`[data-flag-id="${flagId}"] .cancel-btn`);
        
        if (sendButton) {
            sendButton.textContent = 'Sending...';
            sendButton.disabled = true;
        }
        if (cancelButton) {
            cancelButton.disabled = true;
        }
        
        // TODO: In a real implementation, this would send an actual email
        // For now, we'll simulate the email sending and then approve the flag
        console.log('Sending follow-up email:', {
            to: studentEmail,
            message: messageContent,
            flagId: flagId
        });
        
        // Simulate email sending delay
        await new Promise(resolve => setTimeout(resolve, 1000));
        
        // Now approve the flag (without showing the regular success message)
        await handleFlagAction(flagId, 'approved', true); // Pass true to skip success message
        
        // Show combined success message
        showSuccessMessage('Follow-up email sent to student and flag approved successfully');
        
    } catch (error) {
        console.error('Error sending approval message:', error);
        showErrorMessage('Failed to send message. Please try again.');
        
        // Re-enable form
        const sendButton = document.querySelector(`[data-flag-id="${flagId}"] .send-approve-btn`);
        const cancelButton = document.querySelector(`[data-flag-id="${flagId}"] .cancel-btn`);
        
        if (sendButton) {
            sendButton.textContent = 'Send & Approve';
            sendButton.disabled = false;
        }
        if (cancelButton) {
            cancelButton.disabled = false;
        }
    }
}

/**
 * Handle flag action (approve/reject)
 * @param {string} flagId - The flag ID
 * @param {string} action - The action to take (approved/rejected)
 * @param {boolean} skipSuccessMessage - Whether to skip showing the success message
 */
async function handleFlagAction(flagId, action, skipSuccessMessage = false) {
    try {
        // Disable buttons to prevent double-clicking
        const flagElement = document.querySelector(`[data-flag-id="${flagId}"]`);
        const buttons = flagElement.querySelectorAll('.action-btn');
        buttons.forEach(btn => btn.disabled = true);
        
        // TODO: Replace with actual instructor ID from auth
        const instructorId = 'instructor-123';
        
        const response = await fetch(`/api/flags/${flagId}?instructorId=${instructorId}`, {
            method: 'PUT',
            headers: {
                'Content-Type': 'application/json',
                // 'Authorization': `Bearer ${getAuthToken()}` // TODO: Add when auth is implemented
            },
            body: JSON.stringify({
                status: action,
                instructorComment: `Flag ${action} by instructor`
            })
        });
        
        if (!response.ok) {
            throw new Error(`HTTP error! status: ${response.status}`);
        }
        
        const result = await response.json();
        
        if (result.success) {
            // Update the flag in local state
            const flagIndex = appState.flags.findIndex(flag => flag.id === flagId);
            if (flagIndex !== -1) {
                appState.flags[flagIndex].status = action;
            }
            
            // Re-apply filters and re-render
            applyFilters();
            renderFlaggedContent();
            
            // Refresh stats
            loadFlagStats();
            
            // Show success message only if not skipped
            if (!skipSuccessMessage) {
                const actionText = action === 'rejected' ? 'dismissed' : action;
                showSuccessMessage(`Flag ${actionText} successfully`);
            }
            
        } else {
            throw new Error(result.message || `Failed to ${action} flag`);
        }
        
    } catch (error) {
        const actionText = action === 'rejected' ? 'dismiss' : action;
        console.error(`Error ${actionText} flag:`, error);
        showErrorMessage(`Failed to ${actionText} flag. Please try again.`);
        
        // Re-enable buttons
        const flagElement = document.querySelector(`[data-flag-id="${flagId}"]`);
        const buttons = flagElement.querySelectorAll('.action-btn');
        buttons.forEach(btn => btn.disabled = false);
    }
}

/**
 * View flag details (placeholder for future implementation)
 * @param {string} flagId - The flag ID
 */
function viewFlagDetails(flagId) {
    const flag = appState.flags.find(f => f.id === flagId);
    if (flag) {
        // TODO: Implement detailed view modal or navigation
        alert(`Flag Details:\n\nStudent: ${flag.studentId}\nType: ${flag.flagType}\nStatus: ${flag.status}\nTimestamp: ${flag.timestamp}\n\nMessage: ${flag.messageText}`);
    }
}

/**
 * Update the statistics display
 */
function updateStatsDisplay() {
    const totalElement = document.getElementById('total-flags');
    const pendingElement = document.getElementById('pending-flags');
    const todayElement = document.getElementById('today-flags');
    
    if (totalElement) {
        totalElement.textContent = appState.stats.totalFlags || 0;
    }
    
    if (pendingElement) {
        pendingElement.textContent = appState.stats.pendingFlags || 0;
    }
    
    if (todayElement) {
        todayElement.textContent = appState.stats.flagsToday || 0;
    }
}

/**
 * Show loading state
 */
function showLoadingState() {
    const loadingState = document.getElementById('loading-state');
    const emptyState = document.getElementById('empty-state');
    const flaggedList = document.getElementById('flagged-list');
    
    if (loadingState) {
        loadingState.style.display = 'block';
    }
    
    if (emptyState) {
        emptyState.style.display = 'none';
    }
    
    if (flaggedList) {
        flaggedList.innerHTML = '';
    }
}

/**
 * Show error state
 * @param {string} message - Error message to display
 */
function showErrorState(message) {
    const loadingState = document.getElementById('loading-state');
    const emptyState = document.getElementById('empty-state');
    const flaggedList = document.getElementById('flagged-list');
    
    if (loadingState) {
        loadingState.style.display = 'none';
    }
    
    if (emptyState) {
        emptyState.innerHTML = `<p style="color: #ef4444;">${message}</p>`;
        emptyState.style.display = 'block';
    }
    
    if (flaggedList) {
        flaggedList.innerHTML = '';
    }
}

/**
 * Utility Functions
 */

/**
 * Format timestamp for display
 * @param {string} timestamp - ISO timestamp string
 * @returns {string} Formatted timestamp
 */
function formatTimestamp(timestamp) {
    if (!timestamp) return 'Unknown';
    
    try {
        const date = new Date(timestamp);
        const now = new Date();
        const diffMs = now - date;
        const diffMins = Math.floor(diffMs / 60000);
        const diffHours = Math.floor(diffMs / 3600000);
        const diffDays = Math.floor(diffMs / 86400000);
        
        if (diffMins < 1) {
            return 'Just now';
        } else if (diffMins < 60) {
            return `${diffMins} minute${diffMins === 1 ? '' : 's'} ago`;
        } else if (diffHours < 24) {
            return `${diffHours} hour${diffHours === 1 ? '' : 's'} ago`;
        } else if (diffDays < 7) {
            return `${diffDays} day${diffDays === 1 ? '' : 's'} ago`;
        } else {
            return date.toLocaleDateString();
        }
    } catch (error) {
        return 'Invalid date';
    }
}

/**
 * Get display text for flag type
 * @param {string} flagType - The flag type
 * @returns {string} Display text
 */
function getFlagTypeDisplay(flagType) {
    const displays = {
        'incorrectness': 'Incorrect',
        'inappropriate': 'Inappropriate',
        'irrelevant': 'Irrelevant'
    };
    
    return displays[flagType] || flagType;
}

/**
 * Get display text for status
 * @param {string} status - The status value
 * @returns {string} Display text
 */
function getStatusDisplayText(status) {
    const displays = {
        'pending': 'Pending',
        'approved': 'Approved',
        'rejected': 'Dismissed'
    };
    
    return displays[status] || status;
}

/**
 * Escape HTML to prevent XSS
 * @param {string} text - Text to escape
 * @returns {string} Escaped text
 */
function escapeHtml(text) {
    const div = document.createElement('div');
    div.textContent = text;
    return div.innerHTML;
}

/**
 * Show success message (simple implementation)
 * @param {string} message - Success message
 */
function showSuccessMessage(message) {
    // Calculate position based on existing toasts
    const existingToasts = document.querySelectorAll('.success-toast');
    const topOffset = 20 + (existingToasts.length * 60); // Stack toasts 60px apart
    
    // Simple toast notification implementation
    const toast = document.createElement('div');
    toast.className = 'success-toast';
    toast.textContent = message;
    toast.style.cssText = `
        position: fixed;
        top: ${topOffset}px;
        right: 20px;
        background: #10b981;
        color: white;
        padding: 12px 20px;
        border-radius: 6px;
        box-shadow: 0 4px 12px rgba(0, 0, 0, 0.15);
        z-index: 1000;
        font-size: 14px;
        font-weight: 500;
        animation: slideInRight 0.3s ease-out;
        max-width: 300px;
        word-wrap: break-word;
    `;
    
    // Add animation keyframes to document if not already added
    if (!document.querySelector('#toast-animations')) {
        const style = document.createElement('style');
        style.id = 'toast-animations';
        style.textContent = `
            @keyframes slideInRight {
                from { transform: translateX(100%); opacity: 0; }
                to { transform: translateX(0); opacity: 1; }
            }
            @keyframes slideOutRight {
                from { transform: translateX(0); opacity: 1; }
                to { transform: translateX(100%); opacity: 0; }
            }
        `;
        document.head.appendChild(style);
    }
    
    document.body.appendChild(toast);
    
    // Auto-remove after 4 seconds (longer for longer message)
    setTimeout(() => {
        toast.style.animation = 'slideOutRight 0.3s ease-out';
        setTimeout(() => {
            if (toast.parentNode) {
                toast.parentNode.removeChild(toast);
            }
        }, 300);
    }, 4000);
    
    console.log('Success:', message);
}

/**
 * Show error message (simple implementation)
 * @param {string} message - Error message
 */
function showErrorMessage(message) {
    // TODO: Implement proper toast notification system
    console.error('Error:', message);
    alert(message); // Temporary simple alert
}

/**
 * Get auth token from storage (placeholder for future implementation)
 * @returns {string|null} Auth token
 */
function getAuthToken() {
    // TODO: Implement actual token retrieval from localStorage/sessionStorage
    return null;
}