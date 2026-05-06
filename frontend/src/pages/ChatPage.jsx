// import { useState, useEffect, useRef } from 'react'
// import { useNavigate } from 'react-router-dom'
// import ReactMarkdown from 'react-markdown'
// import remarkGfm from 'remark-gfm'
// import { useChat } from '../context/ChatContext'
// import { useAuth } from '../context/AuthContext'
// import ThemeToggle from "../components/ThemeToggle"
// import logo from "../assets/Logo Exprivia pulito.png"
// import robotLogo from "../assets/Logo.png"

// const BASE_SERVER_URL = 'https://127.0.0.1:8080'

// const formatBotResponse = (text) => {
//   if (!text) return ''
//   return text.replace(/<\/?[A-Z]+>/g, '').trim()
// }

// function buildPdfHref(src) {
//   if (!src) return null
//   if (src.link) {
//     return `${BASE_SERVER_URL}${src.link}`
//   }
//   return null
// }

// function buildDebugHref(chunk) {
//   if (!chunk?.anchor_link) return null
//   return `${BASE_SERVER_URL}${chunk.anchor_link}`
// }

// // ─── Citation helpers ──────────────────────────────────────────
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
//       let citationSrc = src
//       if (match[2] && src.link) {
//         const newLink = src.link.replace(/#page=\d+/, `#page=${match[2]}`)
//         citationSrc = { ...src, link: newLink, page: match[2] }
//       }
//       parts.push({ type: 'citation', title: match[1].trim(), page, src: citationSrc })
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
//               style={{
//                 display: 'inline-flex', alignItems: 'center', gap: '3px',
//                 fontSize: '0.72em', fontFamily: "'JetBrains Mono', monospace",
//                 background: 'var(--accent-dim)', border: '1px solid var(--border-accent)',
//                 borderRadius: '4px', padding: '1px 6px', color: 'var(--accent-bright)',
//                 textDecoration: 'none', verticalAlign: 'middle',
//                 marginLeft: '2px', lineHeight: 1.4, whiteSpace: 'nowrap',
//               }}>
//               📄 {label}
//             </a>
//           ) : (
//             <span key={i} style={{
//               fontSize: '0.72em', fontFamily: "'JetBrains Mono', monospace",
//               background: 'var(--accent-dim)', border: '1px solid var(--border-accent)',
//               borderRadius: '4px', padding: '1px 6px', color: 'var(--accent-bright)',
//               verticalAlign: 'middle', marginLeft: '2px',
//             }}>
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
//     <div style={{
//       position: 'fixed', top: 0, right: 0, bottom: 0, width: 420,
//       background: 'var(--surface)', borderLeft: '1px solid var(--border-strong)',
//       display: 'flex', flexDirection: 'column', zIndex: 200,
//       boxShadow: '-8px 0 36px rgba(0,0,0,0.45)',
//     }}>
//       <div style={{
//         padding: '16px 18px', borderBottom: '1px solid var(--border)',
//         display: 'flex', justifyContent: 'space-between', alignItems: 'center', flexShrink: 0,
//       }}>
//         <div>
//           <div style={{ fontWeight: 700, fontSize: '0.9rem', color: 'var(--text)' }}>🔍 Retrieval Debug</div>
//           <div style={{ fontSize: '0.7rem', color: 'var(--text-muted)', marginTop: 2, fontFamily: "'JetBrains Mono', monospace" }}>
//             {debugData?.length || 0} chunk recuperati
//           </div>
//         </div>
//         <button onClick={onClose} style={{
//           background: 'none', border: '1px solid var(--border-strong)',
//           borderRadius: 6, padding: '4px 10px', cursor: 'pointer',
//           color: 'var(--text-muted)', fontFamily: 'inherit', fontSize: '0.8rem',
//         }}>✕ Chiudi</button>
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
//             <div key={i} style={{
//               background: 'var(--surface2)', border: '1px solid var(--border)',
//               borderRadius: 8, marginBottom: 6, overflow: 'hidden',
//             }}>
//               <div style={{ padding: '9px 12px', display: 'flex', gap: 8, alignItems: 'flex-start' }}>
//                 <span style={{ fontSize: '0.65rem', fontFamily: "'JetBrains Mono', monospace", color: 'var(--accent-bright)', flexShrink: 0, minWidth: 24 }}>
//                   C{chunk.chunk_idx}
//                 </span>
//                 <div style={{ flex: 1, minWidth: 0 }}>
//                   <div style={{ fontSize: '0.75rem', fontWeight: 600, color: 'var(--text)', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
//                     {chunk.titolo}
//                   </div>
//                   {chunk.breadcrumb && (
//                     <div style={{ fontSize: '0.65rem', color: 'var(--text-muted)', marginTop: 1, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
//                       {chunk.breadcrumb}
//                     </div>
//                   )}
//                 </div>
//                 <span style={{
//                   fontSize: '0.65rem', fontFamily: "'JetBrains Mono', monospace",
//                   padding: '2px 7px', borderRadius: 20, flexShrink: 0,
//                   background: hasPage ? 'var(--accent-dim)' : 'var(--surface)',
//                   color: hasPage ? 'var(--accent-bright)' : 'var(--text-muted)',
//                   border: `1px solid ${hasPage ? 'var(--border-accent)' : 'var(--border)'}`,
//                 }}>
//                   {hasPage ? `p.${chunk.pagina}` : 'no pag.'}
//                 </span>
//               </div>
//               <div style={{
//                 padding: '6px 12px 10px', borderTop: '1px solid var(--border)',
//                 fontSize: '0.7rem', fontFamily: "'JetBrains Mono', monospace",
//                 color: 'var(--text-dim)', lineHeight: 1.6,
//               }}>
//                 {href && (
//                   <a href={href} target="_blank" rel="noreferrer" style={{
//                     fontSize: '0.65rem', color: 'var(--green)', textDecoration: 'none',
//                     marginBottom: 6, display: 'inline-block',
//                   }}>
//                     🔗 apri PDF (p.{chunk.pagina})
//                   </a>
//                 )}
//                 <div style={{
//                   background: 'var(--bg)', borderRadius: 4, padding: '6px 8px',
//                   border: '1px solid var(--border)', whiteSpace: 'pre-wrap',
//                   maxHeight: 120, overflowY: 'auto',
//                 }}>{chunk.preview}</div>
//               </div>
//             </div>
//           )
//         })}
//       </div>
//     </div>
//   )
// }

