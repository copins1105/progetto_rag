// src/context/AuthContext.jsx
//
// ARCHITETTURA TOKEN NEL FRONTEND:
//
//   Access token  → stato React in memoria
//                   mai localStorage (vulnerabile a XSS)
//                   perso al refresh pagina → normale,
//                   il refresh token nel cookie lo rinnova
//
//   Refresh token → cookie httpOnly gestito dal browser
//                   JS non può leggerlo né modificarlo
//                   inviato automaticamente su /api/v1/auth/*
//
// FLUSSO AL CARICAMENTO PAGINA:
//   1. Access token = null (perso al refresh)
//   2. AuthContext chiama /auth/refresh al mount
//   3. Il browser invia il cookie httpOnly automaticamente
//   4. Il backend risponde con nuovo access token
//   5. L'utente è autenticato senza aver fatto login
//
// FLUSSO RICHIESTA CON TOKEN SCADUTO:
//   1. authFetch riceve 401 da qualsiasi endpoint
//   2. Chiama /auth/refresh automaticamente
//   3. Ottiene nuovo access token
//   4. Riprova la richiesta originale
//   5. Tutto trasparente per l'utente

import {
  createContext, useContext, useState,
  useCallback, useEffect, useRef
} from "react";

const API = "http://127.0.0.1:8080";

const AuthContext = createContext(null);

export function AuthProvider({ children }) {
  const [token,        setToken]        = useState(null);
  const [user,         setUser]         = useState(null);
  const [initializing, setInitializing] = useState(true);

  // Ref per evitare loop infiniti durante il refresh
  const isRefreshing   = useRef(false);
  const refreshPromise = useRef(null);

  const isAdmin      = user?.is_admin      ?? false;
  const isSuperAdmin = user?.is_superadmin ?? false;

  // ── Refresh token → nuovo access token ──────────────────
  // Chiamato:
  //   1. Al mount (ripristino sessione dopo reload pagina)
  //   2. Quando authFetch riceve 401 (token scaduto)
  //
  // Se ci sono più richieste simultanee che scadono insieme,
  // isRefreshing garantisce che il refresh avvenga UNA SOLA VOLTA
  // e tutte le richieste attendano lo stesso promise.
  const attemptRefresh = useCallback(async () => {
    // Se il refresh è già in corso, attendi lo stesso promise
    if (isRefreshing.current) return refreshPromise.current;

    isRefreshing.current = true;
    refreshPromise.current = (async () => {
      try {
        const res = await fetch(`${API}/api/v1/auth/refresh`, {
          method:      "POST",
          credentials: "include",  // invia il cookie httpOnly
        });

        if (!res.ok) {
          // Refresh fallito → sessione scaduta, logout
          setToken(null);
          setUser(null);
          return null;
        }

        const data = await res.json();
        setToken(data.access_token);
        return data.access_token;
      } catch {
        setToken(null);
        setUser(null);
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
    } catch {
      // silenzioso — non critico
    }
  }, []);

  // ── Inizializzazione: prova a ripristinare la sessione ───
  // Al mount, se c'è un refresh token valido nel cookie
  // (il browser lo invia automaticamente), otteniamo un
  // nuovo access token senza chiedere credenziali.
  useEffect(() => {
    const init = async () => {
      const newToken = await attemptRefresh();
      if (newToken) {
        await fetchMe(newToken);
      }
      setInitializing(false);
    };
    init();
  }, []); // eslint-disable-line react-hooks/exhaustive-deps

  // ── Login ────────────────────────────────────────────────
  // OAuth2 standard: form-encoded, non JSON.
  // Il campo si chiama "username" per standard OAuth2
  // ma ci mettiamo l'email.
  const login = useCallback(async (email, password) => {
    const res = await fetch(`${API}/api/v1/auth/token`, {
      method:      "POST",
      credentials: "include",   // riceve il cookie httpOnly
      headers:     { "Content-Type": "application/x-www-form-urlencoded" },
      body:        new URLSearchParams({
        username:   email,       // standard OAuth2 = "username"
        password:   password,
        grant_type: "password",  // standard OAuth2 obbligatorio
      }),
    });

    if (!res.ok) {
      const err = await res.json();
      throw new Error(err.detail || "Credenziali non valide.");
    }

    const data = await res.json();
    setToken(data.access_token);
    setUser(data.user);
    return data.user;
  }, []);

  // ── Logout ───────────────────────────────────────────────
  const logout = useCallback(async () => {
    try {
      await fetch(`${API}/api/v1/auth/logout`, {
        method:      "POST",
        credentials: "include",  // invia cookie per la revoca
      });
    } catch {
      // anche se la chiamata fallisce, puliamo lo stato locale
    }
    setToken(null);
    setUser(null);
  }, []);

  // ── authFetch — wrapper con refresh automatico ───────────
  // Ogni richiesta autenticata passa da qui.
  // Se riceve 401, tenta il refresh una volta.
  // Se il refresh fallisce, fa logout.
  const authFetch = useCallback(async (url, options = {}) => {
    const fullUrl = url.startsWith("http") ? url : `${API}${url}`;

    const makeRequest = (accessToken) => fetch(fullUrl, {
      ...options,
      credentials: "include",
      headers: {
        "Content-Type": "application/json",
        ...(options.headers || {}),
        ...(accessToken ? { Authorization: `Bearer ${accessToken}` } : {}),
      },
    });

    // Prima richiesta con il token attuale
    let res = await makeRequest(token);

    // 401 → prova refresh una volta
    if (res.status === 401) {
      const newToken = await attemptRefresh();
      if (!newToken) {
        // Refresh fallito → sessione scaduta
        throw new Error("Sessione scaduta. Effettua nuovamente il login.");
      }
      await fetchMe(newToken);
      // Riprova con il nuovo token
      res = await makeRequest(newToken);
    }

    return res;
  }, [token, attemptRefresh, fetchMe]);

  // ── Mostra loading durante l'inizializzazione ────────────
  // Evita il flash "non autenticato" mentre /auth/refresh
  // è ancora in corso al caricamento della pagina
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
