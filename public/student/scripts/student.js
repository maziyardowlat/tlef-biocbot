document.addEventListener('DOMContentLoaded', () => {
    const chatForm = document.getElementById('chat-form');
    const chatInput = document.getElementById('chat-input');
    const chatMessages = document.getElementById('chat-messages');
    
    // Initialize chat
    console.log('Student chat interface initialized');
    
    // Show calibration questions on every reload for demo purposes
    // In production, this would check session or database
    showCalibrationQuestions();
    
    // Initialize mode toggle functionality
    initializeModeToggle();
    
    // Handle chat form submission
    if (chatForm) {
        chatForm.addEventListener('submit', (e) => {
            e.preventDefault();
            
            const message = chatInput.value.trim();
            if (!message) return;
            
            // Add user message to chat
            addMessage(message, 'user');
            
            // Clear input
            chatInput.value = '';
            
            // Show typing indicator
            showTypingIndicator();
            
            // In a real implementation, this would send the message to the server
            // and get a response from the AI
            setTimeout(() => {
                // Remove typing indicator
                removeTypingIndicator();
                
                // Add bot response (simulated)
                const botResponses = [
                    "I found this information in your BIOC 202 materials. The cell is the basic unit of life, and all living organisms are composed of one or more cells.",
                    "According to your BIOC 202 textbook, photosynthesis is the process by which plants convert light energy into chemical energy.",
                    "Based on the lecture notes for BIOC 202, DNA replication is semi-conservative, meaning each new double helix contains one original strand and one new strand.",
                    "The course material explains that natural selection is the process where organisms better adapted to their environment tend to survive and produce more offspring."
                ];
                
                const randomResponse = botResponses[Math.floor(Math.random() * botResponses.length)];
                addMessage(randomResponse, 'bot', true);
            }, 1500);
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
            sourceDiv.innerHTML = 'Source: <a href="#">BIOC 202 Textbook, Chapter 3</a>';
            footerDiv.appendChild(sourceDiv);
        }
        
        // Create right side container for timestamp and flag button
        const rightContainer = document.createElement('div');
        rightContainer.classList.add('message-footer-right');
        
        const timestamp = document.createElement('span');
        timestamp.classList.add('timestamp');
        timestamp.textContent = 'Just now';
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
                <button class="flag-option" onclick="flagMessage(this, 'incorrectness')">Incorrectness</button>
                <button class="flag-option" onclick="flagMessage(this, 'inappropriate')">Inappropriate</button>
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
 * @param {string} flagType - The type of flag (incorrectness, inappropriate, irrelevant)
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
 * @param {string} flagType - The type of flag
 */
async function submitFlag(messageText, flagType) {
    try {
        const flagData = {
            messageText: messageText,
            flagType: flagType,
            timestamp: new Date().toISOString(),
            studentId: getCurrentStudentId() // This would come from auth
        };
        
        const response = await fetch('/api/flags', {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json',
                'Authorization': `Bearer ${getAuthToken()}`
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
 * @param {string} flagType - The type of flag that was submitted
 */
function replaceMessageWithThankYou(messageContent, flagType) {
    // Get the paragraph element
    const paragraph = messageContent.querySelector('p');
    
    // Replace the message text
    paragraph.textContent = `Thank you for reporting this response as "${flagType}". This has been logged and will be reviewed.`;
    
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
 * Get current student ID (placeholder)
 * @returns {string} Student ID
 */
function getCurrentStudentId() {
    // This would typically come from JWT token or session
    // For now, return a placeholder
    return 'student-123';
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
let currentQuestionIndex = 0;
let studentAnswers = [];

/**
 * Show calibration questions to determine student mode
 */
async function showCalibrationQuestions() {
    try {
        // Clear any existing mode for demo purposes
        localStorage.removeItem('studentMode');
        
        // Fetch calibration questions from server
        const response = await fetch('/api/mode-questions?instructorId=instructor-123');
        const data = await response.json();
        
        if (data.success) {
            currentCalibrationQuestions = data.data.questions;
            currentQuestionIndex = 0;
            studentAnswers = [];
            
            // Hide chat input during calibration
            const chatInputContainer = document.querySelector('.chat-input-container');
            if (chatInputContainer) {
                chatInputContainer.style.display = 'none';
            }
            
            // Hide mode toggle during calibration
            const modeToggleContainer = document.querySelector('.mode-toggle-container');
            if (modeToggleContainer) {
                modeToggleContainer.style.display = 'none';
            }
            
            // Clear any existing messages except the welcome message
            const chatMessages = document.getElementById('chat-messages');
            const welcomeMessage = chatMessages.querySelector('.message:not(.calibration-question):not(.mode-result)');
            if (welcomeMessage) {
                chatMessages.innerHTML = '';
                chatMessages.appendChild(welcomeMessage);
            }
            
            // Show first question
            showCalibrationQuestion();
        } else {
            console.error('Failed to load calibration questions');
            // If calibration fails, default to tutor mode
            localStorage.setItem('studentMode', 'tutor');
            updateModeToggleUI('tutor');
            
            // Show chat input and mode toggle if calibration fails to load
            const chatInputContainer = document.querySelector('.chat-input-container');
            if (chatInputContainer) {
                chatInputContainer.style.display = 'block';
            }
            const modeToggleContainer = document.querySelector('.mode-toggle-container');
            if (modeToggleContainer) {
                modeToggleContainer.style.display = 'block';
            }
        }
    } catch (error) {
        console.error('Error loading calibration questions:', error);
        // Default to tutor mode on error
        localStorage.setItem('studentMode', 'tutor');
        updateModeToggleUI('tutor');
        
        // Show chat input and mode toggle on error
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
    
    const avatarDiv = document.createElement('div');
    avatarDiv.classList.add('message-avatar');
    avatarDiv.textContent = 'B';
    
    const contentDiv = document.createElement('div');
    contentDiv.classList.add('message-content');
    
    const questionText = document.createElement('p');
    questionText.textContent = `Question ${currentQuestionIndex + 1}: ${question.question}`;
    contentDiv.appendChild(questionText);
    
    // Create options
    const optionsDiv = document.createElement('div');
    optionsDiv.classList.add('calibration-options');
    
    question.options.forEach((option, index) => {
        const optionContainer = document.createElement('div');
        optionContainer.classList.add('calibration-option-container');
        
        const optionButton = document.createElement('button');
        optionButton.classList.add('calibration-option');
        optionButton.textContent = `${String.fromCharCode(65 + index)}. ${option}`;
        optionButton.onclick = () => selectCalibrationAnswer(index);
        
        const scoreBox = document.createElement('div');
        scoreBox.classList.add('calibration-score-box');
        
        optionContainer.appendChild(optionButton);
        optionContainer.appendChild(scoreBox);
        optionsDiv.appendChild(optionContainer);
    });
    
    contentDiv.appendChild(optionsDiv);
    
    const timestamp = document.createElement('span');
    timestamp.classList.add('timestamp');
    timestamp.textContent = 'Just now';
    contentDiv.appendChild(timestamp);
    
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
 */
function selectCalibrationAnswer(answerIndex) {
    studentAnswers.push(answerIndex);
    currentQuestionIndex++;
    
    // Show next question or finish
    if (currentQuestionIndex < currentCalibrationQuestions.length) {
        showCalibrationQuestion();
    } else {
        calculateStudentMode();
    }
}

/**
 * Calculate student mode based on answers
 */
async function calculateStudentMode() {
    try {
        const response = await fetch('/api/mode-questions/calibrate', {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json',
            },
            body: JSON.stringify({
                studentId: getCurrentStudentId(),
                answers: studentAnswers,
                instructorId: 'instructor-123'
            })
        });
        
        const data = await response.json();
        
        if (data.success) {
            const mode = data.data.mode;
            const score = data.data.score;
            
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
            
            // Show mode toggle when chat is available
            const modeToggleContainer = document.querySelector('.mode-toggle-container');
            if (modeToggleContainer) {
                modeToggleContainer.style.display = 'block';
            }
            
        } else {
            console.error('Failed to calibrate mode');
            // Default to tutor mode
            localStorage.setItem('studentMode', 'tutor');
            updateModeToggleUI('tutor');
            showModeResult('tutor', 0);
            
            // Show mode toggle and chat input on error
            const chatInputContainer = document.querySelector('.chat-input-container');
            if (chatInputContainer) {
                chatInputContainer.style.display = 'block';
            }
            const modeToggleContainer = document.querySelector('.mode-toggle-container');
            if (modeToggleContainer) {
                modeToggleContainer.style.display = 'block';
            }
        }
        
    } catch (error) {
        console.error('Error calculating mode:', error);
        // Default to tutor mode
        localStorage.setItem('studentMode', 'tutor');
        updateModeToggleUI('tutor');
        showModeResult('tutor', 0);
        
        // Show mode toggle and chat input on error
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
 * @param {number} score - Calibration score
 */
function showModeResult(mode, score) {
    const modeMessage = document.createElement('div');
    modeMessage.classList.add('message', 'bot-message', 'mode-result');
    
    const avatarDiv = document.createElement('div');
    avatarDiv.classList.add('message-avatar');
    avatarDiv.textContent = 'B';
    
    const contentDiv = document.createElement('div');
    contentDiv.classList.add('message-content');
    
    const resultText = document.createElement('p');
    if (mode === 'protege') {
        resultText.innerHTML = `<strong>BiocBot is in protégé mode</strong><br>
        Thanks for your responses to these initial questions. This lecture we learned about cellular processes and reactions. What questions do you have about these topics?`;
    } else {
        resultText.innerHTML = `<strong>BiocBot is in tutor mode</strong><br>
        Thanks for your responses to these initial questions. This lecture we learned about cellular processes and reactions. What questions do you have about these topics?`;
    }
    
    contentDiv.appendChild(resultText);
    
    const timestamp = document.createElement('span');
    timestamp.classList.add('timestamp');
    timestamp.textContent = 'Just now';
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
    timestamp.textContent = 'Just now';
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
        const newMode = this.checked ? 'tutor' : 'protege';
        
        // Update localStorage
        localStorage.setItem('studentMode', newMode);
        
        // Update UI
        updateModeToggleUI(newMode);
        
        // Show mode confirmation popup
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