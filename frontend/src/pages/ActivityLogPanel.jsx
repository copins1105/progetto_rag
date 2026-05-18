// // src/pages/ActivityLogPanel.jsx
// // FIX REACT BUGS:
// // 1. fetchLogs era nelle deps dell'useEffect auto-refresh ma non era stabile
// //    → ogni re-render ricreava fetchLogs → useEffect si rieseguiva → clearInterval
// //    + nuovo setInterval in loop continuo.
// //    FIX: fetchLogs usa useCallback con deps stabili. L'autoRefresh useEffect
// //    dipende solo da [autoRefresh] e usa un ref per i filtri correnti.
// // 2. lastCountRef aggiornato correttamente per non perdere il conteggio.
// // 3. Le deps degli useCallback sono minime e stabili.

// import { useState, useEffect, useCallback, useRef } from "react";
// import { useAuth } from "../context/AuthContext";

// const ESITO_STYLE = {
//   ok:      { bg: "rgba(52,211,153,0.10)",  color: "#34d399", border: "rgba(52,211,153,0.28)", label: "ok"      },
//   warning: { bg: "rgba(251,191,36,0.10)",  color: "#fbbf24", border: "rgba(251,191,36,0.28)", label: "warning" },
//   error:   { bg: "rgba(239,68,68,0.10)",   color: "#f87171", border: "rgba(239,68,68,0.28)",  label: "errore"  },
// };

// const AZIONI = {
//   login:              { icon: "🔐", label: "Login"               },
//   logout:             { icon: "🚪", label: "Logout"              },
//   password_changed:   { icon: "🔑", label: "Cambio password"     },
//   doc_upload:         { icon: "⬆️",  label: "Upload PDF"          },
//   doc_ingestion:      { icon: "⚙️",  label: "Ingestion"           },
//   doc_load:           { icon: "💾",  label: "Caricamento DB"      },
//   doc_update:         { icon: "✏️",  label: "Modifica documento"  },
//   doc_delete:         { icon: "🗑️",  label: "Eliminazione doc."   },
//   user_created:       { icon: "👤",  label: "Utente creato"       },
//   user_updated:       { icon: "✏️",  label: "Utente modificato"   },
//   user_deleted:       { icon: "🗑️",  label: "Utente eliminato"    },
//   permission_changed: { icon: "🔒",  label: "Permesso modificato" },
// };

// const AZIONE_INFO = (azione) => AZIONI[azione] || { icon: "📋", label: azione };
// const PAGE_SIZE = 50;

// function fmtTs(ts) {
//   if (!ts) return "—";
//   try {
//     const d = new Date(ts);
//     const pad = (n) => String(n).padStart(2, "0");
//     return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}  ${pad(d.getHours())}:${pad(d.getMinutes())}:${pad(d.getSeconds())}`;
//   } catch { return ts; }
// }

// function isRecent(ts, maxSeconds = 30) {
//   if (!ts) return false;
//   try { return (Date.now() - new Date(ts).getTime()) < maxSeconds * 1000; }
//   catch { return false; }
// }

// function DetailChip({ k, v }) {
//   const val = typeof v === "object" ? JSON.stringify(v) : String(v);
//   if (!val || val === "null" || val === "undefined") return null;
//   return (
//     <span style={{ fontSize: "0.62rem", fontFamily: "'DM Mono', monospace", padding: "1px 7px", borderRadius: 4, background: "var(--surface)", border: "1px solid var(--border)", color: "var(--text-muted)", maxWidth: 240, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap", display: "inline-flex", alignItems: "center", gap: 4 }} title={`${k}: ${val}`}>
//       <span style={{ color: "var(--accent)", fontWeight: 600 }}>{k}</span>
//       <span style={{ color: "var(--border-strong)" }}>·</span>
//       {val}
//     </span>
//   );
// }

// function LogRow({ log, isEven }) {
//   const [open, setOpen] = useState(false);
//   const esito  = ESITO_STYLE[log.esito] || ESITO_STYLE.ok;
//   const info   = AZIONE_INFO(log.azione);
//   const recent = isRecent(log.timestamp);
//   const nomeUtente = log.utente_nome ? `${log.utente_nome} ${log.utente_cognome || ""}`.trim() : log.utente_email || "—";
//   const dettaglioEntries = Object.entries(log.dettaglio || {}).filter(
//     ([, v]) => v !== null && v !== undefined && v !== "" && !(Array.isArray(v) && v.length === 0)
//   );
//   const hasDetail = dettaglioEntries.length > 0;

