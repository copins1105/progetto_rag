// import { useState } from 'react'
// import { useNavigate } from 'react-router-dom'
// import { useAuth } from '../context/AuthContext'
// import AdminPanel            from './AdminPanel'
// import UserManagementPanel   from './UserManagementPanel'
// import ActivityLogPanel      from './ActivityLogPanel'
// import PermissionMatrixPanel from './PermissionMatrixPanel'
// import logo from '../assets/Logo Exprivia pulito.png'

// // ─── Icone SVG inline ─────────────────────────────────────────
// const Icon = {
//   docs: (
//     <svg width="14" height="14" viewBox="0 0 24 24" fill="none"
//       stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
//       <path d="M14 2H6a2 2 0 00-2 2v16a2 2 0 002 2h12a2 2 0 002-2V8z"/>
//       <polyline points="14 2 14 8 20 8"/>
//     </svg>
//   ),
//   users: (
//     <svg width="14" height="14" viewBox="0 0 24 24" fill="none"
//       stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
//       <path d="M17 21v-2a4 4 0 00-4-4H5a4 4 0 00-4 4v2"/>
//       <circle cx="9" cy="7" r="4"/>
//       <path d="M23 21v-2a4 4 0 00-3-3.87M16 3.13a4 4 0 010 7.75"/>
//     </svg>
//   ),
//   log: (
//     <svg width="14" height="14" viewBox="0 0 24 24" fill="none"
//       stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
//       <polyline points="22 12 18 12 15 21 9 3 6 12 2 12"/>
//     </svg>
//   ),
//   permissions: (
//     <svg width="14" height="14" viewBox="0 0 24 24" fill="none"
//       stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
//       <rect x="3" y="11" width="18" height="11" rx="2" ry="2"/>
//       <path d="M7 11V7a5 5 0 0110 0v4"/>
//     </svg>
//   ),
//   back: (
//     <svg width="13" height="13" viewBox="0 0 24 24" fill="none"
//       stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
//       <polyline points="15 18 9 12 15 6"/>
//     </svg>
//   ),
// }

// // ─── Definizione sezioni ──────────────────────────────────────
// const SECTIONS = [
//   { id: 'docs',        label: 'Documenti', icon: Icon.docs,        perm: 'tab_ingestion' },
//   { id: 'users',       label: 'Utenti',    icon: Icon.users,       perm: 'tab_users' },
//   { id: 'log',         label: 'Log',       icon: Icon.log,         perm: 'tab_log' },
//   { id: 'permissions', label: 'Permessi',  icon: Icon.permissions, perm: 'tab_permissions' },
// ]

// export default function AdminPage() {
//   const navigate = useNavigate()
//   const { user, hasPermission } = useAuth()

//   const visibleSections = SECTIONS.filter(s => !s.perm || hasPermission(s.perm))

//   const [activeSection, setActiveSection] = useState(
//     visibleSections[0]?.id ?? 'docs'
//   )

//   const activeLabel = SECTIONS.find(s => s.id === activeSection)?.label ?? ''

//   return (
//     <div style={{
//       display: 'flex',
//       flexDirection: 'column',
//       height: '100vh',
//       width: '100vw',
//       background: 'var(--bg)',
//       color: 'var(--text)',
//       fontFamily: "'Plus Jakarta Sans', sans-serif",
//       overflow: 'hidden',
//     }}>

//       {/* ══ TOPBAR ══ */}
//       <header style={{
//         display: 'flex',
//         alignItems: 'center',
//         padding: '0 20px',
//         height: 54,
//         background: 'var(--surface)',
//         borderBottom: '1px solid var(--border-strong)',
//         flexShrink: 0,
//         gap: 0,
//         position: 'relative',
//         zIndex: 20,
//         boxShadow: 'var(--shadow-sm)',
//       }}>

//         {/* Brand con logo Exprivia */}
//         <div className="admin-topbar-left" style={{
//           paddingRight: 20,
//           borderRight: '1px solid var(--border-strong)',
//           marginRight: 8,
//           flexShrink: 0,
//         }}>
//           <img
//             src={logo}
//             alt="Exprivia"
//             className="exprivia-logo-topbar"
//           />
//           <div className="admin-topbar-separator" />
//           <span style={{
//             fontSize: '0.84rem', fontWeight: 700,
//             color: 'var(--text)', letterSpacing: '-0.01em',
//           }}>
//             Policy Navigator
//           </span>
//           <span className="admin-topbar-badge">Admin</span>
//         </div>

