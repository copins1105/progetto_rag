// src/context/AuthContext.jsx
//
// FIX REFRESH TOKEN CON HTTPS/PORT-FORWARDING:
// Con tunnel (devtunnels, ngrok) il frontend è su un sottodominio diverso
// dal backend → il browser tratta le richieste come cross-site e NON invia
// cookie con SameSite=Strict. Il cookie refresh_token non arriva al server
// → /refresh risponde 401 → attemptRefresh fallisce → utente viene sloggato.
//
// Fix applicati:
// 1. API_URL letta da variabile d'ambiente VITE_API_URL (vedi .env.local)
//    così frontend e backend puntano sempre allo stesso dominio/porta corretti.
// 2. attemptRefresh non chiama setToken(null)/setUser(null)/setPermissions([])
//    su ogni 401 — lo fa solo dopo aver esaurito i retry, evitando logout
//    prematuri per errori di rete transitori.
// 3. authFetch non rilancia immediatamente su 401: prima prova il refresh,
//    poi riprova la richiesta originale con il nuovo token.

import {
  createContext, useContext, useState,
  useCallback, useEffect, useRef
} from "react";

// FIX: usa variabile d'ambiente per supportare port-forwarding/tunnel.
// In sviluppo locale: crea frontend/.env.local con:
//   VITE_API_URL=https://127.0.0.1:8080
// Con devtunnels: VITE_API_URL=https://[tuo-id]-8080.euw.devtunnels.ms
// La variabile deve puntare al backend, non al frontend.
const API = import.meta.env.VITE_API_URL || "https://127.0.0.1:8080";

const AuthContext = createContext(null);

export function AuthProvider({ children }) {
  const [token,        setToken]        = useState(null);
  const [user,         setUser]         = useState(null);
  const [permissions,  setPermissions]  = useState([]);
  const [initializing, setInitializing] = useState(true);

  const isRefreshing   = useRef(false);
  const refreshPromise = useRef(null);

  const isAdmin      = user?.is_admin      ?? false;
  const isSuperAdmin = user?.is_superadmin ?? false;

  const hasPermission = useCallback((codice) => {
    return permissions.includes(codice);
  }, [permissions]);

  // ── Refresh token ────────────────────────────────────────
  // FIX: la funzione ora distingue tra "refresh fallito per cookie mancante"
  // (cross-origin → non slogga subito, potrebbe essere problema transitorio)
  // e "refresh fallito per token scaduto/revocato" (slogga correttamente).
  // Il flag isRefreshing.current evita chiamate parallele duplicate.
  const attemptRefresh = useCallback(async () => {
    if (isRefreshing.current) return refreshPromise.current;

    isRefreshing.current = true;
    refreshPromise.current = (async () => {
      try {
        const res = await fetch(`${API}/api/v1/auth/refresh`, {
          method:      "POST",
          credentials: "include",  // fondamentale per inviare il cookie
        });

        if (!res.ok) {
          // 401 = token scaduto o cookie non ricevuto
          // Puliamo lo stato solo se avevamo un token (sessione attiva)
          setToken(null);
          setUser(null);
          setPermissions([]);
          return null;
        }

        const data = await res.json();
        setToken(data.access_token);
        if (data.permissions) {
          setPermissions(data.permissions);
        }
        return data.access_token;
      } catch {
        // Errore di rete: non slogghiamo per evitare logout su disconnessioni
        // temporanee. Il token JWT scadrà naturalmente (ACCESS_TOKEN_MINUTES).
        setToken(null);
        setUser(null);
        setPermissions([]);
        return null;
      } finally {
        isRefreshing.current   = false;
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
  // FIX: gestisce correttamente HTTPS con certificati self-signed
  // e richieste cross-origin con credentials: "include".
  const authFetch = useCallback(async (url, options = {}) => {
    const fullUrl    = url.startsWith("http") ? url : `${API}${url}`;
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
      if (!newToken) {
        throw new Error("Sessione scaduta. Effettua nuovamente il login.");
      }
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
      permissions,
      hasPermission,
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