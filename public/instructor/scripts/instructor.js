document.addEventListener('DOMContentLoaded', () => {
    const uploadDropArea = document.getElementById('upload-drop-area');
    const fileUpload = document.getElementById('file-upload');
    const documentSearch = document.getElementById('document-search');
    const documentFilter = document.getElementById('document-filter');
    const courseSelect = document.getElementById('course-select');
    const accordionHeaders = document.querySelectorAll('.accordion-header');
    
    console.log('Instructor interface initialized');
    
    // Handle accordion toggling
    accordionHeaders.forEach(header => {
        header.addEventListener('click', () => {
            const accordionItem = header.parentElement;
            const content = accordionItem.querySelector('.accordion-content');
            const toggle = header.querySelector('.accordion-toggle');
            
            // Toggle the collapsed class
            content.classList.toggle('collapsed');
            
            // Update the toggle icon
            if (content.classList.contains('collapsed')) {
                toggle.textContent = '▶';
            } else {
                toggle.textContent = '▼';
            }
        });
    });
    
    // Handle course selection
    if (courseSelect) {
        courseSelect.addEventListener('change', () => {
            const selectedCourse = courseSelect.value;
            if (selectedCourse) {
                // In a real implementation, this would load the course documents
                console.log('Selected course:', selectedCourse);
                
                // For demonstration purposes, we'll just show a notification
                showNotification(`Loaded documents for ${courseSelect.options[courseSelect.selectedIndex].text}`, 'info');
            }
        });
    }
    
    // Handle drag and drop functionality
    if (uploadDropArea) {
        ['dragenter', 'dragover', 'dragleave', 'drop'].forEach(eventName => {
            uploadDropArea.addEventListener(eventName, preventDefaults, false);
        });

        function preventDefaults(e) {
            e.preventDefault();
            e.stopPropagation();
        }

        ['dragenter', 'dragover'].forEach(eventName => {
            uploadDropArea.addEventListener(eventName, highlight, false);
        });

        ['dragleave', 'drop'].forEach(eventName => {
            uploadDropArea.addEventListener(eventName, unhighlight, false);
        });

        function highlight() {
            uploadDropArea.classList.add('highlight');
        }

        function unhighlight() {
            uploadDropArea.classList.remove('highlight');
        }

        uploadDropArea.addEventListener('drop', handleDrop, false);

        function handleDrop(e) {
            const dt = e.dataTransfer;
            const files = dt.files;
            handleFiles(files);
        }

        uploadDropArea.addEventListener('click', () => {
            fileUpload.click();
        });

        fileUpload.addEventListener('change', (e) => {
            handleFiles(e.target.files);
        });

        function handleFiles(files) {
            // This is just a UI skeleton, so we'll just log the files
            console.log('Files selected:', files);
            
            // Check if a course is selected
            const selectedCourse = courseSelect.value;
            if (!selectedCourse) {
                alert('Please select a course before uploading documents.');
                return;
            }
            
            // Check if week is selected
            const weekSelect = document.getElementById('week-select');
            if (weekSelect && !weekSelect.value) {
                alert('Please select a week for the uploaded documents.');
                return;
            }
            
            // In a real implementation, you would upload these files to the server
            // For demonstration, we'll just show a notification
            showNotification(`${files.length} document(s) uploaded and processing`, 'success');
            
            // Simulate adding a new file to the accordion
            if (files.length > 0) {
                addNewFileToAccordion(files[0]);
            }
        }
    }
    
    // Function to add a new file to the accordion
    function addNewFileToAccordion(file) {
        // Get the selected week
        const weekSelect = document.getElementById('week-select');
        const weekValue = weekSelect ? weekSelect.value : '1';
        const weekName = `Week ${weekValue}`;
        
        // Find the corresponding accordion item or create it
        let accordionItem = findOrCreateAccordionItem(weekName);
        
        // Create the file item
        const fileItem = document.createElement('div');
        fileItem.className = 'file-item';
        
        // Determine icon based on file type
        let fileIcon = '📄';
        if (file.name.toLowerCase().includes('quiz')) {
            fileIcon = '📝';
        } else if (file.name.toLowerCase().includes('syllabus')) {
            fileIcon = '📋';
        }
        
        fileItem.innerHTML = `
            <span class="file-icon">${fileIcon}</span>
            <div class="file-info">
                <h3>${file.name}</h3>
                <p>Newly uploaded document. Processing will begin shortly.</p>
                <span class="status-text processing">Processing</span>
            </div>
            <div class="file-actions">
                <button class="action-button view">View</button>
                <button class="action-button delete">Delete</button>
            </div>
        `;
        
        // Add event listeners to the buttons
        const viewButton = fileItem.querySelector('.view');
        const deleteButton = fileItem.querySelector('.delete');
        
        viewButton.addEventListener('click', () => {
            console.log('View document:', file.name);
            // In a real implementation, this would open the document
        });
        
        deleteButton.addEventListener('click', () => {
            console.log('Delete document:', file.name);
            fileItem.remove();
            // In a real implementation, this would delete the document from the server
            showNotification(`Document "${file.name}" deleted`, 'info');
        });
        
        // Add the file item to the accordion content
        const accordionContent = accordionItem.querySelector('.accordion-content');
        accordionContent.appendChild(fileItem);
        
        // Make sure the accordion is expanded
        if (accordionContent.classList.contains('collapsed')) {
            const accordionHeader = accordionItem.querySelector('.accordion-header');
            accordionHeader.click();
        }
    }
    
    // Function to find or create an accordion item for a specific week
    function findOrCreateAccordionItem(weekName) {
        const accordionContainer = document.querySelector('.accordion-container');
        
        // Try to find existing accordion item
        let accordionItem = null;
        document.querySelectorAll('.accordion-item').forEach(item => {
            const folderName = item.querySelector('.folder-name').textContent;
            if (folderName === weekName) {
                accordionItem = item;
            }
        });
        
        // If not found, create a new one
        if (!accordionItem) {
            accordionItem = document.createElement('div');
            accordionItem.className = 'accordion-item';
            
            accordionItem.innerHTML = `
                <div class="accordion-header">
                    <span class="folder-icon">📁</span>
                    <span class="folder-name">${weekName}</span>
                    <span class="accordion-toggle">▶</span>
                </div>
                <div class="accordion-content collapsed">
                    <!-- Files will be added here -->
                </div>
            `;
            
            // Add event listener to the header
            const header = accordionItem.querySelector('.accordion-header');
            header.addEventListener('click', () => {
                const content = accordionItem.querySelector('.accordion-content');
                const toggle = header.querySelector('.accordion-toggle');
                
                content.classList.toggle('collapsed');
                
                if (content.classList.contains('collapsed')) {
                    toggle.textContent = '▶';
                } else {
                    toggle.textContent = '▼';
                }
            });
            
            // Add to the container
            accordionContainer.appendChild(accordionItem);
        }
        
        return accordionItem;
    }
    
    // Tab functionality
    const tabButtons = document.querySelectorAll('.tab-btn');
    tabButtons.forEach(button => {
        button.addEventListener('click', () => {
            // Remove active class from all buttons
            tabButtons.forEach(btn => btn.classList.remove('active'));
            
            // Add active class to clicked button
            button.classList.add('active');
            
            // In a real implementation, this would filter the documents
            showNotification(`Showing ${button.textContent.trim()} view`, 'info');
        });
    });
});

