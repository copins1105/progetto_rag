// src/pages/ChatAuditPanel.jsx
// FIX LINK CLICCABILI:
// - DocBadge: costruisce URL del PDF da doc.link (se presente) oppure
//   dal titolo come fallback → /api/v1/admin/pdf/{titolo}
// - Aggiunge numero pagina come #page=N
// - Scrollbar sinistra e destra già corrette dalla versione precedente

import { useState, useEffect, useCallback } from "react";
import { useAuth } from "../context/AuthContext";
import ReactMarkdown from "react-markdown";
import remarkGfm from "remark-gfm";

const API_BASE = import.meta.env.VITE_API_URL || "https://127.0.0.1:8080";

// Costruisce href completo per un documento.
// Usa doc.link se presente, altrimenti ricostruisce dal titolo.
// Aggiunge #page=N se disponibile.
function buildDocHref(doc) {
  let base = null;
  if (doc.link) {
    base = doc.link.startsWith("http") ? doc.link : `${API_BASE}${doc.link}`;
  } else if (doc.titolo) {
    base = `${API_BASE}/api/v1/admin/pdf/${encodeURIComponent(doc.titolo)}`;
  }
  if (!base) return null;
  const page = doc.pagina ?? doc.page ?? null;
  return page ? `${base}#page=${page}` : base;
}

const s = {
  root: { display: "flex", height: "100%", overflow: "hidden" },
  list: {
    width: 340, flexShrink: 0, display: "flex", flexDirection: "column",
    minHeight: 0, borderRight: "1px solid var(--border)",
    background: "var(--surface)", overflow: "hidden",
  },
  listHeader: { padding: "12px 14px", borderBottom: "1px solid var(--border)", flexShrink: 0 },
  listTitle: { fontSize: "0.85rem", fontWeight: 600, color: "var(--text)", marginBottom: 8 },
  filterRow: { display: "flex", flexDirection: "column", gap: 6 },
  input: {
    padding: "6px 10px", background: "var(--surface2)",
    border: "1px solid var(--border-strong)", borderRadius: 6,
    color: "var(--text)", fontFamily: "inherit", fontSize: "0.78rem",
    outline: "none", width: "100%",
  },
  filterGrid: { display: "grid", gridTemplateColumns: "1fr 1fr", gap: 6 },
  checkRow: { display: "flex", alignItems: "center", gap: 6, fontSize: "0.72rem", color: "var(--text-muted)" },
  sessioni: { flex: 1, minHeight: 0, overflowY: "auto", overflowX: "hidden", padding: "6px 8px" },
  sessione: (sel) => ({
    padding: "10px 12px", borderRadius: 8, marginBottom: 4, cursor: "pointer",
    background: sel ? "rgba(53,128,184,0.12)" : "transparent",
    border: sel ? "1px solid rgba(53,128,184,0.35)" : "1px solid transparent",
    transition: "all 0.12s",
  }),
  sessTitle: (sel) => ({
    fontSize: "0.78rem", fontWeight: 600,
    color: sel ? "var(--accent-bright)" : "var(--text)",
    overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap",
  }),
  sessMeta: { display: "flex", gap: 6, marginTop: 3, flexWrap: "wrap", alignItems: "center" },
  sessBadge: (c) => ({
    fontSize: "0.62rem", fontWeight: 700, padding: "1px 6px", borderRadius: 20,
    fontFamily: "'JetBrains Mono', monospace", ...c,
  }),
  sessDate: { fontSize: "0.65rem", color: "var(--text-muted)", fontFamily: "'JetBrains Mono', monospace" },
  detail: { flex: 1, minHeight: 0, display: "flex", flexDirection: "column", overflow: "hidden", background: "var(--bg)" },
  detailHeader: { padding: "12px 18px", background: "var(--surface)", borderBottom: "1px solid var(--border)", flexShrink: 0 },
  detailTitle: { fontSize: "0.88rem", fontWeight: 600, color: "var(--text)", marginBottom: 4 },
  detailMeta: { display: "flex", gap: 10, flexWrap: "wrap", alignItems: "center" },
  detailMessages: {
    flex: 1, minHeight: 0, overflowY: "auto", overflowX: "hidden",
    padding: "16px 24px", display: "flex", flexDirection: "column", gap: 16,
  },
  msgBlock: {
    background: "var(--surface)", border: "1px solid var(--border-strong)",
    borderRadius: 10, overflow: "hidden", flexShrink: 0,
  },
  msgQ: {
    padding: "10px 14px", background: "rgba(53,128,184,0.08)",
    borderBottom: "1px solid var(--border)",
    fontSize: "0.82rem", fontWeight: 600, color: "var(--text)",
  },
  msgA: { padding: "10px 14px", fontSize: "0.8rem", color: "var(--text)" },
  msgFooter: {
    display: "flex", gap: 8, alignItems: "center", flexWrap: "wrap",
    padding: "6px 14px 10px", borderTop: "1px solid var(--border)",
  },
  docsRow: {
    padding: "8px 14px 10px", display: "flex", gap: 6, flexWrap: "wrap",
    borderTop: "1px solid var(--border)", alignItems: "center",
  },
  docTagBase: {
    display: "inline-flex", alignItems: "center", gap: 3,
    fontSize: "0.65rem", padding: "3px 9px", borderRadius: 20,
    background: "var(--accent-dim)", color: "var(--accent-bright)",
    border: "1px solid var(--border-accent)",
    fontFamily: "'JetBrains Mono', monospace",
    transition: "background 0.15s, border-color 0.15s",
  },
  emptyState: {
    flex: 1, display: "flex", flexDirection: "column",
    alignItems: "center", justifyContent: "center",
    color: "var(--text-muted)", gap: 10, padding: 40, minHeight: 0,
  },
  pager: {
    display: "flex", justifyContent: "space-between", alignItems: "center",
    padding: "8px 14px", borderTop: "1px solid var(--border)",
    flexShrink: 0, background: "var(--surface)",
  },
  pageBtn: {
    background: "none", border: "none", cursor: "pointer",
    fontSize: "0.75rem", color: "var(--text-muted)", padding: "4px 8px",
    borderRadius: 4, fontFamily: "inherit",
  },
};

