document.addEventListener('DOMContentLoaded', () => {
    console.log('Login page loaded');
    
    // Animation for role buttons
    const roleButtons = document.querySelectorAll('.role-button');
    
    roleButtons.forEach(button => {
        button.addEventListener('mouseenter', () => {
            button.style.transform = 'translateY(-5px)';
        });
        
        button.addEventListener('mouseleave', () => {
            button.style.transform = 'translateY(0)';
        });
        
        // Log which role was selected
        button.addEventListener('click', (e) => {
            const role = button.classList.contains('student-role') ? 'student' : 'instructor';
            console.log(`Selected role: ${role}`);
            
            // The href attribute in the anchor tag will handle the navigation
            // No need to prevent default behavior
        });
    });
}); 