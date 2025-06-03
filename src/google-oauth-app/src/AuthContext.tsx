import React, { createContext, useState, useContext, ReactNode } from 'react';
import { jwtDecode } from 'jwt-decode'; // Corrected import

// Define a type for the user profile information extracted from the ID token
interface UserProfile {
  email: string;
  name: string;
  picture?: string; // Profile picture URL, optional
  // Add other fields you expect from the ID token payload (e.g., given_name, family_name)
  given_name?: string;
  family_name?: string;
  email_verified?: boolean;
  sub?: string; // Subject identifier
}

interface AuthContextType {
  accessToken: string | null;
  userProfile: UserProfile | null;
  login: (token: string) => void; // Removed profile from params as it's derived from token
  logout: () => void;
}

const AuthContext = createContext<AuthContextType | undefined>(undefined);

export const AuthProvider: React.FC<{ children: ReactNode }> = ({ children }) => {
  const [accessToken, setAccessToken] = useState<string | null>(null);
  const [userProfile, setUserProfile] = useState<UserProfile | null>(null);

  const login = (token: string) => {
    try {
      const decodedToken: UserProfile = jwtDecode<UserProfile>(token);
      setAccessToken(token);
      setUserProfile({
        email: decodedToken.email,
        name: decodedToken.name,
        picture: decodedToken.picture,
        given_name: decodedToken.given_name,
        family_name: decodedToken.family_name,
        email_verified: decodedToken.email_verified,
        sub: decodedToken.sub,
      });
      // console.log("Decoded Token: ", decodedToken);
      // Optionally, you can store the token in localStorage or sessionStorage here
      // localStorage.setItem('accessToken', token);
    } catch (error) {
      console.error("Failed to decode token or set user profile:", error);
      // Handle error, maybe logout or clear state
      setAccessToken(null);
      setUserProfile(null);
    }
  };

  const logout = () => {
    setAccessToken(null);
    setUserProfile(null);
    // Optionally, remove the token from storage
    // localStorage.removeItem('accessToken');
  };

  return (
    <AuthContext.Provider value={{ accessToken, userProfile, login, logout }}>
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
