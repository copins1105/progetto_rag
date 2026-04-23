// src/pages/OwnershipPanel.jsx
//
// Pannello visibile SOLO al SuperAdmin che mostra:
//   - Tutti i documenti con l'Admin che li ha caricati
//   - Tutti gli utenti con l'Admin che li ha creati
//
// Accessibile dalla tab "Ownership" nel pannello Admin.

import { useState, useEffect, useCallback } from "react";
import { useAuth } from "../context/AuthContext";

// ─── Stili condivisi ───────────────────────────────────────────
const s = {
  section: {
    background: "var(--surface)",
    border: "1px solid var(--border-strong)",
    borderRadius: 12,
    overflow: "hidden",
    marginBottom: 20,
  },
  sectionHeader: {
    display: "flex",
    alignItems: "center",
    justifyContent: "space-between",
    padding: "12px 18px",
    background: "var(--surface2)",
    borderBottom: "1px solid var(--border)",
  },
  sectionTitle: {
    fontSize: "0.85rem",
    fontWeight: 700,
    color: "var(--text)",
    display: "flex",
    alignItems: "center",
    gap: 8,
  },
  count: {
    fontSize: "0.65rem",
    color: "var(--text-muted)",
    fontFamily: "'JetBrains Mono', monospace",
    padding: "2px 8px",
    borderRadius: 20,
    background: "var(--surface)",
    border: "1px solid var(--border)",
  },
  refreshBtn: {
    background: "none",
    border: "1px solid var(--border-strong)",
    borderRadius: 6,
    padding: "5px 10px",
    cursor: "pointer",
    fontSize: "0.75rem",
    color: "var(--text-muted)",
    fontFamily: "inherit",
    transition: "all 0.15s",
  },
  table: {
    width: "100%",
    borderCollapse: "collapse",
  },
  th: {
    padding: "8px 14px",
    textAlign: "left",
    fontSize: "0.65rem",
    fontWeight: 700,
    color: "var(--text-muted)",
    textTransform: "uppercase",
    letterSpacing: "0.07em",
    borderBottom: "1px solid var(--border)",
    background: "var(--surface2)",
    whiteSpace: "nowrap",
  },
  td: (even) => ({
    padding: "10px 14px",
    fontSize: "0.78rem",
    color: "var(--text)",
    borderBottom: "1px solid var(--border)",
    background: even ? "var(--surface)" : "rgba(255,255,255,0.012)",
    verticalAlign: "middle",
  }),
  avatar: {
    display: "inline-flex",
    alignItems: "center",
    justifyContent: "center",
    width: 26,
    height: 26,
    borderRadius: "50%",
    background: "var(--accent-dim)",
    border: "1px solid var(--accent-glow)",
    fontSize: "0.65rem",
    fontWeight: 700,
    color: "var(--accent-bright)",
    flexShrink: 0,
    marginRight: 8,
    fontFamily: "'JetBrains Mono', monospace",
  },
  pill: (color) => ({
    display: "inline-flex",
    alignItems: "center",
    gap: 4,
    padding: "2px 8px",
    borderRadius: 20,
    fontSize: "0.65rem",
    fontWeight: 700,
    fontFamily: "'JetBrains Mono', monospace",
    ...color,
  }),
  emptyRow: {
    padding: "32px 16px",
    textAlign: "center",
    color: "var(--text-muted)",
    fontSize: "0.78rem",
  },
  loading: {
    padding: "24px 16px",
    textAlign: "center",
    color: "var(--text-muted)",
    fontSize: "0.78rem",
  },
  filterRow: {
    display: "flex",
    alignItems: "center",
    gap: 8,
    padding: "10px 14px",
    borderBottom: "1px solid var(--border)",
    background: "var(--surface)",
    flexWrap: "wrap",
  },
  filterInput: {
    padding: "6px 10px",
    background: "var(--surface2)",
    border: "1px solid var(--border-strong)",
    borderRadius: 6,
    color: "var(--text)",
    fontFamily: "inherit",
    fontSize: "0.78rem",
    outline: "none",
    width: 200,
  },
};

