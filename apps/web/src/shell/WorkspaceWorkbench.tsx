import type {
	LayoutCenterTab,
	LayoutDocumentTab,
	LayoutTab,
	LayoutToolId,
	WorkspaceLayoutDocument,
} from "@thinkrail/contracts";
import { GitBranch, MessageSquarePlus, SquareTerminal } from "lucide-react";
import {
	lazy,
	type ReactNode,
	Suspense,
	useCallback,
	useEffect,
	useMemo,
	useRef,
	useState,
} from "react";
import { messagesToRuntime } from "../chat/hydrate";
import { planToMarkdown } from "../chat/planMarkdown";
import { useChatTodos } from "../chat/useChatTodos";
import { ErrorBoundary } from "../components/ErrorBoundary";
import {
	type LayoutAttention,
	layoutResourceIdentity,
	readLayoutSelection,
	tupleKey,
} from "../lib";
import { ChangesPanel } from "../panels/ChangesPanel";
import { DiffPane } from "../panels/DiffPane";
import { FilePane } from "../panels/FilePane";
import { FileTree } from "../panels/FileTree";
import { ProjectTree } from "../panels/ProjectTree";
import { ReviewPanel, selectActiveReviewedPath } from "../panels/ReviewPanel";
import { reviewFlags } from "../panels/reviewModel";
import { SpecsPanel } from "../panels/SpecsPanel";
import {
	TerminalWorkbenchBody,
	useTerminalCatalog,
	useTerminalClose,
} from "../panels/TerminalWorkbench";
import { useWorkspaceReview } from "../panels/useWorkspaceReview";
import { useWorkspaceSpecs } from "../panels/useWorkspaceSpecs";
import {
	type CenterNavigationStamp,
	captureCenterNavigation,
	chatTabId,
	type EditorTab,
	isConnectedGeneration,
	isDefaultWorkspace,
	isExternalWorkspace,
	layoutOpenOptionsForNavigation,
	selectAttentionCenterResourceCacheKey,
	selectAttentionCenterTab,
	selectContextProject,
	selectDiffTabTargetRef,
	selectReviewDraftCount,
	selectWorkspaceById,
	selectWorkspaceSessionIds,
	selectWorkspaceTick,
	shouldAdvanceAcceptedNavigation,
	type TerminalTab,
	toast,
	useAppStore,
} from "../store";
import {
	createSessionWithSkillBaseline,
	errorText,
	getSessionMessagesWithSkillBaseline,
	getTransport,
} from "../transport";
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
	Workbench,
	withAvailablePlacementId,
} from "./layout";
import {
	commitWorkspaceLayout,
	hydrateWorkspaceLayout,
	installAttentionForDocument,
	isSupersededLayoutHydration,
	persistLayoutAttention,
} from "./layoutSync";
import { WorkspaceChatHistory } from "./WorkspaceChatHistory";

const ChatView = lazy(() => import("../chat/ChatView"));
const MarkdownPreview = lazy(() => import("../panels/MarkdownPreview"));

const sessionHydration = new Map<string, Promise<boolean>>();
const AUTO_OPEN_CHAT_LIMIT = 4;
const NO_EDITOR_TABS: EditorTab[] = [];
const NO_TERMINALS: TerminalTab[] = [];

function hydrateChatResource(workspaceId: string, sessionId: string): Promise<boolean> {
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

function toLayoutTab(tab: EditorTab): LayoutCenterTab | null {
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
	}
}

function terminalLayoutId(tabKey: string): string {
	return `terminal:${tabKey}`;
}

function sameAttention(first: LayoutAttention, second: LayoutAttention): boolean {
	return JSON.stringify(first) === JSON.stringify(second);
}

