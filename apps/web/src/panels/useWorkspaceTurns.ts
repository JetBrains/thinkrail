import type { TurnChangeSet } from "@thinkrail/contracts";
import { useEffect } from "react";
import { isConnectedGeneration, useAppStore } from "../store";
import { getTransport, supportsTurnChanges } from "../transport";

const EMPTY: readonly TurnChangeSet[] = [];

export function useWorkspaceTurns(workspaceId: string | null): readonly TurnChangeSet[] {
	return (
		useAppStore((state) => (workspaceId ? state.turnsByWorkspace[workspaceId] : undefined)) ?? EMPTY
	);
}

export function useLoadWorkspaceTurns(workspaceId: string | null): void {
	const supported = useAppStore((state) => supportsTurnChanges(state.protocolVersion));
	const generation = useAppStore((state) => state.connectionGeneration);
	useEffect(() => {
		if (!workspaceId || !supported) return;
		const state = useAppStore.getState();
		if (state.removedWorkspaceIds[workspaceId] || !isConnectedGeneration(state, generation)) return;
		const baseline = state.turnsByWorkspace[workspaceId] ?? EMPTY;
		let cancelled = false;
		getTransport()
			.request("workspace.turns", { workspaceId })
			.then(({ turns }) => {
				if (!cancelled) {
					useAppStore.getState().setWorkspaceTurns(workspaceId, turns, baseline, generation);
				}
			})
			.catch(() => {});
		return () => {
			cancelled = true;
		};
	}, [generation, supported, workspaceId]);
}
