// import { useState } from "react";
// import { useAuth } from "../context/AuthContext";
// import "../App.css";
// import logo from "../assets/Logo Exprivia pulito.png";

// export default function Login() {
//   const { login } = useAuth();
//   const [email,    setEmail]    = useState("");
//   const [password, setPassword] = useState("");
//   const [error,    setError]    = useState("");
//   const [loading,  setLoading]  = useState(false);

//   const handleSubmit = async (e) => {
//     e.preventDefault();
//     setError("");

//     if (!email.trim() || !password) {
//       setError("Inserisci email e password.");
//       return;
//     }

//     setLoading(true);
//     try {
//       await login(email.trim(), password);
//     } catch (err) {
//       setError(err.message || "Credenziali non valide.");
//     } finally {
//       setLoading(false);
//     }
//   };

//   return (
//     <div className="login-wrapper">
//       <div className="login-box">

//         {/* Logo Exprivia centrato in cima alla card */}
//         <div className="login-logo-area">
//           <img
//             src={logo}
//             alt="Exprivia"
//             className="exprivia-logo-login"
//           />
//           <div className="login-logo-divider" />
//         </div>

//         <h2>Policy Navigator</h2>
//         <p className="login-subtitle">Accedi per consultare le policy aziendali</p>

//         <form onSubmit={handleSubmit} noValidate>
//           <input
//             type="email"
//             placeholder="Email aziendale"
//             value={email}
//             onChange={(e) => setEmail(e.target.value)}
//             disabled={loading}
//             autoComplete="username"
//             required
//           />
//           <input
//             type="password"
//             placeholder="Password"
//             value={password}
//             onChange={(e) => setPassword(e.target.value)}
//             disabled={loading}
//             autoComplete="current-password"
//             required
//           />

//           {error && (
//             <div style={{
//               background: "var(--red-dim)",
//               border: "1px solid rgba(224,90,90,0.30)",
//               borderRadius: "6px",
//               padding: "9px 12px",
//               marginBottom: "10px",
//               fontSize: "0.8rem",
//               color: "var(--red)",
//               display: "flex",
//               alignItems: "center",
//               gap: "7px",
//             }}>
//               <span>⚠</span> {error}
//             </div>
//           )}

//           <button type="submit" disabled={loading}>
//             {loading ? "Accesso in corso…" : "Accedi"}
//           </button>
//         </form>
//       </div>
//     </div>
//   );
// }

// src/pages/Login.jsx
// ADDED: robot logo icon next to "Policy Navigator" heading, theme-aware

// src/pages/Login.jsx
// ADDED: robot logo icon next to "Policy Navigator" heading, theme-aware

import { useState } from "react";
import { useAuth } from "../context/AuthContext";
import "../App.css";
import logo from "../assets/Logo Exprivia pulito.png";
import robotLogo from "../assets/Logo.png";

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
    } catch (err) {
      setError(err.message || "Credenziali non valide.");
    } finally {
      setLoading(false);
    }
  };

  // Sostituisci il contenuto del return in Login.jsx

return (
  <div className="login-wrapper">
    <div className="login-box">

      {/* 1. Robot logo — grande, in cima */}
      <div style={{
        display: 'flex',
        justifyContent: 'center',
        marginBottom: '-100px',
        marginTop: '-10px',
      }}>
        <img
          src={robotLogo}
          alt="Policy Navigator"
          style={{
            width: 200,
            height: 200,
            objectFit: 'contain',
            display: 'block',
          }}
        />
      </div>

      {/* 2. Logo Exprivia — piccolo, subito sotto */}
      <div style={{
        display: 'flex',
        justifyContent: 'center',
        marginBottom: '-30px',
      }}>
        <img
          src={logo}
          alt="Exprivia"
          style={{
            height: '130px',
            width: 'auto',
            display: 'block',
          }}
        />
      </div>

      {/* 3. Policy Navigator */}
      <h2 style={{
        textAlign: 'center',
        margin: '0 0 4px 0',
        fontSize: '1.4rem',
        fontWeight: 700,
        letterSpacing: '-0.025em',
        color: 'var(--text)',
      }}>
        Policy Navigator
      </h2>

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

        {error && (
          <div style={{
            background: "var(--red-dim)",
            border: "1px solid rgba(224,90,90,0.30)",
            borderRadius: "6px",
            padding: "9px 12px",
            marginBottom: "10px",
            fontSize: "0.8rem",
            color: "var(--red)",
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
)
}