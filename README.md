# BIOCBOT SAML Example Application

This project serves as an example of a Node.js web application that uses SAML for user authentication. It demonstrates how to integrate with a SAML Identity Provider (IdP) for both login (SSO) and logout (SLO), and how to manage application state based on authentication status.

See https://github.com/ubc/docker-simple-saml for the SAML provider you can run locally.

The backend is built with Express.js and Passport.js, using the `passport-saml` strategy. The frontend is built with vanilla JavaScript using Web Components.

## Project Structure

The repository is organized into two main parts:

-   `public/`: Contains all client-side code, including HTML, CSS, and JavaScript for the frontend application.
-   `src/`: Contains all server-side Node.js code, including the Express server, API routes, and authentication middleware.

---

## Backend (`src/`)

The backend is responsible for serving the frontend application, handling API requests, and managing the SAML authentication lifecycle.

### Core Files

-   **`src/server.js`**: The main entry point for the backend. It sets up the Express server, configures all middleware (including sessions and Passport), mounts the API and authentication routes, and starts the server.

### Middleware (`src/middleware/`)

Middleware functions are the backbone of the Express application, handling requests sequentially.

-   **`session.js`**: Configures `express-session` to manage user sessions. It sets up session secrets, cookie properties, and timeouts. In a production environment, the default `MemoryStore` should be replaced with a more robust session store like Redis.
-   **`passport.js`**: Configures the `passport-saml` strategy. It loads the IdP's signing certificate and defines the SAML configuration options, including the entry point (for login), logout URL, and callback URLs. It also maps the attributes from the SAML profile to a user object that is stored in the session.
-   **`requireAuth.js`**: A simple middleware that protects routes by checking if a user is authenticated (`req.isAuthenticated()`). If the user is not logged in, it returns a 401 Unauthorized error for API requests or redirects to the login page for browser requests.

### Routes (`src/routes/`)

-   **`auth.js`**: Handles all authentication-related routes.
    -   `/auth/login`: Initiates the SAML login flow by redirecting the user to the IdP.
    -   `/auth/saml/callback`: The endpoint where the IdP posts the SAML assertion after a successful login. Passport processes the assertion and creates a user session.
    -   `/auth/logout`: Initiates the SAML Single Log-Out (SLO) flow.
    -   `/auth/logout/callback`: The endpoint where the IdP redirects the user after a successful logout.
    -   `/auth/me`: An API endpoint for the frontend to check if the current user is authenticated and to get their user information.
-   **`pages.js`**: Handles serving the main `index.html` file for different client-side URLs (e.g., `/` and `/settings`). This enables the single-page application to handle routing on the client side while still allowing users to directly navigate to or refresh pages. Routes in this file are protected by the `requireAuth` middleware where necessary.
-   **`index.js`**: The main **API router**. It assembles all other API-related route files (like `timestamp.js` and `echo.js`) and is mounted under the `/api` prefix in `server.js`.
-   **`timestamp.js`**, **`echo.js`**, etc.: Example API routes that demonstrate how to create authenticated endpoints that might communicate with other backend services.

---

## Frontend (`public/`)

The frontend is a single-page application (SPA) built with modern, framework-less JavaScript. It uses Web Components to create encapsulated and reusable UI elements.

### Core Files

-   **`public/index.html`**: The main HTML file. It contains the basic page structure and a single custom element, `<biocbot-app>`, which is the root of the application.
-   **`public/app.js`**: The main entry point for the frontend JavaScript. It imports all the Web Component classes and registers them with the browser using `customElements.define()`.

### Components (`public/components/`)

-   **`BiocbotApp/`**: The root component. It manages the application's core state, including the user's authentication status and which view (`<authenticated-view>` or `<settings-view>`) is currently active. It uses the browser's History API to handle client-side routing, updating the URL as the user navigates through the application.
-   **`LoginPrompt/`**: A simple component shown to unauthenticated users. It displays a "Login" button that redirects the user to the `/auth/login` route to start the SAML flow.
-   **`AuthenticatedView/`**: The main view for logged-in users. It displays user details, provides buttons to make authenticated API calls, and includes a link to the settings page.
-   **`SettingsView/`**: A component that displays different content based on the user's affiliation (e.g., 'student' or 'faculty'). It demonstrates how to implement simple role-based access control on the frontend and includes a "Back" button to return to the main view.
-   **`ResponseDisplay/`**: A utility component used to format and display the JSON responses from the backend API calls.

## Getting Started

1.  **Clone the repository.**
2.  **Install dependencies:**
    ```bash
    npm install
    ```
3.  **Set up your environment:**
    -   Copy the `.env.example` file to a new file named `.env`.
    -   Update the variables in `.env` to match your local development environment.
4.  **Run the application:**
    ```bash
    npm start
    ```
5.  Open your browser and navigate to the URL specified by the `PORT` in your `.env` file (e.g., `http://localhost:8050`).
