import { useEffect } from "react";
import { selectHistoryTarget, useAppStore } from "../store";

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
 * **Matched by `e.code`, not `e.key`.** `e.key` is the character the key *produces*, which depends on the
 * active layout: on a Cyrillic layout the R key yields `к`, so a `e.key !== "r"` guard bailed out before
 * `preventDefault()` and the browser reloaded the app — the exact behaviour this hook exists to prevent.
 * `e.code` names the physical key, so the chord works on every layout. This also matches the terminal one
 * layer down: xterm resolves its own chords through `keyCode`, which browsers derive from the US layout.
 *
 * Deliberate exclusions:
 * - **Terminals.** `Ctrl+R` in a shell is reverse-i-search; the chord belongs to the PTY, so a keydown
 *   from inside `.xterm` passes straight through untouched.
 * - **`Ctrl+Shift+R`** (hard reload) and **`Cmd+R`** (macOS reload) are left alone, so reloading the app
 *   by keyboard is always still possible — alongside `F5` and the browser's own reload button.
 *
 * Routing: the request goes through the store rather than a ref, because the chord fires far outside the
 * chat subtree. `selectHistoryTarget` resolves which chat it means — the active tab when that's a chat,
 * else the workspace's most recently opened one — and `requestHistoryOpen` activates that tab atomically
 * with the request, since `CenterTabs` mounts one tab body at a time and a request for an off-screen chat
 * would never be consumed. So the chord works over Monaco, a diff, or the file tree, not just over a
 * chat. Only a workspace with **no** chat tab at all has nothing to open; there the chord is purely
 * swallowed (never a reload).
 */
export function useGlobalHotkeys(): void {
	useEffect(() => {
		const onKeyDown = (e: KeyboardEvent) => {
			if (e.code !== "KeyR" || !e.ctrlKey || e.metaKey || e.altKey || e.shiftKey) return;
			if (isInTerminal(e.target)) return;
			e.preventDefault();
			e.stopPropagation();
			const target = selectHistoryTarget(useAppStore.getState());
			if (target) useAppStore.getState().requestHistoryOpen(target);
		};
		window.addEventListener("keydown", onKeyDown, true);
		return () => window.removeEventListener("keydown", onKeyDown, true);
	}, []);
}
