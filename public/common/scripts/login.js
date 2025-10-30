/**
 * Login Page JavaScript
 * Handles user authentication and registration
 */

document.addEventListener('DOMContentLoaded', () => {
    console.log('Login page loaded');
    
    // Get form elements
    const loginForm = document.getElementById('auth-form');
    const registerForm = document.getElementById('register-form-element');
    const loginSection = document.getElementById('login-form');
    const registerSection = document.getElementById('register-form');
    const showRegisterLink = document.getElementById('show-register');
    const showLoginLink = document.getElementById('show-login');
    const messageContainer = document.getElementById('message-container');
    const messageElement = document.getElementById('message');
    
    // Toggle between login and register forms
    showRegisterLink.addEventListener('click', (e) => {
        e.preventDefault();
        loginSection.style.display = 'none';
        registerSection.style.display = 'block';
        hideMessage();
    });
    
    showLoginLink.addEventListener('click', (e) => {
        e.preventDefault();
        registerSection.style.display = 'none';
        loginSection.style.display = 'block';
        hideMessage();
    });
    
    // Handle login form submission
    loginForm.addEventListener('submit', async (e) => {
        e.preventDefault();
        
        const formData = new FormData(loginForm);
        const loginData = {
            username: formData.get('username'),
            password: formData.get('password')
        };
        
        // Validate form
        if (!loginData.username || !loginData.password) {
            showMessage('Please fill in all required fields', 'error');
            return;
        }
        
        // Show loading state
        const loginBtn = document.getElementById('login-btn');
        const originalText = loginBtn.textContent;
        loginBtn.textContent = 'Signing in...';
        loginBtn.disabled = true;
        
        try {
            const response = await fetch('/api/auth/login', {
                method: 'POST',
                headers: {
                    'Content-Type': 'application/json'
                },
                body: JSON.stringify(loginData)
            });
            
            const result = await response.json();
            
            if (result.success) {
                showMessage('Login successful! Redirecting...', 'success');
                
                // Redirect to appropriate dashboard
                setTimeout(() => {
                    window.location.href = result.redirect;
                }, 1000);
            } else {
                showMessage(result.error || 'Login failed', 'error');
            }
            
        } catch (error) {
            console.error('Login error:', error);
            showMessage('Login failed. Please try again.', 'error');
        } finally {
            // Reset button state
            loginBtn.textContent = originalText;
            loginBtn.disabled = false;
        }
    });
    
    // Handle registration form submission
    registerForm.addEventListener('submit', async (e) => {
        e.preventDefault();
        
        const formData = new FormData(registerForm);
        const registerData = {
            username: formData.get('username'),
            email: formData.get('email'),
            password: formData.get('password'),
            role: formData.get('role'),
            displayName: formData.get('displayName')
        };
        
        // Validate form
        if (!registerData.username || !registerData.password || !registerData.role) {
            showMessage('Please fill in all required fields', 'error');
            return;
        }
        
        // Show loading state
        const registerBtn = document.getElementById('register-btn');
        const originalText = registerBtn.textContent;
        registerBtn.textContent = 'Creating account...';
        registerBtn.disabled = true;
        
        try {
            const response = await fetch('/api/auth/register', {
                method: 'POST',
                headers: {
                    'Content-Type': 'application/json'
                },
                body: JSON.stringify(registerData)
            });
            
            const result = await response.json();
            
            if (result.success) {
                showMessage('Account created successfully! Please sign in.', 'success');
                
                // Switch to login form
                setTimeout(() => {
                    registerSection.style.display = 'none';
                    loginSection.style.display = 'block';
                    hideMessage();
                }, 2000);
            } else {
                showMessage(result.error || 'Registration failed', 'error');
            }
            
        } catch (error) {
            console.error('Registration error:', error);
            showMessage('Registration failed. Please try again.', 'error');
        } finally {
            // Reset button state
            registerBtn.textContent = originalText;
            registerBtn.disabled = false;
        }
    });
    
    // Check if user is already authenticated
    checkAuthStatus();
});

/**
 * Check if user is already authenticated
 */
async function checkAuthStatus() {
    try {
        const response = await fetch('/api/auth/me');
        const result = await response.json();
        
        if (result.success && result.user) {
            // User is already authenticated, redirect to appropriate dashboard
            let redirectUrl = '/login';
            if (result.user.role === 'instructor') {
                redirectUrl = '/instructor/home';
            } else if (result.user.role === 'ta') {
                redirectUrl = '/ta';
            } else {
                redirectUrl = '/student';
            }
            window.location.href = redirectUrl;
        }
    } catch (error) {
        // User is not authenticated, stay on login page
        console.log('User not authenticated');
    }
}

/**
 * Show message to user
 * @param {string} text - Message text
 * @param {string} type - Message type ('success', 'error', 'info')
 */
function showMessage(text, type = 'info') {
    const messageContainer = document.getElementById('message-container');
    const messageElement = document.getElementById('message');
    
    messageElement.textContent = text;
    messageElement.className = `message message-${type}`;
    messageContainer.style.display = 'block';
    
    // Auto-hide success messages
    if (type === 'success') {
        setTimeout(() => {
            hideMessage();
        }, 3000);
    }
}

/**
 * Hide message
 */
function hideMessage() {
    const messageContainer = document.getElementById('message-container');
    messageContainer.style.display = 'none';
} 