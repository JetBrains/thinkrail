import { useEffect, useRef } from "react";
import { useAppStore } from "../store";
import { createLatestOperation, type LatestOperation } from "./latestOperation";

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
	const sequencerRef = useRef<ReadSequencer | null>(null);
	sequencerRef.current ??= createReadSequencer();
	const sequencer = sequencerRef.current;

	useEffect(() => {
		if (!change) return;
		const loaded = tab.loadedTick ?? 0;
		if (change.tick <= loaded) return;
		const { read, applyFresh, keepCurrent } = opsRef.current;
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

	const lastKey = useRef(loadedKey ?? reloadKey);
	useEffect(() => {
		if (reloadKey === undefined || reloadKey === lastKey.current) return;
		lastKey.current = reloadKey;
		const { read, applyFresh } = opsRef.current;
		let cancelled = false;
		const isCurrent = sequencer.begin();
		read()
			.then((fresh) => {
				if (!cancelled && isCurrent()) applyFresh(fresh, tab.loadedTick ?? 0);
			})
			.catch(() => {});
		return () => {
			cancelled = true;
		};
	}, [reloadKey, tab.loadedTick, sequencer]);
}

export type ReadSequencer = LatestOperation;
export const createReadSequencer = createLatestOperation;
