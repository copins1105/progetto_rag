// // src/pages/ChatPage.jsx
// import { useState, useEffect, useRef } from 'react'
// import { useNavigate } from 'react-router-dom'
// import ReactMarkdown from 'react-markdown'
// import remarkGfm from 'remark-gfm'
// import { useChat } from '../context/ChatContext'
// import { useAuth } from '../context/AuthContext'   // ← NUOVO
// import ThemeToggle from "../components/ThemeToggle";
// const BASE_SERVER_URL = 'http://127.0.0.1:8080'

// const formatBotResponse = (text) => {
//   if (!text) return ''
//   return text.replace(/<\/?[A-Z]+>/g, '').trim()
// }

// function buildPdfHref(src) {
//   if (!src?.link) return null
//   const base = `${BASE_SERVER_URL}${src.link}`.split('#')[0]
//   return src.page ? `${base}#page=${src.page}` : base
// }

// function buildDebugHref(chunk) {
//   if (!chunk?.anchor_link) return null
//   const base = `${BASE_SERVER_URL}${chunk.anchor_link}`.split('#')[0]
//   return chunk.pagina && chunk.pagina !== 'N/D'
//     ? `${base}#page=${chunk.pagina}`
//     : base
// }

// // ─────────────────────────────────────────────
// // CITATION HELPERS
// // ─────────────────────────────────────────────
// function buildSourceMap(sources) {
//   const map = {}
//   if (!sources) return map
//   for (const src of sources) {
//     if (src.title) map[src.title.trim().toLowerCase()] = src
//   }
//   return map
// }

// const BRACKET_RE = /\[([^\]|]+)(?:\|p(\d+))?\]/g

// function findCitationsInText(text, sourceMap) {
//   const found = []
//   let match
//   const regex = new RegExp(BRACKET_RE.source, 'g')
//   while ((match = regex.exec(text)) !== null) {
//     const titleRaw = match[1].trim()
//     const inner    = titleRaw.toLowerCase()
//     if (sourceMap[inner]) {
//       found.push({ fullMatch: match[0], title: titleRaw, page: match[2] || null, src: sourceMap[inner] })
//     }
//   }
//   return found
// }

// function hasInlineCitations(text, sourceMap) {
//   if (!text || Object.keys(sourceMap).length === 0) return false
//   return findCitationsInText(text, sourceMap).length > 0
// }

// function InlineCitationText({ text, sourceMap }) {
//   const parts = []
//   let lastIndex = 0
//   let match
//   const regex = new RegExp(BRACKET_RE.source, 'g')
//   while ((match = regex.exec(text)) !== null) {
//     const inner = match[1].trim().toLowerCase()
//     const src   = sourceMap[inner]
//     if (match.index > lastIndex) parts.push({ type: 'text', content: text.slice(lastIndex, match.index) })
//     if (src) {
//       const page = match[2] || src.page || ''
//       parts.push({ type: 'citation', title: match[1].trim(), page, src })
//     } else {
//       parts.push({ type: 'text', content: match[0] })
//     }
//     lastIndex = match.index + match[0].length
//   }
//   if (lastIndex < text.length) parts.push({ type: 'text', content: text.slice(lastIndex) })

//   return (
//     <span>
//       {parts.map((part, i) => {
//         if (part.type === 'citation') {
//           const href  = buildPdfHref(part.src)
//           const label = part.page ? `${part.title} · p.${part.page}` : part.title
//           return href ? (
//             <a key={i} href={href} target="_blank" rel="noreferrer"
//               style={{ display: 'inline-flex', alignItems: 'center', gap: '3px', fontSize: '0.72em',
//                 fontFamily: "'DM Mono', monospace", background: 'rgba(79,142,247,0.12)',
//                 border: '1px solid rgba(79,142,247,0.3)', borderRadius: '4px', padding: '1px 6px',
//                 color: 'var(--accent)', textDecoration: 'none', verticalAlign: 'middle',
//                 marginLeft: '2px', lineHeight: 1.4, whiteSpace: 'nowrap' }}>
//               📄 {label}
//             </a>
//           ) : (
//             <span key={i} style={{ fontSize: '0.72em', fontFamily: "'DM Mono', monospace",
//               background: 'rgba(79,142,247,0.08)', border: '1px solid rgba(79,142,247,0.2)',
//               borderRadius: '4px', padding: '1px 6px', color: 'var(--accent)',
//               verticalAlign: 'middle', marginLeft: '2px' }}>
//               📄 {label}
//             </span>
//           )
//         }
//         return <span key={i}>{part.content}</span>
//       })}
//     </span>
//   )
// }

