// src/pages/ChatPage.jsx
import { useState, useEffect, useRef } from 'react'
import { useNavigate } from 'react-router-dom'
import ReactMarkdown from 'react-markdown'
import remarkGfm from 'remark-gfm'
import { useChat } from '../context/ChatContext'

const BASE_SERVER_URL = 'http://127.0.0.1:8080'
const API_URL_V1 = `${BASE_SERVER_URL}/api/v1`

const formatBotResponse = (text) => {
  if (!text) return ''
  return text.replace(/<\/?[A-Z]+>/g, '').trim()
}

// ─────────────────────────────────────────────
// CITATION HELPERS
// Il backend ora emette citazioni nel formato [TITOLO_DOCUMENTO]
// dove TITOLO_DOCUMENTO è esattamente il valore di titolo_documento
// presente nei metadati ChromaDB (es. "ETH-COD-001" o "BANDO DI SELEZIONE CORSI ITS")
// ─────────────────────────────────────────────

/**
 * Costruisce una mappa normalizzata: { titolo_normalizzato → source }
 * La normalizzazione (lowercase + trim) permette il match anche se
 * ci sono piccole differenze di maiuscole tra testo e sources.
 */
function buildSourceMap(sources) {
  const map = {}
  if (!sources) return map
  for (const src of sources) {
    if (src.title) {
      map[src.title.trim().toLowerCase()] = src
    }
  }
  return map
}

/**
 * Cerca nel testo il pattern [qualsiasi testo] e verifica se
 * il contenuto matcha una delle sources disponibili.
 * Usa normalizzazione lowercase per confronto robusto.
 */
// Formato citazione: [TITOLO_DOCUMENTO|pPAGINA] oppure [TITOLO_DOCUMENTO] (senza pagina)
const BRACKET_RE = /\[([^\]|]+)(?:\|p(\d+))?\]/g

function findCitationsInText(text, sourceMap) {
  const found = []
  let match
  const regex = new RegExp(BRACKET_RE.source, 'g')
  while ((match = regex.exec(text)) !== null) {
    const titleRaw = match[1].trim()
    const pageOverride = match[2] || null   // pagina estratta dalla citazione, es "4"
    const inner = titleRaw.toLowerCase()
    if (sourceMap[inner]) {
      found.push({
        fullMatch: match[0],
        title: titleRaw,
        page: pageOverride,
        src: sourceMap[inner]
      })
    }
  }
  return found
}

function hasInlineCitations(text, sourceMap) {
  if (!text || Object.keys(sourceMap).length === 0) return false
  return findCitationsInText(text, sourceMap).length > 0
}

/**
 * Spezza una stringa di testo in parti, sostituendo [TITOLO] con
 * pill cliccabili che linkano al PDF alla pagina giusta.
 */