// ─── Colori per sync_status ────────────────────────────────────
const SYNC_COLORS = {
  synced:        { background: "rgba(52,211,153,0.12)", color: "#34d399", border: "1px solid rgba(52,211,153,0.3)" },
  pending:       { background: "rgba(251,191,36,0.12)", color: "#fbbf24", border: "1px solid rgba(251,191,36,0.3)" },
  error:         { background: "rgba(239,68,68,0.12)",  color: "#f87171", border: "1px solid rgba(239,68,68,0.3)" },
  solo_postgres: { background: "rgba(251,191,36,0.12)", color: "#fbbf24", border: "1px solid rgba(251,191,36,0.3)" },
  solo_chroma:   { background: "rgba(251,191,36,0.12)", color: "#fbbf24", border: "1px solid rgba(251,191,36,0.3)" },
};

// ─── Colori per ruoli ─────────────────────────────────────────
const ROLE_COLORS = {
  SuperAdmin: { background: "rgba(245,158,11,0.15)", color: "#fbbf24", border: "1px solid rgba(245,158,11,0.35)" },
  Admin:      { background: "rgba(79,142,247,0.15)", color: "#60a5fa", border: "1px solid rgba(79,142,247,0.35)" },
  User:       { background: "rgba(107,114,128,0.15)", color: "#9ca3af", border: "1px solid rgba(107,114,128,0.3)" },
};

function fmtDate(s) {
  if (!s) return "—";
  return s.split("T")[0];
}

function fmtOwner(owner) {
  if (!owner) return <span style={{ color: "var(--text-muted)", fontStyle: "italic", fontSize: "0.72rem" }}>Sistema</span>;
  const nome = owner.nome && owner.cognome ? `${owner.nome} ${owner.cognome}` : owner.email;
  const initials = nome.slice(0, 2).toUpperCase();
  return (
    <div style={{ display: "flex", alignItems: "center" }}>
      <span style={s.avatar}>{initials}</span>
      <div>
        <div style={{ fontSize: "0.76rem", fontWeight: 600, color: "var(--text)" }}>{nome}</div>
        <div style={{ fontSize: "0.65rem", color: "var(--text-muted)" }}>{owner.email}</div>
      </div>
    </div>
  );
}

