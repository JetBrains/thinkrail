import { useCallback, useEffect, useRef } from "react";
import { fsChangedPaths, selectWorkspaceTick, useAppStore } from "../store";
import { createSingleFlight, type SingleFlight } from "./singleFlight";

interface WorkspaceReadHandlers<T> {
	onResult: (value: T, workspaceId: string) => void;
	onFailure?: (workspaceId: string, error: unknown) => void;
	onSwitch?: (workspaceId: string) => void;
	affectedBy?: (changedPath: string) => boolean;
}

const isRemoved = (id: string) => Boolean(useAppStore.getState().removedWorkspaceIds[id]);

function tickNeedsRead(
	change: { paths: readonly string[]; truncated: boolean } | undefined,
	narrowable: boolean,
	affectedBy: ((changedPath: string) => boolean) | undefined,
) {
	const paths = change && narrowable ? fsChangedPaths(change) : null;
	return !affectedBy || paths === null || paths.some(affectedBy);
}

export function useWorkspaceRead<T>(
	workspaceId: string | null,
	read: (workspaceId: string, readKey: string | undefined) => Promise<T>,
	handlers: WorkspaceReadHandlers<T>,
	readKey?: string,
): { reload: () => void } {
	const latest = useRef({ read, handlers, workspaceId, readKey });
	latest.current = { read, handlers, workspaceId, readKey };
	const flightRef = useRef<SingleFlight | null>(null);
	const lastReadFailed = useRef(false);

	const runRead = useCallback((flight: SingleFlight, id: string, key: string | undefined) => {
		if (isRemoved(id)) return;
		const live = () =>
			!flight.isStopped() &&
			latest.current.workspaceId === id &&
			latest.current.readKey === key &&
			!isRemoved(id);
		flight.run(() =>
			latest.current
				.read(id, key)
				.then((value) => {
					if (!live()) return;
					lastReadFailed.current = false;
					latest.current.handlers.onResult(value, id);
				})
				.catch((error: unknown) => {
					if (!live()) return;
					lastReadFailed.current = true;
					latest.current.handlers.onFailure?.(id, error);
				}),
		);
	}, []);

	useEffect(() => {
		if (!workspaceId) return;
		const flight = createSingleFlight();
		flightRef.current = flight;
		lastReadFailed.current = false;
		runRead(flight, workspaceId, readKey);
		const subscribed = useAppStore.getState();
		let tick = selectWorkspaceTick(subscribed, workspaceId);
		let generation = subscribed.connectionGeneration;
		const unsubscribe = useAppStore.subscribe((state) => {
			const next = selectWorkspaceTick(state, workspaceId);
			if (next === tick) return;
			const narrowable =
				next === tick + 1 && state.connectionGeneration === generation && !lastReadFailed.current;
			tick = next;
			generation = state.connectionGeneration;
			const change = state.fsChangesByWorkspace[workspaceId];
			if (tickNeedsRead(change, narrowable, latest.current.handlers.affectedBy)) {
				runRead(flight, workspaceId, readKey);
			}
		});
		return () => {
			unsubscribe();
			flight.stop();
			latest.current.handlers.onSwitch?.(workspaceId);
		};
	}, [workspaceId, readKey, runRead]);

	const reload = useCallback(() => {
		const flight = flightRef.current;
		if (workspaceId && flight) runRead(flight, workspaceId, readKey);
	}, [readKey, runRead, workspaceId]);
	return { reload };
}
