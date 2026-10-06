import type { TurnChangeSet } from "@thinkrail/contracts";
import { useEffect } from "react";
import { useAppStore } from "../store";
import { getTransport, supportsTurnChanges } from "../transport";

const EMPTY: readonly TurnChangeSet[] = [];

export function useWorkspaceTurns(workspaceId: string | null): readonly TurnChangeSet[] {
	const turns = useAppStore((state) =>
		workspaceId ? state.turnsByWorkspace[workspaceId] : undefined,
	);
	const supported = useAppStore((state) => supportsTurnChanges(state.protocolVersion));
	const generation = useAppStore((state) => state.connectionGeneration);
	const loaded = turns !== undefined;
	useEffect(() => {
		if (!workspaceId || !supported || loaded) return;
		let cancelled = false;
		getTransport()
			.request("workspace.turns", { workspaceId })
			.then(({ turns: fresh }) => {
				if (!cancelled) useAppStore.getState().setWorkspaceTurns(workspaceId, fresh);
			})
			.catch(() => {});
		return () => {
			cancelled = true;
		};
	}, [generation, loaded, supported, workspaceId]);
	return turns ?? EMPTY;
}
