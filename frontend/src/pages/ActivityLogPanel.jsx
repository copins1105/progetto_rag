// src/pages/ActivityLogPanel.jsx
// Pannello log attività per il pannello admin.
// Mostra tutti gli eventi registrati in Activity_Log con filtri e paginazione.

import { useState, useEffect, useCallback, useRef } from "react";
import { useAuth } from "../context/AuthContext";

// ─── palette condivisa con AdminPanel ────────────────────────
const ESITO_STYLE = {
  ok:      { bg: "rgba(52,211,153,0.10)", color: "#34d399", border: "rgba(52,211,153,0.28)", label: "ok" },
  warning: { bg: "rgba(251,191,36,0.10)", color: "#fbbf24", border: "rgba(251,191,36,0.28)", label: "warning" },
  error:   { bg: "rgba(239,68,68,0.10)",  color: "#f87171", border: "rgba(239,68,68,0.28)",  label: "errore" },
};

const AZIONE_ICON = {
  login:           "🔐",
  logout:          "🚪",
  password_changed:"🔑",
  doc_upload:      "⬆️",
  doc_ingestion:   "⚙️",
  doc_load:        "💾",
  doc_update:      "✏️",
  doc_delete:      "🗑️",
  user_created:    "👤",
  user_updated:    "✏️",
  user_deleted:    "🗑️",
};

const AZIONE_LABEL = {
  login:           "Login",
  logout:          "Logout",
  password_changed:"Cambio password",
  doc_upload:      "Upload PDF",
  doc_ingestion:   "Ingestion",
  doc_load:        "Caricamento DB",
  doc_update:      "Modifica doc.",
  doc_delete:      "Eliminazione doc.",
  user_created:    "Utente creato",
  user_updated:    "Utente modificato",
  user_deleted:    "Utente eliminato",
};

const PAGE_SIZE = 50;

// ─── Formatta timestamp ──────────────────────────────────────
function fmtTs(ts) {
  if (!ts) return "—";
  try {
    const d = new Date(ts);
    const pad = (n) => String(n).padStart(2, "0");
    return `${d.getFullYear()}-${pad(d.getMonth()+1)}-${pad(d.getDate())}  ${pad(d.getHours())}:${pad(d.getMinutes())}:${pad(d.getSeconds())}`;
  } catch { return ts; }
}

// ─── Dettaglio JSON inline ───────────────────────────────────
function DetailBadge({ data }) {
  if (!data || Object.keys(data).length === 0) return null;
  return (
    <div style={{ display: "flex", flexWrap: "wrap", gap: 4, marginTop: 4 }}>
      {Object.entries(data).map(([k, v]) => {
        if (v === null || v === undefined || v === "") return null;
        const val = typeof v === "object" ? JSON.stringify(v) : String(v);
        return (
          <span key={k} style={{
            fontSize: "0.62rem", fontFamily: "'DM Mono', monospace",
            padding: "1px 6px", borderRadius: 4,
            background: "var(--surface)", border: "1px solid var(--border)",
            color: "var(--text-muted)", maxWidth: 220,
            overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap",
          }} title={`${k}: ${val}`}>
            <span style={{ color: "var(--accent)", marginRight: 3 }}>{k}</span>{val}
          </span>
        );
      })}
    </div>
  );
}

// ─── Riga log ────────────────────────────────────────────────
function LogRow({ log, isEven }) {
  const [open, setOpen] = useState(false);
  const esito  = ESITO_STYLE[log.esito] || ESITO_STYLE.ok;
  const icon   = AZIONE_ICON[log.azione]  || "📋";
  const label  = AZIONE_LABEL[log.azione] || log.azione;

  const utente = log.utente_email
    ? (log.utente_nome ? `${log.utente_nome} ${log.utente_cognome || ""}`.trim() : log.utente_email)
    : "—";

  const hasDetail = log.dettaglio && Object.keys(log.dettaglio).length > 0;

  return (
    <div
      onClick={() => hasDetail && setOpen(o => !o)}
      style={{
        borderBottom: "1px solid var(--border)",
        background: isEven ? "var(--surface2)" : "var(--surface)",
        cursor: hasDetail ? "pointer" : "default",
        transition: "background 0.12s",
      }}
    >
      {/* Riga principale */}
      <div style={{
        display: "grid",
        gridTemplateColumns: "160px 140px 1fr 80px 80px",
        gap: 8, alignItems: "center",
        padding: "9px 14px",
      }}>
        {/* Timestamp */}
        <span style={{
          fontSize: "0.68rem", fontFamily: "'DM Mono', monospace",
          color: "var(--text-muted)", whiteSpace: "nowrap",
        }}>
          {fmtTs(log.timestamp)}
        </span>

        {/* Azione */}
        <div style={{ display: "flex", alignItems: "center", gap: 6 }}>
          <span style={{ fontSize: "0.9rem" }}>{icon}</span>
          <span style={{ fontSize: "0.76rem", fontWeight: 600, color: "var(--text)" }}>{label}</span>
        </div>

        {/* Utente */}
        <div style={{ minWidth: 0 }}>
          <div style={{
            fontSize: "0.75rem", color: "var(--text-dim)",
            overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap",
          }} title={log.utente_email}>{utente}</div>
          {log.ip_address && (
            <div style={{ fontSize: "0.62rem", color: "var(--text-muted)", fontFamily: "'DM Mono', monospace" }}>
              {log.ip_address}
            </div>
          )}
        </div>

        {/* Esito */}
        <span style={{
          fontSize: "0.62rem", fontWeight: 700, padding: "2px 7px",
          borderRadius: 20, textAlign: "center",
          background: esito.bg, color: esito.color,
          border: `1px solid ${esito.border}`,
          fontFamily: "'DM Mono', monospace",
        }}>
          {esito.label}
        </span>

        {/* Expand toggle */}
        {hasDetail ? (
          <span style={{
            fontSize: "0.65rem", color: "var(--text-muted)",
            textAlign: "right", userSelect: "none",
          }}>
            {open ? "▲ meno" : "▼ più"}
          </span>
        ) : <span />}
      </div>

      {/* Dettaglio espanso */}
      {open && hasDetail && (
        <div style={{
          padding: "0 14px 10px 14px",
          borderTop: "1px solid var(--border)",
          background: "rgba(0,0,0,0.12)",
        }}>
          <DetailBadge data={log.dettaglio} />
        </div>
      )}
    </div>
  );
}

