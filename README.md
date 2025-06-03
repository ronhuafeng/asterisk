# Gmail Smart Processor

This application automates Gmail processing using the Gmail API. It features:
- OAuth2 authentication for Gmail.
- Upload of `credentials.json` via a web UI.
- Encrypted storage of `token.json`.
- Configurable email processing rules via `rules.json`.
- A health check endpoint at `/health`.
- Docker support.

## Prerequisites

- Node.js (v14+ recommended)
- npm
- Docker (for Docker deployment)

## Setup

1.  **Clone the repository.**
2.  **Install dependencies:**
    ```bash
    npm install
    ```
3.  **Obtain `credentials.json`:**
    Follow the Google Cloud Console steps to create OAuth 2.0 credentials for a Desktop App or Web Application. Download the `credentials.json` file.
    - If using "Web application", ensure the authorized redirect URI is set to `http://localhost:3000/oauth2callback` (or your deployed app's equivalent).

## Running the Application

### Locally

1.  **Set Encryption Key (Recommended):**
    For better security, set an environment variable for the token encryption key:
    ```bash
    export ENCRYPTION_KEY="your-custom-strong-encryption-key"
    ```
    If not set, a default key will be used (less secure).
2.  **Start the application:**
    ```bash
    node app.js
    ```
3.  Open your browser and navigate to `http://localhost:3000/`.
4.  Upload your `credentials.json` file.
5.  Follow the console instructions to authorize the application with Google.
6.  Once authorized, the application will start polling your Gmail account.

### Using Docker

1.  **Build the Docker image:**
    ```bash
    docker build -t gmail-processor .
    ```

2.  **Run the Docker container:**
    ```bash
    docker run -p 3000:3000 \
               -v $(pwd)/token.json:/usr/src/app/token.json \
               -v $(pwd)/credentials.json:/usr/src/app/credentials.json \
               -v $(pwd)/rules.json:/usr/src/app/rules.json \
               -e ENCRYPTION_KEY="your-custom-strong-encryption-key" \
               -e POLLING_INTERVAL_MIN=1 \
               gmail-processor
    ```
    **Explanation of Docker run command:**
    - `-p 3000:3000`: Maps port 3000 on your host to port 3000 in the container.
    - `-v $(pwd)/token.json:/usr/src/app/token.json`: Mounts `token.json` from your current directory into the container. This allows the token to persist across container restarts. Create an empty `token.json` file locally first if it doesn't exist (`touch token.json`).
    - `-v $(pwd)/credentials.json:/usr/src/app/credentials.json`: Mounts `credentials.json`. **Important**: Ensure this file exists in your current directory before running.
    - `-v $(pwd)/rules.json:/usr/src/app/rules.json`: Mounts `rules.json` for custom rule configuration. Ensure this file exists.
    - `-e ENCRYPTION_KEY="your-custom-strong-encryption-key"`: Sets the encryption key as an environment variable. **Replace with a strong, unique key.**
    - `-e POLLING_INTERVAL_MIN=1`: (Optional) Sets the polling interval.
    - `gmail-processor`: The name of the image to run.

    **Note on Volumes:** Mounting `credentials.json`, `token.json`, and `rules.json` as volumes is recommended for managing these files outside the container lifecycle. If `credentials.json` is not mounted, you'll need to use the upload feature after the container starts, but `token.json` will still need a persistent volume to avoid re-authorization on every restart.

3.  Access the application at `http://localhost:3000/`. If `credentials.json` was mounted, the app might start authorization automatically or use an existing `token.json`. If not mounted, use the UI to upload `credentials.json`.

## API Endpoints

-   `GET /`: Serves the HTML page for uploading credentials.
-   `POST /upload-credentials`: Endpoint for uploading `credentials.json`.
-   `GET /oauth2callback`: Callback URL for Google OAuth2.
-   `GET /health`: Health check endpoint. Returns application status.

## Configuration

-   **Polling Interval**: Set the `POLLING_INTERVAL_MIN` environment variable (default is 1 minute).
-   **Encryption Key**: Set the `ENCRYPTION_KEY` environment variable for securing `token.json`.
-   **Email Rules**: Modify `rules.json` to define custom email processing logic.
```
