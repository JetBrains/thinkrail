export type ThemePreference = "dark" | "light" | "system";

const STORAGE_KEY = "bonsai-theme";

export function getThemePreference(): ThemePreference {
  const saved = localStorage.getItem(STORAGE_KEY);
  if (saved === "dark" || saved === "light" || saved === "system") {
    return saved;
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
}
