/**
 * Onboarding Page JavaScript
 * Handles multi-step onboarding flow for instructors
 */

// Global state for onboarding
let onboardingState = {
    currentStep: 1,
    totalSteps: 4,
    courseData: {},
    uploadedFile: null,
    createdCourseId: null
};

document.addEventListener('DOMContentLoaded', function() {
    // Initialize onboarding functionality
    initializeOnboarding();
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
 * Handle content upload
 */
async function uploadContent() {
    const contentTitle = document.getElementById('content-title');
    const contentDescription = document.getElementById('content-description');
    
    // Basic validation
    if (!onboardingState.uploadedFile) {
        showNotification('Please upload a file first', 'error');
        return;
    }
    
    if (!contentTitle.value.trim()) {
        showFieldError(contentTitle, 'Please enter a title for this content');
        return;
    }
    
    // Disable upload button and show loading
    const uploadButton = document.querySelector('.btn-primary[onclick="uploadContent()"]');
    if (uploadButton) {
        uploadButton.disabled = true;
        uploadButton.textContent = 'Uploading...';
    }
    
    try {
        // Prepare upload data - automatically Week 1, lecture type
        const uploadData = {
            title: contentTitle.value.trim(),
            description: contentDescription.value.trim(),
            week: 1, // Automatically Week 1
            type: 'lecture', // Automatically lecture type
            fileName: onboardingState.uploadedFile.name,
            fileSize: onboardingState.uploadedFile.size,
            courseId: onboardingState.createdCourseId
        };
        
        // Mock upload API call
        const response = await mockUploadContent(uploadData);
        
        showNotification('Content uploaded successfully!', 'success');
        
        // Move to completion step
        nextStep();
        
    } catch (error) {
        console.error('Error uploading content:', error);
        showNotification('Failed to upload content. Please try again.', 'error');
    } finally {
        // Re-enable upload button
        if (uploadButton) {
            uploadButton.disabled = false;
            uploadButton.textContent = 'Upload & Complete';
        }
    }
}

/**
 * Mock upload content API call
 */
async function mockUploadContent(uploadData) {
    // Simulate API delay
    await new Promise(resolve => setTimeout(resolve, 2000));
    
    // Return mock response
    return {
        contentId: `content-${Date.now()}`,
        title: uploadData.title,
        description: uploadData.description,
        week: uploadData.week,
        type: uploadData.type,
        fileName: uploadData.fileName,
        fileSize: uploadData.fileSize,
        courseId: uploadData.courseId,
        uploadedAt: new Date().toISOString(),
        status: 'processed'
    };
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
 * Completion functions
 */
function finishOnboarding() {
    window.location.href = '/instructor/documents';
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