//   return (
//     <div onClick={() => hasDetail && setOpen(o => !o)} style={{ borderBottom: "1px solid var(--border)", background: isEven ? "var(--surface2)" : "var(--surface)", cursor: hasDetail ? "pointer" : "default", transition: "background 0.12s", position: "relative" }}>
//       {recent && <div style={{ position: "absolute", left: 0, top: 0, bottom: 0, width: 2, background: "var(--accent)", borderRadius: "0 2px 2px 0" }} />}
//       <div style={{ display: "grid", gridTemplateColumns: "152px 160px 1fr 72px 52px", gap: 8, alignItems: "center", padding: "8px 14px 8px 16px" }}>
//         <span style={{ fontSize: "0.67rem", fontFamily: "'DM Mono', monospace", color: recent ? "var(--accent)" : "var(--text-muted)", whiteSpace: "nowrap" }}>{fmtTs(log.timestamp)}</span>
//         <div style={{ display: "flex", alignItems: "center", gap: 7 }}>
//           <span style={{ fontSize: "0.88rem", lineHeight: 1 }}>{info.icon}</span>
//           <span style={{ fontSize: "0.76rem", fontWeight: 600, color: "var(--text)" }}>{info.label}</span>
//         </div>
//         <div style={{ minWidth: 0 }}>
//           <div style={{ fontSize: "0.75rem", color: "var(--text-dim)", overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }} title={log.utente_email}>{nomeUtente}</div>
//           {log.ip_address && <div style={{ fontSize: "0.62rem", color: "var(--text-muted)", fontFamily: "'DM Mono', monospace" }}>{log.ip_address}</div>}
//         </div>
//         <span style={{ fontSize: "0.62rem", fontWeight: 700, padding: "2px 8px", borderRadius: 20, textAlign: "center", background: esito.bg, color: esito.color, border: `1px solid ${esito.border}`, fontFamily: "'DM Mono', monospace", whiteSpace: "nowrap" }}>{esito.label}</span>
//         {hasDetail ? <span style={{ fontSize: "0.65rem", color: "var(--text-muted)", textAlign: "right", userSelect: "none" }}>{open ? "▲" : "▼"}</span> : <span />}
//       </div>
//       {open && hasDetail && (
//         <div style={{ padding: "6px 14px 10px 16px", borderTop: "1px solid var(--border)", background: "rgba(0,0,0,0.10)", display: "flex", flexWrap: "wrap", gap: 5 }}>
//           {dettaglioEntries.map(([k, v]) => <DetailChip key={k} k={k} v={v} />)}
//         </div>
//       )}
//     </div>
//   );
// }

// export default function ActivityLogPanel() {
//   const { authFetch } = useAuth();

//   const [logs,          setLogs]          = useState([]);
//   const [total,         setTotal]         = useState(0);
//   const [page,          setPage]          = useState(0);
//   const [loading,       setLoading]       = useState(false);
//   const [filterAzione,  setFilterAzione]  = useState("");
//   const [filterEsito,   setFilterEsito]   = useState("");
//   const [filterUtente,  setFilterUtente]  = useState("");
//   const [azioni,        setAzioni]        = useState([]);
//   const [autoRefresh,   setAutoRefresh]   = useState(false);
//   const [newSince,      setNewSince]      = useState(0);

//   const intervalRef    = useRef(null);
//   const lastCountRef   = useRef(0);
//   // FIX: ref per i filtri correnti usati nel polling, evita deps instabili
//   const filtersRef     = useRef({ page: 0, filterAzione: "", filterEsito: "", filterUtente: "" });
//   const totalPages     = Math.max(1, Math.ceil(total / PAGE_SIZE));

//   // Aggiorna filtersRef sincronicamente
//   useEffect(() => {
//     filtersRef.current = { page, filterAzione, filterEsito, filterUtente };
//   }, [page, filterAzione, filterEsito, filterUtente]);

//   // FIX: fetchLogs stabile — deps solo [authFetch] che è stabile
//   const fetchLogs = useCallback(async (
//     p = 0, az = "", es = "", ut = "", silent = false
//   ) => {
//     if (!silent) setLoading(true);
//     try {
//       const params = new URLSearchParams({ page: p, page_size: PAGE_SIZE });
//       if (az) params.set("azione", az);
//       if (es) params.set("esito",  es);
//       if (ut) params.set("utente", ut);
//       const res  = await authFetch(`/api/v1/admin/activity-log?${params}`);
//       const data = await res.json();
//       const newTotal = data.total || 0;

//       if (silent && p === 0 && lastCountRef.current > 0 && newTotal > lastCountRef.current) {
//         setNewSince(n => n + (newTotal - lastCountRef.current));
//       }
//       lastCountRef.current = newTotal;

//       setLogs(data.logs  || []);
//       setTotal(newTotal);
//       setPage(p);
//     } catch (e) { console.error(e); }
//     finally { if (!silent) setLoading(false); }
//   }, [authFetch]); // authFetch è stabile

//   const fetchAzioni = useCallback(async () => {
//     try {
//       const res  = await authFetch("/api/v1/admin/activity-log/azioni");
//       const data = await res.json();
//       setAzioni(data.azioni || []);
//     } catch {}
//   }, [authFetch]);

//   // Mount: carica dati iniziali
//   useEffect(() => {
//     fetchLogs(0);
//     fetchAzioni();
//   }, [fetchLogs, fetchAzioni]);

