import { RiArrowDownLine as ArrowDown, RiArrowUpLine as ArrowUp } from "@remixicon/react";
import type { AskUserQuestionResult, GitDiffScope, TurnChangeSet } from "@thinkrail/contracts";
import type { MessageKey } from "@thinkrail/locales";
import { t as translate, useT } from "@thinkrail/locales/react";
import { ResourceScopeProvider } from "@thinkrail/resource-renderers";
import { Button } from "@thinkrail/ui/button";
import { useModalLayerOpen } from "@thinkrail/ui/dialog";
import { cn } from "@thinkrail/ui/utils";
import {
	forwardRef,
	type ReactNode,
	type RefCallback,
	useCallback,
	useEffect,
	useImperativeHandle,
	useInsertionEffect,
	useMemo,
	useRef,
	useState,
} from "react";
import { Virtuoso, type VirtuosoHandle } from "react-virtuoso";
import { useShallow } from "zustand/react/shallow";
import {
	EMPTY_RUNTIME,
	selectChatAttended,
	selectReadyCompletionAck,
	specPathMatcher,
	toast,
	useAppStore,
} from "@/store";
import { getTransport } from "@/transport";
import { ACTIVITY_BREADCRUMB_HEIGHT, ActivityBreadcrumbTrail } from "./activityBreadcrumbs";
import { AskStatesContext, deriveAskStates } from "./askState";
import { type ChatActions, ChatActionsContext } from "./ChatActions";
import type { ChatMessageOrder } from "./chatPreferences";
import { type PendingExtUi, PendingExtUiContext, PendingExtUiPrompt } from "./ExtUiPrompt";
import { FoldGeometryProvider } from "./foldState";
import { deriveMessageActions } from "./messageActions";
import { turnAnchorText } from "./recentPrompts";
import { estimateChatRowHeights } from "./rowHeightEstimates";
import {
	type ChatRow,
	deriveRows,
	projectRows,
	rowIndexForTurn,
	rowsHaveToolCall,
	stabilizeRows,
} from "./rows";
import { type StreamStatus, StreamStatusSlot, streamStatus } from "./StreamIndicator";
import { ChatTurnView } from "./turns";
import { useChatScroll } from "./useChatScroll";
import { useTranscriptSync } from "./useTranscriptSync";
import { useWindowFocused } from "./useWindowFocused";
import { advanceVirtualRows, initialVirtualRows } from "./virtualRows";

const CHAT_VIEWPORT_INCREASE = 800;
const CHAT_MIN_OVERSCAN_ITEMS = 2;
const NO_AGENT_TURNS: readonly TurnChangeSet[] = [];
const chatLocationRevealClaims = new WeakMap<object, object>();

type ChatListContext = {
	messageOrder: ChatMessageOrder;
	status: StreamStatus | null;
	runwayActive: boolean;
	measureClassName: string;
	headerRef: RefCallback<HTMLDivElement>;
	streamEdgeRef: RefCallback<HTMLDivElement>;
	runwayRef: RefCallback<HTMLDivElement>;
};

function transcriptMeasureClassName(bounded: boolean): string {
	return cn(
		"mx-auto box-border",
		bounded
			? "w-full max-w-[var(--chat-transcript-width)]"
			: "w-[var(--chat-transcript-width)] max-w-none",
	);
}

function StreamHeader({ context }: { context: ChatListContext }) {
	const { headerRef, measureClassName, messageOrder, runwayActive, status } = context;
	const inset =
		messageOrder === "oldest-first" || runwayActive ? (
			<div className="h-[clamp(48px,10cqh,80px)]" aria-hidden />
		) : null;
	return (
		<div ref={headerRef}>
			{inset}
			{messageOrder === "newest-first" ? (
				<StreamStatusSlot status={status} measureClassName={measureClassName} />
			) : null}
		</div>
	);
}

