// src/context/AuthContext.jsx
//
// AGGIORNAMENTI RBAC:
//   - permissions[] ora viene estratto dal JWT e dallo stato
//   - hasPermission(codice) → bool, usato da componenti e route
//   - il refresh token porta i permessi aggiornati nel nuovo JWT

import {
  createContext, useContext, useState,
  useCallback, useEffect, useRef
} from "react";

const API = "http://127.0.0.1:8080";

const AuthContext = createContext(null);

export function AuthProvider({ children }) {
  const [token,        setToken]        = useState(null);
  const [user,         setUser]         = useState(null);
  const [permissions,  setPermissions]  = useState([]);   // ← NUOVO
  const [initializing, setInitializing] = useState(true);

  const isRefreshing   = useRef(false);
  const refreshPromise = useRef(null);

  const isAdmin      = user?.is_admin      ?? false;
  const isSuperAdmin = user?.is_superadmin ?? false;

  // ── Controllo permesso singolo ───────────────────────────
  // Usato ovunque nel frontend:
  //   const { hasPermission } = useAuth()
  //   if (!hasPermission("tab_log")) return null
  const hasPermission = useCallback((codice) => {
    return permissions.includes(codice);
  }, [permissions]);

  // ── Refresh token ────────────────────────────────────────
  const attemptRefresh = useCallback(async () => {
    if (isRefreshing.current) return refreshPromise.current;

    isRefreshing.current = true;
    refreshPromise.current = (async () => {
      try {
        const res = await fetch(`${API}/api/v1/auth/refresh`, {
          method:      "POST",
          credentials: "include",
        });

        if (!res.ok) {
          setToken(null);
          setUser(null);
          setPermissions([]);
          return null;
        }

        const data = await res.json();
        setToken(data.access_token);
        // ── Aggiorna permessi dal refresh ─────────────────
        if (data.permissions) {
          setPermissions(data.permissions);
        }
        return data.access_token;
      } catch {
        setToken(null);
        setUser(null);
        setPermissions([]);
        return null;
      } finally {
        isRefreshing.current  = false;
        refreshPromise.current = null;
      }
    })();

    return refreshPromise.current;
  }, []);

  // ── Carica profilo utente ────────────────────────────────
  const fetchMe = useCallback(async (accessToken) => {
    try {
      const res = await fetch(`${API}/api/v1/auth/me`, {
        headers: { Authorization: `Bearer ${accessToken}` },
      });
      if (res.ok) {
        const data = await res.json();
        setUser(data);
      }
    } catch {}
  }, []);

  // ── Inizializzazione ─────────────────────────────────────
  useEffect(() => {
    const init = async () => {
      const newToken = await attemptRefresh();
      if (newToken) {
        await fetchMe(newToken);
      }
      setInitializing(false);
    };
    init();
  }, []); // eslint-disable-line

  // ── Login ────────────────────────────────────────────────
  const login = useCallback(async (email, password) => {
    const res = await fetch(`${API}/api/v1/auth/token`, {
      method:      "POST",
      credentials: "include",
      headers:     { "Content-Type": "application/x-www-form-urlencoded" },
      body:        new URLSearchParams({
        username:   email,
        password:   password,
        grant_type: "password",
      }),
    });

    if (!res.ok) {
      const err = await res.json();
      throw new Error(err.detail || "Credenziali non valide.");
    }

    const data = await res.json();
    setToken(data.access_token);
    setUser(data.user);
    // ── Salva permessi dalla risposta login ───────────────
    setPermissions(data.permissions || []);
    return data.user;
  }, []);

  // ── Logout ───────────────────────────────────────────────
  const logout = useCallback(async () => {
    try {
      await fetch(`${API}/api/v1/auth/logout`, {
        method:      "POST",
        credentials: "include",
      });
    } catch {}
    setToken(null);
    setUser(null);
    setPermissions([]);
  }, []);

  // ── authFetch — wrapper con refresh automatico ───────────
  const authFetch = useCallback(async (url, options = {}) => {
  const fullUrl = url.startsWith("http") ? url : `${API}${url}`;
  const isFormData = options.body instanceof FormData;

  const makeRequest = (accessToken) => {
    const headers = {
      ...(options.headers || {}),
      ...(accessToken ? { Authorization: `Bearer ${accessToken}` } : {}),
    };
    if (!isFormData && !headers["Content-Type"]) {
      headers["Content-Type"] = "application/json";
    }
    return fetch(fullUrl, {
      ...options,
      credentials: "include",
      headers,
    });
  };

  let res = await makeRequest(token);
  if (res.status === 401) {
    const newToken = await attemptRefresh();
    if (!newToken) throw new Error("Sessione scaduta. Effettua nuovamente il login.");
    await fetchMe(newToken);
    res = await makeRequest(newToken);
  }
  return res;
}, [token, attemptRefresh, fetchMe]);

  // ── Loading ──────────────────────────────────────────────
  if (initializing) {
    return (
      <div style={{
        height: "100vh", display: "flex",
        alignItems: "center", justifyContent: "center",
        background: "#0d0f12", color: "#6b7280",
        fontFamily: "'DM Sans', sans-serif", fontSize: "0.85rem",
      }}>
        Caricamento…
      </div>
    );
  }

  return (
    <AuthContext.Provider value={{
      user, token, isAdmin, isSuperAdmin,
      permissions,       // ← lista grezza
      hasPermission,     // ← helper booleano
      login, logout, authFetch,
    }}>
      {children}
    </AuthContext.Provider>
  );
}

export function useAuth() {
  const ctx = useContext(AuthContext);
  if (!ctx) throw new Error("useAuth deve essere usato dentro AuthProvider");
  return ctx;
}