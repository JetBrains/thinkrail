import type { Workspace } from "@thinkrail/contracts";
import { createLatestOperation } from "../panels/latestOperation";
import { selectWorkspaceById, useAppStore } from "../store";

type WorkspaceTarget = Pick<Workspace, "id" | "projectId">;

export function createPaletteNavigator(
	loadProjectWorkspaces: (projectId: string) => Promise<unknown>,
) {
	const picks = createLatestOperation();
	let stopWatching = () => {};

	const beginPick = (): (() => boolean) => {
		stopWatching();
		const isLatest = picks.begin();
		let overtaken = false;
		const unsubscribe = useAppStore.subscribe((state, previous) => {
			if (
				state.activeWorkspaceId === previous.activeWorkspaceId &&
				state.selectedProjectId === previous.selectedProjectId &&
				state.navTickByWorkspace === previous.navTickByWorkspace
			) {
				return;
			}
			overtaken = true;
			unsubscribe();
		});
		stopWatching = unsubscribe;
		return () => isLatest() && !overtaken;
	};

	const loadWorkspaceRow = async (workspace: WorkspaceTarget): Promise<boolean> => {
		const stillWanted = beginPick();
		if (selectWorkspaceById(useAppStore.getState(), workspace.id)) return true;
		await loadProjectWorkspaces(workspace.projectId).catch(() => {});
		return stillWanted();
	};

	return {
		beginPick,
		loadWorkspaceRow,
		async navigateToWorkspace(workspace: WorkspaceTarget, sessionId?: string): Promise<boolean> {
			if (!(await loadWorkspaceRow(workspace))) return false;
			useAppStore.getState().activateWorkspaceFromRoute(workspace, sessionId);
			return true;
		},
	};
}
