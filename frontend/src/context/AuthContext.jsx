// src/context/AuthContext.jsx
//
// FIX TOKEN SCADUTO — comportamento corretto:
//
// PROBLEMA PRECEDENTE:
// attemptRefresh() nel blocco catch (errore di rete) chiamava:
//   setToken(null); setUser(null); setPermissions([]);
// Questo causava il LOGOUT dell'utente anche quando il backend era
// temporaneamente irraggiungibile (es. restart server, rete instabile).
// L'utente veniva sloggato senza motivo e doveva rifare il login.
//
// FIX APPLICATO:
// - Errore di RETE (catch) → NON slogga, mantiene lo stato corrente.
//   Il JWT scadrà naturalmente dopo ACCESS_TOKEN_MINUTES. L'utente
//   riceverà un errore sulla prossima chiamata API ma non verrà sloggato.
// - Risposta HTTP 401 dal server (res.ok === false) → slogga correttamente,
//   perché significa che il refresh token è scaduto o revocato.
// - Risposta HTTP 4xx/5xx diversa da 401 → NON slogga (errore server temporaneo).
//
// COMPORTAMENTO RISULTANTE:
// - Token JWT scaduto + backend online → refresh automatico trasparente ✓
// - Token JWT scaduto + backend offline → l'utente rimane loggato,
//   le chiamate API falliscono con errore di rete ma senza logout ✓
// - Refresh token scaduto/revocato → logout corretto ✓
// - Sessione "logout-all" (cambio password) → logout corretto ✓

import {
  createContext, useContext, useState,
  useCallback, useEffect, useRef
} from "react";

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
  // FIX: distingue tra errore di rete (non slogga) e 401 (slogga).
  const attemptRefresh = useCallback(async () => {
    if (isRefreshing.current) return refreshPromise.current;

    isRefreshing.current = true;
    refreshPromise.current = (async () => {
      try {
        const res = await fetch(`${API}/api/v1/auth/refresh`, {
          method:      "POST",
          credentials: "include",
        });

        if (res.status === 401) {
          // Refresh token scaduto o revocato → logout corretto
          setToken(null);
          setUser(null);
          setPermissions([]);
          return null;
        }

        if (!res.ok) {
          // Altro errore HTTP (5xx, ecc.) → non slogga, errore temporaneo del server
          // Il token corrente rimane valido fino alla sua scadenza naturale
          return null;
        }

        const data = await res.json();
        setToken(data.access_token);
        if (data.permissions) {
          setPermissions(data.permissions);
        }
        return data.access_token;

      } catch {
        // FIX PRINCIPALE: errore di RETE (backend irraggiungibile, timeout, ecc.)
        // → NON slogghiamo l'utente. Il JWT corrente rimane nello stato.
        // Le singole chiamate API restituiranno errori di rete che il componente
        // può gestire localmente, ma l'utente NON viene disconnesso.
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
  // FIX: su 401, tenta il refresh. Se il refresh restituisce null
  // per errore di RETE (non 401), non rilanciamo "Sessione scaduta"
  // ma usiamo il token corrente per un altro tentativo.
  // Solo se il secondo tentativo ritorna 401 allora trattiamo come
  // sessione scaduta.
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
      // Token scaduto → tenta refresh
      const newToken = await attemptRefresh();

      if (newToken) {
        // Refresh riuscito → aggiorna profilo e riprova la richiesta
        await fetchMe(newToken);
        res = await makeRequest(newToken);
      } else {
        // FIX: il refresh potrebbe aver fallito per rete (newToken = null)
        // senza aver sloggato l'utente. Riprova con il token corrente
        // (potrebbe essere ancora valido se il 401 era un glitch).
        // Se fallisce di nuovo, rilancia l'errore.
        res = await makeRequest(token);
        if (res.status === 401) {
          // Ora è definitivamente scaduto → logout
          setToken(null);
          setUser(null);
          setPermissions([]);
          throw new Error("Sessione scaduta. Effettua nuovamente il login.");
        }
      }
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