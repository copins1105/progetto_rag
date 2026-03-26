// src/context/ChatContext.jsx
//
// Context globale per la chat.
// Salva messaggi e sessionId in memoria — sopravvivono alla navigazione
// chat ↔ admin finché l'utente non ricarica la pagina.

import { createContext, useContext, useState } from "react";

const ChatContext = createContext(null);

const INITIAL_MESSAGE = {
  role: "bot",
  text: "Ciao, sono **Policy Navigator**. Posso aiutarti a trovare informazioni su policy aziendali, procedure e regolamenti. Come posso aiutarti?",
};

const generateSessionId = () =>
  `session_${Math.random().toString(36).substr(2, 9)}`;

export function ChatProvider({ children }) {
  const [messages, setMessages] = useState([INITIAL_MESSAGE]);
  const [sessionId]             = useState(generateSessionId);

  const addMessage = (msg) => setMessages(prev => [...prev, msg]);

  const resetChat = () => setMessages([INITIAL_MESSAGE]);

  return (
    <ChatContext.Provider value={{ messages, sessionId, addMessage, resetChat }}>
      {children}
    </ChatContext.Provider>
  );
}

export function useChat() {
  const ctx = useContext(ChatContext);
  if (!ctx) throw new Error("useChat deve essere usato dentro ChatProvider");
  return ctx;
}
