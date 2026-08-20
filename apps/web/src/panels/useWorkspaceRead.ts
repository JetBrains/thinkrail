import { useCallback, useEffect, useRef } from "react";
import { selectWorkspaceTick, useAppStore } from "../store";

interface WorkspaceReadHandlers<T> {
	onResult: (value: T, workspaceId: string) => void;
	onFailure?: (workspaceId: string, error: unknown) => void;
	onSwitch?: (workspaceId: string) => void;
}

export function useWorkspaceRead<T>(
	workspaceId: string | null,
	read: (workspaceId: string, readKey: string | undefined) => Promise<T>,
	handlers: WorkspaceReadHandlers<T>,
	readKey?: string,
): { reload: () => void } {
	const latest = useRef({ read, handlers, workspaceId, readKey });
	latest.current = { read, handlers, workspaceId, readKey };
	const generation = useRef(0);

	const runRead = useCallback((id: string, key: string | undefined) => {
		if (useAppStore.getState().removedWorkspaceIds[id]) return;
		const mine = ++generation.current;
		const live = () =>
			generation.current === mine &&
			latest.current.workspaceId === id &&
			latest.current.readKey === key &&
			!useAppStore.getState().removedWorkspaceIds[id];
		latest.current
			.read(id, key)
			.then((value) => {
				if (live()) latest.current.handlers.onResult(value, id);
			})
			.catch((error: unknown) => {
				if (live()) latest.current.handlers.onFailure?.(id, error);
			});
	}, []);

	useEffect(() => {
		if (!workspaceId) return;
		runRead(workspaceId, readKey);
		let tick = selectWorkspaceTick(useAppStore.getState(), workspaceId);
		const unsubscribe = useAppStore.subscribe((state) => {
			const next = selectWorkspaceTick(state, workspaceId);
			if (next === tick) return;
			tick = next;
			runRead(workspaceId, readKey);
		});
		return () => {
			unsubscribe();
			generation.current += 1;
			latest.current.handlers.onSwitch?.(workspaceId);
		};
	}, [workspaceId, readKey, runRead]);

	return {
		reload: () => {
			if (workspaceId) runRead(workspaceId, readKey);
		},
	};
}
