// src/pages/PermissionMatrixPanel.jsx
// FIX REACT BUGS:
// 1. handleCellClick aveva stale closure su localChanges perché usava
//    setLocalChanges con la funzione updater ma leggeva localChanges
//    nell'outer scope per decidere se eliminare la chiave.
//    FIX: uso esclusivamente la forma funzionale di setLocalChanges(prev => ...)
//    così si legge sempre lo stato più recente.
// 2. fetchMatrice nelle deps di useEffect era instabile perché
//    dipendeva da authFetch (che però ora è stabile con il fix in AuthContext).
//    Aggiunta comunque una verifica con useCallback.
// 3. handleSaveAll leggeva localChanges dall'outer scope → stale closure
//    durante salvataggi multipli. FIX: snapshot dello stato all'inizio.

import { useState, useEffect, useCallback } from "react";
import { useAuth } from "../context/AuthContext";

const CATEGORIE = {
  "Pagine":    ["page_chat", "page_admin", "page_profile"],
  "Tab Admin": ["tab_ingestion", "tab_loader", "tab_chunks", "tab_modifica", "tab_sync", "tab_log", "tab_users", "tab_permissions"],
  "Documenti": ["doc_upload", "doc_ingest", "doc_load", "doc_update", "doc_delete"],
  "Utenti":    ["user_view", "user_create", "user_update", "user_delete", "user_permissions"],
  "Log":       ["log_view"],
  "Chat":      ["chat_history_view", "chat_audit_view"], 
};

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
  chat_history_view: "Cronologia",   // ← aggiungi
  chat_audit_view:   "Audit",  
};

const CAT_ICONS = { "Pagine": "🌐", "Tab Admin": "🗂️", "Documenti": "📄", "Utenti": "👥", "Log": "📋" ,"Chat": "💬" };
const CAT_COLORS = {
  "Pagine":    { bg: "rgba(79,142,247,0.08)",  accent: "#4f8ef7", border: "rgba(79,142,247,0.2)"  },
  "Tab Admin": { bg: "rgba(139,92,246,0.08)",  accent: "#8b5cf6", border: "rgba(139,92,246,0.2)"  },
  "Documenti": { bg: "rgba(20,184,166,0.08)",  accent: "#14b8a6", border: "rgba(20,184,166,0.2)"  },
  "Utenti":    { bg: "rgba(245,158,11,0.08)",  accent: "#f59e0b", border: "rgba(245,158,11,0.2)"  },
  "Log":       { bg: "rgba(239,68,68,0.08)",   accent: "#ef4444", border: "rgba(239,68,68,0.2)"   },
  "Chat": { bg: "rgba(20,184,166,0.08)", accent: "#14b82a", border: "rgba(20, 184, 72, 0.2)" },  // ← aggiungi
};

function UserAvatar({ nome, cognome, email }) {
  const initials = nome && cognome ? `${nome[0]}${cognome[0]}`.toUpperCase() : email[0].toUpperCase();
  return (
    <div style={{ width: 30, height: 30, borderRadius: "50%", flexShrink: 0, background: "linear-gradient(135deg, var(--accent-dim), rgba(79,142,247,0.25))", border: "1px solid var(--accent-glow)", display: "flex", alignItems: "center", justifyContent: "center", fontSize: "0.68rem", fontWeight: 700, color: "var(--accent)" }}>
      {initials}
    </div>
  );
}

function RoleBadge({ ruolo }) {
  const colors = {
    SuperAdmin: { bg: "rgba(245,158,11,0.15)", color: "#fbbf24", border: "rgba(245,158,11,0.35)" },
    Admin:      { bg: "rgba(79,142,247,0.15)", color: "#60a5fa", border: "rgba(79,142,247,0.35)" },
    User:       { bg: "rgba(107,114,128,0.15)", color: "#9ca3af", border: "rgba(107,114,128,0.3)" },
  };
  const c = colors[ruolo] || colors.User;
  return <span style={{ fontSize: "0.58rem", fontWeight: 700, padding: "1px 6px", borderRadius: 12, background: c.bg, color: c.color, border: `1px solid ${c.border}`, fontFamily: "'DM Mono', monospace", whiteSpace: "nowrap" }}>{ruolo || "—"}</span>;
}

