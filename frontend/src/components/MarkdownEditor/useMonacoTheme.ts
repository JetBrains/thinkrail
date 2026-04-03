import { useEffect, useState } from "react";
import { loader } from "@monaco-editor/react";
import { getThemePreference, getEffectiveColorScheme } from "@/utils/theme.ts";
import { MONACO_THEMES, MONACO_THEME_PREFIX } from "./monacoThemes.ts";

const registeredThemes = new Set<string>();

function resolveMonacoThemeName(): string {
  const pref = getThemePreference();
  if (pref === "system") {
    const scheme = getEffectiveColorScheme(pref);
    return scheme === "light" ? "light" : "dark";
  }
  return pref;
}

function registerAndApply(bonsaiTheme: string): string {
  const monacoName = `${MONACO_THEME_PREFIX}${bonsaiTheme}`;
  const definition = MONACO_THEMES[bonsaiTheme] ?? MONACO_THEMES["dark"];

  loader.init().then((monaco) => {
    if (!registeredThemes.has(monacoName)) {
      monaco.editor.defineTheme(monacoName, definition);
      registeredThemes.add(monacoName);
    }
    monaco.editor.setTheme(monacoName);
  });

  return monacoName;
}

/**
 * Hook that syncs Monaco editor theme with the active Bonsai theme.
 * Listens for `data-theme` attribute changes on `<html>` and updates
 * all Monaco instances globally.
 *
 * Returns the current Monaco theme name for the `<Editor theme={...} />` prop.
 */
export function useMonacoTheme(): string {
  const [themeName, setThemeName] = useState(() => {
    const bonsai = resolveMonacoThemeName();
    return `${MONACO_THEME_PREFIX}${bonsai}`;
  });

  useEffect(() => {
    // Apply on mount
    const initial = resolveMonacoThemeName();
    const name = registerAndApply(initial);
    setThemeName(name);

    // Watch for data-theme attribute changes
    const observer = new MutationObserver(() => {
      const current = resolveMonacoThemeName();
      const newName = registerAndApply(current);
      setThemeName(newName);
    });

    observer.observe(document.documentElement, {
      attributes: true,
      attributeFilter: ["data-theme"],
    });

    // Also listen for system color scheme changes (for "system" preference)
    const mediaQuery = window.matchMedia("(prefers-color-scheme: light)");
    const handleSchemeChange = () => {
      const current = resolveMonacoThemeName();
      const newName = registerAndApply(current);
      setThemeName(newName);
    };
    mediaQuery.addEventListener("change", handleSchemeChange);

    return () => {
      observer.disconnect();
      mediaQuery.removeEventListener("change", handleSchemeChange);
    };
  }, []);

  return themeName;
}
