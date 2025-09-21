document.addEventListener('DOMContentLoaded', () => {
    const chatForm = document.getElementById('chat-form');
    const chatInput = document.getElementById('chat-input');
    const chatMessages = document.getElementById('chat-messages');
    
    // Initialize chat
    console.log('Student chat interface initialized');
    
    // Load current course information and update UI
    loadCurrentCourseInfo();
    
    // Check for published units and load real assessment questions
    // If no units are published, allow direct chat
    checkPublishedUnitsAndLoadQuestions();
    
    // Initialize mode toggle functionality
    initializeModeToggle();
    
    // Set up periodic timestamp updates
    setInterval(updateTimestamps, 20000); // Update every 20 seconds
    
    /**
     * Format timestamp for display
     * @param {Date} timestamp - The timestamp to format
     * @returns {string} Formatted timestamp string
     */
    function formatTimestamp(timestamp) {
        const now = new Date();
        const diffMs = now - timestamp;
        const diffSeconds = Math.floor(diffMs / 1000);
        const diffMinutes = Math.floor(diffSeconds / 60);
        const diffHours = Math.floor(diffMinutes / 60);
        const diffDays = Math.floor(diffHours / 24);
        
        // Format based on how long ago
        if (diffSeconds < 60) {
            return 'Just now';
        } else if (diffMinutes < 60) {
            return `${diffMinutes} minute${diffMinutes !== 1 ? 's' : ''} ago`;
        } else if (diffHours < 24) {
            return `${diffHours} hour${diffHours !== 1 ? 's' : ''} ago`;
        } else if (diffDays < 7) {
            return `${diffDays} day${diffDays !== 1 ? 's' : ''} ago`;
        } else {
            // For older messages, show actual date
            return timestamp.toLocaleDateString('en-US', {
                month: 'short',
                day: 'numeric',
                hour: 'numeric',
                minute: '2-digit',
                hour12: true
            });
        }
    }
    
    /**
     * Update all timestamps to show relative time
     */
    function updateTimestamps() {
        const timestamps = document.querySelectorAll('.timestamp');
        timestamps.forEach(timestamp => {
            const messageDiv = timestamp.closest('.message');
            if (messageDiv && messageDiv.dataset.timestamp) {
                const messageTime = new Date(parseInt(messageDiv.dataset.timestamp));
                timestamp.textContent = formatTimestamp(messageTime);
            }
        });
    }
    
    /**
     * Send message to LLM service
     * @param {string} message - The message to send
     * @returns {Promise<Object>} Response from LLM service
     */
    async function sendMessageToLLM(message) {
        try {
            // Get current student mode for context
            const currentMode = localStorage.getItem('studentMode') || 'tutor';
            
            const response = await fetch('/api/chat', {
                method: 'POST',
                headers: {
                    'Content-Type': 'application/json'
                },
                body: JSON.stringify({
                    message: message,
                    mode: currentMode
                })
            });
            
            if (!response.ok) {
                const errorData = await response.json();
                throw new Error(errorData.message || `HTTP error! status: ${response.status}`);
            }
            
            const data = await response.json();
            
            if (!data.success) {
                throw new Error(data.message || 'Failed to get response from LLM');
            }
            
            return data;
            
        } catch (error) {
            console.error('Error sending message to LLM:', error);
            throw error;
        }
    }
    
    // Handle chat form submission
    if (chatForm) {
        chatForm.addEventListener('submit', async (e) => {
            e.preventDefault();
            
            const message = chatInput.value.trim();
            if (!message) return;
            
            // Add user message to chat
            addMessage(message, 'user');
            
            // Clear input
            chatInput.value = '';
            
            // Show typing indicator
            showTypingIndicator();
            
            // Send message to real LLM service
            try {
                const response = await sendMessageToLLM(message);
                
                // Remove typing indicator
                removeTypingIndicator();
                
                // Add real bot response
                addMessage(response.message, 'bot', true);
                
            } catch (error) {
                // Remove typing indicator
                removeTypingIndicator();
                
                // Show error message
                console.error('Chat error:', error);
                addMessage('Sorry, I encountered an error processing your message. Please try again.', 'bot', false);
            }
        });
    }
    
    // Function to add a message to the chat
    function addMessage(content, sender, withSource = false) {
        const messageDiv = document.createElement('div');
        messageDiv.classList.add('message', sender + '-message');
        
        const avatarDiv = document.createElement('div');
        avatarDiv.classList.add('message-avatar');
        avatarDiv.textContent = sender === 'user' ? 'S' : 'B';
        
        const contentDiv = document.createElement('div');
        contentDiv.classList.add('message-content');
        
        const paragraph = document.createElement('p');
        paragraph.textContent = content;
        
        contentDiv.appendChild(paragraph);
        
        // Create message footer for bottom elements
        const footerDiv = document.createElement('div');
        footerDiv.classList.add('message-footer');
        
        // Add source citation if needed
        if (withSource && sender === 'bot') {
            const sourceDiv = document.createElement('div');
            sourceDiv.classList.add('message-source');
            sourceDiv.innerHTML = 'Source: TBD';
            footerDiv.appendChild(sourceDiv);
        }
        
        // Create right side container for timestamp and flag button
        const rightContainer = document.createElement('div');
        rightContainer.classList.add('message-footer-right');
        
        const timestamp = document.createElement('span');
        timestamp.classList.add('timestamp');
        
        // Create real timestamp
        const messageTime = new Date();
        timestamp.textContent = formatTimestamp(messageTime);
        
        // Store timestamp in message div for future updates
        messageDiv.dataset.timestamp = messageTime.getTime();
        
        // Add title attribute for exact time on hover
        timestamp.title = messageTime.toLocaleString('en-US', {
            weekday: 'long',
            year: 'numeric',
            month: 'long',
            day: 'numeric',
            hour: 'numeric',
            minute: '2-digit',
            second: '2-digit',
            hour12: true
        });
        
        rightContainer.appendChild(timestamp);
        
        // Add flag button for bot messages in footer
        if (sender === 'bot') {
            const flagButton = document.createElement('button');
            flagButton.classList.add('flag-button');
            flagButton.onclick = function() { toggleFlagMenu(this); };
            flagButton.innerHTML = '<span class="three-dots">⋯</span>';
            
            const flagMenu = document.createElement('div');
            flagMenu.classList.add('flag-menu');
            flagMenu.innerHTML = `
                <button class="flag-option" onclick="flagMessage(this, 'incorrect')">Incorrect</button>
                <button class="flag-option" onclick="flagMessage(this, 'inappropriate')">Inappropriate</button>
                <button class="flag-option" onclick="flagMessage(this, 'unclear')">Unclear</button>
                <button class="flag-option" onclick="flagMessage(this, 'confusing')">Confusing</button>
                <button class="flag-option" onclick="flagMessage(this, 'typo')">Typo/Error</button>
                <button class="flag-option" onclick="flagMessage(this, 'offensive')">Offensive</button>
                <button class="flag-option" onclick="flagMessage(this, 'irrelevant')">Irrelevant</button>
            `;
            
            const flagContainer = document.createElement('div');
            flagContainer.classList.add('message-flag-container');
            flagContainer.appendChild(flagButton);
            flagContainer.appendChild(flagMenu);
            rightContainer.appendChild(flagContainer);
        }
        
        footerDiv.appendChild(rightContainer);
        
        contentDiv.appendChild(footerDiv);
        
        messageDiv.appendChild(avatarDiv);
        messageDiv.appendChild(contentDiv);
        
        chatMessages.appendChild(messageDiv);
        
        // Scroll to bottom
        chatMessages.scrollTop = chatMessages.scrollHeight;
    }
    
    // Function to show typing indicator
    function showTypingIndicator() {
        const typingDiv = document.createElement('div');
        typingDiv.classList.add('message', 'bot-message', 'typing-indicator');
        typingDiv.id = 'typing-indicator';
        
        const avatarDiv = document.createElement('div');
        avatarDiv.classList.add('message-avatar');
        avatarDiv.textContent = 'B';
        
        const dotsDiv = document.createElement('div');
        dotsDiv.classList.add('dots');
        
        for (let i = 0; i < 3; i++) {
            const dot = document.createElement('div');
            dot.classList.add('dot');
            dotsDiv.appendChild(dot);
        }
        
        typingDiv.appendChild(avatarDiv);
        typingDiv.appendChild(dotsDiv);
        
        chatMessages.appendChild(typingDiv);
        
        // Scroll to bottom
        chatMessages.scrollTop = chatMessages.scrollHeight;
    }
    
    // Function to remove typing indicator
    function removeTypingIndicator() {
        const typingIndicator = document.getElementById('typing-indicator');
        if (typingIndicator) {
            typingIndicator.remove();
        }
    }
});

