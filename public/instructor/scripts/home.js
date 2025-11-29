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
        
        // Initialize course selection functionality (this will load current course and data)
        await initializeCourseSelection();
        
        // Statistics, flagged content, and missing content are loaded 
        // inside setSelectedCourse() after course is set
        // Only load them here if no course was selected (fallback)
        const selectedCourseId = getSelectedCourseId();
        if (!selectedCourseId) {
            // No course selected, try to load data for all courses
            await loadStatistics();
            await loadFlaggedContent();
            await checkMissingContent();
        }
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
 * Load statistics for all instructor courses
 */
async function loadStatistics() {
    try {
        const courseId = getSelectedCourseId();
        let url = '/api/courses/statistics';
        
        // If a course is selected, filter by course ID
        if (courseId) {
            url += `?courseId=${encodeURIComponent(courseId)}`;
        }
        
        const response = await fetch(url, {
            credentials: 'include'
        });
        
        if (!response.ok) {
            throw new Error('Failed to fetch statistics');
        }
        
        const result = await response.json();
        
        if (!result.success || !result.data) {
            console.log('No statistics data available');
            return;
        }
        
        const stats = result.data;
        
        // Update statistics display
        updateStatisticsDisplay(stats);
        
    } catch (error) {
        console.error('Error loading statistics:', error);
        // Don't show error to user, just hide the section
        document.getElementById('statistics-section')?.setAttribute('style', 'display: none;');
    }
}

/**
 * Update the statistics display with fetched data
 * @param {Object} stats - Statistics data object
 */
function updateStatisticsDisplay(stats) {
    const statisticsSection = document.getElementById('statistics-section');
    if (!statisticsSection) {
        return;
    }
    
    // Show the section if we have data
    if (stats.totalSessions > 0) {
        statisticsSection.setAttribute('style', 'display: block;');
    } else {
        statisticsSection.setAttribute('style', 'display: none;');
        return;
    }
    
    // Update stat values
    const totalStudentsEl = document.getElementById('stat-total-students');
    const totalSessionsEl = document.getElementById('stat-total-sessions');
    const avgSessionLengthEl = document.getElementById('stat-avg-session-length');
    const avgMessageLengthEl = document.getElementById('stat-avg-message-length');
    
    if (totalStudentsEl) totalStudentsEl.textContent = stats.totalStudents || 0;
    if (totalSessionsEl) totalSessionsEl.textContent = stats.totalSessions || 0;
    if (avgSessionLengthEl) avgSessionLengthEl.textContent = stats.averageSessionLength || '0s';
    if (avgMessageLengthEl) avgMessageLengthEl.textContent = stats.averageMessageLength || 0;
    
    // Update mode distribution
    const tutorCount = stats.modeDistribution?.tutor || 0;
    const protegeCount = stats.modeDistribution?.protege || 0;
    const totalModes = tutorCount + protegeCount;
    
    const tutorCountEl = document.getElementById('tutor-count');
    const protegeCountEl = document.getElementById('protege-count');
    const tutorBarEl = document.getElementById('tutor-bar');
    const protegeBarEl = document.getElementById('protege-bar');
    
    if (tutorCountEl) tutorCountEl.textContent = tutorCount;
    if (protegeCountEl) protegeCountEl.textContent = protegeCount;
    
    if (totalModes > 0) {
        const tutorPercentage = Math.round((tutorCount / totalModes) * 100);
        const protegePercentage = Math.round((protegeCount / totalModes) * 100);
        
        if (tutorBarEl) tutorBarEl.style.width = `${tutorPercentage}%`;
        if (protegeBarEl) protegeBarEl.style.width = `${protegePercentage}%`;
    } else {
        if (tutorBarEl) tutorBarEl.style.width = '0%';
        if (protegeBarEl) protegeBarEl.style.width = '0%';
    }
}

/**
 * Load flagged content count for all instructor courses
 */
