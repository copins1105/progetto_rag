// src/main.jsx
import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import { BrowserRouter } from "react-router-dom";
import "./index.css";
import App from "./App.jsx";
import { AuthProvider }      from "./context/AuthContext.jsx";
import { IngestionProvider } from "./context/IngestionContext.jsx";
import { ChatProvider }      from "./context/ChatContext.jsx";
import { ThemeProvider } from "./context/ThemeContext";
createRoot(document.getElementById("root")).render(
  <StrictMode>
    <BrowserRouter>
      {/* AuthProvider avvolge tutto: token disponibile ovunque */}
      <ThemeProvider>
        <AuthProvider>
          <IngestionProvider>
            <ChatProvider>
              <App />
            </ChatProvider>
          </IngestionProvider>
        </AuthProvider>
       </ThemeProvider>
    </BrowserRouter>
  </StrictMode>
);