function PermCell({ effettivo, hasPending, pendingValue, onClick }) {
  const [hover, setHover] = useState(false);
  const displayed = hasPending ? pendingValue : effettivo;

  return (
    <button onClick={onClick} onMouseEnter={() => setHover(true)} onMouseLeave={() => setHover(false)}
      title={displayed ? "Permesso assegnato — clicca per revocare" : "Permesso non assegnato — clicca per assegnare"}
      style={{
        width: 32, height: 28, borderRadius: 6, cursor: "pointer",
        border: hasPending
          ? `2px dashed ${displayed ? "rgba(52,211,153,0.8)" : "rgba(107,114,128,0.6)"}`
          : `1.5px solid ${displayed ? "rgba(52,211,153,0.4)" : "var(--border)"}`,
        background: displayed
          ? (hover ? "rgba(52,211,153,0.22)" : "rgba(52,211,153,0.12)")
          : (hover ? "rgba(255,255,255,0.05)" : "transparent"),
        color: displayed ? "#34d399" : "var(--border-strong)",
        display: "flex", alignItems: "center", justifyContent: "center",
        fontSize: "0.8rem", fontWeight: 700,
        transition: "all 0.12s",
        transform: hover ? "scale(1.08)" : "scale(1)",
      }}>
      {displayed ? "✓" : "—"}
    </button>
  );
}

