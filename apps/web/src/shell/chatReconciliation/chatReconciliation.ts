import type { LayoutCenterTab, WorkspaceLayoutDocument } from "@thinkrail/contracts";
import { useEffect, useRef } from "react";
import { messagesToRuntime } from "../../chat/hydrate";
import { type LayoutAttention, readLayoutSelection, tupleKey } from "../../lib";
import {
	type CenterNavigationStamp,
	captureCenterNavigation,
	chatTabId,
	type EditorTab,
	isConnectedGeneration,
	layoutOpenOptionsForNavigation,
	selectAttentionCenterTab,
	selectCurrentRouteChatTarget,
	selectWorkspaceSessionIds,
	shouldAdvanceAcceptedNavigation,
	toast,
	useAppStore,
} from "../../store";
import { errorText, getSessionMessagesWithSkillBaseline, getTransport } from "../../transport";
import {
	collectAllGroups,
	findPlacedResource,
	findTabLocation,
	removeSessionLayoutTabs,
	selectTab,
} from "../layout";
import { commitWorkspaceLayout } from "../layoutState";

const sessionHydration = new Map<string, Promise<boolean>>();
const AUTO_OPEN_CHAT_LIMIT = 4;

export function hydrateChatResource(workspaceId: string, sessionId: string): Promise<boolean> {
	const state = useAppStore.getState();
	if (
		state.removedWorkspaceIds[workspaceId] ||
		state.deletedSessionsByWorkspace[workspaceId]?.[sessionId]
	) {
		return Promise.resolve(false);
	}
	const connectionGeneration = state.connectionGeneration;
	const key = tupleKey("chat-hydration", workspaceId, sessionId, String(connectionGeneration));
	const existing = sessionHydration.get(key);
	if (existing) return existing;
	const request = getSessionMessagesWithSkillBaseline({ workspaceId, sessionId })
		.then(({ result: { summary, messages }, syncedTick }) => {
			const current = useAppStore.getState();
			if (current.connectionGeneration !== connectionGeneration) {
				if (
					current.removedWorkspaceIds[workspaceId] ||
					current.deletedSessionsByWorkspace[workspaceId]?.[sessionId]
				) {
					return false;
				}
				return hydrateChatResource(workspaceId, sessionId);
			}
			if (!isConnectedGeneration(current, connectionGeneration)) return false;
			const document = current.layoutDocumentsByWorkspace[workspaceId];
			const stillPlaced = document
				? collectAllGroups(document)
						.flatMap((group) => group.tabs)
						.some((tab) => tab.kind === "chat" && tab.sessionId === sessionId)
				: false;
			if (!stillPlaced) return false;
			current.hydrateSession(
				summary,
				messagesToRuntime(messages, summary.lastSettlement),
				false,
				summary.live ? undefined : syncedTick,
				{ activate: false },
			);
			const installed = useAppStore.getState();
			const installedDocument = installed.layoutDocumentsByWorkspace[workspaceId];
			const placementSurvives = installedDocument
				? collectAllGroups(installedDocument)
						.flatMap((group) => group.tabs)
						.some((tab) => tab.kind === "chat" && tab.sessionId === sessionId)
				: false;
			const cacheInstalled = (installed.tabsByWorkspace[workspaceId] ?? []).some(
				(tab) => tab.kind === "chat" && tab.sessionId === sessionId,
			);
			return (
				placementSurvives &&
				cacheInstalled &&
				!installed.removedWorkspaceIds[workspaceId] &&
				!installed.deletedSessionsByWorkspace[workspaceId]?.[sessionId] &&
				installed.sessions[sessionId] !== undefined
			);
		})
		.finally(() => sessionHydration.delete(key));
	sessionHydration.set(key, request);
	return request;
}

