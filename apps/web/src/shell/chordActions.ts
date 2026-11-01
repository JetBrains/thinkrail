import { selectHistoryTarget, useAppStore } from "../store";

export function toggleLeftSide(toggleProjectsHome: () => void): void {
	const state = useAppStore.getState();
	const workspaceId = state.activeWorkspaceId;
	if (workspaceId) state.enqueueLayoutIntent({ kind: "toggle-side", workspaceId, side: "left" });
	else toggleProjectsHome();
}

export function toggleRightSide(): void {
	const state = useAppStore.getState();
	const workspaceId = state.activeWorkspaceId;
	if (workspaceId) state.enqueueLayoutIntent({ kind: "toggle-side", workspaceId, side: "right" });
}

export function toggleBottomPanel(): void {
	const state = useAppStore.getState();
	const workspaceId = state.activeWorkspaceId;
	if (workspaceId) state.enqueueLayoutIntent({ kind: "toggle-bottom", workspaceId });
}

export function openChatHistory(): void {
	const state = useAppStore.getState();
	const target = selectHistoryTarget(state);
	if (target) state.requestHistoryOpen(target);
}
