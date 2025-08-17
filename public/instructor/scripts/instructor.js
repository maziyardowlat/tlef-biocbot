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
    
    // Load the saved publish status from the database
    loadPublishStatus();
    
    // Load the saved learning objectives from the database
    loadLearningObjectives();
    
    // Load the saved documents from the database
    loadDocuments();
    
    // Load the saved assessment questions from the database
    loadAssessmentQuestions();
    
    // Load the saved pass thresholds from the database
    loadPassThresholds();
    
    // Set up threshold input event listeners
    setupThresholdInputListeners();
    
    // Load course data if available (either from onboarding or existing course)
    loadCourseData();
    
    // Add global cleanup button
    addGlobalCleanupButton();
    
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
        const courseId = await getCurrentCourseId();
        const instructorId = getCurrentInstructorId();
        const lectureName = currentWeek;
        
        let uploadResult;
        
        if (uploadedFile) {
            // Handle file upload
            const formData = new FormData();
            formData.append('file', uploadedFile);
            formData.append('courseId', courseId);
            formData.append('lectureName', lectureName);
            formData.append('documentType', currentContentType);
            formData.append('instructorId', instructorId);
            
            const response = await fetch('/api/documents/upload', {
                method: 'POST',
                body: formData
            });
            
            if (!response.ok) {
                const errorText = await response.text();
                throw new Error(`Upload failed: ${response.status} ${errorText}`);
            }
            
            uploadResult = await response.json();
            
        } else if (textInput) {
            // Handle text submission
            const title = materialNameInput || `${currentContentType} - ${currentWeek}`;
            
            const response = await fetch('/api/documents/text', {
                method: 'POST',
                headers: {
                    'Content-Type': 'application/json',
                },
                body: JSON.stringify({
                    courseId: courseId,
                    lectureName: lectureName,
                    documentType: currentContentType,
                    instructorId: instructorId,
                    content: textInput,
                    title: title,
                    description: urlInput || ''
                })
            });
            
            if (!response.ok) {
                const errorText = await response.text();
                throw new Error(`Text submission failed: ${response.status} ${errorText}`);
            }
            
            uploadResult = await response.json();
            
        } else if (urlInput) {
            // Handle URL import (treat as text with URL as description)
            const title = materialNameInput || `Content from URL - ${currentWeek}`;
            
            const response = await fetch('/api/documents/text', {
                method: 'POST',
                headers: {
                    'Content-Type': 'application/json',
                },
                body: JSON.stringify({
                    courseId: courseId,
                    lectureName: lectureName,
                    documentType: currentContentType,
                    instructorId: instructorId,
                    content: `Content imported from: ${urlInput}`,
                    title: title,
                    description: urlInput
                })
            });
            
            if (!response.ok) {
                const errorText = await response.text();
                throw new Error(`URL import failed: ${response.status} ${errorText}`);
            }
            
            uploadResult = await response.json();
        }
        
        // Generate proper file name based on content type
        let fileName = '';
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
                fileName = materialNameInput || `Additional Material - ${currentWeek}`;
                break;
            default:
                fileName = uploadResult?.data?.title || `Content - ${currentWeek}`;
        }
        
        // Add the content to the appropriate week
        addContentToWeek(currentWeek, fileName, `Uploaded successfully - ${uploadResult?.data?.filename || fileName}`);
        
        // Close modal and show success
        closeUploadModal();
        showNotification(uploadResult?.message || 'Content uploaded successfully!', 'success');
        
    } catch (error) {
        console.error('Error uploading content:', error);
        showNotification(`Error uploading content: ${error.message}`, 'error');
        
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
        // Get the current course ID (for now, using a default)
        const courseId = await getCurrentCourseId();
        
        console.log(`Updating publish status: ${lectureName} -> ${isPublished}, Course: ${courseId}`);
        
        const requestBody = {
            lectureName: lectureName,
            isPublished: isPublished,
            instructorId: getCurrentInstructorId(),
            courseId: courseId
        };
        
        console.log('Request body:', requestBody);
        
        const response = await fetch('/api/lectures/publish', {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json',
            },
            body: JSON.stringify(requestBody)
        });
        
        console.log('Response status:', response.status);
        
        if (!response.ok) {
            const errorData = await response.json().catch(() => ({ message: 'Unknown error' }));
            console.error('Error response:', errorData);
            
            // Show specific error message
            const errorMessage = errorData.message || errorData.error || `Failed to update publish status: ${response.status}`;
            showNotification(`Error: ${errorMessage}`, 'error');
            
            // Revert the toggle if the API call failed
            const toggleId = `publish-${lectureName.toLowerCase().replace(/\s+/g, '')}`;
            const toggle = document.getElementById(toggleId);
            if (toggle) {
                toggle.checked = !isPublished;
                togglePublish(lectureName, !isPublished);
            }
            return;
        }
        
        const result = await response.json();
        console.log(`Publish status updated for ${lectureName}: ${isPublished}`, result);
        
        // Show success notification
        showNotification(result.message || 'Publish status updated successfully', 'success');
        
    } catch (error) {
        console.error('Error updating publish status:', error);
        showNotification('Error updating publish status. Please try again.', 'error');
        
        // Revert the toggle if the API call failed
        const toggleId = `publish-${lectureName.toLowerCase().replace(/\s+/g, '')}`;
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

/**
 * Get the current course ID for the instructor
 * @returns {Promise<string>} Course ID
 */
async function getCurrentCourseId() {
    // Check if we have a courseId from URL parameters (onboarding redirect)
    const urlParams = new URLSearchParams(window.location.search);
    const courseIdFromUrl = urlParams.get('courseId');
    
    if (courseIdFromUrl) {
        return courseIdFromUrl;
    }
    
    // If no course ID in URL, try to get it from the instructor's courses
    try {
        const instructorId = getCurrentInstructorId();
        const response = await fetch(`/api/onboarding/instructor/${instructorId}`);
        
        if (response.ok) {
            const result = await response.json();
            if (result.data && result.data.courses && result.data.courses.length > 0) {
                // Return the first course found
                const firstCourse = result.data.courses[0];
                console.log('Found existing course:', firstCourse.courseId);
                return firstCourse.courseId;
            }
        }
    } catch (error) {
        console.error('Error fetching instructor courses:', error);
    }
    
    // If no course found, show an error and redirect to onboarding
    console.error('No course ID found. Redirecting to onboarding...');
    showNotification('No course found. Please complete onboarding first.', 'error');
    setTimeout(() => {
        window.location.href = '/instructor/onboarding';
    }, 2000);
    
    // Return a placeholder (this should not be reached due to redirect)
    return null;
}

/**
 * Load the saved publish status for all lectures from the database
 */
async function loadPublishStatus() {
    try {
        const courseId = await getCurrentCourseId();
        const instructorId = getCurrentInstructorId();
        
        const response = await fetch(`/api/lectures/publish-status?instructorId=${instructorId}&courseId=${courseId}`);
        
        if (!response.ok) {
            throw new Error('Failed to fetch publish status');
        }
        
        const result = await response.json();
        const publishStatus = result.data.publishStatus;
        
        // Update all toggle switches to reflect the saved state
        Object.keys(publishStatus).forEach(lectureName => {
            const isPublished = publishStatus[lectureName];
            const toggleId = `publish-${lectureName.toLowerCase().replace(/\s+/g, '')}`;
            const toggle = document.getElementById(toggleId);
            
            if (toggle) {
                // Update the toggle state
                toggle.checked = isPublished;
                
                // Update the visual state
                const accordionItem = toggle.closest('.accordion-item');
                if (accordionItem) {
                    if (isPublished) {
                        accordionItem.classList.add('published');
                    } else {
                        accordionItem.classList.remove('published');
                    }
                }
            }
        });
        
        console.log('Publish status loaded from database:', publishStatus);
        
    } catch (error) {
        console.error('Error loading publish status:', error);
        showNotification('Error loading publish status. Using default values.', 'warning');
    }
}

/**
 * Load the saved learning objectives for all lectures from the database
 */
async function loadLearningObjectives() {
    try {
        const courseId = await getCurrentCourseId();
        
        // Get all accordion items (units/weeks)
        const accordionItems = document.querySelectorAll('.accordion-item');
        
        for (const item of accordionItems) {
            const folderName = item.querySelector('.folder-name');
            if (!folderName) continue;
            
            const lectureName = folderName.textContent;
            
            const response = await fetch(`/api/learning-objectives?week=${encodeURIComponent(lectureName)}&courseId=${courseId}`);
            
            if (response.ok) {
                const result = await response.json();
                const objectives = result.data.objectives;
                
                if (objectives && objectives.length > 0) {
                    // Clear existing objectives
                    const objectivesList = item.querySelector('.objectives-list');
                    if (objectivesList) {
                        objectivesList.innerHTML = '';
                        
                        // Add each objective
                        objectives.forEach(objective => {
                            const objectiveItem = document.createElement('div');
                            objectiveItem.className = 'objective-display-item';
                            objectiveItem.innerHTML = `
                                <span class="objective-text">${objective}</span>
                                <button class="remove-objective" onclick="removeObjective(this)">×</button>
                            `;
                            objectivesList.appendChild(objectiveItem);
                        });
                    }
                }
            }
        }
        
        console.log('Learning objectives loaded from database');
        
    } catch (error) {
        console.error('Error loading learning objectives:', error);
        showNotification('Error loading learning objectives. Using default values.', 'warning');
    }
}

/**
 * Load the saved documents for all lectures from the database
 */
async function loadDocuments() {
    try {
        const courseId = await getCurrentCourseId();
        console.log('Loading documents for course:', courseId);
        
        // Get all accordion items (units/weeks)
        const accordionItems = document.querySelectorAll('.accordion-item');
        console.log('Found accordion items:', accordionItems.length);
        
        for (const item of accordionItems) {
            const folderName = item.querySelector('.folder-name');
            if (!folderName) {
                console.log('No folder name found for item:', item);
                continue;
            }
            
            const lectureName = folderName.textContent;
            console.log('Processing lecture/unit:', lectureName);
            
            // Load documents from the course structure instead of separate API
            const response = await fetch(`/api/courses/${courseId}?instructorId=${getCurrentInstructorId()}`);
            
            if (response.ok) {
                const result = await response.json();
                const course = result.data;
                console.log('Course data loaded:', course);
                
                if (course && course.lectures) {
                    const unit = course.lectures.find(l => l.name === lectureName);
                    const documents = unit ? (unit.documents || []) : [];
                    console.log(`Unit ${lectureName} documents:`, documents);
                    
                    // Find the course materials section
                    const courseMaterialsSection = item.querySelector('.course-materials-section .section-content');
                    if (courseMaterialsSection) {
                        console.log('Found course materials section for', lectureName);
                        
                        // Clear ALL existing document items (both placeholders and actual documents)
                        const existingItems = courseMaterialsSection.querySelectorAll('.file-item');
                        console.log('Found existing items:', existingItems.length);
                        
                        existingItems.forEach(item => {
                            console.log('Removing existing item:', item);
                            item.remove();
                        });
                        
                        // ADD ALL DOCUMENTS - BACKEND HANDLES DELETION FROM BOTH DBs
                        if (documents && documents.length > 0) {
                            console.log(`Found ${documents.length} documents for ${lectureName}:`, documents);
                            
                            // Add all documents - backend ensures they exist in both databases
                            documents.forEach(doc => {
                                console.log('Creating document item for:', doc);
                                const documentItem = createDocumentItem(doc);
                                courseMaterialsSection.appendChild(documentItem);
                            });
                        } else {
                            console.log(`No documents found for ${lectureName}`);
                        }
                        
                        // Always add the required placeholder items if they don't exist
                        addRequiredPlaceholders(courseMaterialsSection, lectureName);
                        
                        // Add the "Add Additional Material" button and "Confirm Course Materials" button
                        addActionButtons(courseMaterialsSection, lectureName);
                        
                        // Add cleanup button if there are documents
                        if (documents && documents.length > 0) {
                            console.log(`Adding cleanup button for ${lectureName} with ${documents.length} documents`);
                            addCleanupButton(courseMaterialsSection, lectureName, courseId);
                        } else {
                            console.log(`No documents found for ${lectureName}, adding cleanup button anyway for manual cleanup`);
                            addCleanupButton(courseMaterialsSection, lectureName, courseId);
                        }
                    } else {
                        console.error('Course materials section not found for', lectureName);
                    }
                } else {
                    console.log('No course or lectures data found');
                }
            } else {
                console.error('Failed to load course data:', response.status);
            }
        }
        
        console.log('Documents loaded from course structure');
        
    } catch (error) {
        console.error('Error loading documents:', error);
        showNotification('Error loading documents. Using default values.', 'warning');
    }
}

/**
 * Create a document item element for display
 * @param {Object} doc - Document object from database
 * @returns {HTMLElement} Document item element
 */
function createDocumentItem(doc) {
    const documentItem = document.createElement('div');
    documentItem.className = 'file-item';
    documentItem.dataset.documentId = doc.documentId;
    
    const fileIcon = doc.contentType === 'text' ? '📝' : '📄';
    const statusText = doc.status === 'uploaded' ? 'Uploaded' : doc.status;
    
    documentItem.innerHTML = `
        <span class="file-icon">${fileIcon}</span>
        <div class="file-info">
            <h3>${doc.originalName}</h3>
            <p>${doc.metadata?.description || 'No description'}</p>
            <span class="status-text">${statusText}</span>
        </div>
        <div class="file-actions">
            <button class="action-button view" onclick="viewDocument('${doc.documentId}')">View</button>
            <button class="action-button delete" onclick="deleteDocument('${doc.documentId}')">Delete</button>
        </div>
    `;
    
    return documentItem;
}

/**
 * Delete a document
 * @param {string} documentId - Document identifier
 */
async function deleteDocument(documentId) {
    try {
        const instructorId = getCurrentInstructorId();
        
        // Delete the document - the backend will handle both document deletion and course structure updates
        const response = await fetch(`/api/documents/${documentId}`, {
            method: 'DELETE',
            headers: {
                'Content-Type': 'application/json',
            },
            body: JSON.stringify({
                instructorId: instructorId
            })
        });
        
        if (!response.ok) {
            const errorText = await response.text();
            throw new Error(`Delete failed: ${response.status} ${errorText}`);
        }
        
        // Remove the document item from the UI immediately
        const documentItem = document.querySelector(`[data-document-id="${documentId}"]`);
        if (documentItem) {
            documentItem.remove();
        }
        
        // Simple reload to sync with database
        await loadDocuments();
        
        showNotification('Document deleted successfully!', 'success');
        
    } catch (error) {
        console.error('Error deleting document:', error);
        showNotification(`Error deleting document: ${error.message}`, 'error');
    }
}



/**
 * Clean up orphaned document references in the course structure
 * This can be called manually to fix any existing orphaned documents
 */
async function cleanupOrphanedDocuments() {
    try {
        const courseId = await getCurrentCourseId();
        const instructorId = getCurrentInstructorId();
        
        showNotification('Cleaning up orphaned documents...', 'info');
        
        const response = await fetch('/api/documents/cleanup-orphans', {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json',
            },
            body: JSON.stringify({
                courseId: courseId,
                instructorId: instructorId
            })
        });
        
        if (!response.ok) {
            const errorText = await response.text();
            throw new Error(`Cleanup failed: ${response.status} ${errorText}`);
        }
        
        const result = await response.json();
        
        if (result.data.totalOrphans > 0) {
            showNotification(`Cleanup completed! Removed ${result.data.totalOrphans} orphaned documents.`, 'success');
            // Reload documents to reflect the cleanup
            await loadDocuments();
        } else {
            showNotification('No orphaned documents found. Course structure is clean!', 'success');
        }
        
    } catch (error) {
        console.error('Error cleaning up orphaned documents:', error);
        showNotification(`Error during cleanup: ${error.message}`, 'error');
    }
}

