/**
 * Home Page JavaScript
 * Handles instructor dashboard functionality and interactions
 */

document.addEventListener('DOMContentLoaded', function() {
    // Wait for auth to be ready before initializing
    // This ensures getCurrentInstructorId() is available
    function tryInitialize() {
        if (typeof getCurrentInstructorId === 'function' && getCurrentInstructorId()) {
            initializeHomePage();
            return true;
        }
        return false;
    }
    
    // Try initializing immediately if auth is already ready
    if (!tryInitialize()) {
        // Wait for auth:ready event if auth hasn't loaded yet
        // Use a one-time listener
        const authReadyHandler = function() {
            if (tryInitialize()) {
                document.removeEventListener('auth:ready', authReadyHandler);
            }
        };
        document.addEventListener('auth:ready', authReadyHandler);
        
        // Fallback: try initializing after a short delay if event doesn't fire
        setTimeout(() => {
            if (tryInitialize()) {
                document.removeEventListener('auth:ready', authReadyHandler);
            }
        }, 500);
    }
});

/**
 * Initialize all home page functionality
 */
async function initializeHomePage() {
    console.log('Home page initialized');
    
    try {
        // Check onboarding status first - if not complete, show prompt and hide other content
        const isOnboardingComplete = await checkOnboardingStatus();
        
        if (!isOnboardingComplete) {
            // If onboarding is not complete, show prompt and hide other sections
            showOnboardingPrompt();
            return; // Exit early - don't load other content
        }
        
        // Onboarding is complete, hide prompt and show normal content
        hideOnboardingPrompt();
        
        // Load flagged content count
        await loadFlaggedContent();
        
        // Check for missing course content
        await checkMissingContent();
    } catch (error) {
        console.error('Error initializing home page:', error);
        showErrorMessage('Failed to load home page data');
    }
}

/**
 * Check if instructor has completed onboarding
 * @returns {Promise<boolean>} True if onboarding is complete, false otherwise
 */
async function checkOnboardingStatus() {
    try {
        const instructorId = getCurrentInstructorId();
        if (!instructorId) {
            console.log('No instructor ID found');
            return false;
        }
        
        console.log(`Checking onboarding status for instructor: ${instructorId}`);
        
        // Check if instructor has any courses with onboarding complete
        const response = await authenticatedFetch(`/api/onboarding/instructor/${instructorId}`);
        
        if (!response.ok) {
            console.error('Failed to fetch instructor courses');
            return false;
        }
        
        const result = await response.json();
        
        if (!result.success || !result.data || !result.data.courses) {
            console.log('No courses found for instructor');
            return false;
        }
        
        // Check if any course has onboarding complete
        const completedCourse = result.data.courses.find(course => course.isOnboardingComplete === true);
        
        if (completedCourse) {
            console.log('✅ Onboarding complete - found completed course:', completedCourse.courseId);
            return true;
        }
        
        console.log('⚠️ Onboarding not complete - no completed courses found');
        return false;
        
    } catch (error) {
        console.error('Error checking onboarding status:', error);
        return false; // Default to showing onboarding prompt on error
    }
}

/**
 * Show onboarding prompt and hide other content sections
 */
function showOnboardingPrompt() {
    const onboardingPrompt = document.getElementById('onboarding-prompt-section');
    const flaggedSection = document.querySelector('.flagged-section');
    const missingItemsSection = document.getElementById('missing-items-section');
    const completeSection = document.getElementById('complete-section');
    const disclaimerSection = document.querySelector('.disclaimer-section');
    
    // Show onboarding prompt
    if (onboardingPrompt) {
        onboardingPrompt.style.display = 'block';
    }
    
    // Hide other content sections
    if (flaggedSection) {
        flaggedSection.style.display = 'none';
    }
    if (missingItemsSection) {
        missingItemsSection.style.display = 'none';
    }
    if (completeSection) {
        completeSection.style.display = 'none';
    }
    if (disclaimerSection) {
        disclaimerSection.style.display = 'none';
    }
}

/**
 * Hide onboarding prompt and show normal content sections
 */
function hideOnboardingPrompt() {
    const onboardingPrompt = document.getElementById('onboarding-prompt-section');
    
    if (onboardingPrompt) {
        onboardingPrompt.style.display = 'none';
    }
    
    // Other sections will be shown/hidden by their own functions
}

/**
 * Load flagged content count for all instructor courses
 */
