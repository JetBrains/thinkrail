import type { Workspace } from "@thinkrail/contracts";
import { t } from "@thinkrail/locales/react";
import { selectNavigationMarker, selectWorkspaceById, toast, useAppStore } from "@/store";
import { errorText, getTransport } from "@/transport";
import type { WorkspaceChatTarget } from "./ChatActions";

let latestOpen = 0;

/**
 * The one way a card opens another workspace's chat. A workspace the store holds opens under its own
 * project; an unknown one opens only once a fresh `workspace.list` on this connection shows it in an open
 * project, and only if no newer open or navigation overtook that read (then it decides silently). A
 * vanished or deletion-pending workspace is never activated: the user is told it is gone.
 * `null`: a reconnect overtook the read, so nothing was decided.
 */
export async function openWorkspace(
	{ workspaceId, projectId, sessionId }: WorkspaceChatTarget,
	gone: string = t("chat.turn.workspaceGone"),
): Promise<boolean | null> {
	const open = ++latestOpen;
	const before = useAppStore.getState();
	const known = selectWorkspaceById(before, workspaceId);
	if (known) return enter(known, sessionId, gone);
	const marker = selectNavigationMarker(before);
	const stillWanted = () =>
		open === latestOpen && selectNavigationMarker(useAppStore.getState()) === marker;
	let rows: Workspace[];
	try {
		rows = await getTransport().request("workspace.list", { projectId });
	} catch (err) {
		if (stillWanted()) toast.error(errorText(err), t("chat.turn.workspaceOpenFailed"));
		return false;
	}
	if (!stillWanted()) return false;
	const store = useAppStore.getState();
	if (store.welcomeGeneration !== before.welcomeGeneration) return null;
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
	if (workspace.deletionPending) {
		toast.error(gone);
		return false;
	}
	useAppStore.getState().activateWorkspaceFromRoute(workspace, sessionId);
	return true;
}
