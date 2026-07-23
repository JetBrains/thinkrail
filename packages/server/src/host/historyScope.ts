import type { HistoryScope, Project, Workspace } from "@thinkrail/contracts";

/**
 * Build the cwd/session filter + cwd→ids labeler for a scope, from registry snapshots. Pure.
 * Single-pass registry traversal (workspacesByProject called once per project).
 * Only uses id/projectId/worktreePath from workspaces — allows both diffStats-free and full records.
 * For scope.kind === "workspace" with an unknown workspaceId, returns a filter that always
 * returns false (never throws). Unknown scope kinds also filter to false at runtime.
 */
export function buildHistoryScope(
	scope: HistoryScope,
	projects: Project[],
	workspacesByProject: (
		projectId: string,
	) => Array<Pick<Workspace, "id" | "projectId" | "worktreePath">>,
): {
	filter: (cwd: string, sessionId: string) => boolean;
	labels: (cwd: string) => { workspaceId?: string; projectId?: string };
} {
	// Single pass: build all lookup tables from registry (workspacesByProject called once per project)
	const pathMap = new Map<string, { workspaceId: string; projectId: string }>();
	const workspaceIdMap = new Map<string, string>(); // workspaceId → worktreePath
	const projectIdMap = new Map<string, Set<string>>(); // projectId → Set<worktreePath>

	for (const project of projects) {
		const workspaces = workspacesByProject(project.id);
		const pathSet = new Set<string>();
		for (const ws of workspaces) {
			pathMap.set(ws.worktreePath, {
				workspaceId: ws.id,
				projectId: ws.projectId,
			});
			workspaceIdMap.set(ws.id, ws.worktreePath);
			pathSet.add(ws.worktreePath);
		}
		projectIdMap.set(project.id, pathSet);
	}

	// Build the filter function based on scope kind
	let filter: (cwd: string, sessionId: string) => boolean;

	if (scope.kind === "all") {
		filter = () => true;
	} else if (scope.kind === "chat") {
		filter = (_cwd: string, sessionId: string) => sessionId === scope.sessionId;
	} else if (scope.kind === "workspace") {
		const targetPath = workspaceIdMap.get(scope.workspaceId);
		// If workspace not found, return a filter that always returns false
		if (targetPath === undefined) {
			filter = () => false;
		} else {
			filter = (cwd: string) => cwd === targetPath;
		}
	} else if (scope.kind === "project") {
		const pathSet = projectIdMap.get(scope.projectId);
		if (pathSet === undefined) {
			// Unknown project: no workspaces to match
			filter = () => false;
		} else {
			filter = (cwd: string) => pathSet.has(cwd);
		}
	} else {
		// Runtime safety: unknown scope kinds filter to false, never throw
		const _exhaustive: never = scope;
		filter = () => false;
	}

	// Labels function: map cwd to {workspaceId, projectId}
	const labels = (cwd: string) => {
		const entry = pathMap.get(cwd);
		return entry ? { workspaceId: entry.workspaceId, projectId: entry.projectId } : {};
	};

	return { filter, labels };
}
