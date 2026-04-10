// src/pages/PermissionMatrixPanel.jsx
// Matrice interattiva Utente × Permesso — redesign con nomi orizzontali
//
// Miglioramenti rispetto alla versione precedente:
//   - Permessi scritti in ORIZZONTALE, raggruppati per categoria in card separate
//   - Layout a sezioni collassabili con header categoria ben visibili
//   - Celle più compatte ma leggibili
//   - Badge stato più chiari
//   - Riga utente fissa, scroll orizzontale per la griglia

import { useState, useEffect, useCallback } from "react";
import { useAuth } from "../context/AuthContext";

// ── Raggruppamento permessi per categoria ────────────────────
const CATEGORIE = {
  "Pagine":    ["page_chat", "page_admin", "page_profile"],
  "Tab Admin": ["tab_ingestion", "tab_loader", "tab_chunks",
                "tab_modifica", "tab_sync", "tab_log",
                "tab_users", "tab_permissions"],
  "Documenti": ["doc_upload", "doc_ingest", "doc_load",
                "doc_update", "doc_delete"],
  "Utenti":    ["user_view", "user_create", "user_update",
                "user_delete", "user_permissions"],
  "Log":       ["log_view"],
};

// Label brevi per le colonne (senza prefisso)
const SHORT_LABELS = {
  page_chat: "Chat", page_admin: "Admin", page_profile: "Profilo",
  tab_ingestion: "Ingestion", tab_loader: "Loader", tab_chunks: "Chunks",
  tab_modifica: "Modifica", tab_sync: "Sync", tab_log: "Log",
  tab_users: "Utenti", tab_permissions: "Permessi",
  doc_upload: "Upload", doc_ingest: "Ingest", doc_load: "Load",
  doc_update: "Update", doc_delete: "Delete",
  user_view: "Visualizza", user_create: "Crea", user_update: "Modifica",
  user_delete: "Elimina", user_permissions: "Permessi",
  log_view: "Visualizza",
};

// Icone categoria
const CAT_ICONS = {
  "Pagine": "🌐", "Tab Admin": "🗂️", "Documenti": "📄",
  "Utenti": "👥", "Log": "📋",
};

// Colori categoria
const CAT_COLORS = {
  "Pagine":    { bg: "rgba(79,142,247,0.08)",  accent: "#4f8ef7", border: "rgba(79,142,247,0.2)"  },
  "Tab Admin": { bg: "rgba(139,92,246,0.08)",  accent: "#8b5cf6", border: "rgba(139,92,246,0.2)"  },
  "Documenti": { bg: "rgba(20,184,166,0.08)",  accent: "#14b8a6", border: "rgba(20,184,166,0.2)"  },
  "Utenti":    { bg: "rgba(245,158,11,0.08)",  accent: "#f59e0b", border: "rgba(245,158,11,0.2)"  },
  "Log":       { bg: "rgba(239,68,68,0.08)",   accent: "#ef4444", border: "rgba(239,68,68,0.2)"   },
};

// ── Stato cella ──────────────────────────────────────────────
const CELL_CONFIG = {
  ruolo:          { bg: "rgba(52,211,153,0.15)", color: "#34d399", border: "rgba(52,211,153,0.4)", icon: "✓", label: "Da ruolo" },
  override_grant: { bg: "rgba(79,142,247,0.20)", color: "#60a5fa", border: "rgba(79,142,247,0.5)", icon: "★", label: "Override: sì" },
  override_deny:  { bg: "rgba(239,68,68,0.15)",  color: "#f87171", border: "rgba(239,68,68,0.4)",  icon: "✕", label: "Override: no" },
  negato:         { bg: "transparent",            color: "var(--border-strong)", border: "var(--border)", icon: "—", label: "Negato" },
  pending_true:   { bg: "rgba(79,142,247,0.25)", color: "#93c5fd", border: "rgba(79,142,247,0.7)", icon: "★", label: "Da salvare: sì" },
  pending_false:  { bg: "rgba(239,68,68,0.22)",  color: "#fca5a5", border: "rgba(239,68,68,0.6)",  icon: "✕", label: "Da salvare: no" },
  pending_reset:  { bg: "rgba(251,191,36,0.15)", color: "#fbbf24", border: "rgba(251,191,36,0.4)", icon: "↺", label: "Da salvare: ripristina" },
};