export function currentChatDestination(
	workspaceId: string,
	tab: Extract<LayoutCenterTab, { kind: "chat" }>,
	navigation: CenterNavigationStamp | null | undefined,
) {
	const state = useAppStore.getState();
	const document = state.layoutDocumentsByWorkspace[workspaceId];
	const placement = document ? findPlacedResource(document, tab) : null;
	const location = document && placement ? findTabLocation(document, placement.id) : null;
	const attention = state.layoutAttentionByWorkspace[workspaceId];
	return {
		state,
		current:
			location?.area === "center" &&
			attention !== undefined &&
			readLayoutSelection(attention, location.groupId) === placement?.id &&
			layoutOpenOptionsForNavigation(state, workspaceId, navigation ?? null).activate !== false,
	};
}

export function useDeletedChatPlacementReconciliation(workspaceId: string): void {
	const connectionGeneration = useAppStore((state) => state.connectionGeneration);
	const document = useAppStore((state) => state.layoutDocumentsByWorkspace[workspaceId]);
	const deletedSessions = useAppStore((state) => state.deletedSessionsByWorkspace[workspaceId]);
	const tombstonePruneAttempts = useRef(new WeakSet<WorkspaceLayoutDocument>());
	const tombstonePruneGeneration = useRef(connectionGeneration);

	useEffect(() => {
		if (tombstonePruneGeneration.current !== connectionGeneration) {
			tombstonePruneGeneration.current = connectionGeneration;
			tombstonePruneAttempts.current = new WeakSet<WorkspaceLayoutDocument>();
		}
		if (!document || !deletedSessions || tombstonePruneAttempts.current.has(document)) return;
		if (useAppStore.getState().layoutDocumentsByWorkspace[workspaceId] !== document) return;
		const deletedPlacedSessions = [
			...new Set(
				collectAllGroups(document)
					.flatMap((group) => group.tabs)
					.flatMap((tab) => {
						const sessionId =
							tab.kind === "chat"
								? tab.sessionId
								: tab.kind === "document" && tab.documentKind === "todo-plan"
									? tab.sourceId
									: null;
						return sessionId && Object.hasOwn(deletedSessions, sessionId) ? [sessionId] : [];
					}),
			),
		];
		if (deletedPlacedSessions.length === 0) return;
		const pendingRemoval = useAppStore
			.getState()
			.layoutIntents.some(
				(intent) =>
					intent.workspaceId === workspaceId &&
					intent.kind === "remove-session" &&
					deletedPlacedSessions.includes(intent.sessionId),
			);
		if (pendingRemoval) return;
		tombstonePruneAttempts.current.add(document);
		const pruned = deletedPlacedSessions.reduce(removeSessionLayoutTabs, document);
		if (pruned !== document) {
			void commitWorkspaceLayout(workspaceId, pruned).catch(() => {
				tombstonePruneAttempts.current.delete(document);
			});
		}
	}, [connectionGeneration, deletedSessions, document, workspaceId]);
}

