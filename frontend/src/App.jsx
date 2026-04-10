// src/App.jsx
import { Routes, Route, Navigate } from "react-router-dom";
import { useAuth } from "./context/AuthContext";
import Login       from "./pages/Login";
import ChatPage    from "./pages/ChatPage";
import AdminPage   from "./pages/AdminPage";
import ProfilePage from "./pages/ProfilePage";

// ─── Route protetta per autenticazione ──────────────────────
function PrivateRoute({ children }) {
  const { token } = useAuth();
  return token ? children : <Navigate to="/login" replace />;
}

// ─── Route protetta per permesso specifico ───────────────────
// Usata per proteggere le pagine in base ai permessi RBAC.
// Se l'utente non ha il permesso → redirect alla home (chat).
function PermissionRoute({ codice, children }) {
  const { token, hasPermission } = useAuth();
  if (!token)               return <Navigate to="/login" replace />;
  if (!hasPermission(codice)) return <Navigate to="/"    replace />;
  return children;
}

export default function App() {
  const { token } = useAuth();

  return (
    <Routes>
      {/* Login — se già autenticato reindirizza alla chat */}
      <Route
        path="/login"
        element={token ? <Navigate to="/" replace /> : <Login />}
      />

      {/* Chat — richiede page_chat */}
      <Route path="/" element={
        <PermissionRoute codice="page_chat">
          <ChatPage />
        </PermissionRoute>
      }/>

      {/* Profilo — richiede page_profile */}
      <Route path="/profile" element={
        <PermissionRoute codice="page_profile">
          <ProfilePage />
        </PermissionRoute>
      }/>

      {/* Admin — richiede page_admin */}
      <Route path="/admin" element={
        <PermissionRoute codice="page_admin">
          <AdminPage />
        </PermissionRoute>
      }/>

      {/* Fallback */}
      <Route path="*" element={<Navigate to="/" replace />} />
    </Routes>
  );
}