// Global functions for flagging functionality

/**
 * Format timestamp for display (global version)
 * @param {Date} timestamp - The timestamp to format
 * @returns {string} Formatted timestamp string
 */
function formatTimestamp(timestamp) {
    const now = new Date();
    const diffMs = now - timestamp;
    const diffSeconds = Math.floor(diffMs / 1000);
    const diffMinutes = Math.floor(diffSeconds / 60);
    const diffHours = Math.floor(diffMinutes / 60);
    const diffDays = Math.floor(diffHours / 24);
    
    // Format based on how long ago
    if (diffSeconds < 60) {
        return 'Just now';
    } else if (diffMinutes < 60) {
        return `${diffMinutes} minute${diffMinutes !== 1 ? 's' : ''} ago`;
    } else if (diffHours < 24) {
        return `${diffHours} hour${diffHours !== 1 ? 's' : ''} ago`;
    } else if (diffDays < 7) {
        return `${diffDays} day${diffDays !== 1 ? 's' : ''} ago`;
    } else {
        // For older messages, show actual date
        return timestamp.toLocaleDateString('en-US', {
            month: 'short',
            day: 'numeric',
            hour: 'numeric',
            minute: '2-digit',
            hour12: true
        });
    }
}
/**
 * Toggle the flag menu visibility
 * @param {HTMLElement} button - The flag button element
 */
function toggleFlagMenu(button) {
    // Close all other open menus first
    const allMenus = document.querySelectorAll('.flag-menu.show');
    allMenus.forEach(menu => {
        if (menu !== button.nextElementSibling) {
            menu.classList.remove('show');
        }
    });
    
    // Toggle the clicked menu
    const menu = button.nextElementSibling;
    if (menu && menu.classList.contains('flag-menu')) {
        menu.classList.toggle('show');
    }
}

/**
 * Handle flag message action
 * @param {HTMLElement} button - The flag option button
 * @param {string} flagType - The type of flag (now flagReason)
 */
function flagMessage(button, flagType) {
    const menu = button.closest('.flag-menu');
    const messageContent = menu.closest('.message-content');
    const messageText = messageContent.querySelector('p').textContent;
    
    // Close the menu
    menu.classList.remove('show');
    
    // Send flag to server
    submitFlag(messageText, flagType);
    
    // Replace the message content with thank you message
    replaceMessageWithThankYou(messageContent, flagType);
}

/**
 * Submit flag to server
 * @param {string} messageText - The flagged message text
 * @param {string} flagType - The type of flag (now flagReason)
 */
async function submitFlag(messageText, flagType) {
    try {
        // Get current course and student information
        const courseId = await getCurrentCourseId();
        const studentId = getCurrentStudentId();
        const studentName = getCurrentStudentName();
        const unitName = getCurrentUnitName();
        
        // Create flag data for the new flagged questions API
        const flagData = {
            questionId: generateQuestionId(messageText), // Generate a unique ID for this "question"
            courseId: courseId,
            unitName: unitName,
            studentId: studentId,
            studentName: studentName,
            flagReason: flagType,
            flagDescription: `Student flagged bot response as ${flagType}`,
            questionContent: {
                question: messageText,
                questionType: 'bot-response',
                options: {},
                correctAnswer: 'N/A',
                explanation: 'This is a flagged bot response from the student chat interface'
            }
        };
        
        console.log('Submitting flag with data:', flagData);
        
        const response = await fetch('/api/flags', {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json'
            },
            body: JSON.stringify(flagData)
        });
        
        if (!response.ok) {
            throw new Error(`HTTP error! status: ${response.status}`);
        }
        
        const result = await response.json();
        console.log('Flag submitted successfully:', result);
        
    } catch (error) {
        console.error('Error submitting flag:', error);
        // Still show confirmation to user even if server request fails
    }
}

/**
 * Replace the bot message with a thank you message
 * @param {HTMLElement} messageContent - The message content element
 * @param {string} flagType - The type of flag that was submitted (now flagReason)
 */
function replaceMessageWithThankYou(messageContent, flagType) {
    // Get the paragraph element
    const paragraph = messageContent.querySelector('p');
    
    // Map flag types to user-friendly descriptions
    const flagTypeDescriptions = {
        'incorrect': 'incorrect information',
        'inappropriate': 'inappropriate content',
        'unclear': 'unclear or confusing content',
        'confusing': 'confusing content',
        'typo': 'typo or error',
        'offensive': 'offensive content',
        'irrelevant': 'irrelevant content'
    };
    
    const description = flagTypeDescriptions[flagType] || flagType;
    
    // Replace the message text
    paragraph.textContent = `Thank you for reporting this response as ${description}. This has been logged and will be reviewed by your instructor.`;
    
    // Add a visual indicator that this message was flagged
    paragraph.style.color = '#666';
    paragraph.style.fontStyle = 'italic';
    
    // Remove the flag button and menu
    const flagContainer = messageContent.querySelector('.message-flag-container');
    if (flagContainer) {
        flagContainer.remove();
    }
    
    // Update the timestamp to show when it was flagged
    const timestamp = messageContent.querySelector('.timestamp');
    if (timestamp) {
        timestamp.textContent = 'Flagged just now';
        timestamp.style.color = '#888';
    }
    
    // Add a subtle background color to indicate the message was flagged
    messageContent.style.backgroundColor = '#f8f9fa';
    messageContent.style.border = '1px solid #e9ecef';
}



/**
 * Load current course information and update the UI
 */
async function loadCurrentCourseInfo() {
    try {
        console.log('Loading current course information...');
        
        // Get student name first
        const studentName = await getCurrentStudentName();
        console.log('Student name loaded:', studentName);
        
        // Update student name display
        const userNameElement = document.getElementById('user-display-name');
        if (userNameElement && studentName) {
            userNameElement.textContent = studentName;
        }
        
        // Load available courses and show course selection
        await loadAvailableCourses();
        
    } catch (error) {
        console.error('Error loading course information:', error);
        // Keep default display if course loading fails
    }
}

/**
 * Load available courses and show course selection
 */
async function loadAvailableCourses() {
    try {
        console.log('Loading available courses...');
        
        // Check if there's already a selected course in localStorage
        const storedCourseId = localStorage.getItem('selectedCourseId');
        if (storedCourseId) {
            console.log('Found stored course ID, verifying it exists:', storedCourseId);
            // Try to load the stored course, but if it fails, clear localStorage and fetch fresh
            try {
                await loadCourseData(storedCourseId);
                return;
            } catch (error) {
                console.warn('Stored course ID is invalid, clearing localStorage and fetching fresh courses');
                localStorage.removeItem('selectedCourseId');
                // Continue to fetch fresh courses below
            }
        }
        
        // Fetch available courses
        const response = await fetch('/api/courses/available/all');
        if (!response.ok) {
            throw new Error(`Failed to fetch courses: ${response.status}`);
        }
        
        const result = await response.json();
        if (!result.success || !result.data) {
            throw new Error('Invalid courses data received');
        }
        
        const courses = result.data;
        console.log('Available courses loaded:', courses);
        
        if (courses.length === 0) {
            console.log('No courses available');
            showNoCoursesMessage();
            return;
        }
        
        if (courses.length === 1) {
            // Only one course available, use it directly
            console.log('Only one course available, using it directly');
            await loadCourseData(courses[0].courseId);
        } else {
            // Multiple courses available, show selection dropdown
            console.log('Multiple courses available, showing selection');
            showCourseSelection(courses);
        }
        
    } catch (error) {
        console.error('Error loading available courses:', error);
        showNoCoursesMessage();
    }
}

/**
 * Show course selection dropdown
 * @param {Array} courses - Array of available courses
 */
