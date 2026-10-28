import type { SessionSummary, Workspace } from "@thinkrail/contracts";
import { selectContextProject, selectKnownChatTitle, useAppStore } from "../store";

type AppState = ReturnType<typeof useAppStore.getState>;

export function projectNeedsWorkspaceList(state: AppState, projectId: string): boolean {
	if (!state.projects.some((project) => project.id === projectId)) return false;
	const list = state.workspaces[projectId];
	if (list === undefined) return true;
	const known = new Set(list.map((workspace) => workspace.id));
	for (const [workspaceId, records] of Object.entries(state.sessionStateByWorkspace)) {
		if (known.has(workspaceId) || state.removedWorkspaceIds[workspaceId]) continue;
		if (Object.values(records).some((record) => record.projectId === projectId)) return true;
	}
	return false;
}

export function backfillOrder(state: AppState): {
	projectIds: string[];
	workspaceIds: string[];
} {
	const contextProjectId = selectContextProject(state)?.id ?? null;
	const openProjects = new Set(state.projects.map((project) => project.id));
	const untitled: { workspaceId: string; rank: number }[] = [];
	for (const [workspaceId, records] of Object.entries(state.sessionStateByWorkspace)) {
		const list = Object.values(records);
		const projectId = list[0]?.projectId;
		if (projectId === undefined || !openProjects.has(projectId)) continue;
		if (list.every((record) => selectKnownChatTitle(state, workspaceId, record.sessionId)))
			continue;
		const rank =
			workspaceId === state.activeWorkspaceId ? 0 : projectId === contextProjectId ? 1 : 2;
		untitled.push({ workspaceId, rank });
	}
	untitled.sort((a, b) => a.rank - b.rank);
	return {
		projectIds: state.projects
			.filter((project) => projectNeedsWorkspaceList(state, project.id))
			.map((project) => project.id),
		workspaceIds: untitled.map((entry) => entry.workspaceId),
	};
}

export function mergeProjectWorkspaces(projectId: string, rows: readonly Workspace[]): void {
	const store = useAppStore.getState();
	if (!store.projects.some((project) => project.id === projectId)) return;
	const list = store.workspaces[projectId];
	if (list === undefined) {
		store.setWorkspaces(projectId, [...rows]);
		return;
	}
	const known = new Set(list.map((workspace) => workspace.id));
	for (const row of rows) {
		if (row.projectId === projectId && !known.has(row.id)) store.addWorkspace(row);
	}
}

export function noteListedSessions(
	workspaceId: string,
	summaries: readonly SessionSummary[],
): void {
	useAppStore.getState().noteClosedChats(
		workspaceId,
		summaries
			.filter((summary) => summary.workspaceId === workspaceId)
			.map((summary) => ({
				sessionId: summary.sessionId,
				title: summary.title,
				...(summary.firstPrompt ? { firstPrompt: summary.firstPrompt } : {}),
				closedAt: summary.updatedAt,
			})),
	);
}
