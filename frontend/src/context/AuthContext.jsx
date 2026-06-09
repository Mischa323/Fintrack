import { createContext, useContext, useState, useEffect, useCallback } from "react";
import api from "../api/client";

const AuthContext = createContext(null);

function parseToken(token) {
  if (!token) return null;
  try {
    return JSON.parse(atob(token.split(".")[1]));
  } catch {
    return null;
  }
}

export function AuthProvider({ children }) {
  const [token, setToken] = useState(() => localStorage.getItem("fintrack_token"));
  const [status, setStatus] = useState(null); // { isSetup, oidcEnabled }
  const [loading, setLoading] = useState(true);

  const user = parseToken(token); // { userId, username, role }

  const fetchStatus = useCallback(async () => {
    try {
      const res = await api.get("/auth/status");
      setStatus(res.data);
    } catch {
      setStatus({ isSetup: false, oidcEnabled: false });
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => { fetchStatus(); }, [fetchStatus]);

  const login = useCallback((newToken) => {
    localStorage.setItem("fintrack_token", newToken);
    setToken(newToken);
  }, []);

  const logout = useCallback(() => {
    localStorage.removeItem("fintrack_token");
    setToken(null);
  }, []);

  const refreshStatus = useCallback(() => fetchStatus(), [fetchStatus]);

  return (
    <AuthContext.Provider value={{ token, user, status, loading, login, logout, refreshStatus }}>
      {children}
    </AuthContext.Provider>
  );
}

export function useAuth() {
  return useContext(AuthContext);
}
