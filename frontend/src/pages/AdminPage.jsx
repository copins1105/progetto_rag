// src/pages/AdminPage.jsx
import { useNavigate } from 'react-router-dom'
import AdminPanel from './AdminPanel'

function AdminPage() {
  const navigate = useNavigate()

  return (
    <div style={{ display: 'flex', flexDirection: 'column', height: '100vh' }}>
      
      {/* Topbar */}
      <div className="admin-topbar">
        <div style={{ display: 'flex', alignItems: 'center', gap: '10px' }}>
          <div className="sidebar-brand-icon">⚡</div>
          <span className="sidebar-brand-name">Policy Navigator</span>
          <span className="admin-topbar-badge">Admin</span>
        </div>
        <button
          className="back-to-chat-btn"
          onClick={() => navigate('/')}
        >
          ← Torna alla chat
        </button>
      </div>

      {/* Pannello admin occupa tutto lo spazio rimanente */}
      <div style={{ flex: 1, overflow: 'hidden', minHeight: 0 }}>
        <AdminPanel />
      </div>
    </div>
  )
}

export default AdminPage
