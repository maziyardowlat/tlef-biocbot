import { loadStylesheet } from '../../utils/stylesheetLoader.js';

// Load the stylesheet for this component using the utility function.
const responseDisplaySheet = await loadStylesheet('/components/ResponseDisplay/ResponseDisplay.css');

/**
 * @class ResponseDisplay
 * @extends HTMLElement
 * @description A custom web component to display API responses in a formatted <pre> tag.
 * It's designed to be hidden by default and can be shown by calling its `show()` method.
 * It has different visual states for successful responses and errors.
 */
class ResponseDisplay extends HTMLElement {
    /**
     * The constructor is called when a new instance of the element is created.
     * It's the first step in the component's lifecycle.
     */
    constructor() {
        // Always call super() first in the constructor to establish the correct prototype chain.
        super();

        // The Shadow DOM is a key part of Web Components. It encapsulates the component's
        // internal DOM structure, styling, and behavior, keeping it separate from the main document's DOM.
        // { mode: 'open' } means that the shadow DOM can be accessed from JavaScript outside the component
        // (e.g., this.shadowRoot). '{ mode: 'closed' }' would prevent this.
        this.attachShadow({ mode: 'open' });
        // Apply the constructed stylesheet to the shadow DOM.
        this.shadowRoot.adoptedStyleSheets = [responseDisplaySheet];
    }

    /**
     * `connectedCallback` is a standard lifecycle method for custom elements.
     * It's invoked each time the custom element is appended into a document-connected element.
     * This is the ideal place to do initial setup, like rendering the component's HTML.
     */
    connectedCallback() {
        this.render();
    }

    /**
     * Renders the component's internal HTML structure into its shadow DOM.
     * This keeps the component's structure self-contained.
     */
    render() {
        // We set the innerHTML of our shadow root.
        // The component-specific stylesheet is now applied via `adoptedStyleSheets`.
        // The <pre> and <code> tags are standard HTML for displaying preformatted code,
        // which is perfect for showing JSON responses.
        this.shadowRoot.innerHTML = `
            <pre><code></code></pre>
        `;
    }

    /**
     * A public method that makes the component visible and populates it with data.
     * This is how other components or scripts can interact with our ResponseDisplay.
     * @param {object} data - The data object (usually a JSON response) to display.
     * @param {boolean} [isError=false] - A flag to indicate if the data represents an error state.
     */
    show(data, isError = false) {
        // Find the <code> element within our shadow DOM to place the content.
        const code = this.shadowRoot.querySelector('code');

        // `JSON.stringify` converts the JavaScript object into a formatted JSON string.
        // The third argument (2) is for indentation, making the output readable.
        code.textContent = JSON.stringify(data, null, 2);

        // `classList` provides methods to manipulate the element's classes.
        // `toggle` is a convenient way to add or remove a class based on a boolean condition.
        // Here, we add the 'error' class only if isError is true.
        this.classList.toggle('error', isError);

        // We add the 'show' class to make the component visible. The CSS handles the
        // transition from `display: none` to `display: block`.
        this.classList.add('show');
    }
}

export default ResponseDisplay;