function CategorySection({ catName, codici, tuttiPermessi, utenti, localChanges, handleCellClick, aperta, onToggle }) {
  const catColor = CAT_COLORS[catName] || CAT_COLORS["Log"];
  const presenti = codici.filter(c => tuttiPermessi.some(p => p.codice === c));
  if (presenti.length === 0) return null;

  return (
    <div style={{ background: "var(--surface)", border: `1px solid ${catColor.border}`, borderRadius: 12, overflow: "hidden", marginBottom: 10 }}>
      <button onClick={onToggle} style={{ width: "100%", display: "flex", alignItems: "center", gap: 10, padding: "9px 16px", background: catColor.bg, border: "none", cursor: "pointer", textAlign: "left", borderBottom: aperta ? `1px solid ${catColor.border}` : "none" }}>
        <span style={{ fontSize: "0.9rem" }}>{CAT_ICONS[catName]}</span>
        <span style={{ fontSize: "0.8rem", fontWeight: 700, color: catColor.accent, flex: 1 }}>{catName}</span>
        <span style={{ fontSize: "0.65rem", color: "var(--text-muted)", fontFamily: "'DM Mono', monospace" }}>{presenti.length} permessi</span>
        <span style={{ fontSize: "0.72rem", color: catColor.accent, marginLeft: 6 }}>{aperta ? "▾" : "▸"}</span>
      </button>
      {aperta && (
        <div style={{ overflowX: "auto" }}>
          <table style={{ borderCollapse: "collapse", width: "100%", minWidth: `${200 + presenti.length * 72}px` }}>
            <thead>
              <tr style={{ background: "var(--surface2)" }}>
                <th style={{ padding: "7px 14px", textAlign: "left", whiteSpace: "nowrap", borderBottom: "1px solid var(--border)", width: 200, minWidth: 200, fontSize: "0.62rem", fontWeight: 600, color: "var(--text-muted)", textTransform: "uppercase", letterSpacing: "0.07em" }}>Utente</th>
                {presenti.map((codice) => (
                  <th key={codice} style={{ padding: "7px 8px", textAlign: "center", borderBottom: "1px solid var(--border)", borderLeft: "1px solid var(--border)", minWidth: 72 }}>
                    <div style={{ fontSize: "0.68rem", fontWeight: 600, color: "var(--text-dim)", whiteSpace: "nowrap" }}>{SHORT_LABELS[codice] || codice}</div>
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {utenti.map((utente, ri) => {
                const pendingCount = Object.keys(localChanges[utente.utente_id] || {}).filter(c => presenti.includes(c)).length;
                return (
                  <tr key={utente.utente_id} style={{ background: ri % 2 === 0 ? "var(--surface)" : "rgba(255,255,255,0.015)" }}>
                    <td style={{ padding: "7px 14px", borderBottom: "1px solid var(--border)", whiteSpace: "nowrap" }}>
                      <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
                        <UserAvatar nome={utente.nome} cognome={utente.cognome} email={utente.email} />
                        <div>
                          <div style={{ fontSize: "0.75rem", fontWeight: 600, color: "var(--text)", lineHeight: 1.2 }}>
                            {utente.nome && utente.cognome ? `${utente.nome} ${utente.cognome}` : utente.email.split("@")[0]}
                          </div>
                          <div style={{ fontSize: "0.62rem", color: "var(--text-muted)", marginBottom: 2 }}>{utente.email}</div>
                          <RoleBadge ruolo={utente.ruolo} />
                        </div>
                        {pendingCount > 0 && (
                          <span style={{ marginLeft: "auto", fontSize: "0.58rem", background: "rgba(251,191,36,0.15)", color: "#fbbf24", border: "1px solid rgba(251,191,36,0.35)", borderRadius: 10, padding: "1px 5px", fontFamily: "'DM Mono', monospace" }}>
                            {pendingCount}
                          </span>
                        )}
                      </div>
                    </td>
                    {presenti.map((codice) => {
                      const serverPerm = utente.permessi[codice];
                      const effettivo  = serverPerm?.effettivo ?? false;
                      const uChanges   = localChanges[utente.utente_id] || {};
                      const hasPending = codice in uChanges;
                      const pendingValue = hasPending ? uChanges[codice] : effettivo;
                      return (
                        <td key={codice} style={{ padding: "5px 8px", textAlign: "center", borderBottom: "1px solid var(--border)", borderLeft: "1px solid var(--border)" }}>
                          <PermCell
                            effettivo={effettivo}
                            hasPending={hasPending}
                            pendingValue={pendingValue}
                            onClick={() => handleCellClick(utente.utente_id, codice, effettivo)}
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

export default function PermissionMatrixPanel() {
  const { authFetch } = useAuth();
  const [matrice,      setMatrice]      = useState(null);
  const [loading,      setLoading]      = useState(true);
  const [saving,       setSaving]       = useState(false);
  const [saveMsg,      setSaveMsg]      = useState(null);
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
      setSaveMsg(null);
    } catch (e) { console.error(e); }
    finally { setLoading(false); }
  }, [authFetch]); // authFetch è stabile

  useEffect(() => { fetchMatrice(); }, [fetchMatrice]);

  // FIX STALE CLOSURE:
  // La versione originale leggeva localChanges dall'outer scope dentro
  // setLocalChanges, ma quella era la versione "congelata" al momento
  // della creazione del callback. Usando sempre la forma prev => ...
  // si legge sempre lo stato più recente.
  const handleCellClick = useCallback((utente_id, codice, effettivoServer) => {
    setLocalChanges(prev => {
      const uChanges = { ...(prev[utente_id] || {}) };
      if (codice in uChanges) {
        // Se è già pending, rimuovi (torna al valore server)
        delete uChanges[codice];
      } else {
        // Aggiungi pending con valore invertito
        uChanges[codice] = !effettivoServer;
      }
      setSaveMsg(null);
      // Se le modifiche dell'utente sono vuote, rimuovi la chiave
      if (Object.keys(uChanges).length === 0) {
        const { [utente_id]: _, ...rest } = prev;
        return rest;
      }
      return { ...prev, [utente_id]: uChanges };
    });
  }, []); // nessuna dep: usa solo setLocalChanges(prev => ...)

  // FIX STALE CLOSURE in handleSaveAll:
  // Leggiamo localChanges una volta sola all'inizio tramite snapshot
  // per evitare che cambi durante il ciclo di salvataggio asincrono.
  const handleSaveAll = useCallback(async () => {
    // Snapshot immediato dello stato corrente
    setLocalChanges(currentChanges => {
      const uidsWithChanges = Object.keys(currentChanges).filter(
        uid => Object.keys(currentChanges[uid] || {}).length > 0
      );
      if (uidsWithChanges.length === 0) return currentChanges;

      // Avvia il salvataggio asincrono con lo snapshot
      (async () => {
        setSaving(true);
        setSaveMsg(null);
        let errors = 0;

        for (const uid of uidsWithChanges) {
          const changes   = currentChanges[uid];
          const overrides = Object.entries(changes).map(([codice_permesso, concesso]) => ({
            codice_permesso, concesso,
          }));
          try {
            const res = await authFetch(`/api/v1/auth/permissions/${uid}/bulk`, {
              method: "PUT",
              body:   JSON.stringify({ overrides }),
            });
            if (!res.ok) errors++;
          } catch { errors++; }
        }

        setSaving(false);
        setSaveMsg(errors === 0
          ? { ok: true,  text: "Modifiche salvate con successo." }
          : { ok: false, text: `${errors} salvataggio/i fallito/i.` }
        );
        await fetchMatrice(); // ricarica e pulisce localChanges
      })();

      return currentChanges; // non modifica lo state qui, lo fa fetchMatrice
    });
  }, [authFetch, fetchMatrice]);

  // Calcola totalPending leggendo localChanges direttamente dallo state
  const totalPending = Object.values(localChanges)
    .reduce((acc, u) => acc + Object.keys(u || {}).length, 0);

  if (loading) {
    return (
      <div style={{ display: "flex", alignItems: "center", justifyContent: "center", height: "100%", color: "var(--text-muted)", fontSize: "0.82rem", gap: 12 }}>
        <div style={{ width: 16, height: 16, borderRadius: "50%", border: "2px solid var(--accent)", borderTopColor: "transparent", animation: "spin 0.8s linear infinite" }} />
        Caricamento…
        <style>{`@keyframes spin { to { transform: rotate(360deg); } }`}</style>
      </div>
    );
  }

  if (!matrice) {
    return <div style={{ padding: 40, textAlign: "center", color: "#f87171", fontSize: "0.82rem" }}>⚠️ Errore nel caricamento.</div>;
  }

  const tuttiPermessi = matrice.permessi;
  const utentiFiltrati = matrice.utenti.filter(u => {
    if (!filtroUtente) return true;
    const q = filtroUtente.toLowerCase();
    return u.email.toLowerCase().includes(q) || (`${u.nome} ${u.cognome}`).toLowerCase().includes(q);
  });

  return (
    <div style={{ display: "flex", flexDirection: "column", height: "100%", overflow: "hidden" }}>
      <div style={{ padding: "10px 16px", background: "var(--surface)", borderBottom: "1px solid var(--border)", flexShrink: 0 }}>
        <div style={{ display: "flex", alignItems: "center", gap: 10, marginBottom: 8 }}>
          <span style={{ fontSize: "0.88rem", fontWeight: 700, color: "var(--text)" }}>🔐 Matrice Permessi</span>
          <span style={{ fontSize: "0.65rem", color: "var(--text-muted)", fontFamily: "'DM Mono', monospace", padding: "2px 7px", borderRadius: 20, background: "var(--surface2)", border: "1px solid var(--border)" }}>
            {matrice.utenti.length} utenti · {tuttiPermessi.length} permessi
          </span>
          {totalPending > 0 && (
            <span style={{ fontSize: "0.65rem", padding: "2px 7px", borderRadius: 20, background: "rgba(251,191,36,0.15)", color: "#fbbf24", border: "1px solid rgba(251,191,36,0.35)", fontFamily: "'DM Mono', monospace" }}>
              {totalPending} modifiche non salvate
            </span>
          )}
          <div style={{ flex: 1 }} />
          <input placeholder="🔍 Cerca utente…" value={filtroUtente} onChange={e => setFiltroUtente(e.target.value)}
            style={{ padding: "6px 10px", background: "var(--surface2)", border: "1px solid var(--border-strong)", borderRadius: 7, color: "var(--text)", fontFamily: "inherit", fontSize: "0.78rem", outline: "none", width: 180 }} />
          {totalPending > 0 && (
            <button onClick={handleSaveAll} disabled={saving}
              style={{ padding: "6px 16px", background: "var(--accent)", color: "white", border: "none", borderRadius: 7, cursor: saving ? "not-allowed" : "pointer", fontFamily: "inherit", fontSize: "0.78rem", fontWeight: 700, opacity: saving ? 0.6 : 1 }}>
              {saving ? "Salvataggio…" : `💾 Salva (${totalPending})`}
            </button>
          )}
          <button onClick={fetchMatrice} style={{ padding: "6px 10px", background: "none", border: "1px solid var(--border-strong)", borderRadius: 7, cursor: "pointer", fontFamily: "inherit", fontSize: "0.75rem", color: "var(--text-muted)" }}>↻</button>
        </div>

        <div style={{ display: "flex", gap: 14, alignItems: "center" }}>
          <div style={{ display: "flex", alignItems: "center", gap: 5 }}>
            <span style={{ width: 24, height: 22, borderRadius: 5, border: "1.5px solid rgba(52,211,153,0.4)", background: "rgba(52,211,153,0.12)", color: "#34d399", display: "inline-flex", alignItems: "center", justifyContent: "center", fontSize: "0.75rem", fontWeight: 700 }}>✓</span>
            <span style={{ fontSize: "0.7rem", color: "var(--text-muted)" }}>Assegnato</span>
          </div>
          <div style={{ display: "flex", alignItems: "center", gap: 5 }}>
            <span style={{ width: 24, height: 22, borderRadius: 5, border: "1.5px solid var(--border)", background: "transparent", color: "var(--border-strong)", display: "inline-flex", alignItems: "center", justifyContent: "center", fontSize: "0.75rem", fontWeight: 700 }}>—</span>
            <span style={{ fontSize: "0.7rem", color: "var(--text-muted)" }}>Non assegnato</span>
          </div>
          <div style={{ display: "flex", alignItems: "center", gap: 5 }}>
            <span style={{ width: 24, height: 22, borderRadius: 5, border: "2px dashed rgba(52,211,153,0.8)", background: "rgba(52,211,153,0.08)", color: "#34d399", display: "inline-flex", alignItems: "center", justifyContent: "center", fontSize: "0.72rem", fontWeight: 700 }}>✓</span>
            <span style={{ fontSize: "0.7rem", color: "var(--text-muted)" }}>Modifica non salvata</span>
          </div>
        </div>

        {saveMsg && (
          <div style={{ marginTop: 8, padding: "6px 12px", borderRadius: 6, fontSize: "0.75rem", background: saveMsg.ok ? "rgba(52,211,153,0.1)" : "rgba(239,68,68,0.1)", border: `1px solid ${saveMsg.ok ? "rgba(52,211,153,0.3)" : "rgba(239,68,68,0.3)"}`, color: saveMsg.ok ? "#34d399" : "#f87171" }}>
            {saveMsg.ok ? "✓" : "⚠"} {saveMsg.text}
          </div>
        )}
      </div>

      <div style={{ flex: 1, overflowY: "auto", padding: "14px 16px" }}>
        <div style={{ display: "flex", gap: 6, marginBottom: 12, flexWrap: "wrap" }}>
          {Object.keys(CATEGORIE).map(cat => {
            const cc = CAT_COLORS[cat];
            const aperta = catAperte[cat];
            return (
              <button key={cat} onClick={() => setCatAperte(prev => ({ ...prev, [cat]: !prev[cat] }))}
                style={{ display: "flex", alignItems: "center", gap: 4, padding: "3px 10px", borderRadius: 20, background: aperta ? cc.bg : "transparent", border: `1px solid ${aperta ? cc.border : "var(--border)"}`, color: aperta ? cc.accent : "var(--text-muted)", cursor: "pointer", fontFamily: "inherit", fontSize: "0.7rem", fontWeight: 600, transition: "all 0.12s" }}>
                {CAT_ICONS[cat]} {cat}
              </button>
            );
          })}
        </div>

        {Object.entries(CATEGORIE).map(([catName, codici]) => (
          <CategorySection
            key={catName}
            catName={catName}
            codici={codici}
            tuttiPermessi={tuttiPermessi}
            utenti={utentiFiltrati}
            localChanges={localChanges}
            handleCellClick={handleCellClick}
            aperta={catAperte[catName]}
            onToggle={() => setCatAperte(prev => ({ ...prev, [catName]: !prev[catName] }))}
          />
        ))}

        {utentiFiltrati.length === 0 && (
          <div style={{ textAlign: "center", padding: "40px 24px", color: "var(--text-muted)", fontSize: "0.8rem" }}>
            Nessun utente trovato per "<strong>{filtroUtente}</strong>"
          </div>
        )}
      </div>
    </div>
  );
}