// function ProcessChildren({ children, sourceMap }) {
//   const processNode = (node, i) => {
//     if (typeof node === 'string') {
//       const hasCit = findCitationsInText(node, sourceMap).length > 0
//       if (hasCit) return <InlineCitationText key={i} text={node} sourceMap={sourceMap} />
//       return node
//     }
//     return node
//   }
//   if (Array.isArray(children)) return <>{children.map((child, i) => processNode(child, i))}</>
//   return <>{processNode(children, 0)}</>
// }

// function BotMessage({ text, sources }) {
//   const sourceMap    = buildSourceMap(sources)
//   const cleanText    = formatBotResponse(text)
//   const useInline    = hasInlineCitations(cleanText, sourceMap)
//   const singleSource = sources && sources.length === 1

//   if (!useInline || singleSource) {
//     return (
//       <>
//         <div className="message-content">
//           <ReactMarkdown remarkPlugins={[remarkGfm]}>{cleanText}</ReactMarkdown>
//         </div>
//         {sources && sources.length > 0 && <SourcesFooter sources={sources} />}
//       </>
//     )
//   }
//   return (
//     <div className="message-content">
//       <ReactMarkdown remarkPlugins={[remarkGfm]} components={{
//         p:  ({ children }) => <p><ProcessChildren sourceMap={sourceMap}>{children}</ProcessChildren></p>,
//         li: ({ children }) => <li><ProcessChildren sourceMap={sourceMap}>{children}</ProcessChildren></li>,
//       }}>
//         {cleanText}
//       </ReactMarkdown>
//     </div>
//   )
// }

// function SourcesFooter({ sources }) {
//   if (!sources || sources.length === 0) return null
//   return (
//     <div className="sources-section">
//       <p className="sources-title">Fonti</p>
//       <div className="sources-grid">
//         {sources.map((src, i) => {
//           const label = src.page ? `${src.title} · p.${src.page}` : src.title
//           const href  = buildPdfHref(src)
//           return (
//             <div key={i} className="source-tag">
//               {href
//                 ? <a href={href} target="_blank" rel="noreferrer">📄 {label}</a>
//                 : <span style={{ color: 'var(--text-dim)', fontSize: '0.75rem' }}>📄 {label}</span>
//               }
//             </div>
//           )
//         })}
//       </div>
//     </div>
//   )
// }

// function DebugDrawer({ open, onClose, debugData }) {
//   if (!open) return null
//   return (
//     <div style={{ position: 'fixed', top: 0, right: 0, bottom: 0, width: 420,
//       background: 'var(--surface)', borderLeft: '1px solid var(--border-strong)',
//       display: 'flex', flexDirection: 'column', zIndex: 200,
//       boxShadow: '-8px 0 32px rgba(0,0,0,0.4)' }}>
//       <div style={{ padding: '16px 18px', borderBottom: '1px solid var(--border)',
//         display: 'flex', justifyContent: 'space-between', alignItems: 'center', flexShrink: 0 }}>
//         <div>
//           <div style={{ fontWeight: 700, fontSize: '0.9rem', color: 'var(--text)' }}>🔍 Retrieval Debug</div>
//           <div style={{ fontSize: '0.7rem', color: 'var(--text-muted)', marginTop: 2, fontFamily: "'DM Mono', monospace" }}>
//             {debugData?.length || 0} chunk recuperati
//           </div>
//         </div>
//         <button onClick={onClose} style={{ background: 'none', border: '1px solid var(--border-strong)',
//           borderRadius: 6, padding: '4px 10px', cursor: 'pointer', color: 'var(--text-muted)',
//           fontFamily: 'inherit', fontSize: '0.8rem' }}>✕ Chiudi</button>
//       </div>
//       <div style={{ flex: 1, overflowY: 'auto', padding: '12px 14px' }}>
//         {(!debugData || debugData.length === 0) ? (
//           <div style={{ color: 'var(--text-muted)', fontSize: '0.78rem', textAlign: 'center', padding: 32 }}>
//             Nessun chunk disponibile.
//           </div>
//         ) : debugData.map((chunk, i) => {
//           const hasPage = chunk.pagina && chunk.pagina !== 'N/D' && chunk.pagina !== ''
//           const href    = buildDebugHref(chunk)
//           return (
//             <div key={i} style={{ background: 'var(--surface2)', border: '1px solid var(--border)',
//               borderRadius: 8, marginBottom: 6, overflow: 'hidden' }}>
//               <div style={{ padding: '9px 12px', display: 'flex', gap: 8, alignItems: 'flex-start' }}>
//                 <span style={{ fontSize: '0.65rem', fontFamily: "'DM Mono', monospace",
//                   color: 'var(--accent)', flexShrink: 0, minWidth: 24 }}>C{chunk.chunk_idx}</span>
//                 <div style={{ flex: 1, minWidth: 0 }}>
//                   <div style={{ fontSize: '0.75rem', fontWeight: 600, color: 'var(--text)',
//                     overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{chunk.titolo}</div>
//                   {chunk.breadcrumb && (
//                     <div style={{ fontSize: '0.65rem', color: 'var(--text-muted)', marginTop: 1,
//                       overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{chunk.breadcrumb}</div>
//                   )}
//                 </div>
//                 <span style={{ fontSize: '0.65rem', fontFamily: "'DM Mono', monospace",
//                   padding: '2px 7px', borderRadius: 20, flexShrink: 0,
//                   background: hasPage ? 'rgba(79,142,247,0.12)' : 'var(--surface)',
//                   color: hasPage ? 'var(--accent)' : 'var(--text-muted)',
//                   border: `1px solid ${hasPage ? 'rgba(79,142,247,0.3)' : 'var(--border)'}` }}>
//                   {hasPage ? `p.${chunk.pagina}` : 'no pag.'}
//                 </span>
//               </div>
//               <div style={{ padding: '6px 12px 10px', borderTop: '1px solid var(--border)',
//                 fontSize: '0.7rem', fontFamily: "'DM Mono', monospace",
//                 color: 'var(--text-dim)', lineHeight: 1.6 }}>
//                 {href && (
//                   <a href={href} target="_blank" rel="noreferrer" style={{ fontSize: '0.65rem',
//                     color: '#34d399', textDecoration: 'none', marginBottom: 6, display: 'inline-block' }}>
//                     🔗 apri PDF
//                   </a>
//                 )}
//                 <div style={{ background: 'var(--bg)', borderRadius: 4, padding: '6px 8px',
//                   border: '1px solid var(--border)', whiteSpace: 'pre-wrap',
//                   maxHeight: 120, overflowY: 'auto' }}>{chunk.preview}</div>
//               </div>
//             </div>
//           )
//         })}
//       </div>
//     </div>
//   )
// }

