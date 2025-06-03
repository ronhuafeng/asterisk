# React Google OAuth Frontend Application

This directory (`src/google-oauth-app`) contains the React frontend application responsible for handling user authentication with Google OAuth and potentially interacting with Google APIs (like Gmail) on the client-side.

## Google OAuth Setup

The application uses the `@react-oauth/google` library to implement Google Sign-In.

### Configuration

**IMPORTANT**: You must configure the application with your own Google Client ID.

1.  Open the file `src/google-oauth-app/src/App.tsx`.
2.  Locate the following line:
    ```typescript
    const clientId = "YOUR_GOOGLE_CLIENT_ID.apps.googleusercontent.com";
    ```
3.  Replace `"YOUR_GOOGLE_CLIENT_ID.apps.googleusercontent.com"` with your actual Google Client ID obtained from the [Google Cloud Console](https://console.cloud.google.com/).

    Ensure your Google OAuth 2.0 Client ID is configured correctly in the Google Cloud Console, including specifying the authorized JavaScript origins (e.g., `http://localhost:3000` during development) and redirect URIs if applicable for your chosen flow.

### Requested Scopes

The application is configured to request the following Google API scopes during the OAuth flow:

*   `email`: View your email address.
*   `profile`: View your basic profile info.
*   `https://www.googleapis.com/auth/gmail.readonly`: View your Gmail messages and settings.
*   `https://www.googleapis.com/auth/gmail.modify`: Modify your Gmail messages and settings (e.g., mark as read, archive, apply labels). (Note: While requested, using this scope for API calls requires an access token, not just the ID token currently stored from `GoogleLogin` component).

These scopes are requested in `src/google-oauth-app/src/App.tsx` within the `GoogleLogin` component.

## Running the Application

To run the React frontend application:

1.  Navigate to this directory:
    ```bash
    cd src/google-oauth-app
    ```
2.  Install dependencies (if you haven't already):
    ```bash
    npm install
    ```
3.  Start the development server:
    ```bash
    npm start
    ```

This will typically open the application in your default web browser at `http://localhost:3000`.
