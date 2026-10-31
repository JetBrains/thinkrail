import { t } from "@thinkrail/locales/react";
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
	getTransport,
} from "../transport";

function sendPrompt(sessionId: string, text: string): void {
	useAppStore.getState().appendUserMessage(sessionId, text);
	void getTransport()
		.request("session.prompt", { sessionId, text })
		.catch((err) => useAppStore.getState().appendErrorTurn(sessionId, errorText(err)));
}

export async function startChatInTab(
	workspaceId: string,
	{
		preferredGroupId,
		prompt,
		draft,
	}: { preferredGroupId?: string; prompt?: string; draft?: string } = {},
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
		if (prompt) sendPrompt(sessionId, prompt);
		else if (draft) store.setChatDraft(sessionId, draft);
	} catch {
		const state = useAppStore.getState();
		if (
			layoutOpenOptionsForNavigation(state, workspaceId, navigation).activate !== false &&
			!state.removedWorkspaceIds[workspaceId]
		) {
			toast.error(t("panels.openChat.sessionCreateFailed"), t("panels.openChat.startFailed"));
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
		(candidate) => candidate.kind === "chat" && candidate.sessionId === sessionId,
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
			toast.error(t("panels.openChat.restoreFailed"), t("panels.openChat.openFailed"));
		}
	} catch (err) {
		const current = useAppStore.getState();
		if (
			!background &&
			layoutOpenOptionsForNavigation(current, workspaceId, navigation).activate !== false &&
			!current.removedWorkspaceIds[workspaceId] &&
			!current.deletedSessionsByWorkspace[workspaceId]?.[sessionId]
		) {
			toast.error(errorText(err), t("panels.openChat.openFailed"));
		}
	} finally {
		useAppStore.getState().endChatStart(workspaceId);
	}
}

export async function promptWorkspaceChat(
	workspaceId: string,
	sessionId: string | null,
	text: string,
): Promise<void> {
	if (!sessionId) return startChatInTab(workspaceId, { prompt: text });
	await openChatInTab(workspaceId, sessionId);
	const runtime = useAppStore.getState().sessions[sessionId];
	if (!runtime) return;
	if (runtime.isStreaming) {
		await getTransport().request("session.followUp", { sessionId, text });
		return;
	}
	sendPrompt(sessionId, text);
}
