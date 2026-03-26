// src/context/IngestionContext.jsx
//
// Context globale per i job di ingestion.
//
// CARATTERISTICHE:
//   - Lo stato (logs, status) sopravvive alla navigazione chat ↔ admin
//   - Il WebSocket vive QUI nel context, non nel componente
//     → non si chiude mai quando navighi via
//   - Al mount recupera i job attivi dal backend (GET /api/v1/admin/jobs)
//     → dopo un reload della pagina ri-aggancia i job in corso
//
// Struttura jobs:
//   { [filename]: { status: null|"processing"|"done"|"error", logs: string[] } }

import { createContext, useContext, useState, useCallback, useEffect, useRef } from "react";

const API = "http://127.0.0.1:8080";
const WS  = "ws://127.0.0.1:8080";

const IngestionContext = createContext(null);

export function IngestionProvider({ children }) {
  const [jobs, setJobs]   = useState({});
  const wsMap             = useRef({});

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

    ws.onclose = () => {
      delete wsMap.current[job_id];
    };
  }, [updateJob]);

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

  // Al mount recupera job attivi dal backend
  useEffect(() => {
    const recover = async () => {
      try {
        const res  = await fetch(`${API}/api/v1/admin/jobs`);
        const data = await res.json();
        for (const job of data.jobs || []) {
          setJobs(prev => ({
            ...prev,
            [job.filename]: {
              status: job.status,
              logs:   job.logs || [],
            },
          }));
          if (job.status === "processing") {
            connectWs(job.job_id, job.filename, null);
          }
        }
      } catch {
        // Backend non raggiungibile — ignora
      }
    };
    recover();
  }, [connectWs]);

  useEffect(() => {
    return () => {
      Object.values(wsMap.current).forEach(ws => ws.close());
    };
  }, []);

  return (
    <IngestionContext.Provider value={{ jobs, getJob, updateJob, startIngestion }}>
      {children}
    </IngestionContext.Provider>
  );
}

export function useIngestion() {
  const ctx = useContext(IngestionContext);
  if (!ctx) throw new Error("useIngestion deve essere usato dentro IngestionProvider");
  return ctx;
}