import { useEffect } from "react";
import { loader } from "@monaco-editor/react";
import { MONACO_THEMES, MONACO_THEME_PREFIX } from "./monacoThemes.ts";

const MONACO_THEME_NAME = `${MONACO_THEME_PREFIX}dark`;
const registeredThemes = new Set<string>();

// One-time install of a window-level filter for a known harmless Monaco
// race: "TextModel got disposed before DiffEditorWidget model got reset".
// It fires when a DiffEditor unmounts (e.g., switching the right-side
// panel away from a ticket session containing Write DiffCards, OR
// React StrictMode's dev-mode double-mount cycle) faster than Monaco's
// internal disposal flow. The editor is being torn down anyway; the
// error is purely noise. Monaco schedules it via setTimeout so it
// surfaces as an Uncaught Error on the window.
//
// Install EAGERLY at module load (not inside a hook's useEffect) so the
// filter is in place before any component has a chance to mount Monaco.
// Otherwise StrictMode's double-mount can fire the error during the
// first unmount, before any useEffect has run.
const MONACO_DISPOSAL_RACE_MESSAGE =
  "TextModel got disposed before DiffEditorWidget model got reset";

if (typeof window !== "undefined") {
  const filter = (event: ErrorEvent) => {
    const msg = event.error instanceof Error ? event.error.message : event.message;
    if (typeof msg === "string" && msg.includes(MONACO_DISPOSAL_RACE_MESSAGE)) {
      event.preventDefault();
      event.stopImmediatePropagation();
    }
  };
  // Capture-phase listener runs before any later-attached bubble listeners,
  // including React DevTools' or Vite's error overlays.
  window.addEventListener("error", filter, true);
  // Same race can also surface as an unhandled rejection in some Monaco
  // builds; cover that path too.
  window.addEventListener("unhandledrejection", (event) => {
    const reason = event.reason;
    const msg = reason instanceof Error ? reason.message : String(reason ?? "");
    if (msg.includes(MONACO_DISPOSAL_RACE_MESSAGE)) {
      event.preventDefault();
    }
  });
}

function registerAndApply(): void {
  loader.init().then((monaco) => {
    if (!registeredThemes.has(MONACO_THEME_NAME)) {
      monaco.editor.defineTheme(MONACO_THEME_NAME, MONACO_THEMES["dark"]);
      registeredThemes.add(MONACO_THEME_NAME);
    }
    monaco.editor.setTheme(MONACO_THEME_NAME);
  });
}

/**
 * Registers and applies the editor theme. Returns the Monaco theme name for
 * the `<Editor theme={...} />` prop.
 */
export function useMonacoTheme(): string {
  useEffect(() => {
    registerAndApply();
  }, []);

  return MONACO_THEME_NAME;
}
