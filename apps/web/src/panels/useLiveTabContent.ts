import { useEffect, useRef } from "react";
import { useAppStore } from "../store";

/**
 * The live-refresh contract shared by `FilePane` and `DiffPane` (the SPEC describes them as one contract).
 * Watches the tab's workspace fs tick; when it moves past the tick this tab's content was loaded at, it
 * either advances the tick in place (a single unrelated batch — this file isn't in it, so nothing to
 * re-read) or re-reads via `read` and writes the fresh payload through `applyFresh`. A failed/cancelled
 * read falls back to `keepCurrent`, which advances the tick without changing content — so a file that left
 * the change set (or a deleted file) holds its last contents. Only the active tab mounts, so a background
 * tab catches up on activation.
 *
 * `reloadKey` is a **second live dimension** for a tab whose content depends on something other than the
 * files (a branch-scope diff tab reads against the workspace's *current* review target, which the user can
 * re-point): when it changes, the content is re-read at once instead of waiting for the next fs tick. The
 * fresh payload is applied at the tab's existing tick — the re-read answers "what does this tab mean now",
 * it does not observe a file change.
 *
 * `read` / `applyFresh` / `keepCurrent` are read from a ref each run, so their identities are **not** effect
 * deps — the effect re-runs only when the fs tick, the reload key, or the tab's path / loaded-tick changes.
 */
export function useLiveTabContent<T>(
	tab: { workspaceId: string; path: string; loadedTick?: number },
	ops: {
		read: () => Promise<T>;
		applyFresh: (fresh: T, tick: number) => void;
		keepCurrent: (tick: number) => void;
	},
	reloadKey?: string,
) {
	const change = useAppStore((s) => s.fsChangesByWorkspace[tab.workspaceId]);
	const opsRef = useRef(ops);
	opsRef.current = ops;

	useEffect(() => {
		if (!change) return;
		const loaded = tab.loadedTick ?? 0;
		if (change.tick <= loaded) return;
		const { read, applyFresh, keepCurrent } = opsRef.current;
		// Exactly one batch behind and this file isn't in it → nothing to re-read, just advance the tick.
		if (change.tick === loaded + 1 && !change.truncated && !change.paths.includes(tab.path)) {
			keepCurrent(change.tick);
			return;
		}
		let cancelled = false;
		read()
			.then((fresh) => {
				if (!cancelled) applyFresh(fresh, change.tick);
			})
			.catch(() => {
				if (!cancelled) keepCurrent(change.tick);
			});
		return () => {
			cancelled = true;
		};
	}, [change, tab.path, tab.loadedTick]);

	// The reload dimension: re-read on a *changed* key (never on mount — the content was just loaded for the
	// current key), and drop a response the key has since moved past.
	const lastKey = useRef(reloadKey);
	useEffect(() => {
		if (reloadKey === undefined || reloadKey === lastKey.current) return;
		lastKey.current = reloadKey;
		const { read, applyFresh } = opsRef.current;
		let cancelled = false;
		read()
			.then((fresh) => {
				// The tick is unchanged: this re-read is about what the tab *means*, not about the files moving.
				if (!cancelled) applyFresh(fresh, tab.loadedTick ?? 0);
			})
			// A failed re-read leaves the last good content on screen (the Changes list is where a target's
			// consequences show).
			.catch(() => {});
		return () => {
			cancelled = true;
		};
		// `tab.loadedTick` is a dep because the body reads it (the tick this re-read preserves); a run it
		// triggers alone exits on the key guard above, so it costs nothing.
	}, [reloadKey, tab.loadedTick]);
}
