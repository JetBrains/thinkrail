import type { LayoutCenterTab, WorkspaceLayoutDocument } from "@thinkrail/contracts";
import { useEffect } from "react";
import type { LayoutAttention } from "../../lib";
import {
	type EditorTab,
	layoutOpenOptionsForNavigation,
	shouldAdvanceAcceptedNavigation,
	toast,
	useAppStore,
} from "../../store";
import { errorText } from "../../transport";
import { currentChatDestination, hydrateChatResource } from "../chatReconciliation";
import {
	closeLayoutTab,
	collectAllGroups,
	findCenterGroup,
	findLayoutTab,
	findPlacedResource,
	findTabLocation,
	hideSide,
	isLayoutUnavailable,
	keepPreview,
	type LayoutTabFocusRequest,
	moveTabToGroup,
	openCenterTab,
	primaryCenterGroupId,
	reconcileAttention,
	removeSessionLayoutTabs,
	revealTool,
	selectTab,
	setSideGroupFolded,
	showSide,
	withAvailablePlacementId,
} from "../layout";
import { terminalLayoutId } from "../terminalReconciliation";

export function toLayoutTab(tab: EditorTab): LayoutCenterTab | null {
	switch (tab.kind) {
		case "file":
			return { kind: "file", id: tab.id, name: tab.name, path: tab.path };
		case "diff":
			return { kind: "diff", id: tab.id, name: tab.name, path: tab.path, scope: tab.scope };
		case "chat":
			return {
				kind: "chat",
				id: tab.id,
				name: tab.name,
				sessionId: tab.sessionId,
			};
		case "doc": {
			if (!tab.sourceId) return null;
			return {
				kind: "document",
				id: tab.id,
				name: tab.name,
				documentKind: "todo-plan",
				sourceId: tab.sourceId,
				docPath: tab.docPath,
			};
		}
		case "plan":
			return {
				kind: "document",
				id: tab.id,
				name: tab.name,
				documentKind: "todo-plan",
				sourceId: tab.sessionId,
				docPath: "TODO.md",
			};
	}
}