const TIPO_COLORS = {
  content:   { background: "rgba(52,211,153,0.12)", color: "#34d399", border: "1px solid rgba(52,211,153,0.3)" },
  courtesy:  { background: "rgba(79,142,247,0.12)",  color: "#60a5fa", border: "1px solid rgba(79,142,247,0.3)" },
  not_found: { background: "rgba(251,191,36,0.12)",  color: "#fbbf24", border: "1px solid rgba(251,191,36,0.3)" },
  blocked:   { background: "rgba(239,68,68,0.12)",   color: "#f87171", border: "1px solid rgba(239,68,68,0.3)" },
};

const CSAT_LABELS = { 1: "😞", 2: "😕", 3: "😐", 4: "😊", 5: "😍" };

function fmtDate(iso) {
  if (!iso) return "—";
  try {
    const d = new Date(iso);
    const p = n => String(n).padStart(2, "0");
    return `${d.getFullYear()}-${p(d.getMonth()+1)}-${p(d.getDate())} ${p(d.getHours())}:${p(d.getMinutes())}`;
  } catch { return iso; }
}

function fmtDurata(sec) {
  if (!sec) return null;
  if (sec < 60) return `${sec}s`;
  return `${Math.floor(sec / 60)}m ${sec % 60}s`;
}

// ─── DocBadge — badge/link per un documento ───────────────────────────────────
function DocBadge({ doc }) {
  const href  = buildDocHref(doc);
  const page  = doc.pagina ?? doc.page ?? null;
  const label = `📄 ${doc.titolo}${page ? ` · p.${page}` : ""}`;

  if (href) {
    return (
      <a
        href={href}
        target="_blank"
        rel="noreferrer"
        style={{ ...s.docTagBase, textDecoration: "none", cursor: "pointer" }}
        onMouseEnter={e => {
          e.currentTarget.style.background = "rgba(53,128,184,0.28)";
          e.currentTarget.style.borderColor = "var(--accent-light)";
        }}
        onMouseLeave={e => {
          e.currentTarget.style.background = "var(--accent-dim)";
          e.currentTarget.style.borderColor = "var(--border-accent)";
        }}
      >
        {label}
      </a>
    );
  }

  // Nessun link disponibile — mostra come testo
  return (
    <span style={{ ...s.docTagBase, opacity: 0.65, cursor: "default" }}>
      {label}
    </span>
  );
}

