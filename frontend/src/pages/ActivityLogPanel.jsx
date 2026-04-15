// src/pages/ActivityLogPanel.jsx
// Pannello log attività — versione 2
// Novità:
//   - Ricerca per utente (nome, cognome, email)
//   - Label e icone per TUTTE le azioni (doc_* incluse)
//   - Esito "warning" visibile con stile dedicato
//   - Live: si attiva solo su azioni recenti (<30s), non fa polling inutile
//   - IP normalizzato (senza /32)
//   - Dettaglio espanso più leggibile

import { useState, useEffect, useCallback, useRef } from "react";
import { useAuth } from "../context/AuthContext";

// ─── Palette esiti ────────────────────────────────────────────
const ESITO_STYLE = {
  ok:      { bg: "rgba(52,211,153,0.10)",  color: "#34d399", border: "rgba(52,211,153,0.28)", label: "ok"      },
  warning: { bg: "rgba(251,191,36,0.10)",  color: "#fbbf24", border: "rgba(251,191,36,0.28)", label: "warning" },
  error:   { bg: "rgba(239,68,68,0.10)",   color: "#f87171", border: "rgba(239,68,68,0.28)",  label: "errore"  },
};

// ─── Azioni: icona + label italiana ──────────────────────────
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

const AZIONE_INFO = (azione) =>
  AZIONI[azione] || { icon: "📋", label: azione };

const PAGE_SIZE = 50;

