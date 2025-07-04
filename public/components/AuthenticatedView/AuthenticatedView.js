import ResponseDisplay from '../ResponseDisplay/ResponseDisplay.js';
import { loadStylesheet } from '../../utils/stylesheetLoader.js';

// Load the stylesheet for this component using the utility function.
const authenticatedViewSheet = await loadStylesheet('/components/AuthenticatedView/AuthenticatedView.css');

/**
 * @class AuthenticatedView
 * @extends HTMLElement
 * @description A custom web component that displays the main application interface
 * for an authenticated user. It shows user details and provides buttons to interact
 * with the backend API.
 */
class AuthenticatedView extends HTMLElement {
    constructor() {
        super();
        this.attachShadow({ mode: 'open' });
        // Apply the constructed stylesheet to the shadow DOM.
        this.shadowRoot.adoptedStyleSheets = [authenticatedViewSheet];
        // It's good practice to initialize properties in the constructor.
        // The underscore `_user` is a common convention to indicate a "private" property,
        // suggesting it should be manipulated via setters and getters.
        this._user = null;
    }

    /**
     * A "setter" for the `user` property. This allows other components to pass data
     * into this component. When the user property is set, it triggers a re-render.
     * @param {object} value - The user object received from the authentication check.
     */
    set user(value) {
        this._user = value;
        this.render();
    }

    /**
     * A "getter" for the `user` property. This allows other components to read the
     * user data from this component if needed.
     * @returns {object} The current user object.
     */
    get user() {
        return this._user;
    }

    /**
     * Standard component lifecycle method. Called when the component is added to the DOM.
     */
    connectedCallback() {
        // Initial render call. This is important in case the user property was set
        // before the component was connected to the DOM.
        this.render();
    }

    /**
     * Renders the component's UI based on the current state (specifically, the user data).
     */
    render() {
        // A "guard clause" to handle the case where the component renders before the user
        // data has been provided. This prevents errors and shows a helpful loading message.
        if (!this.user) {
            this.shadowRoot.innerHTML = `<p>Loading user data...</p>`;
            return;
        }

        // The component's main HTML structure. The stylesheet is now applied
        // in the constructor, so we no longer need the <link> tag.
        this.shadowRoot.innerHTML = `
            <div class="user-details">
                <h3>Authenticated User Information</h3>
                <dl>
                    <dt>Username:</dt>
                    <dd>${this.user.username}</dd>
                    <dt>Name:</dt>
                    <dd>${this.user.firstName} ${this.user.lastName}</dd>
                    <dt>PUID:</dt>
                    <dd>${this.user.puid}</dd>
                    <dt>Affiliation:</dt>
                    <dd>${this.user.affiliation}</dd>
                </dl>
            </div>

            <p>Test the communication with TLEF-SERVER</p>

            <div class="button-group">
                <button id="timestampButton">Get Timestamp (Auth Required)</button>
                <button id="echoButton">Test Echo</button>
                <button id="settingsButton">Settings</button>
            </div>

            <response-display id="response"></response-display>
        `;

        // It's a good practice to attach event listeners *after* the DOM is rendered.
        this.addEventListeners();
    }

    /**
     * Finds the interactive elements within the component's shadow DOM and attaches event listeners.
     */
    addEventListeners() {
        const timestampButton = this.shadowRoot.getElementById('timestampButton');
        const echoButton = this.shadowRoot.getElementById('echoButton');
        const settingsButton = this.shadowRoot.getElementById('settingsButton');

        // We bind the `this` context to the handler functions so they can access
        // other methods of the component, like `displayResponse`.
        timestampButton.addEventListener('click', () => this.handleTimestampClick(timestampButton));
        echoButton.addEventListener('click', () => this.handleEchoClick(echoButton));
        settingsButton.addEventListener('click', () => this.handleSettingsClick());
    }

    /**
     * A helper method to interact with the <response-display> component.
     * @param {object} data - The data to be displayed.
     * @param {boolean} isError - Whether the data represents an error.
     */
    displayResponse(data, isError = false) {
        const responseDiv = this.shadowRoot.getElementById('response');
        // Call the public `show` method on our other custom element.
        responseDiv.show(data, isError);
    }

    /**
     * Handles the click event for the "Get Timestamp" button.
     * This is an `async` function because it uses `await` for the API call.
     * @param {HTMLButtonElement} button - The button element that was clicked.
     */
    async handleTimestampClick(button) {
        // Disable the button to prevent multiple clicks while the request is in progress.
        button.disabled = true;
        button.textContent = 'Loading...';

        try {
            // `fetch` is the modern browser API for making network requests. It returns a Promise.
            const response = await fetch('/api/timestamp');
            // It's crucial to check if the HTTP response was successful.
            if (!response.ok) throw new Error(`HTTP error! status: ${response.status}`);
            // `response.json()` is also an async operation that parses the JSON body.
            const data = await response.json();
            this.displayResponse(data);
        } catch (error) {
            // If anything goes wrong in the `try` block, it's caught here.
            this.displayResponse({ error: error.message }, true);
        } finally {
            // The `finally` block runs regardless of whether the `try` succeeded or failed.
            // It's the perfect place to re-enable the button and reset its text.
            button.disabled = false;
            button.textContent = 'Get Timestamp (Auth Required)';
        }
    }

    /**
     * Handles the click event for the "Test Echo" button.
     * @param {HTMLButtonElement} button - The button element that was clicked.
     */
    async handleEchoClick(button) {
        button.disabled = true;
        button.textContent = 'Loading...';

        try {
            // `prompt()` is a simple way to get user input, but it's generally not recommended
            // for production apps as it's blocking and has a dated UI.
            const message = prompt('Enter a message to echo:') || 'Hello, TLEF-SERVER!';

            // For a POST request, we need to provide more options to `fetch`.
            const response = await fetch('/api/echo', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' }, // Tell the server we're sending JSON.
                body: JSON.stringify({ message }) // The data payload must be a string.
            });
            if (!response.ok) throw new Error(`HTTP error! status: ${response.status}`);
            const data = await response.json();
            this.displayResponse(data);
        } catch (error) {
            this.displayResponse({ error: error.message }, true);
        } finally {
            button.disabled = false;
            button.textContent = 'Test Echo';
        }
    }

    /**
     * Handles the click event for the "Settings" button.
     * Dispatches a custom event to inform the parent component to navigate to the settings view.
     */
    handleSettingsClick() {
        // This custom event will bubble up through the DOM. The `BiocbotApp` component
        // will listen for this event to coordinate the view change.
        this.dispatchEvent(new CustomEvent('navigate-to-settings', { bubbles: true, composed: true }));
    }
}

export default AuthenticatedView;