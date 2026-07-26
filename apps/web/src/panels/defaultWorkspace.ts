import type { Workspace } from "@thinkrail/contracts";
import { toast, useAppStore } from "@/store";
import { errorText, getTransport } from "@/transport";

/**
 * Resolve a project's built-in Default workspace (the project folder itself): list the project's
 * workspaces (the host's list *ensures* the Default exists — see submodule-server-workspaces), fold the
 * fresh list into the store, and return the `kind === "default"` row. Shared by the Welcome "Work in
 * project folder" fork card and the NewWorkspaceDialog's folder mode, so the resolve + degrade path
 * lives once. On failure — a transport error, or an older host that serves no Default — raises the
 * error toast and returns null (the caller decides what to do with its surface).
 */
export async function resolveDefaultWorkspace(projectId: string): Promise<Workspace | null> {
	try {
		const workspaces = await getTransport().request("workspace.list", { projectId });
		useAppStore.getState().setWorkspaces(projectId, workspaces);
		const def = workspaces.find((w) => w.kind === "default");
		if (!def) throw new Error("This host has no Default workspace for this project.");
		return def;
	} catch (err) {
		toast.error(errorText(err), "Couldn't open the project folder");
		return null;
	}
}