/**
 * View document content in a modal
 * @param {string} documentId - Document identifier
 */
async function viewDocument(documentId) {
    try {
        console.log('Viewing document:', documentId);
        
        // Fetch document content
        const response = await fetch(`/api/documents/${documentId}`);
        
        if (!response.ok) {
            const errorText = await response.text();
            throw new Error(`Failed to fetch document: ${response.status} ${errorText}`);
        }
        
        const result = await response.json();
        const document = result.data;
        
        if (!document) {
            throw new Error('Document not found');
        }
        
        // Create and show modal with document content
        showDocumentModal(document);
        
    } catch (error) {
        console.error('Error viewing document:', error);
        showNotification(`Error viewing document: ${error.message}`, 'error');
    }
}

/**
 * Load assessment questions directly from course data (for initial load)
 * @param {Object} courseData - Course data with lectures and assessment questions
 */
function loadAssessmentQuestionsFromCourseData(courseData) {
    if (!courseData.lectures) return;
    
    console.log('Loading assessment questions from course data:', courseData.lectures);
    
    courseData.lectures.forEach(unit => {
        console.log(`Processing unit: ${unit.name}, has assessmentQuestions:`, !!unit.assessmentQuestions, 'length:', unit.assessmentQuestions?.length);
        if (unit.assessmentQuestions && unit.assessmentQuestions.length > 0) {
            console.log(`Found ${unit.assessmentQuestions.length} assessment questions for ${unit.name}:`, unit.assessmentQuestions);
            
            // Store questions in the local assessmentQuestions object
            if (!assessmentQuestions[unit.name]) {
                assessmentQuestions[unit.name] = [];
            }
            
            // Clear existing questions and add new ones
            assessmentQuestions[unit.name] = [];
            
            // Convert database questions to local format
            unit.assessmentQuestions.forEach(dbQuestion => {
                const localQuestion = {
                    id: dbQuestion.questionId,
                    questionId: dbQuestion.questionId,
                    type: dbQuestion.questionType,
                    question: dbQuestion.question,
                    answer: dbQuestion.correctAnswer,
                    options: dbQuestion.options || {}
                };
                
                assessmentQuestions[unit.name].push(localQuestion);
            });
            
            // Update the display for this unit
            updateQuestionsDisplay(unit.name);
            console.log(`Loaded ${unit.assessmentQuestions.length} assessment questions for ${unit.name}`);
        } else {
            console.log(`No assessment questions found for ${unit.name}`);
        }
    });
}

