// src/context/IngestionContext.jsx
//
// Context globale per i job di ingestion E loader.
// Usa authFetch da AuthContext per inviare il token JWT.
//
// jobs       → job pipeline (marker → chunker)
// loaderJobs → job loader (ChromaDB + PostgreSQL)

import {
  createContext, useContext, useState,
  useCallback, useEffect, useRef
} from "react";
import { useAuth } from "./AuthContext";

const WS = "ws://127.0.0.1:8080";

const IngestionContext = createContext(null);

export function IngestionProvider({ children }) {
  const { authFetch, token } = useAuth();

  // ── Job pipeline (ingestion: marker + chunker) ────────────
  const [jobs, setJobs]             = useState({});
  // ── Job loader (ChromaDB + PostgreSQL) ────────────────────
  const [loaderJobs, setLoaderJobs] = useState({});

  const wsMap = useRef({});

  // ─────────────────────────────────────────────
  // HELPERS AGGIORNAMENTO STATO
  // ─────────────────────────────────────────────

  const updateJob = useCallback((filename, update) => {
    setJobs(prev => {
      const current = prev[filename] || { status: null, logs: [] };
      return {
        ...prev,
        [filename]: {
          status: update.status !== undefined ? update.status : current.status,
          logs: update.appendLog
            ? [...current.logs, update.appendLog]
            : update.logs !== undefined ? update.logs : current.logs,
        },
      };
    });
  }, []);

  const updateLoaderJob = useCallback((filename, update) => {
    setLoaderJobs(prev => {
      const current = prev[filename] || { status: null, logs: [], duplicato: null };
      return {
        ...prev,
        [filename]: {
          status:    update.status    !== undefined ? update.status    : current.status,
          duplicato: update.duplicato !== undefined ? update.duplicato : current.duplicato,
          logs: update.appendLog
            ? [...current.logs, update.appendLog]
            : update.logs !== undefined ? update.logs : current.logs,
        },
      };
    });
  }, []);

  const getJob = useCallback((filename) => {
    return jobs[filename] || { status: null, logs: [] };
  }, [jobs]);

  const getLoaderJob = useCallback((filename) => {
    return loaderJobs[filename] || { status: null, logs: [], duplicato: null };
  }, [loaderJobs]);

  const resetLoaderJob = useCallback((filename) => {
    setLoaderJobs(prev => ({ ...prev, [filename]: { status: null, logs: [], duplicato: null } }));
  }, []);

  // ─────────────────────────────────────────────
  // WEBSOCKET HELPER
  // ─────────────────────────────────────────────

  const connectWs = useCallback((job_id, filename, onDone, isLoader = false) => {
    if (wsMap.current[job_id]) return;

    // Passa il token come query param perché i WebSocket non supportano header
    const wsUrl = `${WS}/api/v1/admin/progress/${job_id}`;
    const ws    = new WebSocket(wsUrl);
    wsMap.current[job_id] = ws;

    ws.onmessage = async (e) => {
      const msg = e.data;

      // Messaggi speciali loader
      if (msg.startsWith("__LOAD_OK__")) {
        const docId = msg.replace("__LOAD_OK__", "");
        updateLoaderJob(filename, { status: "ok", appendLog: `✅ Documento caricato (id=${docId})` });
        if (onDone) onDone();
        ws.close();
        delete wsMap.current[job_id];
        return;
      }

      if (msg.startsWith("__DUPLICATO__")) {
        const parts = msg.replace("__DUPLICATO__", "").split("__");
        const dove  = parts[0];
        const docId = parts[1] || null;
        updateLoaderJob(filename, {
          status:    "duplicato",
          duplicato: { dove, documento_id: docId ? parseInt(docId) : null },
        });
        ws.close();
        delete wsMap.current[job_id];
        return;
      }

      // Messaggio status generico
      if (msg.startsWith("__STATUS__")) {
        const st = msg.replace("__STATUS__", "");
        if (isLoader) {
          updateLoaderJob(filename, { status: st });
        } else {
          updateJob(filename, { status: st });
          if (st === "done") {
            try {
              await authFetch("/api/v1/search/reload", { method: "POST" });
            } catch {}
            if (onDone) onDone();
          }
        }
        ws.close();
        delete wsMap.current[job_id];
        return;
      }

      // Log normale
      if (isLoader) {
        updateLoaderJob(filename, { appendLog: msg });
      } else {
        updateJob(filename, { appendLog: msg });
      }
    };

    ws.onerror = () => {
      const errMsg = "❌ Connessione WebSocket persa.";
      if (isLoader) {
        updateLoaderJob(filename, { status: "error", appendLog: errMsg });
      } else {
        updateJob(filename, { status: "error", appendLog: errMsg });
      }
      delete wsMap.current[job_id];
    };

    ws.onclose = () => {
      delete wsMap.current[job_id];
    };
  }, [updateJob, updateLoaderJob, authFetch]);

  // ─────────────────────────────────────────────
  // AVVIA INGESTION (pipeline marker + chunker)
  // ─────────────────────────────────────────────

  const startIngestion = useCallback(async (filename, onDone) => {
    updateJob(filename, { status: "processing", logs: [] });
    try {
      const res  = await authFetch(`/api/v1/admin/ingest/${encodeURIComponent(filename)}`, { method: "POST" });
      const data = await res.json();
      if (!res.ok) {
        updateJob(filename, { status: "error", appendLog: `❌ ${data.detail}` });
        return;
      }
      connectWs(data.job_id, filename, onDone, false);
    } catch (e) {
      updateJob(filename, { status: "error", appendLog: `❌ Errore: ${e.message}` });
    }
  }, [updateJob, connectWs, authFetch]);

  // ─────────────────────────────────────────────
  // AVVIA LOADER (ChromaDB + PostgreSQL)
  // ─────────────────────────────────────────────

  const startLoader = useCallback(async (filename, params, onDone) => {
    updateLoaderJob(filename, { status: "processing", logs: [], duplicato: null });
    try {
      const res  = await authFetch(`/api/v1/admin/load/${encodeURIComponent(filename)}`, {
        method: "POST",
        body:   JSON.stringify(params),
      });
      const data = await res.json();
      if (!res.ok) {
        updateLoaderJob(filename, { status: "error", appendLog: `❌ ${data.detail}` });
        return;
      }
      connectWs(data.job_id, filename, onDone, true);
    } catch (e) {
      updateLoaderJob(filename, { status: "error", appendLog: `❌ Errore: ${e.message}` });
    }
  }, [updateLoaderJob, connectWs, authFetch]);

  // ─────────────────────────────────────────────
  // RECUPERO JOB ATTIVI AL MOUNT
  // ─────────────────────────────────────────────

  useEffect(() => {
    if (!token) return;  // non fare nulla se non autenticato

    const recover = async () => {
      try {
        const res  = await authFetch("/api/v1/admin/jobs");
        const data = await res.json();
        for (const job of data.jobs || []) {
          setJobs(prev => ({
            ...prev,
            [job.filename]: { status: job.status, logs: job.logs || [] },
          }));
          if (job.status === "processing") {
            connectWs(job.job_id, job.filename, null, false);
          }
        }
      } catch {
        // Backend non raggiungibile — ignora
      }
    };
    recover();
  }, [token]); // eslint-disable-line react-hooks/exhaustive-deps

  // Cleanup WebSocket alla chiusura
  useEffect(() => {
    return () => {
      Object.values(wsMap.current).forEach(ws => ws.close());
    };
  }, []);

  return (
    <IngestionContext.Provider value={{
      // Pipeline
      jobs,
      getJob,
      updateJob,
      startIngestion,
      // Loader
      loaderJobs,
      getLoaderJob,
      updateLoaderJob,
      startLoader,
      resetLoaderJob,
    }}>
      {children}
    </IngestionContext.Provider>
  );
}

export function useIngestion() {
  const ctx = useContext(IngestionContext);
  if (!ctx) throw new Error("useIngestion deve essere usato dentro IngestionProvider");
  return ctx;
}
