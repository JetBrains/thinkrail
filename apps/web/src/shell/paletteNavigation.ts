import type { Workspace } from "@thinkrail/contracts";
import { createLatestOperation } from "../panels/latestOperation";
import { selectWorkspaceById, selectWorkspaceNavTick, useAppStore } from "../store";

type WorkspaceTarget = Pick<Workspace, "id" | "projectId">;

function navigationMarker(state: ReturnType<typeof useAppStore.getState>): string {
	const active = state.activeWorkspaceId;
	return [
		active,
		state.selectedProjectId,
		active ? selectWorkspaceNavTick(state, active) : null,
	].join("\u0000");
}

export function createPaletteNavigator(
	loadProjectWorkspaces: (projectId: string) => Promise<unknown>,
) {
	const picks = createLatestOperation();

	const beginPick = (): (() => boolean) => {
		const isLatest = picks.begin();
		const marker = navigationMarker(useAppStore.getState());
		return () => isLatest() && navigationMarker(useAppStore.getState()) === marker;
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
