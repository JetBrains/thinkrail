import { useUiStore } from "@/store/uiStore.ts";
import { useSessionStore } from "@/store/sessionStore.ts";
import { isMod } from "@/utils/platform.ts";

function isTextInput(el: EventTarget | null): boolean {
  if (!el || !(el instanceof HTMLElement)) return false;
  const tag = el.tagName;
  if (tag === "INPUT" || tag === "TEXTAREA") return true;
  if (el.isContentEditable) return true;
  return false;
}

export function registerKeyboardShortcuts(): () => void {
  function handler(e: KeyboardEvent) {
    const meta = isMod(e);
    const store = useUiStore.getState();

    // Escape — always works, closes topmost overlay
    if (e.key === "Escape") {
      if (store.paletteOpen) {
        store.togglePalette();
        e.preventDefault();
      }
      return;
    }

    // Skip other shortcuts when text input focused
    if (isTextInput(e.target)) return;

    if (!meta) return;

    switch (e.key) {
      case "b": // Mod+B — toggle left panel
        e.preventDefault();
        store.toggleLeftPanel();
        break;
      case "k": // Mod+K — command palette
        e.preventDefault();
        store.togglePalette();
        break;
      case "t": // Mod+T — new session
        e.preventDefault();
        useSessionStore.getState().createNewSession();
        break;
    }
  }

  document.addEventListener("keydown", handler);
  return () => document.removeEventListener("keydown", handler);
}
