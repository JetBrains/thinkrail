import type { HistoryScope, Project, Workspace } from "@thinkrail/contracts";

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
	const pathMap = new Map<string, { workspaceId: string; projectId: string }>();
	const workspaceIdMap = new Map<string, string>();
	const projectIdMap = new Map<string, Set<string>>();

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

	let filter: (cwd: string, sessionId: string) => boolean;

	if (scope.kind === "all") {
		filter = () => true;
	} else if (scope.kind === "chat") {
		filter = (_cwd: string, sessionId: string) => sessionId === scope.sessionId;
	} else if (scope.kind === "workspace") {
		const targetPath = workspaceIdMap.get(scope.workspaceId);
		if (targetPath === undefined) {
			filter = () => false;
		} else {
			filter = (cwd: string) => cwd === targetPath;
		}
	} else if (scope.kind === "project") {
		const pathSet = projectIdMap.get(scope.projectId);
		if (pathSet === undefined) {
			filter = () => false;
		} else {
			filter = (cwd: string) => pathSet.has(cwd);
		}
	} else {
		const _exhaustive: never = scope;
		filter = () => false;
	}

	const labels = (cwd: string) => {
		const entry = pathMap.get(cwd);
		return entry ? { workspaceId: entry.workspaceId, projectId: entry.projectId } : {};
	};

	return { filter, labels };
}