// // ─────────────────────────────────────────────
// // CHAT PAGE
// // ─────────────────────────────────────────────
// export default function ChatPage() {
//   const navigate  = useNavigate()
//   const { messages, sessionId, addMessage, resetChat } = useChat()
//   const { authFetch, user, logout, isAdmin , hasPermission} = useAuth()   // ← NUOVO

//   const [input,          setInput]          = useState('')
//   const [isTyping,       setIsTyping]       = useState(false)
//   const [debugOpen,      setDebugOpen]      = useState(false)
//   const [lastDebug,      setLastDebug]      = useState(null)
//   const [debugEnabled,   setDebugEnabled]   = useState(false)
//   const bottomRef = useRef(null)

//   useEffect(() => {
//     bottomRef.current?.scrollIntoView({ behavior: 'smooth' })
//   }, [messages, isTyping])

//   const sendMessage = async () => {
//     if (!input.trim() || isTyping) return
//     const userQuery = input.trim()
//     addMessage({ role: 'user', text: userQuery })
//     setInput('')
//     setIsTyping(true)

//     try {
//       // ← CAMBIATO: authFetch invece di fetch
//       const response = await authFetch('/api/v1/chat', {
//         method: 'POST',
//         body: JSON.stringify({
//           question:   userQuery,
//           session_id: sessionId,
//           debug:      debugEnabled,
//         }),
//       })
//       const data = await response.json()
//       addMessage({ role: 'bot', text: data.answer, sources: data.sources })
//       if (data.retrieval_debug) {
//         setLastDebug(data.retrieval_debug)
//         if (debugEnabled) setDebugOpen(true)
//       }
//     } catch {
//       addMessage({ role: 'bot', text: 'Errore di connessione al server.' })
//     } finally {
//       setIsTyping(false)
//     }
//   }

//   const handleLogout = async () => {
//     await logout()
//     navigate('/login')
//   }

//   return (
//     <div className="app-container">
//       <aside className="chat-sidebar">
//         <div className="sidebar-brand">
//           <div className="sidebar-brand-icon">⚡</div>
//           <span className="sidebar-brand-name">Policy Navigator</span>
//         </div>

//         <button className="new-chat-btn" onClick={resetChat}>
//           <span>＋</span> Nuova chat
//         </button>

