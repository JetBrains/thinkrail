import {
	type Project,
	WORKSPACE_PATH_RESOLVE_PROTOCOL_VERSION,
	type Workspace,
	type WorkspacePathMatch,
} from "@thinkrail/contracts";
import { pathWithinRoot } from "../lib";
import { useAppStore } from "../store";
import { getTransport } from "../transport";

async function listWorkspaces(projects: readonly Project[]): Promise<void> {
	for (const { id } of projects) {
		const rows = await getTransport()
			.request("workspace.list", { projectId: id, includeDiffStats: false })
			.catch(() => null);
		const store = useAppStore.getState();
		if (!rows || store.workspaces[id] !== undefined) continue;
		if (!store.projects.some((project) => project.id === id)) continue;
		store.setWorkspaces(
			id,
			rows.filter((row) => row.projectId === id),
		);
	}
}

function loadedMatch(path: string): WorkspacePathMatch | null {
	const state = useAppStore.getState();
	let best: { workspace: Workspace; relativePath: string } | null = null;
	for (const project of state.projects) {
		for (const workspace of state.workspaces[project.id] ?? []) {
			if (workspace.deletionPending || state.removedWorkspaceIds[workspace.id]) continue;
			const relativePath = pathWithinRoot(path, workspace.worktreePath);
			if (!relativePath) continue;
			const shorter = !best || relativePath.length < best.relativePath.length;
			const tie =
				best?.relativePath.length === relativePath.length &&
				workspace.id === state.activeWorkspaceId;
			if (shorter || tie) best = { workspace, relativePath };
		}
	}
	return best
		? {
				workspaceId: best.workspace.id,
				projectId: best.workspace.projectId,
				relativePath: best.relativePath,
			}
		: null;
}

async function matchByRootSpelling(path: string): Promise<WorkspacePathMatch | null> {
	const { projects, workspaces } = useAppStore.getState();
	const unlisted = projects.filter((project) => workspaces[project.id] === undefined);
	const enclosing = unlisted.filter((project) => pathWithinRoot(path, project.path) !== null);
	await listWorkspaces(enclosing);
	const found = loadedMatch(path);
	if (found) return found;
	await listWorkspaces(unlisted.filter((project) => !enclosing.includes(project)));
	return loadedMatch(path);
}

export function resolveWorkspaceFile(path: string): Promise<WorkspacePathMatch | null> {
	const { protocolVersion } = useAppStore.getState();
	if (protocolVersion === null || protocolVersion < WORKSPACE_PATH_RESOLVE_PROTOCOL_VERSION) {
		return matchByRootSpelling(path);
	}
	return getTransport().request("workspace.resolvePath", { path });
}