function showCourseSelection(courses) {
    console.log('Showing course selection for courses:', courses);
    
    // Create course selection dropdown
    const courseSelectionHTML = `
        <div class="course-selection-container" style="margin: 20px 0; padding: 15px; background-color: #f8f9fa; border-radius: 8px; border-left: 4px solid var(--primary-color);">
            <h3 style="margin: 0 0 10px 0; color: #333;">Select Your Course</h3>
            <p style="margin: 0 0 15px 0; color: #666;">Choose the course you want to access:</p>
            <select id="course-select" style="width: 100%; padding: 8px; border: 1px solid #ddd; border-radius: 4px; font-size: 14px;">
                <option value="">Choose a course...</option>
                ${courses.map(course => `<option value="${course.courseId}">${course.courseName}</option>`).join('')}
            </select>
        </div>
    `;
    
    // Insert course selection before the chat messages
    const chatMessages = document.getElementById('chat-messages');
    const existingWelcome = chatMessages.querySelector('.message.bot-message');
    
    // Create a container for the course selection
    const courseSelectionDiv = document.createElement('div');
    courseSelectionDiv.innerHTML = courseSelectionHTML;
    courseSelectionDiv.id = 'course-selection-wrapper';
    
    // Insert before the existing welcome message
    if (existingWelcome) {
        chatMessages.insertBefore(courseSelectionDiv, existingWelcome);
    } else {
        chatMessages.appendChild(courseSelectionDiv);
    }
    
    // Add event listener for course selection
    const courseSelect = document.getElementById('course-select');
    if (courseSelect) {
        courseSelect.addEventListener('change', async function() {
            const selectedCourseId = this.value;
            if (selectedCourseId) {
                console.log('Course selected:', selectedCourseId);
                await loadCourseData(selectedCourseId);
                
                // Hide the course selection after selection
                const courseSelectionWrapper = document.getElementById('course-selection-wrapper');
                if (courseSelectionWrapper) {
                    courseSelectionWrapper.style.display = 'none';
                }
            }
        });
    }
}

/**
 * Load course data and update display
 * @param {string} courseId - Course ID to load
 */
async function loadCourseData(courseId) {
    try {
        console.log('Loading course data for:', courseId);
        
        // Store the selected course in localStorage
        localStorage.setItem('selectedCourseId', courseId);
        
        // Fetch course details
        const response = await fetch(`/api/courses/${courseId}`);
        if (!response.ok) {
            throw new Error(`Failed to fetch course data: ${response.status}`);
        }
        
        const courseData = await response.json();
        if (!courseData.success || !courseData.data) {
            throw new Error('Invalid course data received');
        }
        
        const course = courseData.data;
        console.log('Course data loaded:', course);
        
        // Update UI elements with actual course information
        updateCourseDisplay(course);
        
    } catch (error) {
        console.error('Error loading course data:', error);
        
        // If this was a 404 error, clear localStorage and try to load available courses
        if (error.message.includes('404')) {
            console.log('Course not found, clearing localStorage and loading available courses');
            localStorage.removeItem('selectedCourseId');
            await loadAvailableCourses();
            return;
        }
        
        showCourseLoadError();
    }
}

/**
 * Show message when no courses are available
 */
function showNoCoursesMessage() {
    const noCoursesMessage = document.createElement('div');
    noCoursesMessage.classList.add('message', 'bot-message');
    
    const avatarDiv = document.createElement('div');
    avatarDiv.classList.add('message-avatar');
    avatarDiv.textContent = 'B';
    
    const contentDiv = document.createElement('div');
    contentDiv.classList.add('message-content');
    
    const messageText = document.createElement('p');
    messageText.innerHTML = `<strong>No Courses Available</strong><br>
    There are no courses available at this time. Please contact your instructor or administrator.`;
    
    contentDiv.appendChild(messageText);
    
    // Add timestamp
    const timestamp = document.createElement('span');
    timestamp.classList.add('timestamp');
    timestamp.textContent = 'Just now';
    contentDiv.appendChild(timestamp);
    
    noCoursesMessage.appendChild(avatarDiv);
    noCoursesMessage.appendChild(contentDiv);
    
    // Add to chat
    const chatMessages = document.getElementById('chat-messages');
    chatMessages.appendChild(noCoursesMessage);
}

/**
 * Show error message when course loading fails
 */
function showCourseLoadError() {
    const errorMessage = document.createElement('div');
    errorMessage.classList.add('message', 'bot-message');
    
    const avatarDiv = document.createElement('div');
    avatarDiv.classList.add('message-avatar');
    avatarDiv.textContent = 'B';
    
    const contentDiv = document.createElement('div');
    contentDiv.classList.add('message-content');
    
    const messageText = document.createElement('p');
    messageText.innerHTML = `<strong>Error Loading Course</strong><br>
    There was an error loading the course information. Please try refreshing the page or contact support.`;
    
    contentDiv.appendChild(messageText);
    
    // Add timestamp
    const timestamp = document.createElement('span');
    timestamp.classList.add('timestamp');
    timestamp.textContent = 'Just now';
    contentDiv.appendChild(timestamp);
    
    errorMessage.appendChild(avatarDiv);
    errorMessage.appendChild(contentDiv);
    
    // Add to chat
    const chatMessages = document.getElementById('chat-messages');
    chatMessages.appendChild(errorMessage);
}

/**
 * Update the UI with current course information
 * @param {Object} course - Course object with course details
 * @param {string} studentName - Student's display name (optional)
 */
function updateCourseDisplay(course, studentName) {
    // Update course name in header
    const courseNameElement = document.querySelector('.course-name');
    if (courseNameElement && course.courseName) {
        courseNameElement.textContent = course.courseName;
    }
    
    // Update user role display
    const userRoleElement = document.querySelector('.user-role');
    if (userRoleElement && course.courseName) {
        userRoleElement.textContent = `Student - ${course.courseName}`;
    }
    
    // Update student name display if provided
    if (studentName) {
        const userNameElement = document.getElementById('user-display-name');
        if (userNameElement) {
            userNameElement.textContent = studentName;
        }
    }
    
    // Update welcome message
    const welcomeMessage = document.querySelector('.message.bot-message p');
    if (welcomeMessage && course.courseName) {
        welcomeMessage.textContent = `Hello! I'm BiocBot, your AI study assistant for ${course.courseName}. How can I help you today?`;
    }
    
    console.log('Course display updated with:', course.courseName, 'Student:', studentName || 'not provided');
}

/**
 * Get current student ID (placeholder)
 * @returns {string} Student ID
 */
function getCurrentStudentId() {
    // This would typically come from JWT token or session
    // For now, return a placeholder
    return 'student-123';
}

/**
 * Get current student name from user session
 * @returns {Promise<string>} Student name
 */
async function getCurrentStudentName() {
    try {
        const response = await fetch('/api/auth/me');
        if (response.ok) {
            const userData = await response.json();
            if (userData.success && userData.user && userData.user.displayName) {
                return userData.user.displayName;
            }
        }
    } catch (error) {
        console.error('Error fetching student name:', error);
    }
    
    // Fallback to placeholder
    return 'Student Name';
}

/**
 * Get current course ID from user's session, preferences, or localStorage
 * @returns {Promise<string>} Course ID
 */
async function getCurrentCourseId() {
    try {
        // First, try to get the user's current course context from their session
        const userResponse = await fetch('/api/auth/me');
        if (userResponse.ok) {
            const userData = await userResponse.json();
            if (userData.success && userData.user && userData.user.preferences && userData.user.preferences.courseId) {
                console.log('Using course from user preferences:', userData.user.preferences.courseId);
                return userData.user.preferences.courseId;
            }
        }
        
        // Check localStorage for previously selected course
        const storedCourseId = localStorage.getItem('selectedCourseId');
        if (storedCourseId) {
            console.log('Found stored course ID, will verify it exists:', storedCourseId);
            return storedCourseId;
        }
        
        // If no course context, fetch available courses and use the first one
        const response = await fetch('/api/courses/available/all');
        
        if (!response.ok) {
            throw new Error(`HTTP error! status: ${response.status}`);
        }
        
        const result = await response.json();
        
        if (!result.success) {
            throw new Error(result.message || 'Failed to fetch courses');
        }
        
        const courses = result.data;
        
        // Return the first available course ID
        if (courses.length > 0) {
            console.log('Using first available course:', courses[0].courseId);
            // Store it in localStorage for future use
            localStorage.setItem('selectedCourseId', courses[0].courseId);
            return courses[0].courseId;
        }
        
        // Fallback to a default course ID if no courses are available
        console.log('No courses available, using fallback');
        return 'default-course-id';
        
    } catch (error) {
        console.error('Error fetching course ID:', error);
        // Fallback to a default course ID if API fails
        return 'default-course-id';
    }
}

/**
 * Get current unit name (placeholder)
 * @returns {string} Unit name
 */
function getCurrentUnitName() {
    // This would typically come from current session or course context
    // For now, return a placeholder
    return 'Unit 1';
}

/**
 * Generate a unique question ID for flagged bot responses
 * @param {string} messageText - The message text to generate ID from
 * @returns {string} Unique question ID
 */
function generateQuestionId(messageText) {
    const timestamp = Date.now();
    const hash = btoa(messageText.substring(0, 20)).replace(/[^a-zA-Z0-9]/g, '');
    return `bot_response_${timestamp}_${hash}`;
}

