document.addEventListener('DOMContentLoaded', async () => {
    const saveSettingsBtn = document.getElementById('save-settings');
    const resetSettingsBtn = document.getElementById('reset-settings');
    const deleteCollectionBtn = document.getElementById('delete-collection');
    
    // Check if user can see the delete all button
    await checkDeleteAllPermission();
    
    
    // Load initial settings including prompts
    await loadSettings();

    async function loadSettings() {
        try {
            // Load global config (prompts and additive retrieval)
            await loadGlobalConfig();
            
            // Placeholder for other settings
        } catch (error) {
            console.error('Error loading settings:', error);
            showNotification('Failed to load settings', 'error');
        }
    }

    async function loadGlobalConfig() {
        try {
            const response = await fetch('/api/settings/prompts');
            const result = await response.json();
            
            if (result.success && result.prompts) {
                const basePromptInput = document.getElementById('base-prompt');
                const protegePromptInput = document.getElementById('protege-prompt');
                const tutorPromptInput = document.getElementById('tutor-prompt');
                const additiveToggle = document.getElementById('additive-retrieval-toggle');
                
                if (basePromptInput) basePromptInput.value = result.prompts.base || '';
                if (protegePromptInput) protegePromptInput.value = result.prompts.protege || '';
                if (tutorPromptInput) tutorPromptInput.value = result.prompts.tutor || '';
                if (additiveToggle) additiveToggle.checked = !!result.prompts.additiveRetrieval;
            }
        } catch (error) {
            console.error('Error fetching global config:', error);
        }
    }
    
    // Handle save button click
    if (saveSettingsBtn) {
        saveSettingsBtn.addEventListener('click', async () => {
            saveSettingsBtn.disabled = true;
            saveSettingsBtn.textContent = 'Saving...';
            
            try {
                // Save prompts and config
                const base = document.getElementById('base-prompt')?.value;
                const protege = document.getElementById('protege-prompt')?.value;
                const tutor = document.getElementById('tutor-prompt')?.value;
                const additiveRetrieval = document.getElementById('additive-retrieval-toggle')?.checked;
                
                if (base && protege && tutor) {
                    const response = await fetch('/api/settings/prompts', {
                        method: 'POST',
                        headers: {
                            'Content-Type': 'application/json'
                        },
                        body: JSON.stringify({ base, protege, tutor, additiveRetrieval })
                    });
                    
                    const result = await response.json();
                    
                    if (result.success) {
                        showNotification('Settings saved successfully', 'success');
                    } else {
                        showNotification('Failed to save settings: ' + result.message, 'error');
                    }
                } else {
                    // Fallback if inputs missing (shouldn't happen if HTML is correct)
                    showNotification('Settings saved (simulated)', 'info');
                }
                
            } catch (error) {
                console.error('Error saving settings:', error);
                showNotification('Error saving settings', 'error');
            } finally {
                saveSettingsBtn.disabled = false;
                saveSettingsBtn.textContent = 'Save Settings';
            }
        });
    }
    
    // Handle reset button click
    if (resetSettingsBtn) {
        resetSettingsBtn.addEventListener('click', async () => {
            if (!confirm('Are you sure you want to reset all settings to default values?')) {
                return;
            }
            
            resetSettingsBtn.disabled = true;
            resetSettingsBtn.textContent = 'Resetting...';
            
            try {
                // Reset prompts
                const response = await fetch('/api/settings/prompts/reset', {
                    method: 'POST'
                });
                
                const result = await response.json();
                
                if (result.success) {
                    // Reload values
                    if (result.prompts) {
                        const basePromptInput = document.getElementById('base-prompt');
                        const protegePromptInput = document.getElementById('protege-prompt');
                        const tutorPromptInput = document.getElementById('tutor-prompt');
                        const additiveToggle = document.getElementById('additive-retrieval-toggle');
                        
                        if (basePromptInput) basePromptInput.value = result.prompts.base || '';
                        if (protegePromptInput) protegePromptInput.value = result.prompts.protege || '';
                        if (tutorPromptInput) tutorPromptInput.value = result.prompts.tutor || '';
                        // Default for additive retrieval is false (off)
                        if (additiveToggle) additiveToggle.checked = false;
                    }
                    
                    showNotification('Settings reset to defaults', 'success');
                } else {
                    showNotification('Failed to reset settings: ' + result.message, 'error');
                }
                
            } catch (error) {
                console.error('Error resetting settings:', error);
                showNotification('Error resetting settings', 'error');
            } finally {
                resetSettingsBtn.disabled = false;
                resetSettingsBtn.textContent = 'Reset to Default';
            }
        });
    }

    // Handle delete collection button click
    if (deleteCollectionBtn) {
        deleteCollectionBtn.addEventListener('click', async () => {
            // Show confirmation dialog
            const confirmed = confirm(
                '⚠️ WARNING: This will permanently delete ALL BiocBot data!\n\n' +
                'This includes:\n' +
                '• Vector embeddings (Qdrant)\n' +
                '• Document metadata (MongoDB)\n' +
                '• Course information\n' +
                '• Questions and assessments\n' +
                '• Onboarding data\n\n' +
                'This action cannot be undone and will completely reset the system.\n\n' +
                'Are you absolutely sure you want to continue?'
            );

            if (!confirmed) {
                return;
            }

            try {
                // Disable button to prevent multiple clicks
                deleteCollectionBtn.disabled = true;
                deleteCollectionBtn.textContent = 'Deleting...';

                // Call API to delete all collections
                const response = await fetch('/api/qdrant/delete-all-collections', {
                    method: 'DELETE',
                    headers: {
                        'Content-Type': 'application/json'
                    }
                });

                const result = await response.json();

                if (result.success) {
                    showNotification(
                        `All data deleted successfully! Qdrant: ${result.data.qdrantDeletedCount}, MongoDB: ${result.data.mongoDeletedCount} documents removed.`, 
                        'success'
                    );
                } else {
                    showNotification(
                        `Failed to delete data: ${result.message || 'Unknown error'}`, 
                        'error'
                    );
                }

            } catch (error) {
                console.error('Error deleting data:', error);
                showNotification(
                    'Failed to delete data: Network or server error', 
                    'error'
                );
            } finally {
                // Re-enable button
                deleteCollectionBtn.disabled = false;
                deleteCollectionBtn.textContent = 'Delete All Data';
            }
        });
    }
    
    /**
     * Check if the current user has permission to see the delete all button
     * Hides the entire Database Management section if user doesn't have permission
     */
    async function checkDeleteAllPermission() {
        try {
            const response = await fetch('/api/settings/can-delete-all', {
                credentials: 'include'
            });
            
            const result = await response.json();
            
            // Get the Database Management section by ID
            const databaseSection = document.getElementById('database-management-section');
            
            if (result.success && result.canDeleteAll) {
                // User has permission, ensure the section is visible (it's visible by default)
                if (databaseSection) {
                    databaseSection.style.display = '';
                }
            } else {
                // User doesn't have permission, hide the Database Management section
                if (databaseSection) {
                    databaseSection.style.display = 'none';
                }
            }
        } catch (error) {
            console.error('Error checking delete all permission:', error);
            // On error, hide the section for security
            const databaseSection = document.getElementById('database-management-section');
            if (databaseSection) {
                databaseSection.style.display = 'none';
            }
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