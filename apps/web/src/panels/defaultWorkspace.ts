import type { Workspace } from "@thinkrail/contracts";
import { isDefaultWorkspace, toast, useAppStore } from "@/store";
import { errorText, getTransport } from "@/transport";

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
