import {
	isChatWorkspace,
	selectAttentionCenterTab,
	selectWorkspaceById,
	type useAppStore,
} from "../store";

type AppState = ReturnType<typeof useAppStore.getState>;

export type PlaceState = Pick<
	AppState,
	| "activeWorkspaceId"
	| "selectedProjectId"
	| "layoutDocumentsByWorkspace"
	| "layoutAttentionByWorkspace"
	| "workspaces"
	| "sessionStateByWorkspace"
>;

function projectlessChat(state: PlaceState, workspaceId: string): string | undefined {
	const workspace = selectWorkspaceById(state, workspaceId);
	if (!workspace || !isChatWorkspace(workspace)) return undefined;
	return Object.keys(state.sessionStateByWorkspace[workspaceId] ?? {})[0];
}

export function currentPlaceIds(state: PlaceState): string[] {
	const workspaceId = state.activeWorkspaceId;
	if (workspaceId) {
		const workspace = `workspace:${workspaceId}`;
		const tab = selectAttentionCenterTab(state, workspaceId);
		const sessionId = tab?.kind === "chat" ? tab.sessionId : projectlessChat(state, workspaceId);
		return sessionId ? [`chat:${sessionId}`, workspace] : [workspace];
	}
	return state.selectedProjectId ? [`project:${state.selectedProjectId}`] : [];
}

export function samePlaceState(a: PlaceState, b: PlaceState): boolean {
	return (
		a.activeWorkspaceId === b.activeWorkspaceId &&
		a.selectedProjectId === b.selectedProjectId &&
		a.layoutDocumentsByWorkspace === b.layoutDocumentsByWorkspace &&
		a.layoutAttentionByWorkspace === b.layoutAttentionByWorkspace &&
		a.workspaces === b.workspaces &&
		a.sessionStateByWorkspace === b.sessionStateByWorkspace
	);
}