// ── Avatar utente ────────────────────────────────────────────
function UserAvatar({ nome, cognome, email }) {
  const initials = nome && cognome
    ? `${nome[0]}${cognome[0]}`.toUpperCase()
    : email[0].toUpperCase();
  return (
    <div style={{
      width: 34, height: 34, borderRadius: "50%", flexShrink: 0,
      background: "linear-gradient(135deg, var(--accent-dim), rgba(79,142,247,0.25))",
      border: "1px solid var(--accent-glow)",
      display: "flex", alignItems: "center", justifyContent: "center",
      fontSize: "0.72rem", fontWeight: 700, color: "var(--accent)",
    }}>
      {initials}
    </div>
  );
}

// ── Badge ruolo ──────────────────────────────────────────────
function RoleBadge({ ruolo }) {
  const colors = {
    SuperAdmin: { bg: "rgba(245,158,11,0.15)", color: "#fbbf24", border: "rgba(245,158,11,0.35)" },
    Admin:      { bg: "rgba(79,142,247,0.15)", color: "#60a5fa", border: "rgba(79,142,247,0.35)" },
    User:       { bg: "rgba(107,114,128,0.15)", color: "#9ca3af", border: "rgba(107,114,128,0.3)" },
  };
  const c = colors[ruolo] || colors.User;
  return (
    <span style={{
      fontSize: "0.6rem", fontWeight: 700, padding: "2px 7px", borderRadius: 12,
      background: c.bg, color: c.color, border: `1px solid ${c.border}`,
      fontFamily: "'DM Mono', monospace", whiteSpace: "nowrap",
    }}>
      {ruolo || "—"}
    </span>
  );
}

// ── Cella permesso ───────────────────────────────────────────
function PermCell({ fonte, localState, onClick, tooltip }) {
  const [hover, setHover] = useState(false);

  let cfg;
  if (localState === true)   cfg = CELL_CONFIG.pending_true;
  else if (localState === false) cfg = CELL_CONFIG.pending_false;
  else if (localState === null)  cfg = CELL_CONFIG.pending_reset;
  else cfg = CELL_CONFIG[fonte] || CELL_CONFIG.negato;

  const isPending = localState !== undefined;

  return (
    <div title={tooltip} style={{ position: "relative", display: "flex", justifyContent: "center" }}>
      <button
        onClick={onClick}
        onMouseEnter={() => setHover(true)}
        onMouseLeave={() => setHover(false)}
        style={{
          width: 32, height: 28, borderRadius: 6,
          border: `1.5px solid ${hover ? cfg.color : cfg.border}`,
          background: hover ? cfg.bg : (cfg.bg === "transparent" ? "transparent" : cfg.bg),
          color: cfg.color,
          cursor: "pointer",
          display: "flex", alignItems: "center", justifyContent: "center",
          fontSize: "0.75rem", fontWeight: 700,
          transition: "all 0.12s",
          outline: isPending ? `2px solid ${cfg.border}` : "none",
          outlineOffset: 2,
          transform: hover ? "scale(1.1)" : "scale(1)",
        }}
      >
        {cfg.icon}
      </button>
    </div>
  );
}

