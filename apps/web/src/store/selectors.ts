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

/** Whether a worktree-relative path is inside a skill directory — the auto-detect trigger for a reload. */
export function isSkillPath(path: string): boolean {
	return /(^|\/)\.(claude|github|gemini|pi|agents)\/skills(\/|$)/.test(path);
}

/**
 * A workspace's current live-refresh tick (0 before any fs change). Snapshot it at the **start** of a
 * skill-loading round-trip (session create / reload / hydrate) and record it as that session's sync
 * baseline once the load resolves — so a skill change whose `fsChanged` frame folds *while the load is in
 * flight* stays past the baseline and keeps the reload badge lit (the load saw the pre-change skills).
 */
export function selectWorkspaceTick(
	state: { fsChangesByWorkspace: Record<string, { tick: number }> },
	workspaceId: string,
): number {
	return state.fsChangesByWorkspace[workspaceId]?.tick ?? 0;
}

interface SkillsStaleState {
	/** Per workspace, the fs tick of the most recent skill-relevant `fsChanged` batch (see `noteFsChanged`). */
	skillChangeTickByWorkspace: Record<string, number>;
	/** Per session, the fs tick it last loaded/reloaded skills at (session create + successful reload). */
	skillsSyncedTickBySession: Record<string, number>;
}

/**
 * A session's Skills badge is stale when a skill-dir change landed on disk *after* the session last loaded
 * (or reloaded) its skills — the workspace's last skill-change tick is past this session's sync tick. Being
 * store-derived, it survives `ChatView` remounts on tab switch (the reported bug); being keyed per session,
 * a sibling or newer chat that loaded the current skills is not flagged, and a reload clears only its own.
 */
export function selectSkillsStale(
	state: SkillsStaleState,
	workspaceId: string,
	sessionId: string,
): boolean {
	return (
		(state.skillChangeTickByWorkspace[workspaceId] ?? 0) >
		(state.skillsSyncedTickBySession[sessionId] ?? 0)
	);
}
