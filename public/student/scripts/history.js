/**
 * Chat History Management
 * Handles loading, displaying, and managing chat history from localStorage
 */

let currentSelectedChat = null;
let allChatHistory = [];

/**
 * Get all chat history entries for the current student
 * @returns {Array} Array of chat history entries
 */
function getChatHistory() {
    try {
        // Get current student ID for security
        const studentId = getCurrentStudentId();
        if (!studentId) {
            console.error('No student ID found - cannot load chat history');
            return [];
        }
        
        const historyKey = `biocbot_chat_history_${studentId}`;
        return JSON.parse(localStorage.getItem(historyKey) || '[]');
    } catch (error) {
        console.error('Error getting chat history:', error);
        return [];
    }
}

/**
 * Get a specific chat by ID
 * @param {string} chatId - The chat ID
 * @returns {Object|null} Chat data or null if not found
 */
function getChatById(chatId) {
    try {
        const history = getChatHistory();
        return history.find(chat => chat.id === chatId) || null;
    } catch (error) {
        console.error('Error getting chat by ID:', error);
        return null;
    }
}

/**
 * Delete a chat from history (server-side)
 * @param {string} chatId - The chat ID to delete
 * @returns {Promise<boolean>} True if successful
 */
async function deleteChatFromHistory(chatId) {
    try {
        const studentId = getCurrentStudentId();
        if (!studentId) {
            console.error('No student ID found - cannot delete chat');
            return false;
        }

        const courseId = localStorage.getItem('selectedCourseId') || 'BIOC202-1758488753872';
        console.log('Using course ID for deletion:', courseId);
        
        // Delete from server using the student-accessible endpoint
        const response = await fetch(`/api/students/${courseId}/${studentId}/sessions/${chatId}/own`, {
            method: 'DELETE',
            credentials: 'include'
        });

        if (!response.ok) {
            throw new Error(`Failed to delete chat session: ${response.status}`);
        }

        const result = await response.json();
        if (!result.success) {
            throw new Error(result.message || 'Failed to delete chat session');
        }

        console.log('Successfully deleted chat session from server');
        
        // Also remove from localStorage as backup
        const history = getChatHistory();
        const filteredHistory = history.filter(chat => chat.id !== chatId);
        const historyKey = `biocbot_chat_history_${studentId}`;
        localStorage.setItem(historyKey, JSON.stringify(filteredHistory));
        
        return true;
    } catch (error) {
        console.error('Error deleting chat from history:', error);
        // Fallback to localStorage only
        try {
            const history = getChatHistory();
            const filteredHistory = history.filter(chat => chat.id !== chatId);
            const studentId = getCurrentStudentId();
            if (studentId) {
                const historyKey = `biocbot_chat_history_${studentId}`;
                localStorage.setItem(historyKey, JSON.stringify(filteredHistory));
                return true;
            }
        } catch (fallbackError) {
            console.error('Error in fallback delete:', fallbackError);
        }
        return false;
    }
}

/**
 * Get current user information
 * @returns {Object|null} Current user object or null
 */
function getCurrentUser() {
    // First try to get from window.currentUser (set by auth:ready event)
    if (window.currentUser) {
        return window.currentUser;
    }
    
    // This function should be available from auth.js
    if (typeof window.getCurrentUser === 'function' && window.getCurrentUser !== getCurrentUser) {
        return window.getCurrentUser();
    }
    
    // Fallback: try to get from localStorage
    try {
        const storedUser = localStorage.getItem('currentUser');
        if (storedUser) {
            return JSON.parse(storedUser);
        }
    } catch (error) {
        console.error('Error parsing stored user:', error);
    }
    
    return null;
}

/**
 * Get current student ID
 * @returns {string|null} Current student ID or null
 */
function getCurrentStudentId() {
    try {
        const user = getCurrentUser();
        
        if (user && user.userId) {
            return user.userId;
        }
        
        // Fallback: try to get from localStorage
        const storedUser = localStorage.getItem('currentUser');
        
        if (storedUser) {
            const userData = JSON.parse(storedUser);
            return userData.userId || null;
        }
        
        return null;
    } catch (error) {
        console.error('Error getting current student ID:', error);
        return null;
    }
}