function currentChatDestination(
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

function TodoDocumentBody({ workspaceId, tab }: { workspaceId: string; tab: LayoutDocumentTab }) {
	const todos = useChatTodos(workspaceId, tab.sourceId);
	const title = tab.name.replace(/^TODO · /, "");
	const content = todos.data ? planToMarkdown(todos.data, title) : null;
	useEffect(() => {
		if (content === null) return;
		const state = useAppStore.getState();
		const currentDocument = state.layoutDocumentsByWorkspace[workspaceId];
		const placed = currentDocument ? findPlacedResource(currentDocument, tab) : undefined;
		if (placed?.kind !== "document") return;
		state.openTab(
			{
				kind: "doc",
				id: placed.id,
				workspaceId,
				name: placed.name,
				content,
				docPath: placed.docPath,
				sourceId: placed.sourceId,
			},
			"keep",
			false,
			{ activate: false },
		);
	}, [content, tab, workspaceId]);
	if (todos.failed) {
		return (
			<div className="flex h-full items-center justify-center px-lg text-center tr-text-ui text-feedback-error">
				The TODO plan could not be restored. Close and reopen this document to retry.
			</div>
		);
	}
	if (!todos.data) {
		return (
			<div className="flex h-full items-center justify-center text-text-muted">
				Loading TODO plan…
			</div>
		);
	}
	return <MarkdownPreview content={content ?? ""} workspaceId={workspaceId} path={tab.docPath} />;
}

function MissingResource({ label }: { label: string }) {
	return (
		<div className="flex h-full items-center justify-center px-lg text-center tr-text-ui text-text-muted">
			Restoring {label}…
		</div>
	);
}

function syncLegacySelectedResource(
	workspaceId: string,
	tab: LayoutCenterTab | null,
	cacheKey: string | null,
): void {
	const state = useAppStore.getState();
	if (!tab) {
		state.syncLegacySelection(workspaceId, null);
		return;
	}
	if (tab.kind === "terminal") {
		state.syncLegacySelection(
			workspaceId,
			cacheKey === tab.tabKey ? { kind: "terminal", tabKey: tab.tabKey } : null,
		);
		return;
	}
	const cache = cacheKey
		? state.tabsByWorkspace[workspaceId]?.find((candidate) => candidate.id === cacheKey)
		: undefined;
	state.syncLegacySelection(workspaceId, cache ? { kind: "editor", tabId: cache.id } : null);
}

export function WorkspaceWorkbench({ workspaceId }: { workspaceId: string }) {
	const status = useAppStore((state) => state.status);
	const connectionGeneration = useAppStore((state) => state.connectionGeneration);
	const document = useAppStore((state) => state.layoutDocumentsByWorkspace[workspaceId]);
	const layoutReady = document !== undefined;
	const attention = useAppStore((state) => state.layoutAttentionByWorkspace[workspaceId]);
	const selectedCenterTab = useAppStore((state) => selectAttentionCenterTab(state, workspaceId));
	const remoteEpoch = useAppStore((state) => state.layoutRemoteEpochByWorkspace[workspaceId] ?? 0);
	const pendingLayoutWrites = useAppStore(
		(state) => state.layoutPendingByWorkspace[workspaceId]?.length ?? 0,
	);
	const layoutSettings = useAppStore((state) => state.layoutSettings);
	const workspace = useAppStore((state) => selectWorkspaceById(state, workspaceId));
	const contextProject = useAppStore(selectContextProject);
	const layoutIntent = useAppStore(
		(state) => state.layoutIntents.find((intent) => intent.workspaceId === workspaceId) ?? null,
	);
	const editorTabs = useAppStore((state) => state.tabsByWorkspace[workspaceId] ?? NO_EDITOR_TABS);
	const terminals = useAppStore((state) => state.terminalsByWorkspace[workspaceId] ?? NO_TERMINALS);
	const selectedCenterResourceCacheKey = useAppStore((state) =>
		selectAttentionCenterResourceCacheKey(state, workspaceId),
	);
	const sessions = useAppStore((state) => state.sessions);
	const deletedSessions = useAppStore((state) => state.deletedSessionsByWorkspace[workspaceId]);
	const chatLocationRequest = useAppStore((state) => state.chatLocationRequest);
	const terminalCatalogReady = useTerminalCatalog(workspaceId);
	const terminalClose = useTerminalClose();
	const specs = useWorkspaceSpecs(workspaceId);
	const review = useWorkspaceReview(workspaceId);
	const reviewComments = useAppStore((state) => state.reviewsByWorkspace[workspaceId]?.comments);
	const reviewDraftCount = useAppStore((state) => selectReviewDraftCount(state, workspaceId));
	const reviewFlagByPath = useMemo(() => reviewFlags(reviewComments), [reviewComments]);
	const [focusRequest, setFocusRequest] = useState<LayoutTabFocusRequest | null>(null);
	const previousDocument = useRef<WorkspaceLayoutDocument | undefined>(undefined);
	const tombstonePruneAttempts = useRef(new WeakSet<WorkspaceLayoutDocument>());
	const tombstonePruneGeneration = useRef(connectionGeneration);
	const previousReviewedSelection = useRef<string | null>(null);
	const chatLocationFlight = useRef<{
		request: object;
		navigation: CenterNavigationStamp | null;
	} | null>(null);
	const reconciledTerminalCatalog = useRef<{
		workspaceId: string;
		connectionGeneration: number;
		terminals: readonly TerminalTab[];
	} | null>(null);
	const activeLegacyTabId = useAppStore((state) => state.activeTabByWorkspace[workspaceId] ?? null);
	const activeReviewedPath = useAppStore((state) => selectActiveReviewedPath(state, workspaceId));

	useEffect(() => {
		if (status !== "connected" || connectionGeneration === 0) return;
		void hydrateWorkspaceLayout(workspaceId).catch((error) => {
			const state = useAppStore.getState();
			if (
				!isSupersededLayoutHydration(error) &&
				isConnectedGeneration(state, connectionGeneration) &&
				!state.removedWorkspaceIds[workspaceId]
			) {
				toast.error(errorText(error), "Couldn't load the workspace layout");
			}
		});
	}, [connectionGeneration, status, workspaceId]);

	useEffect(() => {
		const reviewedSelection =
			activeLegacyTabId && activeReviewedPath
				? JSON.stringify([activeLegacyTabId, activeReviewedPath])
				: null;
		const previous = previousReviewedSelection.current;
		previousReviewedSelection.current = reviewedSelection;
		if (!reviewedSelection || reviewedSelection === previous) return;
		const state = useAppStore.getState();
		const currentActiveTabId = state.activeTabByWorkspace[workspaceId];
		const currentReviewedPath = selectActiveReviewedPath(state, workspaceId);
		const currentReviewedSelection =
			currentActiveTabId && currentReviewedPath
				? JSON.stringify([currentActiveTabId, currentReviewedPath])
				: null;
		if (currentReviewedSelection !== reviewedSelection) return;
		state.enqueueLayoutIntent({
			kind: "reveal-tool",
			workspaceId,
			tool: "review",
		});
	}, [activeLegacyTabId, activeReviewedPath, workspaceId]);

	useEffect(() => {
		if (!document) return;
		if (!previousDocument.current) {
			previousDocument.current = document;
			installAttentionForDocument(workspaceId, document);
			return;
		}
		const state = useAppStore.getState();
		const next = reconcileAttention(
			document,
			state.layoutAttentionByWorkspace[workspaceId],
			previousDocument.current,
		);
		previousDocument.current = document;
		if (
			!state.layoutAttentionByWorkspace[workspaceId] ||
			!sameAttention(next, state.layoutAttentionByWorkspace[workspaceId])
		) {
			state.setLayoutAttention(workspaceId, next);
			persistLayoutAttention(workspaceId, next);
		}
	}, [document, workspaceId]);

	useEffect(() => {
		if (!document || pendingLayoutWrites > 0) return;
		const state = useAppStore.getState();
		if (
			state.layoutDocumentsByWorkspace[workspaceId] !== document ||
			(state.layoutPendingByWorkspace[workspaceId]?.length ?? 0) > 0
		) {
			return;
		}
		const placed = new Set(
			collectAllGroups(document)
				.flatMap((group) => group.tabs)
				.map(layoutResourceIdentity),
		);
		const opening = new Set(
			state.layoutIntents.flatMap((intent) => {
				if (intent.workspaceId !== workspaceId || intent.kind !== "open") return [];
				const resource = toLayoutTab(intent.tab);
				return resource ? [layoutResourceIdentity(resource)] : [];
			}),
		);
		for (const tab of editorTabs) {
			const resource = toLayoutTab(tab);
			const identity = resource ? layoutResourceIdentity(resource) : null;
			if (identity && (placed.has(identity) || opening.has(identity))) continue;
			const latest = useAppStore.getState();
			if (
				latest.layoutDocumentsByWorkspace[workspaceId] !== document ||
				(latest.layoutPendingByWorkspace[workspaceId]?.length ?? 0) > 0
			) {
				return;
			}
			const current = (latest.tabsByWorkspace[workspaceId] ?? []).find(
				(candidate) => candidate.id === tab.id,
			);
			const currentResource = current ? toLayoutTab(current) : null;
			if (
				!current ||
				!identity ||
				!currentResource ||
				layoutResourceIdentity(currentResource) !== identity
			) {
				continue;
			}
			if (current.kind === "chat") {
				latest.closeChatToHistory(current.sessionId, false, workspaceId, false);
			} else {
				latest.closeTab(current.id, false, false, workspaceId);
			}
		}
	}, [document, editorTabs, pendingLayoutWrites, workspaceId]);

	const changeAttention = useCallback(
		(next: LayoutAttention) => {
			const state = useAppStore.getState();
			if (state.removedWorkspaceIds[workspaceId]) return;
			state.setLayoutAttention(workspaceId, next);
			persistLayoutAttention(workspaceId, next);
			const current = useAppStore.getState();
			syncLegacySelectedResource(
				workspaceId,
				selectAttentionCenterTab(current, workspaceId),
				selectAttentionCenterResourceCacheKey(current, workspaceId),
			);
		},
		[workspaceId],
	);

	useEffect(() => {
		syncLegacySelectedResource(workspaceId, selectedCenterTab, selectedCenterResourceCacheKey);
	}, [selectedCenterResourceCacheKey, selectedCenterTab, workspaceId]);

	useEffect(() => {
		if (attention && !useAppStore.getState().removedWorkspaceIds[workspaceId]) {
			persistLayoutAttention(workspaceId, attention);
		}
	}, [attention, workspaceId]);

	const commit = useCallback(
		(next: WorkspaceLayoutDocument) => {
			void commitWorkspaceLayout(workspaceId, next).catch(() => {});
		},
		[workspaceId],
	);

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
					setFocusRequest({ key: layoutIntent.id, location, tabId: selectedTabId });
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
				const revealed = revealTool(document, layoutIntent.tool, layoutSettings.maxSideGroups);
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
					setFocusRequest({ key: layoutIntent.id, location, tabId: tab.id });
				}
				break;
			}
			case "toggle-side":
				if (document[layoutIntent.side].visible) {
					result = hideSide(document, layoutIntent.side, attention);
				} else {
					const shown = showSide(
						document,
						layoutIntent.side,
						layoutSettings.maxSideGroups,
						attention,
					);
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
				setFocusRequest({
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
		layoutSettings.maxSideGroups,
		workspaceId,
	]);

	useEffect(() => {
		if (!layoutReady || status !== "connected" || connectionGeneration === 0) return;
		const stateAtRequest = useAppStore.getState();
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
				isConnectedGeneration(state, connectionGeneration) &&
				!state.removedWorkspaceIds[workspaceId]
			);
		};
		const fetchMessages = (sessionId: string) =>
			getSessionMessagesWithSkillBaseline({ sessionId, workspaceId }).catch(() => null);
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
				let sawKnown = false;
				const toOpen: typeof summaries = [];
				const toHistory: typeof summaries = [];
				for (const summary of [...summaries].sort((a, b) => b.updatedAt - a.updatedAt)) {
					if (placed.has(summary.sessionId)) continue;
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
				if (placed.size === 0 && toOpen.length === 0 && !sawKnown) {
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
					const activate = openedCount === 0;
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
			.catch(() => {});
		return () => {
			current = false;
		};
	}, [commit, connectionGeneration, layoutReady, status, workspaceId]);

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
				if (currentPlacement?.kind !== "chat") continue;
				state.restorePlacedChatCache(
					workspaceId,
					currentPlacement.id,
					currentPlacement.sessionId,
					currentPlacement.name,
				);
				if (state.sessions[currentPlacement.sessionId]) continue;
				try {
					await hydrateChatResource(workspaceId, currentPlacement.sessionId);
				} catch {
					// Reconnect or a later placement change retries this rehydratable reference.
				}
			}
		})();
		return () => {
			current = false;
		};
	}, [document, status, workspaceId]);

	// A new authoritative catalog is the only deletion proof: a remote placement can arrive before that
	// terminal's attach/list update. On the same pass, restore confirmed domain tabs that predate layout
	// persistence (upgrade/recovery) or outlive a rejected layout write. New attach-pending tabs keep using
	// their explicit placement intents, which deliberately reveal and mount them.
	useEffect(() => {
		if (
			!document ||
			!terminalCatalogReady ||
			layoutIntent ||
			pendingLayoutWrites > 0 ||
			status !== "connected"
		) {
			return;
		}
		if (useAppStore.getState().layoutDocumentsByWorkspace[workspaceId] !== document) return;
		const reconciled = reconciledTerminalCatalog.current;
		const catalogAdvanced =
			reconciled?.workspaceId !== workspaceId ||
			reconciled.connectionGeneration !== connectionGeneration ||
			reconciled.terminals !== terminals;
		let next = document;
		const attemptedCatalog = catalogAdvanced
			? { workspaceId, connectionGeneration, terminals }
			: null;
		if (attemptedCatalog) {
			const known = new Set(terminals.map((tab) => tab.tabKey));
			const dangling = collectAllGroups(next)
				.flatMap((group) => group.tabs)
				.filter((tab) => tab.kind === "terminal" && !known.has(tab.tabKey));
			next = dangling.reduce((current, tab) => closeLayoutTab(current, tab.id).document, next);
		}

		const placedTabs = collectAllGroups(next)
			.flatMap((group) => group.tabs)
			.filter((tab) => tab.kind === "terminal");
		for (const terminal of terminals) {
			const placed = placedTabs.find((tab) => tab.tabKey === terminal.tabKey);
			if (!placed || placed.name === terminal.title) continue;
			const refreshed = openCenterTab(
				next,
				{ ...placed, name: terminal.title },
				primaryCenterGroupId(next),
				"preview",
			);
			if (!isLayoutUnavailable(refreshed)) next = refreshed.document;
		}
		const placed = new Set(placedTabs.map((tab) => tab.tabKey));
		const missing = terminals.filter((tab) => !tab.attachPending && !placed.has(tab.tabKey));
		for (const terminal of missing) {
			const tab = withAvailablePlacementId(next, {
				kind: "terminal" as const,
				id: terminalLayoutId(terminal.tabKey),
				name: terminal.title,
				tabKey: terminal.tabKey,
			});
			const target = next.right.groups.at(-1);
			if (target) {
				const visible = next.right.visible;
				const moved = moveTabToGroup(next, tab, { area: "right", groupId: target.id });
				if (!isLayoutUnavailable(moved)) {
					next = {
						...moved.document,
						right: { ...moved.document.right, visible },
					};
				}
			} else {
				const moved = moveTabToGroup(next, tab, {
					area: "center",
					groupId: primaryCenterGroupId(next),
				});
				if (!isLayoutUnavailable(moved)) next = moved.document;
			}
		}
		if (next !== document) {
			commit(next);
			return;
		}
		// A catalog is reconciled only once its resulting projection is settled. Marking it before the
		// optimistic write could strand dangling placements forever if that write rolled back.
		if (attemptedCatalog) reconciledTerminalCatalog.current = attemptedCatalog;
	}, [
		commit,
		connectionGeneration,
		document,
		layoutIntent,
		pendingLayoutWrites,
		status,
		terminalCatalogReady,
		terminals,
		workspaceId,
	]);

	useEffect(() => {
		if (
			!chatLocationRequest ||
			chatLocationRequest.workspaceId !== workspaceId ||
			!document ||
			pendingLayoutWrites > 0
		) {
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
	}, [
		changeAttention,
		chatLocationRequest,
		connectionGeneration,
		document,
		pendingLayoutWrites,
		status,
		workspaceId,
	]);

	useEffect(() => {
		if (!document || status !== "connected") return;
		if (useAppStore.getState().layoutDocumentsByWorkspace[workspaceId] !== document) return;
		let current = true;
		const cache = useAppStore.getState().tabsByWorkspace[workspaceId] ?? [];
		const cachedResources = new Set(
			cache.flatMap((item) => {
				const resource = toLayoutTab(item);
				return resource && (resource.kind === "file" || resource.kind === "diff")
					? [layoutResourceIdentity(resource)]
					: [];
			}),
		);
		for (const tab of collectAllGroups(document).flatMap((group) => group.tabs)) {
			if (tab.kind !== "file" && tab.kind !== "diff") continue;
			const identity = layoutResourceIdentity(tab);
			if (cachedResources.has(identity)) continue;
			const cacheArrived = () =>
				(useAppStore.getState().tabsByWorkspace[workspaceId] ?? []).some((item) => {
					const resource = toLayoutTab(item);
					return resource !== null && layoutResourceIdentity(resource) === identity;
				});
			const currentPlacement = () => {
				const latest = useAppStore.getState().layoutDocumentsByWorkspace[workspaceId];
				return latest ? findPlacedResource(latest, tab) : null;
			};
			const loadedTick = selectWorkspaceTick(useAppStore.getState(), workspaceId);
			if (tab.kind === "file") {
				void getTransport()
					.request("fs.readFile", { workspaceId, path: tab.path })
					.then(({ content }) => {
						const latest = useAppStore.getState();
						if (!current || !isConnectedGeneration(latest, connectionGeneration)) return;
						const placed = currentPlacement();
						if (placed?.kind !== "file" || cacheArrived()) return;
						useAppStore.getState().openTab(
							{
								kind: "file",
								id: placed.id,
								workspaceId,
								path: placed.path,
								name: placed.name,
								content,
								loadedTick,
							},
							"keep",
							false,
							{ activate: false },
						);
					})
					.catch(() => {});
			} else {
				const loadedTarget = selectDiffTabTargetRef(useAppStore.getState(), {
					workspaceId,
					scope: tab.scope,
				});
				void getTransport()
					.request("git.diffFile", { workspaceId, path: tab.path, scope: tab.scope })
					.then(({ original, modified }) => {
						const latest = useAppStore.getState();
						if (!current || !isConnectedGeneration(latest, connectionGeneration)) return;
						const placed = currentPlacement();
						if (placed?.kind !== "diff" || cacheArrived()) return;
						useAppStore.getState().openTab(
							{
								kind: "diff",
								id: placed.id,
								workspaceId,
								path: placed.path,
								scope: placed.scope,
								name: placed.name,
								original,
								modified,
								loadedTick,
								loadedTarget,
							},
							"keep",
							false,
							{ activate: false },
						);
					})
					.catch(() => {});
			}
		}
		return () => {
			current = false;
		};
	}, [connectionGeneration, document, status, workspaceId]);

	const editorById = useMemo(() => new Map(editorTabs.map((tab) => [tab.id, tab])), [editorTabs]);
	const editorByResource = useMemo(() => {
		const resources = new Map<
			string,
			Extract<EditorTab, { kind: "file" }> | Extract<EditorTab, { kind: "diff" }>
		>();
		for (const tab of editorTabs) {
			if (tab.kind !== "file" && tab.kind !== "diff") continue;
			const identity = layoutResourceIdentity(tab);
			if (!resources.has(identity)) resources.set(identity, tab);
		}
		return resources;
	}, [editorTabs]);
	const terminalByKey = useMemo(
		() => new Map(terminals.map((tab) => [tab.tabKey, tab])),
		[terminals],
	);

	const renderTabBody = useCallback(
		(tab: LayoutCenterTab | Extract<LayoutTab, { kind: "terminal" }>) => {
			if (tab.kind === "chat") {
				return sessions[tab.sessionId] ? (
					<ErrorBoundary label="chat" resetKeys={[workspaceId, tab.id]}>
						<Suspense fallback={<MissingResource label="chat" />}>
							<ChatView sessionId={tab.sessionId} workspaceId={workspaceId} />
						</Suspense>
					</ErrorBoundary>
				) : (
					<div className="flex h-full flex-col items-center justify-center gap-sm text-text-muted">
						<MissingResource label="chat" />
						<button
							type="button"
							onClick={() => {
								void hydrateChatResource(workspaceId, tab.sessionId)
									.then((installed) => {
										if (installed) return;
										const { state, current } = currentChatDestination(workspaceId, tab, undefined);
										if (
											current &&
											!state.removedWorkspaceIds[workspaceId] &&
											!state.deletedSessionsByWorkspace[workspaceId]?.[tab.sessionId]
										) {
											toast.error("The chat could not be restored.", "Couldn't restore the chat");
										}
									})
									.catch((error) => {
										const { state, current } = currentChatDestination(workspaceId, tab, undefined);
										if (
											current &&
											!state.removedWorkspaceIds[workspaceId] &&
											!state.deletedSessionsByWorkspace[workspaceId]?.[tab.sessionId]
										) {
											toast.error(errorText(error), "Couldn't restore the chat");
										}
									});
							}}
							className="rounded-[var(--radius-sm)] border border-border-default px-sm py-xs tr-text-ui hover:bg-control-bg-hovered"
						>
							Retry
						</button>
					</div>
				);
			}
			if (tab.kind === "document") {
				if (deletedSessions?.[tab.sourceId]) return <MissingResource label="document" />;
				return (
					<ErrorBoundary label="document" resetKeys={[workspaceId, tab.id]}>
						<Suspense fallback={<MissingResource label="document" />}>
							<TodoDocumentBody workspaceId={workspaceId} tab={tab} />
						</Suspense>
					</ErrorBoundary>
				);
			}
			if (tab.kind === "terminal") {
				const terminal = terminalByKey.get(tab.tabKey);
				const location = document ? findTabLocation(document, tab.id) : null;
				return (
					<ErrorBoundary label="terminal" resetKeys={[workspaceId, tab.id]}>
						{terminal ? (
							<TerminalWorkbenchBody
								tab={terminal}
								onAdd={() =>
									useAppStore
										.getState()
										.addTerminal(
											workspaceId,
											undefined,
											location?.area === "center" ? location.groupId : undefined,
										)
								}
							/>
						) : (
							<MissingResource label="terminal" />
						)}
					</ErrorBoundary>
				);
			}
			const identity = layoutResourceIdentity(tab);
			const exact = editorById.get(tab.id);
			const editor =
				exact &&
				(exact.kind === "file" || exact.kind === "diff") &&
				layoutResourceIdentity(exact) === identity
					? exact
					: editorByResource.get(identity);
			if (!editor) return <MissingResource label={tab.kind === "file" ? "file" : "diff"} />;
			return (
				<ErrorBoundary label="editor" resetKeys={[workspaceId, tab.id]}>
					<Suspense fallback={<MissingResource label="editor" />}>
						{editor.kind === "file" ? (
							<FilePane tab={editor} />
						) : editor.kind === "diff" ? (
							<DiffPane tab={editor} />
						) : null}
					</Suspense>
				</ErrorBoundary>
			);
		},
		[deletedSessions, document, editorById, editorByResource, sessions, terminalByKey, workspaceId],
	);

	const renderToolBody = useCallback(
		(tool: LayoutToolId) => {
			let body: ReactNode;
			switch (tool) {
				case "projects":
					body = (
						<div data-testid="left-nav" className="h-full overflow-auto p-md">
							<ProjectTree />
						</div>
					);
					break;
				case "specs":
					body = (
						<div className="p-xs">
							<SpecsPanel
								workspaceId={workspaceId}
								failed={specs.failed}
								onRefresh={specs.reload}
							/>
						</div>
					);
					break;
				case "files":
					body = (
						<div className="p-xs">
							<FileTree key={workspaceId} workspaceId={workspaceId} />
						</div>
					);
					break;
				case "changes":
					body = <ChangesPanel workspaceId={workspaceId} />;
					break;
				case "review":
					body = <ReviewPanel workspaceId={workspaceId} failed={review.failed} />;
					break;
			}
			return (
				<ErrorBoundary label={`${tool} tool`} resetKeys={[workspaceId, tool]}>
					{body}
				</ErrorBoundary>
			);
		},
		[review.failed, specs.failed, specs.reload, workspaceId],
	);

	const isDefault = workspace != null && isDefaultWorkspace(workspace);
	const isExternal = workspace != null && isExternalWorkspace(workspace);

	const startChat = useCallback(
		(groupId: string) => {
			const currentAttention = useAppStore.getState().layoutAttentionByWorkspace[workspaceId];
			if (!currentAttention) return;
			changeAttention({ ...currentAttention, lastFocusedCenterGroupId: groupId });
			const navigation = useAppStore.getState().beginCenterNavigation(workspaceId, groupId);
			void createSessionWithSkillBaseline({ workspaceId })
				.then(({ result: { sessionId, model, thinkingLevel }, syncedTick }) => {
					const store = useAppStore.getState();
					store.openChatSession(
						workspaceId,
						sessionId,
						model,
						thinkingLevel,
						syncedTick,
						layoutOpenOptionsForNavigation(store, workspaceId, navigation),
					);
				})
				.catch(() => {
					const state = useAppStore.getState();
					if (
						layoutOpenOptionsForNavigation(state, workspaceId, navigation).activate !== false &&
						!state.removedWorkspaceIds[workspaceId]
					) {
						toast.error("The agent session could not be created.", "Couldn't start the chat");
					}
				});
		},
		[changeAttention, workspaceId],
	);

	if (!document || !attention) {
		return (
			<div className="flex h-full items-center justify-center bg-container-content-bg tr-text-ui text-text-muted">
				Restoring workspace layout…
			</div>
		);
	}

	return (
		<>
			<Workbench
				document={document}
				attention={attention}
				maxSideGroups={layoutSettings.maxSideGroups}
				remoteEpoch={remoteEpoch}
				{...(focusRequest ? { focusRequest } : {})}
				renderTabBody={renderTabBody}
				renderTabAdornment={(tab) => {
					if (tab.kind === "tool" && tab.tool === "review" && reviewDraftCount > 0) {
						return (
							<span
								data-testid="review-pending-badge"
								className="inline-flex min-w-4 items-center justify-center rounded-full bg-primary px-0.5 tr-text-label-pill text-text-on-primary"
							>
								{reviewDraftCount}
							</span>
						);
					}
					if (tab.kind !== "file" && tab.kind !== "diff") return null;
					const flag = reviewFlagByPath.get(tab.path);
					return flag ? (
						<span
							data-testid="review-tab-flag"
							data-flag={flag}
							className={
								flag === "draft"
									? "shrink-0 tr-text-eyebrow text-primary"
									: "shrink-0 tr-text-eyebrow text-text-subtle"
							}
						>
							Review
						</span>
					) : null;
				}}
				renderToolBody={renderToolBody}
				renderEmptyCenter={(groupId) => (
					<div
						data-testid="workspace-ready"
						className="flex h-full flex-col items-center justify-center gap-xs px-lg text-center"
					>
						<span className="tr-text-eyebrow text-text-muted">
							{isDefault
								? "Default workspace"
								: isExternal
									? "Existing worktree"
									: "Workspace ready"}
						</span>
						{workspace ? (
							<>
								<h2 className="max-w-full truncate tr-title-entity text-text-default">
									{isDefault ? (contextProject?.name ?? workspace.name) : workspace.name}
								</h2>
								<p className="flex max-w-full items-center gap-xs tr-text-metadata text-text-muted">
									<GitBranch className="size-3.5 shrink-0" />
									{isDefault || isExternal ? (
										<span className="truncate">on {workspace.branch}</span>
									) : (
										<>
											<span className="truncate">{workspace.branch}</span>
											<span className="shrink-0 text-text-muted">
												· from {workspace.baseBranch}
											</span>
										</>
									)}
								</p>
							</>
						) : null}
						<p className="mt-xs tr-text-ui text-text-muted">
							{isDefault
								? "Chats, changes, and terminals run directly in your project folder."
								: "Files, chats, changes, and terminals are scoped to this workspace."}
						</p>
						<button
							type="button"
							data-testid="start-chat"
							onClick={() => startChat(groupId)}
							className="mt-xs flex items-center gap-xs rounded-[var(--radius-md)] border border-border-default bg-container-elevated-bg px-md py-xs tr-text-ui text-text-default hover:bg-control-bg-hovered"
						>
							<MessageSquarePlus className="size-4" /> New chat
						</button>
					</div>
				)}
				renderCenterActions={(groupId) => (
					<>
						<WorkspaceChatHistory workspaceId={workspaceId} targetGroupId={groupId} />
						<button
							type="button"
							data-testid="new-terminal"
							aria-label="New terminal in this group"
							title="New terminal in this group"
							onClick={() => useAppStore.getState().addTerminal(workspaceId, undefined, groupId)}
							className="flex w-7 shrink-0 items-center justify-center border-border-default border-l text-text-muted hover:bg-control-bg-hovered hover:text-text-default"
						>
							<SquareTerminal className="size-4" />
						</button>
					</>
				)}
				onCommit={commit}
				onAttentionChange={changeAttention}
				onUserNavigation={() => useAppStore.getState().noteNavigation(workspaceId)}
				onRequestClose={(tab, prepare) => {
					if (tab.kind === "terminal") {
						const close = () => {
							const state = useAppStore.getState();
							if (state.removedWorkspaceIds[workspaceId]) return;
							const latest = state.layoutDocumentsByWorkspace[workspaceId];
							const prepared = prepare(latest);
							if (!latest || prepared.document !== latest) commit(prepared.document);
							// The host terminal close is already authoritative; layout reconciliation may retry its
							// structural removal, but this accepted user close owns attention exactly once now.
							prepared.onAccepted(useAppStore.getState().layoutDocumentsByWorkspace[workspaceId]);
						};
						const terminal = terminalByKey.get(tab.tabKey);
						if (terminal) terminalClose.requestClose(terminal, close);
						else close();
						return;
					}
					const prepared = prepare();
					const closedIdentity = layoutResourceIdentity(tab);
					void commitWorkspaceLayout(workspaceId, prepared.document)
						.then(() => {
							const state = useAppStore.getState();
							const current = state.layoutDocumentsByWorkspace[workspaceId];
							if (
								current &&
								collectAllGroups(current)
									.flatMap((group) => group.tabs)
									.some((candidate) => layoutResourceIdentity(candidate) === closedIdentity)
							) {
								return;
							}
							prepared.onAccepted(current);
							if (tab.kind === "chat") {
								state.closeChatToHistory(tab.sessionId, false, workspaceId, false);
							} else if (tab.kind === "file" || tab.kind === "diff" || tab.kind === "document") {
								for (const cache of state.tabsByWorkspace[workspaceId] ?? []) {
									const resource = toLayoutTab(cache);
									if (resource && layoutResourceIdentity(resource) === closedIdentity) {
										state.closeTab(cache.id, false, false, workspaceId);
									}
								}
							}
						})
						.catch(() => {});
				}}
				onNewChat={startChat}
				onRemoteGestureCanceled={() =>
					toast.info("The shared layout changed. Your drag was canceled.")
				}
			/>
			{terminalClose.confirmation}
		</>
	);
}
