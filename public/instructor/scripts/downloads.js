/**
 * Downloads Page Script
 * Handles fetching and displaying student chat sessions for instructors
 */

// Global variables
let currentCourseId = null;
let currentStudents = [];
let currentStudentSessions = [];

/**
 * Initialize the downloads page
 */
document.addEventListener('DOMContentLoaded', async () => {
    console.log('Downloads page initialized');
    
    // Set up event listeners
    setupEventListeners();
    
    // Automatically load BIOC202 course
    await loadBIOC202Course();
});

/**
 * Set up event listeners
 */
function setupEventListeners() {
    // Logout button
    const logoutBtn = document.getElementById('logout-btn');
    if (logoutBtn) {
        logoutBtn.addEventListener('click', handleLogout);
    }
}

/**
 * Automatically load BIOC202 course
 */
async function loadBIOC202Course() {
    try {
        console.log('Loading BIOC202 course automatically...');
        showLoadingState();
        
        // First, get all courses to find BIOC202
        const response = await fetch('/api/courses', {
            method: 'GET',
            credentials: 'include'
        });
        
        if (!response.ok) {
            throw new Error(`Failed to load courses: ${response.status}`);
        }
        
        const result = await response.json();
        
        if (!result.success) {
            throw new Error(result.message || 'Failed to load courses');
        }
        
        const courses = result.data || [];
        console.log(`Loaded ${courses.length} courses`);
        
        // Find BIOC202 course
        const bioc202Course = courses.find(course => 
            course.name.toLowerCase().includes('bioc202') || 
            course.id.toLowerCase().includes('bioc202')
        );
        
        if (!bioc202Course) {
            throw new Error('BIOC202 course not found');
        }
        
        console.log('Found BIOC202 course:', bioc202Course);
        
        // Set the course ID and load student data
        currentCourseId = bioc202Course.id;
        
        // Update course title
        const courseTitle = document.getElementById('course-title');
        if (courseTitle) {
            courseTitle.textContent = `${bioc202Course.name} - Student Downloads`;
        }
        
        // Load student data for BIOC202
        await loadStudentData();
        
    } catch (error) {
        console.error('Error loading BIOC202 course:', error);
        showErrorState('Failed to load BIOC202 course. Please try again.');
    }
}


/**
 * Load student data for the selected course
 */
async function loadStudentData() {
    try {
        if (!currentCourseId) {
            console.log('No course selected');
            return;
        }
        
        console.log(`Loading student data for course: ${currentCourseId}`);
        showLoadingState();
        
        const response = await fetch(`/api/students/${currentCourseId}`, {
            method: 'GET',
            credentials: 'include'
        });
        
        if (!response.ok) {
            throw new Error(`Failed to load student data: ${response.status}`);
        }
        
        const result = await response.json();
        
        if (!result.success) {
            throw new Error(result.message || 'Failed to load student data');
        }
        
        const data = result.data;
        currentStudents = data.students || [];
        
        console.log(`Loaded ${currentStudents.length} students with saved chats`);
        
        // Update UI
        updateStudentStats(data.totalStudents, data.totalSessions);
        displayStudents(currentStudents);
        
        // Hide loading state
        hideLoadingState();
        
    } catch (error) {
        console.error('Error loading student data:', error);
        showErrorState('Failed to load student data. Please try again.');
    }
}

/**
 * Update student statistics
 * @param {number} totalStudents - Total number of students
 * @param {number} totalSessions - Total number of sessions
 */
function updateStudentStats(totalStudents, totalSessions) {
    const totalStudentsElement = document.getElementById('total-students');
    if (totalStudentsElement) {
        totalStudentsElement.textContent = totalStudents;
    }
    
    console.log(`Updated stats: ${totalStudents} students, ${totalSessions} sessions`);
}

/**
 * Display students in the UI
 * @param {Array} students - Array of student objects
 */