/**
 * Load the saved assessment questions for all lectures from the database
 */
async function loadAssessmentQuestions() {
    try {
        const courseId = await getCurrentCourseId();
        
        // Get all accordion items (units/weeks)
        const accordionItems = document.querySelectorAll('.accordion-item');
        
        if (accordionItems.length === 0) {
            console.log('No accordion items found, skipping assessment questions loading');
            return;
        }
        
        console.log(`Found ${accordionItems.length} accordion items, loading assessment questions...`);
        
        for (const item of accordionItems) {
            const folderName = item.querySelector('.folder-name');
            if (!folderName) continue;
            
            const lectureName = folderName.textContent;
            
            const response = await fetch(`/api/questions/lecture?courseId=${courseId}&lectureName=${encodeURIComponent(lectureName)}`);
            
            if (response.ok) {
                const result = await response.json();
                const questions = result.data.questions;
                
                if (questions && questions.length > 0) {
                    // Store questions in the assessmentQuestions object
                    if (!assessmentQuestions[lectureName]) {
                        assessmentQuestions[lectureName] = [];
                    }
                    
                    // Convert database questions to local format
                    questions.forEach(dbQuestion => {
                        const localQuestion = {
                            id: dbQuestion.questionId,
                            questionId: dbQuestion.questionId,
                            type: dbQuestion.questionType,
                            question: dbQuestion.question,
                            answer: dbQuestion.correctAnswer,
                            options: dbQuestion.options || {}
                        };
                        
                        assessmentQuestions[lectureName].push(localQuestion);
                    });
                    
                    // Update the display for this lecture
                    updateQuestionsDisplay(lectureName);
                }
            }
        }
        
        console.log('Assessment questions loaded from database');
        
    } catch (error) {
        console.error('Error loading assessment questions:', error);
        showNotification('Error loading assessment questions. Using default values.', 'warning');
    }
}

/**
 * Delete an assessment question
 * @param {string} questionId - Question identifier
 * @param {string} week - Week identifier
 */
async function deleteAssessmentQuestion(questionId, week) {
    try {
        const courseId = await getCurrentCourseId();
        const instructorId = getCurrentInstructorId();
        
        const response = await fetch(`/api/questions/${questionId}`, {
            method: 'DELETE',
            headers: {
                'Content-Type': 'application/json',
            },
            body: JSON.stringify({
                courseId: courseId,
                lectureName: week,
                instructorId: instructorId
            })
        });
        
        if (!response.ok) {
            const errorText = await response.text();
            throw new Error(`Delete failed: ${response.status} ${errorText}`);
        }
        
        // Reload questions from database to ensure consistency
        await reloadQuestionsForUnit(week);
        
        // Update the display
        updateQuestionsDisplay(week);
        
        showNotification('Question deleted successfully!', 'success');
        
    } catch (error) {
        console.error('Error deleting question:', error);
        showNotification(`Error deleting question: ${error.message}`, 'error');
    }
}

/**
 * Save the pass threshold for a specific lecture
 * @param {string} lectureName - Name of the lecture/unit
 * @param {number} threshold - Number of questions required to pass
 */
async function savePassThreshold(lectureName, threshold) {
    try {
        const courseId = await getCurrentCourseId();
        const instructorId = getCurrentInstructorId();
        
        const response = await fetch('/api/lectures/pass-threshold', {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json',
            },
            body: JSON.stringify({
                courseId: courseId,
                lectureName: lectureName,
                passThreshold: threshold,
                instructorId: instructorId
            })
        });
        
        if (!response.ok) {
            const errorText = await response.text();
            throw new Error(`Failed to save threshold: ${response.status} ${errorText}`);
        }
        
        const result = await response.json();
        console.log(`Pass threshold saved for ${lectureName}: ${threshold}`);
        
        // Update local state to reflect the change
        await reloadPassThresholds();
        
        // Show success notification
        showNotification(result.message, 'success');
        
    } catch (error) {
        console.error('Error saving pass threshold:', error);
        showNotification(`Error saving pass threshold: ${error.message}`, 'error');
    }
}

/**
 * Reload pass thresholds from the database (for use after updates)
 */
async function reloadPassThresholds() {
    try {
        const courseId = await getCurrentCourseId();
        
        // Get all accordion items (units/weeks)
        const accordionItems = document.querySelectorAll('.accordion-item');
        
        for (const item of accordionItems) {
            const folderName = item.querySelector('.folder-name');
            if (!folderName) continue;
            
            const lectureName = folderName.textContent;
            
            const response = await fetch(`/api/lectures/pass-threshold?courseId=${courseId}&lectureName=${encodeURIComponent(lectureName)}`);
            
            if (response.ok) {
                const result = await response.json();
                const passThreshold = result.data.passThreshold;
                
                // Find and update the threshold input for this lecture
                // Convert lecture name to ID format (e.g., "Unit 1" -> "unit-1")
                const thresholdId = `pass-threshold-${lectureName.toLowerCase().replace(/\s+/g, '-')}`;
                const thresholdInput = item.querySelector(`#${thresholdId}`);
                
                if (thresholdInput) {
                    thresholdInput.value = passThreshold;
                    
                    // Also update the display text if it exists
                    const thresholdValue = item.querySelector(`#threshold-value-${lectureName.toLowerCase().replace(/\s+/g, '-')}`);
                    if (thresholdValue) {
                        thresholdValue.textContent = passThreshold;
                    }
                }
            }
        }
        
        console.log('Pass thresholds reloaded from database');
        
    } catch (error) {
        console.error('Error reloading pass thresholds:', error);
        showNotification('Error reloading pass thresholds.', 'warning');
    }
}

/**
 * Load the saved pass thresholds for all lectures from the database
 */
async function loadPassThresholds() {
    try {
        const courseId = await getCurrentCourseId();
        
        // Get all accordion items (units/weeks)
        const accordionItems = document.querySelectorAll('.accordion-item');
        
        for (const item of accordionItems) {
            const folderName = item.querySelector('.folder-name');
            if (!folderName) continue;
            
            const lectureName = folderName.textContent;
            
            const response = await fetch(`/api/lectures/pass-threshold?courseId=${courseId}&lectureName=${encodeURIComponent(lectureName)}`);
            
            if (response.ok) {
                const result = await response.json();
                const passThreshold = result.data.passThreshold;
                
                // Find and update the threshold input for this lecture
                // Convert lecture name to ID format (e.g., "Unit 1" -> "unit-1")
                const thresholdId = `pass-threshold-${lectureName.toLowerCase().replace(/\s+/g, '-')}`;
                const thresholdInput = item.querySelector(`#${thresholdId}`);
                
                if (thresholdInput) {
                    thresholdInput.value = passThreshold;
                    
                    // Also update the display text if it exists
                    const thresholdValue = item.querySelector(`#threshold-value-${lectureName.toLowerCase().replace(/\s+/g, '-')}`);
                    if (thresholdValue) {
                        thresholdValue.textContent = passThreshold;
                    }
                }
            }
        }
        
        console.log('Pass thresholds loaded from database');
        
    } catch (error) {
        console.error('Error loading pass thresholds:', error);
        showNotification('Error loading pass thresholds. Using default values.', 'warning');
    }
}