// ─── Singolo blocco messaggio ─────────────────────────────────────────────────
function MsgBlock({ msg, idx }) {
  const [open, setOpen] = useState(idx === 0);
  const tipoColor = TIPO_COLORS[msg.tipo_risposta] || TIPO_COLORS.content;
  const docs = msg.documenti || [];

  return (
    <div style={s.msgBlock}>
      <div style={s.msgQ}>
        <span style={{ opacity: 0.5, marginRight: 6, fontSize: "0.72rem" }}>Q{idx + 1}</span>
        {msg.domanda}
      </div>

      <div style={{ ...s.msgA, cursor: "pointer" }} onClick={() => setOpen(o => !o)}>
        <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 4 }}>
          <span style={{ fontSize: "0.7rem", color: "var(--text-muted)" }}>
            Risposta {open ? "▲" : "▼"}
          </span>
          <span style={s.sessBadge(tipoColor)}>{msg.tipo_risposta}</span>
        </div>
        {open ? (
          <div style={{ fontSize: "0.78rem", lineHeight: 1.6 }}>
            <ReactMarkdown remarkPlugins={[remarkGfm]}>{msg.risposta || "—"}</ReactMarkdown>
          </div>
        ) : (
          <div style={{ fontSize: "0.75rem", color: "var(--text-muted)",
            overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
            {(msg.risposta || "").slice(0, 120)}{(msg.risposta || "").length > 120 ? "…" : ""}
          </div>
        )}
      </div>

      {/* FIX: DocBadge cliccabile con link al PDF */}
      {docs.length > 0 && (
        <div style={s.docsRow}>
          <span style={{ fontSize: "0.65rem", color: "var(--text-muted)", flexShrink: 0, marginRight: 2 }}>
            Fonti:
          </span>
          {docs.map((d, i) => <DocBadge key={i} doc={d} />)}
        </div>
      )}

      <div style={s.msgFooter}>
        <span style={s.sessDate}>{fmtDate(msg.timestamp)}</span>
        {msg.latency_ms && (
          <span style={s.sessBadge({ background: "var(--surface2)", color: "var(--text-muted)", border: "1px solid var(--border)" })}>
            {msg.latency_ms}ms
          </span>
        )}
        {msg.n_chunk > 0 && (
          <span style={s.sessBadge({ background: "rgba(53,128,184,0.08)", color: "var(--accent)", border: "1px solid rgba(53,128,184,0.2)" })}>
            {msg.n_chunk} chunk
          </span>
        )}
        {msg.bloccato && <span style={s.sessBadge(TIPO_COLORS.blocked)}>BLOCCATO</span>}
        {msg.feedback_csat && (
          <span style={{ fontSize: "0.9rem" }} title={`CSAT: ${msg.feedback_csat}/5`}>
            {CSAT_LABELS[msg.feedback_csat]}
          </span>
        )}
      </div>
    </div>
  );
}