//         <div className="history-container">
//           <div className="history-label">Recenti</div>
//           {messages
//             .filter(m => m.role === 'user')
//             .slice(-6)
//             .map((m, i) => (
//               <div key={i} className="history-card">
//                 <span style={{ opacity: 0.5, fontSize: '0.75rem' }}>💬</span>
//                 <span style={{ overflow: 'hidden', textOverflow: 'ellipsis' }}>
//                   {m.text.slice(0, 38)}{m.text.length > 38 ? '…' : ''}
//                 </span>
//               </div>
//             ))}
//         </div>

//         <div className="sidebar-footer">
//           {/* Toggle debug */}
//           <button onClick={() => setDebugEnabled(d => !d)} style={{
//             width: '100%', padding: '7px 10px', marginBottom: 6,
//             background: debugEnabled ? 'rgba(245,158,11,0.1)' : 'transparent',
//             border: `1px solid ${debugEnabled ? 'rgba(245,158,11,0.35)' : 'var(--border-strong)'}`,
//             borderRadius: 'var(--radius-sm)',
//             color: debugEnabled ? '#f59e0b' : 'var(--text-muted)',
//             fontFamily: 'inherit', fontSize: '0.78rem', fontWeight: 600,
//             cursor: 'pointer', display: 'flex', alignItems: 'center', gap: 6,
//           }}>
//             <span>{debugEnabled ? '🔍' : '○'}</span>
//             Debug retrieval {debugEnabled ? 'ON' : 'OFF'}
//           </button>

//           {lastDebug && (
//             <button onClick={() => setDebugOpen(true)} style={{
//               width: '100%', padding: '7px 10px', marginBottom: 6,
//               background: 'rgba(79,142,247,0.08)', border: '1px solid rgba(79,142,247,0.25)',
//               borderRadius: 'var(--radius-sm)', color: 'var(--accent)',
//               fontFamily: 'inherit', fontSize: '0.78rem', fontWeight: 600, cursor: 'pointer',
//             }}>
//               🔍 Vedi {lastDebug.length} chunk recuperati
//             </button>
//           )}

//           {/* Link profilo */}
//           <button className="admin-nav-btn" onClick={() => navigate('/profile')} style={{ marginBottom: 6 }}>
//             <span>👤</span>
//             {user?.nome ? `${user.nome} ${user.cognome || ''}`.trim() : user?.email}
//           </button>

//           {/* Admin (solo se admin) */}
//           {hasPermission('page_admin') && (
//             <button className="admin-nav-btn" onClick={() => navigate('/admin')} style={{ marginBottom: 6 }}>
//               <span>⚙</span> Pannello Admin
//             </button>
//           )}

//           {/* Logout */}
//           <button className="admin-nav-btn" onClick={handleLogout}
//             style={{ color: '#f87171', borderColor: 'rgba(239,68,68,0.25)' }}>
//             <span>↩</span> Esci
//           </button>

//           <div className="session-badge" style={{ marginTop: '8px' }}>
//             ID: {sessionId}
//           </div>
//           <ThemeToggle />
//         </div>
//       </aside>

//       <main className="chat-window">
//         <div className="chat-topbar">
//           <span className="topbar-title">Assistente documentale</span>
//           <div style={{ display: 'flex', alignItems: 'center', gap: 12 }}>
//             {debugEnabled && (
//               <span style={{ fontSize: '0.72rem', fontFamily: "'DM Mono', monospace",
//                 padding: '2px 8px', borderRadius: 20, background: 'rgba(245,158,11,0.1)',
//                 color: '#f59e0b', border: '1px solid rgba(245,158,11,0.3)' }}>
//                 🔍 debug on
//               </span>
//             )}
//             <div className="online-indicator">
//               <div className="online-dot" />
//               Connesso
//             </div>
//           </div>
//         </div>

//         <div className="messages-display">
//           {messages.map((msg, index) => (
//             <div key={index} className={`bubble ${msg.role}`}>
//               {msg.role === 'bot' ? (
//                 <BotMessage text={msg.text} sources={msg.sources} />
//               ) : (
//                 <div className="message-content">{msg.text}</div>
//               )}
//             </div>
//           ))}
//           {isTyping && (
//             <div className="typing-bubble">
//               <div className="typing-dot" /><div className="typing-dot" /><div className="typing-dot" />
//             </div>
//           )}
//           <div ref={bottomRef} />
//         </div>

//         <div className="input-field-container">
//           <input
//             value={input}
//             onChange={(e) => setInput(e.target.value)}
//             onKeyDown={(e) => e.key === 'Enter' && !e.shiftKey && sendMessage()}
//             placeholder="Fai una domanda su policy o procedure..."
//             disabled={isTyping}
//           />
//           <button onClick={sendMessage} disabled={isTyping || !input.trim()}>
//             {isTyping ? '...' : 'Invia'}
//           </button>
//         </div>
//       </main>

