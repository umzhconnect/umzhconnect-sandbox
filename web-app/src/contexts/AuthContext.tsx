import React, { createContext, useContext, useEffect, useState, useCallback } from 'react';
import keycloak from '../config/keycloak';

interface AuthState {
  authenticated: boolean;
  loading: boolean;
  token?: string;
  username?: string;
  email?: string;
  roles: string[];
}

interface AuthContextType extends AuthState {
  login: () => void;
  logout: () => void;
  getToken: () => Promise<string | undefined>;
}

const AuthContext = createContext<AuthContextType>({
  authenticated: false,
  loading: true,
  roles: [],
  login: () => {},
  logout: () => {},
  getToken: async () => undefined,
});

export const useAuth = () => useContext(AuthContext);

export const AuthProvider: React.FC<{ children: React.ReactNode }> = ({ children }) => {
  const [authState, setAuthState] = useState<AuthState>({
    authenticated: false,
    loading: true,
    roles: [],
  });

  useEffect(() => {
    // keycloak-js v25+ throws synchronously if init() is called more than once.
    // Guard using the instance's own didInitialize flag (survives HMR reloads).
    if ((keycloak as unknown as { didInitialize?: boolean }).didInitialize) return;

    keycloak
      .init({
        onLoad: 'check-sso',
        silentCheckSsoRedirectUri:
          window.location.origin + '/silent-check-sso.html',
        pkceMethod: 'S256',
      })
      .then((authenticated) => {
        setAuthState({
          authenticated,
          loading: false,
          token: keycloak.token,
          username: keycloak.tokenParsed?.preferred_username,
          email: keycloak.tokenParsed?.email,
          roles: keycloak.tokenParsed?.realm_roles || [],
        });
      })
      .catch((err) => {
        console.error('Keycloak init error:', err);
        // Fall back to unauthenticated mode for development
        setAuthState({
          authenticated: false,
          loading: false,
          roles: [],
        });
      });

    // Token refresh
    const refreshInterval = setInterval(() => {
      if (keycloak.authenticated) {
        keycloak.updateToken(30).catch(() => {
          console.warn('Token refresh failed');
        });
      }
    }, 60000);

    return () => clearInterval(refreshInterval);
  }, []);

  const login = useCallback(() => {
    keycloak.login();
  }, []);

  const logout = useCallback(() => {
    keycloak.logout({ redirectUri: window.location.origin });
  }, []);

  const getToken = useCallback(async (): Promise<string | undefined> => {
    if (!keycloak.authenticated) return undefined;
    try {
      await keycloak.updateToken(30);
      return keycloak.token;
    } catch {
      return keycloak.token;
    }
  }, []);

  return (
    <AuthContext.Provider value={{ ...authState, login, logout, getToken }}>
      {children}
    </AuthContext.Provider>
  );
};
