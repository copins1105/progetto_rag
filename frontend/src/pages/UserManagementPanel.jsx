// src/pages/UserManagementPanel.jsx
//
// Gestione utenti con ownership:
//   SuperAdmin → vede e gestisce tutti gli utenti, può creare Admin e User.
//               Vede la colonna "Creato da" per ogni utente.
//   Admin      → vede e gestisce solo gli User creati da lui; può creare solo User.

import { useState, useEffect, useCallback } from "react";
import { useAuth } from "../context/AuthContext";

const ROLE_OPTIONS_ADMIN      = ["User"];
const ROLE_OPTIONS_SUPERADMIN = ["Admin", "User"];

const s = {
  btn: (variant = "primary") => ({
    padding: "8px 16px", border: "none", borderRadius: "8px",
    cursor: "pointer", fontFamily: "inherit", fontSize: "0.82rem", fontWeight: 600,
    transition: "opacity 0.2s",
    ...(variant === "primary"  && { background: "var(--accent)", color: "white" }),
    ...(variant === "danger"   && { background: "rgba(239,68,68,0.12)", color: "#f87171", border: "1px solid rgba(239,68,68,0.25)" }),
    ...(variant === "ghost"    && { background: "none", color: "var(--text-muted)", border: "1px solid var(--border-strong)" }),
    ...(variant === "success"  && { background: "rgba(52,211,153,0.12)", color: "#34d399", border: "1px solid rgba(52,211,153,0.3)" }),
  }),
  input: {
    width: "100%", padding: "8px 10px", background: "var(--surface2)",
    border: "1px solid var(--border-strong)", borderRadius: "6px",
    color: "var(--text)", fontFamily: "inherit", fontSize: "0.82rem", outline: "none",
    marginBottom: "10px",
  },
  label: {
    display: "block", fontSize: "0.7rem", fontWeight: 600,
    color: "var(--text-muted)", textTransform: "uppercase",
    letterSpacing: "0.06em", marginBottom: "4px",
  },
  select: {
    width: "100%", padding: "8px 10px", background: "var(--surface2)",
    border: "1px solid var(--border-strong)", borderRadius: "6px",
    color: "var(--text)", fontFamily: "inherit", fontSize: "0.82rem", outline: "none",
    marginBottom: "10px",
  },
  card: {
    background: "var(--surface2)", border: "1px solid var(--border)",
    borderRadius: "10px", padding: "14px 16px", marginBottom: "8px",
  },
  avatar: {
    width: 36, height: 36, borderRadius: "50%",
    background: "var(--accent-dim)", border: "1px solid var(--accent-glow)",
    display: "flex", alignItems: "center", justifyContent: "center",
    fontSize: "0.9rem", flexShrink: 0,
  },
  avatarSmall: (color = "var(--accent-dim)", borderColor = "var(--accent-glow)") => ({
    width: 24, height: 24, borderRadius: "50%",
    background: color, border: `1px solid ${borderColor}`,
    display: "inline-flex", alignItems: "center", justifyContent: "center",
    fontSize: "0.6rem", fontWeight: 700, flexShrink: 0,
    color: "var(--accent-bright)", fontFamily: "'JetBrains Mono', monospace",
    marginRight: 6,
  }),
  banner: (ok) => ({
    padding: "9px 12px", borderRadius: "6px", fontSize: "0.78rem", marginBottom: 12,
    background: ok ? "rgba(52,211,153,0.1)" : "rgba(239,68,68,0.1)",
    border:     ok ? "1px solid rgba(52,211,153,0.3)" : "1px solid rgba(239,68,68,0.3)",
    color:      ok ? "#34d399" : "#f87171",
  }),
  modal: {
    position: "fixed", inset: 0, background: "rgba(0,0,0,0.6)",
    display: "flex", alignItems: "center", justifyContent: "center", zIndex: 1000,
  },
  modalBox: {
    background: "var(--surface)", border: "1px solid var(--border-strong)",
    borderRadius: 14, padding: "28px", width: 380, boxShadow: "0 24px 48px rgba(0,0,0,0.5)",
  },
};

