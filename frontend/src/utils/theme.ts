export type ThemePreference =
  | "dark"
  | "light"
  | "high-contrast"
  | "dracula"
  | "nord"
  | "solarized-dark"
  | "solarized-light"
  | "claude-code"
  | "system";

export interface ThemeOption {
  id: ThemePreference;
  label: string;
  colorScheme: "dark" | "light" | "system";
}

export const THEMES: ThemeOption[] = [
  { id: "system", label: "System", colorScheme: "system" },
  { id: "dark", label: "Darcula", colorScheme: "dark" },
  { id: "light", label: "Light", colorScheme: "light" },
  { id: "high-contrast", label: "High Contrast", colorScheme: "dark" },
  { id: "dracula", label: "Dracula", colorScheme: "dark" },
  { id: "nord", label: "Nord", colorScheme: "dark" },
  { id: "solarized-dark", label: "Solarized Dark", colorScheme: "dark" },
  { id: "solarized-light", label: "Solarized Light", colorScheme: "light" },
  { id: "claude-code", label: "Claude Code", colorScheme: "dark" },
];

const VALID_THEMES = new Set<string>(THEMES.map((t) => t.id));
const STORAGE_KEY = "bonsai-theme";

export function getThemePreference(): ThemePreference {
  const saved = localStorage.getItem(STORAGE_KEY);
  if (saved && VALID_THEMES.has(saved)) {
    return saved as ThemePreference;
  }
  return "system";
}

export function applyTheme(preference: ThemePreference): void {
  const html = document.documentElement;
  if (preference === "system") {
    html.removeAttribute("data-theme");
  } else {
    html.setAttribute("data-theme", preference);
  }
  localStorage.setItem(STORAGE_KEY, preference);
  // Sync to backend (lazy import to avoid circular deps)
  import("../store/prefSync.ts").then(({ syncPref }) => {
    syncPref({ theme: preference });
  }).catch(() => {});
}

export function getEffectiveColorScheme(preference: ThemePreference): "dark" | "light" {
  const theme = THEMES.find((t) => t.id === preference);
  if (!theme || theme.colorScheme === "system") {
    return window.matchMedia("(prefers-color-scheme: light)").matches ? "light" : "dark";
  }
  return theme.colorScheme;
}
