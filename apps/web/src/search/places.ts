import {
	getSessionAttention,
	isChatWorkspace,
	selectAttentionCenterTab,
	selectKnownChatTitle,
	selectWorkspaceById,
	type useAppStore,
} from "../store";
import { chatHasRow } from "./workItems";

type AppState = ReturnType<typeof useAppStore.getState>;

export type PlaceState = Pick<
	AppState,
	| "activeWorkspaceId"
	| "selectedProjectId"
	| "layoutDocumentsByWorkspace"
	| "layoutAttentionByWorkspace"
	| "workspaces"
	| "sessionStateByWorkspace"
	| "closedChatsByWorkspace"
>;

function projectlessChat(state: PlaceState, workspaceId: string): string | undefined {
	const workspace = selectWorkspaceById(state, workspaceId);
	if (!workspace || !isChatWorkspace(workspace)) return undefined;
	return Object.keys(state.sessionStateByWorkspace[workspaceId] ?? {})[0];
}

function listedChat(state: PlaceState, workspaceId: string, sessionId: string): boolean {
	const record = state.sessionStateByWorkspace[workspaceId]?.[sessionId];
	if (!record) return false;
	const closed = state.closedChatsByWorkspace[workspaceId]?.find(
		(chat) => chat.sessionId === sessionId,
	);
	return chatHasRow(
		selectKnownChatTitle(state, workspaceId, sessionId),
		record.firstPrompt ?? closed?.firstPrompt,
		getSessionAttention(record.state),
	);
}

export function currentPlaceIds(state: PlaceState): string[] {
	const workspaceId = state.activeWorkspaceId;
	if (workspaceId) {
		const workspace = `workspace:${workspaceId}`;
		const tab = selectAttentionCenterTab(state, workspaceId);
		const sessionId = tab?.kind === "chat" ? tab.sessionId : projectlessChat(state, workspaceId);
		return sessionId && listedChat(state, workspaceId, sessionId)
			? [`chat:${sessionId}`, workspace]
			: [workspace];
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
		a.sessionStateByWorkspace === b.sessionStateByWorkspace &&
		a.closedChatsByWorkspace === b.closedChatsByWorkspace
	);
}