/**
 * Get auth token (placeholder)
 * @returns {string} Auth token
 */
function getAuthToken() {
    // This would typically come from localStorage or sessionStorage
    // For now, return a placeholder
    return 'placeholder-token';
}

// Close flag menus when clicking outside
document.addEventListener('click', function(event) {
    if (!event.target.closest('.message-flag-container')) {
        const openMenus = document.querySelectorAll('.flag-menu.show');
        openMenus.forEach(menu => {
            menu.classList.remove('show');
        });
    }
});

// Calibration Questions functionality
let currentCalibrationQuestions = [];
let currentPassThreshold = 2; // Default pass threshold
let currentQuestionIndex = 0;
let studentAnswers = [];

/**
 * Check for published units and load real assessment questions
 * If no units are published, allow direct chat
 */
async function checkPublishedUnitsAndLoadQuestions() {
    try {
        console.log('=== CHECKING FOR PUBLISHED UNITS ===');
        
        // Get current course ID
        const courseId = await getCurrentCourseId();
        console.log('Checking course:', courseId);
        
        // Fetch course data to check which units are published
        console.log(`Making API request to: /api/courses/${courseId}`);
        const response = await fetch(`/api/courses/${courseId}`);
        console.log('API response status:', response.status);
        console.log('API response headers:', Object.fromEntries(response.headers.entries()));
        
        if (!response.ok) {
            const errorText = await response.text();
            console.error('API error response body:', errorText);
            
            // If course not found, clear localStorage and try to load available courses
            if (response.status === 404) {
                console.log('Course not found, clearing localStorage and loading available courses');
                localStorage.removeItem('selectedCourseId');
                await loadAvailableCourses();
                return;
            }
            
            throw new Error(`Failed to fetch course data: ${response.status} - ${errorText}`);
        }
        
        const courseData = await response.json();
        console.log('=== COURSE DATA RECEIVED ===');
        console.log('Full course data:', courseData);
        console.log('Course data structure:', {
            success: courseData.success,
            hasData: !!courseData.data,
            dataKeys: courseData.data ? Object.keys(courseData.data) : 'no data',
            hasLectures: courseData.data && !!courseData.data.lectures,
            lecturesType: courseData.data && courseData.data.lectures ? typeof courseData.data.lectures : 'no lectures',
            lecturesLength: courseData.data && courseData.data.lectures ? courseData.data.lectures.length : 'no lectures'
        });
        
        if (!courseData.data || !courseData.data.lectures) {
            console.log('No course data or lectures found');
            console.log('Available data keys:', courseData.data ? Object.keys(courseData.data) : 'no data');
            showNoQuestionsMessage();
            return;
        }
        
        // Find published units
        const publishedUnits = courseData.data.lectures.filter(unit => unit.isPublished === true);
        console.log('=== PUBLISHED UNITS ANALYSIS ===');
        console.log('All lectures:', courseData.data.lectures);
        console.log('Published units found:', publishedUnits);
        console.log('Published units count:', publishedUnits.length);
        
        if (publishedUnits.length === 0) {
            console.log('No published units found');
            console.log('All units:', courseData.data.lectures.map(u => ({ name: u.name, isPublished: u.isPublished })));
            showNoQuestionsMessage();
            return;
        }
        
        // Show unit selection dropdown instead of automatically loading all questions
        console.log('Showing unit selection dropdown for published units...');
        showUnitSelectionDropdown(publishedUnits);
        
    } catch (error) {
        console.error('=== ERROR CHECKING PUBLISHED UNITS ===');
        console.error('Error details:', error);
        console.error('Error stack:', error.stack);
        showNoQuestionsMessage();
    }
}

/**
 * Show message when no questions are available
 */
function showNoQuestionsMessage() {
    console.log('Showing no questions message');
    
    // Set default mode to tutor
    localStorage.setItem('studentMode', 'tutor');
    updateModeToggleUI('tutor');
    
    // Show chat input and mode toggle
    const chatInputContainer = document.querySelector('.chat-input-container');
    if (chatInputContainer) {
        chatInputContainer.style.display = 'block';
    }
    const modeToggleContainer = document.querySelector('.mode-toggle-container');
    if (modeToggleContainer) {
        modeToggleContainer.style.display = 'block';
    }
    
    // Add message to chat
    const noQuestionsMessage = document.createElement('div');
    noQuestionsMessage.classList.add('message', 'bot-message');
    
    const avatarDiv = document.createElement('div');
    avatarDiv.classList.add('message-avatar');
    avatarDiv.textContent = 'B';
    
    const contentDiv = document.createElement('div');
    contentDiv.classList.add('message-content');
    
    const messageText = document.createElement('p');
    messageText.innerHTML = `<strong>Welcome to BiocBot!</strong><br>
    No assessment questions are currently available for this course. You can chat directly with me about any topics you'd like to discuss or questions you have about the course material.`;
    
    contentDiv.appendChild(messageText);
    
    // Add timestamp
    const timestamp = document.createElement('span');
    timestamp.classList.add('timestamp');
    timestamp.textContent = 'Just now';
    contentDiv.appendChild(timestamp);
    
    noQuestionsMessage.appendChild(avatarDiv);
    noQuestionsMessage.appendChild(contentDiv);
    
    // Add to chat
    const chatMessages = document.getElementById('chat-messages');
    chatMessages.appendChild(noQuestionsMessage);
    
    // Scroll to bottom
    chatMessages.scrollTop = chatMessages.scrollHeight;
}

/**
 * Show unit selection dropdown for published units
 * @param {Array} publishedUnits - Array of published unit objects
 */
function showUnitSelectionDropdown(publishedUnits) {
    console.log('=== SHOWING UNIT SELECTION DROPDOWN ===');
    console.log('Published units for dropdown:', publishedUnits);
    
    // Show the unit selection container
    const unitSelectionContainer = document.getElementById('unit-selection-container');
    if (unitSelectionContainer) {
        unitSelectionContainer.style.display = 'flex';
    }
    
    // Populate the dropdown with published units
    const unitSelect = document.getElementById('unit-select');
    if (unitSelect) {
        // Clear existing options except the first placeholder
        unitSelect.innerHTML = '<option value="">Choose a unit...</option>';
        
        // Add options for each published unit
        publishedUnits.forEach(unit => {
            const option = document.createElement('option');
            option.value = unit.name;
            option.textContent = unit.name;
            unitSelect.appendChild(option);
        });
        
        // Add event listener for unit selection
        unitSelect.addEventListener('change', async function() {
            const selectedUnit = this.value;
            if (selectedUnit) {
                console.log(`Unit selected: ${selectedUnit}`);
                await loadQuestionsForSelectedUnit(selectedUnit);
            }
        });
    }
    
    // Show welcome message with unit selection instructions
    showUnitSelectionWelcomeMessage();
    
    // Hide chat input and mode toggle until assessment is completed
    const chatInputContainer = document.querySelector('.chat-input-container');
    if (chatInputContainer) {
        chatInputContainer.style.display = 'none';
    }
    const modeToggleContainer = document.querySelector('.mode-toggle-container');
    if (modeToggleContainer) {
        modeToggleContainer.style.display = 'none';
    }
}

/**
 * Show welcome message with unit selection instructions
 */
function showUnitSelectionWelcomeMessage() {
    console.log('Showing unit selection welcome message');
    
    // Add message to chat
    const welcomeMessage = document.createElement('div');
    welcomeMessage.classList.add('message', 'bot-message', 'unit-selection-welcome');
    
    const avatarDiv = document.createElement('div');
    avatarDiv.classList.add('message-avatar');
    avatarDiv.textContent = 'B';
    
    const contentDiv = document.createElement('div');
    contentDiv.classList.add('message-content');
    
    const messageText = document.createElement('p');
    messageText.innerHTML = `<strong>Welcome to BiocBot!</strong><br>
    I can see you have access to published units. Please select a unit from the dropdown above to start your assessment, or feel free to chat with me about any topics you'd like to discuss.`;
    
    contentDiv.appendChild(messageText);
    
    // Add timestamp
    const timestamp = document.createElement('span');
    timestamp.classList.add('timestamp');
    timestamp.textContent = 'Just now';
    contentDiv.appendChild(timestamp);
    
    welcomeMessage.appendChild(avatarDiv);
    welcomeMessage.appendChild(contentDiv);
    
    // Add to chat
    const chatMessages = document.getElementById('chat-messages');
    chatMessages.appendChild(welcomeMessage);
    
    // Scroll to bottom
    chatMessages.scrollTop = chatMessages.scrollHeight;
}

