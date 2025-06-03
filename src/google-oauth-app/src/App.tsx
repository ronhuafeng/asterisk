import React, { useEffect } from 'react';
import { GoogleOAuthProvider, useGoogleLogin, TokenResponse } from '@react-oauth/google';
import logo from './logo.svg';
import './App.css';
import { useAuth } from './AuthContext';
import MainDashboard from './components/MainDashboard'; // Import MainDashboard

const AppContent: React.FC = () => {
  const { login, logout, accessToken, userProfile, fetchUserProfile } = useAuth();

  const handleGoogleLoginSuccess = async (tokenResponse: Omit<TokenResponse, 'error' | 'error_description' | 'error_uri'>) => {
    // The TokenResponse from useGoogleLogin already has 'access_token', 'expires_in', etc.
    // We defined TokenAuthResponse in AuthContext to match this.
    // The Omit is to satisfy the type if we directly pass from useGoogleLogin,
    // but our login function expects our defined TokenAuthResponse which is compatible.
    console.log('Google Login Success:', tokenResponse);
    login(tokenResponse as TokenAuthResponse); // Cast is safe if structure matches
    // User profile will be fetched after token is stored
  };

  const handleGoogleLoginError = () => {
    console.error('Google Login Failed');
  };

  const googleLogin = useGoogleLogin({
    onSuccess: handleGoogleLoginSuccess,
    onError: handleGoogleLoginError,
    scope: "email profile https://www.googleapis.com/auth/gmail.readonly https://www.googleapis.com/auth/gmail.modify",
    flow: 'token', // Important: to get an access token directly
  });

  useEffect(() => {
    if (accessToken && !userProfile) {
      fetchUserProfile();
    }
  }, [accessToken, userProfile, fetchUserProfile]);

  const handleLogout = () => {
    logout();
    console.log('User logged out');
  };

  return (
    <div className="App">
      <header className="App-header">
        {!accessToken ? (
          <>
            <img src={logo} className="App-logo" alt="logo" />
            <p>Please login to continue.</p>
            <button onClick={() => googleLogin()} style={{ padding: '10px 20px', fontSize: '16px', cursor: 'pointer' }}>
              Sign in with Google
            </button>
          </>
        ) : (
          <div>
            {userProfile ? (
              <>
                <h3>Welcome, {userProfile.name || userProfile.given_name || 'User'}!</h3>
                {userProfile.picture && (
                  <img
                    src={userProfile.picture}
                    alt="Profile"
                    style={{ borderRadius: '50%', width: '50px', height: '50px', marginBottom: '10px' }}
                  />
                )}
                {userProfile.email && <p>Email: {userProfile.email}</p>}
              </>
            ) : (
              <p>Loading user profile...</p>
            )}
            <button onClick={handleLogout} style={{ marginTop: '10px', padding: '8px 15px', cursor: 'pointer' }}>
              Logout
            </button>
            <hr style={{margin: '20px 0', width: '100%'}} />
            <MainDashboard /> {/* Add MainDashboard here */}
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