// Global function to show notification
function showNotification(message, type = 'info') {
    // Check if notification container exists, if not create it
    let notificationContainer = document.querySelector('.notification-container');
    if (!notificationContainer) {
        notificationContainer = document.createElement('div');
        notificationContainer.classList.add('notification-container');
        document.body.appendChild(notificationContainer);
    }
    
    // Create notification element
    const notification = document.createElement('div');
    notification.classList.add('notification', type);
    notification.textContent = message;
    
    // Add close button
    const closeBtn = document.createElement('button');
    closeBtn.classList.add('notification-close');
    closeBtn.innerHTML = '&times;';
    closeBtn.addEventListener('click', () => {
        notification.remove();
    });
    
    notification.appendChild(closeBtn);
    notificationContainer.appendChild(notification);
    
    // Auto remove after 5 seconds
    setTimeout(() => {
        notification.remove();
    }, 5000);
}

// Modal functionality for content upload
let currentStep = 1;
let selectedContentType = null;
let uploadedFile = null;
let currentLectureName = null;

/**
 * Open the upload modal
 * @param {string} lectureName - Name of the lecture/week
 */
function openUploadModal(lectureName) {
    currentLectureName = lectureName;
    document.getElementById('modal-lecture-name').textContent = lectureName;
    document.getElementById('upload-modal').classList.add('show');
    resetModal();
}

/**
 * Close the upload modal
 */
function closeUploadModal() {
    document.getElementById('upload-modal').classList.remove('show');
    resetModal();
}

/**
 * Reset modal to initial state
 */
