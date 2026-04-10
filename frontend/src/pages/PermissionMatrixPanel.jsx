// src/pages/PermissionMatrixPanel.jsx
// Matrice interattiva Utente × Permesso nel pannello admin.
//
// Colonne = permessi (raggruppati per categoria)
// Righe   = utenti (con ruolo)
// Celle   = stato effettivo + fonte (ruolo / override / negato)
//
// Interazione:
//   Click su cella → cicla tra: eredita-da-ruolo → forza-true → forza-false
//   Pulsante "Salva" per utente → invia bulk PUT

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

// ── Legenda stili cella ──────────────────────────────────────
// fonte: "ruolo" | "override_grant" | "override_deny" | "negato"
const CELL_STYLE = {
  ruolo:          { bg: "rgba(52,211,153,0.12)",  color: "#34d399", border: "rgba(52,211,153,0.3)",  icon: "✓",  title: "Ereditato dal ruolo" },
  override_grant: { bg: "rgba(79,142,247,0.18)",  color: "#60a5fa", border: "rgba(79,142,247,0.5)",  icon: "★",  title: "Override: concesso" },
  override_deny:  { bg: "rgba(239,68,68,0.12)",   color: "#f87171", border: "rgba(239,68,68,0.35)",  icon: "✕",  title: "Override: negato" },
  negato:         { bg: "var(--surface2)",          color: "var(--border-strong)", border: "var(--border)", icon: "—",  title: "Non assegnato" },
  // stati locali (modifiche non ancora salvate)
  pending_true:   { bg: "rgba(79,142,247,0.25)",  color: "#93c5fd", border: "rgba(79,142,247,0.6)",  icon: "★", title: "Da salvare: concedi" },
  pending_false:  { bg: "rgba(239,68,68,0.20)",   color: "#fca5a5", border: "rgba(239,68,68,0.5)",   icon: "✕", title: "Da salvare: nega" },
  pending_reset:  { bg: "rgba(251,191,36,0.12)",  color: "#fbbf24", border: "rgba(251,191,36,0.35)", icon: "↺", title: "Da salvare: ripristina ruolo" },
};

// ── Tooltip semplice ─────────────────────────────────────────
function Tooltip({ text, children }) {
  const [visible, setVisible] = useState(false);
  return (
    <div style={{ position: "relative", display: "inline-flex" }}
      onMouseEnter={() => setVisible(true)}
      onMouseLeave={() => setVisible(false)}>
      {children}
      {visible && (
        <div style={{
          position: "absolute", bottom: "calc(100% + 6px)", left: "50%",
          transform: "translateX(-50%)", whiteSpace: "nowrap",
          background: "#1c2030", border: "1px solid var(--border-strong)",
          borderRadius: 6, padding: "4px 8px", fontSize: "0.65rem",
          color: "var(--text)", zIndex: 100, pointerEvents: "none",
          boxShadow: "0 4px 12px rgba(0,0,0,0.4)",
        }}>
          {text}
        </div>
      )}
    </div>
  );
}

// ── Legenda colori ───────────────────────────────────────────
function Legenda() {
  const voci = [
    { ...CELL_STYLE.ruolo,          label: "Da ruolo" },
    { ...CELL_STYLE.override_grant, label: "Override concesso" },
    { ...CELL_STYLE.override_deny,  label: "Override negato" },
    { ...CELL_STYLE.negato,         label: "Non assegnato" },
  ];
  return (
    <div style={{ display: "flex", gap: 12, alignItems: "center", flexWrap: "wrap" }}>
      {voci.map(v => (
        <div key={v.label} style={{ display: "flex", alignItems: "center", gap: 5 }}>
          <span style={{
            width: 22, height: 22, borderRadius: 4, border: `1px solid ${v.border}`,
            background: v.bg, color: v.color,
            display: "inline-flex", alignItems: "center", justifyContent: "center",
            fontSize: "0.72rem", fontWeight: 700,
          }}>{v.icon}</span>
          <span style={{ fontSize: "0.7rem", color: "var(--text-muted)" }}>{v.label}</span>
        </div>
      ))}
      <div style={{ display: "flex", alignItems: "center", gap: 5 }}>
        <span style={{
          width: 22, height: 22, borderRadius: 4,
          border: "1px solid rgba(251,191,36,0.35)",
          background: "rgba(251,191,36,0.12)", color: "#fbbf24",
          display: "inline-flex", alignItems: "center", justifyContent: "center",
          fontSize: "0.72rem", fontWeight: 700,
        }}>↺</span>
        <span style={{ fontSize: "0.7rem", color: "var(--text-muted)" }}>Modifica non salvata</span>
      </div>
    </div>
  );
}