async function loadFlaggedContent() {
    try {
        const courseId = getSelectedCourseId();
        
        // If a course is selected, only get flags for that course
        if (courseId) {
            try {
                const flagsResponse = await fetch(`/api/flags/course/${courseId}?status=pending`, {
                    credentials: 'include'
                });
                if (flagsResponse.ok) {
                    const flagsData = await flagsResponse.json();
                    if (flagsData.success && flagsData.data && flagsData.data.flags) {
                        updateFlaggedCount(flagsData.data.flags.length);
                        return;
                    }
                }
            } catch (error) {
                console.error(`Error fetching flags for course ${courseId}:`, error);
            }
            updateFlaggedCount(0);
            return;
        }
        
        // Otherwise, get flags for all courses
        const coursesResponse = await fetch('/api/courses', {
            credentials: 'include'
        });
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
                const flagsResponse = await fetch(`/api/flags/course/${course.id}?status=pending`, {
                    credentials: 'include'
                });
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
        const courseId = getSelectedCourseId();
        
        // If a course is selected, only check that course
        if (courseId) {
            try {
                const courseDetailResponse = await fetch(`/api/courses/${courseId}`, {
                    credentials: 'include'
                });
                if (!courseDetailResponse.ok) {
                    // Course not found or not accessible
                    document.getElementById('missing-items-section')?.setAttribute('style', 'display: none;');
                    document.getElementById('complete-section')?.setAttribute('style', 'display: none;');
                    return;
                }
                
                const courseDetailData = await courseDetailResponse.json();
                if (!courseDetailData.success || !courseDetailData.data || !courseDetailData.data.lectures) {
                    document.getElementById('missing-items-section')?.setAttribute('style', 'display: none;');
                    document.getElementById('complete-section')?.setAttribute('style', 'display: none;');
                    return;
                }
                
                const course = courseDetailData.data;
                const lectures = course.lectures;
                const missingItems = [];
                
                // Check each unit/lecture for missing items
                for (const lecture of lectures) {
                    const unitMissingItems = checkUnitMissingItems(courseId, course.courseName || courseId, lecture);
                    if (unitMissingItems.length > 0) {
                        missingItems.push(...unitMissingItems);
                    }
                }
                
                // Display results
                displayMissingItems(missingItems);
                return;
            } catch (error) {
                console.error(`Error checking course ${courseId}:`, error);
                document.getElementById('missing-items-section')?.setAttribute('style', 'display: none;');
                document.getElementById('complete-section')?.setAttribute('style', 'display: none;');
                return;
            }
        }
        
        // Otherwise, check all courses
        const coursesResponse = await fetch('/api/courses', {
            credentials: 'include'
        });
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
                const courseDetailResponse = await fetch(`/api/courses/${course.id}`, {
                    credentials: 'include'
                });
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

/**
 * Initialize course selection functionality
 */
async function initializeCourseSelection() {
    // Set up event listeners
    const changeCourseBtn = document.getElementById('change-course-btn');
    const cancelCourseSelectBtn = document.getElementById('cancel-course-select-btn');
    const joinCourseBtn = document.getElementById('join-course-btn');
    const courseSelectDropdown = document.getElementById('course-select-dropdown');
    
    if (changeCourseBtn) {
        changeCourseBtn.addEventListener('click', showCourseSelector);
    }
    
    if (cancelCourseSelectBtn) {
        cancelCourseSelectBtn.addEventListener('click', hideCourseSelector);
    }
    
    if (joinCourseBtn) {
        joinCourseBtn.addEventListener('click', handleJoinCourse);
    }
    
    if (courseSelectDropdown) {
        courseSelectDropdown.addEventListener('change', handleCourseSelectionChange);
    }
    
    // Load available courses
    await loadAvailableCourses();
    
    // Load and display current course
    await loadCurrentCourse();
    
    // Update navigation links to include course ID
    updateNavigationLinks();
}

/**
 * Load available courses for selection
 */
async function loadAvailableCourses() {
    try {
        const courseSelectDropdown = document.getElementById('course-select-dropdown');
        if (!courseSelectDropdown) return;
        
        // Fetch courses from the API
        const response = await fetch('/api/courses/available/all', {
            credentials: 'include'
        });
        
        if (!response.ok) {
            throw new Error(`HTTP error! status: ${response.status}`);
        }
        
        const result = await response.json();
        
        if (!result.success) {
            throw new Error(result.message || 'Failed to fetch courses');
        }
        
        const courses = result.data || [];
        
        // Filter out duplicate courses by courseId
        const uniqueCourses = courses.filter((course, index, self) => 
            index === self.findIndex(c => c.courseId === course.courseId)
        );
        
        // Clear existing options except the first placeholder
        courseSelectDropdown.innerHTML = '<option value="">Choose a course...</option>';
        
        // Add course options
        uniqueCourses.forEach(course => {
            const option = document.createElement('option');
            option.value = course.courseId;
            option.textContent = course.courseName;
            courseSelectDropdown.appendChild(option);
        });
        
        console.log('Available courses loaded:', uniqueCourses.length);
        
    } catch (error) {
        console.error('Error loading available courses:', error);
        // Keep the placeholder option if API fails
        const courseSelectDropdown = document.getElementById('course-select-dropdown');
        if (courseSelectDropdown) {
            courseSelectDropdown.innerHTML = '<option value="">Error loading courses</option>';
        }
    }
}

/**
 * Load and display the current selected course
 */
async function loadCurrentCourse() {
    try {
        // Get course ID from localStorage or URL params
        const urlParams = new URLSearchParams(window.location.search);
        const courseIdFromUrl = urlParams.get('courseId');
        const courseIdFromStorage = localStorage.getItem('selectedCourseId');
        const courseId = courseIdFromUrl || courseIdFromStorage;
        
        if (!courseId) {
            // Try to get the first course from instructor's courses
            const instructorId = getCurrentInstructorId();
            if (instructorId) {
                const response = await authenticatedFetch(`/api/onboarding/instructor/${instructorId}`);
                if (response.ok) {
                    const result = await response.json();
                    if (result.data && result.data.courses && result.data.courses.length > 0) {
                        const firstCourse = result.data.courses[0];
                        await setSelectedCourse(firstCourse.courseId, firstCourse.courseName);
                        return;
                    }
                }
            }
            
            // No course found, show course selector
            showCourseSelector();
            return;
        }
        
        // Fetch course details
        const response = await authenticatedFetch(`/api/courses/${courseId}`);
        if (response.ok) {
            const result = await response.json();
            if (result.success && result.data) {
                await setSelectedCourse(courseId, result.data.courseName || courseId);
            } else {
                // Course not found, clear selection
                clearSelectedCourse();
                showCourseSelector();
            }
        } else {
            // Course not accessible, clear selection
            clearSelectedCourse();
            showCourseSelector();
        }
        
    } catch (error) {
        console.error('Error loading current course:', error);
        showCourseSelector();
    }
}

/**
 * Set the selected course and update UI
 * @param {string} courseId - Course ID to set
 * @param {string} courseName - Course name to display
 */
async function setSelectedCourse(courseId, courseName) {
    // Store in localStorage
    localStorage.setItem('selectedCourseId', courseId);
    
    // Update URL if not already set
    const urlParams = new URLSearchParams(window.location.search);
    if (urlParams.get('courseId') !== courseId) {
        urlParams.set('courseId', courseId);
        window.history.replaceState({}, '', `${window.location.pathname}?${urlParams.toString()}`);
    }
    
    // Update UI
    const courseNameDisplay = document.getElementById('course-name-display');
    if (courseNameDisplay) {
        courseNameDisplay.textContent = courseName || courseId;
    }

    // Update Course Code display
    const courseCodeLabel = document.querySelector('.course-code-label');
    const courseCodeDisplay = document.getElementById('course-code-display');
    
    if (courseCodeDisplay && courseCodeLabel) {
        // We need to fetch the course details to get the code if we don't have it
        // Usually setSelectedCourse is called after fetching details, but let's be safe
        try {
            const response = await authenticatedFetch(`/api/courses/${courseId}`);
            if (response.ok) {
                const result = await response.json();
                if (result.success && result.data && result.data.courseCode) {
                    courseCodeDisplay.textContent = result.data.courseCode;
                    courseCodeDisplay.style.display = 'inline-block';
                    courseCodeLabel.style.display = 'inline-block';
                } else {
                    courseCodeDisplay.style.display = 'none';
                    courseCodeLabel.style.display = 'none';
                }
            }
        } catch (e) {
            console.error('Error fetching course code:', e);
            courseCodeDisplay.style.display = 'none';
            courseCodeLabel.style.display = 'none';
        }
    }
    
    // Show course selection container
    const courseSelectionContainer = document.getElementById('course-selection-container');
    if (courseSelectionContainer) {
        courseSelectionContainer.style.display = 'block';
    }
    
    // Hide course selector, show current course display
    hideCourseSelector();
    
    // Update course context in auth system
    if (typeof setCurrentCourseId === 'function') {
        await setCurrentCourseId(courseId);
    }
    
    // Update navigation links
    updateNavigationLinks();
    
    // Clear any cached course data
    if (typeof courseIdCache !== 'undefined') {
        courseIdCache = null;
    }
    
    // Reload page data with new course
    await loadStatistics();
    await loadFlaggedContent();
    await checkMissingContent();
}

/**
 * Clear the selected course
 */
function clearSelectedCourse() {
    localStorage.removeItem('selectedCourseId');
    const urlParams = new URLSearchParams(window.location.search);
    urlParams.delete('courseId');
    window.history.replaceState({}, '', window.location.pathname);
}

/**
 * Show the course selector UI
 */
function showCourseSelector() {
    const currentCourseDisplay = document.querySelector('.current-course-display');
    const courseSelector = document.getElementById('course-selector');
    const selectedCourseDetails = document.getElementById('selected-course-details');
    const joinCourseBtn = document.getElementById('join-course-btn');
    
    if (currentCourseDisplay) {
        currentCourseDisplay.style.display = 'none';
    }
    
    if (courseSelector) {
        courseSelector.style.display = 'flex';
    }
    
    if (selectedCourseDetails) {
        selectedCourseDetails.style.display = 'none';
    }
    
    if (joinCourseBtn) {
        joinCourseBtn.style.display = 'none';
    }
}

/**
 * Hide the course selector UI
 */
function hideCourseSelector() {
    const currentCourseDisplay = document.querySelector('.current-course-display');
    const courseSelector = document.getElementById('course-selector');
    const selectedCourseDetails = document.getElementById('selected-course-details');
    const joinCourseBtn = document.getElementById('join-course-btn');
    const courseSelectDropdown = document.getElementById('course-select-dropdown');
    
    if (currentCourseDisplay) {
        currentCourseDisplay.style.display = 'flex';
    }
    
    if (courseSelector) {
        courseSelector.style.display = 'none';
    }
    
    if (selectedCourseDetails) {
        selectedCourseDetails.style.display = 'none';
    }
    
    if (joinCourseBtn) {
        joinCourseBtn.style.display = 'none';
    }
    
    if (courseSelectDropdown) {
        courseSelectDropdown.value = '';
    }
}

/**
 * Handle course selection dropdown change
 */
function handleCourseSelectionChange(event) {
    const courseId = event.target.value;
    const selectedCourseDetails = document.getElementById('selected-course-details');
    const joinCourseBtn = document.getElementById('join-course-btn');
    const selectedCourseName = document.getElementById('selected-course-name');
    const selectedCourseId = document.getElementById('selected-course-id');
    
    if (!courseId) {
        if (selectedCourseDetails) {
            selectedCourseDetails.style.display = 'none';
        }
        if (joinCourseBtn) {
            joinCourseBtn.style.display = 'none';
        }
        return;
    }
    
    // Get course name from dropdown
    const selectedOption = event.target.options[event.target.selectedIndex];
    const courseName = selectedOption.textContent;
    
    // Show course details
    if (selectedCourseDetails) {
        selectedCourseDetails.style.display = 'block';
    }
    
    if (selectedCourseName) {
        selectedCourseName.textContent = courseName;
    }
    
    if (selectedCourseId) {
        selectedCourseId.textContent = courseId;
    }
    
    if (joinCourseBtn) {
        joinCourseBtn.style.display = 'inline-block';
    }
    
    // Store selected course ID for joining
    joinCourseBtn.dataset.courseId = courseId;
    joinCourseBtn.dataset.courseName = courseName;
}

/**
 * Handle joining a course
 */
async function handleJoinCourse() {
    const joinCourseBtn = document.getElementById('join-course-btn');
    if (!joinCourseBtn) return;
    
    const courseId = joinCourseBtn.dataset.courseId;
    const courseName = joinCourseBtn.dataset.courseName;
    
    if (!courseId) {
        showErrorMessage('No course selected');
        return;
    }
    
    try {
        // Show loading state
        const originalText = joinCourseBtn.textContent;
        joinCourseBtn.textContent = 'Joining Course...';
        joinCourseBtn.disabled = true;
        
        const instructorId = getCurrentInstructorId();
        if (!instructorId) {
            throw new Error('No instructor ID found. User not authenticated.');
        }
        
        // Call the join course API
        const response = await fetch(`/api/courses/${courseId}/instructors`, {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json',
            },
            credentials: 'include',
            body: JSON.stringify({
                instructorId: instructorId
            })
        });
        
        if (!response.ok) {
            const errorData = await response.json();
            throw new Error(errorData.message || 'Failed to join course');
        }
        
        const result = await response.json();
        console.log('Successfully joined course:', result);
        
        // Mark instructor's onboarding as complete since they joined an existing course
        if (typeof markInstructorOnboardingComplete === 'function') {
            await markInstructorOnboardingComplete(courseId);
        } else {
            // Fallback: call the API directly
            try {
                await authenticatedFetch('/api/onboarding/complete', {
                    method: 'POST',
                    headers: {
                        'Content-Type': 'application/json',
                    },
                    body: JSON.stringify({
                        courseId: courseId,
                        instructorId: instructorId
                    })
                });
            } catch (error) {
                console.warn('Failed to mark onboarding as complete:', error);
            }
        }
        
        // Set the selected course
        await setSelectedCourse(courseId, courseName);
        
        // Show success message
        showSuccessMessage('Successfully joined the course!');
        
        // Reload page data
        await loadStatistics();
        await loadFlaggedContent();
        await checkMissingContent();
        
    } catch (error) {
        console.error('Error joining course:', error);
        showErrorMessage(`Error joining course: ${error.message}`);
        
        // Reset button state
        if (joinCourseBtn) {
            joinCourseBtn.textContent = 'Join Course';
            joinCourseBtn.disabled = false;
        }
    }
}

/**
 * Get the currently selected course ID
 * @returns {string|null} Current course ID or null
 */
function getSelectedCourseId() {
    const urlParams = new URLSearchParams(window.location.search);
    const courseIdFromUrl = urlParams.get('courseId');
    const courseIdFromStorage = localStorage.getItem('selectedCourseId');
    return courseIdFromUrl || courseIdFromStorage || null;
}

/**
 * Update navigation links to include course ID
 */
function updateNavigationLinks() {
    const courseId = getSelectedCourseId();
    if (!courseId) return;
    
    // List of navigation link IDs and their base paths
    const navLinks = {
        'nav-home': '/instructor/home',
        'nav-documents': '/instructor/documents',
        'nav-onboarding': '/instructor/onboarding',
        'nav-flagged': '/instructor/flagged',
        'nav-student-hub': '/instructor/student-hub',
        'nav-downloads': '/instructor/downloads',
        'nav-ta-hub': '/instructor/ta-hub',
        'nav-settings': '/instructor/settings'
    };
    
    // Update each navigation link
    Object.keys(navLinks).forEach(linkId => {
        const link = document.getElementById(linkId);
        if (link) {
            const basePath = navLinks[linkId];
            const url = new URL(basePath, window.location.origin);
            url.searchParams.set('courseId', courseId);
            link.href = url.pathname + url.search;
        }
    });
    
    // Also update the "View Flagged Questions" button
    const viewFlagsBtn = document.getElementById('view-flags-btn');
    if (viewFlagsBtn) {
        const url = new URL('/instructor/flagged', window.location.origin);
        url.searchParams.set('courseId', courseId);
        viewFlagsBtn.href = url.pathname + url.search;
    }
} 