// // ─── Robot Watermark — theme-aware ────────────────────────────
// // Dark mode: sfondo nero del PNG scompare con mix-blend-mode screen
// // Light mode: invert(1) porta il nero a bianco, poi screen lo fa scomparire
// function RobotWatermark() {
//   return (
//     <div style={{
//       position: 'absolute',
//       inset: 0,
//       display: 'flex',
//       alignItems: 'center',
//       justifyContent: 'center',
//       pointerEvents: 'none',
//       zIndex: 0,
//       overflow: 'hidden',
//     }}>
//       <img
//         src={robotLogo}
//         alt=""
//         className="chat-robot-watermark"
//         style={{
//           width: 400,
//           height: 400,
//           objectFit: 'contain',
//           userSelect: 'none',
//           flexShrink: 0,
//         }}
//       />
//     </div>
//   )
// }

// export default function ChatPage() {
//   const navigate  = useNavigate()
//   const { messages, sessionId, addMessage, resetChat } = useChat()
//   const { authFetch, user, logout, hasPermission } = useAuth()

//   const [input,        setInput]        = useState('')
//   const [isTyping,     setIsTyping]     = useState(false)
//   const [debugOpen,    setDebugOpen]    = useState(false)
//   const [lastDebug,    setLastDebug]    = useState(null)
//   const [debugEnabled, setDebugEnabled] = useState(false)
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
//           <img src={logo} alt="Exprivia" className="exprivia-logo-sidebar" />
//           <div className="sidebar-brand-divider" />
//           <div className="sidebar-brand-text">
//             <span className="sidebar-brand-name">Policy Navigator</span>
//             <span className="sidebar-brand-sub">AI Assistant</span>
//           </div>
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
//           <button onClick={() => setDebugEnabled(d => !d)} style={{
//             width: '100%', padding: '7px 10px', marginBottom: 6,
//             background: debugEnabled ? 'var(--yellow-dim)' : 'transparent',
//             border: `1px solid ${debugEnabled ? 'rgba(240,173,58,0.38)' : 'var(--border-strong)'}`,
//             borderRadius: 'var(--radius-sm)',
//             color: debugEnabled ? 'var(--yellow)' : 'var(--text-muted)',
//             fontFamily: 'inherit', fontSize: '0.78rem', fontWeight: 600,
//             cursor: 'pointer', display: 'flex', alignItems: 'center', gap: 6,
//           }}>
//             <span>{debugEnabled ? '🔍' : '○'}</span>
//             Debug retrieval {debugEnabled ? 'ON' : 'OFF'}
//           </button>