//   // FIX AUTO-REFRESH: useEffect dipende solo da [autoRefresh].
//   // I filtri vengono letti da filtersRef.current (sempre aggiornato)
//   // invece di essere nelle deps (che causavano il loop).
//   useEffect(() => {
//     if (autoRefresh) {
//       intervalRef.current = setInterval(() => {
//         const { filterAzione: az, filterEsito: es, filterUtente: ut } = filtersRef.current;
//         fetchLogs(0, az, es, ut, true);
//       }, 8000);
//     } else {
//       clearInterval(intervalRef.current);
//       setNewSince(0);
//     }
//     return () => clearInterval(intervalRef.current);
//   }, [autoRefresh, fetchLogs]); // fetchLogs è stabile → nessun loop

//   const applyFilter = useCallback(() => {
//     setNewSince(0);
//     fetchLogs(0, filterAzione, filterEsito, filterUtente);
//   }, [fetchLogs, filterAzione, filterEsito, filterUtente]);

//   const resetFilter = useCallback(() => {
//     setFilterAzione(""); setFilterEsito(""); setFilterUtente("");
//     setNewSince(0);
//     fetchLogs(0, "", "", "");
//   }, [fetchLogs]);

//   const inputSel = {
//     padding: "7px 10px", background: "var(--surface2)",
//     border: "1px solid var(--border-strong)", borderRadius: "6px",
//     color: "var(--text)", fontFamily: "inherit", fontSize: "0.78rem", outline: "none",
//   };
//   const btnGhost = {
//     padding: "7px 10px", background: "none",
//     border: "1px solid var(--border-strong)", borderRadius: 6, cursor: "pointer",
//     fontFamily: "inherit", fontSize: "0.75rem", color: "var(--text-muted)",
//   };

//   return (
//     <div style={{ display: "flex", flexDirection: "column", height: "100%" }}>
//       <div style={{ display: "flex", alignItems: "center", gap: 8, flexWrap: "wrap", padding: "10px 14px", borderBottom: "1px solid var(--border)", background: "var(--surface)", flexShrink: 0 }}>
//         <span style={{ fontSize: "0.82rem", fontWeight: 600, color: "var(--text)", marginRight: 2 }}>📋 Activity Log</span>
//         <span style={{ fontSize: "0.68rem", color: "var(--text-muted)", fontFamily: "'DM Mono', monospace", padding: "2px 8px", borderRadius: 20, background: "var(--surface2)", border: "1px solid var(--border)" }}>
//           {total} eventi
//         </span>
//         {autoRefresh && newSince > 0 && (
//           <button onClick={() => { fetchLogs(0, filterAzione, filterEsito, filterUtente); setNewSince(0); }}
//             style={{ fontSize: "0.68rem", padding: "2px 9px", borderRadius: 20, cursor: "pointer", background: "rgba(79,142,247,0.15)", color: "var(--accent)", border: "1px solid rgba(79,142,247,0.35)", fontFamily: "'DM Mono', monospace" }}>
//             +{newSince} nuovi ↑
//           </button>
//         )}
//         <div style={{ flex: 1 }} />
//         <input style={{ ...inputSel, width: 160 }} placeholder="🔍 Utente…" value={filterUtente}
//           onChange={(e) => setFilterUtente(e.target.value)}
//           onKeyDown={(e) => e.key === "Enter" && applyFilter()} />
//         <select style={inputSel} value={filterAzione} onChange={(e) => setFilterAzione(e.target.value)}>
//           <option value="">Tutte le azioni</option>
//           {azioni.map((a) => <option key={a} value={a}>{AZIONE_INFO(a).label}</option>)}
//         </select>
//         <select style={inputSel} value={filterEsito} onChange={(e) => setFilterEsito(e.target.value)}>
//           <option value="">Tutti gli esiti</option>
//           <option value="ok">OK</option>
//           <option value="warning">Warning</option>
//           <option value="error">Errore</option>
//         </select>
//         <button onClick={applyFilter} style={{ padding: "7px 14px", background: "var(--accent)", color: "white", border: "none", borderRadius: 6, cursor: "pointer", fontFamily: "inherit", fontSize: "0.78rem", fontWeight: 600 }}>Filtra</button>
//         {(filterAzione || filterEsito || filterUtente) && (
//           <button onClick={resetFilter} style={{ ...btnGhost, color: "var(--text-muted)" }}>✕ Reset</button>
//         )}
//         <button onClick={() => setAutoRefresh(a => !a)} style={{ ...btnGhost, background: autoRefresh ? "rgba(52,211,153,0.1)" : "none", border: autoRefresh ? "1px solid rgba(52,211,153,0.3)" : "1px solid var(--border-strong)", color: autoRefresh ? "#34d399" : "var(--text-muted)", display: "flex", alignItems: "center", gap: 5 }}>
//           <span style={{ width: 6, height: 6, borderRadius: "50%", background: autoRefresh ? "#34d399" : "var(--border-strong)", boxShadow: autoRefresh ? "0 0 6px #34d399" : "none", flexShrink: 0, animation: autoRefresh ? "pulse-dot 2s infinite" : "none" }} />
//           Live
//         </button>
//         <button onClick={() => fetchLogs(0, filterAzione, filterEsito, filterUtente)} style={btnGhost} title="Aggiorna">↻</button>
//       </div>