//       <DebugDrawer open={debugOpen} onClose={() => setDebugOpen(false)} debugData={lastDebug} />
//     </div>
//   )
// }

// src/pages/ChatPage.jsx
import { useState, useEffect, useRef } from 'react'
import { useNavigate } from 'react-router-dom'
import ReactMarkdown from 'react-markdown'
import remarkGfm from 'remark-gfm'
import { useChat } from '../context/ChatContext'
import { useAuth } from '../context/AuthContext'
import ThemeToggle from "../components/ThemeToggle"
import logo from "../assets/Logo Exprivia pulito.png"

const BASE_SERVER_URL = 'https://127.0.0.1:8080'

const formatBotResponse = (text) => {
  if (!text) return ''
  return text.replace(/<\/?[A-Z]+>/g, '').trim()
}

function buildPdfHref(src) {
  if (!src?.link) return null
  const base = `${BASE_SERVER_URL}${src.link}`.split('#')[0]
  return src.page ? `${base}#page=${src.page}` : base
}

function buildDebugHref(chunk) {
  if (!chunk?.anchor_link) return null
  const base = `${BASE_SERVER_URL}${chunk.anchor_link}`.split('#')[0]
  return chunk.pagina && chunk.pagina !== 'N/D'
    ? `${base}#page=${chunk.pagina}`
    : base
}

// ─── Citation helpers ──────────────────────────────────────────
function buildSourceMap(sources) {
  const map = {}
  if (!sources) return map
  for (const src of sources) {
    if (src.title) map[src.title.trim().toLowerCase()] = src
  }
  return map
}

const BRACKET_RE = /\[([^\]|]+)(?:\|p(\d+))?\]/g

function findCitationsInText(text, sourceMap) {
  const found = []
  let match
  const regex = new RegExp(BRACKET_RE.source, 'g')
  while ((match = regex.exec(text)) !== null) {
    const titleRaw = match[1].trim()
    const inner    = titleRaw.toLowerCase()
    if (sourceMap[inner]) {
      found.push({ fullMatch: match[0], title: titleRaw, page: match[2] || null, src: sourceMap[inner] })
    }
  }
  return found
}

function hasInlineCitations(text, sourceMap) {
  if (!text || Object.keys(sourceMap).length === 0) return false
  return findCitationsInText(text, sourceMap).length > 0
}

function InlineCitationText({ text, sourceMap }) {
  const parts = []
  let lastIndex = 0
  let match
  const regex = new RegExp(BRACKET_RE.source, 'g')
  while ((match = regex.exec(text)) !== null) {
    const inner = match[1].trim().toLowerCase()
    const src   = sourceMap[inner]
    if (match.index > lastIndex) parts.push({ type: 'text', content: text.slice(lastIndex, match.index) })
    if (src) {
      const page = match[2] || src.page || ''
      parts.push({ type: 'citation', title: match[1].trim(), page, src })
    } else {
      parts.push({ type: 'text', content: match[0] })
    }
    lastIndex = match.index + match[0].length
  }
  if (lastIndex < text.length) parts.push({ type: 'text', content: text.slice(lastIndex) })

  return (
    <span>
      {parts.map((part, i) => {
        if (part.type === 'citation') {
          const href  = buildPdfHref(part.src)
          const label = part.page ? `${part.title} · p.${part.page}` : part.title
          return href ? (
            <a key={i} href={href} target="_blank" rel="noreferrer"
              style={{
                display: 'inline-flex', alignItems: 'center', gap: '3px',
                fontSize: '0.72em', fontFamily: "'JetBrains Mono', monospace",
                background: 'var(--accent-dim)', border: '1px solid var(--border-accent)',
                borderRadius: '4px', padding: '1px 6px', color: 'var(--accent-bright)',
                textDecoration: 'none', verticalAlign: 'middle',
                marginLeft: '2px', lineHeight: 1.4, whiteSpace: 'nowrap',
              }}>
              📄 {label}
            </a>
          ) : (
            <span key={i} style={{
              fontSize: '0.72em', fontFamily: "'JetBrains Mono', monospace",
              background: 'var(--accent-dim)', border: '1px solid var(--border-accent)',
              borderRadius: '4px', padding: '1px 6px', color: 'var(--accent-bright)',
              verticalAlign: 'middle', marginLeft: '2px',
            }}>
              📄 {label}
            </span>
          )
        }
        return <span key={i}>{part.content}</span>
      })}
    </span>
  )
}

