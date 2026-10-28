import type { Workspace } from "@thinkrail/contracts";
import { t } from "@thinkrail/locales/react";
import { selectWorkspaceById, toast, useAppStore } from "@/store";
import { errorText, getTransport } from "@/transport";
import type { WorkspaceChatTarget } from "./ChatActions";

/**
 * The one way a card opens another workspace's chat. A workspace the store holds opens under its own
 * project; an unknown one opens only once a fresh `workspace.list` on this connection shows it in an open
 * project. A vanished or deletion-pending workspace is never activated: the user is told it is gone.
 * `null`: a reconnect overtook the read, so nothing was decided.
 */
export async function openWorkspace(
	{ workspaceId, projectId, sessionId }: WorkspaceChatTarget,
	gone: string = t("chat.turn.workspaceGone"),
): Promise<boolean | null> {
	const known = selectWorkspaceById(useAppStore.getState(), workspaceId);
	if (known) return enter(known, sessionId, gone);
	const generation = useAppStore.getState().welcomeGeneration;
	let rows: Workspace[];
	try {
		rows = await getTransport().request("workspace.list", { projectId });
	} catch (err) {
		toast.error(errorText(err), t("chat.turn.workspaceOpenFailed"));
		return false;
	}
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
	if (workspace.deletionPending) {
		toast.error(gone);
		return false;
	}
	useAppStore.getState().activateWorkspaceFromRoute(workspace, sessionId);
	return true;
}