/**
 * Load assessment questions for a selected unit
 * @param {string} unitName - Name of the selected unit
 */
async function loadQuestionsForSelectedUnit(unitName) {
    try {
        console.log(`=== LOADING QUESTIONS FOR UNIT: ${unitName} ===`);
        
        // Hide chat input and mode toggle when starting new assessment
        const chatInputContainer = document.querySelector('.chat-input-container');
        if (chatInputContainer) {
            chatInputContainer.style.display = 'none';
        }
        const modeToggleContainer = document.querySelector('.mode-toggle-container');
        if (modeToggleContainer) {
            modeToggleContainer.style.display = 'none';
        }
        
        // Get current course ID
        const courseId = await getCurrentCourseId();
        
        // Find the selected unit from the published units
        const courseResponse = await fetch(`/api/courses/${courseId}`);
        if (!courseResponse.ok) {
            throw new Error(`Failed to fetch course data: ${courseResponse.status}`);
        }
        
        const courseData = await courseResponse.json();
        const selectedUnit = courseData.data.lectures.find(unit => unit.name === unitName);
        
        if (!selectedUnit) {
            throw new Error(`Unit ${unitName} not found`);
        }
        
        console.log(`Selected unit data:`, selectedUnit);
        console.log(`Unit pass threshold:`, selectedUnit.passThreshold);
        
        // Collect questions for this specific unit
        const unitQuestions = [];
        
        // Check if the unit has assessment questions directly embedded
        if (selectedUnit.assessmentQuestions && selectedUnit.assessmentQuestions.length > 0) {
            console.log(`Found ${selectedUnit.assessmentQuestions.length} embedded questions in ${unitName}`);
            
            // Transform embedded questions to match our format
            const transformedQuestions = selectedUnit.assessmentQuestions.map(q => {
                // Clean the options format - remove "A,", "B,", "C," prefixes if present
                let cleanOptions = q.options || {};
                if (q.options && typeof q.options === 'object') {
                    cleanOptions = {};
                    console.log(`Raw embedded options before cleaning:`, q.options);
                    Object.keys(q.options).forEach(key => {
                        let optionValue = q.options[key];
                        console.log(`Processing embedded option key "${key}" with value "${optionValue}"`);
                        if (typeof optionValue === 'string') {
                            // Remove prefix like "A,", "B,", "C," - look for pattern of letter followed by comma
                            if (/^[A-Z],/.test(optionValue)) {
                                const originalValue = optionValue;
                                optionValue = optionValue.substring(2); // Remove "A,", "B,", etc.
                                console.log(`Cleaned embedded option from "${originalValue}" to "${optionValue}"`);
                            } else {
                                console.log(`Embedded option "${optionValue}" doesn't match pattern, keeping as is`);
                            }
                        }
                        cleanOptions[key] = optionValue;
                    });
                    console.log(`Final cleaned embedded options:`, cleanOptions);
                }
                
                return {
                    id: q.questionId || q.id || q._id,
                    type: q.questionType || 'multiple-choice',
                    question: q.question,
                    options: cleanOptions,
                    correctAnswer: q.correctAnswer,
                    explanation: q.explanation || '',
                    unitName: selectedUnit.name,
                    passThreshold: selectedUnit.passThreshold || 2
                };
            });
            
            unitQuestions.push(...transformedQuestions);
            console.log(`Added ${transformedQuestions.length} embedded questions from ${unitName}`);
        } else {
            console.log(`No embedded questions found for ${unitName}, trying API endpoint...`);
            
            try {
                // Try to fetch questions from API endpoint
                const questionsResponse = await fetch(`/api/questions/lecture?courseId=${courseId}&lectureName=${unitName}`);
                console.log(`API response for ${unitName}:`, questionsResponse.status, questionsResponse.statusText);
                
                if (questionsResponse.ok) {
                    const questionsData = await questionsResponse.json();
                    console.log(`API questions for ${unitName}:`, questionsData);
                    
                    if (questionsData.data && questionsData.data.questions && questionsData.data.questions.length > 0) {
                        // Transform API questions to match our format
                        const transformedQuestions = questionsData.data.questions.map(q => {
                            console.log(`Raw question from API:`, q);
                            
                            // Fix the correct answer format - remove "A" prefix if present
                            let cleanCorrectAnswer = q.correctAnswer;
                            if (typeof cleanCorrectAnswer === 'string' && cleanCorrectAnswer.startsWith('A')) {
                                cleanCorrectAnswer = cleanCorrectAnswer.substring(1);
                                console.log(`Cleaned correct answer from "${q.correctAnswer}" to "${cleanCorrectAnswer}"`);
                            }
                            
                            // Fix the options format - remove "A,", "B,", "C," prefixes if present
                            let cleanOptions = q.options;
                            if (q.options && typeof q.options === 'object') {
                                cleanOptions = {};
                                console.log(`Raw options before cleaning:`, q.options);
                                Object.keys(q.options).forEach(key => {
                                    let optionValue = q.options[key];
                                    console.log(`Processing option key "${key}" with value "${optionValue}"`);
                                    if (typeof optionValue === 'string') {
                                        // Remove prefix like "A,", "B,", "C," - look for pattern of letter followed by comma
                                        if (/^[A-Z],/.test(optionValue)) {
                                            const originalValue = optionValue;
                                            optionValue = optionValue.substring(2); // Remove "A,", "B,", etc.
                                            console.log(`Cleaned option from "${originalValue}" to "${optionValue}"`);
                                        } else {
                                            console.log(`Option "${optionValue}" doesn't match pattern, keeping as is`);
                                        }
                                    }
                                    cleanOptions[key] = optionValue;
                                });
                                console.log(`Final cleaned options:`, cleanOptions);
                            }
                            
                            return {
                                id: q.questionId || q.id || q._id,
                                type: q.questionType || 'multiple-choice',
                                question: q.question,
                                options: cleanOptions,
                                correctAnswer: cleanCorrectAnswer,
                                explanation: q.explanation || '',
                                unitName: selectedUnit.name,
                                passThreshold: selectedUnit.passThreshold || 2
                            };
                        });
                        
                        unitQuestions.push(...transformedQuestions);
                        console.log(`Added ${transformedQuestions.length} API questions from ${unitName}`);
                    } else {
                        console.log(`No API questions found for ${unitName}`);
                    }
                } else {
                    const errorText = await questionsResponse.text();
                    console.warn(`Failed to fetch API questions for ${unitName}:`, questionsResponse.status, errorText);
                }
            } catch (error) {
                console.error(`Error loading API questions for ${unitName}:`, error);
            }
        }
        
        console.log(`Total questions loaded for ${unitName}:`, unitQuestions.length);
        
        if (unitQuestions.length === 0) {
            console.log(`No assessment questions found for ${unitName}`);
            showNoQuestionsForUnitMessage(unitName);
            return;
        }
        
        // Start the assessment process with questions from the selected unit
        startAssessmentWithQuestions(unitQuestions, selectedUnit.passThreshold || 2);
        
    } catch (error) {
        console.error(`Error loading questions for unit ${unitName}:`, error);
        showNoQuestionsForUnitMessage(unitName);
    }
}

/**
 * Show message when no questions are available for a specific unit
 * @param {string} unitName - Name of the unit that has no questions
 */
function showNoQuestionsForUnitMessage(unitName) {
    console.log(`Showing no questions message for unit: ${unitName}`);
    
    // Add message to chat
    const noQuestionsMessage = document.createElement('div');
    noQuestionsMessage.classList.add('message', 'bot-message');
    
    const avatarDiv = document.createElement('div');
    avatarDiv.classList.add('message-avatar');
    avatarDiv.textContent = 'B';
    
    const contentDiv = document.createElement('div');
    contentDiv.classList.add('message-content');
    
    const messageText = document.createElement('p');
    messageText.innerHTML = `<strong>No Questions Available</strong><br>
    There are no assessment questions available for ${unitName} at this time. You can select a different unit or chat directly with me about any topics you'd like to discuss.`;
    
    contentDiv.appendChild(messageText);
    
    // Add timestamp
    const timestamp = document.createElement('span');
    timestamp.classList.add('timestamp');
    timestamp.textContent = 'Just now';
    contentDiv.appendChild(timestamp);
    
    noQuestionsMessage.appendChild(avatarDiv);
    noQuestionsMessage.appendChild(contentDiv);
    
    // Add to chat
    const chatMessages = document.getElementById('chat-messages');
    chatMessages.appendChild(noQuestionsMessage);
    
    // Scroll to bottom
    chatMessages.scrollTop = chatMessages.scrollHeight;
    
    // Reset unit selection to allow choosing another unit
    const unitSelect = document.getElementById('unit-select');
    if (unitSelect) {
        unitSelect.value = '';
    }
}