/**
 * Set up event listeners for threshold inputs
 */
function setupThresholdInputListeners() {
    // Get all threshold inputs
    const thresholdInputs = document.querySelectorAll('input[id^="pass-threshold-"]');
    
    thresholdInputs.forEach(input => {
        // Add change event listener
        input.addEventListener('change', function() {
            const threshold = parseInt(this.value);
            // Extract the exact lecture name from the ID (e.g., "Unit-1" -> "Unit 1")
            const lectureName = this.id.replace('pass-threshold-', '').replace(/-/g, ' ');
            
            // Save the threshold to MongoDB
            savePassThreshold(lectureName, threshold);
        });
        
        // Add input event listener for real-time updates
        input.addEventListener('input', function() {
            const threshold = parseInt(this.value);
            // Extract the exact lecture name from the ID
            const lectureName = this.id.replace('pass-threshold-', '').replace(/-/g, ' ');
            
            // Update the display text if it exists
            const thresholdValue = document.querySelector(`#threshold-value-${lectureName.toLowerCase().replace(/\s+/g, '-')}`);
            if (thresholdValue) {
                thresholdValue.textContent = threshold;
            }
        });
    });
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
    console.log('addObjectiveFromInput called with:', week);
    
    // Find the week element using our custom helper function
    const folderElement = findElementsContainingText('.accordion-item .folder-name', week)[0];
    if (!folderElement) {
        console.error('Could not find folder element for:', week);
        showNotification('Error: Could not find unit element', 'error');
        return;
    }
    
    const weekElement = folderElement.closest('.accordion-item');
    if (!weekElement) {
        console.error('Could not find week element for:', week);
        showNotification('Error: Could not find unit element', 'error');
        return;
    }
    
    // Convert unit name to ID format (e.g., "Unit 1" -> "Unit-1")
    const unitId = week.toLowerCase().replace(/\s+/g, '-');
    console.log('Looking for unit ID:', unitId);
    
    const inputField = weekElement.querySelector(`#objective-input-${unitId}`);
    console.log('Input field found:', !!inputField);
    
    if (!inputField) {
        console.error('Could not find input field for:', week, 'with ID:', `objective-input-${unitId}`);
        showNotification('Error: Could not find input field', 'error');
        return;
    }
    
    const objectiveText = inputField.value.trim();
    console.log('Objective text:', objectiveText);
    
    if (!objectiveText) {
        showNotification('Please enter a learning objective.', 'error');
        return;
    }
    
    // Get the objectives list
    const objectivesList = weekElement.querySelector(`#objectives-list-${unitId}`);
    console.log('Objectives list found:', !!objectivesList);
    
    if (!objectivesList) {
        console.error('Could not find objectives list for:', week);
        showNotification('Error: Could not find objectives list', 'error');
        return;
    }
    
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
    
    console.log('Objective added successfully:', objectiveText);
    console.log('Total objectives now:', objectivesList.querySelectorAll('.objective-display-item').length);
    showNotification('Learning objective added successfully!', 'success');
}

/**
 * Remove a learning objective
 * @param {HTMLElement} button - The remove button element
 */
function removeObjective(button) {
    const objectiveItem = button.closest('.objective-display-item');
    if (objectiveItem) {
        objectiveItem.remove();
        showNotification('Learning objective removed.', 'info');
    } else {
        console.error('Could not find objective item to remove');
    }
}

/**
 * Add a new learning objective for a unit (used in onboarding)
 * @param {string} unitName - The unit name (e.g., 'Unit 1')
 */
function addObjectiveForUnit(unitName) {
    console.log('addObjectiveForUnit called with:', unitName);
    
    const inputField = document.getElementById('objective-input');
    const objectivesList = document.getElementById('objectives-list');
    
    console.log('Input field found:', !!inputField);
    console.log('Objectives list found:', !!objectivesList);
    
    if (!inputField || !objectivesList) {
        console.error('Could not find objective input or list elements');
        showNotification('Error: Could not find objective elements', 'error');
        return;
    }
    
    const objectiveText = inputField.value.trim();
    console.log('Objective text:', objectiveText);
    
    if (!objectiveText) {
        showNotification('Please enter a learning objective.', 'error');
        return;
    }
    
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
    
    console.log('Objective added successfully:', objectiveText);
    console.log('Total objectives now:', objectivesList.querySelectorAll('.objective-display-item').length);
    showNotification('Learning objective added successfully!', 'success');
}

/**
 * Save learning objectives for a week
 * @param {string} week - The week identifier (e.g., 'Week 1')
 */
async function saveObjectives(week) {
    // Find the week element using our custom helper function
    const folderElement = findElementsContainingText('.accordion-item .folder-name', week)[0];
    if (!folderElement) {
        console.error('Could not find folder element for:', week);
        showNotification('Error: Could not find unit element', 'error');
        return;
    }
    
    const weekElement = folderElement.closest('.accordion-item');
    if (!weekElement) {
        console.error('Could not find week element for:', week);
        showNotification('Error: Could not find unit element', 'error');
        return;
    }
    
    const objectiveItems = weekElement.querySelectorAll('.objective-text');
    
    // Collect all objectives
    const objectives = Array.from(objectiveItems).map(item => item.textContent.trim()).filter(value => value);
    
    if (objectives.length === 0) {
        showNotification('Please add at least one learning objective.', 'error');
        return;
    }
    
    try {
        // Get the current course ID
        const courseId = await getCurrentCourseId();
        
        console.log(`Saving learning objectives for ${week}, Course: ${courseId}`, objectives);
        
        const requestBody = {
            lectureName: week, // Use lectureName for consistency
            objectives: objectives,
            instructorId: getCurrentInstructorId(),
            courseId: courseId
        };
        
        console.log('Request body:', requestBody);
        
        const response = await fetch('/api/learning-objectives', {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json',
            },
            body: JSON.stringify(requestBody)
        });
        
        console.log('Response status:', response.status);
        
        if (!response.ok) {
            const errorText = await response.text();
            console.error('Error response:', errorText);
            throw new Error(`Failed to save learning objectives: ${response.status} ${errorText}`);
        }
        
        const result = await response.json();
        console.log('Learning objectives saved successfully:', result);
        showNotification(result.message, 'success');
        
    } catch (error) {
        console.error('Error saving learning objectives:', error);
        showNotification('Error saving learning objectives. Please try again.', 'error');
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
    
    console.log(`Checking mandatory materials for ${week}`);
    console.log(`Found ${fileItems.length} file items:`, fileItems);
    
    // Check if mandatory materials are present
    let hasLectureNotes = false;
    let hasPracticeQuestions = false;
    
    fileItems.forEach(item => {
        const title = item.querySelector('.file-info h3');
        const statusText = item.querySelector('.status-text');
        
        if (title && statusText) {
            const titleText = title.textContent;
            const status = statusText.textContent;
            
            console.log(`File item: "${titleText}" - Status: "${status}"`);
            console.log(`Title includes 'Lecture Notes': ${titleText.includes('Lecture Notes')}`);
            console.log(`Title includes 'Practice Questions': ${titleText.includes('Practice Questions')}`);
            console.log(`Status is 'Uploaded' or 'uploaded': ${status === 'Uploaded' || status === 'uploaded'}`);
            
            // Check if this is a lecture notes document that's uploaded
            if (titleText.includes('Lecture Notes') && (status === 'Uploaded' || status === 'uploaded')) {
                hasLectureNotes = true;
                console.log('Found uploaded lecture notes');
            }
            
            // Check if this is a practice questions document that's uploaded
            if ((titleText.includes('Practice Questions') || titleText.includes('Practice Questions/Tutorial')) && (status === 'Uploaded' || status === 'uploaded')) {
                hasPracticeQuestions = true;
                console.log('Found uploaded practice questions');
            }
        } else {
            console.log('File item missing title or status:', { title: !!title, statusText: !!statusText });
        }
    });
    
    console.log(`Validation results: hasLectureNotes=${hasLectureNotes}, hasPracticeQuestions=${hasPracticeQuestions}`);
    
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
async function saveQuestion() {
    const questionType = document.getElementById('question-type').value;
    const questionText = document.getElementById('question-text').value.trim();
    
    // Validation
    if (!questionType) {
        showNotification('Please select a question type.', 'error');
        return;
    }
    
    if (!questionText) {
        showNotification('Please enter a question.', 'error');
        return;
    }
    
    let question = {
        questionType: questionType,
        question: questionText
    };
    
    // Get answer based on type
    if (questionType === 'true-false') {
        const tfAnswer = document.querySelector('input[name="tf-answer"]:checked');
        if (!tfAnswer) {
            showNotification('Please select the correct answer (True/False).', 'error');
            return;
        }
        question.correctAnswer = tfAnswer.value;
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
            showNotification('Please enter at least one answer option.', 'error');
            return;
        }
        
        if (!hasCorrectAnswer) {
            showNotification('Please select the correct answer for the options you have entered.', 'error');
            return;
        }
        
        const correctAnswer = document.querySelector('input[name="mcq-correct"]:checked');
        question.options = options;
        question.correctAnswer = correctAnswer.value;
    } else if (questionType === 'short-answer') {
        const saAnswer = document.getElementById('sa-answer').value.trim();
        if (!saAnswer) {
            showNotification('Please provide expected answer or key points.', 'error');
            return;
        }
        question.correctAnswer = saAnswer;
    }
    
    try {
        // Save question to MongoDB
        const courseId = await getCurrentCourseId();
        const instructorId = getCurrentInstructorId();
        const lectureName = currentWeek;
        
        const response = await fetch('/api/questions', {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json',
            },
            body: JSON.stringify({
                courseId: courseId,
                lectureName: lectureName,
                instructorId: instructorId,
                questionType: question.questionType,
                question: question.question,
                options: question.options || {},
                correctAnswer: question.correctAnswer,
                explanation: '',
                difficulty: 'medium',
                tags: [],
                points: 1
            })
        });
        
        if (!response.ok) {
            const errorText = await response.text();
            throw new Error(`Failed to save question: ${response.status} ${errorText}`);
        }
        
        const result = await response.json();
        
        // Add the new question to local state immediately
        if (!assessmentQuestions[currentWeek]) {
            assessmentQuestions[currentWeek] = [];
        }
        
        const savedQuestion = {
            id: result.data.questionId,
            questionId: result.data.questionId,
            type: question.questionType,
            question: question.question,
            answer: question.correctAnswer,
            options: question.options || {}
        };
        
        assessmentQuestions[currentWeek].push(savedQuestion);
        
        // Update the display
        updateQuestionsDisplay(currentWeek);
        
        // Close modal
        closeQuestionModal();
        
        // Check if we should enable AI generation
        checkAIGenerationAvailability(currentWeek);
        
        showNotification('Question saved successfully!', 'success');
        
    } catch (error) {
        console.error('Error saving question:', error);
        showNotification(`Error saving question: ${error.message}`, 'error');
    }
}