function resetModal() {
    currentStep = 1;
    selectedContentType = null;
    uploadedFile = null;
    
    // Reset all steps
    document.querySelectorAll('.modal-step').forEach(step => {
        step.classList.remove('active');
    });
    document.getElementById('step-1').classList.add('active');
    
    // Reset step indicators
    document.querySelectorAll('.step-dot').forEach(dot => {
        dot.classList.remove('active');
    });
    document.querySelector('[data-step="1"]').classList.add('active');
    
    // Reset content type selection
    document.querySelectorAll('.content-type-btn').forEach(btn => {
        btn.classList.remove('selected');
    });
    
    // Reset file upload
    document.getElementById('file-input').value = '';
    document.getElementById('file-info').style.display = 'none';
    document.getElementById('upload-zone').innerHTML = `
        <span class="upload-icon">📁</span>
        <p>Drag and drop your file here, or click to browse</p>
    `;
    
    // Reset learning objectives
    document.getElementById('learning-objectives').value = '';
    
    // Update button text
    document.getElementById('next-btn').textContent = 'Next';
}

/**
 * Select content type
 * @param {string} contentType - The selected content type
 */
function selectContentType(contentType) {
    selectedContentType = contentType;
    
    // Update visual selection
    document.querySelectorAll('.content-type-btn').forEach(btn => {
        btn.classList.remove('selected');
    });
    event.target.closest('.content-type-btn').classList.add('selected');
}

/**
 * Go to next step in modal
 */
function nextStep() {
    if (currentStep === 1) {
        if (!selectedContentType) {
            showNotification('Please select a content type', 'error');
            return;
        }
        goToStep(2);
    } else if (currentStep === 2) {
        if (!uploadedFile) {
            showNotification('Please upload a file', 'error');
            return;
        }
        const objectives = document.getElementById('learning-objectives').value.trim();
        if (!objectives) {
            showNotification('Please enter learning objectives', 'error');
            return;
        }
        processFileAndShowPreview();
        goToStep(3);
    }
}

/**
 * Go to specific step
 * @param {number} step - Step number to go to
 */
function goToStep(step) {
    currentStep = step;
    
    // Update step visibility
    document.querySelectorAll('.modal-step').forEach(stepEl => {
        stepEl.classList.remove('active');
    });
    document.getElementById(`step-${step}`).classList.add('active');
    
    // Update step indicators
    document.querySelectorAll('.step-dot').forEach(dot => {
        dot.classList.remove('active');
    });
    document.querySelector(`[data-step="${step}"]`).classList.add('active');
    
    // Update button text
    const nextBtn = document.getElementById('next-btn');
    if (step === 3) {
        nextBtn.style.display = 'none';
    } else {
        nextBtn.style.display = 'block';
        nextBtn.textContent = step === 2 ? 'Process & Review' : 'Next';
    }
}

/**
 * Setup file upload functionality
 */
document.addEventListener('DOMContentLoaded', function() {
    const uploadZone = document.getElementById('upload-zone');
    const fileInput = document.getElementById('file-input');
    
    if (uploadZone && fileInput) {
        // Click to upload
        uploadZone.addEventListener('click', () => {
            fileInput.click();
        });
        
        // Drag and drop
        uploadZone.addEventListener('dragover', (e) => {
            e.preventDefault();
            uploadZone.classList.add('dragover');
        });
        
        uploadZone.addEventListener('dragleave', (e) => {
            e.preventDefault();
            uploadZone.classList.remove('dragover');
        });
        
        uploadZone.addEventListener('drop', (e) => {
            e.preventDefault();
            uploadZone.classList.remove('dragover');
            const files = e.dataTransfer.files;
            if (files.length > 0) {
                handleFileUpload(files[0]);
            }
        });
        
        // File input change
        fileInput.addEventListener('change', (e) => {
            if (e.target.files.length > 0) {
                handleFileUpload(e.target.files[0]);
            }
        });
    }
});

/**
 * Handle file upload
 * @param {File} file - The uploaded file
 */
function handleFileUpload(file) {
    uploadedFile = file;
    
    // Show file info
    document.getElementById('file-name').textContent = file.name;
    document.getElementById('file-size').textContent = formatFileSize(file.size);
    document.getElementById('file-info').style.display = 'flex';
    
    // Update upload zone
    document.getElementById('upload-zone').innerHTML = `
        <span class="upload-icon">✅</span>
        <p>File uploaded: ${file.name}</p>
    `;
}

/**
 * Format file size
 * @param {number} bytes - File size in bytes
 * @returns {string} Formatted file size
 */
