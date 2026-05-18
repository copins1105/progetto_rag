// // src/pages/ProfilePage.jsx
// import { useState } from "react";
// import { useNavigate } from "react-router-dom";
// import { useAuth } from "../context/AuthContext";

// export default function ProfilePage() {
//   const { user, logout, authFetch } = useAuth();
//   const navigate = useNavigate();

//   const [currentPwd, setCurrentPwd] = useState("");
//   const [newPwd,     setNewPwd]     = useState("");
//   const [confirmPwd, setConfirmPwd] = useState("");
//   const [loading,    setLoading]    = useState(false);
//   const [result,     setResult]     = useState(null); // { ok: bool, msg: string }

//   const handlePasswordChange = async (e) => {
//     e.preventDefault();
//     setResult(null);

//     if (newPwd.length < 8) {
//       setResult({ ok: false, msg: "La nuova password deve essere di almeno 8 caratteri." });
//       return;
//     }
//     if (newPwd !== confirmPwd) {
//       setResult({ ok: false, msg: "Le due password non coincidono." });
//       return;
//     }

//     setLoading(true);
//     try {
//       const res = await authFetch("/api/v1/auth/me/password", {
//         method: "PUT",
//         body: JSON.stringify({ current_password: currentPwd, new_password: newPwd }),
//       });
//       const data = await res.json();
//       if (!res.ok) {
//         setResult({ ok: false, msg: data.detail || "Errore." });
//       } else {
//         setResult({ ok: true, msg: "Password aggiornata con successo." });
//         setCurrentPwd(""); setNewPwd(""); setConfirmPwd("");
//       }
//     } catch (err) {
//       setResult({ ok: false, msg: err.message });
//     } finally {
//       setLoading(false);
//     }
//   };

//   // Stili inline che riusano le CSS var di App.css
//   const card = {
//     background: "var(--surface)", border: "1px solid var(--border-strong)",
//     borderRadius: "16px", padding: "28px 28px 24px", marginBottom: "20px",
//   };
//   const label = {
//     display: "block", fontSize: "0.72rem", fontWeight: 600,
//     color: "var(--text-muted)", textTransform: "uppercase",
//     letterSpacing: "0.06em", marginBottom: "5px",
//   };
//   const input = {
//     width: "100%", padding: "9px 12px", background: "var(--surface2)",
//     border: "1px solid var(--border-strong)", borderRadius: "8px",
//     color: "var(--text)", fontFamily: "inherit", fontSize: "0.85rem",
//     outline: "none", marginBottom: "12px",
//   };
//   const btn = {
//     padding: "10px 20px", background: "var(--accent)", color: "white",
//     border: "none", borderRadius: "8px", cursor: "pointer", fontFamily: "inherit",
//     fontSize: "0.85rem", fontWeight: 600, transition: "opacity 0.2s",
//   };

//   return (
//     <div style={{
//       minHeight: "100vh", background: "var(--bg)",
//       display: "flex", flexDirection: "column", alignItems: "center",
//       padding: "48px 24px",
//     }}>
//       <div style={{ width: "100%", maxWidth: 480 }}>

//         {/* Header */}
//         <div style={{ display: "flex", alignItems: "center", gap: 12, marginBottom: 28 }}>
//           <button
//             onClick={() => navigate("/")}
//             style={{ background: "none", border: "none", cursor: "pointer", color: "var(--text-muted)", fontSize: "0.82rem" }}
//           >
//             ← Chat
//           </button>
//           <span style={{ fontSize: "0.72rem", color: "var(--border-strong)" }}>|</span>
//           <span style={{ fontSize: "0.88rem", fontWeight: 600, color: "var(--text)" }}>
//             Il mio profilo
//           </span>
//         </div>

