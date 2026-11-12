import type { Project, Workspace } from "@thinkrail/contracts";
import { pathWithinRoot } from "../lib";
import { selectOpenWorkspaceForPath, useAppStore } from "../store";
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

export async function resolveOpenWorkspaceForPath(path: string): Promise<Workspace | null> {
	const { projects, workspaces } = useAppStore.getState();
	const unlisted = projects.filter((project) => workspaces[project.id] === undefined);
	const enclosing = unlisted.filter((project) => pathWithinRoot(path, project.path) !== null);
	await listWorkspaces(enclosing);
	const found = selectOpenWorkspaceForPath(useAppStore.getState(), path);
	if (found) return found;
	await listWorkspaces(unlisted.filter((project) => !enclosing.includes(project)));
	return selectOpenWorkspaceForPath(useAppStore.getState(), path);
}
