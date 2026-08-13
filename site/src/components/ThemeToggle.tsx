/*
 * Light (paper) <-> dark (Rosé Pine Moon) toggle. The initial theme is set by an
 * inline head script before paint (no flash); this island only flips and
 * persists it. React Aria ToggleButton gives keyboard + ARIA behaviour. Shows a
 * sun icon in dark mode (tap for light) and a moon icon in light mode.
 */
import { ToggleButton } from "react-aria-components";
import { useEffect, useState } from "react";

type Theme = "light" | "dark";

function currentTheme(): Theme {
  if (typeof document === "undefined") return "light";
  return (document.documentElement.dataset.theme as Theme) ?? "light";
}

function SunIcon() {
  return (
    <svg
      width="16"
      height="16"
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="2"
      strokeLinecap="round"
      aria-hidden="true"
    >
      <circle cx="12" cy="12" r="4" />
      <path d="M12 2v2M12 20v2M4.9 4.9l1.4 1.4M17.7 17.7l1.4 1.4M2 12h2M20 12h2M4.9 19.1l1.4-1.4M17.7 6.3l1.4-1.4" />
    </svg>
  );
}

function MoonIcon() {
  return (
    <svg width="16" height="16" viewBox="0 0 24 24" fill="currentColor" aria-hidden="true">
      <path d="M21 12.79A9 9 0 1 1 11.21 3 7 7 0 0 0 21 12.79z" />
    </svg>
  );
}

export default function ThemeToggle() {
  const [theme, setTheme] = useState<Theme>("light");

  useEffect(() => {
    setTheme(currentTheme());
  }, []);

  function apply(next: Theme) {
    document.documentElement.dataset.theme = next;
    try {
      localStorage.setItem("cueloop-theme", next);
    } catch {
      // storage may be blocked; the choice just will not persist
    }
    setTheme(next);
  }

  const isDark = theme === "dark";
  return (
    <ToggleButton
      className="theme-toggle"
      aria-label={isDark ? "Switch to light theme" : "Switch to dark theme"}
      isSelected={isDark}
      onChange={(selected) => apply(selected ? "dark" : "light")}
    >
      {isDark ? <SunIcon /> : <MoonIcon />}
    </ToggleButton>
  );
}