/**
 * Start assessment with loaded questions
 */
function startAssessmentWithQuestions(questions, passThreshold = 2) {
    console.log('=== STARTING ASSESSMENT ===');
    console.log(`Pass threshold set to: ${passThreshold}`);
    
    // Clear any existing mode
    localStorage.removeItem('studentMode');
    
    // Set up the questions and pass threshold
    currentCalibrationQuestions = questions;
    currentPassThreshold = passThreshold;
    currentQuestionIndex = 0;
    studentAnswers = [];
    
    // Hide chat input during assessment
    const chatInputContainer = document.querySelector('.chat-input-container');
    if (chatInputContainer) {
        chatInputContainer.style.display = 'none';
    }
    
    // Hide mode toggle during assessment
    const modeToggleContainer = document.querySelector('.mode-toggle-container');
    if (modeToggleContainer) {
        modeToggleContainer.style.display = 'none';
    }
    
    // Clear any existing messages except the welcome message and unit selection dropdown
    const chatMessages = document.getElementById('chat-messages');
    const welcomeMessage = chatMessages.querySelector('.message:not(.calibration-question):not(.mode-result):not(.unit-selection-welcome)');
    if (welcomeMessage) {
        chatMessages.innerHTML = '';
        chatMessages.appendChild(welcomeMessage);
    }
    
    // Add message about starting assessment for the selected unit
    const unitName = questions.length > 0 ? questions[0].unitName : 'the selected unit';
    const assessmentStartMessage = document.createElement('div');
    assessmentStartMessage.classList.add('message', 'bot-message', 'assessment-start');
    
    const avatarDiv = document.createElement('div');
    avatarDiv.classList.add('message-avatar');
    avatarDiv.textContent = 'B';
    
    const contentDiv = document.createElement('div');
    contentDiv.classList.add('message-content');
    
    const messageText = document.createElement('p');
    messageText.innerHTML = `<strong>Starting Assessment for ${unitName}</strong><br>
    I'll ask you a few questions to understand your current knowledge level. This will help me provide the most helpful responses for your learning needs.`;
    
    contentDiv.appendChild(messageText);
    
    // Add timestamp
    const timestamp = document.createElement('span');
    timestamp.classList.add('timestamp');
    timestamp.textContent = 'Just now';
    contentDiv.appendChild(timestamp);
    
    assessmentStartMessage.appendChild(avatarDiv);
    assessmentStartMessage.appendChild(contentDiv);
    
    // Add to chat
    chatMessages.appendChild(assessmentStartMessage);
    
    // Scroll to bottom
    chatMessages.scrollTop = chatMessages.scrollHeight;
    
    // Show first question
    showCalibrationQuestion();
}

/**
 * Show a specific calibration question
 */
function showCalibrationQuestion() {
    if (currentQuestionIndex >= currentCalibrationQuestions.length) {
        // All questions answered, calculate mode
        calculateStudentMode();
        return;
    }
    
    const question = currentCalibrationQuestions[currentQuestionIndex];
    
    // Create question message
    const questionMessage = document.createElement('div');
    questionMessage.classList.add('message', 'bot-message', 'calibration-question');
    questionMessage.id = `calibration-question-${currentQuestionIndex}`; // Unique ID for each question
    
    const avatarDiv = document.createElement('div');
    avatarDiv.classList.add('message-avatar');
    avatarDiv.textContent = 'B';
    
    const contentDiv = document.createElement('div');
    contentDiv.classList.add('message-content');
    
    const questionText = document.createElement('p');
    questionText.textContent = `Question ${currentQuestionIndex + 1}: ${question.question}`;
    contentDiv.appendChild(questionText);
    
    // Handle different question types
    if (question.type === 'true-false') {
        // Create True/False options
        const optionsDiv = document.createElement('div');
        optionsDiv.classList.add('calibration-options');
        
        // For true-false, always create True/False options
        const options = ['True', 'False'];
        
        options.forEach((option, index) => {
            const optionContainer = document.createElement('div');
            optionContainer.classList.add('calibration-option-container');
            
            const optionButton = document.createElement('button');
            optionButton.classList.add('calibration-option');
            optionButton.textContent = option;
            optionButton.onclick = () => selectCalibrationAnswer(index, currentQuestionIndex);
            
            optionContainer.appendChild(optionButton);
            optionsDiv.appendChild(optionContainer);
        });
        
        contentDiv.appendChild(optionsDiv);
        
    } else if (question.type === 'multiple-choice') {
        // Create Multiple Choice options
        const optionsDiv = document.createElement('div');
        optionsDiv.classList.add('calibration-options');
        
        if (question.options && Object.keys(question.options).length > 0) {
            // Use the options from the question (handle both array and object formats)
            const optionEntries = Array.isArray(question.options) ? question.options : Object.entries(question.options);
            
            console.log(`Displaying question options:`, question.options);
            console.log(`Option entries for display:`, optionEntries);
            
            optionEntries.forEach((option, index) => {
                const optionContainer = document.createElement('div');
                optionContainer.classList.add('calibration-option-container');
                
                const optionButton = document.createElement('button');
                optionButton.classList.add('calibration-option');
                
                // Handle both array and object formats
                let optionText = '';
                if (Array.isArray(option)) {
                    // For Object.entries format: ["A", "MANGO"] -> use the second element (value)
                    optionText = option[1] || `Option ${index + 1}`;
                } else if (typeof option === 'object' && option !== null) {
                    optionText = option[1] || `Option ${index + 1}`;
                } else {
                    optionText = option || `Option ${index + 1}`;
                }
                
                console.log(`Final option text for button ${index}: "${optionText}"`);
                
                // Don't add extra letters since we're cleaning the options from the database
                optionButton.textContent = `${String.fromCharCode(65 + index)}. ${optionText}`;
                optionButton.onclick = () => selectCalibrationAnswer(index, currentQuestionIndex);
                
                optionContainer.appendChild(optionButton);
                optionsDiv.appendChild(optionContainer);
            });
        } else {
            // Fallback options if none provided
            const fallbackOptions = ['Option A', 'Option B', 'Option C', 'Option D'];
            fallbackOptions.forEach((option, index) => {
                const optionContainer = document.createElement('div');
                optionContainer.classList.add('calibration-option-container');
                
                const optionButton = document.createElement('button');
                optionButton.classList.add('calibration-option');
                optionButton.textContent = `${String.fromCharCode(65 + index)}. ${option}`;
                optionButton.onclick = () => selectCalibrationAnswer(index, currentQuestionIndex);
                
                optionContainer.appendChild(optionButton);
                optionsDiv.appendChild(optionContainer);
            });
        }
        
        contentDiv.appendChild(optionsDiv);
        
    } else if (question.type === 'short-answer') {
        // Create Short Answer input
        const answerContainer = document.createElement('div');
        answerContainer.classList.add('calibration-short-answer');
        
        const answerInput = document.createElement('textarea');
        answerInput.classList.add('calibration-answer-input');
        answerInput.placeholder = 'Type your answer here...';
        answerInput.rows = 3;
        
        const submitButton = document.createElement('button');
        submitButton.classList.add('calibration-submit-btn');
        submitButton.textContent = 'Submit Answer';
        submitButton.onclick = () => submitShortAnswer(answerInput.value, currentQuestionIndex);
        
        answerContainer.appendChild(answerInput);
        answerContainer.appendChild(submitButton);
        contentDiv.appendChild(answerContainer);
    } else {
        // Handle unknown question types by defaulting to multiple choice
        console.warn(`Unknown question type: ${question.type}, defaulting to multiple choice`);
        
        const optionsDiv = document.createElement('div');
        optionsDiv.classList.add('calibration-options');
        
        const fallbackOptions = ['Option A', 'Option B', 'Option C', 'Option D'];
        fallbackOptions.forEach((option, index) => {
            const optionContainer = document.createElement('div');
            optionContainer.classList.add('calibration-option-container');
            
            const optionButton = document.createElement('button');
            optionButton.classList.add('calibration-option');
            optionButton.textContent = `${String.fromCharCode(65 + index)}. ${option}`;
            optionButton.onclick = () => selectCalibrationAnswer(index, currentQuestionIndex);
            
            optionContainer.appendChild(optionButton);
            optionsDiv.appendChild(optionContainer);
        });
        
        contentDiv.appendChild(optionsDiv);
    }
    
    // Create message footer for timestamp only (no flag button for calibration questions)
    const footerDiv = document.createElement('div');
    footerDiv.classList.add('message-footer');
    
    // Create right side container for timestamp only
    const rightContainer = document.createElement('div');
    rightContainer.classList.add('message-footer-right');
    
    const timestamp = document.createElement('span');
    timestamp.classList.add('timestamp');
    
        // Create real timestamp for calibration question
        const questionTime = new Date();
        timestamp.textContent = formatTimestamp(questionTime);
        
        // Store timestamp in question message div for future updates
        questionMessage.dataset.timestamp = questionTime.getTime();
        
        // Add title attribute for exact time on hover
        timestamp.title = questionTime.toLocaleString('en-US', {
            weekday: 'long',
            year: 'numeric',
            month: 'long',
            day: 'numeric',
            hour: 'numeric',
            minute: '2-digit',
            second: '2-digit',
            hour12: true
        });
    
    rightContainer.appendChild(timestamp);
    
    footerDiv.appendChild(rightContainer);
    contentDiv.appendChild(footerDiv);
    
    questionMessage.appendChild(avatarDiv);
    questionMessage.appendChild(contentDiv);
    
    // Add to chat
    const chatMessages = document.getElementById('chat-messages');
    chatMessages.appendChild(questionMessage);
    
    // Scroll to bottom
    chatMessages.scrollTop = chatMessages.scrollHeight;
}

