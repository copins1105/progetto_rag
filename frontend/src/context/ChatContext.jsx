// src/context/ChatContext.jsx
import { createContext, useContext, useState, useEffect } from "react";
import { useAuth } from "./AuthContext";

const ChatContext = createContext(null);

const INITIAL_MESSAGE = {
  role: "bot",
  text: "Ciao, sono **Policy Navigator**. Posso aiutarti a trovare informazioni su policy aziendali, procedure e regolamenti. Come posso aiutarti?",
};

const generateSessionId = () =>
  `session_${Math.random().toString(36).substr(2, 9)}`;

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