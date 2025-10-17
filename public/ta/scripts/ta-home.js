/**
 * TA Home Page JavaScript
 * Handles the TA dashboard functionality
 */

let taCourses = [];

document.addEventListener('DOMContentLoaded', async function() {
    // Wait for authentication to be ready
    await waitForAuth();
    
    // Load TA courses
    await loadTACourses();
    
    // Initialize dashboard
    initializeDashboard();
});

/**
 * Initialize dashboard functionality
 */
function initializeDashboard() {
    // Any additional dashboard initialization can go here
    console.log('TA Dashboard initialized');
}

/**
 * Load courses for the TA
 */
async function loadTACourses() {
    try {
        const taId = getCurrentInstructorId(); // Using same function for user ID
        if (!taId) {
            console.error('No TA ID found. User not authenticated.');
            return;
        }
        
        console.log(`Loading courses for TA: ${taId}`);
        
        // Fetch courses for this TA
        const response = await authenticatedFetch(`/api/courses/ta/${taId}`);
        
        if (!response.ok) {
            throw new Error(`HTTP error! status: ${response.status}`);
        }
        
        const result = await response.json();
        
        if (!result.success) {
            throw new Error(result.message || 'Failed to fetch TA courses');
        }
        
        taCourses = result.data || [];
        console.log('TA courses loaded:', taCourses);
        
        // Display courses
        displayTACourses();
        
    } catch (error) {
        console.error('Error loading TA courses:', error);
        showNotification('Error loading courses. Please try again.', 'error');
    }
}

/**
 * Display TA courses on the dashboard
 */
function displayTACourses() {
    const coursesContainer = document.getElementById('courses-container');
    
    if (!coursesContainer) {
        console.error('Courses container not found');
        return;
    }
    
    if (taCourses.length === 0) {
        coursesContainer.innerHTML = `
            <div class="no-courses-message">
                <h3>No courses assigned</h3>
                <p>You haven't been assigned to any courses yet. Contact an instructor to be added to a course.</p>
                <a href="/ta/onboarding" class="btn-primary">Join a Course</a>
            </div>
        `;
        return;
    }
    
    // Create course cards
    coursesContainer.innerHTML = taCourses.map(course => `
        <div class="course-card">
            <div class="course-header">
                <h3>${course.courseName}</h3>
                <span class="course-status">Active</span>
            </div>
            <div class="course-info">
                <p><strong>Course ID:</strong> ${course.courseId}</p>
                <p><strong>Instructor:</strong> ${course.instructorId}</p>
                <p><strong>Units:</strong> ${course.totalUnits || 0}</p>
            </div>
            <div class="course-actions">
                <a href="/instructor/documents?courseId=${course.courseId}" class="btn-secondary">View Course</a>
                <a href="/instructor/flagged?courseId=${course.courseId}" class="btn-primary">Student Support</a>
            </div>
        </div>
    `).join('');
}

/**
 * Wait for authentication to be initialized
 * @returns {Promise<void>}
 */
async function waitForAuth() {
    // Wait for auth.js to initialize
    let attempts = 0;
    const maxAttempts = 50; // 5 seconds max wait
    
    while (attempts < maxAttempts) {
        if (typeof getCurrentInstructorId === 'function' && getCurrentInstructorId()) {
            console.log('✅ [AUTH] TA Authentication ready');
            return;
        }
        
        // Wait 100ms before next attempt
        await new Promise(resolve => setTimeout(resolve, 100));
        attempts++;
    }
    
    console.warn('⚠️ [AUTH] TA Authentication not ready after 5 seconds, proceeding anyway');
}

/**
 * Show notification to user
 */
function showNotification(message, type) {
    // Create notification element
    const notification = document.createElement('div');
    notification.className = `notification ${type}`;
    notification.innerHTML = `
        <span>${message}</span>
        <button class="notification-close">×</button>
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
        ${type === 'success' ? 'background-color: #28a745;' : 'background-color: #dc3545;'}
    `;
    
    // Add event listener for close button
    const closeButton = notification.querySelector('.notification-close');
    if (closeButton) {
        closeButton.addEventListener('click', () => {
            notification.remove();
        });
    }
    
    // Add to page
    document.body.appendChild(notification);
    
    // Auto-remove after 5 seconds
    setTimeout(() => {
        if (notification.parentElement) {
            notification.remove();
        }
    }, 5000);
}
