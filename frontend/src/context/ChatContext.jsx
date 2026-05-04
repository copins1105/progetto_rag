// src/context/ChatContext.jsx
import { createContext, useContext, useState, useEffect, useCallback } from "react";
import { useAuth } from "./AuthContext";

const ChatContext = createContext(null);

const INITIAL_MESSAGE = {
  role: "bot",
  text: "Ciao, sono **Policy Navigator**. Posso aiutarti a trovare informazioni su policy aziendali, procedure e regolamenti. Come posso aiutarti?",
};


const generateSessionId = () => {
  const array = new Uint8Array(16)
  crypto.getRandomValues(array)
  return 'session_' + Array.from(array)
    .map(b => b.toString(16).padStart(2, '0'))
    .join('')
}

export function ChatProvider({ children }) {
  const { user } = useAuth();

  const [messages,  setMessages]  = useState([INITIAL_MESSAGE]);
  const [sessionId, setSessionId] = useState(generateSessionId);

  // Ogni volta che cambia l'utente (login/logout/switch),
  // resetta messaggi e genera un nuovo sessionId
  useEffect(() => {
    setMessages([INITIAL_MESSAGE]);
    setSessionId(generateSessionId());
  }, [user?.utente_id]); // dipendenza sull'ID utente, non sull'oggetto intero

  const addMessage = (msg) => setMessages(prev => [...prev, msg]);
  const resetChat  = () => {
    setMessages([INITIAL_MESSAGE]);
    setSessionId(generateSessionId());
  };

  const loadSession = useCallback((msgs, newSessionId) => {
  setMessages(msgs)
  setSessionId(newSessionId)
  }, []);

  return (
    <ChatContext.Provider value={{ messages, sessionId, addMessage, resetChat , loadSession}}>
      {children}
    </ChatContext.Provider>
  );
}

export function useChat() {
  const ctx = useContext(ChatContext);
  if (!ctx) throw new Error("useChat deve essere usato dentro ChatProvider");
  return ctx;
}