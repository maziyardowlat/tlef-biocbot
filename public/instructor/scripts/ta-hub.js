/**
 * TA Hub JavaScript
 * Handles Teaching Assistant management functionality
 */

let currentTAs = [];
let instructorCourses = [];
let taToRemove = null;

document.addEventListener('DOMContentLoaded', async function() {
    // Wait for authentication to be ready
    await waitForAuth();
    
    // Initialize TA Hub functionality
    initializeTAHub();
    
    // Load instructor courses
    await loadInstructorCourses();
    
    // Load current TAs
    await loadCurrentTAs();
});

/**
 * Initialize TA Hub functionality
 */
function initializeTAHub() {
    // Initialize form handlers
    initializeFormHandlers();
    
    // Initialize modal handlers
    initializeModalHandlers();
    
    // Hide onboarding tab for TAs
    hideOnboardingTabForTAs();
}

/**
 * Initialize form event handlers
 */
function initializeFormHandlers() {
    // No form handlers needed for view-only TA Hub
}

/**
 * Initialize modal event handlers
 */
function initializeModalHandlers() {
    // Remove TA modal handlers
    const confirmRemoveBtn = document.getElementById('confirm-remove-ta');
    if (confirmRemoveBtn) {
        confirmRemoveBtn.addEventListener('click', handleRemoveTA);
    }
    
    // Close modal when clicking outside
    const modal = document.getElementById('remove-ta-modal');
    if (modal) {
        modal.addEventListener('click', (e) => {
            if (e.target === modal) {
                closeRemoveTAModal();
            }
        });
    }
}

// Removed TA creation functions - TA Hub is now view-only

/**
 * Hide onboarding tab on TA Hub page (for all users)
 */
function hideOnboardingTabForTAs() {
    // Hide onboarding tab for all users on TA Hub page since TAs don't go through onboarding
    const onboardingTab = document.querySelector('nav.main-nav ul li a[href="/instructor/onboarding"]');
    if (onboardingTab) {
        // Hide the entire list item containing the onboarding link
        const onboardingListItem = onboardingTab.parentElement;
        if (onboardingListItem) {
            onboardingListItem.style.display = 'none';
            console.log('✅ [TA_HUB] Hidden onboarding tab on TA Hub page');
        }
    }
}

/**
 * Load instructor courses
 */
async function loadInstructorCourses() {
    try {
        const instructorId = getCurrentInstructorId();
        if (!instructorId) {
            console.error('No instructor ID found. User not authenticated.');
            return;
        }
        
        const response = await authenticatedFetch(`/api/onboarding/instructor/${instructorId}`);
        
        if (!response.ok) {
            throw new Error(`HTTP error! status: ${response.status}`);
        }
        
        const result = await response.json();
        instructorCourses = result.data?.courses || [];
        
        // Populate course select
        const courseSelect = document.getElementById('ta-course-select');
        if (courseSelect) {
            courseSelect.innerHTML = '<option value="">Select a course...</option>';
            instructorCourses.forEach(course => {
                const option = document.createElement('option');
                option.value = course.courseId;
                option.textContent = course.courseName;
                courseSelect.appendChild(option);
            });
        }
        
        console.log('Instructor courses loaded:', instructorCourses);
        
    } catch (error) {
        console.error('Error loading instructor courses:', error);
        showNotification('Error loading courses. Please try again.', 'error');
    }
}

/**
 * Load current TAs assigned to instructor's courses
 */
async function loadCurrentTAs() {
    try {
        // Check authentication status (avoid calling undefined helpers)
        console.log('Current user:', currentUser);
        console.log('Role:', currentUser && currentUser.role);
        
        // Get TAs assigned to instructor's courses
        const instructorId = getCurrentInstructorId();
        if (!instructorId) {
            console.error('No instructor ID found');
            return;
        }
        
        // Get instructor's courses first
        const coursesResponse = await authenticatedFetch(`/api/onboarding/instructor/${instructorId}`);
        if (!coursesResponse.ok) {
            throw new Error(`Failed to fetch instructor courses: ${coursesResponse.status}`);
        }
        
        const coursesResult = await coursesResponse.json();
        const courses = coursesResult.data?.courses || [];
        
        if (courses.length === 0) {
            console.log('No courses found for instructor');
            currentTAs = [];
            displayTAs();
            displayCourseTAs();
            return;
        }
        
        // Get all TAs first, then filter by those assigned to courses
        const allTAsResponse = await authenticatedFetch('/api/auth/tas');
        if (!allTAsResponse.ok) {
            throw new Error(`Failed to fetch all TAs: ${allTAsResponse.status}`);
        }
        
        const allTAsResult = await allTAsResponse.json();
        const allTAsData = allTAsResult.data || [];
        console.log('All TAs in system:', allTAsData);
        
        // Collect TAs assigned to instructor's courses
        const assignedTAs = new Map();
        
        for (const course of courses) {
            console.log(`Course ${course.courseName} (${course.courseId}):`, course.tas);
            if (course.tas && course.tas.length > 0) {
                for (const taId of course.tas) {
                    console.log(`Looking for TA: ${taId}`);
                    // Find this TA in the all TAs data
                    const taData = allTAsData.find(ta => ta.userId === taId);
                    if (taData) {
                        console.log(`Found TA data for ${taId}:`, taData);
                        assignedTAs.set(taId, {
                            ...taData,
                            courseName: course.courseName,
                            courseId: course.courseId
                        });
                    } else {
                        console.log(`TA ${taId} not found in all TAs data`);
                    }
                }
            } else {
                console.log(`Course ${course.courseName} has no TAs`);
            }
        }
        
        currentTAs = Array.from(assignedTAs.values());
        console.log('TAs assigned to instructor courses:', currentTAs);
        
        // Display TAs
        displayTAs();
        
        // Display course TA assignments
        displayCourseTAs();
        
    } catch (error) {
        console.error('Error loading TAs:', error);
        showNotification('Error loading TAs. Please try again.', 'error');
    }
}