//         {/* Info utente */}
//         <div style={card}>
//           <div style={{ display: "flex", alignItems: "center", gap: 14, marginBottom: 20 }}>
//             <div style={{
//               width: 48, height: 48, borderRadius: "50%",
//               background: "var(--accent-dim)", border: "1px solid var(--accent-glow)",
//               display: "flex", alignItems: "center", justifyContent: "center",
//               fontSize: "1.2rem",
//             }}>
//               👤
//             </div>
//             <div>
//               <div style={{ fontSize: "0.95rem", fontWeight: 600, color: "var(--text)" }}>
//                 {user?.nome && user?.cognome ? `${user.nome} ${user.cognome}` : user?.email}
//               </div>
//               <div style={{ fontSize: "0.75rem", color: "var(--text-muted)", marginTop: 2 }}>
//                 {user?.email}
//               </div>
//             </div>
//           </div>

//           <div style={{ display: "flex", gap: 6, flexWrap: "wrap" }}>
//             {(user?.ruoli || []).map(r => (
//               <span key={r} style={{
//                 fontSize: "0.68rem", fontWeight: 700, padding: "2px 8px",
//                 borderRadius: 20, fontFamily: "'DM Mono', monospace",
//                 background: r === "Admin" ? "rgba(79,142,247,0.12)" : "var(--surface2)",
//                 color:      r === "Admin" ? "var(--accent)"         : "var(--text-muted)",
//                 border:     r === "Admin" ? "1px solid rgba(79,142,247,0.3)" : "1px solid var(--border)",
//               }}>
//                 {r}
//               </span>
//             ))}
//           </div>
//         </div>

//         {/* Cambio password */}
//         <div style={card}>
//           <h3 style={{ fontSize: "0.88rem", fontWeight: 600, color: "var(--text)", marginBottom: 20 }}>
//             Cambia password
//           </h3>

//           <form onSubmit={handlePasswordChange} noValidate>
//             <label style={label}>Password attuale</label>
//             <input style={input} type="password" value={currentPwd}
//               onChange={e => setCurrentPwd(e.target.value)} disabled={loading} required />

//             <label style={label}>Nuova password</label>
//             <input style={input} type="password" value={newPwd}
//               onChange={e => setNewPwd(e.target.value)} disabled={loading}
//               placeholder="Min. 8 caratteri" required />

//             <label style={label}>Conferma nuova password</label>
//             <input style={{ ...input, marginBottom: 16 }} type="password" value={confirmPwd}
//               onChange={e => setConfirmPwd(e.target.value)} disabled={loading} required />

//             {result && (
//               <div style={{
//                 padding: "9px 12px", borderRadius: "6px", fontSize: "0.8rem",
//                 marginBottom: 12,
//                 background: result.ok ? "rgba(52,211,153,0.1)" : "rgba(239,68,68,0.1)",
//                 border:     result.ok ? "1px solid rgba(52,211,153,0.3)" : "1px solid rgba(239,68,68,0.3)",
//                 color:      result.ok ? "#34d399" : "#f87171",
//               }}>
//                 {result.ok ? "✓" : "⚠"} {result.msg}
//               </div>
//             )}

//             <button type="submit" style={{ ...btn, opacity: loading ? 0.5 : 1 }} disabled={loading}>
//               {loading ? "Salvataggio…" : "Salva nuova password"}
//             </button>
//           </form>
//         </div>

//         {/* Logout */}
//         <button
//           onClick={() => { logout(); navigate("/"); }}
//           style={{
//             ...btn, background: "rgba(239,68,68,0.1)",
//             color: "#f87171", border: "1px solid rgba(239,68,68,0.2)",
//           }}
//         >
//           Esci dall'account
//         </button>
//       </div>
//     </div>
//   );
// }


// src/pages/ProfilePage.jsx — RESPONSIVE
import { useState } from "react";
import { useNavigate } from "react-router-dom";
import { useAuth } from "../context/AuthContext";