function formatFileSize(bytes) {
    if (bytes === 0) return '0 Bytes';
    const k = 1024;
    const sizes = ['Bytes', 'KB', 'MB', 'GB'];
    const i = Math.floor(Math.log(bytes) / Math.log(k));
    return parseFloat((bytes / Math.pow(k, i)).toFixed(2)) + ' ' + sizes[i];
}

/**
 * Process file and show preview
 */
async function processFileAndShowPreview() {
    // Show loading state
    document.getElementById('next-btn').textContent = 'Processing...';
    document.getElementById('next-btn').disabled = true;
    
    try {
        // Simulate API call to process file
        await new Promise(resolve => setTimeout(resolve, 2000));
        
        // Mock extracted content
        const extractedObjectives = [
            'Students will understand the structure of amino acids',
            'Students will be able to explain protein synthesis',
            'Students will identify key biochemical pathways'
        ];
        
        const extractedTopics = [
            'Amino acid structure and properties',
            'Peptide bond formation',
            'Protein folding and structure',
            'Enzymatic reactions'
        ];
        
        const contentSummary = 'This document covers fundamental concepts in biochemistry, focusing on amino acids, protein structure, and enzymatic reactions. It provides a comprehensive overview suitable for undergraduate students in biochemistry courses.';
        
        // Update preview
        updateContentPreview(extractedObjectives, extractedTopics, contentSummary);
        
    } catch (error) {
        console.error('Error processing file:', error);
        showNotification('Error processing file. Please try again.', 'error');
    } finally {
        document.getElementById('next-btn').disabled = false;
    }
}

/**
 * Update content preview
 * @param {Array} objectives - Extracted learning objectives
 * @param {Array} topics - Extracted key topics
 * @param {string} summary - Content summary
 */
function updateContentPreview(objectives, topics, summary) {
    const objectivesList = document.getElementById('extracted-objectives');
    const topicsList = document.getElementById('extracted-topics');
    const summaryEl = document.getElementById('content-summary');
    
    objectivesList.innerHTML = objectives.map(obj => `<li>${obj}</li>`).join('');
    topicsList.innerHTML = topics.map(topic => `<li>${topic}</li>`).join('');
    summaryEl.textContent = summary;
}

/**
 * Edit content (go back to step 2)
 */
function editContent() {
    goToStep(2);
}

/**
 * Confirm and upload content
 */
async function confirmUpload() {
    try {
        // Show loading state
        const confirmBtn = event.target;
        confirmBtn.textContent = 'Uploading...';
        confirmBtn.disabled = true;
        
        // Simulate API call
        await new Promise(resolve => setTimeout(resolve, 1500));
        
        // Add to accordion
        addContentToAccordion();
        
        // Close modal and show success
        closeUploadModal();
        showNotification('Content uploaded successfully!', 'success');
        
    } catch (error) {
        console.error('Error uploading content:', error);
        showNotification('Error uploading content. Please try again.', 'error');
    } finally {
        const confirmBtn = document.querySelector('.btn-primary');
        if (confirmBtn) {
            confirmBtn.textContent = 'Confirm & Upload';
            confirmBtn.disabled = false;
        }
    }
}

/**
 * Add content to accordion
 */
function addContentToAccordion() {
    // Find the accordion for the current lecture
    const accordionItems = document.querySelectorAll('.accordion-item');
    let targetAccordion = null;
    
    for (let item of accordionItems) {
        const folderName = item.querySelector('.folder-name').textContent;
        if (folderName === currentLectureName) {
            targetAccordion = item.querySelector('.accordion-content');
            break;
        }
    }
    
    if (targetAccordion) {
        // Create new file item
        const fileItem = document.createElement('div');
        fileItem.className = 'file-item';
        fileItem.innerHTML = `
            <span class="file-icon">📄</span>
            <div class="file-info">
                <h3>${uploadedFile.name}</h3>
                <p>${selectedContentType} - ${new Date().toLocaleDateString()}</p>
                <span class="status-text">Processed</span>
            </div>
            <div class="file-actions">
                <button class="action-button view">View</button>
                <button class="action-button delete">Delete</button>
            </div>
        `;
        
        // Insert before the add content section
        const addContentSection = targetAccordion.querySelector('.add-content-section');
        if (addContentSection) {
            targetAccordion.insertBefore(fileItem, addContentSection);
        } else {
            targetAccordion.appendChild(fileItem);
        }
    }
}

