import { messagesToRuntime } from "../chat/hydrate";
import {
	type CenterNavigationStamp,
	type LayoutOpenOptions,
	layoutOpenOptionsForNavigation,
	toast,
	useAppStore,
} from "../store";
import {
	createSessionWithSkillBaseline,
	errorText,
	getSessionMessagesWithSkillBaseline,
} from "../transport";

export async function startChatInTab(
	workspaceId: string,
	preferredGroupId?: string,
): Promise<void> {
	const navigation = useAppStore.getState().beginCenterNavigation(workspaceId, preferredGroupId);
	useAppStore.getState().beginChatStart(workspaceId);
	try {
		const {
			result: { sessionId, model, thinkingLevel },
			syncedTick,
		} = await createSessionWithSkillBaseline({ workspaceId });
		const store = useAppStore.getState();
		store.openChatSession(
			workspaceId,
			sessionId,
			model,
			thinkingLevel,
			syncedTick,
			layoutOpenOptionsForNavigation(store, workspaceId, navigation),
		);
	} catch {
		const state = useAppStore.getState();
		if (
			layoutOpenOptionsForNavigation(state, workspaceId, navigation).activate !== false &&
			!state.removedWorkspaceIds[workspaceId]
		) {
			toast.error("The agent session could not be created.", "Couldn't start the chat");
		}
	} finally {
		useAppStore.getState().endChatStart(workspaceId);
	}
}

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
	store.beginChatStart(workspaceId);
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
	} finally {
		useAppStore.getState().endChatStart(workspaceId);
	}
}
