/**
 * Onboarding Page JavaScript
 * Handles guided multi-step onboarding flow for instructors
 */

// Global state for onboarding
let onboardingState = {
    currentStep: 1,
    totalSteps: 3,
    currentSubstep: 'objectives',
    substeps: ['objectives', 'materials', 'questions'],
    courseData: {},
    uploadedFile: null,
    createdCourseId: null,
    isSubmitting: false, // Prevent multiple submissions
    existingCourseId: null // Store existing course ID if found
};

// Upload modal state
let uploadedFile = null;
let currentWeek = null;
let currentContentType = null;

document.addEventListener('DOMContentLoaded', function() {
    // Initialize onboarding functionality
    initializeOnboarding();
    
    // Initialize guided substep functionality
    initializeGuidedSubsteps();
});

/**
 * Check if onboarding is already complete for this instructor
 */
async function checkOnboardingStatus() {
    try {
        // Check if there's a courseId in URL params (from redirect)
        const urlParams = new URLSearchParams(window.location.search);
        const courseId = urlParams.get('courseId');
        
        if (courseId) {
            // Check if this course has onboarding complete
            const response = await fetch(`/api/onboarding/${courseId}`);
            if (response.ok) {
                const courseData = await response.json();
                if (courseData.data && courseData.data.isOnboardingComplete) {
                    showOnboardingComplete();
                    return;
                }
            }
        }
        
        // Check if instructor has any completed courses
        const instructorId = 'instructor-123'; // This would come from authentication
        const response = await fetch(`/api/onboarding/instructor/${instructorId}`);
        if (response.ok) {
            const result = await response.json();
            if (result.data && result.data.courses && result.data.courses.length > 0) {
                // Check if any course has onboarding complete
                const completedCourse = result.data.courses.find(course => course.isOnboardingComplete);
                if (completedCourse) {
                    // Store the course ID for potential redirect
                    onboardingState.existingCourseId = completedCourse.courseId;
                    showOnboardingComplete();
                    return;
                }
            }
        }
        
        // If we get here, onboarding is not complete, show normal flow
        showOnboardingFlow();
        
    } catch (error) {
        console.error('Error checking onboarding status:', error);
        // If there's an error, show normal onboarding flow
        showOnboardingFlow();
    }
}

/**
 * Show onboarding complete message
 */
function showOnboardingComplete() {
    // Hide all onboarding steps
    document.querySelectorAll('.onboarding-step').forEach(step => {
        step.style.display = 'none';
    });
    
    // Hide progress bar
    document.querySelector('.onboarding-progress').style.display = 'none';
    
    // Show completion message
    document.getElementById('onboarding-complete').style.display = 'block';
    
    // Update the course upload link to include the existing course ID
    if (onboardingState.existingCourseId) {
        const courseUploadLink = document.querySelector('#onboarding-complete .btn-primary');
        if (courseUploadLink) {
            courseUploadLink.href = `/instructor/documents?courseId=${onboardingState.existingCourseId}`;
        }
    }
    
    // Auto-redirect after 5 seconds to prevent users from staying on onboarding
    setTimeout(() => {
        if (onboardingState.existingCourseId) {
            window.location.href = `/instructor/documents?courseId=${onboardingState.existingCourseId}`;
        } else {
            window.location.href = '/instructor/documents';
        }
    }, 5000);
}

/**
 * Show normal onboarding flow
 */
function showOnboardingFlow() {
    // Hide completion message
    document.getElementById('onboarding-complete').style.display = 'none';
    
    // Show progress bar
    document.querySelector('.onboarding-progress').style.display = 'block';
    
    // Show first step
    showStep(1);
}

/**
 * Initialize all onboarding functionality
 */
function initializeOnboarding() {
    console.log('Initializing onboarding...');
    
    // Initialize form handlers
    initializeFormHandlers();
    
    // Initialize file upload handlers
    initializeFileUpload();
    
    // Initialize progress bar
    updateProgressBar();
    
    // Show first step (this will be overridden if onboarding is complete)
    showStep(1);
    
    // Add debugging for learning objectives
    console.log('Setting up learning objectives debugging...');
    setTimeout(() => {
        const addButton = document.querySelector('.add-objective-btn');
        if (addButton) {
            console.log('Add objective button found:', addButton);
            
            // Remove any existing onclick to avoid conflicts
            addButton.removeAttribute('onclick');
            
            addButton.addEventListener('click', function(e) {
                console.log('Add objective button clicked!');
                e.preventDefault();
                e.stopPropagation();
                addObjectiveForUnit('Unit 1');
            });
            
            console.log('Event listener added to add objective button');
        } else {
            console.error('Add objective button not found!');
        }
    }, 1000); // Wait a bit for DOM to be ready
}