/**
 * Toggle publish status for a lecture/week
 * @param {string} lectureName - Name of the lecture/week
 * @param {boolean} isPublished - Whether the content should be published
 */
function togglePublish(lectureName, isPublished) {
    // Find the accordion item
    const accordionItems = document.querySelectorAll('.accordion-item');
    let targetAccordion = null;
    
    for (let item of accordionItems) {
        const folderName = item.querySelector('.folder-name').textContent;
        if (folderName === lectureName) {
            targetAccordion = item;
            break;
        }
    }
    
    if (targetAccordion) {
        // Update visual state
        if (isPublished) {
            targetAccordion.classList.add('published');
            showNotification(`${lectureName} is now published and visible to students`, 'success');
        } else {
            targetAccordion.classList.remove('published');
            showNotification(`${lectureName} is now unpublished and hidden from students`, 'info');
        }
        
        // In a real implementation, this would make an API call to update the publish status
        updatePublishStatus(lectureName, isPublished);
    }
}

/**
 * Update publish status on the server
 * @param {string} lectureName - Name of the lecture/week
 * @param {boolean} isPublished - Whether the content should be published
 */
async function updatePublishStatus(lectureName, isPublished) {
    try {
        // Simulate API call to update publish status
        const response = await fetch('/api/lectures/publish', {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json',
            },
            body: JSON.stringify({
                lectureName: lectureName,
                isPublished: isPublished,
                instructorId: getCurrentInstructorId()
            })
        });
        
        if (!response.ok) {
            throw new Error('Failed to update publish status');
        }
        
        console.log(`Publish status updated for ${lectureName}: ${isPublished}`);
        
    } catch (error) {
        console.error('Error updating publish status:', error);
        showNotification('Error updating publish status. Please try again.', 'error');
        
        // Revert the toggle if the API call failed
        const toggleId = `publish-${lectureName.toLowerCase().replace(/\s+/g, '-')}`;
        const toggle = document.getElementById(toggleId);
        if (toggle) {
            toggle.checked = !isPublished;
            togglePublish(lectureName, !isPublished);
        }
    }
}

/**
 * Get current instructor ID (placeholder function)
 * @returns {string} Instructor ID
 */
function getCurrentInstructorId() {
    // In a real implementation, this would get the instructor ID from the session/token
    return 'instructor-123';
}

// Mode Questions Modal functionality
let currentQuestions = [];
let questionCounter = 1;

/**
 * Open the mode questions modal
 */
function openModeQuestionsModal() {
    document.getElementById('mode-questions-modal').classList.add('show');
    loadModeQuestions();
}

/**
 * Close the mode questions modal
 */
function closeModeQuestionsModal() {
    const modal = document.getElementById('mode-questions-modal');
    if (modal) {
        modal.classList.remove('show');
    }
}

/**
 * Load existing mode questions
 */
async function loadModeQuestions() {
    try {
        // In a real implementation, this would fetch from the server
        // For now, we'll use mock data
        const mockQuestions = [
            {
                id: 1,
                question: "What is the primary function of enzymes in biochemical reactions?",
                options: [
                    "To slow down reactions",
                    "To speed up reactions",
                    "To change the direction of reactions",
                    "To prevent reactions from occurring"
                ],
                correctAnswer: 1
            },
            {
                id: 2,
                question: "Which of the following best describes the structure of an amino acid?",
                options: [
                    "A single carbon atom with various side chains",
                    "A central carbon atom with an amino group, carboxyl group, hydrogen, and R group",
                    "A chain of carbon atoms with oxygen at the end",
                    "A ring structure with nitrogen atoms"
                ],
                correctAnswer: 1
            },
            {
                id: 3,
                question: "What is the role of ATP in cellular processes?",
                options: [
                    "To provide structural support",
                    "To store and transfer energy",
                    "To act as a genetic material",
                    "To transport oxygen"
                ],
                correctAnswer: 1
            }
        ];
        
        currentQuestions = mockQuestions;
        questionCounter = mockQuestions.length + 1;
        renderQuestions();
        
        // Load threshold
        const threshold = 70; // In real implementation, fetch from server
        document.getElementById('mode-threshold').value = threshold;
        document.getElementById('threshold-value').textContent = threshold + '%';
        
    } catch (error) {
        console.error('Error loading mode questions:', error);
        showNotification('Error loading questions. Please try again.', 'error');
    }
}

/**
 * Render questions in the modal
 */
