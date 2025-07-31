document.addEventListener('DOMContentLoaded', () => {
    const uploadDropArea = document.getElementById('upload-drop-area');
    const fileUpload = document.getElementById('file-upload');
    const documentSearch = document.getElementById('document-search');
    const documentFilter = document.getElementById('document-filter');
    const courseSelect = document.getElementById('course-select');
    const accordionHeaders = document.querySelectorAll('.accordion-header');
    const sectionHeaders = document.querySelectorAll('.section-header');
    
    // Initialize section headers to be clickable
    sectionHeaders.forEach(header => {
        header.addEventListener('click', (e) => {
            toggleSection(header);
        });
    });
    
    console.log('Instructor interface initialized');
    
    // Check for URL parameters to open modals
    checkUrlParameters();
    
    // Handle accordion toggling
    accordionHeaders.forEach(header => {
        header.addEventListener('click', (e) => {
            // Don't toggle if clicking on the toggle switch
            if (e.target.closest('.publish-toggle')) {
                return;
            }
            
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
    
    // Reset step visibility
    document.querySelectorAll('.modal-step').forEach(stepEl => {
        stepEl.classList.remove('active');
    });
    document.getElementById('step-1').classList.add('active');
    
    // Reset step indicators
    document.querySelectorAll('.step-dot').forEach(dot => {
        dot.classList.remove('active');
    });
    document.querySelector('[data-step="1"]').classList.add('active');
    
    // Reset button
    const nextBtn = document.getElementById('next-btn');
    nextBtn.style.display = 'block';
    nextBtn.textContent = 'Next';
    nextBtn.disabled = false;
    
    // Reset content type selection
    document.querySelectorAll('.content-type-btn').forEach(btn => {
        btn.classList.remove('selected');
    });
    
    // Reset file upload
    const fileInfo = document.getElementById('file-info');
    if (fileInfo) fileInfo.style.display = 'none';
    
    // Reset learning objectives
    const learningObjectives = document.getElementById('learning-objectives');
    if (learningObjectives) learningObjectives.value = '';
    
    // Reset skip checkbox
    const skipCheckbox = document.getElementById('skip-objectives');
    if (skipCheckbox) {
        skipCheckbox.checked = false;
        const objectivesInput = document.getElementById('objectives-input');
        if (objectivesInput) objectivesInput.classList.remove('hidden');
    }
    
    // Reset file input
    const fileInput = document.getElementById('file-input');
    if (fileInput) fileInput.value = '';
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
    
    // Auto-select skip objectives for certain content types
    autoSelectSkipObjectives(contentType);
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
        
        // Check if objectives are required (not skipped)
        const skipCheckbox = document.getElementById('skip-objectives');
        const objectives = document.getElementById('learning-objectives').value.trim();
        
        console.log('Skip checkbox checked:', skipCheckbox.checked);
        console.log('Objectives value:', objectives);
        
        // If skip is checked, allow proceeding without objectives
        if (skipCheckbox.checked) {
            console.log('Skip is checked, proceeding without objectives');
            processFileAndShowPreview();
            goToStep(3);
            return;
        }
        
        // If skip is not checked, require objectives
        if (!objectives) {
            showNotification('Please enter learning objectives or check "Skip learning objectives"', 'error');
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
        
        // Check if objectives were skipped
        const skipCheckbox = document.getElementById('skip-objectives');
        const userObjectives = document.getElementById('learning-objectives').value.trim();
        
        let extractedObjectives = [];
        let extractedTopics = [];
        let contentSummary = '';
        
        if (skipCheckbox.checked) {
            // No learning objectives for this content type
            extractedObjectives = ['No specific learning objectives - this content provides general information'];
            extractedTopics = [
                'Course information and policies',
                'Schedule and timeline',
                'General course materials'
            ];
            contentSummary = 'This document contains general course information, policies, or administrative content that does not address specific learning objectives.';
        } else {
            // Use user-provided objectives or generate mock ones
            if (userObjectives) {
                // Split user objectives into individual items
                extractedObjectives = userObjectives.split('\n').filter(obj => obj.trim()).map(obj => obj.trim());
            } else {
                // Generate mock objectives based on content type
                extractedObjectives = [
                    'Students will understand the structure of amino acids',
                    'Students will be able to explain protein synthesis',
                    'Students will identify key biochemical pathways'
                ];
            }
            
            extractedTopics = [
                'Amino acid structure and properties',
                'Peptide bond formation',
                'Protein folding and structure',
                'Enzymatic reactions'
            ];
            
            contentSummary = 'This document covers fundamental concepts in biochemistry, focusing on amino acids, protein structure, and enzymatic reactions. It provides a comprehensive overview suitable for undergraduate students in biochemistry courses.';
        }
        
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
    openCalibrationModal('Week 1', 'Introduction to Biochemistry');
}

/**
 * Close the mode questions modal
 */
function closeModeQuestionsModal() {
    closeCalibrationModal();
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
    saveCalibrationQuestions();
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

/**
 * Add a new week to the course structure
 */
function addNewWeek() {
    // Get the current number of weeks by counting existing week accordions
    // Only count accordions that have "Week" in their folder name
    const existingWeeks = document.querySelectorAll('.accordion-item');
    let weekCount = 0;
    
    existingWeeks.forEach(item => {
        const folderName = item.querySelector('.folder-name');
        if (folderName && folderName.textContent.includes('Week')) {
            weekCount++;
        }
    });
    
    const newWeekNumber = weekCount + 1;
    
    // Create the new week HTML
    const newWeekHTML = `
        <div class="accordion-item" id="week-${newWeekNumber}">
            <div class="accordion-header">
                <span class="folder-icon">📁</span>
                <span class="folder-name">Week ${newWeekNumber}</span>
                <div class="header-actions">
                    <div class="publish-toggle">
                        <label class="toggle-switch">
                            <input type="checkbox" id="publish-week${newWeekNumber}" onchange="togglePublish('Week ${newWeekNumber}', this.checked)">
                            <span class="toggle-slider"></span>
                        </label>
                        <span class="toggle-label">Published</span>
                    </div>
                    <span class="accordion-toggle">▶</span>
                </div>
            </div>
            <div class="accordion-content collapsed">
                <!-- Learning Objectives Section -->
                <div class="unit-section learning-objectives-section">
                    <div class="section-header">
                        <h3>Learning Objectives</h3>
                        <button class="toggle-section">▼</button>
                    </div>
                    <div class="section-content">
                        <div class="objectives-list" id="objectives-list-week${newWeekNumber}">
                            <!-- Objectives will be added here -->
                        </div>
                        <div class="objective-input-container">
                            <input type="text" id="objective-input-week${newWeekNumber}" class="objective-input" placeholder="Enter learning objective...">
                            <button class="add-objective-btn-inline" onclick="addObjectiveFromInput('Week ${newWeekNumber}')">+</button>
                        </div>
                        <div class="save-objectives">
                            <button class="save-btn" onclick="saveObjectives('Week ${newWeekNumber}')">Save Learning Objectives</button>
                        </div>
                    </div>
                </div>
                
                <!-- Course Materials Section -->
                <div class="unit-section course-materials-section">
                    <div class="section-header">
                        <h3>Course Materials</h3>
                        <button class="toggle-section">▼</button>
                    </div>
                    <div class="section-content">
                        <!-- Empty content - instructor can add files via the modal -->
                        <div class="add-content-section">
                            <button class="add-content-btn" onclick="openUploadModal('Week ${newWeekNumber}')">
                                <span class="btn-icon">➕</span>
                                Add content to this week
                            </button>
                        </div>
                    </div>
                </div>
                
                <!-- Probing Questions Section -->
                <div class="unit-section probing-questions-section">
                    <div class="section-header">
                        <h3>Probing Questions</h3>
                        <button class="toggle-section">▼</button>
                    </div>
                    <div class="section-content">
                        <p>No probing questions added yet. Configure a calibration quiz for this week.</p>
                    </div>
                </div>
            </div>
        </div>
    `;
    
    // Insert the new week before the "Add Week" button
    const addWeekSection = document.querySelector('.add-week-section');
    const accordionContainer = document.querySelector('.accordion-container');
    
    // Create a temporary container to parse the HTML
    const temp = document.createElement('div');
    temp.innerHTML = newWeekHTML;
    const newWeekElement = temp.firstElementChild;
    
    // Insert the new week before the add week section
    accordionContainer.insertBefore(newWeekElement, addWeekSection);
    
    // Add event listener to the new accordion header
    const newHeader = newWeekElement.querySelector('.accordion-header');
    newHeader.addEventListener('click', () => {
        const accordionItem = newHeader.parentElement;
        const content = accordionItem.querySelector('.accordion-content');
        const toggle = newHeader.querySelector('.accordion-toggle');
        
        // Toggle the collapsed class
        content.classList.toggle('collapsed');
        
        // Update the toggle icon
        if (content.classList.contains('collapsed')) {
            toggle.textContent = '▶';
        } else {
            toggle.textContent = '▼';
        }
    });
    
    // Show success notification
    showNotification(`Week ${newWeekNumber} added successfully!`, 'success');
    
    // Add event listeners to the new section headers
    const newSectionHeaders = newWeekElement.querySelectorAll('.section-header');
    newSectionHeaders.forEach(header => {
        header.addEventListener('click', () => {
            toggleSection(header);
        });
    });
    
    // Update the add week button to reflect the new week number
    const addWeekBtn = document.querySelector('.add-week-btn');
    addWeekBtn.innerHTML = `
        <span class="btn-icon">➕</span>
        Add Week ${newWeekNumber + 1}
    `;
}

/**
 * Delete a file item
 * @param {HTMLElement} button - The delete button element
 */
function deleteFileItem(button) {
    const fileItem = button.closest('.file-item');
    const fileName = fileItem.querySelector('h3').textContent;
    
    // Show confirmation dialog
    if (confirm(`Are you sure you want to delete "${fileName}"?`)) {
        // Remove the file item from the DOM
        fileItem.remove();
        
        // Show success notification
        showNotification(`"${fileName}" has been deleted successfully!`, 'success');
    }
}

/**
 * View a file item content
 * @param {HTMLElement} button - The view button element
 */
function viewFileItem(button) {
    const fileItem = button.closest('.file-item');
    const fileName = fileItem.querySelector('h3').textContent;
    const fileDescription = fileItem.querySelector('p').textContent;
    
    // Generate mock content based on the file name
    const mockContent = generateMockContent(fileName, fileDescription);
    
    // Open the view modal
    openViewModal(fileName, mockContent);
}

/**
 * Generate mock content based on file name
 * @param {string} fileName - The name of the file
 * @param {string} description - The file description
 * @returns {string} Mock content for the file
 */
function generateMockContent(fileName, description) {
    // Generate different content based on the file type/name
    if (fileName.includes('Introduction')) {
        return `
            <h2>Introduction to Biochemistry</h2>
            <p><strong>Course Overview:</strong> This course provides a comprehensive introduction to the fundamental principles of biochemistry and molecular biology. Students will explore the chemical basis of life, from simple molecules to complex cellular processes.</p>
            
            <h3>Learning Objectives:</h3>
            <ul>
                <li>Understand the basic principles of biochemistry</li>
                <li>Identify the four major classes of biomolecules</li>
                <li>Explain the relationship between structure and function in biological molecules</li>
                <li>Describe the central dogma of molecular biology</li>
            </ul>
            
            <h3>Key Concepts:</h3>
            <p><strong>Biomolecules:</strong> The four major classes of biomolecules are carbohydrates, lipids, proteins, and nucleic acids. Each class has distinct chemical properties and biological functions.</p>
            
            <p><strong>Metabolism:</strong> The sum of all chemical reactions that occur within a living organism. These reactions are organized into metabolic pathways that convert molecules into other molecules.</p>
            
            <p><strong>Enzymes:</strong> Biological catalysts that speed up chemical reactions without being consumed in the process. They are typically proteins that bind specific substrates and lower the activation energy of reactions.</p>
        `;
    } else if (fileName.includes('Amino Acids')) {
        return `
            <h2>Amino Acids, Peptides, and Proteins</h2>
            <p><strong>Structure of Amino Acids:</strong> Amino acids are the building blocks of proteins. Each amino acid contains a central carbon atom (α-carbon) bonded to an amino group (-NH₂), a carboxyl group (-COOH), a hydrogen atom, and a unique side chain (R-group).</p>
            
            <h3>The 20 Standard Amino Acids:</h3>
            <p>Amino acids can be classified based on their side chain properties:</p>
            <ul>
                <li><strong>Nonpolar (hydrophobic):</strong> Alanine, Valine, Leucine, Isoleucine, Methionine, Phenylalanine, Tryptophan, Proline</li>
                <li><strong>Polar (hydrophilic):</strong> Serine, Threonine, Cysteine, Asparagine, Glutamine, Tyrosine</li>
                <li><strong>Charged:</strong> Lysine, Arginine, Histidine (basic); Aspartic acid, Glutamic acid (acidic)</li>
            </ul>
            
            <h3>Peptide Bond Formation:</h3>
            <p>Peptide bonds are formed through a condensation reaction between the carboxyl group of one amino acid and the amino group of another, releasing a water molecule. This creates a peptide chain with the backbone structure: -N-C-C-N-C-C-</p>
            
            <h3>Protein Structure Levels:</h3>
            <ol>
                <li><strong>Primary:</strong> Linear sequence of amino acids</li>
                <li><strong>Secondary:</strong> Local folding patterns (α-helices, β-sheets)</li>
                <li><strong>Tertiary:</strong> Overall 3D structure of a single polypeptide</li>
                <li><strong>Quaternary:</strong> Assembly of multiple polypeptide subunits</li>
            </ol>
        `;
    } else if (fileName.includes('Enzymes')) {
        return `
            <h2>Enzymes: Basic Concepts and Kinetics</h2>
            <p><strong>Enzyme Definition:</strong> Enzymes are biological catalysts that accelerate chemical reactions by lowering the activation energy barrier. They are typically proteins (though some RNA molecules can also act as enzymes).</p>
            
            <h3>Enzyme-Substrate Interaction:</h3>
            <p>The enzyme binds to its substrate(s) at the active site, forming an enzyme-substrate complex. This binding is highly specific due to the complementary shape and chemical properties of the active site and substrate.</p>
            
            <h3>Michaelis-Menten Kinetics:</h3>
            <p>The relationship between substrate concentration and reaction rate follows the Michaelis-Menten equation:</p>
            <p><em>v = Vmax[S] / (Km + [S])</em></p>
            <ul>
                <li><strong>Vmax:</strong> Maximum reaction rate when enzyme is saturated</li>
                <li><strong>Km:</strong> Michaelis constant - substrate concentration at half Vmax</li>
                <li><strong>[S]:</strong> Substrate concentration</li>
            </ul>
            
            <h3>Factors Affecting Enzyme Activity:</h3>
            <ul>
                <li><strong>Temperature:</strong> Activity increases with temperature until denaturation occurs</li>
                <li><strong>pH:</strong> Enzymes have optimal pH ranges for activity</li>
                <li><strong>Substrate concentration:</strong> Rate increases with substrate until saturation</li>
                <li><strong>Enzyme concentration:</strong> Rate is directly proportional to enzyme concentration</li>
            </ul>
        `;
    } else if (fileName.includes('Readings')) {
        return `
            <h2>Week 1 Required Readings</h2>
            <p><strong>Textbook Chapters:</strong></p>
            <ul>
                <li>Chapter 1: Introduction to Biochemistry</li>
                <li>Chapter 2: Water and pH</li>
                <li>Chapter 3: Amino Acids and Peptides</li>
            </ul>
            
            <h3>Research Papers:</h3>
            <ol>
                <li><strong>"The Central Dogma of Molecular Biology"</strong> by Francis Crick (1970)</li>
                <li><strong>"Structure and Function of Proteins"</strong> by Linus Pauling (1951)</li>
            </ol>
            
            <h3>Key Concepts to Focus On:</h3>
            <ul>
                <li>Chemical properties of water and their biological significance</li>
                <li>pH and buffer systems in biological systems</li>
                <li>Structure and properties of the 20 standard amino acids</li>
                <li>Peptide bond formation and protein primary structure</li>
            </ul>
            
            <h3>Study Questions:</h3>
            <ol>
                <li>How does the structure of water contribute to its role as a biological solvent?</li>
                <li>What are the Henderson-Hasselbalch equation and its applications?</li>
                <li>How do amino acid side chains determine protein structure and function?</li>
                <li>What is the significance of the peptide bond in protein structure?</li>
            </ol>
        `;
    } else if (fileName.includes('Quiz')) {
        return `
            <h2>Practice Quiz: Protein Structure</h2>
            <p><strong>Instructions:</strong> Answer the following questions to test your understanding of protein structure concepts. This quiz covers primary, secondary, tertiary, and quaternary protein structures.</p>
            
            <h3>Question 1:</h3>
            <p><strong>Which of the following best describes the primary structure of a protein?</strong></p>
            <ol type="a">
                <li>The overall 3D shape of the protein</li>
                <li>The linear sequence of amino acids</li>
                <li>The local folding patterns like α-helices</li>
                <li>The assembly of multiple polypeptide chains</li>
            </ol>
            <p><strong>Answer:</strong> b) The linear sequence of amino acids</p>
            
            <h3>Question 2:</h3>
            <p><strong>What type of bonds are primarily responsible for maintaining secondary structure?</strong></p>
            <ol type="a">
                <li>Peptide bonds</li>
                <li>Hydrogen bonds</li>
                <li>Disulfide bonds</li>
                <li>Ionic bonds</li>
            </ol>
            <p><strong>Answer:</strong> b) Hydrogen bonds</p>
            
            <h3>Question 3:</h3>
            <p><strong>Which of the following is NOT a type of secondary structure?</strong></p>
            <ol type="a">
                <li>α-helix</li>
                <li>β-sheet</li>
                <li>β-turn</li>
                <li>Random coil</li>
            </ol>
            <p><strong>Answer:</strong> d) Random coil (this is a tertiary structure element)</p>
        `;
    } else {
        // Generic content for other files
        return `
            <h2>${fileName}</h2>
            <p><strong>Description:</strong> ${description}</p>
            
            <h3>Content Overview:</h3>
            <p>This document contains important course materials related to ${fileName.toLowerCase()}. The content has been processed and is ready for student access.</p>
            
            <h3>Key Topics Covered:</h3>
            <ul>
                <li>Fundamental concepts and principles</li>
                <li>Important definitions and terminology</li>
                <li>Practical applications and examples</li>
                <li>Study questions and exercises</li>
            </ul>
            
            <h3>Learning Objectives:</h3>
            <p>After reviewing this material, students should be able to:</p>
            <ul>
                <li>Understand the core concepts presented</li>
                <li>Apply the knowledge to solve related problems</li>
                <li>Connect this material to other course topics</li>
                <li>Demonstrate comprehension through assessments</li>
            </ul>
        `;
    }
}

/**
 * Open the view modal with file content
 * @param {string} fileName - The name of the file
 * @param {string} content - The content to display
 */
function openViewModal(fileName, content) {
    // Create modal HTML if it doesn't exist
    let viewModal = document.getElementById('view-modal');
    if (!viewModal) {
        viewModal = document.createElement('div');
        viewModal.id = 'view-modal';
        viewModal.className = 'modal';
        viewModal.innerHTML = `
            <div class="modal-content">
                <div class="modal-header">
                    <h2 id="view-modal-title">View File</h2>
                    <button class="modal-close" onclick="closeViewModal()">×</button>
                </div>
                <div class="modal-body">
                    <div id="view-modal-content"></div>
                </div>
                <div class="modal-footer">
                    <div class="modal-actions">
                        <button class="btn-secondary" onclick="closeViewModal()">Close</button>
                    </div>
                </div>
            </div>
        `;
        document.body.appendChild(viewModal);
    }
    
    // Update modal content
    document.getElementById('view-modal-title').textContent = `View: ${fileName}`;
    document.getElementById('view-modal-content').innerHTML = content;
    
    // Show the modal
    viewModal.classList.add('show');
}

/**
 * Close the view modal
 */
function closeViewModal() {
    const modal = document.getElementById('view-modal');
    if (modal) {
        modal.classList.remove('show');
    }
}

/**
 * Toggle the learning objectives field visibility
 */
function toggleObjectivesField() {
    const skipCheckbox = document.getElementById('skip-objectives');
    const objectivesInput = document.getElementById('objectives-input');
    const learningObjectives = document.getElementById('learning-objectives');
    
    console.log('Toggle called, checkbox checked:', skipCheckbox.checked);
    
    if (skipCheckbox.checked) {
        objectivesInput.classList.add('hidden');
        learningObjectives.value = ''; // Clear the field when hidden
        console.log('Objectives field hidden');
    } else {
        objectivesInput.classList.remove('hidden');
        console.log('Objectives field shown');
    }
}

/**
 * Test checkbox functionality
 */
function testCheckbox() {
    const skipCheckbox = document.getElementById('skip-objectives');
    console.log('Checkbox element:', skipCheckbox);
    console.log('Checkbox checked:', skipCheckbox.checked);
    console.log('Checkbox value:', skipCheckbox.value);
}

/**
 * Auto-select skip objectives for certain content types
 * @param {string} contentType - The selected content type
 */
function autoSelectSkipObjectives(contentType) {
    const skipCheckbox = document.getElementById('skip-objectives');
    const objectivesInput = document.getElementById('objectives-input');
    
    // Auto-check skip for syllabus and other non-learning content
    if (contentType === 'syllabus') {
        skipCheckbox.checked = true;
        objectivesInput.classList.add('hidden');
    } else {
        skipCheckbox.checked = false;
        objectivesInput.classList.remove('hidden');
    }
}

/**
 * Check URL parameters and open modals accordingly
 */
function checkUrlParameters() {
    const urlParams = new URLSearchParams(window.location.search);
    const openModal = urlParams.get('openModal');

    if (openModal === 'modeQuestions') {
        // Small delay to ensure the page is fully loaded
        setTimeout(() => {
            openModeQuestionsModal();
        }, 100);
    }
} 

/**
 * Open the calibration modal for a specific week
 * @param {string} week - The week (e.g., 'Week 1')
 * @param {string} topic - The topic name (e.g., 'Introduction to Biochemistry')
 */
function openCalibrationModal(week, topic) {
    // Set the week and topic in the modal
    document.getElementById('calibration-week').textContent = week;
    document.getElementById('calibration-topic').textContent = topic;
    document.getElementById('calibration-topic-questions').textContent = topic;
    
    // Show the modal
    document.getElementById('calibration-modal').classList.add('show');
    
    // Load questions specific to this week/topic
    loadCalibrationQuestions(week);
}

/**
 * Close the calibration modal
 */
function closeCalibrationModal() {
    const modal = document.getElementById('calibration-modal');
    if (modal) {
        modal.classList.remove('show');
    }
}

/**
 * Load calibration questions for a specific week
 * @param {string} week - The week identifier (e.g., 'Week 1')
 */
async function loadCalibrationQuestions(week) {
    try {
        // In a real implementation, this would fetch questions specific to the week
        // For now, we'll use mock data with week-specific content
        let mockQuestions;
        
        if (week === 'Week 1') {
            mockQuestions = [
                {
                    id: 1,
                    question: "What is the primary focus of biochemistry?",
                    options: [
                        "The study of plant life",
                        "The study of chemical processes in living organisms",
                        "The study of ecosystems",
                        "The study of microorganisms"
                    ],
                    correctAnswer: 1
                },
                {
                    id: 2,
                    question: "Which of the following is a major biomolecule studied in biochemistry?",
                    options: [
                        "Silicon",
                        "Proteins",
                        "Plastic",
                        "Petroleum"
                    ],
                    correctAnswer: 1
                }
            ];
        } else if (week === 'Week 2') {
            mockQuestions = [
                {
                    id: 1,
                    question: "What is the basic building block of proteins?",
                    options: [
                        "Nucleotides",
                        "Amino acids",
                        "Fatty acids",
                        "Monosaccharides"
                    ],
                    correctAnswer: 1
                },
                {
                    id: 2,
                    question: "Which level of protein structure refers to the overall 3D arrangement?",
                    options: [
                        "Primary structure",
                        "Secondary structure",
                        "Tertiary structure",
                        "Quaternary structure"
                    ],
                    correctAnswer: 2
                }
            ];
        } else if (week === 'Week 3') {
            mockQuestions = [
                {
                    id: 1,
                    question: "What do enzymes primarily do in biochemical reactions?",
                    options: [
                        "Slow down reactions",
                        "Speed up reactions",
                        "Stop reactions",
                        "Reverse reactions"
                    ],
                    correctAnswer: 1
                },
                {
                    id: 2,
                    question: "In enzyme kinetics, what does Km represent?",
                    options: [
                        "Maximum reaction rate",
                        "Substrate concentration at half maximum velocity",
                        "Enzyme concentration",
                        "Inhibition constant"
                    ],
                    correctAnswer: 1
                }
            ];
        } else {
            // Default questions
            mockQuestions = [
                {
                    id: 1,
                    question: "Sample question for " + week,
                    options: [
                        "Option A",
                        "Option B",
                        "Option C",
                        "Option D"
                    ],
                    correctAnswer: 1
                }
            ];
        }
        
        currentQuestions = mockQuestions;
        questionCounter = mockQuestions.length + 1;
        renderQuestions();
        
        // Load threshold - in a real implementation, this would be specific to the week
        const threshold = 70;
        document.getElementById('mode-threshold').value = threshold;
        document.getElementById('threshold-value').textContent = threshold + '%';
        
    } catch (error) {
        console.error('Error loading calibration questions:', error);
        showNotification('Error loading questions. Please try again.', 'error');
    }
}

/**
 * Save calibration questions for the current week
 */
async function saveCalibrationQuestions() {
    const threshold = document.getElementById('mode-threshold').value;
    const week = document.getElementById('calibration-week').textContent;
    const topic = document.getElementById('calibration-topic').textContent;
    
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
        // In a real implementation, this would save to the server with the week identifier
        const response = await fetch('/api/calibration-questions', {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json',
            },
            body: JSON.stringify({
                week: week,
                topic: topic,
                questions: currentQuestions,
                threshold: parseInt(threshold),
                instructorId: getCurrentInstructorId()
            })
        });
        
        if (!response.ok) {
            throw new Error('Failed to save questions');
        }
        
        showNotification(`Calibration questions for ${week}: ${topic} saved successfully!`, 'success');
        closeCalibrationModal();
        
    } catch (error) {
        console.error('Error saving calibration questions:', error);
        // For demo purposes, still close the modal and show success
        showNotification(`Calibration questions for ${week}: ${topic} saved successfully! (Demo mode)`, 'success');
        closeCalibrationModal();
    }
} 

/**
 * Toggle a section's visibility
 * @param {HTMLElement} headerElement - The section header element
 */
function toggleSection(headerElement) {
    // If the clicked element is not the section header itself, find the closest section header
    const sectionHeader = headerElement.classList.contains('section-header') ? 
                          headerElement : headerElement.closest('.section-header');
    
    const sectionContent = sectionHeader.nextElementSibling;
    const toggleIcon = sectionHeader.querySelector('.toggle-section');
    
    // Toggle the collapsed class
    sectionContent.classList.toggle('collapsed');
    
    // Update the toggle icon
    if (sectionContent.classList.contains('collapsed')) {
        toggleIcon.textContent = '▶';
    } else {
        toggleIcon.textContent = '▼';
    }
}

/**
 * Add a new learning objective from the input field
 * @param {string} week - The week identifier (e.g., 'Week 1')
 */
function addObjectiveFromInput(week) {
    // Find the week element using our custom helper function
    const folderElement = findElementsContainingText('.accordion-item .folder-name', week)[0];
    const weekElement = folderElement.closest('.accordion-item');
    const inputField = weekElement.querySelector(`#objective-input-${week.toLowerCase().replace(/\s+/g, '')}`);
    const objectiveText = inputField.value.trim();
    
    if (!objectiveText) {
        showNotification('Please enter a learning objective.', 'error');
        return;
    }
    
    // Get the objectives list
    const objectivesList = weekElement.querySelector(`#objectives-list-${week.toLowerCase().replace(/\s+/g, '')}`);
    
    // Create new objective display item
    const objectiveItem = document.createElement('div');
    objectiveItem.className = 'objective-display-item';
    objectiveItem.innerHTML = `
        <span class="objective-text">${objectiveText}</span>
        <button class="remove-objective" onclick="removeObjective(this)">×</button>
    `;
    
    // Add to the list
    objectivesList.appendChild(objectiveItem);
    
    // Clear the input field
    inputField.value = '';
    inputField.focus();
}

/**
 * Remove a learning objective
 * @param {HTMLElement} button - The remove button element
 */
function removeObjective(button) {
    const objectiveItem = button.closest('.objective-display-item');
    objectiveItem.remove();
}

/**
 * Save learning objectives for a week
 * @param {string} week - The week identifier (e.g., 'Week 1')
 */
async function saveObjectives(week) {
    // Find the week element using our custom helper function
    const folderElement = findElementsContainingText('.accordion-item .folder-name', week)[0];
    const weekElement = folderElement.closest('.accordion-item');
    const objectiveItems = weekElement.querySelectorAll('.objective-text');
    
    // Collect all objectives
    const objectives = Array.from(objectiveItems).map(item => item.textContent.trim()).filter(value => value);
    
    if (objectives.length === 0) {
        showNotification('Please add at least one learning objective.', 'error');
        return;
    }
    
    try {
        // In a real implementation, this would save to the server
        const response = await fetch('/api/learning-objectives', {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json',
            },
            body: JSON.stringify({
                week: week,
                objectives: objectives,
                instructorId: getCurrentInstructorId()
            })
        });
        
        if (!response.ok) {
            throw new Error('Failed to save learning objectives');
        }
        
        showNotification(`Learning objectives for ${week} saved successfully!`, 'success');
        
    } catch (error) {
        console.error('Error saving learning objectives:', error);
        // For demo purposes, still show success
        showNotification(`Learning objectives for ${week} saved successfully! (Demo mode)`, 'success');
    }
}

/**
 * Helper function to find elements containing specific text
 * @param {string} selector - CSS selector for elements to search within
 * @param {string} text - Text to search for
 * @param {boolean} caseSensitive - Whether the search should be case sensitive
 * @returns {Array} - Array of matching elements
 */
function findElementsContainingText(selector, text, caseSensitive = false) {
    const elements = Array.from(document.querySelectorAll(selector));
    return elements.filter(element => {
        const elementText = element.textContent;
        if (caseSensitive) {
            return elementText.includes(text);
        } else {
            return elementText.toUpperCase().includes(text.toUpperCase());
        }
    });
}

// Initialize sections when DOM is loaded
document.addEventListener('DOMContentLoaded', function() {
    // Initialize all sections to be expanded by default
    document.querySelectorAll('.section-content').forEach(section => {
        if (!section.classList.contains('collapsed')) {
            const toggleButton = section.previousElementSibling.querySelector('.toggle-section');
            if (toggleButton) {
                toggleButton.textContent = '▼';
            }
        }
    });
}); 