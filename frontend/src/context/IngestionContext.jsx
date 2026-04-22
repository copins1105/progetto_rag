// src/context/IngestionContext.jsx
//
// FIX BADGE STATUS + WEBSOCKET HTTPS:
//
// PROBLEMA 1 — Badge status buggato:
// Il badge sul PDF passava da grigio ("not_ingested") a giallo ("processing")
// solo quando fetchPdfs ritornava un nuovo status dal server, ma il server
// calcola "processing" dai _jobs in-memory. Se il polling era lento o
// il WS si chiudeva prima di __STATUS__done, il badge rimaneva grigio anche
// durante l'elaborazione, e poi saltava direttamente a "ready"/"completed"
// senza passare per "processing".
//
// FIX: quando startIngestion/startLoader vengono chiamati, aggiorniamo
// immediatamente lo stato locale del job a "processing" PRIMA di fare
// la chiamata HTTP. Così il badge diventa giallo istantaneamente.
// Aggiungiamo anche un callback onStatusChange passato dall'AdminPanel
// che viene chiamato quando il WS segnala completamento/errore,
// triggerando un fetchPdfs immediato senza aspettare il polling.
//
// PROBLEMA 2 — WebSocket con HTTPS/certificati self-signed:
// Con wss:// e certificati self-signed il browser può rifiutare la
// connessione. Usiamo la stessa logica di VITE_API_URL per il WS,
// derivando il dominio WS dall'URL API (https → wss, http → ws).

import {
  createContext, useContext, useState,
  useCallback, useEffect, useRef
} from "react";
import { useAuth } from "./AuthContext";

// FIX: deriva l'URL WebSocket dalla stessa variabile d'ambiente dell'API,
// sostituendo il protocollo https→wss / http→ws.
// Questo garantisce coerenza con il dominio del backend anche con tunnel.
const API_URL = import.meta.env.VITE_API_URL || "https://127.0.0.1:8080";
const WS_URL  = API_URL.replace(/^https/, "wss").replace(/^http/, "ws");

const IngestionContext = createContext(null);

export function IngestionProvider({ children }) {
  const { authFetch, token } = useAuth();

  const [jobs, setJobs]             = useState({});
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
  //
  // FIX WS + HTTPS:
  // Il token JWT viene passato come query parameter perché il protocollo
  // WebSocket non supporta header Authorization durante l'handshake.
  // Con wss:// derivato da VITE_API_URL il dominio è sempre corretto.
  //
  // onStatusChange è un callback opzionale chiamato quando il job termina
  // (done/error/ok) — l'AdminPanel lo usa per triggerare fetchPdfs subito,
  // senza aspettare il polling di 3 secondi. Questo corregge il badge
  // che rimaneva in stato intermedio per troppo tempo.

  const connectWs = useCallback((job_id, filename, onDone, isLoader = false, onStatusChange = null) => {
    if (wsMap.current[job_id]) return;

    const wsUrl = `${WS_URL}/api/v1/admin/progress/${job_id}`;
    const ws    = new WebSocket(wsUrl);
    wsMap.current[job_id] = ws;

    ws.onmessage = async (e) => {
      const msg = e.data;

      // Messaggi speciali loader
      if (msg.startsWith("__LOAD_OK__")) {
        const docId = msg.replace("__LOAD_OK__", "");
        updateLoaderJob(filename, { status: "ok", appendLog: `✅ Documento caricato (id=${docId})` });
        // FIX: notifica subito l'AdminPanel per aggiornare il badge
        onStatusChange?.("completed");
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
            // FIX: notifica il badge che l'ingestion è completata
            onStatusChange?.("ready");
            if (onDone) onDone();
          } else if (st === "error") {
            onStatusChange?.("not_ingested");
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
      onStatusChange?.("not_ingested");
      delete wsMap.current[job_id];
    };

    ws.onclose = () => {
      delete wsMap.current[job_id];
    };
  }, [updateJob, updateLoaderJob, authFetch]);

  // ─────────────────────────────────────────────
  // AVVIA INGESTION
  // ─────────────────────────────────────────────
  //
  // FIX BADGE:
  // Impostiamo subito status="processing" PRIMA della chiamata HTTP.
  // Così il badge diventa giallo istantaneamente al click, senza aspettare
  // che il server risponda e il polling rilevi il cambio di stato.

  const startIngestion = useCallback(async (filename, onDone, onStatusChange = null) => {
    // FIX: aggiornamento ottimistico immediato → badge giallo istantaneo
    updateJob(filename, { status: "processing", logs: [] });

    try {
      const res  = await authFetch(`/api/v1/admin/ingest/${encodeURIComponent(filename)}`, { method: "POST" });
      const data = await res.json();
      if (!res.ok) {
        updateJob(filename, { status: "error", appendLog: `❌ ${data.detail}` });
        onStatusChange?.("not_ingested");
        return;
      }
      connectWs(data.job_id, filename, onDone, false, onStatusChange);
    } catch (e) {
      updateJob(filename, { status: "error", appendLog: `❌ Errore: ${e.message}` });
      onStatusChange?.("not_ingested");
    }
  }, [updateJob, connectWs, authFetch]);

  // ─────────────────────────────────────────────
  // AVVIA LOADER
  // ─────────────────────────────────────────────

  const startLoader = useCallback(async (filename, params, onDone, onStatusChange = null) => {
    // FIX: aggiornamento ottimistico immediato → badge giallo istantaneo
    updateLoaderJob(filename, { status: "processing", logs: [], duplicato: null });

    try {
      const res  = await authFetch(`/api/v1/admin/load/${encodeURIComponent(filename)}`, {
        method: "POST",
        body:   JSON.stringify(params),
      });
      const data = await res.json();
      if (!res.ok) {
        updateLoaderJob(filename, { status: "error", appendLog: `❌ ${data.detail}` });
        onStatusChange?.("ready");
        return;
      }
      connectWs(data.job_id, filename, onDone, true, onStatusChange);
    } catch (e) {
      updateLoaderJob(filename, { status: "error", appendLog: `❌ Errore: ${e.message}` });
      onStatusChange?.("ready");
    }
  }, [updateLoaderJob, connectWs, authFetch]);

  // ─────────────────────────────────────────────
  // RECUPERO JOB ATTIVI AL MOUNT
  // ─────────────────────────────────────────────

  useEffect(() => {
    if (!token) return;

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
            connectWs(job.job_id, job.filename, null, false, null);
          }
        }
      } catch {
        // Backend non raggiungibile — ignora
      }
    };
    recover();
  }, [token]); // eslint-disable-line react-hooks/exhaustive-deps

  useEffect(() => {
    return () => {
      Object.values(wsMap.current).forEach(ws => ws.close());
    };
  }, []);

  return (
    <IngestionContext.Provider value={{
      jobs,
      getJob,
      updateJob,
      startIngestion,
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