document.addEventListener('DOMContentLoaded', () => {
    console.log('Chat history page loaded');
    
    // Wait for auth to be ready before initializing
    if (typeof window.getCurrentUser === 'function') {
        const user = window.getCurrentUser();
        console.log('Auth function available, current user:', user);
        if (user && user.userId) {
            console.log('User is authenticated, initializing immediately');
            initializeHistoryPage();
            loadChatHistory();
            setupEventListeners();
        } else {
            console.log('Auth function available but user not authenticated, waiting for auth:ready event');
            document.addEventListener('auth:ready', (event) => {
                console.log('Auth ready event received, initializing');
                console.log('Auth ready event detail:', event.detail);
                // Store the user data from the event
                if (event.detail) {
                    window.currentUser = event.detail;
                    console.log('Stored user from event:', window.currentUser);
                }
                initializeHistoryPage();
                loadChatHistory();
                setupEventListeners();
            });
        }
    } else {
        console.log('Auth not ready, waiting for auth:ready event');
        document.addEventListener('auth:ready', (event) => {
            console.log('Auth ready event received, initializing');
            console.log('Auth ready event detail:', event.detail);
            // Store the user data from the event
            if (event.detail) {
                window.currentUser = event.detail;
                console.log('Stored user from event:', window.currentUser);
            }
            initializeHistoryPage();
            loadChatHistory();
            setupEventListeners();
        });
    }
    
    // Fallback: try after a delay if still not initialized
    setTimeout(() => {
        console.log('Fallback initialization after delay');
        if (typeof window.getCurrentUser === 'function') {
            const user = window.getCurrentUser();
            console.log('Fallback - current user:', user);
            if (user && user.userId) {
                console.log('Fallback - user authenticated, initializing');
                initializeHistoryPage();
                loadChatHistory();
                setupEventListeners();
            }
        }
    }, 3000);
});

/**
 * Initialize the history page
 */
function initializeHistoryPage() {
    // Load current user information
    loadCurrentUserInfo();
}

/**
 * Load current user information and update UI
 */
async function loadCurrentUserInfo() {
    try {
        console.log('Loading current user info...');
        const currentUser = getCurrentUser();
        console.log('Current user:', currentUser);
        
        if (currentUser) {
            // Update user display name
            const userNameElement = document.getElementById('user-display-name');
            if (userNameElement) {
                userNameElement.textContent = currentUser.displayName || currentUser.username;
            }
            
            // Update user avatar
            const avatarElement = document.querySelector('.user-avatar');
            if (avatarElement) {
                const firstLetter = (currentUser.displayName || currentUser.username).charAt(0).toUpperCase();
                avatarElement.textContent = firstLetter;
            }
        }
    } catch (error) {
        console.error('Error loading user info:', error);
    }
}

/**
 * Load chat history from server
 */
async function loadChatHistory() {
    try {
        const studentId = getCurrentStudentId();
        if (!studentId) {
            console.log('No student ID found, cannot load chat history');
            showNoHistoryMessage();
            return;
        }

        console.log('Loading chat history from server for student:', studentId);
        console.log('🔍 [HISTORY_DEBUG] Current user object:', getCurrentUser());
        console.log('🔍 [HISTORY_DEBUG] Student ID from getCurrentStudentId():', studentId);
        
        // Get the current course from localStorage (same as main chat)
        const courseId = localStorage.getItem('selectedCourseId');
        if (!courseId) {
            console.warn('No course selected in localStorage. Loading from localStorage as fallback.');
            // Try to load from localStorage as fallback
            loadChatHistoryFromLocalStorage();
            return;
        }
        console.log('Using course ID from localStorage:', courseId);
        
        // Fetch chat sessions from server using the student-accessible endpoint
        const response = await fetch(`/api/students/${courseId}/${studentId}/sessions/own`, {
            method: 'GET',
            credentials: 'include'
        });

        if (!response.ok) {
            throw new Error(`Failed to load chat sessions: ${response.status}`);
        }

        console.log('🔍 [HISTORY_DEBUG] Response status:', response.status);
        console.log('🔍 [HISTORY_DEBUG] Response headers:', response.headers);
        
        const result = await response.json();
        console.log('🔍 [HISTORY_DEBUG] Response result:', result);
        
        if (!result.success) {
            throw new Error(result.message || 'Failed to load chat sessions');
        }

        const sessions = result.data?.sessions || [];
        console.log('🔍 [HISTORY_DEBUG] Sessions data:', sessions);
        console.log('Loaded', sessions.length, 'chat sessions from server');
        
        // Convert server sessions to the format expected by the UI
        allChatHistory = (sessions || []).map(session => {
            // Recalculate duration from actual message timestamps
            const calculatedDuration = calculateDurationFromChatData(session.chatData);
            
            return {
                id: session.sessionId,
                title: session.title || `Chat Session ${new Date(session.savedAt).toLocaleDateString()}`,
                preview: generateChatPreview(session.chatData),
                unitName: session.unitName || 'Unknown Unit',
                messageCount: session.messageCount || 0,
                duration: calculatedDuration,
                savedAt: session.savedAt,
                chatData: session.chatData || {}
            };
        });

        if (allChatHistory.length === 0) {
            console.log('No chat history found, showing no history message');
            showNoHistoryMessage();
        } else {
            console.log('Displaying chat history with', allChatHistory.length, 'items');
            displayChatHistory(allChatHistory);
        }
    } catch (error) {
        console.error('Error loading chat history from server:', error);
        // Fallback to localStorage if server fails
        console.log('Falling back to localStorage...');
        loadChatHistoryFromLocalStorage();
    }
}

