import { loadStylesheet } from '../../utils/stylesheetLoader.js';

// Load the stylesheet for this component using the utility function.
const loginPromptSheet = await loadStylesheet('/components/LoginPrompt/LoginPrompt.css');

/**
 * @class LoginPrompt
 * @extends HTMLElement
 * @description A custom web component that displays a login message and button.
 * This component is shown to users who are not authenticated. It provides a clear
 * call-to-action to initiate the login process.
 */
class LoginPrompt extends HTMLElement {
    /**
     * The component's constructor. This is where the initial setup,
     * like creating the shadow DOM, happens.
     */
    constructor() {
        // Always call super() first in a class constructor.
        super();
        // Create a shadow root to encapsulate the component's internal DOM.
        this.attachShadow({ mode: 'open' });
        // Apply the constructed stylesheet to the shadow DOM.
        this.shadowRoot.adoptedStyleSheets = [loginPromptSheet];
    }

    /**
     * `connectedCallback` is a lifecycle method that runs when the component
     * is inserted into the DOM. It's the perfect place to render the component's content.
     */
    connectedCallback() {
        this.render();
    }

    /**
     * Renders the component's HTML structure and attaches event listeners.
     */
    render() {
        // The HTML structure is defined in a template literal.
        // The styles are now applied via `adoptedStyleSheets` in the constructor,
        // so we no longer need the <link> tag here.
        this.shadowRoot.innerHTML = `
            <div class="login-prompt">
                <p>Please log in to access BIOCBOT features.</p>
                <button id="loginButton" class="auth-button">Login with CWL</button>
            </div>
        `;

        // After rendering the HTML, we need to find the button inside our shadow DOM
        // and attach a click event listener to it.
        this.shadowRoot.getElementById('loginButton').addEventListener('click', () => {
            // When the button is clicked, we redirect the user to the /auth/login endpoint on the server.
            // The server will then handle the SAML authentication flow.
            window.location.href = '/auth/login';
        });
    }
}

export default LoginPrompt;