// ─────────────────────────────────────────────
// MODAL CREA UTENTE
// ─────────────────────────────────────────────
function CreateUserModal({ onClose, onCreated, authFetch, isSuperAdmin }) {
  const roleOptions = isSuperAdmin ? ROLE_OPTIONS_SUPERADMIN : ROLE_OPTIONS_ADMIN;

  const [email,    setEmail]    = useState("");
  const [password, setPassword] = useState("");
  const [nome,     setNome]     = useState("");
  const [cognome,  setCognome]  = useState("");
  const [ruolo,    setRuolo]    = useState("User");
  const [loading,  setLoading]  = useState(false);
  const [error,    setError]    = useState("");

  const handleCreate = async (e) => {
    e.preventDefault();
    setError("");
    if (password.length < 8) { setError("Password minima 8 caratteri."); return; }
    setLoading(true);
    try {
      const res  = await authFetch("/api/v1/auth/users", {
        method: "POST",
        body: JSON.stringify({ email, password, nome, cognome, ruolo }),
      });
      const data = await res.json();
      if (!res.ok) { setError(data.detail || "Errore."); return; }
      onCreated(data.user);
      onClose();
    } catch (err) {
      setError(err.message);
    } finally {
      setLoading(false);
    }
  };

  return (
    <div style={s.modal}>
      <div style={s.modalBox}>
        <h3 style={{ fontSize: "0.95rem", fontWeight: 600, color: "var(--text)", marginBottom: 20 }}>
          Crea nuovo utente
        </h3>
        {!isSuperAdmin && (
          <div style={{ ...s.banner(true), marginBottom: 16, fontSize: "0.72rem" }}>
            ℹ️ Come Admin puoi creare solo utenti con ruolo <strong>User</strong>.
          </div>
        )}
        <form onSubmit={handleCreate} noValidate>
          <label style={s.label}>Email *</label>
          <input style={s.input} type="email" value={email} onChange={e => setEmail(e.target.value)} required />
          <label style={s.label}>Password * (min 8 caratteri)</label>
          <input style={s.input} type="password" value={password} onChange={e => setPassword(e.target.value)} required />
          <div style={{ display: "flex", gap: 10 }}>
            <div style={{ flex: 1 }}>
              <label style={s.label}>Nome</label>
              <input style={s.input} type="text" value={nome} onChange={e => setNome(e.target.value)} />
            </div>
            <div style={{ flex: 1 }}>
              <label style={s.label}>Cognome</label>
              <input style={s.input} type="text" value={cognome} onChange={e => setCognome(e.target.value)} />
            </div>
          </div>
          <label style={s.label}>Ruolo *</label>
          <select style={s.select} value={ruolo} onChange={e => setRuolo(e.target.value)}>
            {roleOptions.map(r => <option key={r} value={r}>{r}</option>)}
          </select>

          {error && <div style={s.banner(false)}>⚠ {error}</div>}

          <div style={{ display: "flex", gap: 8, justifyContent: "flex-end", marginTop: 8 }}>
            <button type="button" style={s.btn("ghost")} onClick={onClose}>Annulla</button>
            <button type="submit" style={{ ...s.btn("primary"), opacity: loading ? 0.5 : 1 }} disabled={loading}>
              {loading ? "Creazione…" : "Crea utente"}
            </button>
          </div>
        </form>
      </div>
    </div>
  );
}

// ─────────────────────────────────────────────
// HELPER: renderizza il creatore
// ─────────────────────────────────────────────
function CreatorCell({ creatorId, allUsers }) {
  if (!creatorId) {
    return (
      <span style={{ color: "var(--text-muted)", fontStyle: "italic", fontSize: "0.72rem" }}>
        Sistema / SuperAdmin
      </span>
    );
  }

  const creator = allUsers.find(u => u.utente_id === creatorId);
  if (!creator) {
    return (
      <span style={{ fontSize: "0.72rem", fontFamily: "'JetBrains Mono', monospace", color: "var(--text-muted)" }}>
        id:{creatorId}
      </span>
    );
  }

  const nome     = creator.nome && creator.cognome ? `${creator.nome} ${creator.cognome}` : creator.email;
  const initials = nome.slice(0, 2).toUpperCase();

  return (
    <div style={{ display: "flex", alignItems: "center" }}>
      <span style={s.avatarSmall("rgba(139,92,246,0.12)", "rgba(139,92,246,0.3)")}>
        {initials}
      </span>
      <div>
        <div style={{ fontSize: "0.75rem", fontWeight: 600, color: "var(--text)", lineHeight: 1.2 }}>{nome}</div>
        <div style={{ fontSize: "0.62rem", color: "var(--text-muted)" }}>{creator.email}</div>
      </div>
    </div>
  );
}