function renderQuestions() {
    const questionsList = document.getElementById('questions-list');
    questionsList.innerHTML = '';
    
    currentQuestions.forEach((question, index) => {
        const questionElement = document.createElement('div');
        questionElement.className = 'question-item';
        questionElement.innerHTML = `
            <div class="question-header">
                <span class="question-number">Question ${index + 1}</span>
                <button class="delete-question" onclick="deleteQuestion(${index})">×</button>
            </div>
            <div class="question-content">
                <div class="question-text-container">
                    <label class="question-label">Question Text:</label>
                    <input type="text" class="question-text" value="${question.question}" 
                           placeholder="Enter your question here..." 
                           onchange="updateQuestion(${index}, 'question', this.value)">
                </div>
                <div class="options-container">
                    <label class="options-label">Answer Options:</label>
                    <div class="options-list">
                        ${question.options.map((option, optionIndex) => `
                            <div class="option-item">
                                <div class="option-input-group">
                                    <input type="radio" name="correct-${index}" value="${optionIndex}" 
                                           ${optionIndex === question.correctAnswer ? 'checked' : ''}
                                           onchange="updateQuestion(${index}, 'correctAnswer', ${optionIndex})"
                                           class="correct-radio">
                                    <input type="text" value="${option}" 
                                           placeholder="Option ${optionIndex + 1}"
                                           onchange="updateQuestionOption(${index}, ${optionIndex}, this.value)"
                                           class="option-text">
                                </div>
                                <div class="score-box"></div>
                            </div>
                        `).join('')}
                    </div>
                </div>
            </div>
        `;
        questionsList.appendChild(questionElement);
    });
}

/**
 * Add a new question
 */
function addNewQuestion() {
    const newQuestion = {
        id: questionCounter++,
        question: "",
        options: ["", "", "", ""],
        correctAnswer: 0
    };
    
    currentQuestions.push(newQuestion);
    renderQuestions();
}

/**
 * Delete a question
 * @param {number} index - Index of the question to delete
 */
function deleteQuestion(index) {
    if (currentQuestions.length <= 1) {
        showNotification('You must have at least one question.', 'error');
        return;
    }
    
    currentQuestions.splice(index, 1);
    renderQuestions();
}

/**
 * Update question text or correct answer
 * @param {number} index - Question index
 * @param {string} field - Field to update ('question' or 'correctAnswer')
 * @param {string|number} value - New value
 */
function updateQuestion(index, field, value) {
    if (index >= 0 && index < currentQuestions.length) {
        currentQuestions[index][field] = value;
    }
}

/**
 * Update question option text
 * @param {number} index - Question index
 * @param {number} optionIndex - Option index
 * @param {string} value - New option text
 */
function updateQuestionOption(index, optionIndex, value) {
    if (index >= 0 && index < currentQuestions.length && 
        optionIndex >= 0 && optionIndex < 4) {
        currentQuestions[index].options[optionIndex] = value;
    }
}

/**
 * Save mode questions
 */
async function saveModeQuestions() {
    const threshold = document.getElementById('mode-threshold').value;
    
    // Validate questions
    for (let i = 0; i < currentQuestions.length; i++) {
        const question = currentQuestions[i];
        if (!question.question.trim()) {
            showNotification(`Question ${i + 1} cannot be empty.`, 'error');
            return;
        }
        
        for (let j = 0; j < question.options.length; j++) {
            if (!question.options[j].trim()) {
                showNotification(`Question ${i + 1}, Option ${j + 1} cannot be empty.`, 'error');
                return;
            }
        }
    }
    
    try {
        // In a real implementation, this would save to the server
        const response = await fetch('/api/mode-questions', {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json',
            },
            body: JSON.stringify({
                questions: currentQuestions,
                threshold: parseInt(threshold),
                instructorId: getCurrentInstructorId()
            })
        });
        
        if (!response.ok) {
            throw new Error('Failed to save questions');
        }
        
        showNotification('Mode questions saved successfully!', 'success');
        closeModeQuestionsModal();
        
    } catch (error) {
        console.error('Error saving mode questions:', error);
        // For demo purposes, still close the modal and show success
        showNotification('Mode questions saved successfully! (Demo mode)', 'success');
        closeModeQuestionsModal();
    }
}

// Setup threshold slider
document.addEventListener('DOMContentLoaded', function() {
    const thresholdSlider = document.getElementById('mode-threshold');
    const thresholdValue = document.getElementById('threshold-value');
    
    if (thresholdSlider && thresholdValue) {
        thresholdSlider.addEventListener('input', function() {
            thresholdValue.textContent = this.value + '%';
        });
    }
}); 