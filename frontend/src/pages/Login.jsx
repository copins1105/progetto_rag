// src/pages/Login.jsx
import { useState } from "react";
import { useAuth } from "../context/AuthContext";
import "../App.css";

export default function Login() {
  const { login } = useAuth();
  const [email,    setEmail]    = useState("");
  const [password, setPassword] = useState("");
  const [error,    setError]    = useState("");
  const [loading,  setLoading]  = useState(false);

  const handleSubmit = async (e) => {
    e.preventDefault();
    setError("");

    if (!email.trim() || !password) {
      setError("Inserisci email e password.");
      return;
    }

    setLoading(true);
    try {
      await login(email.trim(), password);
      // Login OK → AuthContext aggiorna `user` → App.jsx mostra la chat
    } catch (err) {
      setError(err.message || "Credenziali non valide.");
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="login-wrapper">
      <div className="login-box">
        <div style={{ fontSize: "1.6rem", marginBottom: "8px" }}>⚡</div>
        <h2>Policy Navigator</h2>
        <p className="login-subtitle">Accedi per consultare le policy aziendali</p>

        <form onSubmit={handleSubmit} noValidate>
          <input
            type="email"
            placeholder="Email aziendale"
            value={email}
            onChange={(e) => setEmail(e.target.value)}
            disabled={loading}
            autoComplete="username"
            required
          />
          <input
            type="password"
            placeholder="Password"
            value={password}
            onChange={(e) => setPassword(e.target.value)}
            disabled={loading}
            autoComplete="current-password"
            required
          />

          {/* Messaggio errore */}
          {error && (
            <div style={{
              background: "rgba(239,68,68,0.1)",
              border: "1px solid rgba(239,68,68,0.3)",
              borderRadius: "6px",
              padding: "9px 12px",
              marginBottom: "10px",
              fontSize: "0.8rem",
              color: "#f87171",
              display: "flex",
              alignItems: "center",
              gap: "7px",
            }}>
              <span>⚠</span> {error}
            </div>
          )}

          <button type="submit" disabled={loading}>
            {loading ? "Accesso in corso…" : "Accedi"}
          </button>
        </form>
      </div>
    </div>
  );
}
