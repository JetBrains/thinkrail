import type { WorkspaceChatTarget } from "@thinkrail/chat-ui/ChatActions";
import type { Workspace } from "@thinkrail/contracts";
import { t } from "@thinkrail/locales/react";
import { isNavigationChange, selectWorkspaceById, toast, useAppStore } from "@/store";
import { errorText, getTransport } from "@/transport";

let latestOpen = 0;

export async function openWorkspace(
	{ workspaceId, projectId, sessionId }: WorkspaceChatTarget,
	gone: string = t("chat.turn.workspaceGone"),
): Promise<boolean | null> {
	const open = ++latestOpen;
	const known = selectWorkspaceById(useAppStore.getState(), workspaceId);
	if (known) return enter(known, sessionId, gone);
	const generation = useAppStore.getState().welcomeGeneration;
	let navigated = false;
	const stopWatching = useAppStore.subscribe((state, previous) => {
		if (isNavigationChange(state, previous)) navigated = true;
	});
	const stillWanted = () => open === latestOpen && !navigated;
	let rows: Workspace[];
	try {
		rows = await getTransport().request("workspace.list", { projectId });
	} catch (err) {
		if (stillWanted()) toast.error(errorText(err), t("chat.turn.workspaceOpenFailed"));
		return false;
	} finally {
		stopWatching();
	}
	if (!stillWanted()) return false;
	const store = useAppStore.getState();
	if (store.welcomeGeneration !== generation) return null;
	if (!store.projects.some((project) => project.id === projectId)) {
		toast.error(gone);
		return false;
	}
	store.setWorkspaces(projectId, rows);
	const row = rows.find((workspace) => workspace.id === workspaceId);
	if (!row) {
		toast.error(gone);
		return false;
	}
	return enter(row, sessionId, gone);
}

function enter(workspace: Workspace, sessionId: string | undefined, gone: string): boolean {
	const store = useAppStore.getState();
	if (
		workspace.deletionPending ||
		!store.projects.some((project) => project.id === workspace.projectId)
	) {
		toast.error(gone);
		return false;
	}
	store.activateWorkspaceFromRoute(workspace, sessionId);
	return true;
}
