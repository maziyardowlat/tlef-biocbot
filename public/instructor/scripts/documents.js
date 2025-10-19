document.addEventListener('DOMContentLoaded', async () => {
    const uploadDropArea = document.getElementById('upload-drop-area');
    const fileUpload = document.getElementById('file-upload');
    const documentSearch = document.getElementById('document-search');
    const documentFilter = document.getElementById('document-filter');
    
    // Wait for authentication to be ready before loading courses
    await waitForAuth();
    
    // Load available courses and initialize course selection
    loadAvailableCourses();
    
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
            // In a real implementation, you would upload these files to the server
            
            // Show a mock upload in progress for demonstration
            Array.from(files).forEach(file => {
                addDocumentRow({
                    name: file.name,
                    type: file.name.split('.').pop().toUpperCase(),
                    size: formatFileSize(file.size),
                    date: new Date().toISOString().split('T')[0],
                    status: 'processing'
                });
            });
        }
    }

    // Search functionality
    if (documentSearch) {
        documentSearch.addEventListener('input', filterDocuments);
    }

    // Filter functionality
    if (documentFilter) {
        documentFilter.addEventListener('change', filterDocuments);
    }

    function filterDocuments() {
        const searchTerm = documentSearch.value.toLowerCase();
        const filterType = documentFilter.value;
        
        const rows = document.querySelectorAll('.documents-table tbody tr');
        
        rows.forEach(row => {
            const name = row.querySelector('td:first-child').textContent.toLowerCase();
            const type = row.querySelector('td:nth-child(2)').textContent.toLowerCase();
            
            const nameMatch = name.includes(searchTerm);
            const typeMatch = filterType === 'all' || type.toLowerCase() === filterType.toLowerCase();
            
            row.style.display = nameMatch && typeMatch ? '' : 'none';
        });
    }

    // Add document to table (for UI demo)
    function addDocumentRow(document) {
        const tbody = document.querySelector('.documents-table tbody');
        if (!tbody) return;
        
        const tr = document.createElement('tr');
        tr.innerHTML = `
            <td>${document.name}</td>
            <td>${document.type}</td>
            <td>${document.size}</td>
            <td>${document.date}</td>
            <td><span class="status ${document.status}">${capitalizeFirstLetter(document.status)}</span></td>
            <td>
                <button class="action-button view">View</button>
                <button class="action-button delete">Delete</button>
            </td>
        `;
        
        // Add event listeners for the buttons
        const viewButton = tr.querySelector('.view');
        const deleteButton = tr.querySelector('.delete');
        
        viewButton.addEventListener('click', () => {
            console.log('View document:', document.name);
            // In a real implementation, this would open the document
        });
        
        deleteButton.addEventListener('click', () => {
            console.log('Delete document:', document.name);
            tr.remove();
            // In a real implementation, this would delete the document from the server
        });
        
        tbody.appendChild(tr);
    }

    // Helper functions
    function formatFileSize(bytes) {
        if (bytes === 0) return '0 Bytes';
        const k = 1024;
        const sizes = ['Bytes', 'KB', 'MB', 'GB'];
        const i = Math.floor(Math.log(bytes) / Math.log(k));
        return parseFloat((bytes / Math.pow(k, i)).toFixed(1)) + ' ' + sizes[i];
    }
    
    function capitalizeFirstLetter(string) {
        return string.charAt(0).toUpperCase() + string.slice(1);
    }
});

/**
 * Load available courses for the instructor or TA
 */
