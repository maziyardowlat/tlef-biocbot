/**
 * Onboarding Page JavaScript
 * Handles multi-step onboarding flow for instructors with integrated Week1 accordion
 */

// Global state for onboarding
let onboardingState = {
    currentStep: 1,
    totalSteps: 3,
    courseData: {},
    uploadedFile: null,
    createdCourseId: null
};

// Upload modal state (from instructor.js)
let uploadedFile = null;
let currentWeek = null;
let currentContentType = null;

document.addEventListener('DOMContentLoaded', function() {
    // Initialize onboarding functionality
    initializeOnboarding();
    
    // Initialize Week1 accordion functionality when on step 3
    initializeWeek1Accordion();
});

/**
 * Initialize all onboarding functionality
 */
function initializeOnboarding() {
    // Initialize form handlers
    initializeFormHandlers();
    
    // Initialize file upload handlers
    initializeFileUpload();
    
    // Initialize progress bar
    updateProgressBar();
    
    // Show first step
    showStep(1);
}

/**
 * Initialize Week1 accordion functionality
 */
function initializeWeek1Accordion() {
    // Initialize accordion header click handlers
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
            
            // Use the improved toggle function
            toggleAccordionDynamic(content, toggle);
        });
    });
    
    // Initialize section headers
    const sectionHeaders = document.querySelectorAll('.section-header');
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
    
    // Add click outside modal to close functionality
    document.addEventListener('click', (e) => {
        const uploadModal = document.getElementById('upload-modal');
        
        // Close upload modal if clicking outside
        if (uploadModal && uploadModal.classList.contains('show') && e.target === uploadModal) {
            closeUploadModal();
        }
    });
}

/**
 * Initialize form event handlers
 */
function initializeFormHandlers() {
    // Course selection handler
    const courseSelect = document.getElementById('course-select');
    if (courseSelect) {
        courseSelect.addEventListener('change', handleCourseSelection);
    }
    
    // Custom course name handler
    const customCourseSection = document.getElementById('custom-course-section');
    const customCourseName = document.getElementById('custom-course-name');
    if (customCourseName) {
        customCourseName.addEventListener('input', handleCustomCourseInput);
    }
    
    // Course setup form handler
    const courseSetupForm = document.getElementById('course-setup-form');
    if (courseSetupForm) {
        courseSetupForm.addEventListener('submit', handleCourseSetup);
    }
}

/**
 * Initialize file upload functionality
 */
function initializeFileUpload() {
    const fileInput = document.getElementById('file-input');
    const uploadZone = document.getElementById('upload-zone');
    const fileUploadArea = document.getElementById('file-upload-area');
    
    if (fileInput) {
        fileInput.addEventListener('change', handleFileSelect);
    }
    
    if (uploadZone) {
        // Drag and drop functionality
        uploadZone.addEventListener('dragover', handleDragOver);
        uploadZone.addEventListener('drop', handleFileDrop);
        uploadZone.addEventListener('click', () => fileInput.click());
    }
}

/**
 * Handle course selection change
 */
function handleCourseSelection(event) {
    const courseSelect = event.target;
    const customCourseSection = document.getElementById('custom-course-section');
    
    if (courseSelect.value === 'custom') {
        customCourseSection.style.display = 'block';
    } else {
        customCourseSection.style.display = 'none';
        // Store course data
        onboardingState.courseData.course = courseSelect.value;
    }
}

/**
 * Handle custom course name input
 */
function handleCustomCourseInput(event) {
    onboardingState.courseData.course = event.target.value;
}

/**
 * Handle course setup form submission
 */