// ─────────────────────────────────────────────
// RIGA UTENTE
// ─────────────────────────────────────────────
function UserRow({ u, currentUser, authFetch, onUpdated, onDeleted, isSuperAdmin, allUsers }) {
  const roleOptions = isSuperAdmin ? ROLE_OPTIONS_SUPERADMIN : ROLE_OPTIONS_ADMIN;

  const [editing,    setEditing]    = useState(false);
  const [nome,       setNome]       = useState(u.nome     || "");
  const [cognome,    setCognome]    = useState(u.cognome  || "");
  const [ruolo,      setRuolo]      = useState(u.ruoli?.[0] || "User");
  const [loading,    setLoading]    = useState(false);
  const [result,     setResult]     = useState(null);
  const [confirmDel, setConfirmDel] = useState(false);

  const isSelf      = currentUser?.utente_id === u.utente_id;
  const isProtected = !isSuperAdmin && u.ruoli?.some(r => ["Admin", "SuperAdmin"].includes(r));

  const handleSave = async () => {
    setLoading(true); setResult(null);
    try {
      const res  = await authFetch(`/api/v1/auth/users/${u.utente_id}`, {
        method: "PUT",
        body: JSON.stringify({ nome, cognome, ruolo }),
      });
      const data = await res.json();
      if (!res.ok) { setResult({ ok: false, msg: data.detail }); return; }
      onUpdated(data.user);
      setEditing(false);
    } catch (err) {
      setResult({ ok: false, msg: err.message });
    } finally {
      setLoading(false);
    }
  };

  const handleDelete = async () => {
    setLoading(true);
    try {
      const res = await authFetch(`/api/v1/auth/users/${u.utente_id}`, { method: "DELETE" });
      if (!res.ok) {
        const data = await res.json();
        setResult({ ok: false, msg: data.detail });
        return;
      }
      onDeleted(u.utente_id);
    } catch (err) {
      setResult({ ok: false, msg: err.message });
    } finally {
      setLoading(false); setConfirmDel(false);
    }
  };

  return (
    <div style={s.card}>
      <div style={{ display: "flex", alignItems: "center", gap: 12 }}>
        {/* Avatar */}
        <div style={s.avatar}>👤</div>

        {/* Info + eventuale form edit */}
        <div style={{ flex: 1, minWidth: 0 }}>
          {editing ? (
            <>
              <div style={{ display: "flex", gap: 8, marginBottom: 6 }}>
                <input style={{ ...s.input, marginBottom: 0, flex: 1 }} value={nome}
                  onChange={e => setNome(e.target.value)} placeholder="Nome" />
                <input style={{ ...s.input, marginBottom: 0, flex: 1 }} value={cognome}
                  onChange={e => setCognome(e.target.value)} placeholder="Cognome" />
              </div>
              <select style={{ ...s.select, marginBottom: 0 }} value={ruolo} onChange={e => setRuolo(e.target.value)}>
                {roleOptions.map(r => <option key={r} value={r}>{r}</option>)}
              </select>
              {result && <div style={{ ...s.banner(result.ok), marginTop: 6 }}>{result.msg}</div>}
            </>
          ) : (
            <>
              <div style={{ fontSize: "0.82rem", fontWeight: 600, color: "var(--text)", overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
                {u.nome && u.cognome ? `${u.nome} ${u.cognome}` : "—"}
                {isSelf && <span style={{ fontSize: "0.65rem", color: "var(--accent)", marginLeft: 6 }}>(tu)</span>}
              </div>
              <div style={{ fontSize: "0.72rem", color: "var(--text-muted)", overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
                {u.email}
              </div>
              <div style={{ display: "flex", alignItems: "center", gap: 8, marginTop: 4, flexWrap: "wrap" }}>
                {/* Badge ruolo */}
                <span style={{
                  fontSize: "0.65rem", fontWeight: 700, padding: "2px 7px", borderRadius: 20,
                  fontFamily: "'DM Mono', monospace",
                  background: u.is_admin ? "rgba(79,142,247,0.12)" : "var(--surface)",
                  color:      u.is_admin ? "var(--accent)"         : "var(--text-muted)",
                  border:     u.is_admin ? "1px solid rgba(79,142,247,0.3)" : "1px solid var(--border)",
                }}>
                  {u.ruoli?.[0] || "User"}
                </span>

                {/* Colonna "Creato da" — solo per SuperAdmin */}
                {isSuperAdmin && (
                  <span style={{
                    display: "inline-flex", alignItems: "center", gap: 4,
                    fontSize: "0.65rem", color: "var(--text-muted)",
                  }}>
                    <span style={{ opacity: 0.5 }}>creato da</span>
                    <CreatorCell creatorId={u.creato_da} allUsers={allUsers} />
                  </span>
                )}
              </div>
            </>
          )}
        </div>

        {/* Azioni */}
        <div style={{ display: "flex", gap: 6, flexShrink: 0 }}>
          {isProtected ? (
            <span style={{ fontSize: "0.65rem", color: "var(--text-muted)", padding: "4px 8px" }}>—</span>
          ) : editing ? (
            <>
              <button style={{ ...s.btn("success"), padding: "6px 12px", opacity: loading ? 0.5 : 1 }}
                onClick={handleSave} disabled={loading}>✓</button>
              <button style={{ ...s.btn("ghost"), padding: "6px 12px" }}
                onClick={() => { setEditing(false); setResult(null); }}>✕</button>
            </>
          ) : (
            <>
              <button style={{ ...s.btn("ghost"), padding: "6px 10px" }}
                onClick={() => setEditing(true)} title="Modifica">✏️</button>
              {!isSelf && (
                confirmDel ? (
                  <>
                    <button style={{ ...s.btn("danger"), padding: "6px 10px", opacity: loading ? 0.5 : 1 }}
                      onClick={handleDelete} disabled={loading}>Conferma</button>
                    <button style={{ ...s.btn("ghost"), padding: "6px 10px" }}
                      onClick={() => setConfirmDel(false)}>✕</button>
                  </>
                ) : (
                  <button style={{ ...s.btn("ghost"), padding: "6px 10px", color: "#f87171" }}
                    onClick={() => setConfirmDel(true)} title="Elimina">🗑</button>
                )
              )}
            </>
          )}
        </div>
      </div>

      {result && !editing && (
        <div style={{ ...s.banner(result.ok), fontSize: "0.7rem", padding: "4px 8px", marginBottom: 0, marginTop: 8 }}>
          {result.msg}
        </div>
      )}
    </div>
  );
}

// ─────────────────────────────────────────────
// PANEL PRINCIPALE
// ─────────────────────────────────────────────
export default function UserManagementPanel() {
  const { authFetch, user: currentUser, hasPermission } = useAuth();

  const isSuperAdmin = currentUser?.is_superadmin ?? false;

  const [users,      setUsers]      = useState([]);
  const [loading,    setLoading]    = useState(false);
  const [showCreate, setShowCreate] = useState(false);

  const fetchUsers = useCallback(async () => {
    setLoading(true);
    try {
      const res  = await authFetch("/api/v1/auth/users");
      const data = await res.json();
      setUsers(data.users || []);
    } catch (e) { console.error(e); }
    finally { setLoading(false); }
  }, [authFetch]);

  useEffect(() => { fetchUsers(); }, [fetchUsers]);

  const handleUpdated = (updated) =>
    setUsers(prev => prev.map(u => u.utente_id === updated.utente_id ? updated : u));

  const handleDeleted = (id) =>
    setUsers(prev => prev.filter(u => u.utente_id !== id));

  return (
    <div>
      {showCreate && (
        <CreateUserModal
          authFetch={authFetch}
          isSuperAdmin={isSuperAdmin}
          onClose={() => setShowCreate(false)}
          onCreated={(u) => { setUsers(prev => [u, ...prev]); }}
        />
      )}

      {/* Info contestuale per Admin non-Super */}
      {!isSuperAdmin && (
        <div style={{
          padding: "10px 14px", marginBottom: 16,
          background: "rgba(79,142,247,0.07)",
          border: "1px solid rgba(79,142,247,0.2)",
          borderRadius: 8, fontSize: "0.75rem",
          color: "var(--text-muted)", lineHeight: 1.6,
        }}>
          👤 Stai visualizzando solo gli utenti che hai creato tu.
          Puoi creare, modificare ed eliminare solo utenti con ruolo <strong style={{ color: "var(--text)" }}>User</strong>.
        </div>
      )}

      {/* Header */}
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 16 }}>
        <span style={{ fontSize: "0.75rem", color: "var(--text-muted)" }}>
          {users.length} utent{users.length !== 1 ? "i" : "e"}
          {!isSuperAdmin ? " (tuoi)" : ""}
        </span>
        <div style={{ display: "flex", gap: 8 }}>
          <button style={{ ...s.btn("ghost"), fontSize: "0.75rem", padding: "6px 12px" }}
            onClick={fetchUsers}>↻ Aggiorna</button>
          {hasPermission("user_create") && (
            <button style={{ ...s.btn("primary"), fontSize: "0.75rem", padding: "6px 14px" }}
              onClick={() => setShowCreate(true)}>
              ＋ Nuovo {isSuperAdmin ? "utente" : "User"}
            </button>
          )}
        </div>
      </div>

      {/* Lista */}
      {loading ? (
        <div style={{ fontSize: "0.75rem", color: "var(--text-muted)", textAlign: "center", padding: 24 }}>
          Caricamento…
        </div>
      ) : users.length === 0 ? (
        <div style={{ fontSize: "0.75rem", color: "var(--text-muted)", textAlign: "center", padding: 24 }}>
          {isSuperAdmin ? "Nessun utente trovato." : "Non hai ancora creato nessun utente."}
        </div>
      ) : (
        users.map(u => (
          <UserRow
            key={u.utente_id}
            u={u}
            currentUser={currentUser}
            authFetch={authFetch}
            isSuperAdmin={isSuperAdmin}
            allUsers={users}
            onUpdated={handleUpdated}
            onDeleted={handleDeleted}
          />
        ))
      )}
    </div>
  );
}