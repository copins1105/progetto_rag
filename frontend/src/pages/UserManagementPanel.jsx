// src/pages/UserManagementPanel.jsx
// Da integrare come tab nel tuo AdminPanel esistente.
// Mostra la lista utenti con possibilità di creare, modificare ed eliminare.

import { useState, useEffect, useCallback } from "react";
import { useAuth } from "../context/AuthContext";

const ROLE_OPTIONS = ["Admin", "User"];

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
    display: "flex", alignItems: "center", gap: 12,
  },
  avatar: {
    width: 36, height: 36, borderRadius: "50%",
    background: "var(--accent-dim)", border: "1px solid var(--accent-glow)",
    display: "flex", alignItems: "center", justifyContent: "center",
    fontSize: "0.9rem", flexShrink: 0,
  },
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
function CreateUserModal({ onClose, onCreated, authFetch }) {
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
            {ROLE_OPTIONS.map(r => <option key={r} value={r}>{r}</option>)}
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
// RIGA UTENTE
// ─────────────────────────────────────────────
function UserRow({ u, currentUser, authFetch, onUpdated, onDeleted }) {
  const [editing,  setEditing]  = useState(false);
  const [nome,     setNome]     = useState(u.nome     || "");
  const [cognome,  setCognome]  = useState(u.cognome  || "");
  const [ruolo,    setRuolo]    = useState(u.ruoli?.[0] || "User");
  const [loading,  setLoading]  = useState(false);
  const [result,   setResult]   = useState(null);
  const [confirmDel, setConfirmDel] = useState(false);

  const isSelf = currentUser?.utente_id === u.utente_id;

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
      await authFetch(`/api/v1/auth/users/${u.utente_id}`, { method: "DELETE" });
      onDeleted(u.utente_id);
    } catch (err) {
      setResult({ ok: false, msg: err.message });
    } finally {
      setLoading(false); setConfirmDel(false);
    }
  };

  return (
    <div style={s.card}>
      {/* Avatar */}
      <div style={s.avatar}>👤</div>

      {/* Info */}
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
              {ROLE_OPTIONS.map(r => <option key={r} value={r}>{r}</option>)}
            </select>
            {result && <div style={{ ...s.banner(result.ok), marginTop: 6 }}>{result.msg}</div>}
          </>
        ) : (
          <>
            <div style={{ fontSize: "0.82rem", fontWeight: 600, color: "var(--text)", overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
              {u.nome && u.cognome ? `${u.nome} ${u.cognome}` : "—"}
              {isSelf && <span style={{ fontSize: "0.65rem", color: "var(--accent)", marginLeft: 6 }}>(tu)</span>}
            </div>
            <div style={{ fontSize: "0.72rem", color: "var(--text-muted)", overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{u.email}</div>
            <span style={{
              display: "inline-block", marginTop: 4,
              fontSize: "0.65rem", fontWeight: 700, padding: "2px 7px", borderRadius: 20,
              fontFamily: "'DM Mono', monospace",
              background: u.is_admin ? "rgba(79,142,247,0.12)" : "var(--surface)",
              color:      u.is_admin ? "var(--accent)"         : "var(--text-muted)",
              border:     u.is_admin ? "1px solid rgba(79,142,247,0.3)" : "1px solid var(--border)",
            }}>
              {u.ruoli?.[0] || "User"}
            </span>
          </>
        )}
      </div>

      {/* Azioni */}
      <div style={{ display: "flex", gap: 6, flexShrink: 0 }}>
        {editing ? (
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
  );
}

// ─────────────────────────────────────────────
// PANEL PRINCIPALE
// ─────────────────────────────────────────────
export default function UserManagementPanel() {
  const { authFetch, user: currentUser } = useAuth();
  const [users,       setUsers]       = useState([]);
  const [loading,     setLoading]     = useState(false);
  const [showCreate,  setShowCreate]  = useState(false);

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
          onClose={() => setShowCreate(false)}
          onCreated={(u) => { setUsers(prev => [u, ...prev]); }}
        />
      )}

      {/* Header */}
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 16 }}>
        <span style={{ fontSize: "0.75rem", color: "var(--text-muted)" }}>
          {users.length} utent{users.length !== 1 ? "i" : "e"}
        </span>
        <div style={{ display: "flex", gap: 8 }}>
          <button style={{ ...s.btn("ghost"), fontSize: "0.75rem", padding: "6px 12px" }}
            onClick={fetchUsers}>↻ Aggiorna</button>
          <button style={{ ...s.btn("primary"), fontSize: "0.75rem", padding: "6px 14px" }}
            onClick={() => setShowCreate(true)}>＋ Nuovo utente</button>
        </div>
      </div>

      {/* Lista */}
      {loading ? (
        <div style={{ fontSize: "0.75rem", color: "var(--text-muted)", textAlign: "center", padding: 24 }}>
          Caricamento…
        </div>
      ) : users.length === 0 ? (
        <div style={{ fontSize: "0.75rem", color: "var(--text-muted)", textAlign: "center", padding: 24 }}>
          Nessun utente trovato.
        </div>
      ) : (
        users.map(u => (
          <UserRow
            key={u.utente_id}
            u={u}
            currentUser={currentUser}
            authFetch={authFetch}
            onUpdated={handleUpdated}
            onDeleted={handleDeleted}
          />
        ))
      )}
    </div>
  );
}
