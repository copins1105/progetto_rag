import { useState } from 'react'
import { Routes, Route, Navigate } from 'react-router-dom'
import Login from './pages/Login'
import ChatPage from './pages/ChatPage'
import AdminPage from './pages/AdminPage'

function App() {
  const [isLoggedIn, setIsLoggedIn] = useState(false)

  // Se non loggato, qualsiasi route mostra il Login
  if (!isLoggedIn) {
    return <Login onLogin={() => setIsLoggedIn(true)} />
  }

  return (
    <Routes>
      <Route path="/"      element={<ChatPage />} />
      <Route path="/admin" element={<AdminPage />} />
      {/* Qualsiasi altro path → redirect alla chat */}
      <Route path="*"      element={<Navigate to="/" replace />} />
    </Routes>
  )
}

export default App