// ── Componente principale ────────────────────────────────────
export default function PermissionMatrixPanel() {
  const { authFetch } = useAuth();

  const [matrice,     setMatrice]     = useState(null);  // dati dal server
  const [loading,     setLoading]     = useState(true);
  const [saving,      setSaving]      = useState({});    // { utente_id: bool }
  const [saveResult,  setSaveResult]  = useState({});    // { utente_id: "ok"|"error" }
  // modifiche locali: { utente_id: { codice_permesso: true|false|null } }
  // null = ripristina al default del ruolo
  const [localChanges, setLocalChanges] = useState({});
  const [filtroUtente,  setFiltroUtente]  = useState("");
  const [categoriaAperta, setCategoriaAperta] = useState(
    Object.fromEntries(Object.keys(CATEGORIE).map(k => [k, true]))
  );

  // ── Carica matrice dal server ────────────────────────────
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

  // ── Click su cella: cicla tra stati ─────────────────────
  // Ciclo: eredita-da-ruolo → override-true → override-false → eredita-da-ruolo
  const handleCellClick = useCallback((utente_id, codice, fonteAttuale) => {
    setLocalChanges(prev => {
      const uChanges = prev[utente_id] || {};
      const current  = uChanges[codice];  // undefined | true | false | null

      let next;
      if (current === undefined) {
        // Nessuna modifica locale → guarda lo stato server
        if (fonteAttuale === "ruolo")          next = true;   // → override_grant
        else if (fonteAttuale === "negato")    next = true;   // → override_grant
        else if (fonteAttuale === "override_grant") next = false; // → override_deny
        else if (fonteAttuale === "override_deny")  next = null;  // → ripristina
        else next = true;
      } else if (current === true)  { next = false; }
      else if (current === false)   { next = null;  }
      else                          { next = undefined; } // rimuovi modifica locale

      const newUChanges = { ...uChanges };
      if (next === undefined) {
        delete newUChanges[codice];
      } else {
        newUChanges[codice] = next;
      }

      // Azzera il save result per questo utente (ha modifiche non salvate)
      setSaveResult(pr => { const n = {...pr}; delete n[utente_id]; return n; });

      return { ...prev, [utente_id]: newUChanges };
    });
  }, []);

  // ── Salva modifiche di un utente ─────────────────────────
  const handleSave = useCallback(async (utente_id) => {
    const changes = localChanges[utente_id];
    if (!changes || Object.keys(changes).length === 0) return;

    setSaving(prev => ({ ...prev, [utente_id]: true }));
    try {
      const overrides = Object.entries(changes).map(([codice_permesso, concesso]) => ({
        codice_permesso,
        concesso,  // true | false | null
      }));

      const res = await authFetch(`/api/v1/auth/permissions/${utente_id}/bulk`, {
        method: "PUT",
        body:   JSON.stringify({ overrides }),
      });

      if (res.ok) {
        setSaveResult(prev => ({ ...prev, [utente_id]: "ok" }));
        setLocalChanges(prev => { const n = {...prev}; delete n[utente_id]; return n; });
        // Ricarica la matrice per mostrare lo stato aggiornato
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

  // ── Determina stile cella combinando server + locale ─────
  const getCellState = useCallback((utente_id, codice, serverData) => {
    const local = localChanges[utente_id]?.[codice];

    if (local === true)  return { ...CELL_STYLE.pending_true,  isPending: true };
    if (local === false) return { ...CELL_STYLE.pending_false, isPending: true };
    if (local === null)  return { ...CELL_STYLE.pending_reset, isPending: true };

    const fonte = serverData?.fonte || "negato";
    return { ...CELL_STYLE[fonte] || CELL_STYLE.negato, isPending: false, fonte };
  }, [localChanges]);

  // ── Conta modifiche non salvate per utente ───────────────
  const countPending = (utente_id) =>
    Object.keys(localChanges[utente_id] || {}).length;

  if (loading) {
    return (
      <div style={{ padding: 40, textAlign: "center", color: "var(--text-muted)", fontSize: "0.82rem" }}>
        Caricamento matrice permessi…
      </div>
    );
  }

  if (!matrice) {
    return (
      <div style={{ padding: 40, textAlign: "center", color: "#f87171", fontSize: "0.82rem" }}>
        Errore nel caricamento della matrice.
      </div>
    );
  }

  const tuttiPermessi = matrice.permessi; // [{ codice, descrizione }]

  // Utenti filtrati per nome/email
  const utentiFiltrati = matrice.utenti.filter(u => {
    if (!filtroUtente) return true;
    const q = filtroUtente.toLowerCase();
    return u.email.toLowerCase().includes(q) ||
           (u.nome + " " + u.cognome).toLowerCase().includes(q);
  });

  return (
    <div style={{ display: "flex", flexDirection: "column", height: "100%", overflow: "hidden" }}>

      {/* ── Toolbar ── */}
      <div style={{
        padding: "12px 16px", borderBottom: "1px solid var(--border)",
        background: "var(--surface)", flexShrink: 0,
        display: "flex", flexDirection: "column", gap: 10,
      }}>
        <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", gap: 10 }}>
          <div style={{ display: "flex", alignItems: "center", gap: 10 }}>
            <span style={{ fontSize: "0.88rem", fontWeight: 700, color: "var(--text)" }}>
              🔐 Matrice Permessi
            </span>
            <span style={{
              fontSize: "0.68rem", color: "var(--text-muted)",
              fontFamily: "'DM Mono', monospace",
              padding: "2px 8px", borderRadius: 20,
              background: "var(--surface2)", border: "1px solid var(--border)",
            }}>
              {matrice.utenti.length} utenti × {tuttiPermessi.length} permessi
            </span>
          </div>

          <div style={{ display: "flex", gap: 8 }}>
            <input
              placeholder="Cerca utente…"
              value={filtroUtente}
              onChange={e => setFiltroUtente(e.target.value)}
              style={{
                padding: "6px 10px", background: "var(--surface2)",
                border: "1px solid var(--border-strong)", borderRadius: 6,
                color: "var(--text)", fontFamily: "inherit", fontSize: "0.78rem", outline: "none",
                width: 180,
              }}
            />
            <button onClick={fetchMatrice} style={{
              padding: "6px 12px", background: "none",
              border: "1px solid var(--border-strong)", borderRadius: 6,
              cursor: "pointer", fontFamily: "inherit",
              fontSize: "0.75rem", color: "var(--text-muted)",
            }}>
              ↻ Aggiorna
            </button>
          </div>
        </div>

        <Legenda />
      </div>

      {/* ── Tabella scrollabile ── */}
      <div style={{ flex: 1, overflow: "auto" }}>
        <table style={{
          borderCollapse: "collapse", minWidth: "100%",
          fontSize: "0.72rem", tableLayout: "auto",
        }}>

          {/* ── THEAD: categorie + permessi ── */}
          <thead style={{ position: "sticky", top: 0, zIndex: 10 }}>
            {/* Riga categorie */}
            <tr style={{ background: "var(--surface)" }}>
              <th style={{
                padding: "10px 14px", textAlign: "left", whiteSpace: "nowrap",
                borderBottom: "1px solid var(--border)", borderRight: "1px solid var(--border)",
                fontSize: "0.7rem", fontWeight: 700, color: "var(--text-muted)",
                textTransform: "uppercase", letterSpacing: "0.07em",
                minWidth: 220, background: "var(--surface)",
              }}>
                Utente / Ruolo
              </th>
              {Object.entries(CATEGORIE).map(([cat, codici]) => {
                // Quanti permessi di questa categoria esistono nella matrice
                const presenti = codici.filter(c => tuttiPermessi.some(p => p.codice === c));
                if (presenti.length === 0) return null;
                return (
                  <th key={cat}
                    colSpan={presenti.length}
                    style={{
                      padding: "8px 6px", textAlign: "center",
                      borderBottom: "1px solid var(--border)",
                      borderLeft: "1px solid var(--border-strong)",
                      background: "var(--surface2)",
                      fontSize: "0.68rem", fontWeight: 700,
                      color: "var(--accent)", textTransform: "uppercase",
                      letterSpacing: "0.06em", cursor: "pointer",
                      userSelect: "none",
                    }}
                    onClick={() => setCategoriaAperta(prev => ({
                      ...prev, [cat]: !prev[cat]
                    }))}
                  >
                    {categoriaAperta[cat] ? "▾" : "▸"} {cat}
                  </th>
                );
              })}
              <th style={{
                padding: "8px 12px", background: "var(--surface)",
                borderBottom: "1px solid var(--border)",
                borderLeft: "1px solid var(--border-strong)",
                whiteSpace: "nowrap",
              }}>
                <span style={{ fontSize: "0.68rem", color: "var(--text-muted)" }}>Azioni</span>
              </th>
            </tr>

            {/* Riga nomi permessi */}
            <tr style={{ background: "var(--surface)" }}>
              <th style={{
                padding: "6px 14px",
                borderBottom: "2px solid var(--border-strong)",
                borderRight: "1px solid var(--border)",
                background: "var(--surface)",
              }} />
              {Object.entries(CATEGORIE).map(([cat, codici]) => {
                const presenti = codici.filter(c => tuttiPermessi.some(p => p.codice === c));
                if (presenti.length === 0) return null;
                if (!categoriaAperta[cat]) {
                  return (
                    <th key={cat} colSpan={presenti.length}
                      style={{
                        padding: "4px 8px", textAlign: "center",
                        borderBottom: "2px solid var(--border-strong)",
                        borderLeft: "1px solid var(--border-strong)",
                        background: "var(--surface2)",
                        color: "var(--text-muted)", fontSize: "0.62rem",
                      }}>
                      {presenti.length} permessi nascosti
                    </th>
                  );
                }
                return presenti.map((codice, i) => {
                  const perm = tuttiPermessi.find(p => p.codice === codice);
                  if (!perm) return null;
                  const shortName = codice.replace(/^(page_|tab_|doc_|user_|log_)/, "");
                  return (
                    <th key={codice} style={{
                      padding: "4px 4px 8px",
                      borderBottom: "2px solid var(--border-strong)",
                      borderLeft: i === 0 ? "1px solid var(--border-strong)" : "1px solid var(--border)",
                      background: "var(--surface)",
                      writingMode: "vertical-rl",
                      textOrientation: "mixed",
                      transform: "rotate(180deg)",
                      height: 80,
                      minWidth: 32,
                    }}>
                      <Tooltip text={perm.descrizione || codice}>
                        <span style={{
                          fontSize: "0.65rem", fontWeight: 600,
                          color: "var(--text-dim)", fontFamily: "'DM Mono', monospace",
                          letterSpacing: "0.02em",
                          cursor: "help",
                        }}>
                          {shortName}
                        </span>
                      </Tooltip>
                    </th>
                  );
                });
              })}
              <th style={{
                borderBottom: "2px solid var(--border-strong)",
                borderLeft: "1px solid var(--border-strong)",
                background: "var(--surface)",
              }} />
            </tr>
          </thead>

          {/* ── TBODY: righe utenti ── */}
          <tbody>
            {utentiFiltrati.map((utente, ri) => {
              const pending    = countPending(utente.utente_id);
              const isSaving   = saving[utente.utente_id];
              const saveStatus = saveResult[utente.utente_id];

              return (
                <tr key={utente.utente_id}
                  style={{ background: ri % 2 === 0 ? "var(--surface)" : "var(--surface2)" }}>

                  {/* ── Cella utente ── */}
                  <td style={{
                    padding: "8px 14px",
                    borderBottom: "1px solid var(--border)",
                    borderRight: "1px solid var(--border)",
                    whiteSpace: "nowrap",
                    position: "sticky", left: 0, zIndex: 1,
                    background: ri % 2 === 0 ? "var(--surface)" : "var(--surface2)",
                  }}>
                    <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
                      <div style={{
                        width: 28, height: 28, borderRadius: "50%",
                        background: "var(--accent-dim)", border: "1px solid var(--accent-glow)",
                        display: "flex", alignItems: "center", justifyContent: "center",
                        fontSize: "0.75rem", flexShrink: 0,
                      }}>👤</div>
                      <div>
                        <div style={{ fontSize: "0.78rem", fontWeight: 600, color: "var(--text)" }}>
                          {utente.nome || utente.email.split("@")[0]}
                          {utente.cognome ? ` ${utente.cognome}` : ""}
                        </div>
                        <div style={{ fontSize: "0.65rem", color: "var(--text-muted)" }}>
                          {utente.email}
                        </div>
                        <span style={{
                          fontSize: "0.6rem", fontWeight: 700,
                          padding: "1px 5px", borderRadius: 10,
                          fontFamily: "'DM Mono', monospace",
                          background: "rgba(79,142,247,0.1)",
                          color: "var(--accent)",
                          border: "1px solid rgba(79,142,247,0.25)",
                        }}>
                          {utente.ruolo || "—"}
                        </span>
                      </div>
                    </div>
                  </td>

                  {/* ── Celle permessi ── */}
                  {Object.entries(CATEGORIE).map(([cat, codici]) => {
                    const presenti = codici.filter(c => tuttiPermessi.some(p => p.codice === c));
                    if (presenti.length === 0) return null;
                    if (!categoriaAperta[cat]) {
                      return (
                        <td key={cat} colSpan={presenti.length}
                          style={{
                            borderBottom: "1px solid var(--border)",
                            borderLeft: "1px solid var(--border-strong)",
                            background: "rgba(0,0,0,0.05)",
                          }} />
                      );
                    }
                    return presenti.map((codice, i) => {
                      const serverPerm  = utente.permessi[codice];
                      const cellState   = getCellState(utente.utente_id, codice, serverPerm);
                      const fonteServer = serverPerm?.fonte || "negato";

                      return (
                        <td key={codice} style={{
                          padding: "4px",
                          borderBottom: "1px solid var(--border)",
                          borderLeft: i === 0 ? "1px solid var(--border-strong)" : "1px solid var(--border)",
                          textAlign: "center",
                        }}>
                          <Tooltip text={
                            cellState.isPending
                              ? cellState.title
                              : `${cellState.title}\n${codice}`
                          }>
                            <button
                              onClick={() => handleCellClick(utente.utente_id, codice, fonteServer)}
                              style={{
                                width: 28, height: 28, borderRadius: 5,
                                border: `1px solid ${cellState.border}`,
                                background: cellState.bg,
                                color: cellState.color,
                                cursor: "pointer",
                                display: "inline-flex", alignItems: "center",
                                justifyContent: "center",
                                fontSize: "0.75rem", fontWeight: 700,
                                transition: "all 0.15s",
                                outline: cellState.isPending ? `2px solid ${cellState.border}` : "none",
                                outlineOffset: 1,
                              }}
                            >
                              {cellState.icon}
                            </button>
                          </Tooltip>
                        </td>
                      );
                    });
                  })}

                  {/* ── Cella azioni ── */}
                  <td style={{
                    padding: "6px 12px",
                    borderBottom: "1px solid var(--border)",
                    borderLeft: "1px solid var(--border-strong)",
                    whiteSpace: "nowrap",
                    textAlign: "right",
                  }}>
                    {pending > 0 && (
                      <span style={{
                        fontSize: "0.62rem", marginRight: 8,
                        color: "#fbbf24", fontFamily: "'DM Mono', monospace",
                      }}>
                        {pending} mod.
                      </span>
                    )}

                    {saveStatus === "ok" && (
                      <span style={{ fontSize: "0.68rem", color: "#34d399", marginRight: 8 }}>✓ Salvato</span>
                    )}
                    {saveStatus === "error" && (
                      <span style={{ fontSize: "0.68rem", color: "#f87171", marginRight: 8 }}>✕ Errore</span>
                    )}

                    <button
                      onClick={() => handleSave(utente.utente_id)}
                      disabled={pending === 0 || isSaving}
                      style={{
                        padding: "4px 10px",
                        background: pending > 0 ? "var(--accent)" : "var(--surface2)",
                        color:      pending > 0 ? "white"        : "var(--text-muted)",
                        border: "none", borderRadius: 6, cursor: pending > 0 ? "pointer" : "not-allowed",
                        fontFamily: "inherit", fontSize: "0.72rem", fontWeight: 600,
                        opacity: isSaving ? 0.6 : 1,
                        transition: "all 0.15s",
                      }}
                    >
                      {isSaving ? "…" : "Salva"}
                    </button>
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>

        {utentiFiltrati.length === 0 && (
          <div style={{ padding: 40, textAlign: "center", color: "var(--text-muted)", fontSize: "0.78rem" }}>
            Nessun utente trovato.
          </div>
        )}
      </div>
    </div>
  );
}
