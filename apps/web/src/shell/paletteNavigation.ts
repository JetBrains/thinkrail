import type { Workspace } from "@thinkrail/contracts";
import { createLatestOperation } from "../panels/latestOperation";
import { selectWorkspaceById, useAppStore } from "../store";

type WorkspaceTarget = Pick<Workspace, "id" | "projectId">;

function navigationMarker(state: ReturnType<typeof useAppStore.getState>): string {
	const active = state.activeWorkspaceId;
	return [active, state.selectedProjectId, active ? state.activeTabByWorkspace[active] : null].join(
		"\u0000",
	);
}

export function createPaletteNavigator(
	loadProjectWorkspaces: (projectId: string) => Promise<unknown>,
) {
	const picks = createLatestOperation();

	const loadWorkspaceRow = async (workspace: WorkspaceTarget): Promise<boolean> => {
		const isLatest = picks.begin();
		const before = useAppStore.getState();
		if (selectWorkspaceById(before, workspace.id)) return true;
		const marker = navigationMarker(before);
		await loadProjectWorkspaces(workspace.projectId).catch(() => {});
		return isLatest() && navigationMarker(useAppStore.getState()) === marker;
	};

	return {
		loadWorkspaceRow,
		async navigateToWorkspace(workspace: WorkspaceTarget, sessionId?: string): Promise<boolean> {
			if (!(await loadWorkspaceRow(workspace))) return false;
			useAppStore.getState().activateWorkspaceFromRoute(workspace, sessionId);
			return true;
		},
	};
}
