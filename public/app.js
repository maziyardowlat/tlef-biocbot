/**
 * BIOCBOT Frontend Component Registrar
 *
 * This file is the main entry point for the frontend application. Its primary
 * responsibility is to define all the custom elements (Web Components) used in
 * the application, effectively telling the browser what class to instantiate
 * for a given HTML tag (e.g., `<biocbot-app>`).
 *
 * The actual application logic (like checking auth status) is not triggered
 * from this file. Instead, it's initiated by the `connectedCallback` lifecycle
 * method within the components themselves (e.g., in BiocbotApp.js), which is
 * the standard and best practice for component-based architectures.
 */

// Import the JavaScript class for each component.
// The paths are relative to this file's location.
import BiocbotApp from './components/BiocbotApp/BiocbotApp.js';
import LoginPrompt from './components/LoginPrompt/LoginPrompt.js';
import AuthenticatedView from './components/AuthenticatedView/AuthenticatedView.js';
import ResponseDisplay from './components/ResponseDisplay/ResponseDisplay.js';
import SettingsView from './components/SettingsView/SettingsView.js';

// The `customElements.define()` method registers a new custom element with the browser.
// The first argument is the HTML tag name for the element (which must contain a hyphen).
// The second argument is the JavaScript class that controls its behavior.
customElements.define('biocbot-app', BiocbotApp);
customElements.define('login-prompt', LoginPrompt);
customElements.define('authenticated-view', AuthenticatedView);
customElements.define('response-display', ResponseDisplay);
customElements.define('settings-view', SettingsView);