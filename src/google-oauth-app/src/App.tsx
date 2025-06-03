import React from 'react';
import { GoogleOAuthProvider, GoogleLogin, CredentialResponse } from '@react-oauth/google';
import logo from './logo.svg';
import './App.css';
import { useAuth } from './AuthContext'; // Import useAuth

const AppContent: React.FC = () => {
  const { login, logout, accessToken, userProfile } = useAuth(); // Use useAuth hook, add userProfile

  const handleLoginSuccess = (credentialResponse: CredentialResponse) => {
    console.log('Login Success:', credentialResponse);
    if (credentialResponse.credential) {
      login(credentialResponse.credential); // Call login from AuthContext
      // At this point, credentialResponse.credential is an ID token.
      // For fetching user profile, you might need to decode it (if it contains profile info)
      // or use it with Google's API if it were an access token.
      // The @react-oauth/google library is primarily for authentication.
      // To get user profile, you might need another call or ensure profile scopes were requested
      // if using a flow that returns an access token for Google People API.
      // For now, we are storing the ID token as 'accessToken'.
    } else {
      console.error("Login Success, but no credential received.");
    }
  };

  const handleLoginError = () => {
    console.log('Login Failed');
  };

  const handleLogout = () => {
    logout(); // Call logout from AuthContext
    console.log('User logged out');
  };

  return (
    <div className="App">
      <header className="App-header">
        <img src={logo} className="App-logo" alt="logo" />
        <p>
          Edit <code>src/App.tsx</code> and save to reload.
        </p>
        <a
          className="App-link"
          href="https://reactjs.org"
          target="_blank"
          rel="noopener noreferrer"
        >
          Learn React
        </a>
        <br />
        {!accessToken ? (
          <GoogleLogin
            onSuccess={handleLoginSuccess}
            onError={handleLoginError}
            scope="email profile https://www.googleapis.com/auth/gmail.readonly https://www.googleapis.com/auth/gmail.modify"
            // useOneTap // Uncomment to enable One Tap sign-in
          />
        ) : (
          <div>
            <div>
              <h3>Welcome, {userProfile?.name || userProfile?.given_name || 'User'}!</h3>
              {userProfile?.picture && (
                <img
                  src={userProfile.picture}
                  alt="Profile"
                  style={{ borderRadius: '50%', width: '50px', height: '50px', marginBottom: '10px' }}
                />
              )}
              {userProfile?.email && <p>Email: {userProfile.email}</p>}
              {/* <p>Access Token (ID Token): {accessToken}</p> */}
              <button onClick={handleLogout} style={{ marginTop: '10px', padding: '8px 15px', cursor: 'pointer' }}>
                Logout
              </button>
            </div>
          </div>
        )}
      </header>
    </div>
  );
};

const App: React.FC = () => {
  // IMPORTANT: Replace with your actual Google Client ID
  const clientId = "YOUR_GOOGLE_CLIENT_ID.apps.googleusercontent.com";
  // Ensure this client ID is configured for OAuth 2.0 and the correct redirect URIs are set
  // in your Google Cloud Console project (e.g., http://localhost:3000)

  if (!clientId || clientId === "YOUR_GOOGLE_CLIENT_ID.apps.googleusercontent.com") {
    console.error("Please replace YOUR_GOOGLE_CLIENT_ID.apps.googleusercontent.com with your actual Google Client ID in App.tsx");
    return (
      <div style={{ padding: '20px', textAlign: 'center', color: 'red', backgroundColor: '#ffe0e0', border: '1px solid red' }}>
        <h1>Configuration Error</h1>
        <p>Please replace <code>YOUR_GOOGLE_CLIENT_ID.apps.googleusercontent.com</code> with your actual Google Client ID in <code>src/App.tsx</code>.</p>
        <p>You need to create OAuth 2.0 credentials in the Google Cloud Console.</p>
      </div>
    );
  }

  return (
    <GoogleOAuthProvider clientId={clientId}>
      <AppContent />
    </GoogleOAuthProvider>
  );
}

export default App;
