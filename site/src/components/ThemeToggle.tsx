/*
 * Theme cycle: system (default) -> light -> dark -> system. The chosen
 * PREFERENCE is stored in localStorage ("cueloop-theme"); the resolved theme
 * (always light or dark) drives [data-theme]. On "system" it follows the OS
 * live. The initial paint is handled by the inline head script (no flash);
 * this island only cycles and keeps the icon in sync. React Aria Button gives
 * keyboard + ARIA. Icons: monitor (system), sun (light), moon (dark).
 */
import { Button } from "react-aria-components";
import { useEffect, useState } from "react";

type Pref = "system" | "light" | "dark";
const ORDER: Pref[] = ["system", "light", "dark"];

function prefersDark(): boolean {
  return typeof matchMedia === "function" && matchMedia("(prefers-color-scheme: dark)").matches;
}

function resolve(pref: Pref): "light" | "dark" {
  if (pref === "system") return prefersDark() ? "dark" : "light";
  return pref;
}

function isPref(value: string | null): value is Pref {
  return value === "system" || value === "light" || value === "dark";
}

function MonitorIcon() {
  return (
    <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      <rect x="3" y="4" width="18" height="12" rx="1.5" />
      <path d="M8 20h8M12 16v4" />
    </svg>
  );
}

function SunIcon() {
  return (
    <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" aria-hidden="true">
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
  const [pref, setPref] = useState<Pref>("system");

  useEffect(() => {
    const stored = typeof localStorage !== "undefined" ? localStorage.getItem("cueloop-theme") : null;
    // oxlint-disable-next-line react/set-state-in-effect -- localStorage is unavailable during SSR, so read the stored pref after hydration
    setPref(isPref(stored) ? stored : "system");
  }, []);

  // While on "system", follow OS changes live.
  useEffect(() => {
    if (pref !== "system" || typeof matchMedia !== "function") return;
    const query = matchMedia("(prefers-color-scheme: dark)");
    const onChange = () => {
      document.documentElement.dataset.theme = query.matches ? "dark" : "light";
    };
    query.addEventListener("change", onChange);
    return () => query.removeEventListener("change", onChange);
  }, [pref]);

  function apply(next: Pref) {
    document.documentElement.dataset.theme = resolve(next);
    try {
      localStorage.setItem("cueloop-theme", next);
    } catch {
      // storage may be blocked; the choice just will not persist
    }
    setPref(next);
  }

  function cycle() {
    apply(ORDER[(ORDER.indexOf(pref) + 1) % ORDER.length]);
  }

  const label =
    pref === "system" ? "System theme" : pref === "light" ? "Light theme" : "Dark theme";

  return (
    <Button
      className="theme-toggle"
      onPress={cycle}
      aria-label={`Theme: ${label}. Click to switch.`}
      title={label}
    >
      {pref === "system" ? <MonitorIcon /> : pref === "light" ? <SunIcon /> : <MoonIcon />}
    </Button>
  );
}
