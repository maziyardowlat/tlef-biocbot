document.addEventListener('DOMContentLoaded', () => {
    const saveSettingsBtn = document.getElementById('save-settings');
    const resetSettingsBtn = document.getElementById('reset-settings');
    
    // Default settings
    const defaultSettings = {
        userName: 'User Name',
        email: 'user@example.com',
        language: 'en',
        defaultCourse: '',
        showSources: true,
        saveHistory: true,
        emailNotifications: true,
        documentProcessed: false
    };
    
    // Load settings (in a real app, this would come from the server)
    loadSettings();
    
    // Handle save button click
    if (saveSettingsBtn) {
        saveSettingsBtn.addEventListener('click', () => {
            // Get all settings values
            const settings = {
                userName: document.getElementById('user-name').value,
                email: document.getElementById('email').value,
                language: document.getElementById('language').value,
                defaultCourse: document.getElementById('default-course').value,
                showSources: document.getElementById('show-sources').checked,
                saveHistory: document.getElementById('save-history').checked,
                emailNotifications: document.getElementById('email-notifications').checked,
                documentProcessed: document.getElementById('document-processed').checked
            };
            
            // Validate settings
            if (!validateSettings(settings)) {
                return;
            }
            
            // In a real implementation, this would save the settings to the server
            console.log('Saving settings:', settings);
            
            // Show success message
            showNotification('Settings saved successfully!', 'success');
        });
    }
    
    // Handle reset button click
    if (resetSettingsBtn) {
        resetSettingsBtn.addEventListener('click', () => {
            // Reset to default settings
            applySettings(defaultSettings);
            
            // Show success message
            showNotification('Settings reset to default values.', 'info');
        });
    }
    
    // Function to load settings
    function loadSettings() {
        // In a real implementation, this would fetch settings from the server
        // For now, we'll use default settings
        applySettings(defaultSettings);
    }
    
    // Function to apply settings to form elements
    function applySettings(settings) {
        if (document.getElementById('user-name')) {
            document.getElementById('user-name').value = settings.userName;
        }
        
        if (document.getElementById('email')) {
            document.getElementById('email').value = settings.email;
        }
        
        if (document.getElementById('language')) {
            document.getElementById('language').value = settings.language;
        }
        
        if (document.getElementById('default-course')) {
            document.getElementById('default-course').value = settings.defaultCourse;
        }
        
        if (document.getElementById('show-sources')) {
            document.getElementById('show-sources').checked = settings.showSources;
        }
        
        if (document.getElementById('save-history')) {
            document.getElementById('save-history').checked = settings.saveHistory;
        }
        
        if (document.getElementById('email-notifications')) {
            document.getElementById('email-notifications').checked = settings.emailNotifications;
        }
        
        if (document.getElementById('document-processed')) {
            document.getElementById('document-processed').checked = settings.documentProcessed;
        }
    }
    
    // Function to validate settings
    function validateSettings(settings) {
        let isValid = true;
        
        // Validate email
        const emailRegex = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
        const emailInput = document.getElementById('email');
        
        if (!emailRegex.test(settings.email)) {
            showValidationError(emailInput, 'Please enter a valid email address.');
            isValid = false;
        } else {
            clearValidationError(emailInput);
        }
        
        // Validate username
        const userNameInput = document.getElementById('user-name');
        if (!settings.userName.trim()) {
            showValidationError(userNameInput, 'Display name cannot be empty.');
            isValid = false;
        } else {
            clearValidationError(userNameInput);
        }
        
        return isValid;
    }
    
    // Function to show validation error
    function showValidationError(inputElement, message) {
        inputElement.classList.add('is-invalid');
        
        // Remove existing error message if any
        const existingError = inputElement.parentNode.querySelector('.invalid-feedback');
        if (existingError) {
            existingError.remove();
        }
        
        // Add error message
        const errorDiv = document.createElement('div');
        errorDiv.classList.add('invalid-feedback');
        errorDiv.textContent = message;
        inputElement.parentNode.appendChild(errorDiv);
    }
    
    // Function to clear validation error
    function clearValidationError(inputElement) {
        inputElement.classList.remove('is-invalid');
        
        // Remove error message if any
        const existingError = inputElement.parentNode.querySelector('.invalid-feedback');
        if (existingError) {
            existingError.remove();
        }
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