/**
 * Fallback: Load chat history from localStorage
 */
function loadChatHistoryFromLocalStorage() {
    try {
        allChatHistory = getChatHistory();
        console.log('Loaded chat history from localStorage:', allChatHistory.length, 'chats');
        
        if (allChatHistory.length === 0) {
            console.log('No chat history found in localStorage, showing no history message');
            showNoHistoryMessage();
        } else {
            console.log('Displaying chat history from localStorage with', allChatHistory.length, 'items');
            displayChatHistory(allChatHistory);
        }
    } catch (error) {
        console.error('Error loading chat history from localStorage:', error);
        showNoHistoryMessage();
    }
}

/**
 * Display chat history in the list
 * @param {Array} chatHistory - Array of chat history entries
 */
function displayChatHistory(chatHistory) {
    const historyList = document.getElementById('chat-history-list');
    const noHistoryMessage = document.getElementById('no-history-message');
    
    if (!historyList) return;
    
    // Clear existing content
    historyList.innerHTML = '';
    
    if (chatHistory.length === 0) {
        showNoHistoryMessage();
        return;
    }
    
    // Hide no history message
    if (noHistoryMessage) {
        noHistoryMessage.style.display = 'none';
    }
    
    // Create history items
    chatHistory.forEach((chat, index) => {
        const historyItem = createHistoryItem(chat, index);
        historyList.appendChild(historyItem);
    });
    
    // Select first item by default
    const firstItem = historyList.querySelector('.chat-history-item');
    if (firstItem) {
        firstItem.click();
    }
}

/**
 * Create a history item element
 * @param {Object} chat - Chat history entry
 * @param {number} index - Index in the list
 * @returns {HTMLElement} History item element
 */
function createHistoryItem(chat, index) {
    const item = document.createElement('div');
    item.classList.add('chat-history-item');
    item.dataset.chatId = chat.id;
    item.dataset.index = index;
    
    const title = document.createElement('div');
    title.classList.add('title');
    title.textContent = chat.title;
    
    const preview = document.createElement('div');
    preview.classList.add('preview');
    preview.textContent = chat.preview;
    
    const date = document.createElement('div');
    date.classList.add('date');
    date.textContent = formatHistoryDate(chat.savedAt);
    
    // Add metadata
    const metadata = document.createElement('div');
    metadata.classList.add('metadata');
    metadata.innerHTML = `
        <span class="message-count">${chat.messageCount} messages</span>
        <span class="duration">${chat.duration}</span>
    `;
    
    item.appendChild(title);
    item.appendChild(preview);
    item.appendChild(date);
    item.appendChild(metadata);
    
    return item;
}

/**
 * Show no history message
 */
function showNoHistoryMessage() {
    const historyList = document.getElementById('chat-history-list');
    const noHistoryMessage = document.getElementById('no-history-message');
    
    if (historyList) {
        historyList.innerHTML = '';
    }
    
    if (noHistoryMessage) {
        noHistoryMessage.style.display = 'block';
    }
    
    // Clear preview panel
    clearPreviewPanel();
}

/**
 * Set up event listeners
 */
function setupEventListeners() {
    // Search functionality
    const searchInput = document.getElementById('history-search');
    if (searchInput) {
        searchInput.addEventListener('input', handleSearch);
    }
    
    // Continue chat button
    const continueBtn = document.getElementById('continue-chat-btn');
    if (continueBtn) {
        continueBtn.addEventListener('click', handleContinueChat);
    }
    
    // Delete chat button
    const deleteBtn = document.getElementById('delete-chat-btn');
    if (deleteBtn) {
        deleteBtn.addEventListener('click', handleDeleteChat);
    }
}

