// src/components/ThemeToggle.jsx
//
// Pulsante toggle dark/light con icona animata.
// Va inserito nella sidebar footer e/o nell'admin topbar.

import { useTheme } from "../context/ThemeContext";

export default function ThemeToggle({ style = {} }) {
  const { theme, toggleTheme } = useTheme();
  const isDark = theme === "dark";

  return (
    <button
      className="theme-toggle"
      onClick={toggleTheme}
      title={isDark ? "Passa alla modalità chiara" : "Passa alla modalità scura"}
      style={style}
    >
      <span className="theme-toggle-icon">
        {isDark ? "☀️" : "🌙"}
      </span>
      {isDark ? "Modalità chiara" : "Modalità scura"}
    </button>
  );
}