// ─── Panel principale ────────────────────────────────────────
export default function ActivityLogPanel() {
  const { authFetch } = useAuth();

  const [logs,        setLogs]        = useState([]);
  const [total,       setTotal]       = useState(0);
  const [page,        setPage]        = useState(0);
  const [loading,     setLoading]     = useState(false);
  const [filterAzione, setFilterAzione] = useState("");
  const [filterEsito,  setFilterEsito]  = useState("");
  const [azioni,      setAzioni]      = useState([]);
  const [autoRefresh, setAutoRefresh] = useState(false);
  const intervalRef   = useRef(null);

  const totalPages = Math.max(1, Math.ceil(total / PAGE_SIZE));

  const fetchLogs = useCallback(async (p = page, az = filterAzione, es = filterEsito) => {
    setLoading(true);
    try {
      const params = new URLSearchParams({ page: p, page_size: PAGE_SIZE });
      if (az) params.set("azione", az);
      if (es) params.set("esito",  es);
      const res  = await authFetch(`/api/v1/admin/activity-log?${params}`);
      const data = await res.json();
      setLogs(data.logs  || []);
      setTotal(data.total || 0);
      setPage(p);
    } catch (e) { console.error(e); }
    finally { setLoading(false); }
  }, [authFetch, page, filterAzione, filterEsito]);

  const fetchAzioni = useCallback(async () => {
    try {
      const res  = await authFetch("/api/v1/admin/activity-log/azioni");
      const data = await res.json();
      setAzioni(data.azioni || []);
    } catch {}
  }, [authFetch]);

  // Mount
  useEffect(() => { fetchLogs(0); fetchAzioni(); }, []); // eslint-disable-line

  // Auto-refresh
  useEffect(() => {
    if (autoRefresh) {
      intervalRef.current = setInterval(() => fetchLogs(0, filterAzione, filterEsito), 10000);
    } else {
      clearInterval(intervalRef.current);
    }
    return () => clearInterval(intervalRef.current);
  }, [autoRefresh, filterAzione, filterEsito]); // eslint-disable-line

  const applyFilter = () => { fetchLogs(0, filterAzione, filterEsito); };

  const resetFilter = () => {
    setFilterAzione(""); setFilterEsito("");
    fetchLogs(0, "", "");
  };

  const sel = {
    padding: "7px 10px", background: "var(--surface2)",
    border: "1px solid var(--border-strong)", borderRadius: "6px",
    color: "var(--text)", fontFamily: "inherit", fontSize: "0.78rem", outline: "none",
  };

  return (
    <div style={{ display: "flex", flexDirection: "column", height: "100%" }}>

      {/* ── Toolbar ── */}
      <div style={{
        display: "flex", alignItems: "center", gap: 8, flexWrap: "wrap",
        padding: "12px 14px", borderBottom: "1px solid var(--border)",
        background: "var(--surface)", flexShrink: 0,
      }}>
        {/* Titolo */}
        <span style={{ fontSize: "0.82rem", fontWeight: 600, color: "var(--text)", marginRight: 4 }}>
          📋 Activity Log
        </span>
        <span style={{
          fontSize: "0.68rem", color: "var(--text-muted)", fontFamily: "'DM Mono', monospace",
          padding: "2px 8px", borderRadius: 20, background: "var(--surface2)",
          border: "1px solid var(--border)",
        }}>
          {total} eventi
        </span>

        <div style={{ flex: 1 }} />

        {/* Filtro azione */}
        <select
          style={sel}
          value={filterAzione}
          onChange={e => setFilterAzione(e.target.value)}
        >
          <option value="">Tutte le azioni</option>
          {azioni.map(a => (
            <option key={a} value={a}>{AZIONE_LABEL[a] || a}</option>
          ))}
        </select>

        {/* Filtro esito */}
        <select style={sel} value={filterEsito} onChange={e => setFilterEsito(e.target.value)}>
          <option value="">Tutti gli esiti</option>
          <option value="ok">OK</option>
          <option value="warning">Warning</option>
          <option value="error">Errore</option>
        </select>

        {/* Applica filtri */}
        <button onClick={applyFilter} style={{
          padding: "7px 12px", background: "var(--accent)", color: "white",
          border: "none", borderRadius: 6, cursor: "pointer",
          fontFamily: "inherit", fontSize: "0.78rem", fontWeight: 600,
        }}>
          Filtra
        </button>

        {(filterAzione || filterEsito) && (
          <button onClick={resetFilter} style={{
            padding: "7px 10px", background: "none",
            border: "1px solid var(--border-strong)", borderRadius: 6, cursor: "pointer",
            fontFamily: "inherit", fontSize: "0.75rem", color: "var(--text-muted)",
          }}>
            ✕ Reset
          </button>
        )}

        {/* Auto-refresh */}
        <button onClick={() => setAutoRefresh(a => !a)} style={{
          padding: "7px 10px",
          background: autoRefresh ? "rgba(52,211,153,0.1)" : "none",
          border: `1px solid ${autoRefresh ? "rgba(52,211,153,0.3)" : "var(--border-strong)"}`,
          borderRadius: 6, cursor: "pointer", fontFamily: "inherit",
          fontSize: "0.75rem",
          color: autoRefresh ? "#34d399" : "var(--text-muted)",
        }}>
          {autoRefresh ? "● Live" : "○ Live"}
        </button>

        {/* Aggiorna */}
        <button onClick={() => fetchLogs(0)} style={{
          padding: "7px 10px", background: "none",
          border: "1px solid var(--border-strong)", borderRadius: 6, cursor: "pointer",
          fontFamily: "inherit", fontSize: "0.75rem", color: "var(--text-muted)",
        }}>
          ↻
        </button>
      </div>

      {/* ── Header colonne ── */}
      <div style={{
        display: "grid",
        gridTemplateColumns: "160px 140px 1fr 80px 80px",
        gap: 8, padding: "6px 14px",
        background: "var(--surface2)", borderBottom: "1px solid var(--border)",
        flexShrink: 0,
      }}>
        {["Timestamp", "Azione", "Utente / IP", "Esito", ""].map((h, i) => (
          <span key={i} style={{
            fontSize: "0.65rem", fontWeight: 700, color: "var(--text-muted)",
            textTransform: "uppercase", letterSpacing: "0.07em",
          }}>{h}</span>
        ))}
      </div>

      {/* ── Lista log ── */}
      <div style={{ flex: 1, overflowY: "auto" }}>
        {loading && (
          <div style={{ padding: 24, textAlign: "center", color: "var(--text-muted)", fontSize: "0.78rem" }}>
            Caricamento…
          </div>
        )}
        {!loading && logs.length === 0 && (
          <div style={{ padding: 40, textAlign: "center", color: "var(--text-muted)", fontSize: "0.78rem" }}>
            Nessun log trovato.
          </div>
        )}
        {!loading && logs.map((log, i) => (
          <LogRow key={log.log_id} log={log} isEven={i % 2 === 0} />
        ))}
      </div>

      {/* ── Paginazione ── */}
      {totalPages > 1 && (
        <div style={{
          display: "flex", alignItems: "center", justifyContent: "space-between",
          padding: "10px 14px", borderTop: "1px solid var(--border)",
          background: "var(--surface)", flexShrink: 0,
        }}>
          <button
            disabled={page <= 0}
            onClick={() => fetchLogs(page - 1)}
            style={{
              padding: "6px 12px", background: "none",
              border: "1px solid var(--border-strong)", borderRadius: 6,
              cursor: page <= 0 ? "not-allowed" : "pointer", opacity: page <= 0 ? 0.35 : 1,
              fontFamily: "inherit", fontSize: "0.75rem", color: "var(--text-muted)",
            }}
          >
            ← Precedente
          </button>

          <span style={{ fontSize: "0.72rem", color: "var(--text-muted)", fontFamily: "'DM Mono', monospace" }}>
            pag. {page + 1} / {totalPages}
          </span>

          <button
            disabled={page >= totalPages - 1}
            onClick={() => fetchLogs(page + 1)}
            style={{
              padding: "6px 12px", background: "none",
              border: "1px solid var(--border-strong)", borderRadius: 6,
              cursor: page >= totalPages - 1 ? "not-allowed" : "pointer",
              opacity: page >= totalPages - 1 ? 0.35 : 1,
              fontFamily: "inherit", fontSize: "0.75rem", color: "var(--text-muted)",
            }}
          >
            Successiva →
          </button>
        </div>
      )}
    </div>
  );
}
