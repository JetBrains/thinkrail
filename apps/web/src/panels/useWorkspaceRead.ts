import { useCallback, useEffect, useRef } from "react";
import { selectWorkspaceTick, useAppStore } from "../store";
import { createSingleFlight, type SingleFlight } from "./singleFlight";

interface WorkspaceReadHandlers<T> {
	onResult: (value: T, workspaceId: string) => void;
	onFailure?: (workspaceId: string, error: unknown) => void;
	onSwitch?: (workspaceId: string) => void;
}

const isRemoved = (id: string) => Boolean(useAppStore.getState().removedWorkspaceIds[id]);

export function useWorkspaceRead<T>(
	workspaceId: string | null,
	read: (workspaceId: string, readKey: string | undefined) => Promise<T>,
	handlers: WorkspaceReadHandlers<T>,
	readKey?: string,
): { reload: () => void } {
	const latest = useRef({ read, handlers, workspaceId, readKey });
	latest.current = { read, handlers, workspaceId, readKey };
	const flightRef = useRef<SingleFlight | null>(null);

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
					if (live()) latest.current.handlers.onResult(value, id);
				})
				.catch((error: unknown) => {
					if (live()) latest.current.handlers.onFailure?.(id, error);
				}),
		);
	}, []);

	useEffect(() => {
		if (!workspaceId) return;
		const flight = createSingleFlight();
		flightRef.current = flight;
		runRead(flight, workspaceId, readKey);
		let tick = selectWorkspaceTick(useAppStore.getState(), workspaceId);
		const unsubscribe = useAppStore.subscribe((state) => {
			const next = selectWorkspaceTick(state, workspaceId);
			if (next === tick) return;
			tick = next;
			runRead(flight, workspaceId, readKey);
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