/**
 * Reload questions for a specific unit from the database
 * @param {string} unitName - Unit name (e.g., 'Unit 1')
 */
async function reloadQuestionsForUnit(unitName) {
    try {
        const courseId = await getCurrentCourseId();
        
        const response = await fetch(`/api/questions/lecture?courseId=${courseId}&lectureName=${encodeURIComponent(unitName)}`);
        
        if (response.ok) {
            const result = await response.json();
            const questions = result.data.questions;
            
            // Store questions in the local assessmentQuestions object
            if (!assessmentQuestions[unitName]) {
                assessmentQuestions[unitName] = [];
            }
            
            // Clear existing questions and add new ones
            assessmentQuestions[unitName] = [];
            
            // Convert database questions to local format
            questions.forEach(dbQuestion => {
                const localQuestion = {
                    id: dbQuestion.questionId,
                    questionId: dbQuestion.questionId,
                    type: dbQuestion.questionType,
                    question: dbQuestion.question,
                    answer: dbQuestion.correctAnswer,
                    options: dbQuestion.options || {}
                };
                
                assessmentQuestions[unitName].push(localQuestion);
            });
            
            console.log(`Reloaded ${questions.length} questions for ${unitName}`);
        } else {
            console.error('Failed to reload questions for unit:', unitName);
        }
    } catch (error) {
        console.error('Error reloading questions for unit:', unitName, error);
    }
}

/**
 * Update the questions display for a week
 * @param {string} week - Week identifier
 */
