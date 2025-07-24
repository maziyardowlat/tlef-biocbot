document.addEventListener('DOMContentLoaded', () => {
    const chatForm = document.getElementById('chat-form');
    const chatInput = document.getElementById('chat-input');
    const chatMessages = document.getElementById('chat-messages');
    const courseSelect = document.getElementById('course-select');
    
    // Initialize chat
    console.log('Chat interface initialized');
    
    // Handle course selection
    if (courseSelect) {
        courseSelect.addEventListener('change', () => {
            const selectedCourse = courseSelect.value;
            if (selectedCourse) {
                // In a real implementation, this would load the course content
                console.log('Selected course:', selectedCourse);
                
                // Add a system message about course selection
                addMessage('I\'ve loaded the content for ' + 
                    courseSelect.options[courseSelect.selectedIndex].text + 
                    '. You can now ask questions about this course material.', 'bot');
            }
        });
    }
    
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
                    "I found this information in your course materials. The cell is the basic unit of life, and all living organisms are composed of one or more cells.",
                    "According to your textbook, photosynthesis is the process by which plants convert light energy into chemical energy.",
                    "Based on the lecture notes, DNA replication is semi-conservative, meaning each new double helix contains one original strand and one new strand.",
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
        avatarDiv.textContent = sender === 'user' ? 'U' : 'B';
        
        const contentDiv = document.createElement('div');
        contentDiv.classList.add('message-content');
        
        const paragraph = document.createElement('p');
        paragraph.textContent = content;
        
        const timestamp = document.createElement('span');
        timestamp.classList.add('timestamp');
        timestamp.textContent = 'Just now';
        
        contentDiv.appendChild(paragraph);
        
        // Add source citation if needed
        if (withSource && sender === 'bot') {
            const sourceDiv = document.createElement('div');
            sourceDiv.classList.add('message-source');
            sourceDiv.innerHTML = 'Source: <a href="#">Course Textbook, Chapter 3</a>';
            contentDiv.appendChild(sourceDiv);
        }
        
        contentDiv.appendChild(timestamp);
        
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