// ── Sezione categoria ────────────────────────────────────────
function CategorySection({ catName, codici, tuttiPermessi, utentiFiltrati,
                            localChanges, getCellState, handleCellClick,
                            aperta, onToggle }) {
  const catColor = CAT_COLORS[catName] || CAT_COLORS["Log"];
  const presenti = codici.filter(c => tuttiPermessi.some(p => p.codice === c));
  if (presenti.length === 0) return null;

  return (
    <div style={{
      background: "var(--surface)",
      border: `1px solid ${catColor.border}`,
      borderRadius: 12,
      overflow: "hidden",
      marginBottom: 12,
    }}>
      {/* Header categoria */}
      <button
        onClick={onToggle}
        style={{
          width: "100%", display: "flex", alignItems: "center", gap: 10,
          padding: "10px 16px", background: catColor.bg,
          border: "none", cursor: "pointer", textAlign: "left",
          borderBottom: aperta ? `1px solid ${catColor.border}` : "none",
        }}
      >
        <span style={{ fontSize: "1rem" }}>{CAT_ICONS[catName]}</span>
        <span style={{ fontSize: "0.82rem", fontWeight: 700, color: catColor.accent, flex: 1 }}>
          {catName}
        </span>
        <span style={{ fontSize: "0.68rem", color: "var(--text-muted)", fontFamily: "'DM Mono', monospace" }}>
          {presenti.length} permessi
        </span>
        <span style={{ fontSize: "0.75rem", color: catColor.accent, marginLeft: 6 }}>
          {aperta ? "▾" : "▸"}
        </span>
      </button>

      {aperta && (
        <div style={{ overflowX: "auto" }}>
          <table style={{
            borderCollapse: "collapse", width: "100%",
            minWidth: `${220 + presenti.length * 80}px`,
          }}>
            {/* Header permessi */}
            <thead>
              <tr style={{ background: "var(--surface2)" }}>
                <th style={{
                  padding: "8px 16px", textAlign: "left", whiteSpace: "nowrap",
                  borderBottom: "1px solid var(--border)",
                  width: 220, minWidth: 220,
                  fontSize: "0.65rem", fontWeight: 600, color: "var(--text-muted)",
                  textTransform: "uppercase", letterSpacing: "0.07em",
                }}>
                  Utente
                </th>
                {presenti.map((codice) => (
                  <th key={codice} style={{
                    padding: "8px 10px", textAlign: "center",
                    borderBottom: "1px solid var(--border)",
                    borderLeft: "1px solid var(--border)",
                    minWidth: 80,
                  }}>
                    <div style={{
                      fontSize: "0.7rem", fontWeight: 600,
                      color: "var(--text-dim)", whiteSpace: "nowrap",
                    }}>
                      {SHORT_LABELS[codice] || codice}
                    </div>
                    <div style={{
                      fontSize: "0.58rem", color: "var(--text-muted)",
                      fontFamily: "'DM Mono', monospace", marginTop: 1,
                    }}>
                      {codice.split("_")[0]}
                    </div>
                  </th>
                ))}
              </tr>
            </thead>

            {/* Body utenti */}
            <tbody>
              {utentiFiltrati.map((utente, ri) => {
                const pending = Object.keys(localChanges[utente.utente_id] || {})
                  .filter(c => presenti.includes(c)).length;

                return (
                  <tr key={utente.utente_id} style={{
                    background: ri % 2 === 0 ? "var(--surface)" : "rgba(255,255,255,0.015)",
                    transition: "background 0.1s",
                  }}>
                    {/* Colonna utente */}
                    <td style={{
                      padding: "8px 16px",
                      borderBottom: "1px solid var(--border)",
                      whiteSpace: "nowrap",
                    }}>
                      <div style={{ display: "flex", alignItems: "center", gap: 10 }}>
                        <UserAvatar nome={utente.nome} cognome={utente.cognome} email={utente.email} />
                        <div>
                          <div style={{ fontSize: "0.78rem", fontWeight: 600, color: "var(--text)", lineHeight: 1.3 }}>
                            {utente.nome && utente.cognome
                              ? `${utente.nome} ${utente.cognome}`
                              : utente.email.split("@")[0]}
                          </div>
                          <div style={{ fontSize: "0.65rem", color: "var(--text-muted)", marginBottom: 3 }}>
                            {utente.email}
                          </div>
                          <RoleBadge ruolo={utente.ruolo} />
                        </div>
                        {pending > 0 && (
                          <span style={{
                            marginLeft: "auto", fontSize: "0.6rem",
                            background: "rgba(251,191,36,0.15)", color: "#fbbf24",
                            border: "1px solid rgba(251,191,36,0.35)",
                            borderRadius: 10, padding: "1px 6px",
                            fontFamily: "'DM Mono', monospace",
                          }}>
                            {pending} mod.
                          </span>
                        )}
                      </div>
                    </td>

                    {/* Celle permessi */}
                    {presenti.map((codice, ci) => {
                      const serverPerm = utente.permessi[codice];
                      const fonte = serverPerm?.fonte || "negato";
                      const localChangesForUser = localChanges[utente.utente_id] || {};
                      const localVal = localChangesForUser[codice]; // undefined | true | false | null

                      const tooltip = `${utente.email} → ${codice}\n${CELL_CONFIG[fonte]?.label || fonte}`;

                      return (
                        <td key={codice} style={{
                          padding: "6px 10px", textAlign: "center",
                          borderBottom: "1px solid var(--border)",
                          borderLeft: "1px solid var(--border)",
                        }}>
                          <PermCell
                            fonte={fonte}
                            localState={localVal}
                            tooltip={tooltip}
                            onClick={() => handleCellClick(utente.utente_id, codice, fonte)}
                          />
                        </td>
                      );
                    })}
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}

// ── Componente principale ────────────────────────────────────
export default function PermissionMatrixPanel() {
  const { authFetch } = useAuth();

  const [matrice,      setMatrice]      = useState(null);
  const [loading,      setLoading]      = useState(true);
  const [saving,       setSaving]       = useState({});
  const [saveResult,   setSaveResult]   = useState({});
  const [localChanges, setLocalChanges] = useState({});
  const [filtroUtente, setFiltroUtente] = useState("");
  const [catAperte,    setCatAperte]    = useState(
    Object.fromEntries(Object.keys(CATEGORIE).map(k => [k, true]))
  );

  const fetchMatrice = useCallback(async () => {
    setLoading(true);
    try {
      const res  = await authFetch("/api/v1/auth/permissions");
      const data = await res.json();
      setMatrice(data);
      setLocalChanges({});
      setSaveResult({});
    } catch (e) { console.error(e); }
    finally { setLoading(false); }
  }, [authFetch]);

  useEffect(() => { fetchMatrice(); }, [fetchMatrice]);

  const handleCellClick = useCallback((utente_id, codice, fonteAttuale) => {
    setLocalChanges(prev => {
      const uChanges = prev[utente_id] || {};
      const current  = uChanges[codice];

      let next;
      if (current === undefined) {
        if (fonteAttuale === "ruolo")               next = false;
        else if (fonteAttuale === "negato")         next = true;
        else if (fonteAttuale === "override_grant") next = false;
        else if (fonteAttuale === "override_deny")  next = null;
        else next = true;
      } else if (current === true)  { next = false; }
      else if (current === false)   { next = null;  }
      else                          { next = undefined; }

      const newUChanges = { ...uChanges };
      if (next === undefined) delete newUChanges[codice];
      else newUChanges[codice] = next;

      setSaveResult(pr => { const n = {...pr}; delete n[utente_id]; return n; });
      return { ...prev, [utente_id]: newUChanges };
    });
  }, []);

  const handleSaveUser = useCallback(async (utente_id) => {
    const changes = localChanges[utente_id];
    if (!changes || Object.keys(changes).length === 0) return;

    setSaving(prev => ({ ...prev, [utente_id]: true }));
    try {
      const overrides = Object.entries(changes).map(([codice_permesso, concesso]) => ({
        codice_permesso, concesso,
      }));
      const res = await authFetch(`/api/v1/auth/permissions/${utente_id}/bulk`, {
        method: "PUT",
        body:   JSON.stringify({ overrides }),
      });
      if (res.ok) {
        setSaveResult(prev => ({ ...prev, [utente_id]: "ok" }));
        setLocalChanges(prev => { const n = {...prev}; delete n[utente_id]; return n; });
        await fetchMatrice();
      } else {
        setSaveResult(prev => ({ ...prev, [utente_id]: "error" }));
      }
    } catch {
      setSaveResult(prev => ({ ...prev, [utente_id]: "error" }));
    } finally {
      setSaving(prev => ({ ...prev, [utente_id]: false }));
    }
  }, [localChanges, authFetch, fetchMatrice]);

  const handleSaveAll = useCallback(async () => {
    const uidsWithChanges = Object.keys(localChanges).filter(
      uid => Object.keys(localChanges[uid] || {}).length > 0
    );
    for (const uid of uidsWithChanges) {
      await handleSaveUser(parseInt(uid));
    }
  }, [localChanges, handleSaveUser]);

  const totalPending = Object.values(localChanges)
    .reduce((acc, uChanges) => acc + Object.keys(uChanges || {}).length, 0);

  if (loading) {
    return (
      <div style={{
        display: "flex", alignItems: "center", justifyContent: "center",
        height: "100%", color: "var(--text-muted)", fontSize: "0.82rem", gap: 12,
      }}>
        <div style={{
          width: 16, height: 16, borderRadius: "50%",
          border: "2px solid var(--accent)", borderTopColor: "transparent",
          animation: "spin 0.8s linear infinite",
        }} />
        Caricamento matrice permessi…
        <style>{`@keyframes spin { to { transform: rotate(360deg); } }`}</style>
      </div>
    );
  }

  if (!matrice) {
    return (
      <div style={{ padding: 40, textAlign: "center", color: "#f87171", fontSize: "0.82rem" }}>
        ⚠️ Errore nel caricamento. Riprova.
      </div>
    );
  }

  const tuttiPermessi = matrice.permessi;
  const utentiFiltrati = matrice.utenti.filter(u => {
    if (!filtroUtente) return true;
    const q = filtroUtente.toLowerCase();
    return u.email.toLowerCase().includes(q) ||
           (`${u.nome} ${u.cognome}`).toLowerCase().includes(q);
  });

  return (
    <div style={{ display: "flex", flexDirection: "column", height: "100%", overflow: "hidden" }}>

      {/* ── Toolbar ── */}
      <div style={{
        padding: "12px 20px",
        background: "var(--surface)",
        borderBottom: "1px solid var(--border)",
        flexShrink: 0,
      }}>
        {/* Riga titolo */}
        <div style={{ display: "flex", alignItems: "center", gap: 12, marginBottom: 10 }}>
          <div style={{ flex: 1 }}>
            <div style={{ display: "flex", alignItems: "center", gap: 10 }}>
              <span style={{ fontSize: "0.9rem", fontWeight: 700, color: "var(--text)" }}>
                🔐 Matrice Permessi
              </span>
              <span style={{
                fontSize: "0.68rem", color: "var(--text-muted)",
                fontFamily: "'DM Mono', monospace",
                padding: "2px 8px", borderRadius: 20,
                background: "var(--surface2)", border: "1px solid var(--border)",
              }}>
                {matrice.utenti.length} utenti · {tuttiPermessi.length} permessi
              </span>
              {totalPending > 0 && (
                <span style={{
                  fontSize: "0.68rem", padding: "2px 8px", borderRadius: 20,
                  background: "rgba(251,191,36,0.15)", color: "#fbbf24",
                  border: "1px solid rgba(251,191,36,0.35)",
                  fontFamily: "'DM Mono', monospace",
                }}>
                  {totalPending} modifiche non salvate
                </span>
              )}
            </div>
          </div>

          <div style={{ display: "flex", gap: 8, alignItems: "center" }}>
            <input
              placeholder="🔍 Cerca utente…"
              value={filtroUtente}
              onChange={e => setFiltroUtente(e.target.value)}
              style={{
                padding: "7px 12px", background: "var(--surface2)",
                border: "1px solid var(--border-strong)", borderRadius: 8,
                color: "var(--text)", fontFamily: "inherit", fontSize: "0.8rem",
                outline: "none", width: 200,
              }}
            />
            {totalPending > 0 && (
              <button onClick={handleSaveAll} style={{
                padding: "7px 16px", background: "var(--accent)", color: "white",
                border: "none", borderRadius: 8, cursor: "pointer",
                fontFamily: "inherit", fontSize: "0.8rem", fontWeight: 700,
                transition: "opacity 0.15s",
              }}>
                💾 Salva tutto ({totalPending})
              </button>
            )}
            <button onClick={fetchMatrice} style={{
              padding: "7px 12px", background: "none",
              border: "1px solid var(--border-strong)", borderRadius: 8,
              cursor: "pointer", fontFamily: "inherit",
              fontSize: "0.78rem", color: "var(--text-muted)", transition: "color 0.15s",
            }}>
              ↻
            </button>
          </div>
        </div>

        {/* Legenda orizzontale */}
        <div style={{ display: "flex", gap: 16, flexWrap: "wrap" }}>
          {[
            { key: "ruolo",          label: "Da ruolo" },
            { key: "override_grant", label: "Override: sì" },
            { key: "override_deny",  label: "Override: no" },
            { key: "negato",         label: "Non assegnato" },
            { key: "pending_reset",  label: "Modifica non salvata" },
          ].map(({ key, label }) => {
            const cfg = CELL_CONFIG[key];
            return (
              <div key={key} style={{ display: "flex", alignItems: "center", gap: 6 }}>
                <span style={{
                  width: 24, height: 22, borderRadius: 5,
                  border: `1.5px solid ${cfg.border}`,
                  background: cfg.bg, color: cfg.color,
                  display: "inline-flex", alignItems: "center", justifyContent: "center",
                  fontSize: "0.7rem", fontWeight: 700,
                }}>
                  {cfg.icon}
                </span>
                <span style={{ fontSize: "0.7rem", color: "var(--text-muted)" }}>{label}</span>
              </div>
            );
          })}
        </div>
      </div>

      {/* ── Barra salva per utente ── */}
      {Object.entries(localChanges).some(([, c]) => Object.keys(c || {}).length > 0) && (
        <div style={{
          padding: "8px 20px",
          background: "rgba(251,191,36,0.06)",
          borderBottom: "1px solid rgba(251,191,36,0.2)",
          display: "flex", gap: 8, flexWrap: "wrap",
          alignItems: "center", flexShrink: 0,
        }}>
          <span style={{ fontSize: "0.72rem", color: "#fbbf24", marginRight: 4 }}>
            Modifiche pendenti per:
          </span>
          {utentiFiltrati
            .filter(u => Object.keys(localChanges[u.utente_id] || {}).length > 0)
            .map(u => {
              const count   = Object.keys(localChanges[u.utente_id] || {}).length;
              const isSav   = saving[u.utente_id];
              const res     = saveResult[u.utente_id];
              const label   = u.nome ? `${u.nome} ${u.cognome || ""}`.trim() : u.email.split("@")[0];
              return (
                <button key={u.utente_id}
                  onClick={() => handleSaveUser(u.utente_id)}
                  disabled={isSav}
                  style={{
                    display: "flex", alignItems: "center", gap: 6,
                    padding: "4px 12px", borderRadius: 20,
                    background: res === "ok" ? "rgba(52,211,153,0.15)" : "rgba(251,191,36,0.15)",
                    border: `1px solid ${res === "ok" ? "rgba(52,211,153,0.4)" : "rgba(251,191,36,0.4)"}`,
                    color: res === "ok" ? "#34d399" : "#fbbf24",
                    cursor: isSav ? "not-allowed" : "pointer",
                    fontFamily: "inherit", fontSize: "0.72rem", fontWeight: 600,
                    opacity: isSav ? 0.6 : 1,
                  }}
                >
                  {res === "ok" ? "✓" : isSav ? "…" : "💾"} {label}
                  {!res && <span style={{ fontSize: "0.62rem", opacity: 0.8 }}>({count})</span>}
                </button>
              );
            })}
        </div>
      )}

      {/* ── Corpo scrollabile ── */}
      <div style={{ flex: 1, overflowY: "auto", padding: "16px 20px" }}>

        {/* Toggle categorie */}
        <div style={{ display: "flex", gap: 8, marginBottom: 14, flexWrap: "wrap" }}>
          {Object.keys(CATEGORIE).map(cat => {
            const cc = CAT_COLORS[cat];
            const aperta = catAperte[cat];
            return (
              <button key={cat}
                onClick={() => setCatAperte(prev => ({ ...prev, [cat]: !prev[cat] }))}
                style={{
                  display: "flex", alignItems: "center", gap: 5,
                  padding: "4px 12px", borderRadius: 20,
                  background: aperta ? cc.bg : "transparent",
                  border: `1px solid ${aperta ? cc.border : "var(--border)"}`,
                  color: aperta ? cc.accent : "var(--text-muted)",
                  cursor: "pointer", fontFamily: "inherit",
                  fontSize: "0.72rem", fontWeight: 600,
                  transition: "all 0.15s",
                }}
              >
                {CAT_ICONS[cat]} {cat}
              </button>
            );
          })}
        </div>

        {/* Sezioni per categoria */}
        {Object.entries(CATEGORIE).map(([catName, codici]) => (
          <CategorySection
            key={catName}
            catName={catName}
            codici={codici}
            tuttiPermessi={tuttiPermessi}
            utentiFiltrati={utentiFiltrati}
            localChanges={localChanges}
            getCellState={() => {}}
            handleCellClick={handleCellClick}
            aperta={catAperte[catName]}
            onToggle={() => setCatAperte(prev => ({ ...prev, [catName]: !prev[catName] }))}
          />
        ))}

        {utentiFiltrati.length === 0 && (
          <div style={{
            textAlign: "center", padding: "48px 24px",
            color: "var(--text-muted)", fontSize: "0.82rem",
          }}>
            Nessun utente trovato per "<strong>{filtroUtente}</strong>"
          </div>
        )}
      </div>
    </div>
  );
}