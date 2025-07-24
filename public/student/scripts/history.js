document.addEventListener('DOMContentLoaded', () => {
    console.log('Chat history page loaded');
    
    // Get all chat history items
    const historyItems = document.querySelectorAll('.chat-history-item');
    const searchInput = document.getElementById('history-search');
    
    // Add click event to history items
    historyItems.forEach(item => {
        item.addEventListener('click', () => {
            // Remove active class from all items
            historyItems.forEach(i => i.classList.remove('active'));
            
            // Add active class to clicked item
            item.classList.add('active');
            
            // In a real implementation, this would load the selected chat
            const title = item.querySelector('.title').textContent;
            console.log(`Selected chat: ${title}`);
            
            // Update the preview panel title
            const previewTitle = document.querySelector('.preview-header h2');
            if (previewTitle) {
                previewTitle.textContent = title;
            }
        });
    });
    
    // Add search functionality
    if (searchInput) {
        searchInput.addEventListener('input', () => {
            const searchTerm = searchInput.value.toLowerCase();
            
            historyItems.forEach(item => {
                const title = item.querySelector('.title').textContent.toLowerCase();
                const preview = item.querySelector('.preview').textContent.toLowerCase();
                
                if (title.includes(searchTerm) || preview.includes(searchTerm)) {
                    item.style.display = '';
                } else {
                    item.style.display = 'none';
                }
            });
        });
    }
    
    // Add button event listeners
    const continueButton = document.querySelector('.preview-actions button:first-child');
    const deleteButton = document.querySelector('.preview-actions button:last-child');
    
    if (continueButton) {
        continueButton.addEventListener('click', () => {
            // In a real implementation, this would redirect to the chat page with the selected chat loaded
            console.log('Continue chat clicked');
            window.location.href = '/student';
        });
    }
    
    if (deleteButton) {
        deleteButton.addEventListener('click', () => {
            // In a real implementation, this would delete the selected chat
            console.log('Delete chat clicked');
            const activeItem = document.querySelector('.chat-history-item.active');
            if (activeItem) {
                activeItem.remove();
                
                // Select the first remaining item if any
                const firstItem = document.querySelector('.chat-history-item');
                if (firstItem) {
                    firstItem.click();
                } else {
                    // No items left, clear preview panel
                    const previewTitle = document.querySelector('.preview-header h2');
                    if (previewTitle) {
                        previewTitle.textContent = 'No chat selected';
                    }
                    
                    const previewMessages = document.querySelector('.preview-messages');
                    if (previewMessages) {
                        previewMessages.innerHTML = '<p class="no-messages">No messages to display</p>';
                    }
                }
            }
        });
    }
    
    // Select the first item by default
    const firstItem = document.querySelector('.chat-history-item');
    if (firstItem) {
        firstItem.classList.add('active');
    }
}); 