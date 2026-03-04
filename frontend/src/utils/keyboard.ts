import { useUiStore } from "@/store/uiStore.ts";

function isTextInput(el: EventTarget | null): boolean {
  if (!el || !(el instanceof HTMLElement)) return false;
  const tag = el.tagName;
  if (tag === "INPUT" || tag === "TEXTAREA") return true;
  if (el.isContentEditable) return true;
  return false;
}

export function registerKeyboardShortcuts(): () => void {
  function handler(e: KeyboardEvent) {
    const meta = e.metaKey || e.ctrlKey;
    const store = useUiStore.getState();

    // Escape — always works, closes topmost overlay
    if (e.key === "Escape") {
      if (store.paletteOpen) {
        store.togglePalette();
        e.preventDefault();
      } else if (store.modalOpen) {
        store.closeModal();
        e.preventDefault();
      }
      return;
    }

    // Skip other shortcuts when text input focused
    if (isTextInput(e.target)) return;

    // Ctrl+B — toggle left panel
    if (e.key === "b" && e.ctrlKey && !e.metaKey) {
      e.preventDefault();
      store.toggleLeftPanel();
      return;
    }

    if (!meta) return;

    switch (e.key) {
      case "k": // Cmd+K — command palette
        e.preventDefault();
        store.togglePalette();
        break;
      case "t": // Cmd+T — new session
        e.preventDefault();
        store.openModal();
        break;
      case "j": // Cmd+J — toggle right panel
        e.preventDefault();
        store.toggleRightPanel();
        break;
    }
  }

  document.addEventListener("keydown", handler);
  return () => document.removeEventListener("keydown", handler);
}
