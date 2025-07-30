/**
 * Onboarding Page JavaScript
 * Handles multi-step onboarding flow for instructors
 */

// Global state for onboarding
let onboardingState = {
    currentStep: 1,
    totalSteps: 5,
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
        lecturesPerWeek: parseInt(formData.get('lecturesPerWeek')),
        contentTypes: Array.from(form.querySelectorAll('input[name="contentTypes"]:checked'))
            .map(input => input.value)
    };
    
    // Disable submit button and show loading
    submitButton.disabled = true;
    submitButton.textContent = 'Creating Course Structure...';
    
    try {
        // Mock API call
        const response = await mockCreateCourse(onboardingState.courseData);
        
        if (response.success) {
            // Store the created course ID
            onboardingState.createdCourseId = response.data.id;
            
            // Generate folder structure preview
            generateFolderStructure();
            
            // Move to next step
            nextStep();
            
        } else {
            showErrorMessage(response.message || 'Failed to create course structure');
        }
        
    } catch (error) {
        console.error('Error creating course:', error);
        showErrorMessage('Failed to create course structure. Please try again.');
    } finally {
        // Re-enable submit button
        submitButton.disabled = false;
        submitButton.textContent = 'Create Course Structure';
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
        success: true,
        message: 'Course created successfully',
        data: {
            id: `course-${Date.now()}`,
            name: courseData.course,
            weeks: courseData.weeks,
            lecturesPerWeek: courseData.lecturesPerWeek,
            contentTypes: courseData.contentTypes,
            createdAt: new Date().toISOString(),
            status: 'active'
        }
    };
}

/**
 * Validate course setup form
 */
function validateCourseSetup() {
    const courseSelect = document.getElementById('course-select');
    const weeksSelect = document.getElementById('weeks-count');
    const lecturesSelect = document.getElementById('lectures-per-week');
    
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
    
    // Validate weeks selection
    if (!weeksSelect.value) {
        showFieldError(weeksSelect, 'Please select the number of weeks');
        isValid = false;
    }
    
    // Validate lectures per week
    if (!lecturesSelect.value) {
        showFieldError(lecturesSelect, 'Please select lectures per week');
        isValid = false;
    }
    
    return isValid;
}

/**
 * Generate folder structure preview
 */
function generateFolderStructure() {
    const folderStructure = document.getElementById('folder-structure');
    const previewCourseName = document.getElementById('preview-course-name');
    const previewCourseStructure = document.getElementById('preview-course-structure');
    
    if (!folderStructure || !onboardingState.courseData) return;
    
    // Update preview headers
    if (previewCourseName) {
        previewCourseName.textContent = onboardingState.courseData.course;
    }
    
    if (previewCourseStructure) {
        previewCourseStructure.textContent = 
            `${onboardingState.courseData.weeks} weeks, ${onboardingState.courseData.lecturesPerWeek} lecture${onboardingState.courseData.lecturesPerWeek > 1 ? 's' : ''} per week`;
    }
    
    // Generate folder items
    folderStructure.innerHTML = '';
    
    for (let week = 1; week <= onboardingState.courseData.weeks; week++) {
        const folderItem = document.createElement('div');
        folderItem.className = 'folder-item';
        folderItem.innerHTML = `
            <span class="folder-icon">📁</span>
            <span class="folder-name">Week ${week}</span>
        `;
        folderStructure.appendChild(folderItem);
    }
    
    // Add special folders based on content types
    if (onboardingState.courseData.contentTypes.includes('syllabus')) {
        const syllabusFolder = document.createElement('div');
        syllabusFolder.className = 'folder-item';
        syllabusFolder.innerHTML = `
            <span class="folder-icon">📋</span>
            <span class="folder-name">Syllabus & Schedule</span>
        `;
        folderStructure.appendChild(syllabusFolder);
    }
    
    if (onboardingState.courseData.contentTypes.includes('practice-quizzes')) {
        const quizFolder = document.createElement('div');
        quizFolder.className = 'folder-item';
        quizFolder.innerHTML = `
            <span class="folder-icon">❓</span>
            <span class="folder-name">Practice Quizzes</span>
        `;
        folderStructure.appendChild(quizFolder);
    }
    
    if (onboardingState.courseData.contentTypes.includes('readings')) {
        const readingsFolder = document.createElement('div');
        readingsFolder.className = 'folder-item';
        readingsFolder.innerHTML = `
            <span class="folder-icon">📚</span>
            <span class="folder-name">Required Readings</span>
        `;
        folderStructure.appendChild(readingsFolder);
    }
}