async function loadFlaggedContent() {
    try {
        // Get all courses for the instructor
        const coursesResponse = await fetch('/api/courses');
        if (!coursesResponse.ok) {
            throw new Error('Failed to fetch courses');
        }
        
        const coursesData = await coursesResponse.json();
        if (!coursesData.success || !coursesData.data) {
            console.log('No courses found');
            updateFlaggedCount(0);
            return;
        }
        
        const courses = coursesData.data;
        let totalPendingFlags = 0;
        
        // Get flags for each course
        for (const course of courses) {
            try {
                const flagsResponse = await fetch(`/api/flags/course/${course.id}?status=pending`);
                if (flagsResponse.ok) {
                    const flagsData = await flagsResponse.json();
                    if (flagsData.success && flagsData.data && flagsData.data.flags) {
                        totalPendingFlags += flagsData.data.flags.length;
                    }
                }
            } catch (error) {
                console.error(`Error fetching flags for course ${course.id}:`, error);
                // Continue with other courses
            }
        }
        
        updateFlaggedCount(totalPendingFlags);
    } catch (error) {
        console.error('Error loading flagged content:', error);
        updateFlaggedCount(0);
    }
}

/**
 * Update the flagged count display
 * @param {number} count - Number of pending flags
 */
function updateFlaggedCount(count) {
    const flagCountElement = document.getElementById('pending-flags-count');
    if (flagCountElement) {
        flagCountElement.textContent = count;
        
        // Add visual indicator if there are pending flags
        const flaggedSection = document.querySelector('.flagged-section');
        if (count > 0 && flaggedSection) {
            flaggedSection.classList.add('has-pending-flags');
        } else if (flaggedSection) {
            flaggedSection.classList.remove('has-pending-flags');
        }
    }
}

/**
 * Check for missing course content in all units
 */
async function checkMissingContent() {
    try {
        // Get all courses for the instructor
        const coursesResponse = await fetch('/api/courses');
        if (!coursesResponse.ok) {
            throw new Error('Failed to fetch courses');
        }
        
        const coursesData = await coursesResponse.json();
        if (!coursesData.success || !coursesData.data || coursesData.data.length === 0) {
            // No courses, hide both sections
            document.getElementById('missing-items-section')?.setAttribute('style', 'display: none;');
            document.getElementById('complete-section')?.setAttribute('style', 'display: none;');
            return;
        }
        
        const courses = coursesData.data;
        const missingItems = [];
        
        // Check each course for missing content
        for (const course of courses) {
            try {
                // Get detailed course data with lectures
                const courseDetailResponse = await fetch(`/api/courses/${course.id}`);
                if (!courseDetailResponse.ok) {
                    continue; // Skip this course if we can't get details
                }
                
                const courseDetailData = await courseDetailResponse.json();
                if (!courseDetailData.success || !courseDetailData.data || !courseDetailData.data.lectures) {
                    continue;
                }
                
                const lectures = courseDetailData.data.lectures;
                
                // Check each unit/lecture for missing items
                for (const lecture of lectures) {
                    const unitMissingItems = checkUnitMissingItems(course.id, course.name, lecture);
                    if (unitMissingItems.length > 0) {
                        missingItems.push(...unitMissingItems);
                    }
                }
            } catch (error) {
                console.error(`Error checking course ${course.id}:`, error);
                // Continue with other courses
            }
        }
        
        // Display results
        displayMissingItems(missingItems);
    } catch (error) {
        console.error('Error checking missing content:', error);
        // Hide both sections on error
        document.getElementById('missing-items-section')?.setAttribute('style', 'display: none;');
        document.getElementById('complete-section')?.setAttribute('style', 'display: none;');
    }
}

/**
 * Check a single unit for missing required items
 * @param {string} courseName - Name of the course
 * @param {Object} lecture - Lecture/unit object
 * @returns {Array} Array of missing item descriptions
 */