//           {lastDebug && (
//             <button onClick={() => setDebugOpen(true)} style={{
//               width: '100%', padding: '7px 10px', marginBottom: 6,
//               background: 'var(--accent-dim)', border: '1px solid var(--border-accent)',
//               borderRadius: 'var(--radius-sm)', color: 'var(--accent-bright)',
//               fontFamily: 'inherit', fontSize: '0.78rem', fontWeight: 600, cursor: 'pointer',
//             }}>
//               🔍 Vedi {lastDebug.length} chunk recuperati
//             </button>
//           )}

//           <button className="admin-nav-btn" onClick={() => navigate('/profile')} style={{ marginBottom: 6 }}>
//             <span>👤</span>
//             {user?.nome ? `${user.nome} ${user.cognome || ''}`.trim() : user?.email}
//           </button>

//           {hasPermission('page_admin') && (
//             <button className="admin-nav-btn" onClick={() => navigate('/admin')} style={{ marginBottom: 6 }}>
//               <span>⚙</span> Pannello Admin
//             </button>
//           )}

//           <button
//             className="admin-nav-btn"
//             onClick={handleLogout}
//             style={{ color: 'var(--red)', borderColor: 'var(--red-dim)' }}
//           >
//             <span>↩</span> Esci
//           </button>

//           <div className="session-badge" style={{ marginTop: '8px' }}>
//             ID: {sessionId}
//           </div>

//           <ThemeToggle />
//         </div>
//       </aside>

//       <main className="chat-window">
//         {/* Robot watermark — positioned inside chat-window */}
//         <RobotWatermark />

//         <div className="chat-topbar" style={{ position: 'relative', zIndex: 1 }}>
//           <span className="topbar-title">Assistente documentale</span>
//           <div style={{ display: 'flex', alignItems: 'center', gap: 12 }}>
//             {debugEnabled && (
//               <span style={{
//                 fontSize: '0.72rem', fontFamily: "'JetBrains Mono', monospace",
//                 padding: '2px 8px', borderRadius: 20,
//                 background: 'var(--yellow-dim)', color: 'var(--yellow)',
//                 border: '1px solid rgba(240,173,58,0.32)',
//               }}>
//                 🔍 debug on
//               </span>
//             )}
//             <div className="online-indicator">
//               <div className="online-dot" />
//               Connesso
//             </div>
//           </div>
//         </div>

//         <div className="messages-display" style={{ position: 'relative', zIndex: 1 }}>
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
//               <div className="typing-dot" />
//               <div className="typing-dot" />
//               <div className="typing-dot" />
//             </div>
//           )}
//           <div ref={bottomRef} />
//         </div>

//         <div className="input-field-container" style={{ position: 'relative', zIndex: 1 }}>
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
// FIX link PDF, guard jailbreak only.
// NEW: sidebar mostra storico sessioni reale dal DB (GET /api/v1/chat/sessions).
//      Ogni sessione è cliccabile e ripristina la chat in sola lettura.
//      Il badge stelle CSAT appare sui messaggi bot.


// src/pages/ChatPage.jsx
// FIX link PDF, guard jailbreak only.
// NEW: sidebar mostra storico sessioni reale dal DB (GET /api/v1/chat/sessions).
//      Ogni sessione è cliccabile e ripristina la chat in sola lettura.
//      Il badge stelle CSAT appare sui messaggi bot.
// NEW: ripristino contesto backend via /chat/restore/ al click sulla sessione.

import { useState, useEffect, useRef, useCallback, forwardRef, useImperativeHandle } from 'react'
import { useNavigate } from 'react-router-dom'
import ReactMarkdown from 'react-markdown'
import remarkGfm from 'remark-gfm'
import { useChat } from '../context/ChatContext'
import { useAuth } from '../context/AuthContext'
import ThemeToggle from "../components/ThemeToggle"
import logo from "../assets/Logo Exprivia pulito.png"
import robotLogo from "../assets/Logo.png"

const BASE_SERVER_URL = 'https://127.0.0.1:8080'

const formatBotResponse = (text) => {
  if (!text) return ''
  return text.replace(/<\/?[A-Z]+>/g, '').trim()
}