/**
 * Handle calibration answer selection
 * @param {number} answerIndex - Selected answer index
 * @param {number} questionIndex - The question index this answer belongs to
 */
function selectCalibrationAnswer(answerIndex, questionIndex) {
    // Store the answer
    studentAnswers[questionIndex] = answerIndex;
    
    // Disable all options to prevent changing answers
    const questionMessage = document.getElementById(`calibration-question-${questionIndex}`);
    if (questionMessage) {
        const options = questionMessage.querySelectorAll('.calibration-option');
        options.forEach((option, index) => {
            // Disable all options
            option.disabled = true;
            option.style.cursor = 'not-allowed';
            
            // Highlight the selected answer
            if (index === answerIndex) {
                option.classList.add('selected');
                option.style.backgroundColor = 'var(--primary-color)';
                option.style.color = 'white';
                option.style.borderColor = 'var(--primary-color)';
            } else {
                option.classList.remove('selected');
                option.style.backgroundColor = '#f8f9fa';
                option.style.color = '#999';
                option.style.borderColor = '#ddd';
            }
        });
    }
    
    // Automatically proceed to next question after a short delay
    setTimeout(() => {
        currentQuestionIndex++;
        
        // Show next question or finish
        if (currentQuestionIndex < currentCalibrationQuestions.length) {
            showCalibrationQuestion();
        } else {
            calculateStudentMode();
        }
    }, 1000); // 1 second delay to show the selected answer
}

/**
 * Handle short answer submission
 * @param {string} answer - Student's short answer
 * @param {number} questionIndex - The question index this answer belongs to
 */
function submitShortAnswer(answer, questionIndex) {
    if (!answer.trim()) {
        alert('Please enter an answer before submitting.');
        return;
    }
    
    // Store the answer
    studentAnswers[questionIndex] = answer;
    
    // Disable the input and submit button to show it's been answered
    const questionMessage = document.getElementById(`calibration-question-${questionIndex}`);
    if (questionMessage) {
        const answerInput = questionMessage.querySelector('.calibration-answer-input');
        const submitButton = questionMessage.querySelector('.calibration-submit-btn');
        
        if (answerInput) {
            answerInput.disabled = true;
            answerInput.style.backgroundColor = '#f8f9fa';
            answerInput.style.borderColor = 'var(--primary-color)';
        }
        
        if (submitButton) {
            submitButton.disabled = true;
            submitButton.textContent = 'Answer Submitted';
            submitButton.style.backgroundColor = 'var(--primary-color)';
            submitButton.style.opacity = '0.7';
        }
    }
    
    // Automatically proceed to next question after a short delay
    setTimeout(() => {
        currentQuestionIndex++;
        
        // Show next question or finish
        if (currentQuestionIndex < currentCalibrationQuestions.length) {
            showCalibrationQuestion();
        } else {
            calculateStudentMode();
        }
    }, 1000); // 1 second delay to show the submitted answer
}

/**
 * Calculate student mode based on answers to real assessment questions
 */
async function calculateStudentMode() {
    try {
        console.log('=== CALCULATING STUDENT MODE ===');
        console.log('Student answers:', studentAnswers);
        console.log('Questions:', currentCalibrationQuestions);
        
        // Calculate total correct answers
        let totalCorrect = 0;
        const totalQuestions = currentCalibrationQuestions.length;
        
        // Check each answer against the correct answer
        for (let i = 0; i < Math.min(studentAnswers.length, totalQuestions); i++) {
            const question = currentCalibrationQuestions[i];
            const studentAnswerIndex = studentAnswers[i];
            
            // Convert student answer index to actual answer text for display
            let studentAnswerText = '';
            if (question.type === 'true-false') {
                studentAnswerText = studentAnswerIndex === 0 ? 'True' : 'False';
            } else if (question.type === 'multiple-choice' && question.options) {
                // Get the actual option text from the options object
                const optionKeys = Object.keys(question.options);
                if (optionKeys[studentAnswerIndex]) {
                    studentAnswerText = question.options[optionKeys[studentAnswerIndex]];
                } else {
                    studentAnswerText = `Option ${studentAnswerIndex}`;
                }
            } else {
                studentAnswerText = studentAnswerIndex;
            }
            
            console.log(`Question ${i + 1}:`, question.question);
            console.log(`Student answer index:`, studentAnswerIndex);
            console.log(`Student answer text:`, studentAnswerText);
            console.log(`Correct answer:`, question.correctAnswer);
            
            let isCorrect = false;
            
            if (question.type === 'true-false') {
                // For true-false, check if the answer matches
                // Handle both string and boolean formats
                const expectedAnswer = question.correctAnswer;
                const studentAnswerText = studentAnswerIndex === 0 ? 'True' : 'False';
                
                if (typeof expectedAnswer === 'string') {
                    // Convert to lowercase for comparison
                    isCorrect = (studentAnswerText.toLowerCase() === expectedAnswer.toLowerCase());
                } else if (typeof expectedAnswer === 'boolean') {
                    // Handle boolean format
                    isCorrect = (studentAnswerIndex === (expectedAnswer ? 0 : 1));
                } else {
                    // Default comparison
                    isCorrect = (studentAnswerIndex === expectedAnswer);
                }
                
                console.log(`True/False check: student answered ${studentAnswerText}, expected ${expectedAnswer}, correct: ${isCorrect}`);
                
            } else if (question.type === 'multiple-choice') {
                // For multiple choice, check if the answer index matches
                // Convert correct answer key to index
                let expectedIndex = question.correctAnswer;
                if (typeof expectedIndex === 'string') {
                    // Find the index of the correct answer key in the options
                    const optionKeys = Object.keys(question.options);
                    expectedIndex = optionKeys.indexOf(expectedIndex);
                    if (expectedIndex === -1) expectedIndex = 0; // Default to 0 if not found
                }
                isCorrect = (studentAnswerIndex === expectedIndex);
                console.log(`Multiple choice check: student answered index ${studentAnswerIndex}, expected index ${expectedIndex}, correct: ${isCorrect}`);
            } else if (question.type === 'short-answer') {
                // For short answer, consider it correct if they provided any meaningful answer
                isCorrect = (studentAnswerIndex && studentAnswerIndex.trim().length > 10);
            } else {
                // For unknown types, default to checking if answer matches
                isCorrect = (studentAnswerIndex === question.correctAnswer);
            }
            
            if (isCorrect) {
                totalCorrect++;
                console.log(`Question ${i + 1} is CORRECT`);
            } else {
                console.log(`Question ${i + 1} is INCORRECT`);
            }
        }
        
        console.log(`Total correct: ${totalCorrect}/${totalQuestions}`);
        console.log(`Pass threshold: ${currentPassThreshold}`);
        
        // Calculate percentage
        const percentage = (totalCorrect / totalQuestions) * 100;
        console.log(`Percentage: ${percentage}%`);
        
        // Determine mode based on performance using the instructor's pass threshold
        // If they get the required number of questions correct, they're in protégé mode
        // Otherwise, they're in tutor mode (need more guidance)
        const passed = totalCorrect >= currentPassThreshold;
        const mode = passed ? 'protege' : 'tutor';
        
        console.log(`Student passed: ${passed} (needed ${currentPassThreshold}, got ${totalCorrect})`);
        
        const score = {
            totalCorrect: totalCorrect,
            totalQuestions: totalQuestions,
            percentage: percentage,
            passThreshold: currentPassThreshold,
            passed: passed,
            mode: mode
        };
        
        console.log(`Determined mode: ${mode}`);
        
        // Store mode in localStorage
        localStorage.setItem('studentMode', mode);
        
        // Update mode toggle UI to reflect the determined mode
        updateModeToggleUI(mode);
        
        // Show mode result message
        showModeResult(mode, score);
        
        // Re-enable chat input
        const chatInputContainer = document.querySelector('.chat-input-container');
        if (chatInputContainer) {
            chatInputContainer.style.display = 'block';
        }
        
        // Re-enable mode toggle
        const modeToggleContainer = document.querySelector('.mode-toggle-container');
        if (modeToggleContainer) {
            modeToggleContainer.style.display = 'block';
        }
        
    } catch (error) {
        console.error('Error calculating mode:', error);
        // Default to tutor mode on error
        localStorage.setItem('studentMode', 'tutor');
        updateModeToggleUI('tutor');
        
        // Re-enable chat input and mode toggle
        const chatInputContainer = document.querySelector('.chat-input-container');
        if (chatInputContainer) {
            chatInputContainer.style.display = 'block';
        }
        const modeToggleContainer = document.querySelector('.mode-toggle-container');
        if (modeToggleContainer) {
            modeToggleContainer.style.display = 'block';
        }
    }
}