function checkUnitMissingItems(courseId, courseName, lecture) {
    const missingItems = [];
    const unitName = lecture.name || 'Unknown Unit';
    
    // Check for learning objectives
    const hasLearningObjectives = lecture.learningObjectives && 
                                   Array.isArray(lecture.learningObjectives) && 
                                   lecture.learningObjectives.length > 0;
    
    // Check for lecture notes: require at least one document tagged as lecture notes
    const hasLectureNotes = Array.isArray(lecture.documents) && lecture.documents.some(doc => {
        const t = (doc.documentType || '').toLowerCase();
        return t === 'lecture-notes' || t === 'lecture_notes' || t === 'notes';
    });
    
    // Check for practice questions: require at least one practice/tutorial document
    const hasPracticeDocs = Array.isArray(lecture.documents) && lecture.documents.some(doc => {
        const t = (doc.documentType || '').toLowerCase();
        return t === 'practice-quiz' || t === 'practice_q_tutorials' || t === 'practice' || t === 'tutorial';
    });
    const hasPracticeQuestions = hasPracticeDocs;
    
    // Build missing items list
    if (!hasLearningObjectives) {
        missingItems.push({ courseId, courseName, unitName, missingItem: 'Learning Objective' });
    }
    
    if (!hasLectureNotes) {
        missingItems.push({ courseId, courseName, unitName, missingItem: 'Lecture Note' });
    }
    
    if (!hasPracticeQuestions) {
        missingItems.push({ courseId, courseName, unitName, missingItem: 'Practice Question/Tutorial' });
    }
    
    return missingItems;
}

/**
 * Display missing items in the UI
 * @param {Array} missingItems - Array of missing item objects
 */
function displayMissingItems(missingItems) {
    const missingSection = document.getElementById('missing-items-section');
    const completeSection = document.getElementById('complete-section');
    const missingList = document.getElementById('missing-items-list');
    
    if (!missingSection || !completeSection || !missingList) {
        return;
    }
    
    if (missingItems.length === 0) {
        // All units are complete
        missingSection.setAttribute('style', 'display: none;');
        completeSection.setAttribute('style', 'display: block;');
    } else {
        // Show missing items
        missingSection.setAttribute('style', 'display: block;');
        completeSection.setAttribute('style', 'display: none;');
        
        // Clear existing list
        missingList.innerHTML = '';
        
        // Group missing items by course and unit
        const groupedItems = {};
        missingItems.forEach(item => {
            const key = `${item.courseName}|${item.unitName}`;
            if (!groupedItems[key]) {
                groupedItems[key] = {
                    courseId: item.courseId,
                    courseName: item.courseName,
                    unitName: item.unitName,
                    missingItems: []
                };
            }
            groupedItems[key].missingItems.push(item.missingItem);
        });
        
        // Create list items
        Object.values(groupedItems).forEach(group => {
            const listItem = document.createElement('div');
            listItem.className = 'missing-item';
            
            const missingItemsText = group.missingItems.join(', ');
            listItem.innerHTML = `
                <div class="missing-item-header">
                    <span class="missing-item-course">${escapeHtml(group.courseName)}</span>
                    <span class="missing-item-unit">${escapeHtml(group.unitName)}</span>
                </div>
                <div class="missing-item-details">
                    Missing: ${escapeHtml(missingItemsText)}
                </div>
                <div class="missing-item-actions">
                    <a class="action-btn primary" href="/instructor/documents?courseId=${encodeURIComponent(group.courseId)}&unit=${encodeURIComponent(group.unitName)}">Go to this unit</a>
                </div>
            `;
            
            missingList.appendChild(listItem);
        });
    }
}

/**
 * Escape HTML to prevent XSS
 * @param {string} text - Text to escape
 * @returns {string} Escaped HTML
 */
function escapeHtml(text) {
    const div = document.createElement('div');
    div.textContent = text;
    return div.innerHTML;
}

/**
 * Show info message
 * @param {string} message - Info message
 */
function showInfoMessage(message) {
    // Create notification element
    const notification = document.createElement('div');
    notification.className = 'notification info';
    notification.innerHTML = `
        <span>${message}</span>
        <button class="notification-close" onclick="this.parentElement.remove()">×</button>
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
 * Show error message
 * @param {string} message - Error message
 */
function showErrorMessage(message) {
    // Create notification element
    const notification = document.createElement('div');
    notification.className = 'notification error';
    notification.innerHTML = `
        <span>${message}</span>
        <button class="notification-close" onclick="this.parentElement.remove()">×</button>
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
 * Show success message
 * @param {string} message - Success message
 */
function showSuccessMessage(message) {
    // Create notification element
    const notification = document.createElement('div');
    notification.className = 'notification success';
    notification.innerHTML = `
        <span>${message}</span>
        <button class="notification-close" onclick="this.parentElement.remove()">×</button>
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