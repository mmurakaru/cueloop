/*
 * Light (paper) <-> dark (sumi) toggle. The initial theme is set by an inline
 * head script before paint (no flash); this island only flips and persists it.
 * React Aria ToggleButton gives keyboard + ARIA behaviour for free.
 */
import { ToggleButton } from "react-aria-components";
import { useEffect, useState } from "react";

type Theme = "light" | "dark";

function currentTheme(): Theme {
  if (typeof document === "undefined") return "light";
  return (document.documentElement.dataset.theme as Theme) ?? "light";
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
      <span aria-hidden="true">{isDark ? "sun" : "moon"}</span>
    </ToggleButton>
  );
}
