import { createContext, useCallback, useContext, useEffect, useMemo, useState } from "react";
import api from "@/lib/api";

const AuthContext = createContext(null);
const TOKEN_KEY = "procurex-auth-token";

export const getStoredAuthToken = () =>
  (typeof window !== "undefined" ? window.localStorage.getItem(TOKEN_KEY) : "") || "";

export function AuthProvider({ children }) {
  const [token, setToken] = useState(() => getStoredAuthToken());
  const [user, setUser] = useState(null);
  // "checking" only while a stored token still needs to be verified against
  // the backend; "anonymous"/"authenticated" are both immediately known.
  const [status, setStatus] = useState(() => (getStoredAuthToken() ? "checking" : "anonymous"));

  useEffect(() => {
    // Mount-only: restore a session left over from a previous page load.
    // login()/logout() already set token/user/status themselves in one
    // shot, so this must not re-run on every token change - re-running it
    // there would fire a redundant /auth/me right after every login.
    if (!token) {
      return;
    }
    let cancelled = false;
    api.get("/auth/me").then(({ data }) => {
      if (cancelled) return;
      setUser(data);
      setStatus("authenticated");
    }).catch(() => {
      if (cancelled) return;
      window.localStorage.removeItem(TOKEN_KEY);
      setToken("");
      setUser(null);
      setStatus("anonymous");
    });
    return () => {
      cancelled = true;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const login = useCallback(async (username, password) => {
    const { data } = await api.post("/auth/login", { username, password });
    window.localStorage.setItem(TOKEN_KEY, data.access_token);
    setUser(data.user);
    setToken(data.access_token);
    setStatus("authenticated");
    return data.user;
  }, []);

  const logout = useCallback(() => {
    // Stateless JWT: this only discards the local token, it does not call
    // the backend or revoke the token before it expires (see auth/security.py).
    window.localStorage.removeItem(TOKEN_KEY);
    setToken("");
    setUser(null);
    setStatus("anonymous");
  }, []);

  const value = useMemo(
    () => ({ user, status, login, logout, isAuthenticated: status === "authenticated" }),
    [user, status, login, logout],
  );

  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>;
}

export const useAuth = () => {
  const value = useContext(AuthContext);
  if (!value) throw new Error("useAuth must be used inside AuthProvider");
  return value;
};

// Read-only surfaces that are also rendered in isolated previews/tests can
// use this without weakening the guarded application routes.
export const useOptionalAuth = () => useContext(AuthContext);