/**
 * Handle search input
 * @param {Event} event - Input event
 */
function handleSearch(event) {
    const searchTerm = event.target.value.toLowerCase().trim();
    
    if (searchTerm === '') {
        displayChatHistory(allChatHistory);
        return;
    }
    
    const filteredHistory = allChatHistory.filter(chat => 
        chat.title.toLowerCase().includes(searchTerm) ||
        chat.preview.toLowerCase().includes(searchTerm) ||
        chat.courseName.toLowerCase().includes(searchTerm) ||
        chat.unitName.toLowerCase().includes(searchTerm)
    );
    
    displayChatHistory(filteredHistory);
}

/**
 * Handle history item click
 * @param {string} chatId - ID of the clicked chat
 */
function handleHistoryItemClick(chatId) {
    try {
        // Find the chat data
        const chat = allChatHistory.find(c => c.id === chatId);
        if (!chat) {
            console.error('Chat not found:', chatId);
            return;
        }
        
        // Update current selection
        currentSelectedChat = chat;
        
        // Update UI
        updateSelectedItem(chatId);
        displayChatPreview(chat);
        
    } catch (error) {
        console.error('Error handling history item click:', error);
    }
}

/**
 * Update selected item in the list
 * @param {string} chatId - ID of the selected chat
 */
function updateSelectedItem(chatId) {
    // Remove active class from all items
    const allItems = document.querySelectorAll('.chat-history-item');
    allItems.forEach(item => item.classList.remove('active'));
    
    // Add active class to selected item
    const selectedItem = document.querySelector(`[data-chat-id="${chatId}"]`);
    if (selectedItem) {
        selectedItem.classList.add('active');
    }
}

/**
 * Display chat preview in the preview panel
 * @param {Object} chat - Chat data to preview
 */
function displayChatPreview(chat) {
    const previewTitle = document.getElementById('preview-title');
    const previewActions = document.getElementById('preview-actions');
    const previewMessages = document.getElementById('preview-messages');
    
    if (!previewTitle || !previewActions || !previewMessages) return;
    
    // Update title
    previewTitle.textContent = chat.title;
    
    // Show actions
    previewActions.style.display = 'flex';
    
    // Clear and populate messages
    previewMessages.innerHTML = '';
    
    // Show first few messages (up to 5)
    const messagesToShow = chat.chatData.messages.slice(0, 5);
    
    messagesToShow.forEach(messageData => {
        const messageElement = createPreviewMessage(messageData);
        previewMessages.appendChild(messageElement);
    });
    
    // Add "..." if there are more messages
    if (chat.chatData.messages.length > 5) {
        const moreElement = document.createElement('div');
        moreElement.classList.add('more-messages');
        moreElement.innerHTML = `<p>... and ${chat.chatData.messages.length - 5} more messages</p>`;
        previewMessages.appendChild(moreElement);
    }
}

/**
 * Create a preview message element
 * @param {Object} messageData - Message data
 * @returns {HTMLElement} Message element
 */
function createPreviewMessage(messageData) {
    const messageDiv = document.createElement('div');
    messageDiv.classList.add('message', `${messageData.type}-message`);
    
    const avatarDiv = document.createElement('div');
    avatarDiv.classList.add('message-avatar');
    avatarDiv.textContent = messageData.type === 'user' ? 'S' : 'B';
    
    const contentDiv = document.createElement('div');
    contentDiv.classList.add('message-content');
    
    const paragraph = document.createElement('p');
    paragraph.textContent = messageData.content;
    
    const timestamp = document.createElement('span');
    timestamp.classList.add('timestamp');
    timestamp.textContent = messageData.displayTimestamp;
    
    contentDiv.appendChild(paragraph);
    contentDiv.appendChild(timestamp);
    
    messageDiv.appendChild(avatarDiv);
    messageDiv.appendChild(contentDiv);
    
    return messageDiv;
}

/**
 * Clear the preview panel
 */
function clearPreviewPanel() {
    const previewTitle = document.getElementById('preview-title');
    const previewActions = document.getElementById('preview-actions');
    const previewMessages = document.getElementById('preview-messages');
    
    if (previewTitle) {
        previewTitle.textContent = 'Select a Chat';
    }
    
    if (previewActions) {
        previewActions.style.display = 'none';
    }
    
    if (previewMessages) {
        previewMessages.innerHTML = `
            <div class="no-selection">
                <div class="no-selection-content">
                    <div class="no-selection-icon">📋</div>
                    <h4>No Chat Selected</h4>
                    <p>Select a chat from the list to view its contents and continue the conversation.</p>
                </div>
            </div>
        `;
    }
}