export function useLayoutIntentProcessing(
	workspaceId: string,
	commit: (document: WorkspaceLayoutDocument) => void,
	changeAttention: (next: LayoutAttention) => void,
	requestFocus: (request: LayoutTabFocusRequest) => void,
): void {
	const document = useAppStore((state) => state.layoutDocumentsByWorkspace[workspaceId]);
	const attention = useAppStore((state) => state.layoutAttentionByWorkspace[workspaceId]);
	const layoutIntent = useAppStore(
		(state) => state.layoutIntents.find((intent) => intent.workspaceId === workspaceId) ?? null,
	);
	const maxSideGroups = useAppStore((state) => state.layoutSettings.maxSideGroups);

	useEffect(() => {
		if (!layoutIntent || !document || !attention) return;
		const currentState = useAppStore.getState();
		if (
			currentState.layoutDocumentsByWorkspace[workspaceId] !== document ||
			currentState.layoutAttentionByWorkspace[workspaceId] !== attention
		) {
			return;
		}
		if (
			layoutIntent.kind === "select" &&
			layoutIntent.historyRequestId !== undefined &&
			currentState.historyOpenRequest?.id !== layoutIntent.historyRequestId
		) {
			currentState.consumeLayoutIntent(layoutIntent.id);
			return;
		}
		currentState.consumeLayoutIntent(layoutIntent.id);
		const carriesRequestNavigation =
			(layoutIntent.kind === "open" ||
				layoutIntent.kind === "select" ||
				layoutIntent.kind === "place-terminal") &&
			Object.hasOwn(layoutIntent, "navigation");
		const requestNavigation = carriesRequestNavigation ? layoutIntent.navigation : undefined;
		const currentRouting = carriesRequestNavigation
			? layoutOpenOptionsForNavigation(
					useAppStore.getState(),
					workspaceId,
					requestNavigation ?? null,
				)
			: null;
		let result:
			| { document: WorkspaceLayoutDocument; focusGroupId?: string; focusTabId?: string }
			| undefined;
		switch (layoutIntent.kind) {
			case "open": {
				const cacheTab = toLayoutTab(layoutIntent.tab);
				if (!cacheTab) break;
				const tab = withAvailablePlacementId(document, cacheTab);
				const requestedGroupId = currentRouting?.targetGroupId ?? layoutIntent.targetGroupId;
				const groupId =
					requestedGroupId && findCenterGroup(document.center, requestedGroupId)
						? requestedGroupId
						: findCenterGroup(document.center, attention.lastFocusedCenterGroupId)
							? attention.lastFocusedCenterGroupId
							: primaryCenterGroupId(document);
				const opened = openCenterTab(
					document,
					tab,
					groupId,
					layoutIntent.intent,
					layoutIntent.claimPreview,
				);
				if (!isLayoutUnavailable(opened)) result = opened;
				break;
			}
			case "close":
				if (findTabLocation(document, layoutIntent.tabId)) {
					result = closeLayoutTab(document, layoutIntent.tabId);
				}
				break;
			case "select": {
				const requestedResource = layoutIntent.resource ? toLayoutTab(layoutIntent.resource) : null;
				const placed = requestedResource
					? findPlacedResource(document, requestedResource)
					: findLayoutTab(document, layoutIntent.tabId);
				const selectedTabId = placed?.id;
				if (!selectedTabId) {
					const state = useAppStore.getState();
					const historyRequest = state.historyOpenRequest;
					if (
						layoutIntent.resource?.kind === "chat" &&
						historyRequest !== null &&
						historyRequest.id === layoutIntent.historyRequestId &&
						historyRequest.sessionId === layoutIntent.resource.sessionId
					) {
						state.clearHistoryOpen();
					}
					break;
				}
				const location = findTabLocation(document, selectedTabId);
				if (!location) break;
				if (currentRouting?.activate === false) {
					if (layoutIntent.focus === false) {
						const state = useAppStore.getState();
						const historyRequest = state.historyOpenRequest;
						if (
							placed.kind === "chat" &&
							historyRequest !== null &&
							historyRequest.id === layoutIntent.historyRequestId &&
							historyRequest.sessionId === placed.sessionId
						) {
							state.clearHistoryOpen();
						}
					}
					break;
				}
				let nextDocument = document;
				if (layoutIntent.keep && location.area === "center") {
					const kept = keepPreview(document, location.groupId, selectedTabId);
					if (!isLayoutUnavailable(kept)) nextDocument = kept.document;
				}
				const nextAttention = selectTab(
					attention,
					location,
					selectedTabId,
					layoutIntent.countNavigation ??
						shouldAdvanceAcceptedNavigation(attention, requestNavigation),
				);
				changeAttention(nextAttention);
				if (layoutIntent.focus !== false) {
					requestFocus({ key: layoutIntent.id, location, tabId: selectedTabId });
				}
				if (placed.kind === "chat" && layoutIntent.historyRequestId) {
					const state = useAppStore.getState();
					const historyRequest = state.historyOpenRequest;
					if (
						historyRequest?.id === layoutIntent.historyRequestId &&
						historyRequest.sessionId === placed.sessionId &&
						!state.sessions[placed.sessionId]
					) {
						void hydrateChatResource(workspaceId, placed.sessionId)
							.then((installed) => {
								const latest = useAppStore.getState();
								const latestHistoryRequest = latest.historyOpenRequest;
								if (
									!latestHistoryRequest ||
									latestHistoryRequest.id !== layoutIntent.historyRequestId ||
									latestHistoryRequest.sessionId !== placed.sessionId
								) {
									return;
								}
								const { current } = currentChatDestination(workspaceId, placed, requestNavigation);
								if (installed && current) return;
								if (
									!installed &&
									current &&
									!latest.removedWorkspaceIds[workspaceId] &&
									!latest.deletedSessionsByWorkspace[workspaceId]?.[placed.sessionId]
								) {
									toast.error("The chat could not be restored.", "Couldn't open chat history");
								}
								latest.clearHistoryOpen();
							})
							.catch((error) => {
								const latest = useAppStore.getState();
								const latestHistoryRequest = latest.historyOpenRequest;
								if (
									!latestHistoryRequest ||
									latestHistoryRequest.id !== layoutIntent.historyRequestId ||
									latestHistoryRequest.sessionId !== placed.sessionId
								) {
									return;
								}
								const { current } = currentChatDestination(workspaceId, placed, requestNavigation);
								if (
									current &&
									!latest.removedWorkspaceIds[workspaceId] &&
									!latest.deletedSessionsByWorkspace[workspaceId]?.[placed.sessionId]
								) {
									toast.error(errorText(error), "Couldn't open chat history");
								}
								latest.clearHistoryOpen();
							});
					}
				}
				if (nextDocument !== document) commit(nextDocument);
				break;
			}
			case "reveal-tool": {
				const revealed = revealTool(document, layoutIntent.tool, maxSideGroups);
				if (!isLayoutUnavailable(revealed)) result = revealed;
				break;
			}
			case "remove-session":
				result = { document: removeSessionLayoutTabs(document, layoutIntent.sessionId) };
				break;
			case "place-terminal": {
				const tab = withAvailablePlacementId(document, {
					kind: "terminal" as const,
					id: terminalLayoutId(layoutIntent.tabKey),
					name: layoutIntent.title,
					tabKey: layoutIntent.tabKey,
				});
				const requestedGroupId = currentRouting?.targetGroupId ?? layoutIntent.targetGroupId;
				const requestedGroup = requestedGroupId
					? findCenterGroup(document.center, requestedGroupId)
					: null;
				if (requestedGroupId) {
					const groupId =
						requestedGroup?.id ??
						findCenterGroup(document.center, attention.lastFocusedCenterGroupId)?.id ??
						primaryCenterGroupId(document);
					const moved = moveTabToGroup(document, tab, { area: "center", groupId });
					if (!isLayoutUnavailable(moved)) result = moved;
					break;
				}
				const target = document.right.groups.at(-1);
				if (target) {
					const moved = moveTabToGroup(document, tab, { area: "right", groupId: target.id });
					if (!isLayoutUnavailable(moved)) {
						const unfolded = setSideGroupFolded(moved.document, "right", target.id, false);
						result = isLayoutUnavailable(unfolded)
							? moved
							: { ...moved, document: unfolded.document };
					}
				} else {
					const moved = moveTabToGroup(document, tab, {
						area: "center",
						groupId: attention.lastFocusedCenterGroupId,
					});
					if (!isLayoutUnavailable(moved)) result = moved;
				}
				break;
			}
			case "close-terminal": {
				const tab = collectAllGroups(document)
					.flatMap((group) => group.tabs)
					.find(
						(candidate) =>
							candidate.kind === "terminal" && candidate.tabKey === layoutIntent.tabKey,
					);
				if (tab) result = closeLayoutTab(document, tab.id);
				break;
			}
			case "select-terminal": {
				const tab = collectAllGroups(document)
					.flatMap((group) => group.tabs)
					.find(
						(candidate) =>
							candidate.kind === "terminal" && candidate.tabKey === layoutIntent.tabKey,
					);
				if (!tab) break;
				const location = findTabLocation(document, tab.id);
				if (location) {
					changeAttention(selectTab(attention, location, tab.id));
					requestFocus({ key: layoutIntent.id, location, tabId: tab.id });
				}
				break;
			}
			case "toggle-side":
				if (document[layoutIntent.side].visible) {
					result = hideSide(document, layoutIntent.side, attention);
				} else {
					const shown = showSide(document, layoutIntent.side, maxSideGroups, attention);
					if (!isLayoutUnavailable(shown)) result = shown;
				}
				break;
		}
		if (!result) return;
		let nextAttention = reconcileAttention(result.document, attention, document);
		const activateResult =
			layoutIntent.kind === "open"
				? layoutIntent.activate !== false && currentRouting?.activate !== false
				: layoutIntent.kind === "place-terminal" && carriesRequestNavigation
					? currentRouting?.activate !== false
					: true;
		if (activateResult && result.focusGroupId) {
			const location = result.focusTabId
				? findTabLocation(result.document, result.focusTabId)
				: findCenterGroup(result.document.center, result.focusGroupId)
					? ({ area: "center", groupId: result.focusGroupId } as const)
					: null;
			if (location) {
				if (result.focusTabId) {
					nextAttention = selectTab(
						nextAttention,
						location,
						result.focusTabId,
						(layoutIntent.kind === "open" || layoutIntent.kind === "place-terminal") &&
							layoutIntent.countNavigation !== undefined
							? layoutIntent.countNavigation
							: shouldAdvanceAcceptedNavigation(attention, requestNavigation),
					);
				}
				requestFocus({
					key: layoutIntent.id,
					location,
					...(result.focusTabId ? { tabId: result.focusTabId } : {}),
				});
			}
		}
		changeAttention(nextAttention);
		if (result.document !== document) commit(result.document);
	}, [
		attention,
		changeAttention,
		commit,
		document,
		layoutIntent,
		maxSideGroups,
		requestFocus,
		workspaceId,
	]);
}
