import LoginPrompt from '../LoginPrompt/LoginPrompt.js';
import AuthenticatedView from '../AuthenticatedView/AuthenticatedView.js';

/**
 * @class BiocbotApp
 * @extends HTMLElement
 * @description The main application container component. This component acts as the root
 * of our application's UI. It is responsible for checking the user's authentication
 * status and dynamically rendering either the `<login-prompt>` or the
 * `<authenticated-view>` based on that status.
 */
class BiocbotApp extends HTMLElement {
    constructor() {
        super();
        this.attachShadow({ mode: 'open' });

        // This component manages the application's core state.
        this.state = {
            isAuthenticated: false,
            currentUser: null,
            // The `currentView` is now determined by the URL pathname.
            currentView: window.location.pathname === '/settings' ? 'settings' : 'main',
        };

        // This component needs to update an element in the "light DOM" (the main page's HTML).
        // It's generally best for a component to only control its own shadow DOM, but in this
        // case, the main app component is a good place to manage the shared header.
        this.userInfoDiv = document.getElementById('userInfo');
    }

    /**
     * When the component is added to the DOM, we kick off the authentication check.
     */
    connectedCallback() {
        // We render an initial state (which will be empty, as no components are added yet)
        // and then immediately check the auth status.
        this.render();
        this.checkAuthStatus();

        // Add event listeners to handle navigation between views.
        this.shadowRoot.addEventListener('navigate-to-settings', () => {
            console.log('[BIOCBOT] Navigating to Settings view...');
            // Update the browser's history and URL without a full page reload.
            history.pushState({ view: 'settings' }, '', '/settings');
            this.handleLocationChange();
        });

        this.shadowRoot.addEventListener('navigate-back', () => {
            console.log('[BIOCBOT] Navigating back to Main view...');
            // Update the browser's history and URL.
            history.pushState({ view: 'main' }, '', '/');
            this.handleLocationChange();
        });

        // Listen for the browser's back/forward buttons.
        window.addEventListener('popstate', (event) => {
            console.log('[BIOCBOT] Popstate event fired:', event.state);
            // When the user navigates, update the view based on the URL.
            this.handleLocationChange();
        });
    }

    /**
     * A new handler to update the component's state based on the current URL.
     * This is called on initial load and when the user navigates with back/forward buttons.
     */
    handleLocationChange() {
        const path = window.location.pathname;
        console.log(`[BIOCBOT] Handling location change for path: ${path}`);
        if (path === '/settings') {
            this.state.currentView = 'settings';
        } else {
            this.state.currentView = 'main';
        }
        this.render();
    }

    /**
     * An async method to communicate with the backend to see if the user has an active session.
     */
    async checkAuthStatus() {
        try {
            // Fetch the user's status from the `/auth/me` endpoint.
            const response = await fetch('/auth/me');
            const data = await response.json();

            // Update the component's internal state based on the response.
            if (data.authenticated) {
                this.state.isAuthenticated = true;
                this.state.currentUser = data.user;
                console.log('[BIOCBOT] Authenticated user:', this.state.currentUser);
            } else {
                this.state.isAuthenticated = false;
                this.state.currentUser = null;
                console.log('[BIOCBOT] Unauthenticated user');
            }
        } catch (error) {
            // If the API call fails, we assume the user is not authenticated.
            console.error('[BIOCBOT] Error checking auth status:', error);
            this.state.isAuthenticated = false;
            this.state.currentUser = null;
        } finally {
            // The `finally` block is crucial here. After the API call is complete (whether
            // it succeeded or failed), we must re-render the UI with the new state
            // and update the shared header.
            this.render();
            this.updateHeader();
        }
    }

    /**
     * Updates the content of the user info `div` in the main page header.
     */
    updateHeader() {
        if (this.state.isAuthenticated) {
            this.userInfoDiv.innerHTML = `
                <div>
                    <strong>${this.state.currentUser.firstName} ${this.state.currentUser.lastName}</strong><br>
                    ${this.state.currentUser.username} (${this.state.currentUser.affiliation})<br>
                    <a href="/auth/logout">Logout</a>
                </div>
            `;
        } else {
            this.userInfoDiv.innerHTML = '<em>Not logged in</em>';
        }
    }

    /**
     * Renders the correct child component based on the `isAuthenticated` state.
     */
    render() {
        // Clear any existing content from the shadow DOM before rendering.
        this.shadowRoot.innerHTML = '';

        if (this.state.isAuthenticated) {
            // If the user is authenticated, we decide which view to show based on `currentView` state.
            if (this.state.currentView === 'settings') {
                // Render the settings view
                const settingsView = document.createElement('settings-view');
                // Pass the user data to the component so it can display role-specific content.
                settingsView.user = this.state.currentUser;
                this.shadowRoot.appendChild(settingsView);
            } else {
                // Render the main authenticated view
                const authenticatedView = document.createElement('authenticated-view');
                // Pass the user data to the component by setting its `user` property.
                authenticatedView.user = this.state.currentUser;
                // Add the new component to our shadow DOM.
                this.shadowRoot.appendChild(authenticatedView);
            }
        } else {
            // If the user is not authenticated, create and add the <login-prompt> component.
            const loginPrompt = document.createElement('login-prompt');
            this.shadowRoot.appendChild(loginPrompt);
        }
    }
}

export default BiocbotApp;