// ─── Formatta timestamp ──────────────────────────────────────
function fmtTs(ts) {
  if (!ts) return "—";
  try {
    const d = new Date(ts);
    const pad = (n) => String(n).padStart(2, "0");
    return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}  ${pad(d.getHours())}:${pad(d.getMinutes())}:${pad(d.getSeconds())}`;
  } catch { return ts; }
}

// ─── Quanto fa che è arrivato (per Live badge) ───────────────
function isRecent(ts, maxSeconds = 30) {
  if (!ts) return false;
  try {
    return (Date.now() - new Date(ts).getTime()) < maxSeconds * 1000;
  } catch { return false; }
}

// ─── Chip dettaglio ──────────────────────────────────────────
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

// ─── Riga log ────────────────────────────────────────────────
function LogRow({ log, isEven }) {
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
      onClick={() => hasDetail && setOpen((o) => !o)}
      style={{
        borderBottom: "1px solid var(--border)",
        background: isEven ? "var(--surface2)" : "var(--surface)",
        cursor: hasDetail ? "pointer" : "default",
        transition: "background 0.12s",
        position: "relative",
      }}
    >
      {/* Striscia "recente" a sinistra */}
      {recent && (
        <div style={{
          position: "absolute", left: 0, top: 0, bottom: 0, width: 2,
          background: "var(--accent)", borderRadius: "0 2px 2px 0",
        }} />
      )}

      <div style={{
        display: "grid",
        gridTemplateColumns: "152px 160px 1fr 72px 52px",
        gap: 8, alignItems: "center",
        padding: "8px 14px 8px 16px",
      }}>
        {/* Timestamp */}
        <span style={{
          fontSize: "0.67rem", fontFamily: "'DM Mono', monospace",
          color: recent ? "var(--accent)" : "var(--text-muted)",
          whiteSpace: "nowrap",
        }}>
          {fmtTs(log.timestamp)}
        </span>

        {/* Azione */}
        <div style={{ display: "flex", alignItems: "center", gap: 7 }}>
          <span style={{ fontSize: "0.88rem", lineHeight: 1 }}>{info.icon}</span>
          <span style={{ fontSize: "0.76rem", fontWeight: 600, color: "var(--text)" }}>
            {info.label}
          </span>
        </div>

        {/* Utente / IP */}
        <div style={{ minWidth: 0 }}>
          <div style={{
            fontSize: "0.75rem", color: "var(--text-dim)",
            overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap",
          }} title={log.utente_email}>
            {nomeUtente}
          </div>
          {log.ip_address && (
            <div style={{
              fontSize: "0.62rem", color: "var(--text-muted)",
              fontFamily: "'DM Mono', monospace",
            }}>
              {log.ip_address}
            </div>
          )}
        </div>

        {/* Esito */}
        <span style={{
          fontSize: "0.62rem", fontWeight: 700, padding: "2px 8px",
          borderRadius: 20, textAlign: "center",
          background: esito.bg, color: esito.color,
          border: `1px solid ${esito.border}`,
          fontFamily: "'DM Mono', monospace", whiteSpace: "nowrap",
        }}>
          {esito.label}
        </span>

        {/* Toggle */}
        {hasDetail ? (
          <span style={{
            fontSize: "0.65rem", color: "var(--text-muted)",
            textAlign: "right", userSelect: "none",
          }}>
            {open ? "▲" : "▼"}
          </span>
        ) : <span />}
      </div>

      {/* Dettaglio espanso */}
      {open && hasDetail && (
        <div style={{
          padding: "6px 14px 10px 16px",
          borderTop: "1px solid var(--border)",
          background: "rgba(0,0,0,0.10)",
          display: "flex", flexWrap: "wrap", gap: 5,
        }}>
          {dettaglioEntries.map(([k, v]) => (
            <DetailChip key={k} k={k} v={v} />
          ))}
        </div>
      )}
    </div>
  );
}

// ─── Panel principale ────────────────────────────────────────
export default function ActivityLogPanel() {
  const { authFetch } = useAuth();

  const [logs,          setLogs]          = useState([]);
  const [total,         setTotal]         = useState(0);
  const [page,          setPage]          = useState(0);
  const [loading,       setLoading]       = useState(false);
  const [filterAzione,  setFilterAzione]  = useState("");
  const [filterEsito,   setFilterEsito]   = useState("");
  const [filterUtente,  setFilterUtente]  = useState("");
  const [azioni,        setAzioni]        = useState([]);
  const [autoRefresh,   setAutoRefresh]   = useState(false);
  const [newSince,      setNewSince]      = useState(0);   // contatore nuovi log in Live
  const intervalRef     = useRef(null);
  const lastCountRef    = useRef(0);

  const totalPages = Math.max(1, Math.ceil(total / PAGE_SIZE));

  const fetchLogs = useCallback(async (
    p = page,
    az = filterAzione,
    es = filterEsito,
    ut = filterUtente,
    silent = false,
  ) => {
    if (!silent) setLoading(true);
    try {
      const params = new URLSearchParams({ page: p, page_size: PAGE_SIZE });
      if (az) params.set("azione", az);
      if (es) params.set("esito",  es);
      if (ut) params.set("utente", ut);
      const res  = await authFetch(`/api/v1/admin/activity-log?${params}`);
      const data = await res.json();
      const newTotal = data.total || 0;

      // Notifica nuovi eventi quando Live è attivo
      if (autoRefresh && p === 0 && lastCountRef.current > 0 && newTotal > lastCountRef.current) {
        setNewSince((n) => n + (newTotal - lastCountRef.current));
      }
      lastCountRef.current = newTotal;

      setLogs(data.logs  || []);
      setTotal(newTotal);
      setPage(p);
    } catch (e) { console.error(e); }
    finally { if (!silent) setLoading(false); }
  }, [authFetch, page, filterAzione, filterEsito, filterUtente, autoRefresh]);

  const fetchAzioni = useCallback(async () => {
    try {
      const res  = await authFetch("/api/v1/admin/activity-log/azioni");
      const data = await res.json();
      setAzioni(data.azioni || []);
    } catch {}
  }, [authFetch]);

  useEffect(() => { fetchLogs(0); fetchAzioni(); }, []); // eslint-disable-line

  // Auto-refresh — poll ogni 8s solo quando Live è ON
  useEffect(() => {
    if (autoRefresh) {
      intervalRef.current = setInterval(
        () => fetchLogs(0, filterAzione, filterEsito, filterUtente, true),
        8000,
      );
    } else {
      clearInterval(intervalRef.current);
      setNewSince(0);
    }
    return () => clearInterval(intervalRef.current);
  }, [autoRefresh, filterAzione, filterEsito, filterUtente]); // eslint-disable-line

  const applyFilter = () => {
    setNewSince(0);
    fetchLogs(0, filterAzione, filterEsito, filterUtente);
  };
  const resetFilter = () => {
    setFilterAzione(""); setFilterEsito(""); setFilterUtente("");
    setNewSince(0);
    fetchLogs(0, "", "", "");
  };

  // ── Stili locali ──────────────────────────────────────────
  const inputSel = {
    padding: "7px 10px", background: "var(--surface2)",
    border: "1px solid var(--border-strong)", borderRadius: "6px",
    color: "var(--text)", fontFamily: "inherit", fontSize: "0.78rem", outline: "none",
  };
  const btnGhost = {
    padding: "7px 10px", background: "none",
    border: "1px solid var(--border-strong)", borderRadius: 6, cursor: "pointer",
    fontFamily: "inherit", fontSize: "0.75rem", color: "var(--text-muted)",
  };

  return (
    <div style={{ display: "flex", flexDirection: "column", height: "100%" }}>

      {/* ── Toolbar principale ── */}
      <div style={{
        display: "flex", alignItems: "center", gap: 8, flexWrap: "wrap",
        padding: "10px 14px", borderBottom: "1px solid var(--border)",
        background: "var(--surface)", flexShrink: 0,
      }}>
        <span style={{ fontSize: "0.82rem", fontWeight: 600, color: "var(--text)", marginRight: 2 }}>
          📋 Activity Log
        </span>
        <span style={{
          fontSize: "0.68rem", color: "var(--text-muted)", fontFamily: "'DM Mono', monospace",
          padding: "2px 8px", borderRadius: 20, background: "var(--surface2)",
          border: "1px solid var(--border)",
        }}>
          {total} eventi
        </span>

        {/* Badge "nuovi" durante Live */}
        {autoRefresh && newSince > 0 && (
          <button
            onClick={() => { fetchLogs(0, filterAzione, filterEsito, filterUtente); setNewSince(0); }}
            style={{
              fontSize: "0.68rem", padding: "2px 9px", borderRadius: 20, cursor: "pointer",
              background: "rgba(79,142,247,0.15)", color: "var(--accent)",
              border: "1px solid rgba(79,142,247,0.35)", fontFamily: "'DM Mono', monospace",
              animation: "pulse-dot 2s infinite",
            }}
          >
            +{newSince} nuovi ↑
          </button>
        )}

        <div style={{ flex: 1 }} />

        {/* Ricerca utente */}
        <input
          style={{ ...inputSel, width: 160 }}
          placeholder="🔍 Utente…"
          value={filterUtente}
          onChange={(e) => setFilterUtente(e.target.value)}
          onKeyDown={(e) => e.key === "Enter" && applyFilter()}
        />

        {/* Filtro azione */}
        <select style={inputSel} value={filterAzione} onChange={(e) => setFilterAzione(e.target.value)}>
          <option value="">Tutte le azioni</option>
          {azioni.map((a) => (
            <option key={a} value={a}>
              {AZIONE_INFO(a).label}
            </option>
          ))}
        </select>

        {/* Filtro esito */}
        <select style={inputSel} value={filterEsito} onChange={(e) => setFilterEsito(e.target.value)}>
          <option value="">Tutti gli esiti</option>
          <option value="ok">OK</option>
          <option value="warning">Warning</option>
          <option value="error">Errore</option>
        </select>

        <button
          onClick={applyFilter}
          style={{
            padding: "7px 14px", background: "var(--accent)", color: "white",
            border: "none", borderRadius: 6, cursor: "pointer",
            fontFamily: "inherit", fontSize: "0.78rem", fontWeight: 600,
          }}
        >
          Filtra
        </button>

        {(filterAzione || filterEsito || filterUtente) && (
          <button onClick={resetFilter} style={{ ...btnGhost, color: "var(--text-muted)" }}>
            ✕ Reset
          </button>
        )}

        {/* Live toggle */}
        <button
          onClick={() => setAutoRefresh((a) => !a)}
          style={{
            ...btnGhost,
            background: autoRefresh ? "rgba(52,211,153,0.1)"  : "none",
            border:     autoRefresh ? "1px solid rgba(52,211,153,0.3)" : "1px solid var(--border-strong)",
            color:      autoRefresh ? "#34d399" : "var(--text-muted)",
            display:    "flex", alignItems: "center", gap: 5,
          }}
          title="Aggiornamento automatico ogni 8 secondi"
        >
          <span style={{
            width: 6, height: 6, borderRadius: "50%",
            background: autoRefresh ? "#34d399" : "var(--border-strong)",
            boxShadow:  autoRefresh ? "0 0 6px #34d399" : "none",
            flexShrink: 0,
            animation:  autoRefresh ? "pulse-dot 2s infinite" : "none",
          }} />
          Live
        </button>

        {/* Refresh manuale */}
        <button onClick={() => fetchLogs(0)} style={btnGhost} title="Aggiorna">
          ↻
        </button>
      </div>

      {/* ── Header colonne ── */}
      <div style={{
        display: "grid",
        gridTemplateColumns: "152px 160px 1fr 72px 52px",
        gap: 8, padding: "5px 14px 5px 16px",
        background: "var(--surface2)", borderBottom: "1px solid var(--border)",
        flexShrink: 0,
      }}>
        {["Timestamp", "Azione", "Utente / IP", "Esito", ""].map((h, i) => (
          <span key={i} style={{
            fontSize: "0.64rem", fontWeight: 700, color: "var(--text-muted)",
            textTransform: "uppercase", letterSpacing: "0.07em",
          }}>
            {h}
          </span>
        ))}
      </div>

      {/* ── Lista log ── */}
      <div style={{ flex: 1, overflowY: "auto" }}>
        {loading && (
          <div style={{
            padding: 24, textAlign: "center",
            color: "var(--text-muted)", fontSize: "0.78rem",
          }}>
            Caricamento…
          </div>
        )}
        {!loading && logs.length === 0 && (
          <div style={{
            padding: 40, textAlign: "center",
            color: "var(--text-muted)", fontSize: "0.78rem",
          }}>
            {filterAzione || filterEsito || filterUtente
              ? "Nessun log per i filtri selezionati."
              : "Nessun log trovato."}
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
          padding: "8px 14px", borderTop: "1px solid var(--border)",
          background: "var(--surface)", flexShrink: 0,
        }}>
          <button
            disabled={page <= 0}
            onClick={() => fetchLogs(page - 1)}
            style={{
              ...btnGhost,
              cursor: page <= 0 ? "not-allowed" : "pointer",
              opacity: page <= 0 ? 0.35 : 1,
            }}
          >
            ← Precedente
          </button>
          <span style={{
            fontSize: "0.72rem", color: "var(--text-muted)",
            fontFamily: "'DM Mono', monospace",
          }}>
            pag. {page + 1} / {totalPages}
          </span>
          <button
            disabled={page >= totalPages - 1}
            onClick={() => fetchLogs(page + 1)}
            style={{
              ...btnGhost,
              cursor: page >= totalPages - 1 ? "not-allowed" : "pointer",
              opacity: page >= totalPages - 1 ? 0.35 : 1,
            }}
          >
            Successiva →
          </button>
        </div>
      )}
    </div>
  );
}