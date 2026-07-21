import type { Project, Workspace } from "@thinkrail/contracts";

interface ActiveWorkspaceState {
	activeWorkspaceId: string | null;
	workspaces: Record<string, Workspace[]>;
}

interface ProjectContextState extends ActiveWorkspaceState {
	selectedProjectId: string | null;
	projects: Project[];
}

/** Resolve the active workspace from the project-grouped collection without duplicating it in state. */
export function selectActiveWorkspace(state: ActiveWorkspaceState): Workspace | null {
	if (!state.activeWorkspaceId) return null;
	for (const workspaces of Object.values(state.workspaces)) {
		const workspace = workspaces.find((candidate) => candidate.id === state.activeWorkspaceId);
		if (workspace) return workspace;
	}
	return null;
}

/** The project that owns the active workspace; null while there is no active/resolved workspace. */
export function selectActiveWorkspaceProjectId(state: ActiveWorkspaceState): string | null {
	return selectActiveWorkspace(state)?.projectId ?? null;
}

/** Shell location context: the active workspace owner takes precedence over the selected Project Home. */
export function selectContextProject(state: ProjectContextState): Project | null {
	const projectId = selectActiveWorkspace(state)?.projectId ?? state.selectedProjectId;
	return state.projects.find((project) => project.id === projectId) ?? null;
}
