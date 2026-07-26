import { useEffect } from "react";
import { selectActiveChatSessionId, useAppStore } from "../store";

/**
 * xterm's own DOM root. Everything the terminal renders (including the offscreen helper textarea that
 * actually receives keystrokes) lives under `.xterm`, so this is the library-native way to ask "is the
 * user typing into a shell?" — a class xterm sets itself, not a hook of ours it could stop honouring.
 */
const TERMINAL_ROOT_SELECTOR = ".xterm";

/** Whether a keydown originated inside a terminal, whose shell owns the raw chord. */
function isInTerminal(target: EventTarget | null): boolean {
	return target instanceof Element && target.closest(TERMINAL_ROOT_SELECTOR) !== null;
}

/**
 * App-wide keyboard chords the browser would otherwise take.
 *
 * **`Ctrl+R` — history search, not a page reload.** The chat's own recall chord was handled only on the
 * composer textarea, so with focus anywhere else (the file tree, Monaco, a diff, the transcript, plain
 * `<body>`) the browser reloaded the app instead. `Ctrl+R` is not a browser-*reserved* chord the way
 * `Ctrl+T`/`Ctrl+W`/`Ctrl+N` are, so a window listener can swallow it outright; this one does, in the
 * **capture** phase, and additionally `stopPropagation`s so the chord has exactly one handler app-wide
 * (the composer and the overlay no longer carry their own — see `chat/SPEC.md`).
 *
 * Deliberate exclusions:
 * - **Terminals.** `Ctrl+R` in a shell is reverse-i-search; the chord belongs to the PTY, so a keydown
 *   from inside `.xterm` passes straight through untouched.
 * - **`Ctrl+Shift+R`** (hard reload) and **`Cmd+R`** (macOS reload) are left alone, so reloading the app
 *   by keyboard is always still possible — alongside `F5` and the browser's own reload button.
 *
 * Routing: the request goes through the store rather than a ref, because the chord fires far outside the
 * chat subtree. `CenterTabs` mounts one tab body at a time, so `selectActiveChatSessionId` names the only
 * `ChatView` that exists; with a file tab active there is nothing to open and the chord is *only*
 * swallowed (never a reload, never a stray overlay on a hidden chat).
 */
export function useGlobalHotkeys(): void {
	useEffect(() => {
		const onKeyDown = (e: KeyboardEvent) => {
			if (e.key !== "r" || !e.ctrlKey || e.metaKey || e.altKey || e.shiftKey) return;
			if (isInTerminal(e.target)) return;
			e.preventDefault();
			e.stopPropagation();
			const sessionId = selectActiveChatSessionId(useAppStore.getState());
			if (sessionId) useAppStore.getState().requestHistoryOpen(sessionId);
		};
		window.addEventListener("keydown", onKeyDown, true);
		return () => window.removeEventListener("keydown", onKeyDown, true);
	}, []);
}
