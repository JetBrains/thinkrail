import { messagesToRuntime } from "../chat/hydrate";
import { toast, useAppStore } from "../store";
import { errorText, getSessionMessagesWithSkillBaseline } from "../transport";

/**
 * Open (or focus) a chat by session id — the ONE escalation every "take me to this chat" affordance
 * shares (`openFile.ts`'s pattern): an open tab is focused; a live-but-closed runtime is re-attached
 * (`reopenChat`); a disk-only session is fetched (`session.getMessages`) and hydrated focused. Used by
 * the chat-history dropdown (`CenterTabs`) and the review sidebar's linked-chat glyphs (`ReviewPanel`).
 * The guarded request waits for watcher startup, then captures the sync baseline before the fetch;
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
	try {
		const {
			result: { summary, messages },
			syncedTick,
		} = await getSessionMessagesWithSkillBaseline({ sessionId, workspaceId });
		useAppStore.getState().hydrateSession(summary, messagesToRuntime(messages), true, syncedTick);
	} catch (err) {
		toast.error(errorText(err), "Couldn't open the chat");
	}
}
