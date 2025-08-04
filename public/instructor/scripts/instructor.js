document.addEventListener('DOMContentLoaded', () => {
    const uploadDropArea = document.getElementById('upload-drop-area');
    const fileUpload = document.getElementById('file-upload');
    const documentSearch = document.getElementById('document-search');
    const documentFilter = document.getElementById('document-filter');
    const courseSelect = document.getElementById('course-select');
    const accordionHeaders = document.querySelectorAll('.accordion-header');
    const sectionHeaders = document.querySelectorAll('.section-header');
    
    // Make sure all "Add Additional Material" buttons are visible
    const additionalMaterialButtons = document.querySelectorAll('.add-content-btn.additional-material');
    additionalMaterialButtons.forEach(button => {
        button.style.display = 'flex';
        button.style.visibility = 'visible';
        button.style.opacity = '1';
    });
    
    // Add click outside modal to close functionality
    document.addEventListener('click', (e) => {
        const uploadModal = document.getElementById('upload-modal');
        const calibrationModal = document.getElementById('calibration-modal');
        const viewModal = document.getElementById('view-modal');
        const questionModal = document.getElementById('question-modal');
        
        // Close upload modal if clicking outside
        if (uploadModal && uploadModal.classList.contains('show') && e.target === uploadModal) {
            closeUploadModal();
        }
        
        // Close calibration modal if clicking outside
        if (calibrationModal && calibrationModal.classList.contains('show') && e.target === calibrationModal) {
            closeCalibrationModal();
        }
        
        // Close view modal if clicking outside
        if (viewModal && viewModal.classList.contains('show') && e.target === viewModal) {
            closeViewModal();
        }
        
        // Close question modal if clicking outside
        if (questionModal && questionModal.classList.contains('show') && e.target === questionModal) {
            closeQuestionModal();
        }
    });
    
    // Initialize section headers to be clickable
    sectionHeaders.forEach(header => {
        header.addEventListener('click', (e) => {
            toggleSection(header, e);
        });
        
        // Make sure toggle icon matches initial state
        const sectionContent = header.nextElementSibling;
        const toggleIcon = header.querySelector('.toggle-section');
        if (sectionContent && toggleIcon) {
            if (sectionContent.classList.contains('collapsed')) {
                toggleIcon.textContent = '▶';
            } else {
                toggleIcon.textContent = '▼';
            }
        }
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
            
            // Use the improved toggle function
            toggleAccordionDynamic(content, toggle);
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
        let fileIcon = '';
        if (file.name.toLowerCase().includes('quiz')) {
            fileIcon = '';
        } else if (file.name.toLowerCase().includes('syllabus')) {
            fileIcon = '';
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
                    <span class="folder-icon"></span>
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
    
    // Initialize assessment system
    initializeAssessmentSystem();
    
    // Start monitoring lecture notes status changes
    monitorLectureNotesStatus();
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
let uploadedFile = null;
let currentWeek = null;
let currentContentType = null;

/**
 * Open the upload modal for a specific week and content type
 * @param {string} week - The week identifier (e.g., 'Week 1')
 * @param {string} contentType - The content type ('lecture-notes', 'practice-quiz', 'additional', etc.)
 */
function openUploadModal(week, contentType = '') {
    currentWeek = week;
    currentContentType = contentType;
    
    // Set dynamic modal title based on content type
    const modalTitle = document.getElementById('modal-title');
    const uploadFileBtn = document.querySelector('.upload-file-btn span:last-child');
    const nameInputSection = document.getElementById('name-input-section');
    let title = 'Upload Content';
    let buttonText = 'Upload Content';
    
    switch (contentType) {
        case 'lecture-notes':
            title = 'Upload Lecture Notes';
            buttonText = 'Upload Lecture Notes';
            break;
        case 'practice-quiz':
            title = 'Upload Practice Questions/Tutorial';
            buttonText = 'Upload Practice Questions';
            break;
        case 'readings':
            title = 'Upload Readings';
            buttonText = 'Upload Readings';
            break;
        case 'syllabus':
            title = 'Upload Syllabus';
            buttonText = 'Upload Syllabus';
            break;
        case 'additional':
            title = 'Upload Additional Material';
            buttonText = 'Upload Additional Material';
            break;
        default:
            title = `Upload Content for ${week}`;
            buttonText = 'Upload Content';
    }
    
    modalTitle.textContent = title;
    if (uploadFileBtn) {
        uploadFileBtn.textContent = buttonText;
    }
    
    // Show/hide name input section based on content type
    if (nameInputSection) {
        if (contentType === 'additional') {
            nameInputSection.style.display = 'flex';
        } else {
            nameInputSection.style.display = 'none';
        }
    }
    
    // Reset the modal to initial state
    resetModal();
    
    // Show the modal
    const modal = document.getElementById('upload-modal');
    modal.style.display = '';
    modal.classList.add('show');
}

/**
 * Close the upload modal
 */
function closeUploadModal() {
    const modal = document.getElementById('upload-modal');
    modal.classList.remove('show');
    modal.style.display = 'none';
    resetModal();
}

/**
 * Reset modal to initial state
 */
function resetModal() {
    uploadedFile = null;
    
    // Reset file input and info
    const fileInput = document.getElementById('file-input');
    const fileInfo = document.getElementById('file-info');
    const urlInput = document.getElementById('url-input');
    const textInput = document.getElementById('text-input');
    const materialName = document.getElementById('material-name');
    const uploadFileBtn = document.querySelector('.upload-file-btn span:last-child');
    
    if (fileInput) fileInput.value = '';
    if (fileInfo) fileInfo.style.display = 'none';
    if (urlInput) urlInput.value = '';
    if (textInput) textInput.value = '';
    if (materialName) materialName.value = '';
    
    // Reset upload file button text to default
    if (uploadFileBtn) {
        uploadFileBtn.textContent = 'Upload Content';
    }
    
    // Reset upload button text
    const uploadBtn = document.getElementById('upload-btn');
    if (uploadBtn) {
        uploadBtn.textContent = 'Upload';
        uploadBtn.disabled = false;
    }
}

/**
 * Trigger file input when upload button is clicked
 */
function triggerFileInput() {
    const fileInput = document.getElementById('file-input');
    fileInput.click();
}

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
    
    showNotification(`File "${file.name}" selected successfully`, 'success');
}

/**
 * Handle the main upload action
 */
async function handleUpload() {
    const urlInput = document.getElementById('url-input').value.trim();
    const textInput = document.getElementById('text-input').value.trim();
    const materialNameInput = document.getElementById('material-name').value.trim();
    const uploadBtn = document.getElementById('upload-btn');
    
    // Check if at least one input method is provided
    if (!uploadedFile && !urlInput && !textInput) {
        showNotification('Please provide content via file upload, URL, or direct text input', 'error');
        return;
    }
    
    // Disable upload button and show loading state
    uploadBtn.textContent = 'Uploading...';
    uploadBtn.disabled = true;
    
    try {
        // Simulate upload delay
        await new Promise(resolve => setTimeout(resolve, 2000));
        
        // Create content item based on what was provided
        let contentDescription = '';
        let fileName = '';
        
        if (uploadedFile) {
            fileName = uploadedFile.name;
            contentDescription = `Uploaded file: ${uploadedFile.name}`;
        } else if (urlInput) {
            fileName = `Content from URL`;
            contentDescription = `Imported from: ${urlInput}`;
        } else if (textInput) {
            fileName = `Direct text input`;
            contentDescription = `Direct text content (${textInput.length} characters)`;
        }
        
        // Generate proper file name based on content type
        switch (currentContentType) {
            case 'lecture-notes':
                fileName = `*Lecture Notes - ${currentWeek}`;
                break;
            case 'practice-quiz':
                fileName = `*Practice Questions/Tutorial - ${currentWeek}`;
                break;
            case 'readings':
                fileName = `Readings - ${currentWeek}`;
                break;
            case 'syllabus':
                fileName = `Syllabus - ${currentWeek}`;
                break;
            case 'additional':
                // Use custom name if provided, otherwise use default
                if (materialNameInput) {
                    fileName = materialNameInput;
                    contentDescription = `Additional Material: ${materialNameInput}`;
                } else {
                    fileName = `Additional Material - ${currentWeek}`;
                }
                break;
            default:
                fileName = fileName || `Content - ${currentWeek}`;
        }
        
        // Add the content to the appropriate week
        addContentToWeek(currentWeek, fileName, contentDescription);
        
        // Close modal and show success
        closeUploadModal();
        showNotification('Content uploaded and processed successfully!', 'success');
        
    } catch (error) {
        console.error('Error uploading content:', error);
        showNotification('Error uploading content. Please try again.', 'error');
        
        // Re-enable upload button
        uploadBtn.textContent = 'Upload';
        uploadBtn.disabled = false;
    }
}

/**
 * Add content to a specific week
 * @param {string} week - The week identifier
 * @param {string} fileName - The file name to display
 * @param {string} description - The file description
 */
function addContentToWeek(week, fileName, description) {
    // Find the week accordion item
    const weekAccordion = findElementsContainingText('.accordion-item .folder-name', week)[0].closest('.accordion-item');
    
    if (!weekAccordion) {
        console.error('Could not find week accordion for', week);
        return;
    }
    
    // Find existing file item to replace or create new one
    const courseMaterialsContent = weekAccordion.querySelector('.course-materials-section .section-content');
    let targetFileItem = null;
    
    // Check if we're replacing an existing placeholder
    const existingItems = courseMaterialsContent.querySelectorAll('.file-item');
    existingItems.forEach(item => {
        const title = item.querySelector('.file-info h3').textContent;
        if ((currentContentType === 'lecture-notes' && title.includes('*Lecture Notes')) ||
            (currentContentType === 'practice-quiz' && title.includes('*Practice Questions/Tutorial'))) {
            targetFileItem = item;
        }
    });
    
    if (targetFileItem) {
        // Update existing item
        targetFileItem.querySelector('.file-info h3').textContent = fileName;
        targetFileItem.querySelector('.file-info p').textContent = description;
        targetFileItem.querySelector('.status-text').textContent = 'Processed';
        targetFileItem.querySelector('.status-text').className = 'status-text processed';
        
        // Update action button to view instead of upload
        const uploadButton = targetFileItem.querySelector('.action-button.upload');
        if (uploadButton) {
            uploadButton.textContent = 'View';
            uploadButton.className = 'action-button view';
            uploadButton.onclick = () => viewFileItem(uploadButton);
        }
    } else {
        // Create new file item
        const fileItem = document.createElement('div');
        fileItem.className = 'file-item';
        fileItem.innerHTML = `
            <span class="file-icon">📄</span>
            <div class="file-info">
                <h3>${fileName}</h3>
                <p>${description}</p>
                <span class="status-text processed">Processed</span>
            </div>
            <div class="file-actions">
                <button class="action-button view" onclick="viewFileItem(this)">View</button>
                <button class="action-button delete" onclick="deleteFileItem(this)">Delete</button>
            </div>
        `;
        
        // Insert before the add content section
        const addContentSection = courseMaterialsContent.querySelector('.add-content-section');
        if (addContentSection) {
            courseMaterialsContent.insertBefore(fileItem, addContentSection);
        } else {
            courseMaterialsContent.appendChild(fileItem);
        }
    }
}

// Update the existing file upload event listener
document.addEventListener('DOMContentLoaded', function() {
    const fileInput = document.getElementById('file-input');
    
    if (fileInput) {
        fileInput.addEventListener('change', (e) => {
            if (e.target.files.length > 0) {
                handleFileUpload(e.target.files[0]);
            }
        });
    }
});

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

// Old modal functions removed - using simple modal now

// Old confirmUpload and addContentToAccordion functions removed - replaced with addContentToWeek

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
                <span class="folder-icon"></span>
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
                        <div class="file-item">
                            <span class="file-icon"></span>
                            <div class="file-info">
                                <h3>*Lecture Notes - Week ${newWeekNumber}</h3>
                                <p>Placeholder for required lecture notes. Please upload content.</p>
                                <span class="status-text">Not Uploaded</span>
                            </div>
                            <div class="file-actions">
                                <button class="action-button upload" onclick="openUploadModal('Week ${newWeekNumber}', 'lecture-notes')">Upload</button>
                                <button class="action-button delete" onclick="deleteFileItem(this)">Delete</button>
                            </div>
                        </div>
                        <div class="file-item">
                            <span class="file-icon"></span>
                            <div class="file-info">
                                <h3>*Practice Questions/Tutorial</h3>
                                <p>Placeholder for required practice questions. Please upload content.</p>
                                <span class="status-text">Not Uploaded</span>
                            </div>
                            <div class="file-actions">
                                <button class="action-button upload" onclick="openUploadModal('Week ${newWeekNumber}', 'practice-quiz')">Upload</button>
                                <button class="action-button delete" onclick="deleteFileItem(this)">Delete</button>
                            </div>
                        </div>
                        <!-- Add Content Button -->
                        <div class="add-content-section">
                            <button class="add-content-btn additional-material" onclick="openUploadModal('Week ${newWeekNumber}', 'additional')">
                                <span class="btn-icon">+</span>
                                Add Additional Material
                            </button>
                        </div>
                        <div class="save-objectives">
                            <button class="save-btn" onclick="confirmCourseMaterials('Week ${newWeekNumber}')">Confirm Course Materials</button>
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
                        <div class="objectives-list" id="questions-list-week${newWeekNumber}">
                            <!-- Questions will be added here -->
                        </div>
                        <div class="generate-questions-container">
                            <button class="generate-btn" onclick="generateProbingQuestions('Week ${newWeekNumber}')">
                                Generate Probing Questions
                            </button>
                            <p class="generate-help-text">Let AI  based on your uploaded course materials</p>
                        </div>
                        <div class="objective-input-container">
                            <input type="text" id="question-input-week${newWeekNumber}" class="objective-input" placeholder="Enter probing question...">
                            <button class="add-objective-btn-inline" onclick="addQuestionFromInput('Week ${newWeekNumber}')">+</button>
                        </div>
                        <div class="save-objectives">
                            <button class="save-btn" onclick="saveQuestions('Week ${newWeekNumber}')">Save Probing Questions</button>
                        </div>
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
    newHeader.addEventListener('click', (e) => {
        // Don't toggle if clicking on the toggle switch
        if (e.target.closest('.publish-toggle')) {
            return;
        }
        
        const accordionItem = newHeader.parentElement;
        const content = accordionItem.querySelector('.accordion-content');
        const toggle = newHeader.querySelector('.accordion-toggle');
        
        // Use the improved toggle function
        toggleAccordionDynamic(content, toggle);
    });
    
    // Show success notification
    showNotification(`Week ${newWeekNumber} added successfully!`, 'success');
    
    // Add event listeners to the new section headers
    const newSectionHeaders = newWeekElement.querySelectorAll('.section-header');
    newSectionHeaders.forEach(header => {
        header.addEventListener('click', (e) => {
            toggleSection(header, e);
        });
    });
    
    // Update the add week button to reflect the new week number
    const addWeekBtn = document.querySelector('.add-week-btn');
    addWeekBtn.innerHTML = `
        <span class="btn-icon">+</span>
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
    viewModal.style.display = ''; // Clear any inline display style
    viewModal.classList.add('show');
}

/**
 * Close the view modal
 */
function closeViewModal() {
    const modal = document.getElementById('view-modal');
    if (modal) {
        modal.classList.remove('show');
        // Ensure modal is hidden even if class removal doesn't work
        modal.style.display = 'none';
    }
}

// Old learning objectives functions removed - not used in simple modal

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
    const modal = document.getElementById('calibration-modal');
    modal.style.display = ''; // Clear any inline display style
    modal.classList.add('show');
    
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
        // Ensure modal is hidden even if class removal doesn't work
        modal.style.display = 'none';
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
 * @param {Event} e - The event object
 */
function toggleSection(headerElement, e) {
    // If an event was passed, prevent it from bubbling up
    if (e) {
        e.stopPropagation();
    }
    
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
 * Confirm course materials for a week
 * @param {string} week - The week identifier (e.g., 'Week 1')
 */
async function confirmCourseMaterials(week) {
    // Find the week element using our custom helper function
    const folderElement = findElementsContainingText('.accordion-item .folder-name', week)[0];
    const weekElement = folderElement.closest('.accordion-item');
    const fileItems = weekElement.querySelectorAll('.course-materials-section .file-item');
    
    // Check if mandatory materials are present
    let hasLectureNotes = false;
    let hasPracticeQuestions = false;
    
    fileItems.forEach(item => {
        const title = item.querySelector('.file-info h3').textContent;
        if (title.includes('*Lecture Notes')) {
            hasLectureNotes = true;
        }
        if (title.includes('*Practice Questions/Tutorial')) {
            hasPracticeQuestions = true;
        }
    });
    
    // Validate mandatory materials
    if (!hasLectureNotes || !hasPracticeQuestions) {
        let missingItems = [];
        if (!hasLectureNotes) missingItems.push('Lecture Notes');
        if (!hasPracticeQuestions) missingItems.push('Practice Questions/Tutorial');
        
        showNotification(`Missing mandatory materials: ${missingItems.join(', ')}. Please add them before confirming.`, 'error');
        return;
    }
    
    try {
        // In a real implementation, this would save to the server
        const response = await fetch('/api/course-materials/confirm', {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json',
            },
            body: JSON.stringify({
                week: week,
                instructorId: getCurrentInstructorId()
            })
        });
        
        if (!response.ok) {
            throw new Error('Failed to confirm course materials');
        }
        
        showNotification(`Course materials for ${week} confirmed successfully!`, 'success');
        
    } catch (error) {
        console.error('Error confirming course materials:', error);
        // For demo purposes, still show success
        showNotification(`Course materials for ${week} confirmed successfully! (Demo mode)`, 'success');
    }
}

/**
 * Add a new probing question from the input field
 * @param {string} week - The week identifier (e.g., 'Week 1')
 */
function addQuestionFromInput(week) {
    // Find the week element using our custom helper function
    const folderElement = findElementsContainingText('.accordion-item .folder-name', week)[0];
    const weekElement = folderElement.closest('.accordion-item');
    const inputField = weekElement.querySelector(`#question-input-${week.toLowerCase().replace(/\s+/g, '')}`);
    const questionText = inputField.value.trim();
    
    if (!questionText) {
        showNotification('Please enter a probing question.', 'error');
        return;
    }
    
    // Get the questions list
    const questionsList = weekElement.querySelector(`#questions-list-${week.toLowerCase().replace(/\s+/g, '')}`);
    
    // Create new question display item
    const questionItem = document.createElement('div');
    questionItem.className = 'objective-display-item';
    questionItem.innerHTML = `
        <span class="objective-text">${questionText}</span>
        <button class="remove-objective" onclick="removeQuestion(this)">×</button>
    `;
    
    // Add to the list
    questionsList.appendChild(questionItem);
    
    // Clear the input field
    inputField.value = '';
    inputField.focus();
}

/**
 * Remove a probing question
 * @param {HTMLElement} button - The remove button element
 */
function removeQuestion(button) {
    const questionItem = button.closest('.objective-display-item');
    questionItem.remove();
}

/**
 * Save probing questions for a week
 * @param {string} week - The week identifier (e.g., 'Week 1')
 */
async function saveQuestions(week) {
    // Find the week element using our custom helper function
    const folderElement = findElementsContainingText('.accordion-item .folder-name', week)[0];
    const weekElement = folderElement.closest('.accordion-item');
    const questionItems = weekElement.querySelectorAll('.probing-questions-section .objective-text');
    
    // Collect all questions
    const questions = Array.from(questionItems).map(item => item.textContent.trim()).filter(value => value);
    
    if (questions.length === 0) {
        showNotification('Please add at least one probing question.', 'error');
        return;
    }
    
    try {
        // In a real implementation, this would save to the server
        const response = await fetch('/api/probing-questions', {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json',
            },
            body: JSON.stringify({
                week: week,
                questions: questions,
                instructorId: getCurrentInstructorId()
            })
        });
        
        if (!response.ok) {
            throw new Error('Failed to save probing questions');
        }
        
        showNotification(`Probing questions for ${week} saved successfully!`, 'success');
        
    } catch (error) {
        console.error('Error saving probing questions:', error);
        // For demo purposes, still show success
        showNotification(`Probing questions for ${week} saved successfully! (Demo mode)`, 'success');
    }
}

/**
 * Generate probing questions based on uploaded course materials
 * @param {string} week - The week identifier (e.g., 'Week 1')
 */
async function generateProbingQuestions(week) {
    console.log('Generating probing questions for:', week);
    
    const weekElement = findElementsContainingText('.accordion-item .folder-name', week)[0].closest('.accordion-item');
    const fileItems = weekElement.querySelectorAll('.course-materials-section .file-item');
    
    // Check if there are uploaded materials
    let hasMaterials = false;
    fileItems.forEach(item => {
        const statusText = item.querySelector('.status-text').textContent;
        console.log('Found file item with status:', statusText);
        if (statusText === 'Processed') {
            hasMaterials = true;
        }
    });

    // For demo purposes, allow generation even without processed materials
    if (!hasMaterials) {
        showNotification('Generating probing questions based on general course content (no specific materials uploaded)...', 'info');
    } else {
        showNotification('Generating probing questions based on uploaded materials...', 'info');
    }

    try {
        // In a real implementation, this would call an AI API with the course materials
        // For now, we'll simulate a delay and generate some mock questions
        await new Promise(resolve => setTimeout(resolve, 2000));

        // Generate mock probing questions based on the week
        const mockQuestions = generateMockProbingQuestions(week);
        console.log('Generated questions:', mockQuestions);
        
        // Get the questions list for this week
        const questionsList = weekElement.querySelector(`#questions-list-${week.toLowerCase().replace(/\s+/g, '')}`);
        console.log('Questions list element:', questionsList);
        
        if (!questionsList) {
            console.error('Could not find questions list element for', week);
            showNotification('Error: Could not find questions list container.', 'error');
            return;
        }
        
        // Add each generated question to the list
        mockQuestions.forEach(questionText => {
            const questionItem = document.createElement('div');
            questionItem.className = 'objective-display-item';
            questionItem.innerHTML = `
                <span class="objective-text">${questionText}</span>
                <button class="remove-objective" onclick="removeQuestion(this)">×</button>
            `;
            questionsList.appendChild(questionItem);
        });

        showNotification(`${mockQuestions.length} probing questions generated successfully!`, 'success');

    } catch (error) {
        console.error('Error generating probing questions:', error);
        showNotification('Failed to generate probing questions. Please try again.', 'error');
    }
}

/**
 * Generate mock probing questions based on the week
 * @param {string} week - The week identifier (e.g., 'Week 1')
 * @returns {Array<string>} Array of probing question texts
 */
function generateMockProbingQuestions(week) {
    const questionSets = {
        'Week 1': [
            "Can you explain the relationship between water's molecular structure and its role as a biological solvent?",
            "How do buffer systems maintain pH homeostasis in living organisms?",
            "What would happen to cellular processes if amino acids couldn't form peptide bonds?",
            "How does the amphipathic nature of phospholipids contribute to membrane formation?"
        ],
        'Week 2': [
            "Can you predict how a change in pH would affect protein structure and function?",
            "How do you think the R-groups of amino acids influence protein folding patterns?",
            "What role do chaperone proteins play in preventing misfolded proteins?",
            "How might protein denaturation affect enzymatic activity in cells?"
        ],
        'Week 3': [
            "Can you explain why enzymes are more efficient than inorganic catalysts?",
            "How would competitive inhibition affect the Michaelis-Menten kinetics curve?",
            "What factors would you consider when designing an enzyme for industrial use?",
            "How do allosteric enzymes provide regulatory control in metabolic pathways?"
        ]
    };

    // Return questions for the specific week, or default questions
    return questionSets[week] || [
        "Can you connect the concepts from this week to previous material?",
        "How would you apply these principles to solve a real-world problem?",
        "What questions would you ask to deepen understanding of this topic?",
        "How do these concepts relate to current research in the field?"
    ];
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

/**
 * Toggle accordion with dynamic height calculation
 * @param {HTMLElement} content - The accordion content element
 * @param {HTMLElement} toggle - The toggle icon element
 */
function toggleAccordionDynamic(content, toggle) {
    const isCollapsed = content.classList.contains('collapsed');
    
    if (isCollapsed) {
        // Expanding: first remove collapsed class, measure height, then animate
        content.classList.remove('collapsed');
        
        // Force a reflow to get the actual height
        const height = content.scrollHeight;
        
        // Set max-height for smooth transition
        content.style.maxHeight = height + 'px';
        
        // Update toggle icon
        toggle.textContent = '▼';
        
        // Clean up after transition
        setTimeout(() => {
            content.style.maxHeight = 'none';
        }, 300);
        
    } else {
        // Collapsing: set height first, then add collapsed class
        const height = content.scrollHeight;
        content.style.maxHeight = height + 'px';
        
        // Force reflow
        content.offsetHeight;
        
        // Add collapsed class for transition
        content.classList.add('collapsed');
        
        // Update toggle icon
        toggle.textContent = '▶';
        
        // Clean up after transition
        setTimeout(() => {
            content.style.maxHeight = '';
        }, 300);
    }
}

// ==========================================
// Assessment Questions Functionality
// ==========================================

// Global variables for assessment questions
let assessmentQuestions = {
    'Week 1': [],
    'Week 2': [],
    'Week 3': []
};

/**
 * Open the question creation modal
 * @param {string} week - Week identifier (e.g., 'Week 1')
 */
function openQuestionModal(week) {
    currentWeek = week;
    const modal = document.getElementById('question-modal');
    if (modal) {
        modal.classList.add('show');
        // Reset form
        resetQuestionForm();
    }
}

/**
 * Close the question creation modal
 */
function closeQuestionModal() {
    const modal = document.getElementById('question-modal');
    if (modal) {
        modal.classList.remove('show');
        resetQuestionForm();
    }
}

/**
 * Reset the question form to initial state
 */
function resetQuestionForm() {
    document.getElementById('question-type').value = '';
    document.getElementById('question-text').value = '';
    
    // Hide all answer sections
    document.getElementById('tf-answer-section').style.display = 'none';
    document.getElementById('mcq-answer-section').style.display = 'none';
    document.getElementById('sa-answer-section').style.display = 'none';
    
    // Clear radio buttons
    const radioButtons = document.querySelectorAll('input[type="radio"]');
    radioButtons.forEach(radio => radio.checked = false);
    
    // Clear MCQ inputs
    const mcqInputs = document.querySelectorAll('.mcq-input');
    mcqInputs.forEach(input => input.value = '');
    
    // Clear short answer
    document.getElementById('sa-answer').value = '';
    
    // Hide AI generation button
    const aiButton = document.getElementById('ai-generate-btn');
    if (aiButton) {
        aiButton.style.display = 'none';
        aiButton.disabled = false;
    }
}

/**
 * Update question form based on selected question type
 */
function updateQuestionForm() {
    const questionType = document.getElementById('question-type').value;
    
    // Hide all sections first
    document.getElementById('tf-answer-section').style.display = 'none';
    document.getElementById('mcq-answer-section').style.display = 'none';
    document.getElementById('sa-answer-section').style.display = 'none';
    
    // Show relevant section
    if (questionType === 'true-false') {
        document.getElementById('tf-answer-section').style.display = 'block';
    } else if (questionType === 'multiple-choice') {
        document.getElementById('mcq-answer-section').style.display = 'block';
        // Add event listeners for MCQ inputs
        setupMCQValidation();
    } else if (questionType === 'short-answer') {
        document.getElementById('sa-answer-section').style.display = 'block';
    }
    
    // Check if AI generation should be available
    checkAIGenerationInModal();
}

/**
 * Setup validation for multiple choice inputs
 */
function setupMCQValidation() {
    const mcqInputs = document.querySelectorAll('.mcq-input');
    const radioButtons = document.querySelectorAll('input[name="mcq-correct"]');
    
    // Clear all radio buttons initially
    radioButtons.forEach(radio => {
        radio.checked = false;
        radio.disabled = true;
    });
    
    // Add event listeners to inputs
    mcqInputs.forEach(input => {
        input.addEventListener('input', function() {
            const option = this.dataset.option;
            const radioButton = document.querySelector(`input[name="mcq-correct"][value="${option}"]`);
            
            if (this.value.trim()) {
                radioButton.disabled = false;
            } else {
                radioButton.disabled = true;
                radioButton.checked = false;
            }
        });
    });
}

/**
 * Save the created question
 */
function saveQuestion() {
    const questionType = document.getElementById('question-type').value;
    const questionText = document.getElementById('question-text').value.trim();
    
    // Validation
    if (!questionType) {
        alert('Please select a question type.');
        return;
    }
    
    if (!questionText) {
        alert('Please enter a question.');
        return;
    }
    
    let question = {
        id: Date.now(), // Simple ID generation
        type: questionType,
        question: questionText
    };
    
    // Get answer based on type
    if (questionType === 'true-false') {
        const tfAnswer = document.querySelector('input[name="tf-answer"]:checked');
        if (!tfAnswer) {
            alert('Please select the correct answer (True/False).');
            return;
        }
        question.answer = tfAnswer.value;
    } else if (questionType === 'multiple-choice') {
        // Get all options
        const options = {};
        const mcqInputs = document.querySelectorAll('.mcq-input');
        let hasOptions = false;
        let hasCorrectAnswer = false;
        
        mcqInputs.forEach(input => {
            if (input.value.trim()) {
                options[input.dataset.option] = input.value.trim();
                hasOptions = true;
                
                // Check if this option is selected as correct
                const radioButton = input.parentElement.querySelector('input[name="mcq-correct"]');
                if (radioButton && radioButton.checked) {
                    hasCorrectAnswer = true;
                }
            }
        });
        
        if (!hasOptions) {
            alert('Please enter at least one answer option.');
            return;
        }
        
        if (!hasCorrectAnswer) {
            alert('Please select the correct answer for the options you have entered.');
            return;
        }
        
        const correctAnswer = document.querySelector('input[name="mcq-correct"]:checked');
        question.options = options;
        question.answer = correctAnswer.value;
    } else if (questionType === 'short-answer') {
        const saAnswer = document.getElementById('sa-answer').value.trim();
        if (!saAnswer) {
            alert('Please provide expected answer or key points.');
            return;
        }
        question.answer = saAnswer;
    }
    
    // Add question to the week's assessment
    if (!assessmentQuestions[currentWeek]) {
        assessmentQuestions[currentWeek] = [];
    }
    assessmentQuestions[currentWeek].push(question);
    
    // Update the display
    updateQuestionsDisplay(currentWeek);
    
    // Close modal
    closeQuestionModal();
    
    // Check if we should enable AI generation
    checkAIGenerationAvailability(currentWeek);
}

/**
 * Update the questions display for a week
 * @param {string} week - Week identifier
 */
function updateQuestionsDisplay(week) {
    const questionsContainer = document.getElementById(`assessment-questions-${week.toLowerCase().replace(' ', '')}`);
    if (!questionsContainer) return;
    
    const questions = assessmentQuestions[week] || [];
    
    if (questions.length === 0) {
        questionsContainer.innerHTML = `
            <div class="no-questions-message">
                <p>No assessment questions created yet. Click "Add Question" to get started.</p>
            </div>
        `;
        return;
    }
    
    let html = '';
    questions.forEach((question, index) => {
        html += `
            <div class="question-item" data-question-id="${question.id}">
                <div class="question-header">
                    <span class="question-type-badge ${question.type}">${getQuestionTypeLabel(question.type)}</span>
                    <span class="question-number">Question ${index + 1}</span>
                    <button class="delete-question-btn" onclick="deleteQuestion('${week}', ${question.id})">×</button>
                </div>
                <div class="question-content">
                    <p class="question-text">${question.question}</p>
                    ${getQuestionAnswerDisplay(question)}
                </div>
            </div>
        `;
    });
    
    questionsContainer.innerHTML = html;
    
    // Update pass threshold max value
    const thresholdInput = document.getElementById(`pass-threshold-${week.toLowerCase().replace(' ', '')}`);
    if (thresholdInput) {
        thresholdInput.max = questions.length;
        if (parseInt(thresholdInput.value) > questions.length) {
            thresholdInput.value = questions.length;
        }
    }
}

/**
 * Get question type label for display
 * @param {string} type - Question type
 * @returns {string} Display label
 */
function getQuestionTypeLabel(type) {
    switch (type) {
        case 'true-false': return 'T/F';
        case 'multiple-choice': return 'MCQ';
        case 'short-answer': return 'SA';
        default: return type;
    }
}

/**
 * Get question answer display HTML
 * @param {object} question - Question object
 * @returns {string} HTML string
 */
function getQuestionAnswerDisplay(question) {
    if (question.type === 'true-false') {
        return `<p class="answer-preview"><strong>Answer:</strong> ${question.answer === 'true' ? 'True' : 'False'}</p>`;
    } else if (question.type === 'multiple-choice') {
        let optionsHtml = '';
        Object.entries(question.options).forEach(([key, value]) => {
            const isCorrect = key === question.answer;
            optionsHtml += `<span class="mcq-option-preview ${isCorrect ? 'correct' : ''}">${key}) ${value}</span>`;
        });
        return `<div class="mcq-preview">${optionsHtml}</div>`;
    } else if (question.type === 'short-answer') {
        return `<p class="answer-preview"><strong>Expected:</strong> ${question.answer}</p>`;
    }
    return '';
}

/**
 * Delete a question
 * @param {string} week - Week identifier
 * @param {number} questionId - Question ID
 */
function deleteQuestion(week, questionId) {
    if (confirm('Are you sure you want to delete this question?')) {
        assessmentQuestions[week] = assessmentQuestions[week].filter(q => q.id !== questionId);
        updateQuestionsDisplay(week);
        checkAIGenerationAvailability(week);
    }
}

/**
 * Generate AI questions for a week
 * @param {string} week - Week identifier
 */
// AI generation is now handled within the question modal via generateAIQuestionContent()

// createAIQuestion function removed - replaced by createAIQuestionContent for modal use

/**
 * Check if lecture notes are uploaded for a week
 * @param {string} week - Week identifier
 * @returns {boolean} True if lecture notes are uploaded
 */
function checkLectureNotesUploaded(week) {
    // Look for lecture notes status in the week
    const weekLower = week.toLowerCase().replace(' ', '');
    const lectureNotesElement = document.querySelector(`[onclick*="'${week}'"][onclick*="lecture-notes"]`);
    
    if (lectureNotesElement) {
        // Check if there's a "Processed" status nearby
        const parentItem = lectureNotesElement.closest('.file-item');
        if (parentItem) {
            const statusElement = parentItem.querySelector('.status-text');
            return statusElement && statusElement.textContent === 'Processed';
        }
    }
    
    return false; // Default to false for now
}

/**
 * Monitor lecture notes status changes and update AI button
 * This function should be called whenever file status changes
 */
function monitorLectureNotesStatus() {
    // Set up a mutation observer to watch for status changes
    const observer = new MutationObserver(function(mutations) {
        mutations.forEach(function(mutation) {
            if (mutation.type === 'childList' || mutation.type === 'characterData') {
                // Check all weeks for status changes
                ['Week 1', 'Week 2', 'Week 3'].forEach(week => {
                    checkAIGenerationAvailability(week);
                });
            }
        });
    });
    
    // Observe the entire document for changes
    observer.observe(document.body, {
        childList: true,
        subtree: true,
        characterData: true
    });
}

/**
 * Check AI generation availability in the question modal
 */
function checkAIGenerationInModal() {
    const questionType = document.getElementById('question-type').value;
    const aiButton = document.getElementById('ai-generate-btn');
    
    if (!questionType) {
        // No question type selected, hide AI button
        aiButton.style.display = 'none';
        return;
    }
    
    // Check if lecture notes are uploaded for the current week
    if (!checkLectureNotesUploaded(currentWeek)) {
        // Lecture notes not uploaded, disable AI button
        aiButton.style.display = 'flex';
        aiButton.disabled = true;
        aiButton.title = 'Please upload lecture notes before generating AI questions.';
        return;
    }
    
    // Lecture notes uploaded and question type selected, enable AI button
    aiButton.style.display = 'flex';
    aiButton.disabled = false;
    aiButton.title = 'Generate AI question based on uploaded lecture notes.';
}

/**
 * Generate AI content for the current question in the modal
 */
function generateAIQuestionContent() {
    const questionType = document.getElementById('question-type').value;
    
    if (!questionType) {
        alert('Please select a question type first.');
        return;
    }
    
    if (!checkLectureNotesUploaded(currentWeek)) {
        alert('Please upload lecture notes before generating AI questions.');
        return;
    }
    
    // Show loading state
    const aiButton = document.getElementById('ai-generate-btn');
    const originalText = aiButton.innerHTML;
    aiButton.innerHTML = '<span class="ai-icon">⏳</span> Generating...';
    aiButton.disabled = true;
    
    // Generate AI content based on type
    const aiContent = createAIQuestionContent(questionType, currentWeek);
    
    // Populate form fields with AI content
    populateFormWithAIContent(aiContent);
    
    // Restore button state
    aiButton.innerHTML = originalText;
    aiButton.disabled = false;
}

/**
 * Create AI question content for the modal
 * @param {string} type - Question type
 * @param {string} week - Week identifier
 * @returns {Object} AI content object
 */
function createAIQuestionContent(type, week) {
    if (type === 'true-false') {
        return {
            question: `Based on the ${week} lecture notes, this concept is essential for understanding the course material.`,
            answer: Math.random() > 0.5 ? 'true' : 'false'
        };
    } else if (type === 'multiple-choice') {
        return {
            question: `According to the ${week} lecture notes, which of the following is most accurate?`,
            options: {
                'A': 'Option A based on lecture content',
                'B': 'Option B based on lecture content', 
                'C': 'Option C based on lecture content',
                'D': 'Option D based on lecture content'
            },
            answer: ['A', 'B', 'C', 'D'][Math.floor(Math.random() * 4)]
        };
    } else if (type === 'short-answer') {
        return {
            question: `Explain a key concept from the ${week} lecture notes and its significance.`,
            answer: 'Students should demonstrate understanding by explaining the concept clearly and showing its relevance to the course material.'
        };
    }
}

/**
 * Populate form fields with AI-generated content
 * @param {Object} aiContent - AI-generated content
 */
function populateFormWithAIContent(aiContent) {
    // Set question text
    document.getElementById('question-text').value = aiContent.question;
    
    // Set answer based on type
    const questionType = document.getElementById('question-type').value;
    
    if (questionType === 'true-false') {
        // Set radio button
        const radioButton = document.querySelector(`input[name="tf-answer"][value="${aiContent.answer}"]`);
        if (radioButton) {
            radioButton.checked = true;
        }
    } else if (questionType === 'multiple-choice') {
        // Set MCQ options
        Object.keys(aiContent.options).forEach(option => {
            const input = document.querySelector(`.mcq-input[data-option="${option}"]`);
            if (input) {
                input.value = aiContent.options[option];
            }
        });
        
        // Enable all radio buttons since we have content
        const radioButtons = document.querySelectorAll('input[name="mcq-correct"]');
        radioButtons.forEach(radio => {
            radio.disabled = false;
        });
        
        // Set correct answer
        const correctRadio = document.querySelector(`input[name="mcq-correct"][value="${aiContent.answer}"]`);
        if (correctRadio) {
            correctRadio.checked = true;
        }
        
        // Force enable all radio buttons again after a short delay
        setTimeout(() => {
            const radioButtons = document.querySelectorAll('input[name="mcq-correct"]');
            radioButtons.forEach(radio => {
                radio.disabled = false;
            });
            
            // Re-set the correct answer
            const correctRadio = document.querySelector(`input[name="mcq-correct"][value="${aiContent.answer}"]`);
            if (correctRadio) {
                correctRadio.checked = true;
            }
        }, 50);
    } else if (questionType === 'short-answer') {
        // Set short answer
        document.getElementById('sa-answer').value = aiContent.answer;
    }
}

/**
 * Check AI generation availability and update button state
 * @param {string} week - Week identifier
 */
function checkAIGenerationAvailability(week) {
    // This function is now primarily used for external AI generation buttons
    // The modal AI generation is handled by checkAIGenerationInModal()
    const weekLower = week.toLowerCase().replace(' ', '');
    const aiButton = document.getElementById(`generate-ai-${weekLower}`);
    
    if (aiButton) {
        const lectureNotesUploaded = checkLectureNotesUploaded(week);
        aiButton.disabled = !lectureNotesUploaded;
        
        if (lectureNotesUploaded) {
            aiButton.title = 'Generate questions using AI based on uploaded lecture notes';
        } else {
            aiButton.title = 'Upload lecture notes first to enable AI generation';
        }
    }
}

/**
 * Save assessment settings for a week
 * @param {string} week - Week identifier
 */
function saveAssessment(week) {
    const weekLower = week.toLowerCase().replace(' ', '');
    const thresholdInput = document.getElementById(`pass-threshold-${weekLower}`);
    const threshold = parseInt(thresholdInput.value);
    const questions = assessmentQuestions[week] || [];
    
    if (questions.length === 0) {
        alert('Please add at least one question before saving the assessment.');
        return;
    }
    
    if (threshold > questions.length) {
        alert(`Pass threshold cannot be greater than the total number of questions (${questions.length}).`);
        return;
    }
    
    // Save assessment data (this would normally go to backend)
    const assessmentData = {
        week: week,
        questions: questions,
        passThreshold: threshold,
        totalQuestions: questions.length,
        savedAt: new Date().toISOString()
    };
    
    console.log('Saving assessment:', assessmentData);
    
    // Show success message
    alert(`Assessment saved for ${week}!\nTotal Questions: ${questions.length}\nPass Threshold: ${threshold}`);
}

// Initialize assessment system - this will be called from the main DOMContentLoaded listener
function initializeAssessmentSystem() {
    // Initialize questions display for all weeks
    ['Week 1', 'Week 2', 'Week 3'].forEach(week => {
        updateQuestionsDisplay(week);
        checkAIGenerationAvailability(week);
    });
} 