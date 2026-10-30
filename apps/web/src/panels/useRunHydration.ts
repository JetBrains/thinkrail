import { useEffect } from "react";
import { selectSupportsRun, useAppStore } from "../store";
import { getTransport } from "../transport";

export function useRunHydration(workspaceId: string | null, projectId: string | null): void {
	const connectionGeneration = useAppStore((state) => state.connectionGeneration);
	const status = useAppStore((state) => state.status);
	const supported = useAppStore(selectSupportsRun);

	useEffect(() => {
		if (!supported || status !== "connected" || connectionGeneration === 0) return;
		if (workspaceId) {
			void getTransport()
				.request("run.state", { workspaceId })
				.then((state) => useAppStore.getState().applyRunState(state, connectionGeneration))
				.catch(() => {});
		}
		if (projectId) {
			void getTransport()
				.request("run.recipe", { projectId })
				.then((run) =>
					useAppStore.getState().applyProjectRun({ projectId, run }, connectionGeneration),
				)
				.catch(() => {});
		}
	}, [connectionGeneration, status, supported, workspaceId, projectId]);
}
