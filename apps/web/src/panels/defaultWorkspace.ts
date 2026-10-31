import type { Workspace } from "@thinkrail/contracts";
import { t } from "@thinkrail/locales/react";
import { isDefaultWorkspace, toast, useAppStore } from "@/store";
import { errorText, getTransport } from "@/transport";

export async function enterDefaultWorkspace(
	projectId: string,
	stillWanted: () => boolean = () => true,
): Promise<Workspace | null> {
	const title = t("panels.defaultWorkspace.openFailed");
	let workspaces: Workspace[];
	try {
		workspaces = await getTransport().request("workspace.list", { projectId });
	} catch (err) {
		if (stillWanted()) toast.error(errorText(err), title);
		return null;
	}
	const def = workspaces.find(isDefaultWorkspace);
	if (!def) {
		toast.error(t("panels.defaultWorkspace.missing"), title);
		return null;
	}
	const store = useAppStore.getState();
	store.setWorkspaces(projectId, workspaces);
	if (!stillWanted()) return null;
	store.activateWorkspace(def);
	return def;
}