function displayStudents(students) {
    const studentsContainer = document.getElementById('students-container');
    const studentsList = document.getElementById('students-list');
    const emptyState = document.getElementById('empty-state');
    
    if (!studentsContainer || !studentsList || !emptyState) return;
    
    // Clear existing content
    studentsList.innerHTML = '';
    
    if (students.length === 0) {
        // Show empty state
        studentsContainer.style.display = 'none';
        emptyState.style.display = 'block';
        return;
    }
    
    // Hide empty state and show students
    emptyState.style.display = 'none';
    studentsContainer.style.display = 'block';
    
    // Create student cards
    students.forEach(student => {
        const studentCard = createStudentCard(student);
        studentsList.appendChild(studentCard);
    });
    
    console.log(`Displayed ${students.length} students`);
}

/**
 * Create a student card element
 * @param {Object} student - Student object
 * @returns {HTMLElement} Student card element
 */
function createStudentCard(student) {
    const card = document.createElement('div');
    card.className = 'student-card';
    card.innerHTML = `
        <div class="student-info">
            <div class="student-avatar">${student.studentName.charAt(0).toUpperCase()}</div>
            <div class="student-details">
                <h3 class="student-name">${student.studentName}</h3>
                <p class="student-id">ID: ${student.studentId}</p>
                <p class="student-stats">${student.totalSessions} saved chat${student.totalSessions !== 1 ? 's' : ''}</p>
            </div>
        </div>
        <div class="student-actions">
            <button class="btn-primary" onclick="viewStudentSessions('${student.studentId}', '${student.studentName}')">
                View Sessions
            </button>
        </div>
    `;
    
    return card;
}

/**
 * View sessions for a specific student
 * @param {string} studentId - Student ID
 * @param {string} studentName - Student name
 */
async function viewStudentSessions(studentId, studentName) {
    try {
        console.log(`Loading sessions for student: ${studentName} (${studentId})`);
        
        if (!currentCourseId) {
            console.error('No course selected');
            return;
        }
        
        const response = await fetch(`/api/students/${currentCourseId}/${studentId}/sessions`, {
            method: 'GET',
            credentials: 'include'
        });
        
        if (!response.ok) {
            throw new Error(`Failed to load student sessions: ${response.status}`);
        }
        
        const result = await response.json();
        
        if (!result.success) {
            throw new Error(result.message || 'Failed to load student sessions');
        }
        
        const data = result.data;
        currentStudentSessions = data.sessions || [];
        
        console.log(`Loaded ${currentStudentSessions.length} sessions for student ${studentName}`);
        
        // Show modal with sessions
        showStudentModal(studentName, data.studentName, currentCourseId, currentStudentSessions);
        
    } catch (error) {
        console.error('Error loading student sessions:', error);
        alert('Failed to load student sessions. Please try again.');
    }
}

/**
 * Show the student modal with sessions
 * @param {string} studentName - Student name
 * @param {string} studentUsername - Student username/ID
 * @param {string} courseName - Course name
 * @param {Array} sessions - Array of session objects
 */
function showStudentModal(studentName, studentUsername, courseName, sessions) {
    const modal = document.getElementById('student-modal');
    const modalTitle = document.getElementById('student-modal-title');
    const studentAvatar = document.getElementById('student-avatar');
    const studentNameElement = document.getElementById('student-name');
    const studentUsernameElement = document.getElementById('student-username');
    const studentCourseElement = document.getElementById('student-course');
    const sessionsList = document.getElementById('sessions-list');
    const downloadAllBtn = document.getElementById('download-all-btn');
    
    if (!modal) return;
    
    // Update modal content
    if (modalTitle) modalTitle.textContent = `${studentName}'s Chat Sessions`;
    if (studentAvatar) studentAvatar.textContent = studentName.charAt(0).toUpperCase();
    if (studentNameElement) studentNameElement.textContent = studentName;
    if (studentUsernameElement) studentUsernameElement.textContent = `@${studentUsername}`;
    if (studentCourseElement) studentCourseElement.textContent = courseName;
    
    // Clear and populate sessions list
    if (sessionsList) {
        sessionsList.innerHTML = '';
        
        if (sessions.length === 0) {
            sessionsList.innerHTML = '<p class="no-sessions">No saved chat sessions found.</p>';
        } else {
            sessions.forEach(session => {
                const sessionElement = createSessionElement(session);
                sessionsList.appendChild(sessionElement);
            });
        }
    }
    
    // Show/hide download all button
    if (downloadAllBtn) {
        downloadAllBtn.style.display = sessions.length > 0 ? 'block' : 'none';
    }
    
    // Show modal
    modal.style.display = 'block';
}