/**
 * Populate week options for content upload
 */
function populateWeekOptions() {
    const contentWeek = document.getElementById('content-week');
    if (!contentWeek || !onboardingState.courseData.weeks) return;
    
    contentWeek.innerHTML = '<option value="">Select week...</option>';
    
    for (let week = 1; week <= onboardingState.courseData.weeks; week++) {
        const option = document.createElement('option');
        option.value = week;
        option.textContent = `Week ${week}`;
        contentWeek.appendChild(option);
    }
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
 * Upload content and continue
 */
async function uploadContent() {
    const contentTitle = document.getElementById('content-title');
    const contentDescription = document.getElementById('content-description');
    const contentWeek = document.getElementById('content-week');
    const contentType = document.getElementById('content-type');
    const uploadButton = document.querySelector('button[onclick="uploadContent()"]');
    
    // Validate required fields
    if (!onboardingState.uploadedFile) {
        showErrorMessage('Please select a file to upload');
        return;
    }
    
    if (!contentTitle.value.trim()) {
        showFieldError(contentTitle, 'Please enter a title for this content');
        return;
    }
    
    if (!contentWeek.value) {
        showFieldError(contentWeek, 'Please select a week for this content');
        return;
    }
    
    // Disable upload button and show loading
    if (uploadButton) {
        uploadButton.disabled = true;
        uploadButton.textContent = 'Uploading...';
    }
    
    try {
        // Prepare upload data
        const uploadData = {
            title: contentTitle.value.trim(),
            description: contentDescription.value.trim(),
            week: contentWeek.value,
            type: contentType.value,
            fileName: onboardingState.uploadedFile.name,
            fileSize: onboardingState.uploadedFile.size
        };
        
        // Mock upload API call
        const response = await mockUploadContent(uploadData);
        
        if (response.success) {
            showSuccessMessage('Content uploaded successfully!');
            
            // Move to completion step
            nextStep();
            
        } else {
            showErrorMessage(response.message || 'Failed to upload content');
        }
        
    } catch (error) {
        console.error('Error uploading content:', error);
        showErrorMessage('Failed to upload content. Please try again.');
    } finally {
        // Re-enable upload button
        if (uploadButton) {
            uploadButton.disabled = false;
            uploadButton.textContent = 'Upload & Continue';
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
        success: true,
        message: 'Content uploaded successfully',
        data: {
            id: `content-${Date.now()}`,
            title: uploadData.title,
            description: uploadData.description,
            week: uploadData.week,
            type: uploadData.type,
            fileName: uploadData.fileName,
            fileSize: uploadData.fileSize,
            uploadedAt: new Date().toISOString(),
            status: 'processing'
        }
    };
}

/**
 * Navigation functions
 */
function nextStep() {
    if (onboardingState.currentStep < onboardingState.totalSteps) {
        onboardingState.currentStep++;
        showStep(onboardingState.currentStep);
        updateProgressBar();
        
        // Populate week options when reaching step 4
        if (onboardingState.currentStep === 4) {
            populateWeekOptions();
        }
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
 * Structure preview functions
 */
function editStructure() {
    // Go back to step 2
    onboardingState.currentStep = 2;
    showStep(2);
    updateProgressBar();
}

function confirmStructure() {
    nextStep();
}

/**
 * Completion functions
 */
function goToDocuments() {
    window.location.href = '/instructor';
}

function goToSettings() {
    window.location.href = '/instructor/settings';
}

function goToHome() {
    window.location.href = '/instructor/home';
}

function finishOnboarding() {
    // Mark onboarding as complete (store in localStorage or send to backend)
    localStorage.setItem('onboardingComplete', 'true');
    
    // Redirect to documents page
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