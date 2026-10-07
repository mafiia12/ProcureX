import { createContext, useCallback, useContext, useEffect, useMemo, useState } from 'react';

import { setUnauthorizedHandler } from '../services/api';
import { login, logout, restoreSession } from '../services/auth';
import { clearSession } from '../services/storage';

const AuthContext = createContext(null);

export function AuthProvider({ children }) {
  const [user, setUser] = useState(null);
  const [isLoading, setIsLoading] = useState(true);

  const signOutLocally = useCallback(async () => {
    await clearSession();
    setUser(null);
  }, []);

  useEffect(() => {
    setUnauthorizedHandler(signOutLocally);
    restoreSession()
      .then(setUser)
      .catch(() => setUser(null))
      .finally(() => setIsLoading(false));
    return () => setUnauthorizedHandler(null);
  }, [signOutLocally]);

  const signIn = useCallback(async (username, password) => {
    const result = await login(username, password);
    if (result.success) setUser(result.user);
    return result;
  }, []);

  const signOut = useCallback(async () => {
    await logout();
    setUser(null);
  }, []);

  const value = useMemo(
    () => ({ user, isLoading, isLoggedIn: !!user, signIn, signOut }),
    [user, isLoading, signIn, signOut]
  );

  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>;
}

export function useAuth() {
  const context = useContext(AuthContext);
  if (!context) throw new Error('useAuth must be used inside AuthProvider');
  return context;
}