function buildPdfHref(src) {
  if (!src) return null
  if (src.link) return `${BASE_SERVER_URL}${src.link}`
  if (src.title) return `${BASE_SERVER_URL}/api/v1/admin/pdf/${encodeURIComponent(src.title)}`
  return null
}

function buildDebugHref(chunk) {
  if (!chunk?.anchor_link) return null
  return `${BASE_SERVER_URL}${chunk.anchor_link}`
}

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
      let citationSrc = src
      if (match[2] && src.link) {
        const newLink = src.link.replace(/#page=\d+/, `#page=${match[2]}`)
        citationSrc = { ...src, link: newLink, page: match[2] }
      }
      parts.push({ type: 'citation', title: match[1].trim(), page, src: citationSrc })
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
              style={{ display:'inline-flex', alignItems:'center', gap:'3px',
                fontSize:'0.72em', fontFamily:"'JetBrains Mono', monospace",
                background:'var(--accent-dim)', border:'1px solid var(--border-accent)',
                borderRadius:'4px', padding:'1px 6px', color:'var(--accent-bright)',
                textDecoration:'none', verticalAlign:'middle', marginLeft:'2px',
                lineHeight:1.4, whiteSpace:'nowrap' }}>
              📄 {label}
            </a>
          ) : (
            <span key={i} style={{ fontSize:'0.72em', fontFamily:"'JetBrains Mono', monospace",
              background:'var(--accent-dim)', border:'1px solid var(--border-accent)',
              borderRadius:'4px', padding:'1px 6px', color:'var(--accent-bright)',
              verticalAlign:'middle', marginLeft:'2px' }}>
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

// ─── BotMessage con feedback CSAT ────────────────────────────
function BotMessage({ text, sources, logId, authFetch, isHistorical }) {
  const sourceMap    = buildSourceMap(sources)
  const cleanText    = formatBotResponse(text)
  const useInline    = hasInlineCitations(cleanText, sourceMap)
  const singleSource = sources && sources.length === 1
  const [csat, setCsat] = useState(null)

  const submitCsat = async (value) => {
    setCsat(value)
    if (!logId || !authFetch) return
    try {
      await authFetch(`/api/v1/chat/sessions/${logId}/feedback`, {
        method: 'POST',
        body: JSON.stringify({ csat: value }),
      })
    } catch (e) { console.error('feedback error', e) }
  }

  // Non mostrare stelle sui messaggi storici (non hanno log_id utile)
  const Stars = () => isHistorical ? null : (
    <div style={{ display:'flex', gap:3, marginTop:8, alignItems:'center' }}>
      <span style={{ fontSize:'0.65rem', color:'var(--text-muted)', marginRight:4 }}>
        Utile?
      </span>
      {[1,2,3,4,5].map(n => (
        <button key={n} onClick={() => submitCsat(n)}
          style={{ background:'none', border:'none', cursor:'pointer',
            fontSize:'0.9rem', padding:0, opacity: csat ? (csat === n ? 1 : 0.3) : 0.6,
            transition:'opacity 0.15s' }}>
          ★
        </button>
      ))}
      {csat && <span style={{ fontSize:'0.65rem', color:'var(--text-muted)', marginLeft:4 }}>Grazie!</span>}
    </div>
  )

  if (!useInline || singleSource) {
    return (
      <>
        <div className="message-content">
          <ReactMarkdown remarkPlugins={[remarkGfm]}>{cleanText}</ReactMarkdown>
        </div>
        {sources && sources.length > 0 && <SourcesFooter sources={sources} />}
        <Stars />
      </>
    )
  }
  return (
    <>
      <div className="message-content">
        <ReactMarkdown remarkPlugins={[remarkGfm]} components={{
          p:  ({ children }) => <p><ProcessChildren sourceMap={sourceMap}>{children}</ProcessChildren></p>,
          li: ({ children }) => <li><ProcessChildren sourceMap={sourceMap}>{children}</ProcessChildren></li>,
        }}>
          {cleanText}
        </ReactMarkdown>
      </div>
      <Stars />
    </>
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
                : <span style={{ color:'var(--text-dim)', fontSize:'0.75rem' }}>📄 {label}</span>
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
    <div style={{ position:'fixed', top:0, right:0, bottom:0, width:420,
      background:'var(--surface)', borderLeft:'1px solid var(--border-strong)',
      display:'flex', flexDirection:'column', zIndex:200,
      boxShadow:'-8px 0 36px rgba(0,0,0,0.45)' }}>
      <div style={{ padding:'16px 18px', borderBottom:'1px solid var(--border)',
        display:'flex', justifyContent:'space-between', alignItems:'center', flexShrink:0 }}>
        <div>
          <div style={{ fontWeight:700, fontSize:'0.9rem', color:'var(--text)' }}>🔍 Retrieval Debug</div>
          <div style={{ fontSize:'0.7rem', color:'var(--text-muted)', marginTop:2, fontFamily:"'JetBrains Mono', monospace" }}>
            {debugData?.length || 0} chunk recuperati
          </div>
        </div>
        <button onClick={onClose} style={{ background:'none', border:'1px solid var(--border-strong)',
          borderRadius:6, padding:'4px 10px', cursor:'pointer',
          color:'var(--text-muted)', fontFamily:'inherit', fontSize:'0.8rem' }}>✕ Chiudi</button>
      </div>
      <div style={{ flex:1, overflowY:'auto', padding:'12px 14px' }}>
        {(!debugData || debugData.length === 0) ? (
          <div style={{ color:'var(--text-muted)', fontSize:'0.78rem', textAlign:'center', padding:32 }}>
            Nessun chunk disponibile.
          </div>
        ) : debugData.map((chunk, i) => {
          const hasPage = chunk.pagina && chunk.pagina !== 'N/D' && chunk.pagina !== ''
          const href    = buildDebugHref(chunk)
          return (
            <div key={i} style={{ background:'var(--surface2)', border:'1px solid var(--border)',
              borderRadius:8, marginBottom:6, overflow:'hidden' }}>
              <div style={{ padding:'9px 12px', display:'flex', gap:8, alignItems:'flex-start' }}>
                <span style={{ fontSize:'0.65rem', fontFamily:"'JetBrains Mono', monospace",
                  color:'var(--accent-bright)', flexShrink:0, minWidth:24 }}>
                  C{chunk.chunk_idx}
                </span>
                <div style={{ flex:1, minWidth:0 }}>
                  <div style={{ fontSize:'0.75rem', fontWeight:600, color:'var(--text)',
                    overflow:'hidden', textOverflow:'ellipsis', whiteSpace:'nowrap' }}>
                    {chunk.titolo}
                  </div>
                  {chunk.breadcrumb && (
                    <div style={{ fontSize:'0.65rem', color:'var(--text-muted)', marginTop:1,
                      overflow:'hidden', textOverflow:'ellipsis', whiteSpace:'nowrap' }}>
                      {chunk.breadcrumb}
                    </div>
                  )}
                </div>
                <span style={{ fontSize:'0.65rem', fontFamily:"'JetBrains Mono', monospace",
                  padding:'2px 7px', borderRadius:20, flexShrink:0,
                  background: hasPage ? 'var(--accent-dim)' : 'var(--surface)',
                  color: hasPage ? 'var(--accent-bright)' : 'var(--text-muted)',
                  border: `1px solid ${hasPage ? 'var(--border-accent)' : 'var(--border)'}` }}>
                  {hasPage ? `p.${chunk.pagina}` : 'no pag.'}
                </span>
              </div>
              <div style={{ padding:'6px 12px 10px', borderTop:'1px solid var(--border)',
                fontSize:'0.7rem', fontFamily:"'JetBrains Mono', monospace",
                color:'var(--text-dim)', lineHeight:1.6 }}>
                {href && (
                  <a href={href} target="_blank" rel="noreferrer" style={{
                    fontSize:'0.65rem', color:'var(--green)', textDecoration:'none',
                    marginBottom:6, display:'inline-block' }}>
                    🔗 apri PDF (p.{chunk.pagina})
                  </a>
                )}
                <div style={{ background:'var(--bg)', borderRadius:4, padding:'6px 8px',
                  border:'1px solid var(--border)', whiteSpace:'pre-wrap',
                  maxHeight:120, overflowY:'auto' }}>{chunk.preview}</div>
              </div>
            </div>
          )
        })}
      </div>
    </div>
  )
}

// ─── Storico sessioni nella sidebar ──────────────────────────
const SessionHistory = forwardRef(function SessionHistory(
  { authFetch, onSelectSession, currentSessionId }, ref
) {
  const [sessions, setSessions]   = useState([])
  const [loading, setLoading]     = useState(false)
  const [expanded, setExpanded]   = useState(false)

  const load = useCallback(async () => {
    setLoading(true)
    try {
      const res  = await authFetch('/api/v1/chat/sessions?limit=15')
      const data = await res.json()
      setSessions(data.sessions || [])
    } catch { }
    finally { setLoading(false) }
  }, [authFetch])

  useImperativeHandle(ref, () => ({ reload: load }), [load])

  useEffect(() => { load() }, [load])

  const archiveSession = async (uuid, e) => {
    e.stopPropagation()
    try {
      await authFetch(`/api/v1/chat/sessions/${uuid}`, { method: 'DELETE' })
      setSessions(prev => prev.filter(s => s.session_uuid !== uuid))
    } catch { }
  }

  if (sessions.length === 0 && !loading) return null

  return (
    <div style={{ padding: '6px 10px 0' }}>
      <button
        onClick={() => setExpanded(e => !e)}
        style={{ width:'100%', background:'none', border:'none', cursor:'pointer',
          display:'flex', alignItems:'center', justifyContent:'space-between',
          padding:'6px 4px', color:'var(--text-muted)', fontSize:'0.67rem',
          fontWeight:700, textTransform:'uppercase', letterSpacing:'0.1em' }}>
        <span>Recenti</span>
        <span style={{ fontSize:'0.6rem' }}>{expanded ? '▲' : '▼'}</span>
      </button>

      {loading && (
        <div style={{ fontSize:'0.68rem', color:'var(--text-muted)', padding:'4px 8px' }}>
          Caricamento…
        </div>
      )}

      {expanded && sessions.map(sess => {
        const isCurrent = sess.session_uuid === currentSessionId
        return (
          <div key={sess.session_uuid}
            style={{ display:'flex', alignItems:'center', gap:4,
              padding:'6px 8px', borderRadius:'var(--radius-xs)',
              background: isCurrent ? 'var(--accent-dim)' : 'none',
              border: isCurrent ? '1px solid var(--border-accent)' : '1px solid transparent',
              cursor:'pointer', marginBottom:2, transition:'all 0.12s' }}
            onClick={() => onSelectSession(sess)}>
            <span style={{ fontSize:'0.72rem', flex:1, overflow:'hidden',
              textOverflow:'ellipsis', whiteSpace:'nowrap',
              color: isCurrent ? 'var(--accent-bright)' : 'var(--text-dim)' }}>
              💬 {sess.titolo || 'Conversazione'}
            </span>
            <span style={{ fontSize:'0.6rem', color:'var(--text-muted)',
              fontFamily:"'JetBrains Mono', monospace", flexShrink:0 }}>
              {sess.n_messaggi}
            </span>
            <button
              onClick={(e) => archiveSession(sess.session_uuid, e)}
              title="Archivia"
              style={{ background:'none', border:'none', cursor:'pointer',
                color:'var(--text-muted)', fontSize:'0.7rem', padding:'0 2px',
                flexShrink:0, opacity:0.5 }}>
              ✕
            </button>
          </div>
        )
      })}
    </div>
  )
})

function RobotWatermark() {
  return (
    <div style={{
      position: 'absolute', inset: 0,
      display: 'flex', alignItems: 'center', justifyContent: 'center',
      pointerEvents: 'none', zIndex: 0, overflow: 'hidden',
    }}>
      <img src={robotLogo} alt="" className="chat-robot-watermark"
        style={{ width: 400, height: 400, objectFit: 'contain', userSelect: 'none', flexShrink: 0 }}
      />
    </div>
  )
}

// ─────────────────────────────────────────────────────────────
// HELPER: normalizza fonti dal formato DB al formato BotMessage
// Il DB restituisce { titolo, link, pagina } oppure { documenti: [...] }
// BotMessage si aspetta { title, link, page }
// ─────────────────────────────────────────────────────────────
function normalizeSources(raw) {
  if (!raw || !Array.isArray(raw) || raw.length === 0) return []
  return raw
    .map(s => ({
      title: s.titolo || s.title || '',
      link:  s.link   || null,
      page:  s.pagina ?? s.page ?? null,
    }))
    .filter(s => s.title)
}

// ─────────────────────────────────────────────────────────────
// CHAT PAGE PRINCIPALE
// ─────────────────────────────────────────────────────────────
export default function ChatPage() {
  const navigate  = useNavigate()
  const { messages, sessionId, addMessage, resetChat, loadSession } = useChat()
  const { authFetch, user, logout, hasPermission } = useAuth()

  const [input,        setInput]        = useState('')
  const [isTyping,     setIsTyping]     = useState(false)
  const [debugOpen,    setDebugOpen]    = useState(false)
  const [lastDebug,    setLastDebug]    = useState(null)
  const [debugEnabled, setDebugEnabled] = useState(false)
  const [logIds,       setLogIds]       = useState({})
  // Tiene traccia di quanti messaggi sono "storici" (caricati dal DB)
  // così BotMessage sa se mostrare le stelle CSAT o no
  const [historicalCount, setHistoricalCount] = useState(0)
  const bottomRef         = useRef(null)
  const sessionHistoryRef = useRef(null)

  useEffect(() => {
    bottomRef.current?.scrollIntoView({ behavior: 'smooth' })
  }, [messages, isTyping])

  // Reset del contatore storico quando si resetta la chat
  const handleResetChat = useCallback(() => {
    resetChat()
    setHistoricalCount(0)
    setLogIds({})
  }, [resetChat])

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

      const botIdx = messages.length + 1
      addMessage({ role: 'bot', text: data.answer, sources: data.sources })

      if (data.log_id) {
        setLogIds(prev => ({ ...prev, [botIdx]: data.log_id }))
      }

      if (data.retrieval_debug) {
        setLastDebug(data.retrieval_debug)
        if (debugEnabled) setDebugOpen(true)
      }
      sessionHistoryRef.current?.reload()

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

  // ─────────────────────────────────────────────────────────────
  // handleSelectSession — ripristino sessione completo
  //
  // 1. Carica i messaggi visivi dal DB (GET /chat/sessions/:uuid)
  // 2. Imposta il sessionId = UUID storico (loadSession)
  // 3. Pre-riscalda il contesto nel backend (POST /chat/restore/:uuid)
  //    fire-and-forget: se fallisce, il lazy load nel chat_endpoint
  //    gestisce il ripristino al primo messaggio senza impatto UX
  // ─────────────────────────────────────────────────────────────
  const handleSelectSession = useCallback(async (sess) => {
    if (sess.session_uuid === sessionId) return

    try {
      // ── Step 1: carica messaggi dal DB ──────────────────────
      const res  = await authFetch(`/api/v1/chat/sessions/${sess.session_uuid}`)
      const data = await res.json()

      const INITIAL_MSG = {
        role: 'bot',
        text: 'Ciao, sono **Policy Navigator**. Posso aiutarti a trovare informazioni su policy aziendali, procedure e regolamenti. Come posso aiutarti?',
      }

      const msgs = [INITIAL_MSG]

      for (const m of (data.messaggi || [])) {
        msgs.push({ role: 'user', text: m.domanda })
        // Normalizza le fonti dal formato DB al formato atteso da BotMessage
        const rawSources = m.fonti || m.documenti || []
        msgs.push({
          role:    'bot',
          text:    m.risposta,
          sources: normalizeSources(rawSources),
          // Flag per disabilitare le stelle CSAT sui messaggi storici
          isHistorical: true,
        })
      }

      // Messaggio di conferma ripristino
      if (data.messaggi && data.messaggi.length > 0) {
        msgs.push({
          role: 'bot',
          text: `✅ **Conversazione ripristinata** — ${data.messaggi.length} messaggi caricati. Puoi continuare a scrivere.`,
          sources: [],
          isHistorical: true,
        })
      }

      // ── Step 2: aggiorna UI e sessionId ────────────────────
      // historicalCount = tutti i msg caricati dal DB (incluso INITIAL_MSG)
      // I nuovi messaggi avranno index >= historicalCount → non storici
      setHistoricalCount(msgs.length)
      setLogIds({})
      loadSession(msgs, sess.session_uuid)

      // ── Step 3: pre-riscalda il contesto nel backend ────────
      // Fire-and-forget: non blocca l'UI
      authFetch(`/api/v1/chat/restore/${sess.session_uuid}`, { method: 'POST' })
        .then(r => r.json())
        .then(result => {
          console.debug(
            `[session restore] ${sess.session_uuid}: ` +
            `restored=${result.restored} msgs=${result.n_messages} ` +
            `summary=${result.has_summary}`
          )
        })
        .catch(err => {
          // Silenzioso: il lazy load nel backend gestisce il fallimento
          console.warn('[session restore] pre-warm fallito (lazy load attivo):', err)
        })

    } catch (e) {
      console.error('Errore caricamento sessione:', e)
    }
  }, [authFetch, sessionId, loadSession])

  return (
    <div className="app-container">
      <aside className="chat-sidebar">
        <div className="sidebar-brand">
          <img src={logo} alt="Exprivia" className="exprivia-logo-sidebar" />
          <div className="sidebar-brand-divider" />
          <div className="sidebar-brand-text">
            <span className="sidebar-brand-name">Policy Navigator</span>
            <span className="sidebar-brand-sub">AI Assistant</span>
          </div>
        </div>

        <button className="new-chat-btn" onClick={handleResetChat}>
          <span>＋</span> Nuova chat
        </button>

        <div style={{ flex: 1, overflowY: 'auto', overflowX: 'hidden' }}>
          <SessionHistory
            ref={sessionHistoryRef}
            authFetch={authFetch}
            onSelectSession={handleSelectSession}
            currentSessionId={sessionId}
          />
        </div>

        <div className="sidebar-footer">
          <button onClick={() => setDebugEnabled(d => !d)} style={{
            width:'100%', padding:'7px 10px', marginBottom:6,
            background: debugEnabled ? 'var(--yellow-dim)' : 'transparent',
            border: `1px solid ${debugEnabled ? 'rgba(240,173,58,0.38)' : 'var(--border-strong)'}`,
            borderRadius:'var(--radius-sm)',
            color: debugEnabled ? 'var(--yellow)' : 'var(--text-muted)',
            fontFamily:'inherit', fontSize:'0.78rem', fontWeight:600,
            cursor:'pointer', display:'flex', alignItems:'center', gap:6 }}>
            <span>{debugEnabled ? '🔍' : '○'}</span>
            Debug retrieval {debugEnabled ? 'ON' : 'OFF'}
          </button>

          {lastDebug && (
            <button onClick={() => setDebugOpen(true)} style={{
              width:'100%', padding:'7px 10px', marginBottom:6,
              background:'var(--accent-dim)', border:'1px solid var(--border-accent)',
              borderRadius:'var(--radius-sm)', color:'var(--accent-bright)',
              fontFamily:'inherit', fontSize:'0.78rem', fontWeight:600, cursor:'pointer' }}>
              🔍 Vedi {lastDebug.length} chunk recuperati
            </button>
          )}

          <button className="admin-nav-btn" onClick={() => navigate('/profile')} style={{ marginBottom:6 }}>
            <span>👤</span>
            {user?.nome ? `${user.nome} ${user.cognome || ''}`.trim() : user?.email}
          </button>

          {hasPermission('page_admin') && (
            <button className="admin-nav-btn" onClick={() => navigate('/admin')} style={{ marginBottom:6 }}>
              <span>⚙</span> Pannello Admin
            </button>
          )}

          <button className="admin-nav-btn" onClick={handleLogout}
            style={{ color:'var(--red)', borderColor:'var(--red-dim)' }}>
            <span>↩</span> Esci
          </button>

          <ThemeToggle />
        </div>
      </aside>

      <main className="chat-window">
        <RobotWatermark />
        <div className="chat-topbar" style={{ position:'relative', zIndex:1 }}>
          <span className="topbar-title">Assistente documentale</span>
          <div style={{ display:'flex', alignItems:'center', gap:12 }}>
            {debugEnabled && (
              <span style={{ fontSize:'0.72rem', fontFamily:"'JetBrains Mono', monospace",
                padding:'2px 8px', borderRadius:20,
                background:'var(--yellow-dim)', color:'var(--yellow)',
                border:'1px solid rgba(240,173,58,0.32)' }}>
                🔍 debug on
              </span>
            )}
            <div className="online-indicator">
              <div className="online-dot" />
              Connesso
            </div>
          </div>
        </div>

        <div className="messages-display" style={{ position:'relative', zIndex:1 }}>
          {messages.map((msg, index) => (
            <div key={index} className={`bubble ${msg.role}`}>
              {msg.role === 'bot' ? (
                <BotMessage
                  text={msg.text}
                  sources={msg.sources}
                  logId={logIds[index]}
                  authFetch={authFetch}
                  // I messaggi con index < historicalCount sono storici
                  isHistorical={msg.isHistorical || index < historicalCount}
                />
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

        <div className="input-field-container" style={{ position:'relative', zIndex:1 }}>
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