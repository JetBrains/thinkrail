import { useEffect, useRef } from "react";
import { useAppStore } from "../store";

/**
 * The live-refresh contract shared by `FilePane` and `DiffPane` (the SPEC describes them as one contract).
 * Watches the tab's workspace fs tick; when it moves past the tick this tab's content was loaded at, it
 * either advances the tick in place (a single unrelated batch — this file isn't in it, so nothing to
 * re-read) or re-reads via `read` and writes the fresh payload through `applyFresh`. A **pathless** batch
 * never takes the skip: it names no file precisely because what moved isn't one (the host's ref-move nudge —
 * a terminal `git commit` invalidates an `uncommitted`-scope diff without touching a single byte on disk),
 * so path membership can't speak to it and the only honest answer is to re-read. A failed/cancelled
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
 * `loadedKey` is that dimension **as the tab's content was actually loaded** (persisted on the tab, e.g.
 * `DiffTab.loadedTarget`), and it is what the "has the key moved?" comparison starts from. Seeding the
 * comparison at mount time instead would make the drift invisible in exactly the case that matters: panes
 * mount only while their tab is active, so a tab whose key moved while it sat in the background would come
 * back with the *new* key already recorded and never re-read — old content under a new claim.
 *
 * `read` / `applyFresh` / `keepCurrent` are read from a ref each run, so their identities are **not** effect
 * deps — the effect re-runs only when the fs tick, the reload key, or the tab's path / loaded-tick changes.
 *
 * The two dimensions are two effects, so two reads can be in flight **at once** (an fs-tick re-read against
 * the old target, then a re-point). Both go through **one shared sequencer**: a response is applied only
 * while no later read has started, so the network — not the user's last action — can never decide what the
 * pane shows (out of order, the older read would land last and overwrite the newer target's content while
 * carrying its own honest, now-stale stamp, leaving no drift for either effect to notice).
 */
export function useLiveTabContent<T>(
	tab: { workspaceId: string; path: string; loadedTick?: number },
	ops: {
		read: () => Promise<T>;
		applyFresh: (fresh: T, tick: number) => void;
		keepCurrent: (tick: number) => void;
	},
	reloadKey?: string,
	loadedKey?: string,
) {
	const change = useAppStore((s) => s.fsChangesByWorkspace[tab.workspaceId]);
	const opsRef = useRef(ops);
	opsRef.current = ops;
	// One order guard for both dimensions (see the doc comment): whichever read started last is the only one
	// allowed to write.
	const sequencerRef = useRef<ReadSequencer | null>(null);
	sequencerRef.current ??= createReadSequencer();
	const sequencer = sequencerRef.current;

	useEffect(() => {
		if (!change) return;
		const loaded = tab.loadedTick ?? 0;
		if (change.tick <= loaded) return;
		const { read, applyFresh, keepCurrent } = opsRef.current;
		// Exactly one batch behind, and that batch NAMED files none of which is this one → nothing to re-read,
		// just advance the tick. An empty batch names nothing (the pathless ref-move nudge), so it never skips.
		const namesOtherFiles = change.paths.length > 0 && !change.paths.includes(tab.path);
		if (change.tick === loaded + 1 && !change.truncated && namesOtherFiles) {
			keepCurrent(change.tick);
			return;
		}
		let cancelled = false;
		const isCurrent = sequencer.begin();
		read()
			.then((fresh) => {
				if (!cancelled && isCurrent()) applyFresh(fresh, change.tick);
			})
			.catch(() => {
				if (!cancelled && isCurrent()) keepCurrent(change.tick);
			});
		return () => {
			cancelled = true;
		};
	}, [change, tab.path, tab.loadedTick, sequencer]);

	// The reload dimension: re-read on a *changed* key (never on mount — the content was just loaded for the
	// current key), and drop a response the key has since moved past.
	const lastKey = useRef(loadedKey ?? reloadKey);
	useEffect(() => {
		if (reloadKey === undefined || reloadKey === lastKey.current) return;
		lastKey.current = reloadKey;
		const { read, applyFresh } = opsRef.current;
		let cancelled = false;
		const isCurrent = sequencer.begin();
		read()
			.then((fresh) => {
				// The tick is unchanged: this re-read is about what the tab *means*, not about the files moving.
				if (!cancelled && isCurrent()) applyFresh(fresh, tab.loadedTick ?? 0);
			})
			// A failed re-read leaves the last good content on screen (the Changes list is where a target's
			// consequences show).
			.catch(() => {});
		return () => {
			cancelled = true;
		};
		// `tab.loadedTick` is a dep because the body reads it (the tick this re-read preserves); a run it
		// triggers alone exits on the key guard above, so it costs nothing.
	}, [reloadKey, tab.loadedTick, sequencer]);
}

export type ReadSequencer = { begin: () => () => boolean };

/**
 * The order guard shared by a tab's two live dimensions. `begin()` marks a read as the newest and returns
 * `isCurrent()`, which stays true only until the *next* `begin()` — so a response that a later read has
 * already superseded is dropped instead of overwriting it. Deliberately not "drop responses older than the
 * newest **applied** one": the reads here answer different questions (a tick move, a target move), so
 * "started last" is the only ordering the pane can trust, and a dropped read costs nothing (the read that
 * superseded it is the one the user is waiting for). A dropped fs read leaves its tick unabsorbed, so the
 * tab stays one behind until the next batch re-reads it — pessimistic, which is the safe direction.
 */
export function createReadSequencer(): ReadSequencer {
	let latest = 0;
	return {
		begin: () => {
			const seq = ++latest;
			return () => seq === latest;
		},
	};
}
