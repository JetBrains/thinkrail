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
 * `read` / `applyFresh` / `keepCurrent` are read from a ref each run, so their identities are **not** effect
 * deps — the effect re-runs only when the fs tick or the tab's path / loaded-tick changes.
 */
export function useLiveTabContent<T>(
	tab: { workspaceId: string; path: string; loadedTick?: number },
	ops: {
		read: () => Promise<T>;
		applyFresh: (fresh: T, tick: number) => void;
		keepCurrent: (tick: number) => void;
	},
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
}
