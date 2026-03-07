import { useState, useRef, useEffect, useCallback } from "react";
import {
  type ThemePreference,
  THEMES,
  getThemePreference,
  applyTheme,
} from "@/utils/theme.ts";

function ThemeIcon({ scheme }: { scheme: "dark" | "light" | "system" }) {
  if (scheme === "system") {
    return (
      <svg width="16" height="16" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.5">
        <rect x="2" y="3" width="12" height="9" rx="1" />
        <line x1="5" y1="14" x2="11" y2="14" />
      </svg>
    );
  }
  if (scheme === "light") {
    return (
      <svg width="16" height="16" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.5">
        <circle cx="8" cy="8" r="3" />
        <line x1="8" y1="1.5" x2="8" y2="3" />
        <line x1="8" y1="13" x2="8" y2="14.5" />
        <line x1="1.5" y1="8" x2="3" y2="8" />
        <line x1="13" y1="8" x2="14.5" y2="8" />
        <line x1="3.4" y1="3.4" x2="4.5" y2="4.5" />
        <line x1="11.5" y1="11.5" x2="12.6" y2="12.6" />
        <line x1="3.4" y1="12.6" x2="4.5" y2="11.5" />
        <line x1="11.5" y1="4.5" x2="12.6" y2="3.4" />
      </svg>
    );
  }
  return (
    <svg width="16" height="16" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.5">
      <path d="M13.5 9.5a5.5 5.5 0 0 1-7-7 5.5 5.5 0 1 0 7 7z" />
    </svg>
  );
}

export function ThemeSwitcher() {
  const [current, setCurrent] = useState<ThemePreference>(getThemePreference);
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLDivElement>(null);

  const handleSelect = useCallback((id: ThemePreference) => {
    applyTheme(id);
    setCurrent(id);
    setOpen(false);
  }, []);

  useEffect(() => {
    if (!open) return;
    function handleClick(e: MouseEvent) {
      if (ref.current && !ref.current.contains(e.target as Node)) {
        setOpen(false);
      }
    }
    document.addEventListener("mousedown", handleClick);
    return () => document.removeEventListener("mousedown", handleClick);
  }, [open]);

  const currentTheme = THEMES.find((t) => t.id === current);
  const buttonScheme =
    currentTheme?.colorScheme === "system"
      ? "system"
      : currentTheme?.colorScheme ?? "dark";

  return (
    <div className="theme-switcher" ref={ref}>
      <button
        className="header-btn theme-btn"
        onClick={() => setOpen((o) => !o)}
        title="Switch theme"
      >
        <ThemeIcon scheme={buttonScheme} />
      </button>
      {open && (
        <div className="theme-dropdown">
          {THEMES.map((t) => (
            <button
              key={t.id}
              className={`theme-option${t.id === current ? " theme-option-active" : ""}`}
              onClick={() => handleSelect(t.id)}
            >
              <ThemeIcon
                scheme={
                  t.colorScheme === "system"
                    ? "system"
                    : t.colorScheme
                }
              />
              <span>{t.label}</span>
            </button>
          ))}
        </div>
      )}
    </div>
  );
}
