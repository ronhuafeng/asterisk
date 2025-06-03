import React, { createContext, useState, useContext, ReactNode } from 'react';
// import { jwtDecode } from 'jwt-decode'; // Will be removed as access token is not a JWT

// This interface is based on the object returned by useGoogleLogin's onSuccess callback
// when using flow: 'token'.
export interface TokenAuthResponse {
  access_token: string;
  expires_in: number;
  scope: string;
  token_type: string;
  // It might also include id_token if 'openid' scope is requested and flow allows,
  // but with flow: 'token', id_token is not guaranteed or primary.
  // For profile info, a separate call to userinfo endpoint is better.
  id_token?: string;
}

// Define a type for the user profile information
// This would typically be fetched from a /userinfo endpoint using the access token
export interface UserProfile {
  email?: string;
  name?: string;
  picture?: string;
  given_name?: string;
  family_name?: string;
  sub?: string; // Subject identifier (user ID)
}

interface AuthContextType {
  accessToken: string | null;
  userProfile: UserProfile | null;
  login: (tokenResponse: TokenAuthResponse) => void;
  logout: () => void;
  fetchUserProfile: () => Promise<void>; // New function to fetch user profile
}

const AuthContext = createContext<AuthContextType | undefined>(undefined);

export const AuthProvider: React.FC<{ children: ReactNode }> = ({ children }) => {
  const [accessToken, setAccessToken] = useState<string | null>(null);
  const [userProfile, setUserProfile] = useState<UserProfile | null>(null);

  const login = (tokenResponse: TokenAuthResponse) => {
    setAccessToken(tokenResponse.access_token);
    setUserProfile(null); // Clear previous profile, new one needs to be fetched
    // console.log("Access Token stored:", tokenResponse.access_token);
    // localStorage.setItem('accessToken', tokenResponse.access_token);
    // User profile should be fetched using the new access token via fetchUserProfile
  };

  const fetchUserProfile = async () => {
    if (!accessToken) {
      // console.log("No access token, cannot fetch profile.");
      return;
    }
    try {
      const response = await fetch('https://www.googleapis.com/oauth2/v3/userinfo', {
        headers: {
          'Authorization': `Bearer ${accessToken}`,
        },
      });
      if (!response.ok) {
        throw new Error(`Failed to fetch user profile: ${response.status} ${response.statusText}`);
      }
      const profileData: UserProfile = await response.json();
      setUserProfile(profileData);
      // console.log("User profile fetched:", profileData);
    } catch (error) {
      console.error("Error fetching user profile:", error);
      setUserProfile(null); // Clear profile on error
    }
  };

  const logout = () => {
    setAccessToken(null);
    setUserProfile(null);
    // localStorage.removeItem('accessToken');
  };

  return (
    <AuthContext.Provider value={{ accessToken, userProfile, login, logout, fetchUserProfile }}>
      {children}
    </AuthContext.Provider>
  );
};

export const useAuth = (): AuthContextType => {
  const context = useContext(AuthContext);
  if (context === undefined) {
    throw new Error('useAuth must be used within an AuthProvider');
  }
  return context;
};