/**
 * Handle continue chat button click
 */
function handleContinueChat() {
    if (!currentSelectedChat) {
        console.error('No chat selected');
        return;
    }
    
    try {
        // Store the chat data to be loaded
        sessionStorage.setItem('loadChatData', JSON.stringify(currentSelectedChat.chatData));
        
        // Redirect to chat page
        window.location.href = '/student';
        
    } catch (error) {
        console.error('Error continuing chat:', error);
        alert('Error loading chat. Please try again.');
    }
}

/**
 * Handle delete chat button click
 */
async function handleDeleteChat() {
    if (!currentSelectedChat) {
        console.error('No chat selected');
        return;
    }
    
    if (!confirm('Are you sure you want to delete this chat? This action cannot be undone.')) {
        return;
    }
    
    try {
        // Delete from history
        const success = await deleteChatFromHistory(currentSelectedChat.id);
        
        if (success) {
            // Remove from local array
            allChatHistory = allChatHistory.filter(chat => chat.id !== currentSelectedChat.id);
            
            // Refresh display
            await loadChatHistory();
            
            console.log('Chat deleted successfully');
        } else {
            alert('Error deleting chat. Please try again.');
        }
        
    } catch (error) {
        console.error('Error deleting chat:', error);
        alert('Error deleting chat. Please try again.');
    }
}

/**
 * Format date for display in history
 * @param {string} dateString - ISO date string
 * @returns {string} Formatted date
 */
function formatHistoryDate(dateString) {
    try {
        console.log('🔍 [DATE_DEBUG] Formatting date:', dateString);
        const date = new Date(dateString);
        console.log('🔍 [DATE_DEBUG] Parsed date:', date);
        
        // Check if date is valid
        if (isNaN(date.getTime())) {
            console.error('🔍 [DATE_DEBUG] Invalid date:', dateString);
            return 'Unknown date';
        }
        
        const now = new Date();
        const diffMs = now - date;
        const diffDays = Math.floor(diffMs / (1000 * 60 * 60 * 24));
        
        if (diffDays === 0) {
            return 'Today, ' + date.toLocaleTimeString('en-US', { 
                hour: 'numeric', 
                minute: '2-digit',
                hour12: true 
            });
        } else if (diffDays === 1) {
            return 'Yesterday, ' + date.toLocaleTimeString('en-US', { 
                hour: 'numeric', 
                minute: '2-digit',
                hour12: true 
            });
        } else if (diffDays < 7) {
            return date.toLocaleDateString('en-US', { 
                weekday: 'short',
                hour: 'numeric', 
                minute: '2-digit',
                hour12: true 
            });
        } else {
            return date.toLocaleDateString('en-US', { 
                month: 'short', 
                day: 'numeric',
                year: 'numeric'
            });
        }
    } catch (error) {
        console.error('Error formatting date:', error);
        return 'Unknown date';
    }
}

// Add click event delegation for history items
document.addEventListener('click', (event) => {
    const historyItem = event.target.closest('.chat-history-item');
    if (historyItem) {
        const chatId = historyItem.dataset.chatId;
        if (chatId) {
            handleHistoryItemClick(chatId);
        }
    }
});

/**
 * Generate a preview of the chat session
 * @param {Object} chatData - The chat data object
 * @returns {string} Preview text
 */
function generateChatPreview(chatData) {
    if (!chatData || !chatData.messages || chatData.messages.length === 0) {
        return 'Chat session with BiocBot';
    }
    
    // Find the first user message
    const firstUserMessage = chatData.messages.find(msg => msg.type === 'user');
    if (firstUserMessage) {
        return firstUserMessage.content.substring(0, 100) + (firstUserMessage.content.length > 100 ? '...' : '');
    }
    
    // Find the first bot message
    const firstBotMessage = chatData.messages.find(msg => msg.type === 'bot');
    if (firstBotMessage) {
        return firstBotMessage.content.substring(0, 100) + (firstBotMessage.content.length > 100 ? '...' : '');
    }
    
    return 'Chat session with BiocBot';
}

/**
 * Calculate duration from chat data (first user message to last bot response)
 * @param {Object} chatData - The chat data object
 * @returns {string} Duration in human readable format
 */