/**
 * Create a session element
 * @param {Object} session - Session object
 * @returns {HTMLElement} Session element
 */
function createSessionElement(session) {
    const sessionDiv = document.createElement('div');
    sessionDiv.className = 'session-item';
    
    const savedDate = new Date(session.savedAt).toLocaleDateString();
    const savedTime = new Date(session.savedAt).toLocaleTimeString();
    
    sessionDiv.innerHTML = `
        <div class="session-info">
            <h4 class="session-title">${session.title}</h4>
            <p class="session-details">
                Unit: ${session.unitName} | 
                Messages: ${session.messageCount} | 
                Duration: ${session.duration}
            </p>
            <p class="session-date">Saved: ${savedDate} at ${savedTime}</p>
        </div>
        <div class="session-actions">
            <button class="btn-secondary" onclick="downloadSession('${session.sessionId}')">
                Download
            </button>
        </div>
    `;
    
    return sessionDiv;
}

/**
 * Download a specific session
 * @param {string} sessionId - Session ID to download
 */
async function downloadSession(sessionId) {
    try {
        console.log(`Downloading session: ${sessionId}`);
        
        if (!currentCourseId) {
            console.error('No course selected');
            return;
        }
        
        // Find the student ID from current sessions
        const session = currentStudentSessions.find(s => s.sessionId === sessionId);
        if (!session) {
            console.error('Session not found for sessionId:', sessionId);
            return;
        }
        
        const response = await fetch(`/api/students/${currentCourseId}/${session.studentId}/sessions/${sessionId}`, {
            method: 'GET',
            credentials: 'include'
        });
        
        if (!response.ok) {
            throw new Error(`Failed to download session: ${response.status}`);
        }
        
        const result = await response.json();
        
        if (!result.success) {
            throw new Error(result.message || 'Failed to download session');
        }
        
        const sessionData = result.data;
        
        // Create and download JSON file
        const chatData = sessionData.chatData;
        const fileName = `BiocBot_Chat_${sessionData.courseId}_${sessionData.studentName}_${new Date(sessionData.savedAt).toISOString().split('T')[0]}.json`;
        
        downloadJSON(chatData, fileName);
        
        console.log(`Downloaded session: ${fileName}`);
        
    } catch (error) {
        console.error('Error downloading session:', error);
        alert('Failed to download session. Please try again.');
    }
}

/**
 * Download all sessions for the current student
 */
async function downloadAllSessions() {
    try {
        console.log('Downloading all sessions for current student');
        
        if (currentStudentSessions.length === 0) {
            alert('No sessions to download.');
            return;
        }
        
        // Show progress modal
        showDownloadProgress();
        
        const allSessionsData = [];
        
        // Download each session
        for (let i = 0; i < currentStudentSessions.length; i++) {
            const session = currentStudentSessions[i];
            
            try {
                const response = await fetch(`/api/students/${currentCourseId}/${session.studentId}/sessions/${session.sessionId}`, {
                    method: 'GET',
                    credentials: 'include'
                });
                
                if (response.ok) {
                    const result = await response.json();
                    if (result.success) {
                        allSessionsData.push(result.data);
                    }
                }
                
                // Update progress
                updateDownloadProgress(i + 1, currentStudentSessions.length);
                
            } catch (error) {
                console.error(`Error downloading session ${session.sessionId}:`, error);
            }
        }
        
        // Create combined JSON file
        const combinedData = {
            studentName: allSessionsData[0]?.studentName || 'Unknown Student',
            courseId: currentCourseId,
            totalSessions: allSessionsData.length,
            exportDate: new Date().toISOString(),
            sessions: allSessionsData
        };
        
        const fileName = `BiocBot_AllSessions_${currentCourseId}_${combinedData.studentName}_${new Date().toISOString().split('T')[0]}.json`;
        
        downloadJSON(combinedData, fileName);
        
        // Hide progress modal
        hideDownloadProgress();
        
        console.log(`Downloaded ${allSessionsData.length} sessions: ${fileName}`);
        
    } catch (error) {
        console.error('Error downloading all sessions:', error);
        hideDownloadProgress();
        alert('Failed to download sessions. Please try again.');
    }
}

