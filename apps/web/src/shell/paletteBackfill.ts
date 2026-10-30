import type { SessionSummary, Workspace } from "@thinkrail/contracts";
import {
	isConnectedGeneration,
	selectContextProject,
	selectKnownChatTitle,
	useAppStore,
} from "../store";
import { createBackfillQueue } from "./backfillQueue";

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

export function backfillOrder(
	state: AppState,
	listedBefore: (workspaceId: string) => boolean = () => false,
): { projectIds: string[]; workspaceIds: string[] } {
	const contextProjectId = selectContextProject(state)?.id ?? null;
	const openProjects = new Set(state.projects.map((project) => project.id));
	const wanted: { workspaceId: string; rank: number }[] = [];
	for (const [workspaceId, records] of Object.entries(state.sessionStateByWorkspace)) {
		const list = Object.values(records);
		const projectId = list[0]?.projectId;
		if (projectId === undefined || !openProjects.has(projectId)) continue;
		const titled = list.every((record) =>
			selectKnownChatTitle(state, workspaceId, record.sessionId),
		);
		if (titled && !listedBefore(workspaceId)) continue;
		const rank =
			workspaceId === state.activeWorkspaceId ? 0 : projectId === contextProjectId ? 1 : 2;
		wanted.push({ workspaceId, rank });
	}
	wanted.sort((a, b) => a.rank - b.rank);
	return {
		projectIds: state.projects
			.filter((project) => projectNeedsWorkspaceList(state, project.id))
			.map((project) => project.id),
		workspaceIds: wanted.map((entry) => entry.workspaceId),
	};
}

export function mergeProjectWorkspaces(projectId: string, rows: readonly Workspace[]): void {
	const store = useAppStore.getState();
	if (!store.projects.some((project) => project.id === projectId)) return;
	const list = store.workspaces[projectId];
	const listed = rows.filter((row) => row.projectId === projectId);
	if (list === undefined) {
		store.setWorkspaces(projectId, listed);
		return;
	}
	const current = new Map(list.map((workspace) => [workspace.id, workspace]));
	if (listed.every((row) => current.has(row.id))) return;
	const ordered = listed.map((row) => current.get(row.id) ?? row);
	const reported = new Set(listed.map((row) => row.id));
	store.setWorkspaces(projectId, [
		...ordered,
		...list.filter((workspace) => !reported.has(workspace.id)),
	]);
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

export interface PaletteBackfillSources {
	readonly listSessions: (workspaceId: string) => Promise<readonly SessionSummary[]>;
	readonly listWorkspaces: (projectId: string) => Promise<readonly Workspace[]>;
	readonly isRefusal: (error: unknown) => boolean;
	readonly concurrency: number;
}

export interface PaletteBackfill {
	readonly schedule: () => void;
	readonly clearPending: () => void;
	readonly watch: () => () => void;
}

function scheduleKey(state: AppState): string {
	return [
		state.welcomeGeneration,
		state.sessionTitleRevision,
		state.projects.map((project) => project.id).join("\u0000"),
		Object.entries(state.sessionStateByWorkspace)
			.map(([workspaceId, records]) => `${workspaceId}:${Object.keys(records).length}`)
			.sort()
			.join("\u0000"),
	].join("\u0001");
}

function listingKey(state: AppState, workspaceId: string): string {
	const sessions = Object.keys(state.sessionStateByWorkspace[workspaceId] ?? {}).sort();
	return `${state.welcomeGeneration}\u0001${sessions.join("\u0000")}`;
}

export function createPaletteBackfill(sources: PaletteBackfillSources): PaletteBackfill {
	const listedKeys = new Map<string, string>();

	const titles = createBackfillQueue({
		concurrency: sources.concurrency,
		isWanted: (workspaceId) =>
			listedKeys.get(workspaceId) !== listingKey(useAppStore.getState(), workspaceId),
		run: async (workspaceId) => {
			const start = useAppStore.getState();
			const listed = listingKey(start, workspaceId);
			const current = () => {
				const now = useAppStore.getState();
				return (
					isConnectedGeneration(now, start.connectionGeneration) &&
					now.sessionTitleRevision === start.sessionTitleRevision
				);
			};
			try {
				const summaries = await sources.listSessions(workspaceId);
				if (!current()) return;
				listedKeys.set(workspaceId, listed);
				noteListedSessions(workspaceId, summaries);
			} catch (error) {
				if (sources.isRefusal(error) && current()) listedKeys.set(workspaceId, listed);
			}
		},
	});

	const projects = createBackfillQueue({
		concurrency: sources.concurrency,
		isWanted: (projectId) => projectNeedsWorkspaceList(useAppStore.getState(), projectId),
		run: async (projectId) => {
			const generation = useAppStore.getState().connectionGeneration;
			const rows = await sources.listWorkspaces(projectId);
			if (isConnectedGeneration(useAppStore.getState(), generation)) {
				mergeProjectWorkspaces(projectId, rows);
			}
		},
	});

	const schedule = () => {
		const { projectIds, workspaceIds } = backfillOrder(useAppStore.getState(), (workspaceId) =>
			listedKeys.has(workspaceId),
		);
		projects.schedule(projectIds);
		titles.schedule(workspaceIds);
	};
	const clearPending = () => {
		projects.clearPending();
		titles.clearPending();
	};

	return {
		schedule,
		clearPending,
		watch() {
			let key = scheduleKey(useAppStore.getState());
			schedule();
			const unsubscribe = useAppStore.subscribe((state) => {
				const next = scheduleKey(state);
				if (next === key) return;
				key = next;
				schedule();
			});
			return () => {
				unsubscribe();
				clearPending();
			};
		},
	};
}
