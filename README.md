# Project: Gmail API Integration with React Frontend

This project demonstrates integration with the Gmail API, featuring a Node.js backend (`app.js`) and a React frontend application (`src/google-oauth-app`) for user authentication and interaction.

## User Authentication (Frontend)

User authentication with Google (OAuth 2.0) is now primarily handled by the **React application** located in the `src/google-oauth-app` directory. This application uses the `@react-oauth/google` library for a client-side OAuth flow.

For detailed instructions on configuring and running the frontend, including setting up your Google Client ID and understanding requested API scopes, please refer to the frontend's specific README:
[**`src/google-oauth-app/README.md`**](./src/google-oauth-app/README.md)

## Backend (`app.js`)

The Node.js application (`app.js`) previously included functionality for server-side Google OAuth 2.0 authentication and a polling mechanism to periodically fetch and process Gmail messages.

**Important Changes to `app.js`**:
*   **Server-Side OAuth Removed**: The user-facing server-side OAuth flow (including handling of `/oauth2callback`, token storage, etc.) has been removed from `app.js`. This responsibility is now with the React frontend.
*   **Email Polling Disabled**: Consequently, the email polling and processing features (`pollAndProcess`, `startPolling`) which relied on the server-side OAuth client are currently **disabled** and require re-evaluation or re-implementation if server-side processing is still desired.
*   **Current Role**: `app.js` currently serves as a basic Express server. It may be extended in the future to provide API endpoints that the React frontend can securely call (e.g., for operations requiring server-side logic or protected API keys not suitable for client-side exposure).

## Running the Backend

To run the backend server (though with limited functionality due to the changes above):

1.  Ensure Node.js is installed.
2.  Install dependencies:
    ```bash
    npm install
    ```
3.  Start the server:
    ```bash
    node app.js
    ```
    (or `nodemon app.js` if you have nodemon installed for automatic restarts)

The server typically listens on port 3000 (or as specified by the `PORT` environment variable).
