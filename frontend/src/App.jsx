// src/App.jsx
import { Routes, Route, Navigate } from "react-router-dom";
import { useAuth } from "./context/AuthContext";
import Login       from "./pages/Login";
import ChatPage    from "./pages/ChatPage";
import AdminPage   from "./pages/AdminPage";
import ProfilePage from "./pages/ProfilePage";

function PrivateRoute({ children }) {
  const { token } = useAuth();
  return token ? children : <Navigate to="/login" replace />;
}

function AdminRoute({ children }) {
  const { token, isAdmin } = useAuth();
  if (!token)   return <Navigate to="/login" replace />;
  if (!isAdmin) return <Navigate to="/"     replace />;
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

      {/* Route protette */}
      <Route path="/" element={
        <PrivateRoute><ChatPage /></PrivateRoute>
      }/>
      <Route path="/profile" element={
        <PrivateRoute><ProfilePage /></PrivateRoute>
      }/>
      <Route path="/admin" element={
        <AdminRoute><AdminPage /></AdminRoute>
      }/>

      {/* Fallback */}
      <Route path="*" element={<Navigate to="/" replace />} />
    </Routes>
  );
}