//         {/* Nav tabs */}
//         <nav style={{ display: 'flex', alignItems: 'stretch', flex: 1, height: '100%' }}>
//           {visibleSections.map(sec => {
//             const isActive = activeSection === sec.id
//             return (
//               <button
//                 key={sec.id}
//                 onClick={() => setActiveSection(sec.id)}
//                 style={{
//                   display: 'flex', alignItems: 'center', gap: 7,
//                   padding: '0 18px',
//                   background: 'none',
//                   border: 'none',
//                   borderBottom: isActive
//                     ? '2px solid var(--accent)'
//                     : '2px solid transparent',
//                   color: isActive ? 'var(--text)' : 'var(--text-muted)',
//                   cursor: 'pointer',
//                   fontFamily: 'inherit',
//                   fontSize: '0.82rem',
//                   fontWeight: isActive ? 600 : 400,
//                   transition: 'color 0.15s, border-color 0.15s',
//                   whiteSpace: 'nowrap',
//                   borderRadius: 0,
//                 }}
//               >
//                 <span style={{ opacity: isActive ? 1 : 0.6 }}>{sec.icon}</span>
//                 {sec.label}
//               </button>
//             )
//           })}
//         </nav>

//         {/* Right: user + back */}
//         <div style={{ display: 'flex', alignItems: 'center', gap: 10, flexShrink: 0, paddingLeft: 12 }}>
//           {user && (
//             <div style={{
//               fontSize: '0.72rem', color: 'var(--text-muted)',
//               fontFamily: "'JetBrains Mono', monospace",
//               maxWidth: 160, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap',
//             }}>
//               {user.nome ? `${user.nome} ${user.cognome || ''}`.trim() : user.email}
//             </div>
//           )}
//           <button
//             onClick={() => navigate('/')}
//             className="back-to-chat-btn"
//             style={{ display: 'flex', alignItems: 'center', gap: 5 }}
//           >
//             {Icon.back} Chat
//           </button>
//         </div>
//       </header>

//       {/* ══ BREADCRUMB ══ */}
//       <div style={{
//         display: 'flex', alignItems: 'center', gap: 8,
//         padding: '0 20px',
//         height: 34,
//         background: 'var(--surface2)',
//         borderBottom: '1px solid var(--border)',
//         flexShrink: 0,
//       }}>
//         <span style={{ fontSize: '0.65rem', color: 'var(--text-muted)', fontFamily: "'JetBrains Mono', monospace" }}>
//           admin
//         </span>
//         <span style={{ fontSize: '0.65rem', color: 'var(--border-strong)' }}>›</span>
//         <span style={{ fontSize: '0.72rem', color: 'var(--text)', fontWeight: 600 }}>
//           {activeLabel}
//         </span>
//       </div>

//       {/* ══ CONTENT AREA ══ */}
//       <main style={{ flex: 1, overflow: 'hidden', minHeight: 0 }}>

//         {/* Documenti */}
//         <div style={{
//           display: activeSection === 'docs' ? 'flex' : 'none',
//           flex: 1,
//           overflow: 'hidden',
//           minHeight: 0,
//           height: '100%',
//         }}>
//           <AdminPanel />
//         </div>

//         {/* Utenti */}
//         {activeSection === 'users' && (
//           <FullPageSection>
//             <UserManagementPanel />
//           </FullPageSection>
//         )}

//         {/* Log */}
//         {activeSection === 'log' && (
//           <FullPageSection noPadding>
//             <ActivityLogPanel />
//           </FullPageSection>
//         )}

//         {/* Permessi */}
//         {activeSection === 'permissions' && (
//           <FullPageSection noPadding>
//             <PermissionMatrixPanel />
//           </FullPageSection>
//         )}
//       </main>
//     </div>
//   )
// }

// // ─── Wrapper sezioni a pagina piena ────────────────────────────
// function FullPageSection({ children, noPadding = false }) {
//   return (
//     <div style={{
//       display: 'flex',
//       flexDirection: 'column',
//       height: '100%',
//       overflow: 'hidden',
//     }}>
//       <div style={{
//         flex: 1,
//         overflow: noPadding ? 'hidden' : 'auto',
//         padding: noPadding ? 0 : '24px 32px',
//         display: noPadding ? 'flex' : 'block',
//         flexDirection: noPadding ? 'column' : undefined,
//         minHeight: 0,
//       }}>
//         {children}
//       </div>
//     </div>
//   )
// }


