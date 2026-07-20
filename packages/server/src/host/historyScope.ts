import type { HistoryScope, Project, Workspace } from "@thinkrail/contracts";

/**
 * Build the cwd/session filter + cwd→ids labeler for a scope, from registry snapshots. Pure.
 * For scope.kind === "workspace" with an unknown workspaceId, returns a filter that always
 * returns false (never throws).
 */
export function buildHistoryScope(
	scope: HistoryScope,
	projects: Project[],
	workspacesByProject: (projectId: string) => Workspace[],
): {
	filter: (cwd: string, sessionId: string) => boolean;
	labels: (cwd: string) => { workspaceId?: string; projectId?: string };
} {
	// Build a map of all worktreePath → {workspaceId, projectId} across all projects
	const pathMap = new Map<string, { workspaceId: string; projectId: string }>();
	for (const project of projects) {
		const workspaces = workspacesByProject(project.id);
		for (const ws of workspaces) {
			pathMap.set(ws.worktreePath, {
				workspaceId: ws.id,
				projectId: ws.projectId,
			});
		}
	}

	// Build the filter function based on scope kind
	let filter: (cwd: string, sessionId: string) => boolean;

	if (scope.kind === "all") {
		filter = () => true;
	} else if (scope.kind === "chat") {
		filter = (_cwd: string, sessionId: string) => sessionId === scope.sessionId;
	} else if (scope.kind === "workspace") {
		// Find the workspace in the path map
		let targetPath: string | undefined;
		for (const project of projects) {
			const workspaces = workspacesByProject(project.id);
			const found = workspaces.find((ws) => ws.id === scope.workspaceId);
			if (found) {
				targetPath = found.worktreePath;
				break;
			}
		}
		// If workspace not found, return a filter that always returns false
		if (!targetPath) {
			filter = () => false;
		} else {
			filter = (cwd: string) => cwd === targetPath;
		}
	} else if (scope.kind === "project") {
		const projectWorkspaces = workspacesByProject(scope.projectId);
		const pathSet = new Set(projectWorkspaces.map((ws) => ws.worktreePath));
		filter = (cwd: string) => pathSet.has(cwd);
	} else {
		const _exhaustive: never = scope;
		throw new Error(`Unknown scope kind: ${_exhaustive}`);
	}

	// Labels function: map cwd to {workspaceId, projectId}
	const labels = (cwd: string) => {
		const entry = pathMap.get(cwd);
		return entry ? { workspaceId: entry.workspaceId, projectId: entry.projectId } : {};
	};

	return { filter, labels };
}