function InlineCitationText({ text, sourceMap }) {
  const parts = []
  let lastIndex = 0
  let match

  const regex = new RegExp(BRACKET_RE.source, 'g')
  while ((match = regex.exec(text)) !== null) {
    const inner = match[1].trim().toLowerCase()
    const src   = sourceMap[inner]

    if (match.index > lastIndex) {
      parts.push({ type: 'text', content: text.slice(lastIndex, match.index) })
    }

    if (src) {
      parts.push({ type: 'citation', title: match[1].trim(), src })
    } else {
      // Parentesi quadre non corrispondono a nessuna source → lascia invariato
      parts.push({ type: 'text', content: match[0] })
    }

    lastIndex = match.index + match[0].length
  }

  if (lastIndex < text.length) {
    parts.push({ type: 'text', content: text.slice(lastIndex) })
  }

  return (
    <span>
      {parts.map((part, i) => {
        if (part.type === 'citation') {
          // Usa la pagina estratta dalla citazione [TITOLO|pN] se disponibile,
          // altrimenti fallback sulla pagina del metadata source
          const pageNum = part.page || part.src.page
          const href    = part.src.link ? `${BASE_SERVER_URL}${part.src.link}` : null
          const label   = pageNum
            ? `${part.title} · p.${pageNum}`
            : part.title

          return href ? (
            <a
              key={i}
              href={href}
              target="_blank"
              rel="noreferrer"
              style={{
                display: 'inline-flex', alignItems: 'center', gap: '3px',
                fontSize: '0.72em', fontFamily: "'DM Mono', monospace",
                background: 'rgba(79,142,247,0.12)',
                border: '1px solid rgba(79,142,247,0.3)',
                borderRadius: '4px', padding: '1px 6px',
                color: 'var(--accent)', textDecoration: 'none',
                verticalAlign: 'middle', marginLeft: '2px',
                lineHeight: 1.4, whiteSpace: 'nowrap',
                transition: 'background 0.15s',
              }}
              onMouseEnter={e => e.currentTarget.style.background = 'rgba(79,142,247,0.22)'}
              onMouseLeave={e => e.currentTarget.style.background = 'rgba(79,142,247,0.12)'}
            >
              📄 {label}
            </a>
          ) : (
            <span key={i} style={{
              fontSize: '0.72em', fontFamily: "'DM Mono', monospace",
              background: 'rgba(79,142,247,0.08)',
              border: '1px solid rgba(79,142,247,0.2)',
              borderRadius: '4px', padding: '1px 6px',
              color: 'var(--accent)', verticalAlign: 'middle', marginLeft: '2px',
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

/**
 * Processa i children React di un nodo (p, li, ecc.)
 * sostituendo le stringhe testuali che contengono citazioni.
 */
function ProcessChildren({ children, sourceMap }) {
  const processNode = (node, i) => {
    if (typeof node === 'string') {
      const inner = node.trim().toLowerCase()
      // Controlla se c'è almeno una citazione nella stringa
      const hasCit = findCitationsInText(node, sourceMap).length > 0
      if (hasCit) {
        return <InlineCitationText key={i} text={node} sourceMap={sourceMap} />
      }
      return node
    }
    return node
  }

  if (Array.isArray(children)) {
    return <>{children.map((child, i) => processNode(child, i))}</>
  }
  return <>{processNode(children, 0)}</>
}

// ─────────────────────────────────────────────
// BOT MESSAGE — decide inline vs footer
// ─────────────────────────────────────────────
function BotMessage({ text, sources }) {
  const sourceMap  = buildSourceMap(sources)
  const cleanText  = formatBotResponse(text)
  const useInline  = hasInlineCitations(cleanText, sourceMap)
  // Con una sola fonte non ha senso mettere i link su ogni frase
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

  // Citazioni inline: sostituisce [TITOLO] con pill, non mostra footer
  return (
    <div className="message-content">
      <ReactMarkdown
        remarkPlugins={[remarkGfm]}
        components={{
          p: ({ children }) => (
            <p><ProcessChildren sourceMap={sourceMap}>{children}</ProcessChildren></p>
          ),
          li: ({ children }) => (
            <li><ProcessChildren sourceMap={sourceMap}>{children}</ProcessChildren></li>
          ),
        }}
      >
        {cleanText}
      </ReactMarkdown>
    </div>
  )
}

// ─────────────────────────────────────────────
// SOURCES FOOTER
// ─────────────────────────────────────────────
function SourcesFooter({ sources }) {
  if (!sources || sources.length === 0) return null
  return (
    <div className="sources-section">
      <p className="sources-title">Fonti</p>
      <div className="sources-grid">
        {sources.map((src, i) => (
          <div key={i} className="source-tag">
            <a href={`${BASE_SERVER_URL}${src.link}`} target="_blank" rel="noreferrer">
              📄 {src.title} · p.{src.page}
            </a>
          </div>
        ))}
      </div>
    </div>
  )
}

// ─────────────────────────────────────────────
// CHAT PAGE
// ─────────────────────────────────────────────
function ChatPage() {
  const navigate  = useNavigate()
  const { messages, sessionId, addMessage, resetChat } = useChat()
  const [input, setInput]       = useState('')
  const [isTyping, setIsTyping] = useState(false)
  const bottomRef               = useRef(null)

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
      const response = await fetch(`${API_URL_V1}/chat`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ question: userQuery, session_id: sessionId }),
      })
      const data = await response.json()
      addMessage({ role: 'bot', text: data.answer, sources: data.sources })
    } catch {
      addMessage({ role: 'bot', text: 'Errore di connessione al server.' })
    } finally {
      setIsTyping(false)
    }
  }

  return (
    <div className="app-container">
      <aside className="chat-sidebar">
        <div className="sidebar-brand">
          <div className="sidebar-brand-icon">⚡</div>
          <span className="sidebar-brand-name">Policy Navigator</span>
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
          <button className="admin-nav-btn" onClick={() => navigate('/admin')}>
            <span>⚙</span> Pannello Admin
          </button>
          <div className="session-badge" style={{ marginTop: '8px' }}>
            ID: {sessionId}
          </div>
        </div>
      </aside>

      <main className="chat-window">
        <div className="chat-topbar">
          <span className="topbar-title">Assistente documentale</span>
          <div className="online-indicator">
            <div className="online-dot" />
            Connesso
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
    </div>
  )
}

export default ChatPage