// src/pages/AdminPage.jsx
// Aggiunta tab "Ownership" visibile solo al SuperAdmin.

// src/pages/AdminPage.jsx
// Layout admin: navbar orizzontale con logo Exprivia in topbar.
// Documenti | Utenti | Log | Permessi

import { useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { useAuth } from '../context/AuthContext'
import AdminPanel            from './AdminPanel'
import UserManagementPanel   from './UserManagementPanel'
import ActivityLogPanel      from './ActivityLogPanel'
import PermissionMatrixPanel from './PermissionMatrixPanel'
import logo from '../assets/Logo Exprivia pulito.png'

// ─── Icone SVG inline ─────────────────────────────────────────
const Icon = {
  docs: (
    <svg width="14" height="14" viewBox="0 0 24 24" fill="none"
      stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      <path d="M14 2H6a2 2 0 00-2 2v16a2 2 0 002 2h12a2 2 0 002-2V8z"/>
      <polyline points="14 2 14 8 20 8"/>
    </svg>
  ),
  users: (
    <svg width="14" height="14" viewBox="0 0 24 24" fill="none"
      stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      <path d="M17 21v-2a4 4 0 00-4-4H5a4 4 0 00-4 4v2"/>
      <circle cx="9" cy="7" r="4"/>
      <path d="M23 21v-2a4 4 0 00-3-3.87M16 3.13a4 4 0 010 7.75"/>
    </svg>
  ),
  log: (
    <svg width="14" height="14" viewBox="0 0 24 24" fill="none"
      stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      <polyline points="22 12 18 12 15 21 9 3 6 12 2 12"/>
    </svg>
  ),
  permissions: (
    <svg width="14" height="14" viewBox="0 0 24 24" fill="none"
      stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      <rect x="3" y="11" width="18" height="11" rx="2" ry="2"/>
      <path d="M7 11V7a5 5 0 0110 0v4"/>
    </svg>
  ),
  back: (
    <svg width="13" height="13" viewBox="0 0 24 24" fill="none"
      stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      <polyline points="15 18 9 12 15 6"/>
    </svg>
  ),
}

// ─── Definizione sezioni ──────────────────────────────────────
const SECTIONS = [
  { id: 'docs',        label: 'Documenti', icon: Icon.docs,        perm: 'tab_ingestion' },
  { id: 'users',       label: 'Utenti',    icon: Icon.users,       perm: 'tab_users' },
  { id: 'log',         label: 'Log',       icon: Icon.log,         perm: 'tab_log' },
  { id: 'permissions', label: 'Permessi',  icon: Icon.permissions, perm: 'tab_permissions' },
]

export default function AdminPage() {
  const navigate = useNavigate()
  const { user, hasPermission } = useAuth()

  const visibleSections = SECTIONS.filter(s => !s.perm || hasPermission(s.perm))

  const [activeSection, setActiveSection] = useState(
    visibleSections[0]?.id ?? 'docs'
  )

  const activeLabel = SECTIONS.find(s => s.id === activeSection)?.label ?? ''

  return (
    <div style={{
      display: 'flex',
      flexDirection: 'column',
      height: '100vh',
      width: '100vw',
      background: 'var(--bg)',
      color: 'var(--text)',
      fontFamily: "'Plus Jakarta Sans', sans-serif",
      overflow: 'hidden',
    }}>

      {/* ══ TOPBAR ══ */}
      <header style={{
        display: 'flex',
        alignItems: 'center',
        padding: '0 20px',
        height: 54,
        background: 'var(--surface)',
        borderBottom: '1px solid var(--border-strong)',
        flexShrink: 0,
        gap: 0,
        position: 'relative',
        zIndex: 20,
        boxShadow: 'var(--shadow-sm)',
      }}>

        {/* Brand con logo Exprivia */}
        <div className="admin-topbar-left" style={{
          paddingRight: 20,
          borderRight: '1px solid var(--border-strong)',
          marginRight: 8,
          flexShrink: 0,
        }}>
          <img
            src={logo}
            alt="Exprivia"
            className="exprivia-logo-topbar"
          />
          <div className="admin-topbar-separator" />
          <span style={{
            fontSize: '0.84rem', fontWeight: 700,
            color: 'var(--text)', letterSpacing: '-0.01em',
          }}>
            Policy Navigator
          </span>
          <span className="admin-topbar-badge">Admin</span>
        </div>

        {/* Nav tabs */}
        <nav style={{ display: 'flex', alignItems: 'stretch', flex: 1, height: '100%' }}>
          {visibleSections.map(sec => {
            const isActive = activeSection === sec.id
            return (
              <button
                key={sec.id}
                onClick={() => setActiveSection(sec.id)}
                style={{
                  display: 'flex', alignItems: 'center', gap: 7,
                  padding: '0 18px',
                  background: 'none',
                  border: 'none',
                  borderBottom: isActive
                    ? '2px solid var(--accent)'
                    : '2px solid transparent',
                  color: isActive ? 'var(--text)' : 'var(--text-muted)',
                  cursor: 'pointer',
                  fontFamily: 'inherit',
                  fontSize: '0.82rem',
                  fontWeight: isActive ? 600 : 400,
                  transition: 'color 0.15s, border-color 0.15s',
                  whiteSpace: 'nowrap',
                  borderRadius: 0,
                }}
              >
                <span style={{ opacity: isActive ? 1 : 0.6 }}>{sec.icon}</span>
                {sec.label}
              </button>
            )
          })}
        </nav>

        {/* Right: user + back */}
        <div style={{ display: 'flex', alignItems: 'center', gap: 10, flexShrink: 0, paddingLeft: 12 }}>
          {user && (
            <div style={{
              fontSize: '0.72rem', color: 'var(--text-muted)',
              fontFamily: "'JetBrains Mono', monospace",
              maxWidth: 160, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap',
            }}>
              {user.nome ? `${user.nome} ${user.cognome || ''}`.trim() : user.email}
            </div>
          )}
          <button
            onClick={() => navigate('/')}
            className="back-to-chat-btn"
            style={{ display: 'flex', alignItems: 'center', gap: 5 }}
          >
            {Icon.back} Chat
          </button>
        </div>
      </header>

      {/* ══ BREADCRUMB ══ */}
      <div style={{
        display: 'flex', alignItems: 'center', gap: 8,
        padding: '0 20px',
        height: 34,
        background: 'var(--surface2)',
        borderBottom: '1px solid var(--border)',
        flexShrink: 0,
      }}>
        <span style={{ fontSize: '0.65rem', color: 'var(--text-muted)', fontFamily: "'JetBrains Mono', monospace" }}>
          admin
        </span>
        <span style={{ fontSize: '0.65rem', color: 'var(--border-strong)' }}>›</span>
        <span style={{ fontSize: '0.72rem', color: 'var(--text)', fontWeight: 600 }}>
          {activeLabel}
        </span>
      </div>

      {/* ══ CONTENT AREA ══ */}
      <main style={{ flex: 1, overflow: 'hidden', minHeight: 0 }}>

        {/* Documenti */}
        <div style={{
          display: activeSection === 'docs' ? 'flex' : 'none',
          flex: 1,
          overflow: 'hidden',
          minHeight: 0,
          height: '100%',
        }}>
          <AdminPanel />
        </div>

        {/* Utenti */}
        {activeSection === 'users' && (
          <FullPageSection>
            <UserManagementPanel />
          </FullPageSection>
        )}

        {/* Log */}
        {activeSection === 'log' && (
          <FullPageSection noPadding>
            <ActivityLogPanel />
          </FullPageSection>
        )}

        {/* Permessi */}
        {activeSection === 'permissions' && (
          <FullPageSection noPadding>
            <PermissionMatrixPanel />
          </FullPageSection>
        )}
      </main>
    </div>
  )
}

// ─── Wrapper sezioni a pagina piena ────────────────────────────
function FullPageSection({ children, noPadding = false }) {
  return (
    <div style={{
      display: 'flex',
      flexDirection: 'column',
      height: '100%',
      overflow: 'hidden',
    }}>
      <div style={{
        flex: 1,
        overflow: noPadding ? 'hidden' : 'auto',
        padding: noPadding ? 0 : '24px 32px',
        display: noPadding ? 'flex' : 'block',
        flexDirection: noPadding ? 'column' : undefined,
        minHeight: 0,
      }}>
        {children}
      </div>
    </div>
  )
}