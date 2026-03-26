// src/pages/Login.jsx
import '../App.css'
function Login({ onLogin }) {
  const handleSubmit = (e) => {
    e.preventDefault()
    onLogin()
  }

  return (
    <div className="login-wrapper">
      <div className="login-box">
        <div style={{ fontSize: '1.6rem', marginBottom: '8px' }}>⚡</div>
        <h2>Policy Navigator</h2>
        <p className="login-subtitle">Accedi per consultare le policy aziendali</p>
        <form onSubmit={handleSubmit}>
          <input
            type="text"
            placeholder="Username"
            required
            autoComplete="username"
          />
          <input
            type="password"
            placeholder="Password"
            required
            autoComplete="current-password"
          />
          <button type="submit">Accedi</button>
        </form>
      </div>
    </div>
  )
}

export default Login