//       <div style={{ display: "grid", gridTemplateColumns: "152px 160px 1fr 72px 52px", gap: 8, padding: "5px 14px 5px 16px", background: "var(--surface2)", borderBottom: "1px solid var(--border)", flexShrink: 0 }}>
//         {["Timestamp", "Azione", "Utente / IP", "Esito", ""].map((h, i) => (
//           <span key={i} style={{ fontSize: "0.64rem", fontWeight: 700, color: "var(--text-muted)", textTransform: "uppercase", letterSpacing: "0.07em" }}>{h}</span>
//         ))}
//       </div>

//       <div style={{ flex: 1, overflowY: "auto" }}>
//         {loading && <div style={{ padding: 24, textAlign: "center", color: "var(--text-muted)", fontSize: "0.78rem" }}>Caricamento…</div>}
//         {!loading && logs.length === 0 && (
//           <div style={{ padding: 40, textAlign: "center", color: "var(--text-muted)", fontSize: "0.78rem" }}>
//             {filterAzione || filterEsito || filterUtente ? "Nessun log per i filtri selezionati." : "Nessun log trovato."}
//           </div>
//         )}
//         {!loading && logs.map((log, i) => <LogRow key={log.log_id} log={log} isEven={i % 2 === 0} />)}
//       </div>

//       {totalPages > 1 && (
//         <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", padding: "8px 14px", borderTop: "1px solid var(--border)", background: "var(--surface)", flexShrink: 0 }}>
//           <button disabled={page <= 0} onClick={() => fetchLogs(page - 1, filterAzione, filterEsito, filterUtente)}
//             style={{ ...btnGhost, cursor: page <= 0 ? "not-allowed" : "pointer", opacity: page <= 0 ? 0.35 : 1 }}>← Precedente</button>
//           <span style={{ fontSize: "0.72rem", color: "var(--text-muted)", fontFamily: "'DM Mono', monospace" }}>pag. {page + 1} / {totalPages}</span>
//           <button disabled={page >= totalPages - 1} onClick={() => fetchLogs(page + 1, filterAzione, filterEsito, filterUtente)}
//             style={{ ...btnGhost, cursor: page >= totalPages - 1 ? "not-allowed" : "pointer", opacity: page >= totalPages - 1 ? 0.35 : 1 }}>Successiva →</button>
//         </div>
//       )}
//     </div>
//   );
// }



// src/pages/ActivityLogPanel.jsx — RESPONSIVE
// Mobile: row grid becomes stacked cards (no horizontal truncation)
// Tablet: compact grid
// Desktop: original grid layout
// Fixed: overlapping elements in header filters on small screens

import { useState, useEffect, useCallback, useRef } from "react";
import { useAuth } from "../context/AuthContext";

const ESITO_STYLE = {
  ok:      { bg: "rgba(52,211,153,0.10)",  color: "#34d399", border: "rgba(52,211,153,0.28)", label: "ok"      },
  warning: { bg: "rgba(251,191,36,0.10)",  color: "#fbbf24", border: "rgba(251,191,36,0.28)", label: "warning" },
  error:   { bg: "rgba(239,68,68,0.10)",   color: "#f87171", border: "rgba(239,68,68,0.28)",  label: "errore"  },
};

const AZIONI = {
  login:              { icon: "🔐", label: "Login"               },
  logout:             { icon: "🚪", label: "Logout"              },
  password_changed:   { icon: "🔑", label: "Cambio password"     },
  doc_upload:         { icon: "⬆️",  label: "Upload PDF"          },
  doc_ingestion:      { icon: "⚙️",  label: "Ingestion"           },
  doc_load:           { icon: "💾",  label: "Caricamento DB"      },
  doc_update:         { icon: "✏️",  label: "Modifica documento"  },
  doc_delete:         { icon: "🗑️",  label: "Eliminazione doc."   },
  user_created:       { icon: "👤",  label: "Utente creato"       },
  user_updated:       { icon: "✏️",  label: "Utente modificato"   },
  user_deleted:       { icon: "🗑️",  label: "Utente eliminato"    },
  permission_changed: { icon: "🔒",  label: "Permesso modificato" },
};

const AZIONE_INFO = (azione) => AZIONI[azione] || { icon: "📋", label: azione };
const PAGE_SIZE = 50;

