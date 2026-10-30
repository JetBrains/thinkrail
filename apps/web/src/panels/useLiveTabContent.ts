import { useCallback, useEffect, useRef, useState } from "react";
import { fsChangedPaths, selectWorkspaceTick, useAppStore } from "../store";
import { createLatestOperation, type LatestOperation } from "./latestOperation";

export function useLiveTabContent<T>(
	tab: LiveTab,
	ops: LiveTabOps<T>,
	reloadKey?: string,
	loadedKey?: string,
) {
	const change = useAppStore((s) => s.fsChangesByWorkspace[tab.workspaceId]);
	const opsRef = useRef(ops);
	const tabRef = useRef(tab);
	opsRef.current = ops;
	tabRef.current = tab;
	const mountedRef = useRef(true);
	const [settled, setSettled] = useState(0);
	const readerRef = useRef<TabReader | null>(null);
	readerRef.current ??= createTabReader<T>({
		tab: () => tabRef.current,
		ops: () => opsRef.current,
		latestTick: () => selectWorkspaceTick(useAppStore.getState(), tabRef.current.workspaceId),
		mounted: () => mountedRef.current,
		recheck: () => setSettled((n) => n + 1),
	});
	const reader = readerRef.current;
	const { sequencer } = reader;

	useEffect(() => {
		if (change) reader.onTick(change.tick, fsChangedPaths(change));
	}, [change, tab.path, tab.loadedTick, reader, settled]);

	const lastKey = useRef(loadedKey ?? reloadKey);
	useEffect(() => {
		if (reloadKey === undefined || reloadKey === lastKey.current) return;
		lastKey.current = reloadKey;
		const { read, applyFresh } = opsRef.current;
		let cancelled = false;
		const isCurrent = sequencer.begin();
		read()
			.then((fresh) => {
				if (!cancelled && isCurrent()) applyFresh(fresh, tabRef.current.loadedTick ?? 0);
			})
			.catch(() => {});
		return () => {
			cancelled = true;
		};
	}, [reloadKey, sequencer]);

	const reload = useCallback(() => {
		if (mountedRef.current) reader.reload();
	}, [reader]);

	useEffect(() => {
		mountedRef.current = true;
		return () => {
			mountedRef.current = false;
			sequencer.begin();
		};
	}, [sequencer]);

	return { reload };
}

export type ReadSequencer = LatestOperation;
export const createReadSequencer = createLatestOperation;

interface LiveTab {
	workspaceId: string;
	path: string;
	loadedTick?: number;
}

interface LiveTabOps<T> {
	read: () => Promise<T>;
	applyFresh: (fresh: T, tick: number) => void;
	keepCurrent: (tick: number) => void;
}

export type TabReader = ReturnType<typeof createTabReader>;

export function createTabReader<T>(deps: {
	tab: () => LiveTab;
	ops: () => LiveTabOps<T>;
	latestTick: () => number;
	mounted: () => boolean;
	recheck: () => void;
}) {
	const sequencer = createReadSequencer();
	let inFlight: { path: string } | null = null;
	const start = (started: number, manual: boolean) => {
		const mine = { path: deps.tab().path };
		inFlight = mine;
		const isCurrent = sequencer.begin();
		const settle = (apply: (() => void) | null) => {
			if (inFlight === mine) inFlight = null;
			if (!deps.mounted()) return;
			const next = tickReadSettle({
				current: apply !== null && isCurrent() && deps.tab().path === mine.path,
				loaded: deps.tab().loadedTick ?? 0,
				started,
				latestTick: deps.latestTick(),
			});
			if (next.apply) apply?.();
			if (next.recheck) deps.recheck();
		};
		const { read, applyFresh, keepCurrent } = deps.ops();
		void new Promise<T>((resolve) => resolve(read())).then(
			(fresh) => settle(() => applyFresh(fresh, started)),
			() => settle(manual ? null : () => keepCurrent(started)),
		);
	};
	return {
		sequencer,
		onTick: (changeTick: number, paths: readonly string[] | null) => {
			const tab = deps.tab();
			const decision = tickReadDecision({
				changeTick,
				paths,
				loaded: tab.loadedTick ?? 0,
				path: tab.path,
				inFlightPath: inFlight?.path ?? null,
			});
			if (decision === "keep") deps.ops().keepCurrent(changeTick);
			if (decision === "read") start(changeTick, false);
		},
		reload: () => start(deps.latestTick(), true),
	};
}

export type TickReadDecision = "none" | "keep" | "read" | "wait";

export function tickReadDecision(input: {
	changeTick: number;
	paths: readonly string[] | null;
	loaded: number;
	path: string;
	inFlightPath: string | null;
}): TickReadDecision {
	const { changeTick, paths, loaded, path, inFlightPath } = input;
	if (changeTick <= loaded) return "none";
	if (changeTick === loaded + 1 && paths !== null && !paths.includes(path)) return "keep";
	if (inFlightPath === path) return "wait";
	return "read";
}

export function tickReadSettle(input: {
	current: boolean;
	loaded: number;
	started: number;
	latestTick: number;
}) {
	const { current, loaded, started, latestTick } = input;
	return { apply: current, recheck: latestTick > started || (!current && loaded < started) };
}
