import type { Project } from "@thinkrail/contracts";
import { useAppStore } from "../store";
import { getTransport } from "../transport";

/**
 * Shared open-project orchestration reused by `ProjectTree` and `WelcomePanel` (so neither duplicates it).
 * These do the transport + store side only — selecting/expanding the opened project is the caller's job
 * (`ProjectTree` expands + loads its workspaces; `WelcomePanel` just selects it).
 */

/**
 * Register the git repo at `path` as a project host-side, refresh the store's project list, and return
 * the opened project. Returns `null` on an empty path or any failure (surfacing is the error pass's job).
 */
export async function openProjectPath(path: string): Promise<Project | null> {
	const trimmed = path.trim();
	if (!trimmed) return null;
	try {
		const project = await getTransport().request("project.open", { path: trimmed });
		useAppStore.getState().setProjects(await getTransport().request("project.list", {}));
		return project;
	} catch {
		return null;
	}
}

/** Ask the host for a directory via its native picker, then open it. Null if cancelled/unavailable. */
export async function pickAndOpenProject(): Promise<Project | null> {
	try {
		const { path } = await getTransport().request("dialog.selectDirectory", {});
		if (!path) return null;
		return await openProjectPath(path);
	} catch {
		return null;
	}
}