/**
 * Show mode result to student
 * @param {string} mode - Determined mode (tutor or protege)
 * @param {object} score - Assessment score object
 */
function showModeResult(mode, score) {
    const modeMessage = document.createElement('div');
    modeMessage.classList.add('message', 'bot-message', 'mode-result', 'standard-mode-result');
    
    const avatarDiv = document.createElement('div');
    avatarDiv.classList.add('message-avatar');
    avatarDiv.textContent = 'B';
    
    const contentDiv = document.createElement('div');
    contentDiv.classList.add('message-content', 'standard-mode-content');
    
    const resultText = document.createElement('p');
    
    
    // Show mode explanation
    const modeExplanation = document.createElement('div');
    modeExplanation.classList.add('mode-explanation');
    
    if (mode === 'protege') {
        modeExplanation.innerHTML = `
            <strong>BiocBot is in protégé mode</strong><br>
            Excellent work! You've demonstrated strong understanding of the course material. I'm ready to be your study partner and help you explore advanced topics together. What questions do you have about the course material?`;
    } else {
        modeExplanation.innerHTML = `
            <strong>BiocBot is in tutor mode</strong><br>
            Thanks for completing the assessment! I'm here to guide your learning and help explain concepts clearly. What questions do you have about the course material?`;
    }
    
    contentDiv.appendChild(modeExplanation);
    
    // Add unit selection option after assessment completion
    const unitSelectionOption = document.createElement('div');
    unitSelectionOption.classList.add('unit-selection-option');
    unitSelectionOption.innerHTML = `
        <div style="margin-top: 15px; padding: 12px; background-color: #f8f9fa; border-radius: 6px; border-left: 4px solid var(--primary-color);">
            <strong>Want to try another unit?</strong><br>
            You can select a different unit from the dropdown above to take another assessment, or continue chatting with me about any topics you'd like to discuss.
        </div>
    `;
    contentDiv.appendChild(unitSelectionOption);
    
    // Add timestamp
    const timestamp = document.createElement('span');
    timestamp.classList.add('timestamp');
    
        // Create real timestamp for mode result
        const modeTime = new Date();
        timestamp.textContent = formatTimestamp(modeTime);
        
        // Store timestamp in mode message div for future updates
        modeMessage.dataset.timestamp = modeTime.getTime();
        
        // Add title attribute for exact time on hover
        timestamp.title = modeTime.toLocaleString('en-US', {
            weekday: 'long',
            year: 'numeric',
            month: 'long',
            day: 'numeric',
            hour: 'numeric',
            minute: '2-digit',
            second: '2-digit',
            hour12: true
        });
    
    contentDiv.appendChild(timestamp);
    
    modeMessage.appendChild(avatarDiv);
    modeMessage.appendChild(contentDiv);
    
    // Add to chat
    const chatMessages = document.getElementById('chat-messages');
    chatMessages.appendChild(modeMessage);
    
    // Scroll to bottom
    chatMessages.scrollTop = chatMessages.scrollHeight;
}

/**
 * Show mode toggle result to student (different from calibration result)
 * @param {string} mode - Current mode (tutor or protege)
 */
function showModeToggleResult(mode) {
    const modeMessage = document.createElement('div');
    modeMessage.classList.add('message', 'bot-message', 'mode-toggle-result');
    
    const avatarDiv = document.createElement('div');
    avatarDiv.classList.add('message-avatar');
    avatarDiv.textContent = 'B';
    
    const contentDiv = document.createElement('div');
    contentDiv.classList.add('message-content');
    
    const resultText = document.createElement('p');
    if (mode === 'protege') {
        resultText.innerHTML = `<strong>BiocBot is now in protégé mode</strong><br>
        I'm ready to be your study partner! Ask me questions about the course material and I'll help you explore topics together.`;
    } else {
        resultText.innerHTML = `<strong>BiocBot is now in tutor mode</strong><br>
        I'm ready to guide your learning! I can help explain concepts, provide examples, and answer your questions about the course material.`;
    }
    
    contentDiv.appendChild(resultText);
    
    const timestamp = document.createElement('span');
    timestamp.classList.add('timestamp');
    
        // Create real timestamp for mode toggle result
        const toggleTime = new Date();
        timestamp.textContent = formatTimestamp(toggleTime);
        
        // Store timestamp in mode message div for future updates
        modeMessage.dataset.timestamp = toggleTime.getTime();
        
        // Add title attribute for exact time on hover
        timestamp.title = toggleTime.toLocaleString('en-US', {
            weekday: 'long',
            year: 'numeric',
            month: 'long',
            day: 'numeric',
            hour: 'numeric',
            minute: '2-digit',
            second: '2-digit',
            hour12: true
        });
    
    contentDiv.appendChild(timestamp);
    
    modeMessage.appendChild(avatarDiv);
    modeMessage.appendChild(contentDiv);
    
    // Add to chat
    const chatMessages = document.getElementById('chat-messages');
    chatMessages.appendChild(modeMessage);
    
    // Scroll to bottom
    chatMessages.scrollTop = chatMessages.scrollHeight;
}

/**
 * Initialize mode toggle functionality
 */
function initializeModeToggle() {
    const modeToggleCheckbox = document.getElementById('mode-toggle-checkbox');
    const protegeLabel = document.querySelector('.protege-label');
    const tutorLabel = document.querySelector('.tutor-label');
    
    if (!modeToggleCheckbox) return;
    
    // Set initial mode from localStorage or default to tutor
    const currentMode = localStorage.getItem('studentMode') || 'tutor';
    updateModeToggleUI(currentMode);
    
    // Add event listener for mode toggle
    modeToggleCheckbox.addEventListener('change', function() {
        console.log('Mode toggle changed!');
        const newMode = this.checked ? 'tutor' : 'protege';
        console.log(`New mode: ${newMode}`);
        
        // Update localStorage
        localStorage.setItem('studentMode', newMode);
        
        // Update UI
        updateModeToggleUI(newMode);
        
        // Show mode confirmation popup
        console.log('Calling showModeToggleResult...');
        showModeToggleResult(newMode);
        
        console.log(`Mode switched to: ${newMode}`);
    });
}

/**
 * Update the mode toggle UI to reflect current mode
 * @param {string} mode - Current mode (tutor or protege)
 */
function updateModeToggleUI(mode) {
    const modeToggleCheckbox = document.getElementById('mode-toggle-checkbox');
    const protegeLabel = document.querySelector('.protege-label');
    const tutorLabel = document.querySelector('.tutor-label');
    
    if (!modeToggleCheckbox || !protegeLabel || !tutorLabel) return;
    
    if (mode === 'tutor') {
        // Checkbox checked = tutor mode
        modeToggleCheckbox.checked = true;
        tutorLabel.classList.add('active');
        protegeLabel.classList.remove('active');
    } else {
        // Checkbox unchecked = protégé mode
        modeToggleCheckbox.checked = false;
        protegeLabel.classList.add('active');
        tutorLabel.classList.remove('active');
    }
} 