function StreamFooter({ context }: { context: ChatListContext }) {
	const { measureClassName, messageOrder, runwayActive, runwayRef, status, streamEdgeRef } =
		context;
	if (messageOrder === "newest-first") {
		return (
			<div
				ref={runwayRef}
				data-testid="chat-stream-runway"
				data-active={runwayActive}
				className="h-0"
				aria-hidden
			/>
		);
	}
	return (
		<>
			<StreamStatusSlot status={status} measureClassName={measureClassName} />
			{runwayActive ? (
				<div ref={streamEdgeRef} data-testid="chat-stream-edge" className="h-0" />
			) : null}
			<div
				ref={runwayRef}
				data-testid="chat-stream-runway"
				data-active={runwayActive}
				className="h-0"
				aria-hidden
			/>
		</>
	);
}

const CHAT_LIST_COMPONENTS = { Header: StreamHeader, Footer: StreamFooter };

function useVirtualRows(
	rows: ChatRow[],
	messageOrder: ChatMessageOrder,
	visibleAnchorRowIdRef: React.RefObject<string | null>,
) {
	const [storedVirtualRows, setStoredVirtualRows] = useState(() =>
		initialVirtualRows(rows, messageOrder),
	);
	if (storedVirtualRows.rows === rows && storedVirtualRows.order === messageOrder) {
		return storedVirtualRows;
	}
	const virtualRows = advanceVirtualRows(
		storedVirtualRows,
		rows,
		messageOrder,
		visibleAnchorRowIdRef.current,
	);
	setStoredVirtualRows(virtualRows);
	return virtualRows;
}

export type ChatTranscriptHandle = {
	armImmediateTurn: () => void;
	cancelImmediateTurn: (streaming: boolean) => void;
};

const SCROLL_BUTTON_LABELS = {
	"Follow response": "chat.transcript.followResponse",
	Latest: "chat.transcript.latest",
} as const satisfies Record<"Follow response" | "Latest", MessageKey>;

/**
 * The churn-isolated transcript child: owns the per-delta transcript rendering (the Virtuoso list, scroll
 * control, completion-ack, location reveal, flash, ask-focus scope) and the streaming-runtime subscription.
 * See chat/SPEC.md "Transcript/shell split" for the boundary and the subscribed field list.
 */
const ChatTranscript = forwardRef<
	ChatTranscriptHandle,
	{
		sessionId: string;
		workspaceId: string;
		onOpenFile?: ((path: string) => void) | undefined;
		workspaceRoot: string | undefined;
		focusComposer: () => void;
		openSubagentTranscript: (childSessionId: string | null) => void;
		resultOpener: ChatActions["resultOpener"];
		onTryAgain: () => void;
		historyOpen: boolean;
		inspectorOpen: boolean;
		stillRunning: { count: number; onOpen: () => void } | undefined;
		readMcpOutput?: ChatActions["readMcpOutput"];
		openMcpSettings?: ChatActions["openMcpSettings"];
		openProviderSettings?: ChatActions["openProviderSettings"];
		resourcesOverlay?: ReactNode;
	}