function calculateDurationFromChatData(chatData) {
    if (!chatData || !chatData.messages || chatData.messages.length === 0) {
        return '0s';
    }
    
    // Find the first user message (student message)
    const firstUserMessage = chatData.messages.find(msg => msg.type === 'user');
    if (!firstUserMessage || !firstUserMessage.timestamp) {
        return '0s';
    }
    
    // Find the last bot message
    const lastBotMessage = chatData.messages.slice().reverse().find(msg => msg.type === 'bot');
    if (!lastBotMessage || !lastBotMessage.timestamp) {
        // If no bot message found, use the last message
        const lastMessage = chatData.messages[chatData.messages.length - 1];
        if (!lastMessage || !lastMessage.timestamp) {
            return '0s';
        }
        const start = new Date(firstUserMessage.timestamp);
        const end = new Date(lastMessage.timestamp);
        const diffMs = end - start;
        
        const hours = Math.floor(diffMs / (1000 * 60 * 60));
        const minutes = Math.floor((diffMs % (1000 * 60 * 60)) / (1000 * 60));
        const seconds = Math.floor((diffMs % (1000 * 60)) / 1000);
        
        if (hours > 0) {
            return `${hours}h ${minutes}m ${seconds}s`;
        } else if (minutes > 0) {
            return `${minutes}m ${seconds}s`;
        } else {
            return `${seconds}s`;
        }
    }
    
    const start = new Date(firstUserMessage.timestamp);
    const end = new Date(lastBotMessage.timestamp);
    const diffMs = end - start;
    
    const hours = Math.floor(diffMs / (1000 * 60 * 60));
    const minutes = Math.floor((diffMs % (1000 * 60 * 60)) / (1000 * 60));
    const seconds = Math.floor((diffMs % (1000 * 60)) / 1000);
    
    if (hours > 0) {
        return `${hours}h ${minutes}m ${seconds}s`;
    } else if (minutes > 0) {
        return `${minutes}m ${seconds}s`;
    } else {
        return `${seconds}s`;
    }
}

/**
 * Debug function to check localStorage data
 * Call this from browser console: checkLocalStorage()
 */
function checkLocalStorage() {
    console.log('=== LOCALSTORAGE DEBUG ===');
    const studentId = getCurrentStudentId();
    const historyKey = `biocbot_chat_history_${studentId}`;
    console.log('Student ID:', studentId);
    console.log('History key:', historyKey);
    console.log('Current student history:', localStorage.getItem(historyKey));
    console.log('All localStorage keys:', Object.keys(localStorage));
    
    const history = getChatHistory();
    console.log('Parsed chat history:', history);
    console.log('Number of chats:', history.length);
    
    if (history.length > 0) {
        console.log('First chat:', history[0]);
    }
    
    return history;
}

/**
 * Force refresh the history page
 * Call this from browser console: refreshHistory()
 */
function refreshHistory() {
    console.log('Refreshing chat history...');
    loadChatHistory();
}

// Debug function to test continue chat with first available chat
function testContinueChat() {
    console.log('=== TESTING CONTINUE CHAT ===');
    const history = getChatHistory();
    console.log('Available chats:', history.length);
    
    if (history.length > 0) {
        const firstChat = history[0];
        console.log('Testing with first chat:', firstChat);
        
        // Store the chat data in sessionStorage
        sessionStorage.setItem('loadChatData', JSON.stringify(firstChat));
        console.log('Stored chat data in sessionStorage');
        
        // Redirect to chat page
        window.location.href = 'index.html';
    } else {
        console.log('No chats available to test with');
    }
}

/**
 * Remove duplicate chats from history
 * Call this from browser console: removeDuplicates()
 */
async function removeDuplicates() {
    console.log('Removing duplicates from chat history...');
    
    try {
        // For server-side data, we'll work with the current allChatHistory array
        const history = allChatHistory || [];
        console.log('Original history length:', history.length);
        
        // Remove duplicates based on title and savedAt date
        const uniqueHistory = [];
        const seen = new Set();
        
        history.forEach(chat => {
            const key = `${chat.title}_${chat.savedAt}`;
            if (!seen.has(key)) {
                seen.add(key);
                uniqueHistory.push(chat);
            } else {
                console.log('Removing duplicate:', chat.title);
            }
        });
        
        console.log('Unique history length:', uniqueHistory.length);
        console.log('Removed', history.length - uniqueHistory.length, 'duplicates');
        
        // Update the local array
        allChatHistory = uniqueHistory;
        
        // Refresh the display
        await loadChatHistory();
        
        console.log('Duplicates removed and history updated');
        return uniqueHistory;
        
    } catch (error) {
        console.error('Error removing duplicates:', error);
        return [];
    }
}