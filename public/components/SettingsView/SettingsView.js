import { loadStylesheet } from '../../utils/stylesheetLoader.js';

/**
 * @class SettingsView
 * @extends HTMLElement
 * @description A custom web component to display user-specific settings.
 * The content displayed is conditional based on the user's affiliation.
 * It also provides a way to navigate back to the main authenticated view.
 */
class SettingsView extends HTMLElement {
    constructor() {
        super();
        this.attachShadow({ mode: 'open' });
        this._user = null;
    }

    /**
     * Setter for the user property. Triggers a re-render when the user object is provided.
     * @param {object} value - The user object containing affiliation and other details.
     */
    set user(value) {
        this._user = value;
        this.render();
    }

    /**
     * Getter for the user property.
     * @returns {object} The current user object.
     */
    get user() {
        return this._user;
    }

    /**
     * Called when the component is added to the DOM.
     * This is where we'll load our styles and render the initial content.
     */
    async connectedCallback() {
        // We are using adoptedStyleSheets now, which is a more modern and performant
        // way to apply styles to a shadow DOM. This also avoids the issue of the
        // <link> tag being removed when we clear the innerHTML.
        const stylesheet = await loadStylesheet('/components/SettingsView/SettingsView.css');
        this.shadowRoot.adoptedStyleSheets = [stylesheet];
        this.render();
    }

    /**
     * Determines the settings content based on the user's affiliation.
     * This demonstrates simple role-based content display on the client-side.
     * @returns {string} HTML string to be rendered.
     */
    getSettingsContent() {
        if (!this.user || !this.user.affiliation) {
            return '<p>Could not determine user affiliation.</p>';
        }

        switch (this.user.affiliation) {
            case 'student':
                return '<p>This is where the student settings will go.</p>';
            case 'faculty':
                return '<p>This is where the faculty settings will go.</p>';
            default:
                return `<p>Settings for affiliation: ${this.user.affiliation}.</p>`;
        }
    }

    /**
     * Renders the component's UI.
     */
    render() {
        // Always clear the content before re-rendering.
        // This is the key fix to prevent the duplicate content bug.
        this.shadowRoot.innerHTML = '';

        if (!this.user) {
            this.shadowRoot.innerHTML = `<p>Loading settings...</p>`;
            return;
        }

        // The component's HTML structure. We use `=` now, not `+=`.
        this.shadowRoot.innerHTML = `
            <div class="settings-view">
                <h3>Settings</h3>
                ${this.getSettingsContent()}
                <button id="backButton">Back to Main</button>
            </div>
        `;

        this.addEventListeners();
    }

    /**
     * Attaches event listeners to interactive elements in the component.
     */
    addEventListeners() {
        const backButton = this.shadowRoot.getElementById('backButton');
        if (backButton) {
            backButton.addEventListener('click', () => {
                // When the "Back" button is clicked, we dispatch a custom event.
                // The parent component (`BiocbotApp`) will listen for this event
                // to know when to switch back to the main view.
                // This is a common pattern for child-to-parent communication in Web Components.
                this.dispatchEvent(new CustomEvent('navigate-back', { bubbles: true, composed: true }));
            });
        }
    }
}

export default SettingsView;