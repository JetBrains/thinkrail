import type { Workspace } from "@thinkrail/contracts";
import { isDefaultWorkspace, toast, useAppStore } from "@/store";
import { errorText, getTransport } from "@/transport";

/**
 * Enter a project's built-in Default workspace (the project folder itself) as **one atomic step**: list
 * the project's workspaces (the host's list *ensures* the Default exists — see
 * submodule-server-workspaces), fold the fresh list into the store, and activate the
 * `kind === "default"` row — the fold + activation always travel together, so they live here once, never
 * repeated at call sites (the rail's auto-expand follows the activation). Shared by the Welcome "Work in
 * project folder" fork card and the NewWorkspaceDialog's folder mode. On failure — a transport error, or
 * an older host that serves no Default — raises the error toast and returns null (the caller decides
 * what to do with its surface).
 */
export async function enterDefaultWorkspace(projectId: string): Promise<Workspace | null> {
	const title = "Couldn't open the project folder";
	let workspaces: Workspace[];
	try {
		workspaces = await getTransport().request("workspace.list", { projectId });
	} catch (err) {
		toast.error(errorText(err), title);
		return null;
	}
	const def = workspaces.find(isDefaultWorkspace);
	if (!def) {
		toast.error("This host has no Default workspace for this project.", title);
		return null;
	}
	const store = useAppStore.getState();
	store.setWorkspaces(projectId, workspaces);
	store.activateWorkspace(def);
	return def;
}