// ─── Dettaglio sessione (colonna dx) ─────────────────────────────────────────
function SessionDetail({ session_uuid, onDelete, isSuperAdmin }) {
  const { authFetch } = useAuth();
  const [detail, setDetail]   = useState(null);
  const [loading, setLoading] = useState(false);
  const [confirm, setConfirm] = useState(false);

  useEffect(() => {
    if (!session_uuid) { setDetail(null); return; }
    setLoading(true);
    setDetail(null);
    authFetch(`/api/v1/admin/chat-audit/${session_uuid}`)
      .then(r => r.json())
      .then(setDetail)
      .catch(console.error)
      .finally(() => setLoading(false));
  }, [session_uuid, authFetch]);

  const handleDelete = async () => {
    try {
      await authFetch(`/api/v1/admin/chat-audit/${session_uuid}`, { method: "DELETE" });
      onDelete?.(session_uuid);
    } catch (e) { console.error(e); }
    setConfirm(false);
  };

  const Wrapper = ({ children }) => (
    <div style={{ display: "flex", flexDirection: "column", height: "100%", overflow: "hidden" }}>
      {children}
    </div>
  );

  if (!session_uuid) {
    return (
      <Wrapper>
        <div style={s.emptyState}>
          <div style={{ fontSize: "2rem", opacity: 0.2 }}>💬</div>
          <p style={{ fontSize: "0.8rem", textAlign: "center" }}>
            Seleziona una sessione per vedere i messaggi
          </p>
        </div>
      </Wrapper>
    );
  }

  if (loading) {
    return (
      <Wrapper>
        <div style={s.emptyState}>
          <div style={{ fontSize: "0.78rem", color: "var(--text-muted)" }}>Caricamento…</div>
        </div>
      </Wrapper>
    );
  }

  if (!detail) return <Wrapper />;

  const nomeUtente = detail.utente_nome && detail.utente_cognome
    ? `${detail.utente_nome} ${detail.utente_cognome}`
    : detail.utente_email || "—";

  return (
    <Wrapper>
      <div style={s.detailHeader}>
        <div style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-start" }}>
          <div style={{ ...s.detailTitle, flex: 1, marginRight: 12 }}>{detail.titolo || "Conversazione"}</div>
          {isSuperAdmin && (
            confirm ? (
              <div style={{ display: "flex", gap: 6 }}>
                <button onClick={handleDelete} style={{
                  padding: "4px 10px", background: "rgba(239,68,68,0.15)",
                  border: "1px solid rgba(239,68,68,0.35)", borderRadius: 6,
                  color: "#f87171", cursor: "pointer", fontFamily: "inherit", fontSize: "0.72rem",
                }}>Conferma eliminazione</button>
                <button onClick={() => setConfirm(false)} style={{
                  padding: "4px 10px", background: "none",
                  border: "1px solid var(--border-strong)", borderRadius: 6,
                  color: "var(--text-muted)", cursor: "pointer", fontFamily: "inherit", fontSize: "0.72rem",
                }}>✕</button>
              </div>
            ) : (
              <button onClick={() => setConfirm(true)} style={{
                padding: "4px 10px", background: "none",
                border: "1px solid var(--border)", borderRadius: 6,
                color: "var(--text-muted)", cursor: "pointer", fontFamily: "inherit", fontSize: "0.72rem",
              }}>🗑 Elimina</button>
            )
          )}
        </div>
        <div style={s.detailMeta}>
          <span style={{ fontSize: "0.72rem", color: "var(--text-muted)" }}>👤 {nomeUtente}</span>
          <span style={s.sessDate}>{fmtDate(detail.creata_il)}</span>
          <span style={s.sessBadge({ background: "var(--surface2)", color: "var(--text-muted)", border: "1px solid var(--border)" })}>
            {(detail.messaggi || []).length} messaggi
          </span>
          {detail.durata_secondi && (
            <span style={s.sessBadge({ background: "var(--surface2)", color: "var(--text-muted)", border: "1px solid var(--border)" })}>
              {fmtDurata(detail.durata_secondi)}
            </span>
          )}
          <span style={{ fontSize: "0.62rem", color: "var(--text-muted)", fontFamily: "'JetBrains Mono', monospace" }}>
            {detail.session_uuid}
          </span>
        </div>
      </div>

      <div style={s.detailMessages}>
        {(detail.messaggi || []).length === 0 ? (
          <div style={{ textAlign: "center", color: "var(--text-muted)", fontSize: "0.78rem", padding: 32 }}>
            Nessun messaggio registrato.
          </div>
        ) : (
          (detail.messaggi || []).map((msg, i) => (
            <MsgBlock key={msg.log_id} msg={msg} idx={i} />
          ))
        )}
      </div>
    </Wrapper>
  );
}