async function handleCourseSetup(event) {
    event.preventDefault();
    
    const form = event.target;
    const submitButton = form.querySelector('button[type="submit"]');
    
    // Validate form
    if (!validateCourseSetup()) {
        return;
    }
    
    // Collect form data
    const formData = new FormData(form);
    onboardingState.courseData = {
        course: formData.get('course') === 'custom' ? 
            document.getElementById('custom-course-name').value : 
            formData.get('course'),
        weeks: parseInt(formData.get('weeks')),
        lecturesPerWeek: parseInt(formData.get('lecturesPerWeek'))
    };
    
    // Disable submit button and show loading
    submitButton.disabled = true;
    submitButton.textContent = 'Creating course...';
    
    try {
        // Mock API call to create course
        const response = await mockCreateCourse(onboardingState.courseData);
        onboardingState.createdCourseId = response.courseId;
        
        // Move to next step (first upload)
        nextStep();
        
    } catch (error) {
        console.error('Error creating course:', error);
        showNotification('Error creating course. Please try again.', 'error');
    } finally {
        // Re-enable submit button
        submitButton.disabled = false;
        submitButton.textContent = 'Continue to Upload';
    }
}

/**
 * Mock create course API call
 */
async function mockCreateCourse(courseData) {
    // Simulate API delay
    await new Promise(resolve => setTimeout(resolve, 1500));
    
    // Return mock response
    return {
        courseId: `course-${Date.now()}`,
        name: courseData.course,
        weeks: courseData.weeks,
        lecturesPerWeek: courseData.lecturesPerWeek,
        createdAt: new Date().toISOString(),
        status: 'active'
    };
}

/**
 * Validate course setup form
 */
function validateCourseSetup() {
    const courseSelect = document.getElementById('course-select');
    const weeksInput = document.getElementById('weeks-count');
    const lecturesInput = document.getElementById('lectures-per-week');
    
    let isValid = true;
    
    // Validate course selection
    if (!courseSelect.value) {
        showFieldError(courseSelect, 'Please select a course');
        isValid = false;
    }
    
    // Validate custom course name if selected
    if (courseSelect.value === 'custom') {
        const customName = document.getElementById('custom-course-name').value.trim();
        if (!customName) {
            showFieldError(document.getElementById('custom-course-name'), 'Please enter a course name');
            isValid = false;
        }
    }
    
    // Validate weeks input
    const weeks = parseInt(weeksInput.value);
    if (!weeks || weeks < 1 || weeks > 20) {
        showFieldError(weeksInput, 'Please enter a valid number of weeks (1-20)');
        isValid = false;
    }
    
    // Validate lectures per week input
    const lectures = parseInt(lecturesInput.value);
    if (!lectures || lectures < 1 || lectures > 5) {
        showFieldError(lecturesInput, 'Please enter a valid number of lectures per week (1-5)');
        isValid = false;
    }
    
    return isValid;
}

/**
 * Handle file selection
 */
function handleFileSelect(event) {
    const file = event.target.files[0];
    if (file) {
        processSelectedFile(file);
    }
}

/**
 * Handle drag over event
 */
function handleDragOver(event) {
    event.preventDefault();
    event.currentTarget.style.borderColor = 'var(--primary-color)';
}

/**
 * Handle file drop
 */
function handleFileDrop(event) {
    event.preventDefault();
    const file = event.dataTransfer.files[0];
    if (file) {
        processSelectedFile(file);
    }
    event.currentTarget.style.borderColor = '#ddd';
}

/**
 * Process selected file
 */
function processSelectedFile(file) {
    // Validate file type
    const allowedTypes = ['.pdf', '.docx', '.txt', '.ppt', '.pptx'];
    const fileExtension = '.' + file.name.split('.').pop().toLowerCase();
    
    if (!allowedTypes.includes(fileExtension)) {
        showErrorMessage('Please select a valid file type (PDF, DOCX, TXT, PPT, PPTX)');
        return;
    }
    
    // Store file info
    onboardingState.uploadedFile = file;
    
    // Update UI
    const fileInfo = document.getElementById('file-info');
    const fileName = document.getElementById('file-name');
    const fileSize = document.getElementById('file-size');
    const uploadZone = document.querySelector('.upload-zone');
    
    if (fileInfo && fileName && fileSize) {
        fileName.textContent = file.name;
        fileSize.textContent = formatFileSize(file.size);
        fileInfo.style.display = 'block';
        uploadZone.style.display = 'none';
    }
    
    // Auto-fill content title if empty
    const contentTitle = document.getElementById('content-title');
    if (contentTitle && !contentTitle.value) {
        contentTitle.value = file.name.replace(/\.[^/.]+$/, ''); // Remove file extension
    }
}