export function useWorkspaceChatCatalogReconciliation(
	workspaceId: string,
	commit: (document: WorkspaceLayoutDocument) => void,
): void {
	const status = useAppStore((state) => state.status);
	const connectionGeneration = useAppStore((state) => state.connectionGeneration);
	const document = useAppStore((state) => state.layoutDocumentsByWorkspace[workspaceId]);
	const layoutReady = document !== undefined;
	const routeChatTargetGeneration = useAppStore((state) => state.routeChatTargetGeneration);
	const routeTargetSessionId = useAppStore((state) => {
		const target = selectCurrentRouteChatTarget(state);
		return target?.workspaceId === workspaceId ? target.sessionId : null;
	});
	const routeTargetResolved = useAppStore((state) => {
		const target = selectCurrentRouteChatTarget(state);
		if (!target?.validated || target.workspaceId !== workspaceId) return false;
		const selected = selectAttentionCenterTab(state, workspaceId);
		return (
			state.sessions[target.sessionId] !== undefined &&
			selected?.kind === "chat" &&
			selected.sessionId === target.sessionId
		);
	});

	useEffect(() => {
		if (routeTargetResolved) useAppStore.getState().clearRouteChatTarget();
	}, [routeTargetResolved]);

	useEffect(() => {
		if (!layoutReady || status !== "connected" || connectionGeneration === 0) return;
		const stateAtRequest = useAppStore.getState();
		const startedRouteTargetGeneration = routeChatTargetGeneration;
		const baselineDocument = stateAtRequest.layoutDocumentsByWorkspace[workspaceId];
		const baselinePlacedSessionIds = baselineDocument
			? collectAllGroups(baselineDocument)
					.flatMap((group) => group.tabs)
					.flatMap((tab) =>
						tab.kind === "chat"
							? [tab.sessionId]
							: tab.kind === "document" && tab.documentKind === "todo-plan"
								? [tab.sourceId]
								: [],
					)
			: [];
		const baselineSessionIds = [
			...new Set([
				...selectWorkspaceSessionIds(stateAtRequest, workspaceId),
				...baselinePlacedSessionIds,
			]),
		];
		let current = true;
		const live = () => {
			const state = useAppStore.getState();
			return (
				current &&
				state.routeChatTargetGeneration === startedRouteTargetGeneration &&
				isConnectedGeneration(state, connectionGeneration) &&
				!state.removedWorkspaceIds[workspaceId]
			);
		};
		const fetchMessages = (sessionId: string) =>
			getSessionMessagesWithSkillBaseline({ sessionId, workspaceId }).catch((error: unknown) => {
				if (live()) toast.error(errorText(error), "Couldn't load this chat");
				return null;
			});
		void getTransport()
			.request("session.list", { workspaceId })
			.then(async (summaries) => {
				if (!live()) return;
				if (summaries.some((summary) => summary.workspaceId !== workspaceId)) {
					throw new Error("Session list did not match the requested workspace");
				}
				useAppStore.getState().reconcileWorkspaceSessions(
					workspaceId,
					baselineSessionIds,
					summaries.map((summary) => summary.sessionId),
				);
				let latestDocument = useAppStore.getState().layoutDocumentsByWorkspace[workspaceId];
				const authoritativeSessionIds = new Set(summaries.map((summary) => summary.sessionId));
				const missingPlacedSessionIds = baselinePlacedSessionIds.filter(
					(sessionId) => !authoritativeSessionIds.has(sessionId),
				);
				if (latestDocument && missingPlacedSessionIds.length > 0) {
					const pruned = missingPlacedSessionIds.reduce(removeSessionLayoutTabs, latestDocument);
					if (pruned !== latestDocument) {
						latestDocument = pruned;
						commit(pruned);
					}
				}
				const placed = new Set(
					latestDocument
						? collectAllGroups(latestDocument)
								.flatMap((group) => group.tabs)
								.filter((tab) => tab.kind === "chat")
								.map((tab) => tab.sessionId)
						: [],
				);
				let handledRouteSessionId: string | null = null;
				const target = selectCurrentRouteChatTarget(useAppStore.getState());
				if (target?.workspaceId === workspaceId) {
					const targetSummary = summaries.find((summary) => summary.sessionId === target.sessionId);
					if (!targetSummary) {
						useAppStore.getState().clearRouteChatTarget();
					} else {
						handledRouteSessionId = target.sessionId;
						useAppStore.getState().validateRouteChatTarget(target.sessionId);
						const targetState = useAppStore.getState();
						const targetOptions = layoutOpenOptionsForNavigation(
							targetState,
							workspaceId,
							target.navigation,
						);
						const cache = targetState.tabsByWorkspace[workspaceId]?.find(
							(tab): tab is Extract<EditorTab, { kind: "chat" }> =>
								tab.kind === "chat" && tab.sessionId === target.sessionId,
						);
						if (targetState.sessions[target.sessionId]) {
							targetState.openTab(
								cache ?? {
									kind: "chat",
									id: chatTabId(workspaceId, target.sessionId),
									workspaceId,
									name: targetSummary.title,
									sessionId: target.sessionId,
								},
								"keep",
								true,
								targetOptions,
							);
						} else {
							const loaded = await fetchMessages(target.sessionId);
							if (!live()) return;
							const currentTarget = selectCurrentRouteChatTarget(useAppStore.getState());
							if (currentTarget?.sessionId === target.sessionId && loaded) {
								const { summary, messages } = loaded.result;
								useAppStore
									.getState()
									.hydrateSession(
										summary,
										messagesToRuntime(messages, summary.lastSettlement),
										true,
										summary.live ? undefined : loaded.syncedTick,
										targetOptions,
									);
							}
						}
					}
				}
				let sawKnown = false;
				const toOpen: typeof summaries = [];
				const toHistory: typeof summaries = [];
				for (const summary of [...summaries].sort((a, b) => b.updatedAt - a.updatedAt)) {
					if (summary.sessionId === handledRouteSessionId || placed.has(summary.sessionId))
						continue;
					if (useAppStore.getState().sessions[summary.sessionId]) {
						sawKnown = true;
						continue;
					}
					if (
						(summary.live || (summary.openTodos ?? 0) > 0) &&
						toOpen.length < AUTO_OPEN_CHAT_LIMIT
					) {
						toOpen.push(summary);
					} else {
						toHistory.push(summary);
					}
				}
				if (
					handledRouteSessionId === null &&
					placed.size === 0 &&
					toOpen.length === 0 &&
					!sawKnown
				) {
					const fallback = toHistory.shift();
					if (fallback) toOpen.push(fallback);
				}
				const navigation =
					toOpen.length > 0 ? captureCenterNavigation(useAppStore.getState(), workspaceId) : null;
				const loads = toOpen.map((summary) => ({
					summary,
					result: fetchMessages(summary.sessionId),
				}));
				let openedCount = 0;
				const failedToOpen: typeof summaries = [];
				for (const load of loads) {
					const loaded = await load.result;
					if (!live()) continue;
					if (!loaded) {
						failedToOpen.push(load.summary);
						continue;
					}
					const { summary, messages } = loaded.result;
					useAppStore
						.getState()
						.hydrateSession(
							summary,
							messagesToRuntime(messages, summary.lastSettlement),
							false,
							summary.live ? undefined : loaded.syncedTick,
							{ activate: false },
						);
					const state = useAppStore.getState();
					const cache = state.tabsByWorkspace[workspaceId]?.find(
						(tab): tab is Extract<EditorTab, { kind: "chat" }> =>
							tab.kind === "chat" && tab.sessionId === summary.sessionId,
					);
					if (!state.sessions[summary.sessionId] || !cache) continue;
					const activate = handledRouteSessionId === null && openedCount === 0;
					openedCount += 1;
					const routed = layoutOpenOptionsForNavigation(state, workspaceId, navigation);
					state.enqueueLayoutIntent({
						kind: "open",
						workspaceId,
						tab: cache,
						intent: "keep",
						...routed,
						activate: activate && routed.activate !== false,
						countNavigation: false,
					});
				}
				const history = [...toHistory, ...failedToOpen];
				if (!live() || history.length === 0) return;
				useAppStore.getState().noteClosedChats(
					workspaceId,
					history.map((summary) => ({
						sessionId: summary.sessionId,
						title: summary.title,
						closedAt: summary.updatedAt,
					})),
				);
			})
			.catch((error: unknown) => {
				if (live()) toast.error(errorText(error), "Couldn't load this workspace's chats");
			});
		return () => {
			current = false;
		};
	}, [commit, connectionGeneration, layoutReady, routeChatTargetGeneration, status, workspaceId]);

	useEffect(() => {
		if (!document || status !== "connected") return;
		if (useAppStore.getState().layoutDocumentsByWorkspace[workspaceId] !== document) return;
		let current = true;
		const placedTabs = collectAllGroups(document)
			.flatMap((group) => group.tabs)
			.filter((tab) => tab.kind === "chat");
		void (async () => {
			for (const tab of placedTabs) {
				if (!current) continue;
				const state = useAppStore.getState();
				const latestDocument = state.layoutDocumentsByWorkspace[workspaceId];
				const currentPlacement = latestDocument ? findPlacedResource(latestDocument, tab) : null;
				if (
					currentPlacement?.kind !== "chat" ||
					currentPlacement.sessionId === routeTargetSessionId
				) {
					continue;
				}
				state.restorePlacedChatCache(
					workspaceId,
					currentPlacement.id,
					currentPlacement.sessionId,
					currentPlacement.name,
				);
				if (state.sessions[currentPlacement.sessionId]) continue;
				try {
					await hydrateChatResource(workspaceId, currentPlacement.sessionId);
				} catch {}
			}
		})();
		return () => {
			current = false;
		};
	}, [document, routeTargetSessionId, status, workspaceId]);
}

