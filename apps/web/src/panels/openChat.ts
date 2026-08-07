import { messagesToRuntime } from "../chat/hydrate";
import { selectWorkspaceTick, toast, useAppStore } from "../store";
import { errorText, getTransport } from "../transport";

/**
 * Open (or focus) a chat by session id — the ONE escalation every "take me to this chat" affordance
 * shares (`openFile.ts`'s pattern): an open tab is focused; a live-but-closed runtime is re-attached
 * (`reopenChat`); a disk-only session is fetched (`session.getMessages`) and hydrated focused. Used by
 * the chat-history dropdown (`CenterTabs`) and the review sidebar's linked-chat glyphs (`ReviewPanel`).
 * The sync baseline is snapshotted before the fetch (see `selectWorkspaceTick` / `hydrateSession`);
 * a failed fetch raises a toast — the entry stays wherever it was for a retry.
 */
export async function openChatInTab(workspaceId: string, sessionId: string): Promise<void> {
	const store = useAppStore.getState();
	const tab = (store.tabsByWorkspace[workspaceId] ?? []).find(
		(t) => t.kind === "chat" && t.sessionId === sessionId,
	);
	if (tab) {
		store.setActiveTab(tab.id);
		return;
	}
	if (store.sessions[sessionId]) {
		store.reopenChat(sessionId);
		return;
	}
	const syncedTick = selectWorkspaceTick(store, workspaceId);
	try {
		const { summary, messages } = await getTransport().request("session.getMessages", {
			sessionId,
			workspaceId,
		});
		useAppStore.getState().hydrateSession(summary, messagesToRuntime(messages), true, syncedTick);
	} catch (err) {
		toast.error(errorText(err), "Couldn't open the chat");
	}
}
