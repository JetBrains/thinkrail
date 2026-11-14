import { selectAttentionCenterTab, type useAppStore } from "../store";

type AppState = ReturnType<typeof useAppStore.getState>;

export type PlaceState = Pick<
	AppState,
	| "activeWorkspaceId"
	| "selectedProjectId"
	| "layoutDocumentsByWorkspace"
	| "layoutAttentionByWorkspace"
>;

export function currentPlaceIds(state: PlaceState): string[] {
	const workspaceId = state.activeWorkspaceId;
	if (workspaceId) {
		const workspace = `workspace:${workspaceId}`;
		const tab = selectAttentionCenterTab(state, workspaceId);
		return tab?.kind === "chat" ? [`chat:${tab.sessionId}`, workspace] : [workspace];
	}
	return state.selectedProjectId ? [`project:${state.selectedProjectId}`] : [];
}

export function samePlaceState(a: PlaceState, b: PlaceState): boolean {
	return (
		a.activeWorkspaceId === b.activeWorkspaceId &&
		a.selectedProjectId === b.selectedProjectId &&
		a.layoutDocumentsByWorkspace === b.layoutDocumentsByWorkspace &&
		a.layoutAttentionByWorkspace === b.layoutAttentionByWorkspace
	);
}
