import type { Workspace } from "@thinkrail/contracts";
import { isConnectedGeneration, useAppStore } from "../store";
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

export function projectsNeedingWorkspaceLists(state: AppState): string[] {
	return state.projects
		.filter((project) => projectNeedsWorkspaceList(state, project.id))
		.map((project) => project.id);
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

export interface PaletteBackfillSources {
	readonly listWorkspaces: (projectId: string) => Promise<readonly Workspace[]>;
	readonly concurrency: number;
}

export interface PaletteBackfill {
	readonly schedule: () => void;
	readonly clearPending: () => void;
	readonly watch: () => () => void;
}

function scheduleKey(state: AppState): string {
	return [
		state.status,
		state.welcomeGeneration,
		state.projects.map((project) => project.id).join("\u0000"),
		Object.keys(state.sessionStateByWorkspace).sort().join("\u0000"),
	].join("\u0001");
}

export function createPaletteBackfill(sources: PaletteBackfillSources): PaletteBackfill {
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
		const state = useAppStore.getState();
		if (state.status !== "connected" || state.welcomeGeneration === 0) {
			projects.clearPending();
			return;
		}
		projects.schedule(projectsNeedingWorkspaceLists(state));
	};

	return {
		schedule,
		clearPending: projects.clearPending,
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
				projects.clearPending();
			};
		},
	};
}
