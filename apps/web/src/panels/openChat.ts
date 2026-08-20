import { messagesToRuntime } from "../chat/hydrate";
import {
	type CenterNavigationStamp,
	type LayoutOpenOptions,
	layoutOpenOptionsForNavigation,
	toast,
	useAppStore,
} from "../store";
import { errorText, getSessionMessagesWithSkillBaseline } from "../transport";

/**
 * Open (or focus) a chat by session id — the ONE escalation every "take me to this chat" affordance
 * shares (`openFile.ts`'s pattern): an open tab is focused; a live-but-closed runtime is re-attached
 * (`reopenChat`); a disk-only session is fetched (`session.getMessages`) and hydrated focused. Used by
 * the workbench's chat-history menu (`WorkspaceChatHistory`) and Review's linked-chat glyphs.
 * The guarded request waits for watcher startup, then captures the sync baseline before the fetch;
 * a failed fetch raises a toast — the entry stays wherever it was for a retry.
 */
export async function openChatInTab(
	workspaceId: string,
	sessionId: string,
	requestedNavigation?: CenterNavigationStamp | null,
	background = false,
): Promise<void> {
	const initial = useAppStore.getState();
	const requestConnectionGeneration =
		initial.status === "connected" ? initial.connectionGeneration : null;
	if (
		initial.removedWorkspaceIds[workspaceId] ||
		initial.deletedSessionsByWorkspace[workspaceId]?.[sessionId]
	) {
		return;
	}
	const navigation =
		requestedNavigation === undefined
			? useAppStore.getState().beginCenterNavigation(workspaceId)
			: requestedNavigation;
	const store = useAppStore.getState();
	const routedOptions = layoutOpenOptionsForNavigation(store, workspaceId, navigation);
	const options: LayoutOpenOptions = background
		? { ...routedOptions, activate: false }
		: routedOptions;
	const tab = (store.tabsByWorkspace[workspaceId] ?? []).find(
		(t) => t.kind === "chat" && t.sessionId === sessionId,
	);
	if (tab) {
		store.openTab(tab, "keep", true, options);
		return;
	}
	if (store.sessions[sessionId]) {
		store.reopenChat(workspaceId, sessionId, options);
		return;
	}
	try {
		const {
			result: { summary, messages },
			syncedTick,
		} = await getSessionMessagesWithSkillBaseline({ sessionId, workspaceId });
		const current = useAppStore.getState();
		if (
			requestConnectionGeneration !== null &&
			current.connectionGeneration !== requestConnectionGeneration &&
			!current.removedWorkspaceIds[workspaceId] &&
			!current.deletedSessionsByWorkspace[workspaceId]?.[sessionId]
		) {
			return openChatInTab(workspaceId, sessionId, navigation, background);
		}
		const routed = layoutOpenOptionsForNavigation(current, workspaceId, navigation);
		const effectiveOptions: LayoutOpenOptions = background
			? { ...routed, activate: false }
			: routed;
		current.hydrateSession(
			summary,
			messagesToRuntime(messages, summary.lastSettlement),
			true,
			summary.live ? undefined : syncedTick,
			effectiveOptions,
		);
		const settled = useAppStore.getState();
		const installed =
			settled.sessions[sessionId] !== undefined &&
			(settled.tabsByWorkspace[workspaceId] ?? []).some(
				(tab) => tab.kind === "chat" && tab.sessionId === sessionId,
			);
		if (
			!installed &&
			effectiveOptions.activate !== false &&
			!settled.removedWorkspaceIds[workspaceId] &&
			!settled.deletedSessionsByWorkspace[workspaceId]?.[sessionId]
		) {
			toast.error("The chat could not be restored.", "Couldn't open the chat");
		}
	} catch (err) {
		const current = useAppStore.getState();
		if (
			!background &&
			layoutOpenOptionsForNavigation(current, workspaceId, navigation).activate !== false &&
			!current.removedWorkspaceIds[workspaceId] &&
			!current.deletedSessionsByWorkspace[workspaceId]?.[sessionId]
		) {
			toast.error(errorText(err), "Couldn't open the chat");
		}
	}
}