function updateQuestionsDisplay(week) {
    console.log(`updateQuestionsDisplay called for week: ${week}`);
    console.log(`assessmentQuestions[${week}]:`, assessmentQuestions[week]);
    
    const containerId = `assessment-questions-${week.toLowerCase().replace(/\s+/g, '-')}`;
    console.log(`Looking for container with ID: ${containerId}`);
    
    const questionsContainer = document.getElementById(containerId);
    if (!questionsContainer) {
        console.error(`Container not found for week: ${week}, ID: ${containerId}`);
        return;
    }
    
    const questions = assessmentQuestions[week] || [];
    console.log(`Questions to display for ${week}:`, questions);
    
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
            <div class="question-item" data-question-id="${question.questionId || question.id}">
                <div class="question-header">
                    <span class="question-type-badge ${question.type}">${getQuestionTypeLabel(question.type)}</span>
                    <span class="question-number">Question ${index + 1}</span>
                    <button class="delete-question-btn" onclick="deleteQuestion('${week}', '${question.questionId || question.id}')">×</button>
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
    const thresholdInput = document.getElementById(`pass-threshold-${week.toLowerCase().replace(/\s+/g, '-')}`);
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
 * @param {string} questionId - Question ID
 */
async function deleteQuestion(week, questionId) {
    if (confirm('Are you sure you want to delete this question?')) {
        try {
            await deleteAssessmentQuestion(questionId, week);
            checkAIGenerationAvailability(week);
        } catch (error) {
            console.error('Error deleting question:', error);
        }
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

/**
 * Load onboarding data and populate the course upload page
 */
async function loadOnboardingData() {
    try {
        // Check if we have a courseId from URL parameters (onboarding redirect)
        const urlParams = new URLSearchParams(window.location.search);
        const courseId = urlParams.get('courseId');
        
        if (!courseId) {
            console.log('No course ID from onboarding, skipping onboarding data load');
            return;
        }
        
        console.log('Loading onboarding data for course:', courseId);
        
        // Fetch onboarding data from database
        const response = await fetch(`/api/onboarding/${courseId}`);
        
        if (!response.ok) {
            console.log('No onboarding data found for course:', courseId);
            return;
        }
        
        const result = await response.json();
        const onboardingData = result.data;
        
        console.log('Onboarding data loaded:', onboardingData);
        
        // Generate units dynamically based on course structure
        if (onboardingData.courseStructure && onboardingData.courseStructure.totalUnits > 0) {
            generateUnitsFromOnboarding(onboardingData);
        }
        
        // Load existing data for the units
        loadExistingUnitData(onboardingData);
        
        // Show success notification
        showNotification('Onboarding data loaded successfully!', 'success');
        
    } catch (error) {
        console.error('Error loading onboarding data:', error);
        showNotification('Error loading onboarding data. Using default values.', 'warning');
    }
}

/**
 * Load course data (either from onboarding redirect or existing course)
 */
async function loadCourseData() {
    try {
        // First check if we have a courseId from URL parameters (onboarding redirect)
        const urlParams = new URLSearchParams(window.location.search);
        const courseId = urlParams.get('courseId');
        
        if (courseId) {
            // Load specific course data
            await loadSpecificCourse(courseId);
            return;
        }
        
        // If no courseId in URL, check if instructor has any existing courses
        const instructorId = 'instructor-123'; // This would come from authentication
        const response = await fetch(`/api/onboarding/instructor/${instructorId}`);
        
        if (response.ok) {
            const result = await response.json();
            if (result.data && result.data.courses && result.data.courses.length > 0) {
                // Load the first available course
                const firstCourse = result.data.courses[0];
                await loadSpecificCourse(firstCourse.courseId);
                return;
            }
        }
        
        // If no existing course, show empty state
        showEmptyCourseState();
        
    } catch (error) {
        console.error('Error loading course data:', error);
        showNotification('Error loading course data. Using default values.', 'warning');
        showEmptyCourseState();
    }
}

/**
 * Load a specific course by ID
 */
async function loadSpecificCourse(courseId) {
    try {
        console.log('Loading course data for:', courseId);
        
        const response = await fetch(`/api/onboarding/${courseId}`);
        
        if (!response.ok) {
            console.log('No course data found for course:', courseId);
            showEmptyCourseState();
            return;
        }
        
        const result = await response.json();
        const courseData = result.data;
        
        console.log('Course data loaded:', courseData);
        
        // Generate units dynamically based on course structure
        if (courseData.courseStructure && courseData.courseStructure.totalUnits > 0) {
            generateUnitsFromOnboarding(courseData);
            
            // Load existing data for the units (learning objectives, publish status, etc.)
            loadExistingUnitData(courseData);
        }
        
        // Show success notification
        showNotification('Course data loaded successfully!', 'success');
        
    } catch (error) {
        console.error('Error loading specific course:', error);
        showNotification('Error loading course data. Using default values.', 'warning');
        showEmptyCourseState();
    }
}

/**
 * Show empty course state when no course exists
 */
function showEmptyCourseState() {
    const container = document.getElementById('dynamic-units-container');
    if (container) {
        container.innerHTML = `
            <div class="empty-course-state">
                <div class="empty-message">
                    <h3>No Course Found</h3>
                    <p>You haven't set up a course yet. Please complete the onboarding process first.</p>
                    <a href="/instructor/onboarding" class="btn-primary">Go to Onboarding</a>
                </div>
            </div>
        `;
    }
}

/**
 * Generate units dynamically from onboarding data
 * @param {Object} onboardingData - Onboarding data with course structure
 */
function generateUnitsFromOnboarding(onboardingData) {
    const container = document.getElementById('dynamic-units-container');
    if (!container) {
        console.error('Dynamic units container not found');
        return;
    }
    
    // Clear existing content
    container.innerHTML = '';
    
    const { courseStructure, lectures } = onboardingData;
    const totalUnits = courseStructure.totalUnits;
    
    console.log(`Generating ${totalUnits} units for course`);
    
    // Generate each unit
    for (let i = 1; i <= totalUnits; i++) {
        const unitName = `Unit ${i}`;
        const unitData = lectures ? lectures.find(l => l.name === unitName) : null;
        
        const unitElement = createUnitElement(unitName, unitData, i === 1); // First unit is expanded
        container.appendChild(unitElement);
    }
    
    // Reinitialize event listeners for the new units
    initializeUnitEventListeners();
    
    // Load existing data for the units (learning objectives, publish status, etc.)
    loadExistingUnitData(onboardingData);
    
    // Load assessment questions after units are generated
    setTimeout(() => {
        loadAssessmentQuestionsFromCourseData(onboardingData);
    }, 100);
    
    // Load documents from course structure
    setTimeout(() => {
        loadDocuments();
    }, 500); // Increased timeout to ensure DOM is fully ready
}

/**
 * Create a unit element with all its sections
 * @param {string} unitName - Name of the unit (e.g., "Unit 1")
 * @param {Object} unitData - Existing unit data from database
 * @param {boolean} isExpanded - Whether the unit should be expanded by default
 * @returns {HTMLElement} The unit element
 */
function createUnitElement(unitName, unitData, isExpanded = false) {
    const unitDiv = document.createElement('div');
    unitDiv.className = 'accordion-item';
    unitDiv.setAttribute('data-unit-name', unitName);
    
    const unitId = unitName.toLowerCase().replace(/\s+/g, '-');
    
    unitDiv.innerHTML = `
        <div class="accordion-header">
            <span class="folder-name">${unitName}</span>
            <div class="header-actions">
                <div class="publish-toggle">
                    <label class="toggle-switch">
                        <input type="checkbox" id="publish-${unitId}" onchange="togglePublish('${unitName}', this.checked)">
                        <span class="toggle-slider"></span>
                    </label>
                    <span class="toggle-label">Published</span>
                </div>

                <span class="accordion-toggle">${isExpanded ? '▼' : '▶'}</span>
            </div>
        </div>
        <div class="accordion-content ${isExpanded ? '' : 'collapsed'}">
            <!-- Learning Objectives Section -->
            <div class="unit-section learning-objectives-section">
                <div class="section-header">
                    <h3>Learning Objectives</h3>
                    <button class="toggle-section">▼</button>
                </div>
                <div class="section-content">
                    <div class="objectives-list" id="objectives-list-${unitId}">
                        <!-- Objectives will be added here -->
                    </div>
                    <div class="objective-input-container">
                        <input type="text" id="objective-input-${unitId}" class="objective-input" placeholder="Enter learning objective...">
                        <button class="add-objective-btn-inline" onclick="addObjectiveFromInput('${unitName}')">+</button>
                    </div>
                    <div class="save-objectives">
                        <button class="save-btn" onclick="saveObjectives('${unitName}')">Save Learning Objectives</button>
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
                    <div class="content-type-header">
                        <p><strong>Required Materials:</strong> *Lecture Notes and *Practice Questions/Tutorial are mandatory</p>
                    </div>
                    <div class="file-item">
                        <div class="file-info">
                            <h3>*Lecture Notes - ${unitName}</h3>
                            <p>Placeholder for required lecture notes. Please upload content.</p>
                            <span class="status-text">Not Uploaded</span>
                        </div>
                        <div class="file-actions">
                            <button class="action-button upload" onclick="openUploadModal('${unitName}', 'lecture-notes')">Upload</button>
                            <button class="action-button delete" onclick="deleteFileItem(this)">Delete</button>
                        </div>
                    </div>
                    <div class="file-item">
                        <div class="file-info">
                            <h3>*Practice Questions/Tutorial</h3>
                            <p>Placeholder for required practice questions. Please upload content.</p>
                            <span class="status-text">Not Uploaded</span>
                        </div>
                        <div class="file-actions">
                            <button class="action-button upload" onclick="openUploadModal('${unitName}', 'practice-quiz')">Upload</button>
                            <button class="action-button delete" onclick="deleteFileItem(this)">Delete</button>
                        </div>
                    </div>
                    <!-- Add Content Button -->
                    <div class="add-content-section">
                        <button class="add-content-btn additional-material" onclick="openUploadModal('${unitName}', 'additional')">
                            <span class="btn-icon">➕</span>
                            Add Additional Material
                        </button>
                    </div>
                    <div class="save-objectives">
                        <button class="save-btn" onclick="confirmCourseMaterials('${unitName}')">Confirm Course Materials</button>
                    </div>
                </div>
            </div>
            
            <!-- Assessment Questions Section -->
            <div class="unit-section assessment-questions-section">
                <div class="section-header">
                    <h3>Assessment Questions</h3>
                    <button class="toggle-section">▼</button>
                </div>
                <div class="section-content">
                    <div class="assessment-info">
                        <p><strong>Assessment Settings:</strong> Create questions to determine student readiness for tutor/protégé mode</p>
                    </div>
                    
                    <!-- Pass Threshold Setting -->
                    <div class="threshold-setting">
                        <label for="pass-threshold-${unitId}">Questions required to pass:</label>
                        <input type="number" id="pass-threshold-${unitId}" min="1" max="10" value="2" class="threshold-input">
                        <span class="threshold-help">out of total questions</span>
                        <span class="threshold-display" id="threshold-value-${unitId}">2</span>
                    </div>
                    
                    <!-- Questions List -->
                    <div class="questions-list" id="assessment-questions-${unitId}">
                        <!-- Assessment questions will be displayed here -->
                        <div class="no-questions-message">
                            <p>No assessment questions created yet. Click "Add Question" to get started.</p>
                        </div>
                    </div>
                    
                    <!-- Action Buttons -->
                    <div class="assessment-actions">
                        <button class="add-question-btn" onclick="openQuestionModal('${unitName}')">
                            <span class="btn-icon">➕</span>
                            Add Question
                        </button>
                    </div>
                    
                    <div class="save-assessment">
                        <button class="save-btn" onclick="saveAssessment('${unitName}')">Save Assessment</button>
                    </div>
                </div>
            </div>
        </div>
    `;
    
    return unitDiv;
}

/**
 * Load existing data for the generated units
 * @param {Object} onboardingData - Onboarding data with existing unit information
 */
function loadExistingUnitData(onboardingData) {
    if (!onboardingData.lectures) return;
    
    console.log('Loading existing unit data:', onboardingData.lectures);
    
    onboardingData.lectures.forEach(unit => {
        const unitId = unit.name.toLowerCase().replace(/\s+/g, '-');
        console.log(`Loading data for ${unit.name} (ID: ${unitId})`);
        
        // Load learning objectives
        if (unit.learningObjectives && unit.learningObjectives.length > 0) {
            console.log(`Found ${unit.learningObjectives.length} learning objectives for ${unit.name}:`, unit.learningObjectives);
            const objectivesList = document.getElementById(`objectives-list-${unitId}`);
            console.log(`Looking for objectives list with ID: objectives-list-${unitId}`);
            console.log(`Objectives list element found:`, !!objectivesList);
            
            if (objectivesList) {
                objectivesList.innerHTML = '';
                unit.learningObjectives.forEach(objective => {
                    const objectiveItem = document.createElement('div');
                    objectiveItem.className = 'objective-display-item';
                    objectiveItem.innerHTML = `
                        <span class="objective-text">${objective}</span>
                        <button class="remove-objective" onclick="removeObjective(this)">×</button>
                    `;
                    objectivesList.appendChild(objectiveItem);
                    console.log(`Added objective: ${objective}`);
                });
                console.log(`Loaded ${unit.learningObjectives.length} objectives for ${unit.name}`);
            } else {
                console.error(`Could not find objectives list element with ID: objectives-list-${unitId}`);
            }
        } else {
            console.log(`No learning objectives found for ${unit.name}`);
        }
        
        // Load pass threshold
        if (unit.passThreshold) {
            const thresholdInput = document.getElementById(`pass-threshold-${unitId}`);
            if (thresholdInput) {
                thresholdInput.value = unit.passThreshold;
                console.log(`Loaded pass threshold ${unit.passThreshold} for ${unit.name}`);
                
                // Also update the threshold display
                const thresholdDisplay = document.getElementById(`threshold-value-${unitId}`);
                if (thresholdDisplay) {
                    thresholdDisplay.textContent = unit.passThreshold;
                }
            }
        }
        
        // Load assessment questions
        if (unit.assessmentQuestions && unit.assessmentQuestions.length > 0) {
            console.log(`Found ${unit.assessmentQuestions.length} assessment questions for ${unit.name}:`, unit.assessmentQuestions);
            
            // Store questions in the local assessmentQuestions object
            if (!assessmentQuestions[unit.name]) {
                assessmentQuestions[unit.name] = [];
            }
            
            // Convert database questions to local format
            unit.assessmentQuestions.forEach(dbQuestion => {
                const localQuestion = {
                    id: dbQuestion.questionId,
                    questionId: dbQuestion.questionId,
                    type: dbQuestion.questionType,
                    question: dbQuestion.question,
                    answer: dbQuestion.correctAnswer,
                    options: dbQuestion.options || {}
                };
                
                assessmentQuestions[unit.name].push(localQuestion);
            });
            
            // Update the display for this unit
            updateQuestionsDisplay(unit.name);
            console.log(`Loaded ${unit.assessmentQuestions.length} assessment questions for ${unit.name}`);
        } else {
            console.log(`No assessment questions found for ${unit.name}`);
        }
        
        // Load publish status
        if (unit.isPublished !== undefined) {
            const publishToggle = document.getElementById(`publish-${unitId}`);
            if (publishToggle) {
                publishToggle.checked = unit.isPublished;
                console.log(`Loaded publish status ${unit.isPublished} for ${unit.name}`);
            }
        }
        
        // Load documents from course structure
        if (unit.documents && unit.documents.length > 0) {
            console.log(`Found ${unit.documents.length} documents for ${unit.name}:`, unit.documents);
            
            // Find the course materials section for this unit
            const unitElement = document.querySelector(`[data-unit-name="${unit.name}"]`);
            if (unitElement) {
                const courseMaterialsSection = unitElement.querySelector('.course-materials-section .section-content');
                if (courseMaterialsSection) {
                    // Clear existing placeholder content
                    const placeholders = courseMaterialsSection.querySelectorAll('.file-item');
                    console.log('Found existing items:', placeholders.length);
                    
                    placeholders.forEach(placeholder => {
                        console.log('Removing existing item:', placeholder);
                        placeholder.remove();
                    });
                    
                    // Add each document
                    unit.documents.forEach(doc => {
                        const documentItem = createDocumentItem(doc);
                        courseMaterialsSection.appendChild(documentItem);
                    });
                    
                    console.log(`Loaded ${unit.documents.length} documents for ${unit.name}`);
                }
            }
        } else {
            console.log(`No documents found for ${unit.name}`);
        }
    });
}



/**
 * Initialize event listeners for dynamically generated units
 */
function initializeUnitEventListeners() {
    // Setup accordion toggling
    const accordionHeaders = document.querySelectorAll('.accordion-header');
    accordionHeaders.forEach(header => {
        header.addEventListener('click', (e) => {
            // Don't toggle if clicking on the toggle switch
            if (e.target.closest('.publish-toggle')) {
                return;
            }
            
            const accordionItem = header.parentElement;
            const content = accordionItem.querySelector('.accordion-content');
            const toggle = header.querySelector('.accordion-toggle');
            
            if (content.classList.contains('collapsed')) {
                content.classList.remove('collapsed');
                toggle.textContent = '▼';
            } else {
                content.classList.add('collapsed');
                toggle.textContent = '▶';
            }
        });
    });
    
    // Setup section toggling
    const sectionHeaders = document.querySelectorAll('.section-header');
    sectionHeaders.forEach(header => {
        header.addEventListener('click', (e) => {
            toggleSection(header, e);
        });
    });
    
    // Setup threshold input listeners
    setupThresholdInputListeners();
}

/**
 * Update file status display for uploaded files
 */
function updateFileStatus(contentType, unitName, status, fileName) {
    // Find the file item for this content type and unit
    const fileItems = document.querySelectorAll('.file-item');
    
    fileItems.forEach(item => {
        const itemTitle = item.querySelector('h3');
        if (itemTitle) {
            const isLectureNotes = contentType === 'lecture-notes' && itemTitle.textContent.includes('Lecture Notes');
            const isPracticeQuestions = contentType === 'practice-questions' && itemTitle.textContent.includes('Practice Questions');
            
            // Check if this item belongs to the specified unit
            const isCorrectUnit = itemTitle.textContent.includes(unitName);
            
            if ((isLectureNotes || isPracticeQuestions) && isCorrectUnit) {
                const statusText = item.querySelector('.status-text');
                if (statusText) {
                    statusText.textContent = status === 'uploaded' ? 'Uploaded' : 'Not Uploaded';
                    statusText.className = status === 'uploaded' ? 'status-text uploaded' : 'status-text';
                }
                
                // Update the file info
                const fileInfo = item.querySelector('.file-info p');
                if (fileInfo && status === 'uploaded') {
                    fileInfo.textContent = `File: ${fileName}`;
                    fileInfo.className = 'file-info uploaded';
                }
            }
        }
    });
}

/**
 * Add additional material to the display
 */
function addAdditionalMaterial(unitName, materialName) {
    // Find the add content section for Unit 1
    const addContentSection = document.querySelector('.add-content-section');
    if (addContentSection) {
        const materialItem = document.createElement('div');
        materialItem.className = 'file-item additional-material-item';
        materialItem.innerHTML = `
            <div class="file-info">
                <h3>${materialName}</h3>
                <p>Additional material uploaded during onboarding</p>
                <span class="status-text uploaded">Uploaded</span>
            </div>
            <div class="file-actions">
                <button class="action-button view" onclick="viewFile('${materialName}')">View</button>
                <button class="action-button delete" onclick="deleteFileItem(this)">Delete</button>
            </div>
        `;
        
        // Insert before the add content button
        addContentSection.parentNode.insertBefore(materialItem, addContentSection);
    }
} 

/**
 * Show document content in a modal
 * @param {Object} documentData - Document object with content and metadata
 */
function showDocumentModal(documentData) {
    // Remove any existing modal
    const existingModal = document.querySelector('.document-modal');
    if (existingModal) {
        existingModal.remove();
    }
    
    // Create modal HTML
    const modalHTML = `
        <div class="document-modal" style="
            position: fixed;
            top: 0;
            left: 0;
            width: 100%;
            height: 100%;
            background: rgba(0, 0, 0, 0.5);
            display: flex;
            justify-content: center;
            align-items: center;
            z-index: 1000;
        ">
            <div class="modal-content" style="
                background: white;
                padding: 20px;
                border-radius: 8px;
                max-width: 80%;
                max-height: 80%;
                overflow-y: auto;
                position: relative;
            ">
                <div class="modal-header" style="
                    display: flex;
                    justify-content: space-between;
                    align-items: center;
                    margin-bottom: 20px;
                    border-bottom: 1px solid #eee;
                    padding-bottom: 10px;
                ">
                    <h2 style="margin: 0; color: #333;">${documentData.originalName}</h2>
                    <button class="close-modal" onclick="closeDocumentModal()" style="
                        background: none;
                        border: none;
                        font-size: 24px;
                        cursor: pointer;
                        color: #666;
                    ">&times;</button>
                </div>
                
                <div class="modal-body">
                    <div class="document-info" style="margin-bottom: 20px;">
                        <p><strong>Type:</strong> ${documentData.documentType}</p>
                        <p><strong>Size:</strong> ${documentData.size} bytes</p>
                        <p><strong>Uploaded:</strong> ${new Date(documentData.createdAt).toLocaleString()}</p>
                    </div>
                    
                    <div class="document-content" style="
                        background: #f8f9fa;
                        padding: 15px;
                        border-radius: 4px;
                        border: 1px solid #e9ecef;
                        white-space: pre-wrap;
                        font-family: monospace;
                        max-height: 400px;
                        overflow-y: auto;
                    ">${documentData.content || 'No content available'}</div>
                </div>
                
                <div class="modal-footer" style="
                    margin-top: 20px;
                    text-align: right;
                    border-top: 1px solid #eee;
                    padding-top: 10px;
                ">
                    <button onclick="closeDocumentModal()" style="
                        background: #6c757d;
                        color: white;
                        border: none;
                        padding: 8px 16px;
                        border-radius: 4px;
                        cursor: pointer;
                    ">Close</button>
                </div>
            </div>
        </div>
    `;
    
    // Add modal to page
    document.body.insertAdjacentHTML('beforeend', modalHTML);
    
    // Add click outside to close functionality
    const modal = document.querySelector('.document-modal');
    modal.addEventListener('click', (e) => {
        if (e.target === modal) {
            closeDocumentModal();
        }
    });
}

/**
 * Close the document modal
 */
function closeDocumentModal() {
    const modal = document.querySelector('.document-modal');
    if (modal) {
        modal.remove();
    }
}

/**
 * Add required placeholder items for lecture notes and practice questions
 * @param {HTMLElement} container - The container to add placeholders to
 * @param {string} unitName - The name of the unit (e.g., 'Unit 1')
 */
function addRequiredPlaceholders(container, unitName) {
    // Check if lecture notes placeholder already exists
    let hasLectureNotes = false;
    let hasPracticeQuestions = false;
    
    container.querySelectorAll('.file-item').forEach(item => {
        const title = item.querySelector('h3');
        if (title) {
            if (title.textContent.includes('*Lecture Notes')) {
                hasLectureNotes = true;
            }
            if (title.textContent.includes('*Practice Questions/Tutorial')) {
                hasPracticeQuestions = true;
            }
        }
    });
    
    // Add lecture notes placeholder if it doesn't exist
    if (!hasLectureNotes) {
        const lectureNotesItem = document.createElement('div');
        lectureNotesItem.className = 'file-item';
        lectureNotesItem.innerHTML = `
            <span class="file-icon">📄</span>
            <div class="file-info">
                <h3>*Lecture Notes - ${unitName}</h3>
                <p>Placeholder for required lecture notes. Please upload content.</p>
                <span class="status-text">Not Uploaded</span>
            </div>
            <div class="file-actions">
                <button class="action-button upload" onclick="openUploadModal('${unitName}', 'lecture-notes')">Upload</button>
                <button class="action-button delete" onclick="deleteFileItem(this)">Delete</button>
            </div>
        `;
        container.appendChild(lectureNotesItem);
    }
    
    // Add practice questions placeholder if it doesn't exist
    if (!hasPracticeQuestions) {
        const practiceQuestionsItem = document.createElement('div');
        practiceQuestionsItem.className = 'file-item';
        practiceQuestionsItem.innerHTML = `
            <span class="file-icon">📄</span>
            <div class="file-info">
                <h3>*Practice Questions/Tutorial</h3>
                <p>Placeholder for required practice questions. Please upload content.</p>
                <span class="status-text">Not Uploaded</span>
            </div>
            <div class="file-actions">
                <button class="action-button upload" onclick="openUploadModal('${unitName}', 'practice-quiz')">Upload</button>
                <button class="action-button delete" onclick="deleteFileItem(this)">Delete</button>
            </div>
        `;
        container.appendChild(practiceQuestionsItem);
    }
}

/**
 * Add action buttons for additional materials and confirmation
 * @param {HTMLElement} container - The container to add buttons to
 * @param {string} unitName - The name of the unit (e.g., 'Unit 1')
 */
function addActionButtons(container, unitName) {
    // Check if action buttons already exist
    let hasAddContentSection = false;
    let hasConfirmButton = false;
    
    container.querySelectorAll('.add-content-section, .save-objectives').forEach(item => {
        if (item.classList.contains('add-content-section')) {
            hasAddContentSection = true;
        }
        if (item.textContent.includes('Confirm Course Materials')) {
            hasConfirmButton = true;
        }
    });
    
    // Add "Add Additional Material" button if it doesn't exist
    if (!hasAddContentSection) {
        const addContentSection = document.createElement('div');
        addContentSection.className = 'add-content-section';
        addContentSection.innerHTML = `
            <button class="add-content-btn additional-material" onclick="openUploadModal('${unitName}', 'additional')">
                <span class="btn-icon">➕</span>
                Add Additional Material
            </button>
        `;
        container.appendChild(addContentSection);
    }
    
    // Add "Confirm Course Materials" button if it doesn't exist
    if (!hasConfirmButton) {
        const confirmSection = document.createElement('div');
        confirmSection.className = 'save-objectives';
        confirmSection.innerHTML = `
            <button class="save-btn" onclick="confirmCourseMaterials('${unitName}')">Confirm Course Materials</button>
        `;
        container.appendChild(confirmSection);
    }
}

/**
 * Add cleanup button to clear all documents from a unit
 * @param {HTMLElement} container - The container to add button to
 * @param {string} unitName - The name of the unit (e.g., 'Unit 1')
 * @param {string} courseId - The course ID
 */
function addCleanupButton(container, unitName, courseId) {
    // Check if cleanup button already exists
    let hasCleanupButton = false;
    container.querySelectorAll('.cleanup-section').forEach(item => {
        if (item.textContent.includes('Clear All Documents')) {
            hasCleanupButton = true;
        }
    });
    
    if (!hasCleanupButton) {
        const cleanupSection = document.createElement('div');
        cleanupSection.className = 'cleanup-section';
        cleanupSection.style.marginTop = '20px';
        cleanupSection.style.padding = '15px';
        cleanupSection.style.backgroundColor = '#fff3cd';
        cleanupSection.style.border = '1px solid #ffeaa7';
        cleanupSection.style.borderRadius = '5px';
        cleanupSection.innerHTML = `
            <h4 style="margin: 0 0 10px 0; color: #856404;">⚠️ Document Cleanup</h4>
            <p style="margin: 0 0 15px 0; color: #856404; font-size: 14px;">
                This will remove ALL documents from ${unitName} in the course structure. 
                This action cannot be undone.
            </p>
            <button class="cleanup-btn" onclick="clearAllDocuments('${unitName}', '${courseId}')" 
                    style="background: #dc3545; color: white; border: none; padding: 8px 16px; border-radius: 4px; cursor: pointer;">
                🗑️ Clear All Documents from ${unitName}
            </button>
        `;
        container.appendChild(cleanupSection);
    }
}

/**
 * Clear all documents from a specific unit in the course structure
 * @param {string} unitName - The name of the unit (e.g., 'Unit 1')
 * @param {string} courseId - The course ID
 */
async function clearAllDocuments(unitName, courseId) {
    // Confirm the action
    if (!confirm(`Are you sure you want to clear ALL documents from ${unitName}? This action cannot be undone.`)) {
        return;
    }
    
    try {
        const instructorId = getCurrentInstructorId();
        
        showNotification(`Clearing all documents from ${unitName}...`, 'info');
        
        const response = await fetch(`/api/courses/${courseId}/clear-documents`, {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json',
            },
            body: JSON.stringify({
                unitName: unitName,
                instructorId: instructorId
            })
        });
        
        if (!response.ok) {
            const errorText = await response.text();
            throw new Error(`Failed to clear documents: ${response.status} ${errorText}`);
        }
        
        const result = await response.json();
        
        showNotification(`Successfully cleared ${result.data.clearedCount} documents from ${unitName}!`, 'success');
        
        // Reload documents to reflect the changes
        await loadDocuments();
        
    } catch (error) {
        console.error('Error clearing documents:', error);
        showNotification(`Error clearing documents: ${error.message}`, 'error');
    }
}