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
        const courseId = getCurrentCourseId();
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
 * Get current student ID (placeholder)
 * @returns {string} Student ID
 */
function getCurrentStudentId() {
    // This would typically come from JWT token or session
    // For now, return a placeholder
    return 'student-123';
}

/**
 * Get current student name (placeholder)
 * @returns {string} Student name
 */
function getCurrentStudentName() {
    // This would typically come from JWT token or session
    // For now, return a placeholder
    return 'Student Name';
}

/**
 * Get current course ID (placeholder)
 * @returns {string} Course ID
 */
function getCurrentCourseId() {
    // This would typically come from JWT token or session
    // For now, return a placeholder that matches the course structure
    return 'BIOC-202-1755285146691';
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
let currentQuestionIndex = 0;
let studentAnswers = [];

/**
 * Show calibration questions to determine student mode
 */
async function showCalibrationQuestions() {
    try {
        // Clear any existing mode for demo purposes
        localStorage.removeItem('studentMode');
        
        // Define the 3 calibration questions (T/F, MCQ, Short Answer)
        currentCalibrationQuestions = [
            {
                type: 'true-false',
                question: 'The cell is the basic unit of life.',
                options: ['True', 'False'],
                correctAnswer: 0 // True
            },
            {
                type: 'multiple-choice',
                question: 'Which of the following is NOT a function of the cell membrane?',
                options: [
                    'Regulating what enters and exits the cell',
                    'Protecting the cell from its environment',
                    'Producing energy through photosynthesis',
                    'Maintaining cell shape and structure'
                ],
                correctAnswer: 2 // C - Producing energy through photosynthesis
            },
            {
                type: 'short-answer',
                question: 'Explain the difference between prokaryotic and eukaryotic cells in one sentence.',
                correctAnswer: 'Prokaryotic cells lack a nucleus and membrane-bound organelles, while eukaryotic cells have both a nucleus and membrane-bound organelles.'
            }
        ];
        
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
        
        question.options.forEach((option, index) => {
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
        
        question.options.forEach((option, index) => {
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
    }
    
    // Create message footer for timestamp only (no flag button for calibration questions)
    const footerDiv = document.createElement('div');
    footerDiv.classList.add('message-footer');
    
    // Create right side container for timestamp only
    const rightContainer = document.createElement('div');
    rightContainer.classList.add('message-footer-right');
    
    const timestamp = document.createElement('span');
    timestamp.classList.add('timestamp');
    timestamp.textContent = 'Just now';
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
 * Calculate student mode based on answers
 */
async function calculateStudentMode() {
    try {
        // Calculate scores for each question type
        let tfCorrect = false;
        let mcqCorrect = false;
        let shortAnswerProvided = false;
        
        // Check T/F question (first question)
        if (studentAnswers.length > 0) {
            tfCorrect = (studentAnswers[0] === currentCalibrationQuestions[0].correctAnswer);
        }
        
        // Check MCQ question (second question)
        if (studentAnswers.length > 1) {
            mcqCorrect = (studentAnswers[1] === currentCalibrationQuestions[1].correctAnswer);
        }
        
        // Check Short Answer question (third question)
        if (studentAnswers.length > 2) {
            shortAnswerProvided = (studentAnswers[2] && studentAnswers[2].trim().length > 0);
        }
        
        // Determine mode: Protégé if both T/F and MCQ are correct, otherwise Tutor
        const mode = (tfCorrect && mcqCorrect) ? 'protege' : 'tutor';
        const score = {
            tfCorrect: tfCorrect,
            mcqCorrect: mcqCorrect,
            shortAnswerProvided: shortAnswerProvided,
            totalCorrect: (tfCorrect ? 1 : 0) + (mcqCorrect ? 1 : 0) + (shortAnswerProvided ? 1 : 0)
        };
        
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
 * @param {object} score - Calibration score object
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
        Great job! You answered both the True/False and Multiple Choice questions correctly. I'm ready to be your study partner and help you explore topics together. What questions do you have about cellular processes and reactions?`;
    } else {
        resultText.innerHTML = `<strong>BiocBot is in tutor mode</strong><br>
        Thanks for your responses! I'm here to guide your learning and help explain concepts clearly. What questions do you have about cellular processes and reactions?`;
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