/**
 * Initialize guided substep functionality
 */
function initializeGuidedSubsteps() {
    // Initialize progress card click handlers
    const progressCards = document.querySelectorAll('.progress-card');
    progressCards.forEach(card => {
        card.addEventListener('click', () => {
            const substep = card.dataset.substep;
            if (substep) {
                showSubstep(substep);
            }
        });
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
    
    if (fileInput) {
        fileInput.addEventListener('change', handleFileSelect);
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
    
    // Prevent multiple submissions
    if (onboardingState.isSubmitting) {
        console.log('Form submission already in progress, ignoring duplicate submit');
        return;
    }
    
    const form = event.target;
    const submitButton = form.querySelector('button[type="submit"]');
    
    // Validate form
    if (!validateCourseSetup()) {
        return;
    }
    
    // Collect form data
    const formData = new FormData(form);
    const weeks = parseInt(formData.get('weeks'));
    const lecturesPerWeek = parseInt(formData.get('lecturesPerWeek'));
    
    onboardingState.courseData = {
        course: formData.get('course') === 'custom' ? 
            document.getElementById('custom-course-name').value : 
            formData.get('course'),
        weeks: weeks,
        lecturesPerWeek: lecturesPerWeek,
        totalUnits: weeks * lecturesPerWeek // Calculate total units
    };
    
    console.log('Collected course data:', onboardingState.courseData);
    console.log(`Will create ${onboardingState.courseData.totalUnits} units (${weeks} weeks × ${lecturesPerWeek} lectures per week)`);
    
    // Set submitting flag and disable submit button
    onboardingState.isSubmitting = true;
    submitButton.disabled = true;
    submitButton.textContent = 'Creating course...';
    
    try {
        // Check if course already exists for this instructor
        const existingCourse = await checkExistingCourse();
        if (existingCourse) {
            showNotification('You already have a course set up. Redirecting to course page...', 'info');
            setTimeout(() => {
                window.location.href = `/instructor/documents?courseId=${existingCourse.courseId}`;
            }, 2000);
            return;
        }
        
        // Create course and save to database
        const response = await createCourse(onboardingState.courseData);
        onboardingState.createdCourseId = response.courseId;
        
        // Move to next step (guided unit setup)
        nextStep();
        
    } catch (error) {
        console.error('Error creating course:', error);
        showNotification('Error creating course. Please try again.', 'error');
    } finally {
        // Reset submitting flag and re-enable submit button
        onboardingState.isSubmitting = false;
        submitButton.disabled = false;
        submitButton.textContent = 'Continue to Unit Setup';
    }
}

/**
 * Check if instructor already has a course
 */
async function checkExistingCourse() {
    try {
        const instructorId = 'instructor-123'; // This would come from authentication
        const response = await fetch(`/api/onboarding/instructor/${instructorId}`);
        
        if (response.ok) {
            const result = await response.json();
            if (result.data && result.data.courses && result.data.courses.length > 0) {
                // Return the first course found
                return result.data.courses[0];
            }
        }
        
        return null;
    } catch (error) {
        console.error('Error checking existing course:', error);
        return null;
    }
}

/**
 * Create course and save onboarding data to database
 */
async function createCourse(courseData) {
    try {
        // Generate a course ID based on the course name
        let courseId = courseData.course.replace(/\s+/g, '-').toUpperCase();
        
        // Ensure the course ID is valid (no special characters, reasonable length)
        courseId = courseId.replace(/[^A-Z0-9-]/g, '');
        if (courseId.length > 20) {
            courseId = courseId.substring(0, 20);
        }
        
        // Add timestamp to ensure uniqueness
        courseId = `${courseId}-${Date.now()}`;
        
        const instructorId = 'instructor-123'; // This would come from authentication in real app
        
        // Get learning objectives from the UI
        const learningObjectives = getLearningObjectivesFromUI();
        console.log('Learning objectives from UI:', learningObjectives);
        console.log('Objectives list element:', document.getElementById('objectives-list'));
        console.log('Objective items found:', document.querySelectorAll('.objective-display-item').length);
        
        // If no objectives found, show error
        if (learningObjectives.length === 0) {
            console.warn('No learning objectives found in UI - this might cause issues');
            console.log('Trying to find objectives manually...');
            
            // Try to find objectives manually
            const objectivesList = document.getElementById('objectives-list');
            if (objectivesList) {
                const items = objectivesList.querySelectorAll('.objective-display-item');
                console.log('Manual search found items:', items.length);
                items.forEach((item, index) => {
                    const text = item.querySelector('.objective-text')?.textContent;
                    console.log(`Item ${index}:`, text);
                });
            }
        }
        
        // Prepare onboarding data with unit structure
        const onboardingData = {
            courseId: courseId,
            courseName: courseData.course,
            instructorId: instructorId,
            courseDescription: '',
            learningOutcomes: learningObjectives,
            prerequisites: [],
            assessmentCriteria: '',
            courseMaterials: [],
            unitFiles: {},
            courseStructure: {
                weeks: courseData.weeks,
                lecturesPerWeek: courseData.lecturesPerWeek,
                totalUnits: courseData.totalUnits
            }
        };
        
        // Initialize unit structure with Unit 1 learning objectives
        for (let i = 1; i <= courseData.totalUnits; i++) {
            const unitName = `Unit ${i}`;
            onboardingData.unitFiles[unitName] = [];
            
            // Add learning objectives to Unit 1
            if (i === 1 && learningObjectives.length > 0) {
                onboardingData.lectures = [{
                    name: unitName,
                    learningObjectives: learningObjectives,
                    isPublished: false,
                    passThreshold: 2,
                    createdAt: new Date(),
                    updatedAt: new Date()
                }];
                console.log(`Added ${learningObjectives.length} learning objectives to ${unitName}`);
            }
        }
        
        console.log('Sending onboarding data to API:', onboardingData);
        
        // Save to database
        console.log('Making API request to:', '/api/onboarding');
        console.log('Request method: POST');
        console.log('Request headers:', { 'Content-Type': 'application/json' });
        console.log('Request body:', JSON.stringify(onboardingData, null, 2));
        
        const response = await fetch('/api/onboarding', {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json',
            },
            body: JSON.stringify(onboardingData)
        });
        
        console.log('API response status:', response.status);
        console.log('API response status text:', response.statusText);
        console.log('API response headers:', response.headers);
        
        if (!response.ok) {
            const errorText = await response.text();
            console.error('API error response:', errorText);
            throw new Error(`Failed to create course: ${response.status} ${errorText}`);
        }
        
        const result = await response.json();
        console.log('API success response:', result);
        
        return {
            courseId: courseId,
            name: courseData.course,
            weeks: courseData.weeks,
            lecturesPerWeek: courseData.lecturesPerWeek,
            createdAt: new Date().toISOString(),
            status: 'active'
        };
        
    } catch (error) {
        console.error('Error creating course:', error);
        throw error;
    }
}

/**
 * Get learning objectives from the UI
 * @returns {Array} Array of learning objectives
 */
function getLearningObjectivesFromUI() {
    const objectivesList = document.getElementById('objectives-list');
    if (!objectivesList) {
        console.error('Objectives list not found');
        return [];
    }
    
    const objectives = [];
    const objectiveItems = objectivesList.querySelectorAll('.objective-display-item');
    
    console.log('Found objective items:', objectiveItems.length);
    
    objectiveItems.forEach((item, index) => {
        const objectiveText = item.querySelector('.objective-text');
        if (objectiveText && objectiveText.textContent.trim()) {
            const text = objectiveText.textContent.trim();
            objectives.push(text);
            console.log(`Objective ${index + 1}:`, text);
        }
    });
    
    console.log('Learning objectives from UI:', objectives);
    return objectives;
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
 * Remove a learning objective (used in onboarding)
 * @param {HTMLElement} button - The remove button element
 */
function removeObjective(button) {
    const objectiveItem = button.closest('.objective-display-item');
    if (objectiveItem) {
        objectiveItem.remove();
        showNotification('Learning objective removed.', 'info');
    }
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
    uploadedFile = file;
    
    // Update UI
    const fileInfo = document.getElementById('file-info');
    const fileName = document.getElementById('file-name');
    const fileSize = document.getElementById('file-size');
    
    if (fileInfo && fileName && fileSize) {
        fileName.textContent = file.name;
        fileSize.textContent = formatFileSize(file.size);
        fileInfo.style.display = 'flex';
    }
    
    showNotification(`File "${file.name}" selected successfully`, 'success');
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
    
    // If we're on step 3, show the first substep
    if (stepNumber === 3) {
        showSubstep('objectives');
    }
}

/**
 * Show specific substep
 */
function showSubstep(substepName) {
    // Hide all substeps
    const substeps = document.querySelectorAll('.guided-substep');
    substeps.forEach(substep => substep.classList.remove('active'));
    
    // Show current substep
    const currentSubstep = document.getElementById(`substep-${substepName}`);
    if (currentSubstep) {
        currentSubstep.classList.add('active');
    }
    
    // Update progress cards
    const progressCards = document.querySelectorAll('.progress-card');
    progressCards.forEach(card => {
        card.classList.remove('active', 'completed');
        const cardSubstep = card.dataset.substep;
        const substepIndex = onboardingState.substeps.indexOf(cardSubstep);
        const currentIndex = onboardingState.substeps.indexOf(substepName);
        
        if (substepIndex < currentIndex) {
            card.classList.add('completed');
        } else if (substepIndex === currentIndex) {
            card.classList.add('active');
        }
    });
    
    // Update current substep in state
    onboardingState.currentSubstep = substepName;
}

/**
 * Navigate to next substep
 */
function nextSubstep(substepName) {
    showSubstep(substepName);
}

/**
 * Navigate to previous substep
 */
function previousSubstep(substepName) {
    showSubstep(substepName);
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
 * Add learning objective
 */
function addObjective() {
    const input = document.getElementById('objective-input');
    const objectiveText = input.value.trim();
    
    if (!objectiveText) {
        showNotification('Please enter a learning objective.', 'error');
        return;
    }
    
    const objectivesList = document.getElementById('objectives-list');
    
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
    input.value = '';
    input.focus();
    
    showNotification('Learning objective added successfully!', 'success');
}

/**
 * Remove learning objective
 */
function removeObjective(button) {
    const objectiveItem = button.closest('.objective-display-item');
    objectiveItem.remove();
    showNotification('Learning objective removed.', 'info');
}

/**
 * Add probing question
 */
function addQuestion() {
    const input = document.getElementById('question-input');
    const questionText = input.value.trim();
    
    if (!questionText) {
        showNotification('Please enter a probing question.', 'error');
        return;
    }
    
    const questionsList = document.getElementById('questions-list');
    
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
    input.value = '';
    input.focus();
    
    showNotification('Probing question added successfully!', 'success');
}

/**
 * Remove probing question
 */
function removeQuestion(button) {
    const questionItem = button.closest('.objective-display-item');
    questionItem.remove();
    showNotification('Probing question removed.', 'info');
}

/**
 * Generate probing questions
 */
async function generateProbingQuestions() {
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
        
        const questionsList = document.getElementById('questions-list');
        
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

// Assessment Questions Functionality
// Global variables for assessment questions
let assessmentQuestions = {
    'Onboarding': []
};

/**
 * Open question modal for adding assessment questions
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
 * Save the question from the modal
 */
function saveQuestion() {
    const questionType = document.getElementById('question-type').value;
    const questionText = document.getElementById('question-text').value.trim();
    
    if (!questionType) {
        showNotification('Please select a question type.', 'error');
        return;
    }
    
    if (!questionText) {
        showNotification('Please enter a question.', 'error');
        return;
    }
    
    let question = {
        id: Date.now(),
        type: questionType,
        question: questionText
    };
    
    // Get answer based on question type
    if (questionType === 'true-false') {
        const selectedAnswer = document.querySelector('input[name="tf-answer"]:checked');
        if (!selectedAnswer) {
            showNotification('Please select the correct answer.', 'error');
            return;
        }
        question.correctAnswer = selectedAnswer.value === 'true';
    } else if (questionType === 'multiple-choice') {
        const options = [];
        const mcqInputs = document.querySelectorAll('.mcq-input');
        let hasCorrectAnswer = false;
        
        mcqInputs.forEach(input => {
            if (input.value.trim()) {
                const option = input.dataset.option;
                const isCorrect = document.querySelector(`input[name="mcq-correct"][value="${option}"]`).checked;
                options.push(input.value.trim());
                
                if (isCorrect) {
                    question.correctAnswer = options.length - 1;
                    hasCorrectAnswer = true;
                }
            }
        });
        
        if (options.length < 2) {
            showNotification('Please provide at least 2 answer options.', 'error');
            return;
        }
        
        if (!hasCorrectAnswer) {
            showNotification('Please select the correct answer.', 'error');
            return;
        }
        
        question.options = options;
    } else if (questionType === 'short-answer') {
        const expectedAnswer = document.getElementById('sa-answer').value.trim();
        if (!expectedAnswer) {
            showNotification('Please provide the expected answer or key points.', 'error');
            return;
        }
        question.correctAnswer = expectedAnswer;
    }
    
    // Add question to the assessment
    if (!assessmentQuestions[currentWeek]) {
        assessmentQuestions[currentWeek] = [];
    }
    
    assessmentQuestions[currentWeek].push(question);
    
    // Update the display
    displayAssessmentQuestions(currentWeek);
    
    // Close modal and show success
    closeQuestionModal();
    showNotification('Question added successfully!', 'success');
}

/**
 * Generate AI questions
 */
async function generateAIQuestions(week) {
    showNotification('Generating AI assessment questions...', 'info');
    
    try {
        // Simulate AI generation delay
        await new Promise(resolve => setTimeout(resolve, 2000));
        
        // Generate mock assessment questions
        const mockQuestions = [
            {
                id: Date.now() + 1,
                type: 'multiple-choice',
                question: 'Which of the following best describes the role of water in biological systems?',
                options: [
                    'Water acts as a universal solvent',
                    'Water provides structural support only',
                    'Water is only used for transport',
                    'Water has no biological function'
                ],
                correctAnswer: 0
            },
            {
                id: Date.now() + 2,
                type: 'true-false',
                question: 'Buffer systems help maintain pH homeostasis in living organisms.',
                correctAnswer: true
            },
            {
                id: Date.now() + 3,
                type: 'short-answer',
                question: 'Explain how amino acids form peptide bonds and why this is important for protein structure.',
                correctAnswer: 'Amino acids form peptide bonds through dehydration synthesis, where the carboxyl group of one amino acid reacts with the amino group of another, releasing water. This creates the backbone of proteins and determines their primary structure.'
            }
        ];
        
        // Add questions to the assessment
        if (!assessmentQuestions[week]) {
            assessmentQuestions[week] = [];
        }
        
        mockQuestions.forEach(question => {
            assessmentQuestions[week].push(question);
        });
        
        // Update the display
        displayAssessmentQuestions(week);
        
        showNotification(`${mockQuestions.length} AI assessment questions generated successfully!`, 'success');
        
    } catch (error) {
        console.error('Error generating AI questions:', error);
        showNotification('Failed to generate AI questions. Please try again.', 'error');
    }
}

/**
 * Display assessment questions
 */
function displayAssessmentQuestions(week) {
    const questionsContainer = document.getElementById(`assessment-questions-${week.toLowerCase()}`);
    
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
    
    // Clear container and add questions
    questionsContainer.innerHTML = '';
    
    questions.forEach((question, index) => {
        const questionElement = createQuestionElement(question, index + 1, week);
        questionsContainer.appendChild(questionElement);
    });
}

/**
 * Create question element
 */
function createQuestionElement(question, questionNumber, week) {
    const questionDiv = document.createElement('div');
    questionDiv.className = 'question-item';
    
    const typeBadgeClass = question.type === 'multiple-choice' ? 'multiple-choice' : 
                          question.type === 'true-false' ? 'true-false' : 'short-answer';
    
    let answerPreview = '';
    
    if (question.type === 'multiple-choice') {
        answerPreview = '<div class="mcq-preview">';
        question.options.forEach((option, index) => {
            const isCorrect = index === question.correctAnswer;
            answerPreview += `<div class="mcq-option-preview ${isCorrect ? 'correct' : ''}">${option}</div>`;
        });
        answerPreview += '</div>';
    } else if (question.type === 'true-false') {
        answerPreview = `<div class="answer-preview">Correct Answer: ${question.correctAnswer ? 'True' : 'False'}</div>`;
    } else {
        answerPreview = `<div class="answer-preview">Sample Answer: ${question.correctAnswer}</div>`;
    }
    
    questionDiv.innerHTML = `
        <div class="question-header">
            <span class="question-type-badge ${typeBadgeClass}">${question.type.replace('-', ' ')}</span>
            <span class="question-number">Question ${questionNumber}</span>
            <button class="delete-question-btn" onclick="deleteAssessmentQuestion('${week}', ${question.id})">×</button>
        </div>
        <div class="question-content">
            <div class="question-text">${question.question}</div>
            ${answerPreview}
        </div>
    `;
    
    return questionDiv;
}

/**
 * Delete assessment question
 */
function deleteAssessmentQuestion(week, questionId) {
    if (confirm('Are you sure you want to delete this question?')) {
        assessmentQuestions[week] = assessmentQuestions[week].filter(q => q.id !== questionId);
        displayAssessmentQuestions(week);
        showNotification('Question deleted successfully!', 'success');
    }
}

/**
 * Save assessment
 */
async function saveAssessment(week) {
    const questions = assessmentQuestions[week] || [];
    const thresholdInput = document.getElementById(`pass-threshold-${week.toLowerCase()}`);
    const threshold = thresholdInput ? parseInt(thresholdInput.value) : 2;
    
    if (questions.length === 0) {
        showNotification('Please add at least one assessment question before saving.', 'error');
        return;
    }
    
    try {
        // Simulate save delay
        await new Promise(resolve => setTimeout(resolve, 1000));
        
        showNotification(`Assessment saved for ${week}!\nTotal Questions: ${questions.length}\nPass Threshold: ${threshold}`, 'success');
        
    } catch (error) {
        console.error('Error saving assessment:', error);
        showNotification('Failed to save assessment. Please try again.', 'error');
    }
}

/**
 * Test the onboarding API to see if it's working
 */
async function testOnboardingAPI() {
    try {
        console.log('🧪 Testing onboarding API...');
        
        // Test the test endpoint
        const testResponse = await fetch('/api/onboarding/test');
        console.log('Test endpoint response status:', testResponse.status);
        
        if (testResponse.ok) {
            const testResult = await testResponse.json();
            console.log('Test endpoint result:', testResult);
            showNotification('✅ Onboarding API is working!', 'success');
        } else {
            console.error('Test endpoint failed:', testResponse.status);
            showNotification('❌ Onboarding API test failed', 'error');
        }
        
        // Test the main endpoint with a simple request
        const testData = {
            courseId: 'TEST-COURSE-' + Date.now(),
            courseName: 'Test Course',
            instructorId: 'instructor-123',
            courseDescription: 'Test course for API testing',
            learningOutcomes: ['Test objective 1', 'Test objective 2'],
            prerequisites: [],
            assessmentCriteria: 'Test criteria',
            courseMaterials: [],
            unitFiles: {
                'Unit 1': []
            },
            courseStructure: {
                weeks: 1,
                lecturesPerWeek: 1,
                totalUnits: 1
            }
        };
        
        console.log('Testing main endpoint with data:', testData);
        
        const mainResponse = await fetch('/api/onboarding', {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json',
            },
            body: JSON.stringify(testData)
        });
        
        console.log('Main endpoint response status:', mainResponse.status);
        
        if (mainResponse.ok) {
            const mainResult = await mainResponse.json();
            console.log('Main endpoint result:', mainResult);
            showNotification('✅ Onboarding API main endpoint is working!', 'success');
        } else {
            const errorText = await mainResponse.text();
            console.error('Main endpoint failed:', mainResponse.status, errorText);
            showNotification(`❌ Main endpoint failed: ${mainResponse.status}`, 'error');
        }
        
    } catch (error) {
        console.error('Error testing onboarding API:', error);
        showNotification(`❌ API test error: ${error.message}`, 'error');
    }
}

/**
 * Save onboarding data to database
 */
async function saveOnboardingData() {
    try {
        const courseId = onboardingState.createdCourseId;
        const instructorId = 'instructor-123';
        
        // Collect learning objectives
        const objectivesList = document.getElementById('objectives-list');
        const objectives = Array.from(objectivesList.querySelectorAll('.objective-display-item .objective-text'))
            .map(obj => obj.textContent.trim());
        
        // Collect unit files (materials uploaded during onboarding)
        const unitFiles = {};
        
        // Get lecture notes status and content
        const lectureStatus = document.getElementById('lecture-status');
        if (lectureStatus.textContent !== 'Not Uploaded') {
            unitFiles['Unit 1'] = [{
                name: 'Lecture Notes - Unit 1',
                type: 'lecture-notes',
                status: 'uploaded',
                uploadedAt: new Date().toISOString()
            }];
        }
        
        // Get practice questions status and content
        const practiceStatus = document.getElementById('practice-status');
        if (practiceStatus.textContent !== 'Not Uploaded') {
            if (!unitFiles['Unit 1']) {
                unitFiles['Unit 1'] = [];
            }
            unitFiles['Unit 1'].push({
                name: 'Practice Questions/Tutorial',
                type: 'practice-questions',
                status: 'uploaded',
                uploadedAt: new Date().toISOString()
            });
        }
        
        // Get additional materials
        const additionalMaterials = document.querySelectorAll('.additional-material-item');
        additionalMaterials.forEach(material => {
            const materialName = material.querySelector('.material-name').textContent;
            if (!unitFiles['Unit 1']) {
                unitFiles['Unit 1'] = [];
            }
            unitFiles['Unit 1'].push({
                name: materialName,
                type: 'additional',
                status: 'uploaded',
                uploadedAt: new Date().toISOString()
            });
        });
        
        // Prepare onboarding data
        const onboardingData = {
            courseId: courseId,
            courseName: onboardingState.courseData.course,
            instructorId: instructorId,
            learningOutcomes: objectives,
            unitFiles: unitFiles
        };
        
        // Update the onboarding data in the database
        const response = await fetch(`/api/onboarding/${courseId}`, {
            method: 'PUT',
            headers: {
                'Content-Type': 'application/json',
            },
            body: JSON.stringify(onboardingData)
        });
        
        if (!response.ok) {
            const errorText = await response.text();
            throw new Error(`Failed to save onboarding data: ${response.status} ${errorText}`);
        }
        
        console.log('Onboarding data saved successfully');
        
    } catch (error) {
        console.error('Error saving onboarding data:', error);
        throw error;
    }
}

/**
 * Complete Unit 1 setup
 */
async function completeUnit1Setup() {
    // Validate that required content has been set up
    const objectivesList = document.getElementById('objectives-list');
    const objectives = objectivesList.querySelectorAll('.objective-display-item');
    
    if (objectives.length === 0) {
        showNotification('Please add at least one learning objective before continuing.', 'error');
        return;
    }
    
    // Check if required materials are uploaded
    const lectureStatus = document.getElementById('lecture-status');
    const practiceStatus = document.getElementById('practice-status');
    
    if (lectureStatus.textContent === 'Not Uploaded' || practiceStatus.textContent === 'Not Uploaded') {
        showNotification('Please upload required materials (Lecture Notes and Practice Questions) before continuing.', 'error');
        return;
    }
    
    try {
        // Save onboarding data to database before redirecting
        await saveOnboardingData();
        
        // Show success message and redirect
        showNotification('Unit 1 setup completed successfully! Redirecting to course upload...', 'success');
        
        // Wait a moment for the notification to be seen, then redirect with course ID
        setTimeout(() => {
            window.location.href = `/instructor/index.html?courseId=${onboardingState.createdCourseId}`;
        }, 1500);
        
    } catch (error) {
        console.error('Error saving onboarding data:', error);
        showNotification('Error saving onboarding data. Please try again.', 'error');
    }
}

/**
 * Open upload modal
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
 * Close upload modal
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
        
        // Update status badge based on content type
        let statusBadge = null;
        let statusText = 'Uploaded';
        
        switch (currentContentType) {
            case 'lecture-notes':
                statusBadge = document.getElementById('lecture-status');
                break;
            case 'practice-quiz':
                statusBadge = document.getElementById('practice-status');
                break;
            case 'additional':
                statusBadge = document.getElementById('additional-status');
                statusText = 'Added';
                break;
        }
        
        if (statusBadge) {
            statusBadge.textContent = statusText;
            statusBadge.style.background = 'rgba(40, 167, 69, 0.1)';
            statusBadge.style.color = '#28a745';
        }
        
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