// ─── Riga sessione nella lista ────────────────────────────────────────────────
function SessRow({ sess, selected, onClick }) {
  const sel = selected?.session_uuid === sess.session_uuid;
  const nomeUtente = sess.utente_nome && sess.utente_cognome
    ? `${sess.utente_nome} ${sess.utente_cognome}`
    : sess.utente_email || "—";

  return (
    <div style={s.sessione(sel)} onClick={onClick}>
      <div style={s.sessTitle(sel)} title={sess.titolo}>
        {sess.n_bloccati > 0 && <span style={{ color: "#f87171", marginRight: 4 }}>⚠</span>}
        {sess.titolo || "Conversazione"}
      </div>
      <div style={{ fontSize: "0.65rem", color: "var(--text-muted)", marginTop: 2,
        overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
        {nomeUtente}
      </div>
      <div style={s.sessMeta}>
        <span style={s.sessDate}>{fmtDate(sess.aggiornata_il)}</span>
        <span style={s.sessBadge({ background: "var(--surface2)", color: "var(--text-muted)", border: "1px solid var(--border)" })}>
          {sess.n_messaggi || sess.n_log_risposta || 0} msg
        </span>
        {sess.n_documenti_unici > 0 && (
          <span style={s.sessBadge({ background: "rgba(53,128,184,0.1)", color: "var(--accent)", border: "1px solid rgba(53,128,184,0.25)" })}>
            {sess.n_documenti_unici} doc
          </span>
        )}
        {sess.n_bloccati > 0 && (
          <span style={s.sessBadge(TIPO_COLORS.blocked)}>bloccato</span>
        )}
        {sess.avg_latency_ms && (
          <span style={s.sessBadge({ background: "var(--surface2)", color: "var(--text-muted)", border: "1px solid var(--border)" })}>
            {sess.avg_latency_ms}ms
          </span>
        )}
      </div>
    </div>
  );
}

// ─── Panel principale ─────────────────────────────────────────────────────────
export default function ChatAuditPanel() {
  const { authFetch, user } = useAuth();
  const isSuperAdmin = user?.is_superadmin ?? false;

  const [sessioni,      setSessioni]      = useState([]);
  const [total,         setTotal]         = useState(0);
  const [page,          setPage]          = useState(0);
  const [loading,       setLoading]       = useState(false);
  const [selected,      setSelected]      = useState(null);
  const [fUtente,       setFUtente]       = useState("");
  const [fDataDa,       setFDataDa]       = useState("");
  const [fDataA,        setFDataA]        = useState("");
  const [fSoloBloccate, setFSoloBloccate] = useState(false);

  const PAGE_SIZE = 30;

  const fetchSessioni = useCallback(async (p = 0) => {
    setLoading(true);
    try {
      const params = new URLSearchParams({ page: p, page_size: PAGE_SIZE });
      if (fUtente)       params.set("utente",       fUtente);
      if (fDataDa)       params.set("data_da",       fDataDa);
      if (fDataA)        params.set("data_a",        fDataA);
      if (fSoloBloccate) params.set("solo_bloccate", "true");
      const res  = await authFetch(`/api/v1/admin/chat-audit?${params}`);
      const data = await res.json();
      setSessioni(data.sessioni || []);
      setTotal(data.total || 0);
      setPage(p);
    } catch (e) { console.error(e); }
    finally { setLoading(false); }
  }, [authFetch, fUtente, fDataDa, fDataA, fSoloBloccate]);

  useEffect(() => { fetchSessioni(0); }, [fetchSessioni]);

  const totalPages = Math.max(1, Math.ceil(total / PAGE_SIZE));
  const handleDelete = (uuid) => { setSessioni(prev => prev.filter(s => s.session_uuid !== uuid)); setSelected(null); };

  const btnGhost = {
    background: "none", border: "1px solid var(--border-strong)",
    borderRadius: 6, padding: "5px 10px", cursor: "pointer",
    fontFamily: "inherit", fontSize: "0.75rem", color: "var(--text-muted)",
  };

  return (
    <div style={s.root}>
      <div style={s.list}>
        <div style={s.listHeader}>
          <div style={s.listTitle}>
            💬 Audit Chat
            <span style={{ ...s.sessBadge({ background: "var(--surface2)", color: "var(--text-muted)", border: "1px solid var(--border)" }), marginLeft: 8 }}>
              {total}
            </span>
          </div>
          <div style={s.filterRow}>
            {isSuperAdmin && (
              <input style={s.input} placeholder="🔍 Utente (email o nome)…"
                value={fUtente} onChange={e => setFUtente(e.target.value)}
                onKeyDown={e => e.key === "Enter" && fetchSessioni(0)} />
            )}
            <div style={s.filterGrid}>
              <div>
                <div style={{ fontSize: "0.62rem", color: "var(--text-muted)", marginBottom: 3 }}>Da</div>
                <input type="date" style={s.input} value={fDataDa} onChange={e => setFDataDa(e.target.value)} />
              </div>
              <div>
                <div style={{ fontSize: "0.62rem", color: "var(--text-muted)", marginBottom: 3 }}>A</div>
                <input type="date" style={s.input} value={fDataA} onChange={e => setFDataA(e.target.value)} />
              </div>
            </div>
            <div style={s.checkRow}>
              <input type="checkbox" id="cb-bloccate" checked={fSoloBloccate}
                onChange={e => setFSoloBloccate(e.target.checked)} />
              <label htmlFor="cb-bloccate">Solo sessioni con messaggi bloccati</label>
            </div>
            <div style={{ display: "flex", gap: 6 }}>
              <button style={{ ...btnGhost, flex: 1, background: "var(--accent)", color: "white", border: "none", fontWeight: 600 }}
                onClick={() => fetchSessioni(0)}>Filtra</button>
              <button style={btnGhost} onClick={() => { setFUtente(""); setFDataDa(""); setFDataA(""); setFSoloBloccate(false); }}>✕</button>
              <button style={btnGhost} onClick={() => fetchSessioni(page)} title="Aggiorna">↻</button>
            </div>
          </div>
        </div>

        <div style={s.sessioni}>
          {loading && <div style={{ padding: 20, textAlign: "center", color: "var(--text-muted)", fontSize: "0.78rem" }}>Caricamento…</div>}
          {!loading && sessioni.length === 0 && <div style={{ padding: 20, textAlign: "center", color: "var(--text-muted)", fontSize: "0.78rem" }}>Nessuna sessione trovata.</div>}
          {!loading && sessioni.map(sess => (
            <SessRow key={sess.session_uuid} sess={sess} selected={selected} onClick={() => setSelected(sess)} />
          ))}
        </div>

        {totalPages > 1 && (
          <div style={s.pager}>
            <button style={s.pageBtn} disabled={page <= 0} onClick={() => fetchSessioni(page - 1)}>← Prec.</button>
            <span style={{ fontSize: "0.7rem", color: "var(--text-muted)", fontFamily: "'JetBrains Mono', monospace" }}>{page + 1} / {totalPages}</span>
            <button style={s.pageBtn} disabled={page >= totalPages - 1} onClick={() => fetchSessioni(page + 1)}>Succ. →</button>
          </div>
        )}
      </div>

      <div style={s.detail}>
        <SessionDetail session_uuid={selected?.session_uuid} onDelete={handleDelete} isSuperAdmin={isSuperAdmin} />
      </div>
    </div>
  );
}