/**
 * Display TAs in the grid
 */
function displayTAs() {
    const tasContainer = document.getElementById('tas-container');
    
    if (!tasContainer) {
        console.error('TAs container not found');
        return;
    }
    
    if (currentTAs.length === 0) {
        tasContainer.innerHTML = `
            <div class="no-tas-message">
                <h3>No Teaching Assistants</h3>
                <p>Create TA accounts to get started with course management.</p>
            </div>
        `;
        return;
    }
    
    // Create TA cards
    tasContainer.innerHTML = currentTAs.map(ta => `
        <div class="ta-card">
            <div class="ta-header">
                <h3 class="ta-name">${ta.displayName}</h3>
                <span class="ta-role">TA</span>
            </div>
            <div class="ta-info">
                <p><strong>Username:</strong> ${ta.username}</p>
                <p><strong>Email:</strong> ${ta.email || 'Not provided'}</p>
                <p><strong>Course:</strong> ${ta.courseName || 'Unknown'}</p>
                <p><strong>Joined:</strong> ${new Date(ta.createdAt).toLocaleDateString()}</p>
            </div>
            <div class="ta-actions">
                <button class="btn-small btn-secondary" onclick="viewTADetails('${ta.userId}')">View Details</button>
                <button class="btn-small btn-danger" onclick="openRemoveTAModal('${ta.userId}', '${ta.displayName}')">Remove</button>
            </div>
        </div>
    `).join('');
}

/**
 * Display course TA assignments
 */
function displayCourseTAs() {
    const courseTAsContainer = document.getElementById('course-tas-container');
    
    if (!courseTAsContainer) {
        console.error('Course TAs container not found');
        return;
    }
    
    if (instructorCourses.length === 0) {
        courseTAsContainer.innerHTML = '<p>No courses available.</p>';
        return;
    }
    
    // For now, show a simple list
    // In a real implementation, this would show which TAs are assigned to which courses
    courseTAsContainer.innerHTML = instructorCourses.map(course => `
        <div class="course-ta-item">
            <div class="course-ta-info">
                <h4>${course.courseName}</h4>
                <p>Course ID: ${course.courseId}</p>
            </div>
            <div class="course-ta-actions">
                <button class="btn-small btn-secondary" onclick="manageCourseTAs('${course.courseId}')">Manage TAs</button>
            </div>
        </div>
    `).join('');
}

/**
 * Open remove TA modal
 */
function openRemoveTAModal(taId, taName) {
    taToRemove = taId;
    const modal = document.getElementById('remove-ta-modal');
    if (modal) {
        modal.classList.add('show');
        // Update modal content with TA name
        const modalBody = modal.querySelector('.modal-body p');
        if (modalBody) {
            modalBody.textContent = `Are you sure you want to remove ${taName} from all courses?`;
        }
    }
}

/**
 * Close remove TA modal
 */
function closeRemoveTAModal() {
    const modal = document.getElementById('remove-ta-modal');
    if (modal) {
        modal.classList.remove('show');
    }
    taToRemove = null;
}

/**
 * Handle remove TA
 */
async function handleRemoveTA() {
    if (!taToRemove) {
        showNotification('No TA selected for removal.', 'error');
        return;
    }
    
    try {
        // Remove TA from all courses
        const response = await authenticatedFetch(`/api/auth/tas/${taToRemove}`, {
            method: 'DELETE'
        });
        
        if (!response.ok) {
            const errorData = await response.json();
            throw new Error(errorData.message || 'Failed to remove TA');
        }
        
        showNotification('TA removed successfully!', 'success');
        closeRemoveTAModal();
        await loadCurrentTAs();
        
    } catch (error) {
        console.error('Error removing TA:', error);
        showNotification(`Error removing TA: ${error.message}`, 'error');
    }
}

/**
 * View TA details (placeholder)
 */
function viewTADetails(taId) {
    showNotification('TA details feature coming soon!', 'info');
}

/**
 * Manage course TAs (placeholder)
 */
function manageCourseTAs(courseId) {
    showNotification('Course TA management feature coming soon!', 'info');
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
            console.log('✅ [AUTH] Instructor Authentication ready');
            return;
        }
        
        // Wait 100ms before next attempt
        await new Promise(resolve => setTimeout(resolve, 100));
        attempts++;
    }
    
    console.warn('⚠️ [AUTH] Instructor Authentication not ready after 5 seconds, proceeding anyway');
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
        ${type === 'success' ? 'background-color: #28a745;' : 
          type === 'error' ? 'background-color: #dc3545;' : 
          type === 'warning' ? 'background-color: #ffc107; color: #000;' : 
          'background-color: #17a2b8;'}
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
