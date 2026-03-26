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
      addMessage({
        role: 'bot',
        text: data.answer,
        sources: data.sources,
      })
    } catch {
      addMessage({
        role: 'bot',
        text: 'Errore di connessione al server.',
      })
    } finally {
      setIsTyping(false)
    }
  }

  return (
    <div className="app-container">
      {/* Sidebar */}
      <aside className="chat-sidebar">
        <div className="sidebar-brand">
          <div className="sidebar-brand-icon">⚡</div>
          <span className="sidebar-brand-name">Policy Navigator</span>
        </div>

        <button
          className="new-chat-btn"
          onClick={resetChat}
        >
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
          <button
            className="admin-nav-btn"
            onClick={() => navigate('/admin')}
          >
            <span>⚙</span> Pannello Admin
          </button>
          <div className="session-badge" style={{ marginTop: '8px' }}>
            ID: {sessionId}
          </div>
        </div>
      </aside>

      {/* Chat */}
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
              <div className="message-content">
                {msg.role === 'bot' ? (
                  <ReactMarkdown remarkPlugins={[remarkGfm]}>
                    {formatBotResponse(msg.text)}
                  </ReactMarkdown>
                ) : (
                  msg.text
                )}
              </div>

              {msg.role === 'bot' && msg.sources?.length > 0 && (
                <div className="sources-section">
                  <p className="sources-title">Fonti</p>
                  <div className="sources-grid">
                    {msg.sources.map((src, sIdx) => (
                      <div key={sIdx} className="source-tag">
                        <a
                          href={`${BASE_SERVER_URL}${src.link}`}
                          target="_blank"
                          rel="noreferrer"
                        >
                          📄 {src.title} · p.{src.page}
                        </a>
                      </div>
                    ))}
                  </div>
                </div>
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