async function loadAvailableCourses() {
    try {
        const courseSelect = document.getElementById('course-select');
        const courseTitle = document.getElementById('course-title');
        
        if (!courseSelect) return;
        
        let courses = [];
        let uniqueCourses = [];
        
        // Check if user is a TA
        if (typeof isTA === 'function' && isTA()) {
            console.log('Loading courses for TA user');
            courses = await loadTACourses();
        } else {
            console.log('Loading courses for instructor user');
            courses = await loadInstructorCourses();
        }
        
        // Filter out duplicate courses by courseId
        uniqueCourses = courses.filter((course, index, self) => 
            index === self.findIndex(c => c.courseId === course.courseId)
        );
        
        console.log('Unique courses after deduplication:', uniqueCourses);
        
        // Clear loading option
        courseSelect.innerHTML = '';
        
        // Add course options
        uniqueCourses.forEach(course => {
            const option = document.createElement('option');
            option.value = course.courseId;
            option.textContent = course.courseName;
            courseSelect.appendChild(option);
        });
        
        // Check for courseId parameter in URL
        const urlParams = new URLSearchParams(window.location.search);
        const courseIdParam = urlParams.get('courseId');
        
        // Set default selection
        if (uniqueCourses.length > 0) {
            let selectedCourse = null;
            
            if (courseIdParam) {
                // Use courseId from URL parameter
                selectedCourse = uniqueCourses.find(course => course.courseId === courseIdParam);
                console.log('Course ID from URL parameter:', courseIdParam);
            }
            
            if (!selectedCourse) {
                // Sort by creation date to get the most recent course first
                const sortedCourses = uniqueCourses.sort((a, b) => {
                    const dateA = new Date(a.createdAt || 0);
                    const dateB = new Date(b.createdAt || 0);
                    return dateB - dateA; // Most recent first
                });
                selectedCourse = sortedCourses[0];
            }
            
            courseSelect.value = selectedCourse.courseId;
            
            // Update course title
            if (courseTitle) {
                courseTitle.textContent = selectedCourse.courseName;
            }
            
            console.log('Course selected:', selectedCourse.courseName, selectedCourse.courseId);
        }
        
        // Add event listener for course selection changes
        courseSelect.addEventListener('change', function() {
            const selectedCourse = uniqueCourses.find(course => course.courseId === this.value);
            if (selectedCourse && courseTitle) {
                courseTitle.textContent = selectedCourse.courseName;
                console.log('Course changed to:', selectedCourse.courseName);
            }
        });
        
        console.log('Available courses loaded and deduplicated:', uniqueCourses);
        
    } catch (error) {
        console.error('Error loading available courses:', error);
        // Fallback to default course if API fails
        const courseSelect = document.getElementById('course-select');
        const courseTitle = document.getElementById('course-title');
        
        if (courseSelect) {
            courseSelect.innerHTML = '<option value="default">No courses available</option>';
        }
        if (courseTitle) {
            courseTitle.textContent = 'No Course Available';
        }
    }
}

/**
 * Load courses for TA users
 */
async function loadTACourses() {
    try {
        const taId = getCurrentInstructorId(); // Using same function for user ID
        if (!taId) {
            console.error('No TA ID found. User not authenticated.');
            return [];
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
        
        const courses = result.data || [];
        console.log('TA courses loaded:', courses);
        return courses;
        
    } catch (error) {
        console.error('Error loading TA courses:', error);
        return [];
    }
}

/**
 * Load courses for instructor users
 */
async function loadInstructorCourses() {
    try {
        // Fetch courses from the API
        const response = await fetch('/api/courses/available/all');
        
        if (!response.ok) {
            throw new Error(`HTTP error! status: ${response.status}`);
        }
        
        const result = await response.json();
        
        if (!result.success) {
            throw new Error(result.message || 'Failed to fetch courses');
        }
        
        const courses = result.data;
        console.log('All available courses from API:', courses);
        return courses;
        
    } catch (error) {
        console.error('Error loading instructor courses:', error);
        return [];
    }
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
            console.log('✅ [AUTH] Authentication ready');
            return;
        }
        
        // Wait 100ms before next attempt
        await new Promise(resolve => setTimeout(resolve, 100));
        attempts++;
    }
    
    console.warn('⚠️ [AUTH] Authentication not ready after 5 seconds, proceeding anyway');
} 