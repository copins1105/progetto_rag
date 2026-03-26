import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import { BrowserRouter } from 'react-router-dom'
import './index.css'
import App from './App.jsx'
import { IngestionProvider } from './context/IngestionContext.jsx'
import { ChatProvider } from './context/ChatContext.jsx'
 
createRoot(document.getElementById('root')).render(
  <StrictMode>
    <BrowserRouter>
      <IngestionProvider>
        <ChatProvider>
          <App />
        </ChatProvider>
      </IngestionProvider>
    </BrowserRouter>
  </StrictMode>,
)
 