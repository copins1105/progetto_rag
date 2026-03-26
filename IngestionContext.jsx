// src/context/IngestionContext.jsx
//
// Context globale per i job di ingestion E loader.
//
// CARATTERISTICHE:
//   - Lo stato (logs, status) sopravvive alla navigazione chat ↔ admin
//   - I WebSocket vivono QUI nel context, non nei componenti
//     → non si chiudono mai quando navighi via
//   - Al mount recupera i job attivi dal backend (GET /api/v1/admin/jobs)
//     → dopo un reload della pagina ri-aggancia i job in corso
//
// Struttura jobs (ingestion):
//   { [filename]: { status: null|"processing"|"done"|"error", logs: string[] } }
//
// Struttura loaderJobs:
//   { [filename]: { status: null|"processing"|"ok"|"error"|"duplicato", logs: string[], duplicato: obj|null } }

import { createContext, useContext, useState, useCallback, useEffect, useRef } from "react";

const API = "http://127.0.0.1:8080";
const WS  = "ws://127.0.0.1:8080";

const IngestionContext = createContext(null);

export function IngestionProvider({ children }) {
  const [jobs, setJobs]             = useState({});
  const [loaderJobs, setLoaderJobs] = useState({});
  const wsMap                       = useRef({});

  // ── Aggiorna job ingestion ────────────────────────────────
  const updateJob = useCallback((filename, update) => {
    setJobs(prev => {
      const current = prev[filename] || { status: null, logs: [] };
      return {
        ...prev,
        [filename]: {
          status: update.status !== undefined ? update.status : current.status,
          logs:   update.appendLog
            ? [...current.logs, update.appendLog]
            : update.logs !== undefined ? update.logs : current.logs,
        },
      };
    });
  }, []);

  const getJob = useCallback((filename) => {
    return jobs[filename] || { status: null, logs: [] };
  }, [jobs]);

  // ── Aggiorna job loader ───────────────────────────────────
  const updateLoaderJob = useCallback((filename, update) => {
    setLoaderJobs(prev => {
      const current = prev[filename] || { status: null, logs: [], duplicato: null };
      return {
        ...prev,
        [filename]: {
          status:    update.status    !== undefined ? update.status    : current.status,
          duplicato: update.duplicato !== undefined ? update.duplicato : current.duplicato,
          logs:      update.appendLog
            ? [...current.logs, update.appendLog]
            : update.logs !== undefined ? update.logs : current.logs,
        },
      };
    });
  }, []);

  const getLoaderJob = useCallback((filename) => {
    return loaderJobs[filename] || { status: null, logs: [], duplicato: null };
  }, [loaderJobs]);

  const resetLoaderJob = useCallback((filename) => {
    setLoaderJobs(prev => ({ ...prev, [filename]: { status: null, logs: [], duplicato: null } }));
  }, []);

  // ── WebSocket generico ────────────────────────────────────
  const connectWs = useCallback((job_id, filename, onDone) => {
    if (wsMap.current[job_id]) return;

    const ws = new WebSocket(`${WS}/api/v1/admin/progress/${job_id}`);
    wsMap.current[job_id] = ws;

    ws.onmessage = async (e) => {
      if (e.data.startsWith("__STATUS__")) {
        const st = e.data.replace("__STATUS__", "");
        updateJob(filename, { status: st });
        if (st === "done") {
          try { await fetch(`${API}/api/v1/search/reload`, { method: "POST" }); } catch {}
          if (onDone) onDone();
        }
        ws.close();
        delete wsMap.current[job_id];
      } else {
        updateJob(filename, { appendLog: e.data });
      }
    };

    ws.onerror = () => {
      updateJob(filename, { status: "error", appendLog: "❌ Connessione WebSocket persa." });
      delete wsMap.current[job_id];
    };

    ws.onclose = () => { delete wsMap.current[job_id]; };
  }, [updateJob]);

  // ── WebSocket loader ──────────────────────────────────────
  const connectLoaderWs = useCallback((job_id, filename, onDone) => {
    if (wsMap.current[`loader_${job_id}`]) return;

    const ws = new WebSocket(`${WS}/api/v1/admin/progress/${job_id}`);
    wsMap.current[`loader_${job_id}`] = ws;

    ws.onmessage = async (e) => {
      if (e.data.startsWith("__LOAD_OK__")) {
        updateLoaderJob(filename, { status: "ok" });
        if (onDone) onDone();
        ws.close();
        delete wsMap.current[`loader_${job_id}`];
      } else if (e.data.startsWith("__DUPLICATO__")) {
        const parts = e.data.split("__").filter(Boolean);
        updateLoaderJob(filename, {
          status: "duplicato",
          duplicato: { dove: parts[1], documento_id: parts[2] || null },
        });
        ws.close();
        delete wsMap.current[`loader_${job_id}`];
      } else if (e.data.startsWith("__STATUS__error")) {
        updateLoaderJob(filename, { status: "error" });
        ws.close();
        delete wsMap.current[`loader_${job_id}`];
      } else {
        updateLoaderJob(filename, { appendLog: e.data });
      }
    };

    ws.onerror = () => {
      updateLoaderJob(filename, { status: "error", appendLog: "❌ Connessione WebSocket persa." });
      delete wsMap.current[`loader_${job_id}`];
    };

    ws.onclose = () => { delete wsMap.current[`loader_${job_id}`]; };
  }, [updateLoaderJob]);

  // ── Avvia ingestion ───────────────────────────────────────
  const startIngestion = useCallback(async (filename, onDone) => {
    updateJob(filename, { status: "processing", logs: [] });
    try {
      const res  = await fetch(`${API}/api/v1/admin/ingest/${encodeURIComponent(filename)}`, { method: "POST" });
      const data = await res.json();
      if (!res.ok) {
        updateJob(filename, { status: "error", appendLog: `❌ ${data.detail}` });
        return;
      }
      connectWs(data.job_id, filename, onDone);
    } catch (e) {
      updateJob(filename, { status: "error", appendLog: `❌ Errore: ${e.message}` });
    }
  }, [updateJob, connectWs]);

  // ── Avvia loader ──────────────────────────────────────────
  const startLoader = useCallback(async (filename, params, onDone) => {
    updateLoaderJob(filename, { status: "processing", logs: [], duplicato: null });
    try {
      const res  = await fetch(`${API}/api/v1/admin/load/${encodeURIComponent(filename)}`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(params),
      });
      const data = await res.json();
      if (!res.ok) {
        updateLoaderJob(filename, { status: "error", appendLog: `❌ ${data.detail}` });
        return;
      }
      connectLoaderWs(data.job_id, filename, onDone);
    } catch (e) {
      updateLoaderJob(filename, { status: "error", appendLog: `❌ Errore: ${e.message}` });
    }
  }, [updateLoaderJob, connectLoaderWs]);

  // ── Recovery al mount ─────────────────────────────────────
  useEffect(() => {
    const recover = async () => {
      try {
        const res  = await fetch(`${API}/api/v1/admin/jobs`);
        const data = await res.json();
        for (const job of data.jobs || []) {
          setJobs(prev => ({
            ...prev,
            [job.filename]: { status: job.status, logs: job.logs || [] },
          }));
          if (job.status === "processing") {
            connectWs(job.job_id, job.filename, null);
          }
        }
      } catch {}
    };
    recover();
  }, [connectWs]);

  useEffect(() => {
    return () => {
      Object.values(wsMap.current).forEach(ws => ws.close());
    };
  }, []);

  return (
    <IngestionContext.Provider value={{
      jobs, getJob, updateJob, startIngestion,
      loaderJobs, getLoaderJob, updateLoaderJob, resetLoaderJob, startLoader,
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