// ─── Sezione: Documenti ────────────────────────────────────────
function DocumentiOwnership({ authFetch }) {
  const [docs,    setDocs]    = useState([]);
  const [loading, setLoading] = useState(false);
  const [filter,  setFilter]  = useState("");

  const fetch_ = useCallback(async () => {
    setLoading(true);
    try {
      const res  = await authFetch("/api/v1/admin/documents/ownership");
      const data = await res.json();
      setDocs(data.documenti || []);
    } catch (e) { console.error(e); }
    finally { setLoading(false); }
  }, [authFetch]);

  useEffect(() => { fetch_(); }, [fetch_]);

  const filtered = filter
    ? docs.filter(d =>
        d.titolo.toLowerCase().includes(filter.toLowerCase()) ||
        (d.caricato_da?.email || "").toLowerCase().includes(filter.toLowerCase()) ||
        (d.caricato_da?.nome  || "").toLowerCase().includes(filter.toLowerCase())
      )
    : docs;

  return (
    <div style={s.section}>
      <div style={s.sectionHeader}>
        <span style={s.sectionTitle}>
          📄 Documenti
          <span style={s.count}>{docs.length} totali</span>
        </span>
        <button style={s.refreshBtn} onClick={fetch_}>↻ Aggiorna</button>
      </div>

      <div style={s.filterRow}>
        <input
          style={s.filterInput}
          placeholder="🔍 Filtra per titolo o admin…"
          value={filter}
          onChange={e => setFilter(e.target.value)}
        />
        {filter && (
          <button style={{ ...s.refreshBtn, color: "var(--red)" }} onClick={() => setFilter("")}>
            ✕ Reset
          </button>
        )}
        <span style={{ fontSize: "0.72rem", color: "var(--text-muted)", marginLeft: "auto" }}>
          {filtered.length} / {docs.length} mostrati
        </span>
      </div>

      <div style={{ overflowX: "auto" }}>
        <table style={s.table}>
          <thead>
            <tr>
              <th style={s.th}>Titolo</th>
              <th style={s.th}>Versione</th>
              <th style={s.th}>Caricato da</th>
              <th style={s.th}>Data caricamento</th>
              <th style={s.th}>Validità</th>
              <th style={s.th}>Stato sync</th>
            </tr>
          </thead>
          <tbody>
            {loading ? (
              <tr><td colSpan={6} style={s.loading}>Caricamento…</td></tr>
            ) : filtered.length === 0 ? (
              <tr><td colSpan={6} style={s.emptyRow}>
                {filter ? `Nessun risultato per "${filter}"` : "Nessun documento trovato."}
              </td></tr>
            ) : filtered.map((doc, i) => (
              <tr key={doc.documento_id}>
                <td style={s.td(i % 2 === 0)}>
                  <div style={{ fontWeight: 600, maxWidth: 280, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }} title={doc.titolo}>
                    {doc.titolo}
                  </div>
                  <div style={{ fontSize: "0.65rem", color: "var(--text-muted)", fontFamily: "'JetBrains Mono', monospace" }}>
                    id:{doc.documento_id}
                  </div>
                </td>
                <td style={{ ...s.td(i % 2 === 0), fontFamily: "'JetBrains Mono', monospace", fontSize: "0.75rem" }}>
                  {doc.versione}
                </td>
                <td style={s.td(i % 2 === 0)}>
                  {fmtOwner(doc.caricato_da)}
                </td>
                <td style={{ ...s.td(i % 2 === 0), fontFamily: "'JetBrains Mono', monospace", fontSize: "0.72rem", color: "var(--text-muted)" }}>
                  {fmtDate(doc.data_caricamento)}
                </td>
                <td style={{ ...s.td(i % 2 === 0), fontFamily: "'JetBrains Mono', monospace", fontSize: "0.72rem", color: "var(--text-muted)" }}>
                  {fmtDate(doc.data_validita)}
                  {doc.data_scadenza && (
                    <span style={{ color: "var(--text-dim)" }}> → {fmtDate(doc.data_scadenza)}</span>
                  )}
                </td>
                <td style={s.td(i % 2 === 0)}>
                  <span style={s.pill(SYNC_COLORS[doc.sync_status] || SYNC_COLORS.pending)}>
                    {doc.sync_status || "—"}
                  </span>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}

// ─── Sezione: Utenti ───────────────────────────────────────────
function UtentiOwnership({ authFetch }) {
  const [users,   setUsers]   = useState([]);
  const [loading, setLoading] = useState(false);
  const [filter,  setFilter]  = useState("");

  const fetch_ = useCallback(async () => {
    setLoading(true);
    try {
      const res  = await authFetch("/api/v1/auth/users");
      const data = await res.json();
      setUsers(data.users || []);
    } catch (e) { console.error(e); }
    finally { setLoading(false); }
  }, [authFetch]);

  useEffect(() => { fetch_(); }, [fetch_]);

  const filtered = filter
    ? users.filter(u =>
        (u.email || "").toLowerCase().includes(filter.toLowerCase()) ||
        (u.nome   || "").toLowerCase().includes(filter.toLowerCase()) ||
        (u.cognome|| "").toLowerCase().includes(filter.toLowerCase())
      )
    : users;

  // Raggruppa per creatore
  const byCreator = {};
  filtered.forEach(u => {
    const key = u.creato_da ?? "sistema";
    if (!byCreator[key]) byCreator[key] = [];
    byCreator[key].push(u);
  });

  return (
    <div style={s.section}>
      <div style={s.sectionHeader}>
        <span style={s.sectionTitle}>
          👥 Utenti
          <span style={s.count}>{users.length} totali</span>
        </span>
        <button style={s.refreshBtn} onClick={fetch_}>↻ Aggiorna</button>
      </div>

      <div style={s.filterRow}>
        <input
          style={s.filterInput}
          placeholder="🔍 Filtra per nome o email…"
          value={filter}
          onChange={e => setFilter(e.target.value)}
        />
        {filter && (
          <button style={{ ...s.refreshBtn, color: "var(--red)" }} onClick={() => setFilter("")}>
            ✕ Reset
          </button>
        )}
        <span style={{ fontSize: "0.72rem", color: "var(--text-muted)", marginLeft: "auto" }}>
          {filtered.length} / {users.length} mostrati
        </span>
      </div>

      <div style={{ overflowX: "auto" }}>
        <table style={s.table}>
          <thead>
            <tr>
              <th style={s.th}>Utente</th>
              <th style={s.th}>Ruolo</th>
              <th style={s.th}>Creato da</th>
              <th style={s.th}>Data creazione</th>
            </tr>
          </thead>
          <tbody>
            {loading ? (
              <tr><td colSpan={4} style={s.loading}>Caricamento…</td></tr>
            ) : filtered.length === 0 ? (
              <tr><td colSpan={4} style={s.emptyRow}>
                {filter ? `Nessun risultato per "${filter}"` : "Nessun utente trovato."}
              </td></tr>
            ) : filtered.map((u, i) => {
              const ruolo   = u.ruoli?.[0] || "User";
              const nome    = u.nome && u.cognome ? `${u.nome} ${u.cognome}` : u.email;
              const initials = nome.slice(0, 2).toUpperCase();

              // Trova il creatore nella lista
              const creator = u.creato_da
                ? users.find(x => x.utente_id === u.creato_da) || null
                : null;

              return (
                <tr key={u.utente_id}>
                  <td style={s.td(i % 2 === 0)}>
                    <div style={{ display: "flex", alignItems: "center" }}>
                      <span style={s.avatar}>{initials}</span>
                      <div>
                        <div style={{ fontSize: "0.76rem", fontWeight: 600, color: "var(--text)" }}>{nome}</div>
                        <div style={{ fontSize: "0.65rem", color: "var(--text-muted)" }}>{u.email}</div>
                      </div>
                    </div>
                  </td>
                  <td style={s.td(i % 2 === 0)}>
                    <span style={s.pill(ROLE_COLORS[ruolo] || ROLE_COLORS.User)}>
                      {ruolo}
                    </span>
                  </td>
                  <td style={s.td(i % 2 === 0)}>
                    {u.creato_da ? (
                      creator ? (
                        <div style={{ display: "flex", alignItems: "center" }}>
                          <span style={{ ...s.avatar, background: "rgba(139,92,246,0.12)", color: "#a78bfa", border: "1px solid rgba(139,92,246,0.3)" }}>
                            {(creator.nome || creator.email).slice(0, 2).toUpperCase()}
                          </span>
                          <div>
                            <div style={{ fontSize: "0.76rem", fontWeight: 600, color: "var(--text)" }}>
                              {creator.nome && creator.cognome
                                ? `${creator.nome} ${creator.cognome}`
                                : creator.email
                              }
                            </div>
                            <div style={{ fontSize: "0.65rem", color: "var(--text-muted)" }}>{creator.email}</div>
                          </div>
                        </div>
                      ) : (
                        <span style={{ fontSize: "0.72rem", fontFamily: "'JetBrains Mono', monospace", color: "var(--text-muted)" }}>
                          id:{u.creato_da}
                        </span>
                      )
                    ) : (
                      <span style={{ color: "var(--text-muted)", fontStyle: "italic", fontSize: "0.72rem" }}>Sistema / SuperAdmin</span>
                    )}
                  </td>
                  <td style={{ ...s.td(i % 2 === 0), fontFamily: "'JetBrains Mono', monospace", fontSize: "0.72rem", color: "var(--text-muted)" }}>
                    {fmtDate(u.data_creazione)}
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
    </div>
  );
}

// ─── Statistiche rapide ────────────────────────────────────────
function StatsBar({ authFetch }) {
  const [stats, setStats] = useState(null);

  useEffect(() => {
    const fetchStats = async () => {
      try {
        const [docsRes, usersRes] = await Promise.all([
          authFetch("/api/v1/admin/documents/ownership"),
          authFetch("/api/v1/auth/users"),
        ]);
        const [docsData, usersData] = await Promise.all([docsRes.json(), usersRes.json()]);

        const docs  = docsData.documenti  || [];
        const users = usersData.users || [];

        // Conta admin unici che hanno caricato documenti
        const adminConDocs = new Set(
          docs.filter(d => d.caricato_da).map(d => d.caricato_da.utente_id)
        );

        // Conta admin unici che hanno creato utenti
        const adminConUtenti = new Set(
          users.filter(u => u.creato_da).map(u => u.creato_da)
        );

        setStats({
          tot_docs:         docs.length,
          docs_senza_owner: docs.filter(d => !d.caricato_da).length,
          tot_users:        users.length,
          admin_con_docs:   adminConDocs.size,
          admin_con_utenti: adminConUtenti.size,
          users_senza_creatore: users.filter(u => !u.creato_da).length,
        });
      } catch {}
    };
    fetchStats();
  }, [authFetch]); // eslint-disable-line

  if (!stats) return null;

  const statItems = [
    { icon: "📄", label: "Documenti", value: stats.tot_docs, sub: `${stats.docs_senza_owner} senza owner` },
    { icon: "👥", label: "Utenti",    value: stats.tot_users, sub: `${stats.users_senza_creatore} creati dal sistema` },
    { icon: "🛡️", label: "Admin con documenti", value: stats.admin_con_docs, sub: "caricatori attivi" },
    { icon: "✏️", label: "Admin con utenti",     value: stats.admin_con_utenti, sub: "hanno creato utenti" },
  ];

  return (
    <div style={{ display: "grid", gridTemplateColumns: "repeat(4, 1fr)", gap: 12, marginBottom: 20 }}>
      {statItems.map((st, i) => (
        <div key={i} style={{
          background: "var(--surface)",
          border: "1px solid var(--border-strong)",
          borderRadius: 10,
          padding: "14px 16px",
        }}>
          <div style={{ fontSize: "1.1rem", marginBottom: 6 }}>{st.icon}</div>
          <div style={{ fontSize: "1.4rem", fontWeight: 700, color: "var(--text)", fontFamily: "'JetBrains Mono', monospace" }}>
            {st.value}
          </div>
          <div style={{ fontSize: "0.72rem", fontWeight: 600, color: "var(--text-secondary)", marginTop: 2 }}>{st.label}</div>
          <div style={{ fontSize: "0.65rem", color: "var(--text-muted)", marginTop: 1 }}>{st.sub}</div>
        </div>
      ))}
    </div>
  );
}

// ─── Panel principale ──────────────────────────────────────────
export default function OwnershipPanel() {
  const { authFetch } = useAuth();

  return (
    <div style={{ padding: "20px 24px", overflowY: "auto", height: "100%" }}>
      <div style={{ marginBottom: 20 }}>
        <h2 style={{ fontSize: "0.95rem", fontWeight: 700, color: "var(--text)", marginBottom: 4 }}>
          🔑 Ownership — Documenti &amp; Utenti
        </h2>
        <p style={{ fontSize: "0.78rem", color: "var(--text-muted)", lineHeight: 1.6 }}>
          Visibile solo al SuperAdmin. Mostra chi ha caricato ogni documento e chi ha creato ogni utente.
        </p>
      </div>

      <StatsBar authFetch={authFetch} />
      <DocumentiOwnership authFetch={authFetch} />
      <UtentiOwnership    authFetch={authFetch} />
    </div>
  );
}