/**
 * Format file size
 */
function formatFileSize(bytes) {
    if (bytes === 0) return '0 Bytes';
    const k = 1024;
    const sizes = ['Bytes', 'KB', 'MB', 'GB'];
    const i = Math.floor(Math.log(bytes) / Math.log(k));
    return parseFloat((bytes / Math.pow(k, i)).toFixed(2)) + ' ' + sizes[i];
}



/**
 * Navigate to next step
 */
function nextStep() {
    if (onboardingState.currentStep < onboardingState.totalSteps) {
        onboardingState.currentStep++;
        showStep(onboardingState.currentStep);
        updateProgressBar();
    }
}

function previousStep() {
    if (onboardingState.currentStep > 1) {
        onboardingState.currentStep--;
        showStep(onboardingState.currentStep);
        updateProgressBar();
    }
}

/**
 * Show specific step
 */
function showStep(stepNumber) {
    // Hide all steps
    const steps = document.querySelectorAll('.onboarding-step');
    steps.forEach(step => step.classList.remove('active'));
    
    // Show current step
    const currentStep = document.getElementById(`step-${stepNumber}`);
    if (currentStep) {
        currentStep.classList.add('active');
    }
    
    // Update step indicators
    const indicators = document.querySelectorAll('.step-indicator');
    indicators.forEach((indicator, index) => {
        indicator.classList.remove('active', 'completed');
        if (index + 1 < stepNumber) {
            indicator.classList.add('completed');
        } else if (index + 1 === stepNumber) {
            indicator.classList.add('active');
        }
    });
}

/**
 * Update progress bar
 */
function updateProgressBar() {
    const progressFill = document.getElementById('progress-fill');
    if (progressFill) {
        const progress = (onboardingState.currentStep / onboardingState.totalSteps) * 100;
        progressFill.style.width = `${progress}%`;
    }
}



/**
 * Utility functions
 */
function showFieldError(field, message) {
    const formGroup = field.closest('.form-group');
    
    // Remove existing error
    formGroup.classList.remove('success');
    const existingError = formGroup.querySelector('.error-message');
    if (existingError) {
        existingError.remove();
    }
    
    // Add error state
    formGroup.classList.add('error');
    
    // Create error message element
    const errorElement = document.createElement('div');
    errorElement.className = 'error-message';
    errorElement.textContent = message;
    
    // Insert error message after the field
    field.parentNode.insertBefore(errorElement, field.nextSibling);
}

function showSuccessMessage(message) {
    showNotification(message, 'success');
}

function showErrorMessage(message) {
    showNotification(message, 'error');
}

function showNotification(message, type) {
    // Create notification element
    const notification = document.createElement('div');
    notification.className = `notification ${type}`;
    notification.innerHTML = `
        <span>${message}</span>
        <button class="notification-close" onclick="this.parentElement.remove()">×</button>
    `;
    
    // Add styles
    notification.style.cssText = `
        position: fixed;
        top: 20px;
        right: 20px;
        padding: 15px 20px;
        border-radius: 6px;
        color: white;
        font-weight: 500;
        z-index: 1000;
        display: flex;
        align-items: center;
        gap: 10px;
        max-width: 400px;
        ${type === 'success' ? 'background-color: var(--success-color);' : 'background-color: var(--danger-color);'}
    `;
    
    // Add to page
    document.body.appendChild(notification);
    
    // Auto-remove after 5 seconds
    setTimeout(() => {
        if (notification.parentElement) {
            notification.remove();
        }
    }, 5000);
}

/**
 * Auth utility functions (placeholders - replace with actual auth implementation)
 */
function getCurrentInstructorId() {
    // This would typically come from JWT token or session
    // For now, return a placeholder
    return 'instructor-123';
}

function getAuthToken() {
    // This would typically come from localStorage or sessionStorage
    // For now, return a placeholder
    return 'placeholder-token';
} 

/**
 * Complete Week 1 setup and redirect to course upload
 */