function ProcessChildren({ children, sourceMap }) {
  const processNode = (node, i) => {
    if (typeof node === 'string') {
      const hasCit = findCitationsInText(node, sourceMap).length > 0
      if (hasCit) return <InlineCitationText key={i} text={node} sourceMap={sourceMap} />
      return node
    }
    return node
  }
  if (Array.isArray(children)) return <>{children.map((child, i) => processNode(child, i))}</>
  return <>{processNode(children, 0)}</>
}

function BotMessage({ text, sources }) {
  const sourceMap    = buildSourceMap(sources)
  const cleanText    = formatBotResponse(text)
  const useInline    = hasInlineCitations(cleanText, sourceMap)
  const singleSource = sources && sources.length === 1

  if (!useInline || singleSource) {
    return (
      <>
        <div className="message-content">
          <ReactMarkdown remarkPlugins={[remarkGfm]}>{cleanText}</ReactMarkdown>
        </div>
        {sources && sources.length > 0 && <SourcesFooter sources={sources} />}
      </>
    )
  }
  return (
    <div className="message-content">
      <ReactMarkdown remarkPlugins={[remarkGfm]} components={{
        p:  ({ children }) => <p><ProcessChildren sourceMap={sourceMap}>{children}</ProcessChildren></p>,
        li: ({ children }) => <li><ProcessChildren sourceMap={sourceMap}>{children}</ProcessChildren></li>,
      }}>
        {cleanText}
      </ReactMarkdown>
    </div>
  )
}

function SourcesFooter({ sources }) {
  if (!sources || sources.length === 0) return null
  return (
    <div className="sources-section">
      <p className="sources-title">Fonti</p>
      <div className="sources-grid">
        {sources.map((src, i) => {
          const label = src.page ? `${src.title} · p.${src.page}` : src.title
          const href  = buildPdfHref(src)
          return (
            <div key={i} className="source-tag">
              {href
                ? <a href={href} target="_blank" rel="noreferrer">📄 {label}</a>
                : <span style={{ color: 'var(--text-dim)', fontSize: '0.75rem' }}>📄 {label}</span>
              }
            </div>
          )
        })}
      </div>
    </div>
  )
}