function fmtTs(ts) {
  if (!ts) return "—";
  try {
    const d = new Date(ts);
    const pad = (n) => String(n).padStart(2, "0");
    return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())} ${pad(d.getHours())}:${pad(d.getMinutes())}:${pad(d.getSeconds())}`;
  } catch { return ts; }
}

function isRecent(ts, maxSeconds = 30) {
  if (!ts) return false;
  try { return (Date.now() - new Date(ts).getTime()) < maxSeconds * 1000; }
  catch { return false; }
}

function DetailChip({ k, v }) {
  const val = typeof v === "object" ? JSON.stringify(v) : String(v);
  if (!val || val === "null" || val === "undefined") return null;
  return (
    <span style={{
      fontSize: "0.62rem", fontFamily: "'DM Mono', monospace",
      padding: "1px 7px", borderRadius: 4,
      background: "var(--surface)", border: "1px solid var(--border)",
      color: "var(--text-muted)", maxWidth: 240,
      overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap",
      display: "inline-flex", alignItems: "center", gap: 4,
    }} title={`${k}: ${val}`}>
      <span style={{ color: "var(--accent)", fontWeight: 600 }}>{k}</span>
      <span style={{ color: "var(--border-strong)" }}>·</span>
      {val}
    </span>
  );
}

// Detects if we're on a narrow screen
function useIsMobile(breakpoint = 640) {
  const [isMobile, setIsMobile] = useState(() => window.innerWidth < breakpoint);
  useEffect(() => {
    const handler = () => setIsMobile(window.innerWidth < breakpoint);
    window.addEventListener("resize", handler);
    return () => window.removeEventListener("resize", handler);
  }, [breakpoint]);
  return isMobile;
}

// Desktop row (grid layout)
function LogRowDesktop({ log, isEven }) {
  const [open, setOpen] = useState(false);
  const esito  = ESITO_STYLE[log.esito] || ESITO_STYLE.ok;
  const info   = AZIONE_INFO(log.azione);
  const recent = isRecent(log.timestamp);
  const nomeUtente = log.utente_nome
    ? `${log.utente_nome} ${log.utente_cognome || ""}`.trim()
    : log.utente_email || "—";
  const dettaglioEntries = Object.entries(log.dettaglio || {}).filter(
    ([, v]) => v !== null && v !== undefined && v !== "" && !(Array.isArray(v) && v.length === 0)
  );
  const hasDetail = dettaglioEntries.length > 0;

  return (
    <div
      onClick={() => hasDetail && setOpen(o => !o)}
      style={{
        borderBottom: "1px solid var(--border)",
        background: isEven ? "var(--surface2)" : "var(--surface)",
        cursor: hasDetail ? "pointer" : "default",
        transition: "background 0.12s",
        position: "relative",
      }}
    >
      {recent && (
        <div style={{
          position: "absolute", left: 0, top: 0, bottom: 0,
          width: 2, background: "var(--accent)", borderRadius: "0 2px 2px 0",
        }} />
      )}
      <div style={{
        display: "grid",
        gridTemplateColumns: "148px 155px 1fr 72px 36px",
        gap: 8, alignItems: "center",
        padding: "8px 14px 8px 16px",
      }}>
        <span style={{
          fontSize: "0.67rem", fontFamily: "'DM Mono', monospace",
          color: recent ? "var(--accent)" : "var(--text-muted)",
          whiteSpace: "nowrap",
        }}>{fmtTs(log.timestamp)}</span>

        <div style={{ display: "flex", alignItems: "center", gap: 7, minWidth: 0 }}>
          <span style={{ fontSize: "0.88rem", lineHeight: 1, flexShrink: 0 }}>{info.icon}</span>
          <span style={{
            fontSize: "0.76rem", fontWeight: 600, color: "var(--text)",
            overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap",
          }}>{info.label}</span>
        </div>

        <div style={{ minWidth: 0 }}>
          <div style={{
            fontSize: "0.75rem", color: "var(--text-dim)",
            overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap",
          }} title={log.utente_email}>{nomeUtente}</div>
          {log.ip_address && (
            <div style={{ fontSize: "0.62rem", color: "var(--text-muted)", fontFamily: "'DM Mono', monospace" }}>
              {log.ip_address}
            </div>
          )}
        </div>

        <span style={{
          fontSize: "0.62rem", fontWeight: 700, padding: "2px 8px",
          borderRadius: 20, textAlign: "center",
          background: esito.bg, color: esito.color,
          border: `1px solid ${esito.border}`,
          fontFamily: "'DM Mono', monospace", whiteSpace: "nowrap",
        }}>{esito.label}</span>

        {hasDetail
          ? <span style={{ fontSize: "0.65rem", color: "var(--text-muted)", textAlign: "right", userSelect: "none" }}>
              {open ? "▲" : "▼"}
            </span>
          : <span />
        }
      </div>

      {open && hasDetail && (
        <div style={{
          padding: "6px 14px 10px 16px",
          borderTop: "1px solid var(--border)",
          background: "rgba(0,0,0,0.10)",
          display: "flex", flexWrap: "wrap", gap: 5,
        }}>
          {dettaglioEntries.map(([k, v]) => <DetailChip key={k} k={k} v={v} />)}
        </div>
      )}
    </div>
  );
}

// Mobile card layout — no grid, readable on small screens
function LogRowMobile({ log, isEven }) {
  const [open, setOpen] = useState(false);
  const esito  = ESITO_STYLE[log.esito] || ESITO_STYLE.ok;
  const info   = AZIONE_INFO(log.azione);
  const recent = isRecent(log.timestamp);
  const nomeUtente = log.utente_nome
    ? `${log.utente_nome} ${log.utente_cognome || ""}`.trim()
    : log.utente_email || "—";
  const dettaglioEntries = Object.entries(log.dettaglio || {}).filter(
    ([, v]) => v !== null && v !== undefined && v !== "" && !(Array.isArray(v) && v.length === 0)
  );
  const hasDetail = dettaglioEntries.length > 0;

  return (
    <div
      onClick={() => hasDetail && setOpen(o => !o)}
      style={{
        borderBottom: "1px solid var(--border)",
        background: isEven ? "var(--surface2)" : "var(--surface)",
        cursor: hasDetail ? "pointer" : "default",
        padding: "10px 14px 10px 16px",
        position: "relative",
      }}
    >
      {recent && (
        <div style={{
          position: "absolute", left: 0, top: 0, bottom: 0,
          width: 2, background: "var(--accent)",
        }} />
      )}

      {/* Row 1: action + esito badge */}
      <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", gap: 8, marginBottom: 4 }}>
        <div style={{ display: "flex", alignItems: "center", gap: 6 }}>
          <span style={{ fontSize: "0.85rem" }}>{info.icon}</span>
          <span style={{ fontSize: "0.78rem", fontWeight: 600, color: "var(--text)" }}>{info.label}</span>
        </div>
        <span style={{
          fontSize: "0.62rem", fontWeight: 700, padding: "2px 8px",
          borderRadius: 20,
          background: esito.bg, color: esito.color,
          border: `1px solid ${esito.border}`,
          fontFamily: "'DM Mono', monospace", whiteSpace: "nowrap", flexShrink: 0,
        }}>{esito.label}</span>
      </div>

      {/* Row 2: user + timestamp */}
      <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", gap: 8 }}>
        <span style={{
          fontSize: "0.72rem", color: "var(--text-muted)",
          overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap",
          flex: 1,
        }} title={log.utente_email}>{nomeUtente}</span>
        <span style={{
          fontSize: "0.62rem", fontFamily: "'DM Mono', monospace",
          color: recent ? "var(--accent)" : "var(--text-muted)",
          whiteSpace: "nowrap", flexShrink: 0,
        }}>{fmtTs(log.timestamp)}</span>
      </div>

      {log.ip_address && (
        <div style={{ fontSize: "0.6rem", color: "var(--text-muted)", fontFamily: "'DM Mono', monospace", marginTop: 2 }}>
          {log.ip_address}
        </div>
      )}

      {hasDetail && (
        <div style={{ fontSize: "0.65rem", color: "var(--text-muted)", marginTop: 4 }}>
          {open ? "▲ Nascondi dettagli" : "▼ Dettagli"}
        </div>
      )}

      {open && hasDetail && (
        <div style={{
          marginTop: 8, paddingTop: 8,
          borderTop: "1px solid var(--border)",
          display: "flex", flexWrap: "wrap", gap: 5,
        }}>
          {dettaglioEntries.map(([k, v]) => <DetailChip key={k} k={k} v={v} />)}
        </div>
      )}
    </div>
  );
}

export default function ActivityLogPanel() {
  const { authFetch } = useAuth();
  const isMobile = useIsMobile(640);

  const [logs,          setLogs]          = useState([]);
  const [total,         setTotal]         = useState(0);
  const [page,          setPage]          = useState(0);
  const [loading,       setLoading]       = useState(false);
  const [filterAzione,  setFilterAzione]  = useState("");
  const [filterEsito,   setFilterEsito]   = useState("");
  const [filterUtente,  setFilterUtente]  = useState("");
  const [azioni,        setAzioni]        = useState([]);
  const [autoRefresh,   setAutoRefresh]   = useState(false);
  const [newSince,      setNewSince]      = useState(0);
  // Mobile: toggle filter panel visibility
  const [showFilters,   setShowFilters]   = useState(false);

  const intervalRef    = useRef(null);
  const lastCountRef   = useRef(0);
  const filtersRef     = useRef({ page: 0, filterAzione: "", filterEsito: "", filterUtente: "" });
  const totalPages     = Math.max(1, Math.ceil(total / PAGE_SIZE));

  useEffect(() => {
    filtersRef.current = { page, filterAzione, filterEsito, filterUtente };
  }, [page, filterAzione, filterEsito, filterUtente]);

  const fetchLogs = useCallback(async (p = 0, az = "", es = "", ut = "", silent = false) => {
    if (!silent) setLoading(true);
    try {
      const params = new URLSearchParams({ page: p, page_size: PAGE_SIZE });
      if (az) params.set("azione", az);
      if (es) params.set("esito",  es);
      if (ut) params.set("utente", ut);
      const res  = await authFetch(`/api/v1/admin/activity-log?${params}`);
      const data = await res.json();
      const newTotal = data.total || 0;
      if (silent && p === 0 && lastCountRef.current > 0 && newTotal > lastCountRef.current) {
        setNewSince(n => n + (newTotal - lastCountRef.current));
      }
      lastCountRef.current = newTotal;
      setLogs(data.logs  || []);
      setTotal(newTotal);
      setPage(p);
    } catch (e) { console.error(e); }
    finally { if (!silent) setLoading(false); }
  }, [authFetch]);

  const fetchAzioni = useCallback(async () => {
    try {
      const res  = await authFetch("/api/v1/admin/activity-log/azioni");
      const data = await res.json();
      setAzioni(data.azioni || []);
    } catch {}
  }, [authFetch]);

  useEffect(() => { fetchLogs(0); fetchAzioni(); }, [fetchLogs, fetchAzioni]);

  useEffect(() => {
    if (autoRefresh) {
      intervalRef.current = setInterval(() => {
        const { filterAzione: az, filterEsito: es, filterUtente: ut } = filtersRef.current;
        fetchLogs(0, az, es, ut, true);
      }, 8000);
    } else {
      clearInterval(intervalRef.current);
      setNewSince(0);
    }
    return () => clearInterval(intervalRef.current);
  }, [autoRefresh, fetchLogs]);

  const applyFilter = useCallback(() => {
    setNewSince(0);
    setShowFilters(false);
    fetchLogs(0, filterAzione, filterEsito, filterUtente);
  }, [fetchLogs, filterAzione, filterEsito, filterUtente]);

  const resetFilter = useCallback(() => {
    setFilterAzione(""); setFilterEsito(""); setFilterUtente("");
    setNewSince(0);
    fetchLogs(0, "", "", "");
  }, [fetchLogs]);

  const hasActiveFilter = filterAzione || filterEsito || filterUtente;

  const inputSel = {
    padding: "7px 10px", background: "var(--surface2)",
    border: "1px solid var(--border-strong)", borderRadius: "6px",
    color: "var(--text)", fontFamily: "inherit", fontSize: "0.78rem", outline: "none",
  };
  const btnGhost = {
    padding: "6px 10px", background: "none",
    border: "1px solid var(--border-strong)", borderRadius: 6, cursor: "pointer",
    fontFamily: "inherit", fontSize: "0.75rem", color: "var(--text-muted)",
  };

  return (
    <div style={{ display: "flex", flexDirection: "column", height: "100%", overflow: "hidden" }}>

      {/* ── Header / Filters ── */}
      <div style={{
        background: "var(--surface)", borderBottom: "1px solid var(--border)",
        flexShrink: 0,
      }}>
        {/* Top bar: title + always-visible controls */}
        <div style={{
          display: "flex", alignItems: "center", gap: 8,
          flexWrap: "wrap", padding: "10px 14px",
        }}>
          <span style={{ fontSize: "0.82rem", fontWeight: 600, color: "var(--text)", marginRight: 2 }}>
            📋 Activity Log
          </span>
          <span style={{
            fontSize: "0.68rem", color: "var(--text-muted)",
            fontFamily: "'DM Mono', monospace", padding: "2px 8px",
            borderRadius: 20, background: "var(--surface2)", border: "1px solid var(--border)",
          }}>
            {total} eventi
          </span>

          {autoRefresh && newSince > 0 && (
            <button
              onClick={() => { fetchLogs(0, filterAzione, filterEsito, filterUtente); setNewSince(0); }}
              style={{
                fontSize: "0.68rem", padding: "2px 9px", borderRadius: 20, cursor: "pointer",
                background: "rgba(79,142,247,0.15)", color: "var(--accent)",
                border: "1px solid rgba(79,142,247,0.35)", fontFamily: "'DM Mono', monospace",
              }}>
              +{newSince} nuovi ↑
            </button>
          )}

          <div style={{ flex: 1 }} />

          {/* Live button — always visible */}
          <button
            onClick={() => setAutoRefresh(a => !a)}
            style={{
              ...btnGhost,
              background: autoRefresh ? "rgba(52,211,153,0.1)" : "none",
              border: autoRefresh ? "1px solid rgba(52,211,153,0.3)" : "1px solid var(--border-strong)",
              color: autoRefresh ? "#34d399" : "var(--text-muted)",
              display: "flex", alignItems: "center", gap: 5,
            }}>
            <span style={{
              width: 6, height: 6, borderRadius: "50%",
              background: autoRefresh ? "#34d399" : "var(--border-strong)",
              boxShadow: autoRefresh ? "0 0 6px #34d399" : "none",
              flexShrink: 0,
              animation: autoRefresh ? "pulse-dot 2s infinite" : "none",
            }} />
            Live
          </button>

          <button onClick={() => fetchLogs(0, filterAzione, filterEsito, filterUtente)} style={btnGhost} title="Aggiorna">↻</button>

          {/* Mobile: toggle filter button */}
          {isMobile && (
            <button
              onClick={() => setShowFilters(f => !f)}
              style={{
                ...btnGhost,
                background: (showFilters || hasActiveFilter) ? "var(--accent-dim)" : "none",
                color: (showFilters || hasActiveFilter) ? "var(--accent-bright)" : "var(--text-muted)",
                border: hasActiveFilter ? "1px solid var(--border-accent)" : "1px solid var(--border-strong)",
                display: "flex", alignItems: "center", gap: 5,
              }}>
              🔍 Filtri{hasActiveFilter ? " •" : ""}
            </button>
          )}
        </div>

        {/* Filter row — always on desktop, toggleable on mobile */}
        {(!isMobile || showFilters) && (
          <div style={{
            display: "flex", alignItems: "center", gap: 8,
            flexWrap: "wrap", padding: "8px 14px 10px",
            borderTop: isMobile ? "1px solid var(--border)" : "none",
          }}>
            <input
              style={{ ...inputSel, width: isMobile ? "100%" : 160, boxSizing: "border-box" }}
              placeholder="🔍 Utente…" value={filterUtente}
              onChange={(e) => setFilterUtente(e.target.value)}
              onKeyDown={(e) => e.key === "Enter" && applyFilter()}
            />
            <select
              style={{ ...inputSel, flex: isMobile ? "1 1 calc(50% - 4px)" : "unset", boxSizing: "border-box" }}
              value={filterAzione} onChange={(e) => setFilterAzione(e.target.value)}>
              <option value="">Tutte le azioni</option>
              {azioni.map((a) => <option key={a} value={a}>{AZIONE_INFO(a).label}</option>)}
            </select>
            <select
              style={{ ...inputSel, flex: isMobile ? "1 1 calc(50% - 4px)" : "unset", boxSizing: "border-box" }}
              value={filterEsito} onChange={(e) => setFilterEsito(e.target.value)}>
              <option value="">Tutti gli esiti</option>
              <option value="ok">OK</option>
              <option value="warning">Warning</option>
              <option value="error">Errore</option>
            </select>
            <div style={{ display: "flex", gap: 6, flexWrap: "nowrap" }}>
              <button
                onClick={applyFilter}
                style={{
                  padding: "7px 14px", background: "var(--accent)", color: "white",
                  border: "none", borderRadius: 6, cursor: "pointer",
                  fontFamily: "inherit", fontSize: "0.78rem", fontWeight: 600,
                  whiteSpace: "nowrap",
                }}>Filtra</button>
              {hasActiveFilter && (
                <button onClick={resetFilter} style={{ ...btnGhost, whiteSpace: "nowrap" }}>✕ Reset</button>
              )}
            </div>
          </div>
        )}
      </div>

      {/* ── Table header — desktop only ── */}
      {!isMobile && (
        <div style={{
          display: "grid",
          gridTemplateColumns: "148px 155px 1fr 72px 36px",
          gap: 8, padding: "5px 14px 5px 16px",
          background: "var(--surface2)", borderBottom: "1px solid var(--border)",
          flexShrink: 0,
        }}>
          {["Timestamp", "Azione", "Utente / IP", "Esito", ""].map((h, i) => (
            <span key={i} style={{
              fontSize: "0.64rem", fontWeight: 700, color: "var(--text-muted)",
              textTransform: "uppercase", letterSpacing: "0.07em",
            }}>{h}</span>
          ))}
        </div>
      )}

      {/* ── Log rows ── */}
      <div style={{ flex: 1, overflowY: "auto" }}>
        {loading && (
          <div style={{ padding: 24, textAlign: "center", color: "var(--text-muted)", fontSize: "0.78rem" }}>
            Caricamento…
          </div>
        )}
        {!loading && logs.length === 0 && (
          <div style={{ padding: 40, textAlign: "center", color: "var(--text-muted)", fontSize: "0.78rem" }}>
            {hasActiveFilter ? "Nessun log per i filtri selezionati." : "Nessun log trovato."}
          </div>
        )}
        {!loading && logs.map((log, i) =>
          isMobile
            ? <LogRowMobile key={log.log_id} log={log} isEven={i % 2 === 0} />
            : <LogRowDesktop key={log.log_id} log={log} isEven={i % 2 === 0} />
        )}
      </div>

      {/* ── Pagination ── */}
      {totalPages > 1 && (
        <div style={{
          display: "flex", alignItems: "center", justifyContent: "space-between",
          padding: "8px 14px", borderTop: "1px solid var(--border)",
          background: "var(--surface)", flexShrink: 0,
        }}>
          <button
            disabled={page <= 0}
            onClick={() => fetchLogs(page - 1, filterAzione, filterEsito, filterUtente)}
            style={{ ...btnGhost, cursor: page <= 0 ? "not-allowed" : "pointer", opacity: page <= 0 ? 0.35 : 1 }}>
            ← Precedente
          </button>
          <span style={{ fontSize: "0.72rem", color: "var(--text-muted)", fontFamily: "'DM Mono', monospace" }}>
            {page + 1} / {totalPages}
          </span>
          <button
            disabled={page >= totalPages - 1}
            onClick={() => fetchLogs(page + 1, filterAzione, filterEsito, filterUtente)}
            style={{ ...btnGhost, cursor: page >= totalPages - 1 ? "not-allowed" : "pointer", opacity: page >= totalPages - 1 ? 0.35 : 1 }}>
            Successiva →
          </button>
        </div>
      )}
    </div>
  );
}