async function completeWeek1Setup() {
    // Validate that required content has been set up
    const hasLearningObjectives = document.querySelectorAll('#objectives-list-week1 .objective-display-item').length > 0;
    const hasRequiredMaterials = validateRequiredMaterials();
    
    if (!hasLearningObjectives) {
        showNotification('Please add at least one learning objective before continuing.', 'error');
        return;
    }
    
    if (!hasRequiredMaterials) {
        showNotification('Please upload required materials (Lecture Notes and Practice Questions) before continuing.', 'error');
        return;
    }
    
    // Show success message and redirect to course upload
    showNotification('Week 1 setup completed successfully! Redirecting to course upload...', 'success');
    
    // Wait a moment for the notification to be seen, then redirect
    setTimeout(() => {
        window.location.href = '/instructor/index.html';
    }, 1500);
}

/**
 * Validate that required materials have been uploaded
 */
function validateRequiredMaterials() {
    const courseSection = document.querySelector('.course-materials-section');
    const fileItems = courseSection.querySelectorAll('.file-item');
    
    let hasLectureNotes = false;
    let hasPracticeQuestions = false;
    
    fileItems.forEach(item => {
        const title = item.querySelector('.file-info h3').textContent;
        const status = item.querySelector('.status-text').textContent;
        
        if (title.includes('*Lecture Notes') && status === 'Processed') {
            hasLectureNotes = true;
        }
        if (title.includes('*Practice Questions/Tutorial') && status === 'Processed') {
            hasPracticeQuestions = true;
        }
    });
    
    return hasLectureNotes && hasPracticeQuestions;
}

// ============ UPLOAD MODAL FUNCTIONALITY ============

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
    
    // For demo purposes, just show a notification
    showNotification(`Viewing content: ${fileName}`, 'info');
}

// ============ ACCORDION INTERACTION FUNCTIONS ============

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
    }
}

// ============ LEARNING OBJECTIVES FUNCTIONS ============

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
        // For demo purposes, simulate save
        await new Promise(resolve => setTimeout(resolve, 1000));
        showNotification(`Learning objectives for ${week} saved successfully!`, 'success');
        
    } catch (error) {
        console.error('Error saving learning objectives:', error);
        showNotification(`Learning objectives for ${week} saved successfully! (Demo mode)`, 'success');
    }
}

/**
 * Confirm course materials for a week
 * @param {string} week - The week identifier (e.g., 'Week 1')
 */
async function confirmCourseMaterials(week) {
    try {
        // For demo purposes, simulate confirmation
        await new Promise(resolve => setTimeout(resolve, 1000));
        showNotification(`Course materials for ${week} confirmed successfully!`, 'success');
        
    } catch (error) {
        console.error('Error confirming course materials:', error);
        showNotification(`Course materials for ${week} confirmed successfully! (Demo mode)`, 'success');
    }
}

// ============ PROBING QUESTIONS FUNCTIONS ============

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
        // For demo purposes, simulate save
        await new Promise(resolve => setTimeout(resolve, 1000));
        showNotification(`Probing questions for ${week} saved successfully!`, 'success');
        
    } catch (error) {
        console.error('Error saving probing questions:', error);
        showNotification(`Probing questions for ${week} saved successfully! (Demo mode)`, 'success');
    }
}

/**
 * Generate probing questions based on uploaded course materials
 * @param {string} week - The week identifier (e.g., 'Week 1')
 */
async function generateProbingQuestions(week) {
    showNotification('Generating probing questions based on course materials...', 'info');
    
    try {
        // Simulate AI generation delay
        await new Promise(resolve => setTimeout(resolve, 2000));
        
        // Generate mock probing questions
        const mockQuestions = [
            "Can you explain the relationship between water's molecular structure and its role as a biological solvent?",
            "How do buffer systems maintain pH homeostasis in living organisms?",
            "What would happen to cellular processes if amino acids couldn't form peptide bonds?"
        ];
        
        // Find the week element and questions list
        const weekElement = findElementsContainingText('.accordion-item .folder-name', week)[0].closest('.accordion-item');
        const questionsList = weekElement.querySelector(`#questions-list-${week.toLowerCase().replace(/\s+/g, '')}`);
        
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