function DebugDrawer({ open, onClose, debugData }) {
  if (!open) return null
  return (
    <div style={{
      position: 'fixed', top: 0, right: 0, bottom: 0, width: 420,
      background: 'var(--surface)', borderLeft: '1px solid var(--border-strong)',
      display: 'flex', flexDirection: 'column', zIndex: 200,
      boxShadow: '-8px 0 36px rgba(0,0,0,0.45)',
    }}>
      <div style={{
        padding: '16px 18px', borderBottom: '1px solid var(--border)',
        display: 'flex', justifyContent: 'space-between', alignItems: 'center', flexShrink: 0,
      }}>
        <div>
          <div style={{ fontWeight: 700, fontSize: '0.9rem', color: 'var(--text)' }}>🔍 Retrieval Debug</div>
          <div style={{ fontSize: '0.7rem', color: 'var(--text-muted)', marginTop: 2, fontFamily: "'JetBrains Mono', monospace" }}>
            {debugData?.length || 0} chunk recuperati
          </div>
        </div>
        <button onClick={onClose} style={{
          background: 'none', border: '1px solid var(--border-strong)',
          borderRadius: 6, padding: '4px 10px', cursor: 'pointer',
          color: 'var(--text-muted)', fontFamily: 'inherit', fontSize: '0.8rem',
        }}>✕ Chiudi</button>
      </div>
      <div style={{ flex: 1, overflowY: 'auto', padding: '12px 14px' }}>
        {(!debugData || debugData.length === 0) ? (
          <div style={{ color: 'var(--text-muted)', fontSize: '0.78rem', textAlign: 'center', padding: 32 }}>
            Nessun chunk disponibile.
          </div>
        ) : debugData.map((chunk, i) => {
          const hasPage = chunk.pagina && chunk.pagina !== 'N/D' && chunk.pagina !== ''
          const href    = buildDebugHref(chunk)
          return (
            <div key={i} style={{
              background: 'var(--surface2)', border: '1px solid var(--border)',
              borderRadius: 8, marginBottom: 6, overflow: 'hidden',
            }}>
              <div style={{ padding: '9px 12px', display: 'flex', gap: 8, alignItems: 'flex-start' }}>
                <span style={{ fontSize: '0.65rem', fontFamily: "'JetBrains Mono', monospace", color: 'var(--accent-bright)', flexShrink: 0, minWidth: 24 }}>
                  C{chunk.chunk_idx}
                </span>
                <div style={{ flex: 1, minWidth: 0 }}>
                  <div style={{ fontSize: '0.75rem', fontWeight: 600, color: 'var(--text)', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                    {chunk.titolo}
                  </div>
                  {chunk.breadcrumb && (
                    <div style={{ fontSize: '0.65rem', color: 'var(--text-muted)', marginTop: 1, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                      {chunk.breadcrumb}
                    </div>
                  )}
                </div>
                <span style={{
                  fontSize: '0.65rem', fontFamily: "'JetBrains Mono', monospace",
                  padding: '2px 7px', borderRadius: 20, flexShrink: 0,
                  background: hasPage ? 'var(--accent-dim)' : 'var(--surface)',
                  color: hasPage ? 'var(--accent-bright)' : 'var(--text-muted)',
                  border: `1px solid ${hasPage ? 'var(--border-accent)' : 'var(--border)'}`,
                }}>
                  {hasPage ? `p.${chunk.pagina}` : 'no pag.'}
                </span>
              </div>
              <div style={{
                padding: '6px 12px 10px', borderTop: '1px solid var(--border)',
                fontSize: '0.7rem', fontFamily: "'JetBrains Mono', monospace",
                color: 'var(--text-dim)', lineHeight: 1.6,
              }}>
                {href && (
                  <a href={href} target="_blank" rel="noreferrer" style={{
                    fontSize: '0.65rem', color: 'var(--green)', textDecoration: 'none',
                    marginBottom: 6, display: 'inline-block',
                  }}>
                    🔗 apri PDF
                  </a>
                )}
                <div style={{
                  background: 'var(--bg)', borderRadius: 4, padding: '6px 8px',
                  border: '1px solid var(--border)', whiteSpace: 'pre-wrap',
                  maxHeight: 120, overflowY: 'auto',
                }}>{chunk.preview}</div>
              </div>
            </div>
          )
        })}
      </div>
    </div>
  )
}

// ─────────────────────────────────────────────
// CHAT PAGE
// ─────────────────────────────────────────────
export default function ChatPage() {
  const navigate  = useNavigate()
  const { messages, sessionId, addMessage, resetChat } = useChat()
  const { authFetch, user, logout, hasPermission } = useAuth()

  const [input,        setInput]        = useState('')
  const [isTyping,     setIsTyping]     = useState(false)
  const [debugOpen,    setDebugOpen]    = useState(false)
  const [lastDebug,    setLastDebug]    = useState(null)
  const [debugEnabled, setDebugEnabled] = useState(false)
  const bottomRef = useRef(null)

  useEffect(() => {
    bottomRef.current?.scrollIntoView({ behavior: 'smooth' })
  }, [messages, isTyping])

  const sendMessage = async () => {
    if (!input.trim() || isTyping) return
    const userQuery = input.trim()
    addMessage({ role: 'user', text: userQuery })
    setInput('')
    setIsTyping(true)

    try {
      const response = await authFetch('/api/v1/chat', {
        method: 'POST',
        body: JSON.stringify({
          question:   userQuery,
          session_id: sessionId,
          debug:      debugEnabled,
        }),
      })
      const data = await response.json()
      addMessage({ role: 'bot', text: data.answer, sources: data.sources })
      if (data.retrieval_debug) {
        setLastDebug(data.retrieval_debug)
        if (debugEnabled) setDebugOpen(true)
      }
    } catch {
      addMessage({ role: 'bot', text: 'Errore di connessione al server.' })
    } finally {
      setIsTyping(false)
    }
  }

  const handleLogout = async () => {
    await logout()
    navigate('/login')
  }

  return (
    <div className="app-container">
      {/* ── Sidebar ── */}
      <aside className="chat-sidebar">

        {/* Brand con logo Exprivia */}
        <div className="sidebar-brand">
          <img
            src={logo}
            alt="Exprivia"
            className="exprivia-logo-sidebar"
          />
          <div className="sidebar-brand-divider" />
          <div className="sidebar-brand-text">
            <span className="sidebar-brand-name">Policy Navigator</span>
            <span className="sidebar-brand-sub">AI Assistant</span>
          </div>
        </div>

        <button className="new-chat-btn" onClick={resetChat}>
          <span>＋</span> Nuova chat
        </button>

        <div className="history-container">
          <div className="history-label">Recenti</div>
          {messages
            .filter(m => m.role === 'user')
            .slice(-6)
            .map((m, i) => (
              <div key={i} className="history-card">
                <span style={{ opacity: 0.5, fontSize: '0.75rem' }}>💬</span>
                <span style={{ overflow: 'hidden', textOverflow: 'ellipsis' }}>
                  {m.text.slice(0, 38)}{m.text.length > 38 ? '…' : ''}
                </span>
              </div>
            ))}
        </div>

        <div className="sidebar-footer">
          {/* Toggle debug */}
          <button onClick={() => setDebugEnabled(d => !d)} style={{
            width: '100%', padding: '7px 10px', marginBottom: 6,
            background: debugEnabled ? 'var(--yellow-dim)' : 'transparent',
            border: `1px solid ${debugEnabled ? 'rgba(240,173,58,0.38)' : 'var(--border-strong)'}`,
            borderRadius: 'var(--radius-sm)',
            color: debugEnabled ? 'var(--yellow)' : 'var(--text-muted)',
            fontFamily: 'inherit', fontSize: '0.78rem', fontWeight: 600,
            cursor: 'pointer', display: 'flex', alignItems: 'center', gap: 6,
          }}>
            <span>{debugEnabled ? '🔍' : '○'}</span>
            Debug retrieval {debugEnabled ? 'ON' : 'OFF'}
          </button>

          {lastDebug && (
            <button onClick={() => setDebugOpen(true)} style={{
              width: '100%', padding: '7px 10px', marginBottom: 6,
              background: 'var(--accent-dim)', border: '1px solid var(--border-accent)',
              borderRadius: 'var(--radius-sm)', color: 'var(--accent-bright)',
              fontFamily: 'inherit', fontSize: '0.78rem', fontWeight: 600, cursor: 'pointer',
            }}>
              🔍 Vedi {lastDebug.length} chunk recuperati
            </button>
          )}

          {/* Link profilo */}
          <button className="admin-nav-btn" onClick={() => navigate('/profile')} style={{ marginBottom: 6 }}>
            <span>👤</span>
            {user?.nome ? `${user.nome} ${user.cognome || ''}`.trim() : user?.email}
          </button>

          {/* Admin (solo se permesso) */}
          {hasPermission('page_admin') && (
            <button className="admin-nav-btn" onClick={() => navigate('/admin')} style={{ marginBottom: 6 }}>
              <span>⚙</span> Pannello Admin
            </button>
          )}

          {/* Logout */}
          <button
            className="admin-nav-btn"
            onClick={handleLogout}
            style={{ color: 'var(--red)', borderColor: 'var(--red-dim)' }}
          >
            <span>↩</span> Esci
          </button>

          <div className="session-badge" style={{ marginTop: '8px' }}>
            ID: {sessionId}
          </div>

          <ThemeToggle />
        </div>
      </aside>

      {/* ── Chat main ── */}
      <main className="chat-window">
        <div className="chat-topbar">
          <span className="topbar-title">Assistente documentale</span>
          <div style={{ display: 'flex', alignItems: 'center', gap: 12 }}>
            {debugEnabled && (
              <span style={{
                fontSize: '0.72rem', fontFamily: "'JetBrains Mono', monospace",
                padding: '2px 8px', borderRadius: 20,
                background: 'var(--yellow-dim)', color: 'var(--yellow)',
                border: '1px solid rgba(240,173,58,0.32)',
              }}>
                🔍 debug on
              </span>
            )}
            <div className="online-indicator">
              <div className="online-dot" />
              Connesso
            </div>
          </div>
        </div>

        <div className="messages-display">
          {messages.map((msg, index) => (
            <div key={index} className={`bubble ${msg.role}`}>
              {msg.role === 'bot' ? (
                <BotMessage text={msg.text} sources={msg.sources} />
              ) : (
                <div className="message-content">{msg.text}</div>
              )}
            </div>
          ))}
          {isTyping && (
            <div className="typing-bubble">
              <div className="typing-dot" />
              <div className="typing-dot" />
              <div className="typing-dot" />
            </div>
          )}
          <div ref={bottomRef} />
        </div>

        <div className="input-field-container">
          <input
            value={input}
            onChange={(e) => setInput(e.target.value)}
            onKeyDown={(e) => e.key === 'Enter' && !e.shiftKey && sendMessage()}
            placeholder="Fai una domanda su policy o procedure..."
            disabled={isTyping}
          />
          <button onClick={sendMessage} disabled={isTyping || !input.trim()}>
            {isTyping ? '...' : 'Invia'}
          </button>
        </div>
      </main>

      <DebugDrawer open={debugOpen} onClose={() => setDebugOpen(false)} debugData={lastDebug} />
    </div>
  )
}