>(function ChatTranscript(
	{
		sessionId,
		workspaceId,
		onOpenFile,
		workspaceRoot,
		focusComposer,
		openSubagentTranscript,
		resultOpener,
		onTryAgain,
		historyOpen,
		inspectorOpen,
		stillRunning,
		readMcpOutput,
		openMcpSettings,
		openProviderSettings,
		resourcesOverlay,
	},
	ref,
) {
	const t = useT();
	const sessionExists = useAppStore((s) => s.sessions[sessionId] !== undefined);
	// Subscribe only to the runtime fields the transcript renders from, so composer keystrokes
	// (`draft`), stats/model/extUi churn, etc. no longer re-render the transcript subtree.
	const runtime = useAppStore(
		useShallow((s) => {
			const rt = s.sessions[sessionId] ?? EMPTY_RUNTIME;
			return {
				turns: rt.turns,
				toolResults: rt.toolResults,
				isStreaming: rt.isStreaming,
				settlementTick: rt.settlementTick,
				currentAssistantId: rt.currentAssistantId,
				askAnswers: rt.askAnswers,
				hostState: rt.hostState,
				turnIdByMessageIndex: rt.turnIdByMessageIndex,
				syncedConnectionGeneration: rt.syncedConnectionGeneration,
				eventRevision: rt.eventRevision,
			};
		}),
	);
	const status = useAppStore((s) => s.status);
	const connectionGeneration = useAppStore((s) => s.connectionGeneration);
	useTranscriptSync({
		workspaceId,
		sessionId,
		runtime,
		status,
		connectionGeneration,
		enabled: sessionExists,
	});
	const chatLineWidthBounded = useAppStore((state) => state.chatLineWidthBounded);
	const chatMessageOrder = useAppStore((state) => state.chatMessageOrder);
	const streamingResponseMovement = useAppStore((state) => state.streamingResponseMovement);
	const specNodes = useAppStore((s) => s.specsByWorkspace[workspaceId]);
	const isSpec = useMemo(() => specPathMatcher(specNodes ?? []), [specNodes]);

	const { turns, toolResults, isStreaming, settlementTick, currentAssistantId } = runtime;

	const workspaceTurns = useAppStore((state) => state.turnsByWorkspace[workspaceId]);
	const agentTurns = useMemo(
		() => workspaceTurns?.filter((turn) => turn.sessionId === sessionId) ?? NO_AGENT_TURNS,
		[sessionId, workspaceTurns],
	);
	const derivedRows = useMemo(
		() => deriveRows(turns, toolResults, isStreaming, isSpec, agentTurns, workspaceRoot),
		[turns, toolResults, isStreaming, isSpec, agentTurns, workspaceRoot],
	);
	// Keep the stabilized rows in state (never a ref written during render): a render-written ref both
	// violates apps/web/SPEC.md and makes the React Compiler skip memoizing this component.
	const [stableRows, setStableRows] = useState(() => ({ derived: derivedRows, rows: derivedRows }));
	let chronologicalRows = stableRows.rows;
	if (stableRows.derived !== derivedRows) {
		chronologicalRows = stabilizeRows(stableRows.rows, derivedRows);
		setStableRows({ derived: derivedRows, rows: chronologicalRows });
	}
	const rows = useMemo(
		() => projectRows(chronologicalRows, chatMessageOrder),
		[chronologicalRows, chatMessageOrder],
	);
	const completionId = runtime.hostState?.completion?.completionId ?? null;
	const completionAnchorRowId = completionId ? (chronologicalRows.at(-1)?.id ?? null) : null;
	const [rowHeightEstimateCache, setRowHeightEstimateCache] = useState(() => ({
		messageOrder: chatMessageOrder,
		heights: new Map<string, number>(),
	}));
	if (rowHeightEstimateCache.messageOrder !== chatMessageOrder) {
		setRowHeightEstimateCache({ messageOrder: chatMessageOrder, heights: new Map() });
	}
	const rowHeightEstimates = useMemo(
		() => estimateChatRowHeights(rows, rowHeightEstimateCache.heights),
		[rows, rowHeightEstimateCache],
	);
	const visibleAnchorRowId = useRef<string | null>(null);
	const virtualRows = useVirtualRows(rows, chatMessageOrder, visibleAnchorRowId);
	const firstItemIndex = virtualRows.firstItemIndex;

	const messageActions = useMemo(
		() => deriveMessageActions(chronologicalRows, isStreaming),
		[chronologicalRows, isStreaming],
	);

	const currentStreamStatus = useMemo<StreamStatus | null>(
		() => (isStreaming ? streamStatus(turns, currentAssistantId) : null),
		[turns, isStreaming, currentAssistantId],
	);

	const latestDividerRowId = useMemo(
		() => chronologicalRows.findLast((candidate) => candidate.kind === "divider")?.id ?? null,
		[chronologicalRows],
	);
	const latestUserRow = useMemo(() => {
		const row = chronologicalRows.findLast((candidate) => candidate.kind === "user");
		if (!row) return null;
		const index = rows.findIndex((candidate) => candidate.id === row.id);
		return index >= 0 ? { id: row.id, index } : null;
	}, [chronologicalRows, rows]);
	const latestRow = useMemo(() => {
		const index = chatMessageOrder === "newest-first" ? 0 : rows.length - 1;
		const row = rows[index];
		return row ? { id: row.id, index } : null;
	}, [chatMessageOrder, rows]);

	const virtuosoRef = useRef<VirtuosoHandle>(null);
	const {
		followOutput,
		handleContentHeight,
		handleScrollerRef,
		headerRef,
		streamEdgeRef,
		runwayRef,
		scrollerElement,
		showScrollButton,
		scrollButtonLabel,
		scrollMoving,
		scrollToLatest,
		armImmediateTurn,
		cancelImmediateTurn,
		cancelAutomaticReveal,
		revealElement,
		revealRow,
		prepareFoldChange,
		runwayActive,
		followState,
		containerProps,
	} = useChatScroll(
		virtuosoRef,
		isStreaming,
		settlementTick,
		chatMessageOrder,
		latestUserRow,
		latestRow,
		firstItemIndex,
		rowHeightEstimates,
		streamingResponseMovement,
	);

	const readyCompletionId = useAppStore((state) =>
		selectReadyCompletionAck(state, workspaceId, sessionId),
	);
	const attended = useAppStore((state) => selectChatAttended(state, workspaceId, sessionId));
	const windowFocused = useWindowFocused();
	const modalOpen = useModalLayerOpen();
	const seen =
		windowFocused &&
		attended &&
		!historyOpen &&
		!inspectorOpen &&
		!modalOpen &&
		followState === "following";
	useEffect(() => {
		if (!seen || !readyCompletionId) return;
		let cancelled = false;
		let retry: ReturnType<typeof setTimeout> | undefined;
		let delay = 250;
		let attempts = 0;
		const acknowledge = (): void => {
			attempts += 1;
			void getTransport()
				.request("session.acknowledgeCompletion", {
					sessionId,
					completionId: readyCompletionId,
				})
				.then(({ record }) => {
					if (!cancelled) useAppStore.getState().applySessionState(record);
				})
				.catch(() => {
					if (cancelled || attempts >= 5) return;
					retry = setTimeout(acknowledge, delay);
					delay = Math.min(delay * 2, 4_000);
				});
		};
		acknowledge();
		return () => {
			cancelled = true;
			if (retry) clearTimeout(retry);
		};
	}, [readyCompletionId, seen, sessionId]);

	useImperativeHandle(ref, () => ({ armImmediateTurn, cancelImmediateTurn }), [
		armImmediateTurn,
		cancelImmediateTurn,
	]);

	const measureClassName = transcriptMeasureClassName(chatLineWidthBounded);
	const listContext = useMemo<ChatListContext>(
		() => ({
			messageOrder: chatMessageOrder,
			status: currentStreamStatus,
			runwayActive,
			measureClassName,
			headerRef,
			streamEdgeRef,
			runwayRef,
		}),
		[
			chatMessageOrder,
			currentStreamStatus,
			headerRef,
			measureClassName,
			runwayActive,
			runwayRef,
			streamEdgeRef,
		],
	);
	const [askFocusScope] = useState<object>(() => ({}));

	const chatLocationRequest = useAppStore((s) => s.chatLocationRequest);
	const activeChatLocationReveal = useRef<typeof chatLocationRequest>(null);
	const locationRowsRef = useRef(rows);
	const locationTurnsRef = useRef(turns);
	const locationTurnMapRef = useRef(runtime.turnIdByMessageIndex);
	useInsertionEffect(() => {
		locationRowsRef.current = rows;
		locationTurnsRef.current = turns;
		locationTurnMapRef.current = runtime.turnIdByMessageIndex;
	});
	const locationRowsReady = rows.length > 0;
	const [flashRowId, setFlashRowId] = useState<string | null>(null);

	useEffect(() => {
		if (
			!chatLocationRequest ||
			chatLocationRequest.workspaceId !== workspaceId ||
			chatLocationRequest.sessionId !== sessionId ||
			!locationRowsReady
		) {
			return;
		}
		if (useAppStore.getState().chatLocationRequest !== chatLocationRequest) return;
		if (activeChatLocationReveal.current === chatLocationRequest) return;
		const { messageIndex, anchorText } = chatLocationRequest;
		const currentRows = locationRowsRef.current;
		const currentTurns = locationTurnsRef.current;
		const prefix = anchorText.slice(0, 40);
		const mappedId = locationTurnMapRef.current?.[messageIndex];
		const mapped = mappedId ? currentTurns.find((t) => t.id === mappedId) : undefined;
		const target =
			mapped && turnAnchorText(mapped).includes(prefix)
				? mapped
				: currentTurns.findLast((t) => turnAnchorText(t).includes(prefix));
		const index = target ? rowIndexForTurn(currentRows, target.id) : -1;
		if (index === -1) {
			toast.error(translate("chat.transcript.locateFailed"));
			useAppStore.getState().clearChatLocation();
			return;
		}
		const rowId = currentRows[index]?.id;
		if (!rowId) {
			useAppStore.getState().clearChatLocation();
			return;
		}
		const revealClaim = {};
		chatLocationRevealClaims.set(chatLocationRequest, revealClaim);
		activeChatLocationReveal.current = chatLocationRequest;
		const cancelReveal = revealRow(
			rowId,
			() => locationRowsRef.current.findIndex((row) => row.id === rowId),
			"center",
			(result) => {
				if (activeChatLocationReveal.current !== chatLocationRequest) return;
				activeChatLocationReveal.current = null;
				if (useAppStore.getState().chatLocationRequest !== chatLocationRequest) return;
				if (result === "found") setFlashRowId(rowId);
				else if (result === "missing") toast.error(translate("chat.transcript.locateFailed"));
				useAppStore.getState().clearChatLocation();
			},
		);
		return () => {
			if (activeChatLocationReveal.current === chatLocationRequest) {
				activeChatLocationReveal.current = null;
			}
			cancelReveal();
			queueMicrotask(() => {
				if (chatLocationRevealClaims.get(chatLocationRequest) !== revealClaim) return;
				chatLocationRevealClaims.delete(chatLocationRequest);
				const state = useAppStore.getState();
				if (state.chatLocationRequest === chatLocationRequest) state.clearChatLocation();
			});
		};
	}, [chatLocationRequest, locationRowsReady, revealRow, sessionId, workspaceId]);

	useEffect(() => {
		if (flashRowId === null) return;
		const timer = setTimeout(() => setFlashRowId(null), 1600);
		return () => clearTimeout(timer);
	}, [flashRowId]);

	const onOpenChange = useCallback(
		(path: string) => {
			useAppStore.getState().requestChangesView(workspaceId, path);
		},
		[workspaceId],
	);
	const onOpenSpec = useCallback(
		(path: string) => {
			useAppStore.getState().requestSpecView(workspaceId, path);
		},
		[workspaceId],
	);
	const onReveal = useCallback(
		(tool: "specs" | "changes") => {
			const store = useAppStore.getState();
			if (tool === "changes") store.revealChanges(workspaceId);
			else store.requestToolView(workspaceId, tool);
		},
		[workspaceId],
	);
	const onReviewTurn = useCallback(
		(scope: GitDiffScope) => {
			useAppStore.getState().requestChangesView(workspaceId, null, scope);
		},
		[workspaceId],
	);

	const pendingExtUiRequest = useAppStore((s) => s.sessions[sessionId]?.pendingExtUi ?? null);
	const pendingExtUi = useMemo<PendingExtUi | null>(() => {
		if (!pendingExtUiRequest) return null;
		let draft: string | undefined;
		let revealed = false;
		return {
			request: pendingExtUiRequest,
			reply: (value) => {
				const { id } = pendingExtUiRequest;
				useAppStore.getState().clearPendingExtUi(sessionId, id);
				getTransport()
					.request("session.extUiReply", { response: { id, value } })
					.catch(() => {});
			},
			draft: () => draft,
			rememberDraft: (text) => {
				draft = text;
			},
			claimReveal: () => {
				if (revealed) return false;
				revealed = true;
				return true;
			},
		};
	}, [pendingExtUiRequest, sessionId]);
	const pendingExtUiId = pendingExtUiRequest?.id ?? null;
	const [announcedExtUiId, setAnnouncedExtUiId] = useState<string | null>(null);
	useEffect(() => {
		if (pendingExtUiId === null) return;
		const frame = requestAnimationFrame(() => setAnnouncedExtUiId(pendingExtUiId));
		return () => cancelAnimationFrame(frame);
	}, [pendingExtUiId]);
	const extUiAnnouncement =
		pendingExtUiRequest && announcedExtUiId === pendingExtUiRequest.id
			? t("chat.transcript.inputNeeded", { title: pendingExtUiRequest.title.split("\n")[0] })
			: "";
	const anchorToolCallId = pendingExtUiRequest?.toolCallId;
	const promptOnToolCard =
		anchorToolCallId !== undefined && rowsHaveToolCall(chronologicalRows, anchorToolCallId);

	const askStates = useMemo(
		() => deriveAskStates(runtime.turns, runtime.askAnswers, runtime.toolResults),
		[runtime.turns, runtime.askAnswers, runtime.toolResults],
	);
	const askContext = useMemo(
		() => ({ states: askStates, focusScope: askFocusScope }),
		[askStates, askFocusScope],
	);

	const chatActions = useMemo<ChatActions>(
		() => ({
			answerQuestion: (toolCallId: string, result: AskUserQuestionResult) =>
				getTransport()
					.request("session.answerQuestion", { sessionId, toolCallId, result })
					.then(() => undefined),
			cancelAutomaticReveal,
			focusComposer,
			openSubagentTranscript,
			resultOpener,
			revealChatElement: revealElement,
			readMcpOutput,
			openMcpSettings,
			openProviderSettings,
		}),
		[
			cancelAutomaticReveal,
			focusComposer,
			openMcpSettings,
			openProviderSettings,
			openSubagentTranscript,
			readMcpOutput,
			resultOpener,
			revealElement,
			sessionId,
		],
	);
	const resourceScope = useMemo(() => ({ workspaceId, sessionId }), [workspaceId, sessionId]);

	return (
		<ChatActionsContext.Provider value={chatActions}>
			<PendingExtUiContext.Provider value={pendingExtUi}>
				<AskStatesContext.Provider value={askContext}>
					<div
						data-testid="chat-scroll"
						data-follow-state={followState}
						data-latest-edge={chatMessageOrder === "newest-first" ? "top" : "bottom"}
						data-streaming={isStreaming}
						data-scroll-moving={scrollMoving}
						className="relative flex min-h-0 flex-1 flex-col [container-type:size]"
						{...containerProps}
					>
						<div
							data-testid="chat-transcript-scroll"
							className={cn(
								"relative min-h-0 flex-1 overflow-y-hidden",
								chatLineWidthBounded ? "overflow-x-hidden" : "overflow-x-auto",
							)}
						>
							{/* One provider above the list: its value is the single transcript-wide callback, so a
						    per-row provider would only re-commit that identical value for every visible row. */}
							<ResourceScopeProvider value={resourceScope}>
								<FoldGeometryProvider onBeforeChange={prepareFoldChange}>
									<Virtuoso<ChatRow, ChatListContext>
										key={chatMessageOrder}
										ref={virtuosoRef}
										data={rows}
										heightEstimates={rowHeightEstimates}
										firstItemIndex={firstItemIndex}
										increaseViewportBy={CHAT_VIEWPORT_INCREASE}
										minOverscanItemCount={CHAT_MIN_OVERSCAN_ITEMS}
										skipAnimationFrameInResizeObserver
										scrollerRef={handleScrollerRef}
										context={listContext}
										components={CHAT_LIST_COMPONENTS}
										className={cn(
											"h-full min-h-0 overflow-x-hidden [overflow-anchor:none]",
											chatLineWidthBounded
												? "w-full"
												: "w-[var(--chat-transcript-width)] min-w-full max-w-none",
										)}
										followOutput={followOutput}
										rangeChanged={({ startIndex }) => {
											const localIndex = startIndex - firstItemIndex;
											visibleAnchorRowId.current = rows[localIndex]?.id ?? null;
										}}
										totalListHeightChanged={handleContentHeight}
										computeItemKey={(_, row) => row.id}
										itemContent={(index, row) => (
											<div
												ref={
													row.id === completionAnchorRowId && completionId
														? (element) => {
																if (element && !historyOpen) {
																	useAppStore
																		.getState()
																		.noteRenderedCompletion(sessionId, completionId);
																}
															}
														: undefined
												}
												data-testid="chat-row"
												data-chat-row-id={row.id}
												data-chat-row-index={index - firstItemIndex}
												data-flash={row.id === flashRowId || undefined}
												className={cn(
													measureClassName,
													"rounded-sm px-chat-gutter py-4 transition-colors data-[flash]:bg-primary-subtle",
												)}
											>
												<ChatTurnView
													row={row}
													workspaceRoot={workspaceRoot}
													onOpenFile={onOpenFile}
													agentResponded={
														messageActions.agentRespondedByUserId.get(row.id) ?? false
													}
													isFinalAnswer={messageActions.finalAnswerRowIds.has(row.id)}
													onOpenSpec={onOpenSpec}
													onOpenChange={onOpenChange}
													onReveal={onReveal}
													onReviewTurn={onReviewTurn}
													onTryAgain={onTryAgain}
													stillRunning={row.id === latestDividerRowId ? stillRunning : undefined}
												/>
												{chatMessageOrder === "newest-first" &&
												runwayActive &&
												index === firstItemIndex ? (
													<div ref={streamEdgeRef} data-testid="chat-stream-edge" className="h-0" />
												) : null}
											</div>
										)}
									/>
								</FoldGeometryProvider>
							</ResourceScopeProvider>
							<ActivityBreadcrumbTrail
								scroller={scrollerElement}
								measureClassName={measureClassName}
								onReveal={(node) =>
									revealElement(node, {
										block: "start",
										provenance: "user-navigation",
										runway: "preserve",
										stability: "none",
										topInset: ACTIVITY_BREADCRUMB_HEIGHT,
									})
								}
							/>
						</div>
						{showScrollButton ? (
							<Button
								variant="outline"
								size="m"
								iconLeft={chatMessageOrder === "newest-first" ? ArrowUp : ArrowDown}
								data-testid={
									chatMessageOrder === "newest-first" ? "scroll-to-top" : "scroll-to-bottom"
								}
								onClick={scrollToLatest}
								className="-translate-x-1/2 absolute bottom-12 left-1/2 shadow-[var(--shadow-md)]"
							>
								{scrollButtonLabel ? t(SCROLL_BUTTON_LABELS[scrollButtonLabel]) : null}
							</Button>
						) : null}
						<span
							role="status"
							aria-live="polite"
							data-testid="ext-ui-announcement"
							className="sr-only"
						>
							{extUiAnnouncement}
						</span>
						{pendingExtUi && !promptOnToolCard ? (
							<div
								data-testid="ext-ui-dock"
								className={cn(
									measureClassName,
									"flex max-h-[60cqh] min-h-0 shrink-0 flex-col px-chat-gutter pt-8",
								)}
							>
								<PendingExtUiPrompt pending={pendingExtUi} />
							</div>
						) : null}
						{resourcesOverlay}
					</div>
				</AskStatesContext.Provider>
			</PendingExtUiContext.Provider>
		</ChatActionsContext.Provider>
	);
});

export default ChatTranscript;