/**
 * Download JSON data as a file
 * @param {Object} data - Data to download
 * @param {string} fileName - Name of the file
 */
function downloadJSON(data, fileName) {
    const jsonString = JSON.stringify(data, null, 2);
    const blob = new Blob([jsonString], { type: 'application/json' });
    const url = URL.createObjectURL(blob);
    
    const a = document.createElement('a');
    a.href = url;
    a.download = fileName;
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    URL.revokeObjectURL(url);
}

/**
 * Show download progress modal
 */
function showDownloadProgress() {
    const modal = document.getElementById('download-modal');
    if (modal) {
        modal.style.display = 'block';
    }
}

/**
 * Hide download progress modal
 */
function hideDownloadProgress() {
    const modal = document.getElementById('download-modal');
    if (modal) {
        modal.style.display = 'none';
    }
}

/**
 * Update download progress
 * @param {number} current - Current progress
 * @param {number} total - Total items
 */
function updateDownloadProgress(current, total) {
    const progressFill = document.getElementById('progress-fill');
    const downloadStatus = document.getElementById('download-status');
    
    if (progressFill) {
        const percentage = (current / total) * 100;
        progressFill.style.width = `${percentage}%`;
    }
    
    if (downloadStatus) {
        downloadStatus.textContent = `Downloading session ${current} of ${total}...`;
    }
}

/**
 * Close the student modal
 */
function closeStudentModal() {
    const modal = document.getElementById('student-modal');
    if (modal) {
        modal.style.display = 'none';
    }
}

/**
 * Clear student data and reset UI
 */
function clearStudentData() {
    currentStudents = [];
    currentStudentSessions = [];
    
    const studentsContainer = document.getElementById('students-container');
    const emptyState = document.getElementById('empty-state');
    
    if (studentsContainer) studentsContainer.style.display = 'none';
    if (emptyState) emptyState.style.display = 'none';
    
    updateStudentStats(0, 0);
}

/**
 * Show loading state
 */
function showLoadingState() {
    const loadingState = document.getElementById('loading-state');
    const errorState = document.getElementById('error-state');
    const studentsContainer = document.getElementById('students-container');
    const emptyState = document.getElementById('empty-state');
    
    if (loadingState) loadingState.style.display = 'block';
    if (errorState) errorState.style.display = 'none';
    if (studentsContainer) studentsContainer.style.display = 'none';
    if (emptyState) emptyState.style.display = 'none';
}

/**
 * Hide loading state
 */
function hideLoadingState() {
    const loadingState = document.getElementById('loading-state');
    if (loadingState) {
        loadingState.style.display = 'none';
    }
}

/**
 * Show error state
 * @param {string} message - Error message to display
 */
function showErrorState(message) {
    const loadingState = document.getElementById('loading-state');
    const errorState = document.getElementById('error-state');
    const errorMessage = document.getElementById('error-message');
    
    if (loadingState) loadingState.style.display = 'none';
    if (errorState) errorState.style.display = 'block';
    if (errorMessage) errorMessage.textContent = message;
}

/**
 * Handle logout
 */
function handleLogout() {
    // Redirect to login page
    window.location.href = '/login';
}

// Make functions globally available
window.viewStudentSessions = viewStudentSessions;
window.downloadSession = downloadSession;
window.downloadAllSessions = downloadAllSessions;
window.closeStudentModal = closeStudentModal;
