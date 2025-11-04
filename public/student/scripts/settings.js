document.addEventListener('DOMContentLoaded', async () => {
    try {
        const courseId = localStorage.getItem('selectedCourseId');
        if (courseId) {
            const resp = await fetch(`/api/courses/${courseId}/student-enrollment`, { credentials: 'include' });
            if (resp.ok) {
                const data = await resp.json();
                if (data && data.success && data.data && data.data.enrolled === false) {
                    const settingsContainer = document.querySelector('.settings-container');
                    if (settingsContainer) settingsContainer.style.display = 'none';
                    const mainContent = document.querySelector('.main-content');
                    if (mainContent) {
                        const notice = document.createElement('div');
                        notice.style.padding = '24px';
                        notice.innerHTML = `
                            <div style=\"background:#fff3cd;border:1px solid #ffeeba;color:#856404;padding:16px;border-radius:8px;\">
                                <h2 style=\"margin-top:0;margin-bottom:8px;\">Access disabled</h2>
                                <p>Your access in this course is revoked.</p>
                                <p>Please select another course from the course selector at the top if available.</p>
                            </div>
                        `;
                        mainContent.appendChild(notice);
                    }
                    return;
                }
            }
        }
    } catch (e) { console.warn('Enrollment check failed, proceeding:', e); }
    const saveSettingsBtn = document.getElementById('save-settings');
    const resetSettingsBtn = document.getElementById('reset-settings');
    
    // Default settings - simplified to placeholder
    const defaultSettings = {
        // Placeholder for future settings
    };
    
    // Handle save button click
    if (saveSettingsBtn) {
        saveSettingsBtn.addEventListener('click', () => {
            // Placeholder for saving settings
            console.log('Save settings button clicked - functionality to be implemented');
            
            // Show success message
            showNotification('Settings functionality will be implemented', 'info');
        });
    }
    
    // Handle reset button click
    if (resetSettingsBtn) {
        resetSettingsBtn.addEventListener('click', () => {
            // Placeholder for resetting settings
            console.log('Reset settings button clicked - functionality to be implemented');
            
            // Show success message
            showNotification('Settings functionality will be implemented', 'info');
        });
    }
    
    // Function to show notification
    function showNotification(message, type = 'info') {
        // Check if notification container exists, if not create it
        let notificationContainer = document.querySelector('.notification-container');
        if (!notificationContainer) {
            notificationContainer = document.createElement('div');
            notificationContainer.classList.add('notification-container');
            document.body.appendChild(notificationContainer);
        }
        
        // Create notification element
        const notification = document.createElement('div');
        notification.classList.add('notification', type);
        notification.textContent = message;
        
        // Add close button
        const closeBtn = document.createElement('button');
        closeBtn.classList.add('notification-close');
        closeBtn.innerHTML = '&times;';
        closeBtn.addEventListener('click', () => {
            notification.remove();
        });
        
        notification.appendChild(closeBtn);
        notificationContainer.appendChild(notification);
        
        // Auto remove after 5 seconds
        setTimeout(() => {
            notification.remove();
        }, 5000);
    }
}); 