export function useChatLocationReconciliation(
	workspaceId: string,
	changeAttention: (next: LayoutAttention) => void,
): void {
	const status = useAppStore((state) => state.status);
	const connectionGeneration = useAppStore((state) => state.connectionGeneration);
	const document = useAppStore((state) => state.layoutDocumentsByWorkspace[workspaceId]);
	const chatLocationRequest = useAppStore((state) => state.chatLocationRequest);
	const chatLocationFlight = useRef<{
		request: object;
		navigation: CenterNavigationStamp | null;
	} | null>(null);

	useEffect(() => {
		if (!chatLocationRequest || chatLocationRequest.workspaceId !== workspaceId || !document) {
			return;
		}
		const stateAtRequest = useAppStore.getState();
		if (
			stateAtRequest.chatLocationRequest !== chatLocationRequest ||
			stateAtRequest.layoutDocumentsByWorkspace[workspaceId] !== document
		) {
			return;
		}
		if (chatLocationFlight.current?.request !== chatLocationRequest) {
			chatLocationFlight.current = {
				request: chatLocationRequest,
				navigation: Object.hasOwn(chatLocationRequest, "navigation")
					? (chatLocationRequest.navigation ?? null)
					: stateAtRequest.beginCenterNavigation(workspaceId),
			};
		}
		const navigation = chatLocationFlight.current.navigation;
		const sessionId = chatLocationRequest.sessionId;
		const placed = collectAllGroups(document)
			.flatMap((group) => group.tabs)
			.find(
				(tab): tab is Extract<LayoutCenterTab, { kind: "chat" }> =>
					tab.kind === "chat" && tab.sessionId === sessionId,
			);
		if (placed) {
			const currentState = useAppStore.getState();
			const location = findTabLocation(document, placed.id);
			const currentAttention = currentState.layoutAttentionByWorkspace[workspaceId];
			const routed = layoutOpenOptionsForNavigation(currentState, workspaceId, navigation);
			if (location && currentAttention && routed.activate !== false) {
				changeAttention(
					selectTab(
						currentAttention,
						location,
						placed.id,
						shouldAdvanceAcceptedNavigation(currentAttention, navigation),
					),
				);
			}
			if (!currentState.sessions[sessionId]) {
				void hydrateChatResource(workspaceId, sessionId)
					.then((installed) => {
						const latest = useAppStore.getState();
						if (latest.chatLocationRequest !== chatLocationRequest) return;
						const { current } = currentChatDestination(workspaceId, placed, navigation);
						if (installed && current) return;
						if (
							!installed &&
							current &&
							!latest.removedWorkspaceIds[workspaceId] &&
							!latest.deletedSessionsByWorkspace[workspaceId]?.[sessionId]
						) {
							toast.error("The chat could not be restored.", "Couldn't open the chat");
						}
						latest.clearChatLocation();
					})
					.catch((error) => {
						const latest = useAppStore.getState();
						if (latest.chatLocationRequest !== chatLocationRequest) return;
						const { current } = currentChatDestination(workspaceId, placed, navigation);
						if (
							current &&
							!latest.removedWorkspaceIds[workspaceId] &&
							!latest.deletedSessionsByWorkspace[workspaceId]?.[sessionId]
						) {
							toast.error(errorText(error), "Couldn't open the chat");
						}
						latest.clearChatLocation();
					});
			}
			if (routed.activate === false) currentState.clearChatLocation();
			return;
		}
		const state = useAppStore.getState();
		if (state.sessions[sessionId]) {
			const existing = state.tabsByWorkspace[workspaceId]?.find(
				(tab): tab is Extract<EditorTab, { kind: "chat" }> =>
					tab.kind === "chat" && tab.sessionId === sessionId,
			);
			const title =
				existing?.name ??
				state.closedChatsByWorkspace[workspaceId]?.find((chat) => chat.sessionId === sessionId)
					?.title ??
				"Chat";
			state.openTab(
				{
					kind: "chat",
					id: existing?.id ?? chatTabId(workspaceId, sessionId),
					workspaceId,
					name: title,
					sessionId,
				},
				"keep",
				true,
				layoutOpenOptionsForNavigation(state, workspaceId, navigation),
			);
			return;
		}
		if (status !== "connected" || !isConnectedGeneration(state, connectionGeneration)) return;
		let current = true;
		void getSessionMessagesWithSkillBaseline({ workspaceId, sessionId })
			.then(({ result: { summary, messages }, syncedTick }) => {
				if (!current) return;
				const currentState = useAppStore.getState();
				if (
					!isConnectedGeneration(currentState, connectionGeneration) ||
					currentState.chatLocationRequest !== chatLocationRequest ||
					currentState.layoutDocumentsByWorkspace[workspaceId] !== document
				) {
					return;
				}
				currentState.hydrateSession(
					summary,
					messagesToRuntime(messages, summary.lastSettlement),
					true,
					summary.live ? undefined : syncedTick,
					layoutOpenOptionsForNavigation(currentState, workspaceId, navigation),
				);
				const settled = useAppStore.getState();
				const installed =
					settled.sessions[sessionId] !== undefined &&
					(settled.tabsByWorkspace[workspaceId] ?? []).some(
						(tab) => tab.kind === "chat" && tab.sessionId === sessionId,
					);
				if (settled.chatLocationRequest === chatLocationRequest && !installed) {
					const remainsCurrent =
						layoutOpenOptionsForNavigation(settled, workspaceId, navigation).activate !== false;
					if (
						remainsCurrent &&
						!settled.removedWorkspaceIds[workspaceId] &&
						!settled.deletedSessionsByWorkspace[workspaceId]?.[sessionId]
					) {
						toast.error("The chat could not be restored.", "Couldn't open the chat");
					}
					settled.clearChatLocation();
				}
			})
			.catch((error) => {
				if (!current) return;
				const latest = useAppStore.getState();
				if (
					!isConnectedGeneration(latest, connectionGeneration) ||
					latest.chatLocationRequest !== chatLocationRequest ||
					latest.layoutDocumentsByWorkspace[workspaceId] !== document
				) {
					return;
				}
				if (
					layoutOpenOptionsForNavigation(latest, workspaceId, navigation).activate !== false &&
					!latest.removedWorkspaceIds[workspaceId] &&
					!latest.deletedSessionsByWorkspace[workspaceId]?.[sessionId]
				) {
					toast.error(errorText(error), "Couldn't open the chat");
				}
				if (latest.chatLocationRequest === chatLocationRequest) latest.clearChatLocation();
			});
		return () => {
			current = false;
		};
	}, [changeAttention, chatLocationRequest, connectionGeneration, document, status, workspaceId]);
}