export default function ProfilePage() {
  const { user, logout, authFetch } = useAuth();
  const navigate = useNavigate();

  const [currentPwd, setCurrentPwd] = useState("");
  const [newPwd,     setNewPwd]     = useState("");
  const [confirmPwd, setConfirmPwd] = useState("");
  const [loading,    setLoading]    = useState(false);
  const [result,     setResult]     = useState(null);

  const handlePasswordChange = async (e) => {
    e.preventDefault();
    setResult(null);
    if (newPwd.length < 8) {
      setResult({ ok: false, msg: "La nuova password deve essere di almeno 8 caratteri." });
      return;
    }
    if (newPwd !== confirmPwd) {
      setResult({ ok: false, msg: "Le due password non coincidono." });
      return;
    }
    setLoading(true);
    try {
      const res = await authFetch("/api/v1/auth/me/password", {
        method: "PUT",
        body: JSON.stringify({ current_password: currentPwd, new_password: newPwd }),
      });
      const data = await res.json();
      if (!res.ok) {
        setResult({ ok: false, msg: data.detail || "Errore." });
      } else {
        setResult({ ok: true, msg: "Password aggiornata con successo." });
        setCurrentPwd(""); setNewPwd(""); setConfirmPwd("");
      }
    } catch (err) {
      setResult({ ok: false, msg: err.message });
    } finally {
      setLoading(false);
    }
  };

  return (
    <>
      {/* Inline responsive styles */}
      <style>{`
        .profile-page-outer {
          min-height: 100vh;
          background: var(--bg);
          display: flex;
          flex-direction: column;
          align-items: center;
          padding: 48px 24px 60px;
          overflow-y: auto;
        }
        .profile-page-inner {
          width: 100%;
          max-width: 480px;
        }
        .profile-card {
          background: var(--surface);
          border: 1px solid var(--border-strong);
          border-radius: 16px;
          padding: 28px;
          margin-bottom: 20px;
        }
        .profile-input {
          width: 100%;
          padding: 9px 12px;
          background: var(--surface2);
          border: 1px solid var(--border-strong);
          border-radius: 8px;
          color: var(--text);
          font-family: inherit;
          font-size: 0.85rem;
          outline: none;
          margin-bottom: 12px;
          box-sizing: border-box;
          transition: border-color 0.2s, box-shadow 0.2s;
        }
        .profile-input:focus {
          border-color: var(--accent-light);
          box-shadow: 0 0 0 3px var(--accent-glow);
        }
        .profile-label {
          display: block;
          font-size: 0.72rem;
          font-weight: 600;
          color: var(--text-muted);
          text-transform: uppercase;
          letter-spacing: 0.06em;
          margin-bottom: 5px;
        }
        .profile-btn-primary {
          padding: 10px 20px;
          background: var(--accent);
          color: white;
          border: none;
          border-radius: 8px;
          cursor: pointer;
          font-family: inherit;
          font-size: 0.85rem;
          font-weight: 600;
          transition: opacity 0.2s;
        }
        .profile-btn-danger {
          padding: 10px 20px;
          background: rgba(239,68,68,0.1);
          color: #f87171;
          border: 1px solid rgba(239,68,68,0.2);
          border-radius: 8px;
          cursor: pointer;
          font-family: inherit;
          font-size: 0.85rem;
          font-weight: 600;
          width: 100%;
          transition: background 0.2s;
        }
        .profile-btn-danger:hover {
          background: rgba(239,68,68,0.18);
        }
        .profile-banner {
          padding: 9px 12px;
          border-radius: 6px;
          font-size: 0.8rem;
          margin-bottom: 12px;
        }
        .profile-role-badge {
          font-size: 0.68rem;
          font-weight: 700;
          padding: 2px 8px;
          border-radius: 20px;
          font-family: 'JetBrains Mono', monospace;
        }
        @media (max-width: 480px) {
          .profile-page-outer {
            padding: 0;
            align-items: stretch;
          }
          .profile-page-inner {
            max-width: 100%;
            padding: 0;
          }
          .profile-card {
            border-radius: 0;
            border-left: none;
            border-right: none;
            padding: 20px 16px;
            margin-bottom: 8px;
          }
          .profile-header-bar {
            padding: 14px 16px !important;
            position: sticky;
            top: 0;
            z-index: 10;
            background: var(--surface);
            border-bottom: 1px solid var(--border);
          }
        }
        @media (min-width: 481px) and (max-width: 767px) {
          .profile-page-outer {
            padding: 24px 16px 40px;
          }
          .profile-card {
            padding: 20px;
          }
        }
      `}</style>

      <div className="profile-page-outer">
        <div className="profile-page-inner">

          {/* Header */}
          <div className="profile-header-bar" style={{
            display: "flex", alignItems: "center", gap: 12, marginBottom: 28,
          }}>
            <button
              onClick={() => navigate("/")}
              style={{
                background: "none", border: "1px solid var(--border-strong)",
                borderRadius: 6, cursor: "pointer", color: "var(--text-muted)",
                fontSize: "0.82rem", padding: "5px 12px", fontFamily: "inherit",
                display: "flex", alignItems: "center", gap: 5,
              }}
            >
              ← Chat
            </button>
            <span style={{ fontSize: "0.72rem", color: "var(--border-strong)" }}>|</span>
            <span style={{ fontSize: "0.88rem", fontWeight: 600, color: "var(--text)" }}>
              Il mio profilo
            </span>
          </div>

          {/* Info utente */}
          <div className="profile-card">
            <div style={{ display: "flex", alignItems: "center", gap: 14, marginBottom: 20 }}>
              <div style={{
                width: 48, height: 48, borderRadius: "50%",
                background: "var(--accent-dim)", border: "1px solid var(--accent-glow)",
                display: "flex", alignItems: "center", justifyContent: "center",
                fontSize: "1.2rem", flexShrink: 0,
              }}>
                👤
              </div>
              <div style={{ minWidth: 0 }}>
                <div style={{
                  fontSize: "0.95rem", fontWeight: 600, color: "var(--text)",
                  overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap",
                }}>
                  {user?.nome && user?.cognome ? `${user.nome} ${user.cognome}` : user?.email}
                </div>
                <div style={{
                  fontSize: "0.75rem", color: "var(--text-muted)", marginTop: 2,
                  overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap",
                }}>
                  {user?.email}
                </div>
              </div>
            </div>

            <div style={{ display: "flex", gap: 6, flexWrap: "wrap" }}>
              {(user?.ruoli || []).map(r => (
                <span key={r} className="profile-role-badge" style={{
                  background: r === "Admin" ? "rgba(79,142,247,0.12)" : "var(--surface2)",
                  color:      r === "Admin" ? "var(--accent)"         : "var(--text-muted)",
                  border:     r === "Admin" ? "1px solid rgba(79,142,247,0.3)" : "1px solid var(--border)",
                }}>
                  {r}
                </span>
              ))}
            </div>
          </div>

          {/* Cambio password */}
          <div className="profile-card">
            <h3 style={{
              fontSize: "0.88rem", fontWeight: 600, color: "var(--text)", marginBottom: 20,
            }}>
              Cambia password
            </h3>

            <form onSubmit={handlePasswordChange} noValidate>
              <label className="profile-label">Password attuale</label>
              <input
                className="profile-input"
                type="password" value={currentPwd}
                onChange={e => setCurrentPwd(e.target.value)}
                disabled={loading} required
              />

              <label className="profile-label">Nuova password</label>
              <input
                className="profile-input"
                type="password" value={newPwd}
                onChange={e => setNewPwd(e.target.value)}
                disabled={loading} placeholder="Min. 8 caratteri" required
              />

              <label className="profile-label">Conferma nuova password</label>
              <input
                className="profile-input"
                style={{ marginBottom: 16 }}
                type="password" value={confirmPwd}
                onChange={e => setConfirmPwd(e.target.value)}
                disabled={loading} required
              />

              {result && (
                <div className="profile-banner" style={{
                  background: result.ok ? "rgba(52,211,153,0.1)" : "rgba(239,68,68,0.1)",
                  border:     result.ok ? "1px solid rgba(52,211,153,0.3)" : "1px solid rgba(239,68,68,0.3)",
                  color:      result.ok ? "#34d399" : "#f87171",
                }}>
                  {result.ok ? "✓" : "⚠"} {result.msg}
                </div>
              )}

              <button
                type="submit"
                className="profile-btn-primary"
                style={{ opacity: loading ? 0.5 : 1 }}
                disabled={loading}
              >
                {loading ? "Salvataggio…" : "Salva nuova password"}
              </button>
            </form>
          </div>

          {/* Logout */}
          <button
            className="profile-btn-danger"
            onClick={() => { logout(); navigate("/"); }}
          >
            Esci dall'account
          </button>

        </div>
      </div>
    </>
  );
}