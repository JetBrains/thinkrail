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
	createAuxiliaryGroup,
	findAuxiliaryGroup,
	findCenterGroup,
	findLayoutTab,
	findPlacedResource,
	findTabLocation,
	hideBottom,
	hideSide,
	isLayoutUnavailable,
	keepPreview,
	type LayoutCenterTab,
	type LayoutGroupLocation,
	type LayoutOperationResult,
	type LayoutTabFocusRequest,
	type LayoutTerminalTab,
	moveTabToGroup,
	openCenterTab,
	primaryCenterGroupId,
	reconcileAttention,
	removeSessionLayoutTabs,
	revealTool,
	selectTab,
	setAuxiliaryGroupFolded,
	showBottom,
	showSide,
	type WorkspaceLayoutDocument,
	withAvailablePlacementId,
} from "../layout";
import { terminalLayoutId } from "../terminalReconciliation";

function preservePassiveAuxiliaryPlacement(
	original: WorkspaceLayoutDocument,
	moved: { document: WorkspaceLayoutDocument },
	location: Exclude<LayoutGroupLocation, { area: "center" }>,
): LayoutOperationResult {
	const previousGroup = findAuxiliaryGroup(original, location.area, location.groupId);
	return {
		document: {
			...moved.document,
			[location.area]: {
				...moved.document[location.area],
				visible: original[location.area].visible,
				groups: moved.document[location.area].groups.map((group) =>
					group.id === previousGroup?.id ? { ...group, folded: previousGroup.folded } : group,
				),
			},
		},
	};
}

export function placeTerminalForIntent(
	document: WorkspaceLayoutDocument,
	attention: LayoutAttention,
	tab: LayoutTerminalTab,
	target: LayoutGroupLocation | undefined,
	limits: { maxSideGroups: number; maxBottomGroups: number },
	reveal = true,
): LayoutOperationResult {
	if (target?.area === "center") {
		const groupId =
			findCenterGroup(document.center, target.groupId)?.id ??
			findCenterGroup(document.center, attention.lastFocusedCenterGroupId)?.id ??
			primaryCenterGroupId(document);
		const moved = moveTabToGroup(document, tab, { area: "center", groupId });
		return !reveal && !isLayoutUnavailable(moved) ? { document: moved.document } : moved;
	}
	if (target) {
		const targetGroup = findAuxiliaryGroup(document, target.area, target.groupId);
		if (targetGroup) {
			const moved = moveTabToGroup(document, tab, target);
			if (isLayoutUnavailable(moved)) return moved;
			if (!reveal) return preservePassiveAuxiliaryPlacement(document, moved, target);
			const unfolded = setAuxiliaryGroupFolded(moved.document, target.area, target.groupId, false);
			if (isLayoutUnavailable(unfolded)) return moved;
			return {
				...moved,
				document: {
					...unfolded.document,
					[target.area]: { ...unfolded.document[target.area], visible: true },
				},
			};
		}
	}
	const preferredId = attention.lastFocusedSideGroupId.bottom;
	const bottomGroup =
		document.bottom.groups.find((group) => group.id === preferredId) ??
		document.bottom.groups.at(-1);
	if (bottomGroup) {
		const moved = moveTabToGroup(document, tab, {
			area: "bottom",
			groupId: bottomGroup.id,
		});
		if (isLayoutUnavailable(moved)) return moved;
		if (!reveal) {
			return preservePassiveAuxiliaryPlacement(document, moved, {
				area: "bottom",
				groupId: bottomGroup.id,
			});
		}
		return {
			...moved,
			document: {
				...moved.document,
				bottom: {
					...moved.document.bottom,
					visible: true,
					groups: moved.document.bottom.groups.map((group) =>
						group.id === bottomGroup.id ? { ...group, folded: false } : group,
					),
				},
			},
		};
	}
	const created = createAuxiliaryGroup(document, "bottom", tab, 0, limits.maxBottomGroups);
	if (reveal || isLayoutUnavailable(created)) return created;
	return {
		document: {
			...created.document,
			bottom: { ...created.document.bottom, visible: document.bottom.visible },
		},
	};
}

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
	const maxSideGroups = useAppStore((state) => state.localLayoutPreferences.maxSideGroups);
	const maxBottomGroups = useAppStore((state) => state.localLayoutPreferences.maxBottomGroups);
	const terminalReservationPending = useAppStore((state) => {
		if (layoutIntent?.kind !== "place-terminal") return false;
		return (
			state.terminalsByWorkspace[workspaceId]?.some(
				(tab) => tab.tabKey === layoutIntent.tabKey && tab.reservationPending,
			) ?? false
		);
	});

	useEffect(() => {
		if (!layoutIntent || !document || !attention) return;
		const currentState = useAppStore.getState();
		if (
			currentState.layoutDocumentsByWorkspace[workspaceId] !== document ||
			currentState.layoutAttentionByWorkspace[workspaceId] !== attention
		) {
			return;
		}
		if (layoutIntent.kind === "place-terminal" && terminalReservationPending) return;
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
		let terminalTargetAfterCommit: string | undefined;
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
				const revealed = revealTool(document, layoutIntent.tool, maxSideGroups, maxBottomGroups);
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
				const routedCenterGroupId = currentRouting?.targetGroupId;
				const requestedGroupId = routedCenterGroupId ?? layoutIntent.targetGroupId;
				const requestedArea = routedCenterGroupId
					? "center"
					: (layoutIntent.targetArea ?? "center");
				const target = requestedGroupId
					? { area: requestedArea, groupId: requestedGroupId }
					: undefined;
				const placed = placeTerminalForIntent(
					document,
					attention,
					tab,
					target,
					{
						maxSideGroups,
						maxBottomGroups,
					},
					layoutIntent.reveal !== false,
				);
				if (!isLayoutUnavailable(placed)) result = placed;
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
			case "toggle-bottom":
				if (document.bottom.visible) {
					result = hideBottom(document, attention);
				} else {
					const shown = showBottom(document, maxSideGroups, maxBottomGroups, attention);
					if (!isLayoutUnavailable(shown)) {
						result = shown;
						if (shown.document.bottom.groups.every((group) => group.tabs.length === 0)) {
							terminalTargetAfterCommit = shown.focusGroupId ?? shown.document.bottom.groups[0]?.id;
						}
					}
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
			const focusGroupId = result.focusGroupId;
			const location = result.focusTabId
				? findTabLocation(result.document, result.focusTabId)
				: findCenterGroup(result.document.center, focusGroupId)
					? ({ area: "center", groupId: focusGroupId } as const)
					: ((["left", "right", "bottom"] as const)
							.map((area) =>
								findAuxiliaryGroup(result.document, area, focusGroupId)
									? ({ area, groupId: focusGroupId } as const)
									: null,
							)
							.find((candidate) => candidate !== null) ?? null);
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
		if (terminalTargetAfterCommit) {
			useAppStore
				.getState()
				.addTerminal(workspaceId, undefined, terminalTargetAfterCommit, "bottom");
		}
	}, [
		attention,
		changeAttention,
		commit,
		document,
		layoutIntent,
		maxBottomGroups,
		maxSideGroups,
		requestFocus,
		terminalReservationPending,
		workspaceId,
	]);
}
