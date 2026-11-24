import { RiArrowDownLine as ArrowDown, RiArrowUpLine as ArrowUp } from "@remixicon/react";
import {
	ACTIVITY_BREADCRUMB_HEIGHT,
	ActivityBreadcrumbTrail,
} from "@thinkrail/chat-ui/activityBreadcrumbs";
import { type ChatActions, ChatActionsContext } from "@thinkrail/chat-ui/ChatActions";
import type { ChatMessageOrder } from "@thinkrail/chat-ui/chatMessageOrder";
import { PendingExtUiContext, PendingExtUiPrompt } from "@thinkrail/chat-ui/ExtUiPrompt";
import { workspaceFileTarget } from "@thinkrail/chat-ui/fileTargets";
import { expandFolds, FoldGeometryProvider } from "@thinkrail/chat-ui/foldState";
import {
	awaitingToolCallIdOf,
	deriveInteractionStates,
	dockedInteraction,
	InteractionStatesContext,
	latestPendingInteraction,
	type PendingInteraction,
} from "@thinkrail/chat-ui/interactionState";
import { deriveMessageActions } from "@thinkrail/chat-ui/messageActions";
import { usePendingExtUi } from "@thinkrail/chat-ui/pendingExtUi";
import {
	type ChatRow,
	deriveRows,
	projectRows,
	rowsHaveToolCall,
	sessionRoundArtifacts,
	stabilizeRows,
} from "@thinkrail/chat-ui/rows";
import {
	type StreamStatus,
	StreamStatusSlot,
	streamStatus,
} from "@thinkrail/chat-ui/StreamIndicator";
import { ToolRendererBoundary } from "@thinkrail/chat-ui/ToolRendererBoundary";
import { TranscriptItem, TranscriptProvider } from "@thinkrail/chat-ui/TranscriptItem";
import { useToolInteraction } from "@thinkrail/chat-ui/toolInteraction";
import {
	DefaultToolRenderer,
	useToolRegistry,
	useToolRenderer,
} from "@thinkrail/chat-ui/toolRegistry";
import { ChatTurnView, type DividerReveal } from "@thinkrail/chat-ui/turns";
import type { ChatContinuation, GitDiffScope, TurnChangeSet } from "@thinkrail/contracts";
import type { ToolRenderProps } from "@thinkrail/extension-api/web";
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
	useLayoutEffect,
	useMemo,
	useRef,
	useState,
} from "react";
import { createPortal } from "react-dom";
import { type ListProps, Virtuoso, type VirtuosoHandle } from "react-virtuoso";
import { useShallow } from "zustand/react/shallow";
import {
	EMPTY_RUNTIME,
	selectArtifactsRoundFilter,
	selectChatAttended,
	selectChatsContainer,
	selectReadyCompletionAck,
	selectWorkspaceById,
	specPathMatcher,
	toast,
	useAppStore,
} from "@/store";
import { errorText, getTransport, respondToTool } from "@/transport";
import { locateChatRow, locateToolItem } from "./chatLocation";
import { refreshContinuation, requestContinuation } from "./continuations";
import { openWorkspace } from "./openWorkspace";
import { estimateChatRowHeights } from "./rowHeightEstimates";
import { newestContentRowId } from "./transcriptNavigation";
import { type ChatReadingPosition, useChatScroll } from "./useChatScroll";
import { useTranscriptNavigation } from "./useTranscriptNavigation";
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

function TranscriptFeed({
	ref,
	style,
	children,
	"data-testid": testId,
}: ListProps & { context: ChatListContext }) {
	const t = useT();
	return (
		<div
			ref={ref}
			style={style}
			data-testid={testId}
			role="feed"
			aria-label={t("chat.transcript.label")}
			tabIndex={-1}
			data-transcript-feed
			data-focus-park
			className="outline-none"
		>
			{children}
		</div>
	);
}

const CHAT_LIST_COMPONENTS = { Header: StreamHeader, Footer: StreamFooter, List: TranscriptFeed };

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

function LiveWorkspaceName({ workspaceId, fallback }: { workspaceId: string; fallback: string }) {
	const name = useAppStore((state) => selectWorkspaceById(state, workspaceId)?.name);
	return name ?? fallback;
}

export type ChatTranscriptHandle = {
	armImmediateTurn: () => void;
	cancelImmediateTurn: (streaming: boolean) => void;
	focusNewest: () => void;
	scrollPage: (direction: -1 | 1) => void;
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
		waitingQuestion: () => HTMLElement | null;
		mayClaimFocus: ChatActions["mayClaimFocus"];
		landingChord: string;
		openSubagentTranscript: (childSessionId: string | null) => void;
		resultOpener: ChatActions["resultOpener"];
		onTryAgain: () => void;
		historyOpen: boolean;
		inspectorOpen: boolean;
		stillRunning: { count: number; onOpen: () => void } | undefined;
		readMcpOutput?: ChatActions["readMcpOutput"];
		openMcpSettings?: ChatActions["openMcpSettings"];
		openProviderSettings?: ChatActions["openProviderSettings"];
		disableServerFallback?: ChatActions["disableServerFallback"];
		findModel?: ChatActions["findModel"];
		dockTarget?: HTMLElement | null;
		onDockedInteractionChange?: (toolCallId: string | null) => void;
		resourcesOverlay?: ReactNode;
	}
>(function ChatTranscript(
	{
		sessionId,
		workspaceId,
		onOpenFile,
		workspaceRoot,
		focusComposer,
		waitingQuestion,
		mayClaimFocus,
		landingChord,
		openSubagentTranscript,
		resultOpener,
		onTryAgain,
		historyOpen,
		inspectorOpen,
		stillRunning,
		readMcpOutput,
		openMcpSettings,
		openProviderSettings,
		disableServerFallback,
		findModel,
		dockTarget,
		onDockedInteractionChange,
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
				toolResponses: rt.toolResponses,
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
	const specNodes = useAppStore((s) => s.specsByWorkspace[workspaceId]);
	const isSpec = useMemo(() => specPathMatcher(specNodes ?? []), [specNodes]);

	const { turns, toolResults, isStreaming, settlementTick, currentAssistantId } = runtime;

	const workspaceTurns = useAppStore((state) => state.turnsByWorkspace[workspaceId]);
	const agentTurns = useMemo(
		() => workspaceTurns?.filter((turn) => turn.sessionId === sessionId) ?? NO_AGENT_TURNS,
		[sessionId, workspaceTurns],
	);
	const artifactsSnapshot = useAppStore((state) => state.artifactsByWorkspace[workspaceId]);
	const artifactsFilter = useAppStore(selectArtifactsRoundFilter);
	const roundArtifacts = useMemo(
		() => sessionRoundArtifacts(artifactsSnapshot, sessionId, artifactsFilter),
		[artifactsSnapshot, sessionId, artifactsFilter],
	);
	const toolRegistry = useToolRegistry();
	const derivedRows = useMemo(
		() =>
			deriveRows(
				turns,
				toolResults,
				isStreaming,
				isSpec,
				agentTurns,
				workspaceRoot,
				roundArtifacts,
				toolRegistry,
			),
		[
			turns,
			toolResults,
			isStreaming,
			isSpec,
			agentTurns,
			workspaceRoot,
			roundArtifacts,
			toolRegistry,
		],
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
		() => estimateChatRowHeights(rows, rowHeightEstimateCache.heights, toolRegistry),
		[rows, rowHeightEstimateCache, toolRegistry],
	);
	const visibleAnchorRowId = useRef<string | null>(null);
	const virtualRows = useVirtualRows(rows, chatMessageOrder, visibleAnchorRowId);
	const firstItemIndex = virtualRows.firstItemIndex;

	const messageActions = useMemo(
		() => deriveMessageActions(chronologicalRows, isStreaming, toolRegistry),
		[chronologicalRows, isStreaming, toolRegistry],
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

	const locationRowsRef = useRef(rows);
	const locationTurnsRef = useRef(turns);
	const locationTurnMapRef = useRef(runtime.turnIdByMessageIndex);
	useInsertionEffect(() => {
		locationRowsRef.current = rows;
		locationTurnsRef.current = turns;
		locationTurnMapRef.current = runtime.turnIdByMessageIndex;
	});
	const [readingRestore] = useState(
		() => useAppStore.getState().sessions[sessionId]?.readingAnchor ?? null,
	);
	const readingPosition = useMemo<ChatReadingPosition>(
		() => ({
			restore: readingRestore,
			resolveIndex: (rowId) => locationRowsRef.current.findIndex((row) => row.id === rowId),
			save: (anchor) => useAppStore.getState().setChatReadingAnchor(sessionId, anchor),
		}),
		[readingRestore, sessionId],
	);

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
		scrollPage,
		keyboardScrollBy,
		armImmediateTurn,
		cancelImmediateTurn,
		cancelAutomaticReveal,
		leaveFollow,
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
		readingPosition,
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

	const newestRowId = useMemo(() => newestContentRowId(chronologicalRows), [chronologicalRows]);
	const navigation = useTranscriptNavigation(scrollerElement, {
		rows,
		newestRowId,
		latestRowId: latestRow?.id ?? null,
		revealRow,
		revealElement,
		leaveFollow,
		scrollBy: keyboardScrollBy,
		scrollPage,
		scrollToLatest,
		focusComposer,
		waitingQuestion,
		fileTarget: (path) => (onOpenFile ? workspaceFileTarget(path, workspaceRoot) : null),
		openFile: (target) => onOpenFile?.(target),
		onCopied: () => toast.success(t("common.copied")),
	});

	useImperativeHandle(
		ref,
		() => ({
			armImmediateTurn,
			cancelImmediateTurn,
			focusNewest: () => navigation.focusNewest(),
			scrollPage,
		}),
		[armImmediateTurn, cancelImmediateTurn, navigation, scrollPage],
	);

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
	const [interactionFocusScope] = useState<object>(() => ({}));

	const revealToolItem = useCallback(
		(itemId: string) => {
			const target = scrollerElement?.querySelector<HTMLElement>(
				`[data-transcript-item="${CSS.escape(itemId)}"]`,
			);
			if (!target) return;
			revealElement(target, {
				block: "nearest",
				provenance: "user-navigation",
				runway: "preserve",
				stability: "none",
				topInset: ACTIVITY_BREADCRUMB_HEIGHT,
			});
		},
		[revealElement, scrollerElement],
	);

	const chatLocationRequest = useAppStore((s) => s.chatLocationRequest);
	const activeChatLocationReveal = useRef<typeof chatLocationRequest>(null);
	const locationRowsReady = rows.length > 0;
	const [flashItemId, setFlashItemId] = useState<string | null>(null);

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
		const currentRows = locationRowsRef.current;
		const { index, nearest } = locateChatRow(
			chatLocationRequest,
			currentRows,
			locationTurnsRef.current,
			locationTurnMapRef.current,
		);
		if (index === -1) {
			toast.error(translate("chat.transcript.locateFailed"));
			useAppStore.getState().clearChatLocation();
			return;
		}
		const row = currentRows[index];
		if (!row) {
			useAppStore.getState().clearChatLocation();
			return;
		}
		const rowId = row.id;
		const toolItem = chatLocationRequest.toolCallId
			? locateToolItem(row, chatLocationRequest.toolCallId)
			: null;
		if (toolItem) expandFolds(toolItem.folds);
		const keepsFocus = chatLocationRequest.focus === false;
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
				if (result === "found") {
					setFlashItemId(toolItem?.itemId ?? rowId);
					if (toolItem) revealToolItem(toolItem.itemId);
					if (!keepsFocus) navigation.focusRow(rowId);
					if (nearest) toast.info(translate("chat.transcript.locatedNearest"));
				} else if (result === "missing") toast.error(translate("chat.transcript.locateFailed"));
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
	}, [
		chatLocationRequest,
		locationRowsReady,
		navigation,
		revealRow,
		revealToolItem,
		sessionId,
		workspaceId,
	]);

	useEffect(() => {
		if (flashItemId === null) return;
		const timer = setTimeout(() => setFlashItemId(null), 1600);
		return () => clearTimeout(timer);
	}, [flashItemId]);

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
		(tool: DividerReveal) => {
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
	const pendingExtUi = usePendingExtUi(pendingExtUiRequest, ({ id }, value) => {
		useAppStore.getState().clearPendingExtUi(sessionId, id);
		getTransport()
			.request("session.extUiReply", { response: { id, value } })
			.catch(() => {});
	});
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

	const interactionStates = useMemo(
		() =>
			deriveInteractionStates(
				runtime.turns,
				runtime.toolResponses,
				runtime.toolResults,
				toolRegistry,
			),
		[runtime.turns, runtime.toolResponses, runtime.toolResults, toolRegistry],
	);
	const awaitingToolCallId = awaitingToolCallIdOf(runtime.hostState);
	const dockedCall = useMemo(
		() =>
			dockedInteraction(
				latestPendingInteraction(
					runtime.turns,
					runtime.toolResults,
					interactionStates,
					toolRegistry,
				),
				awaitingToolCallId,
				toolRegistry,
			),
		[runtime.turns, runtime.toolResults, interactionStates, awaitingToolCallId, toolRegistry],
	);
	const dockedToolCallId = dockedCall?.toolCallId;
	useLayoutEffect(() => {
		onDockedInteractionChange?.(dockTarget ? (dockedToolCallId ?? null) : null);
	}, [onDockedInteractionChange, dockTarget, dockedToolCallId]);
	const interactionContext = useMemo(
		() => ({
			states: interactionStates,
			focusScope: interactionFocusScope,
			awaitingToolCallId,
			dockedToolCallId,
		}),
		[interactionStates, interactionFocusScope, awaitingToolCallId, dockedToolCallId],
	);

	const continuations = useAppStore((s) => s.chatContinuations);
	const continuationOf = useCallback(
		(operationId: string): ChatContinuation | undefined => continuations[operationId],
		[continuations],
	);
	const welcomeGeneration = useAppStore((s) => s.welcomeGeneration);
	const hostProtocol = useAppStore((s) => s.protocolVersion) ?? undefined;
	const cardOperations = useMemo(
		() =>
			runtime.turns.flatMap((turn) =>
				turn.kind === "continuationRequest" ? [turn.details.operationId] : [],
			),
		[runtime.turns],
	);
	useEffect(() => {
		if (welcomeGeneration === 0) return;
		const known = useAppStore.getState().chatContinuations;
		for (const operationId of cardOperations) {
			if (!known[operationId]) refreshContinuation(operationId, { workspaceId, sessionId });
		}
	}, [cardOperations, welcomeGeneration, workspaceId, sessionId]);
	const chatActions = useMemo<ChatActions>(
		() => ({
			cancelAutomaticReveal,
			focusComposer,
			focusToolCall: navigation.parkOnToolCall,
			mayClaimFocus,
			landingChord,
			openSubagentTranscript,
			respondToTool: (toolCallId: string, response: unknown) =>
				respondToTool(sessionId, toolCallId, response),
			resultOpener,
			revealChatElement: revealElement,
			readMcpOutput,
			openMcpSettings,
			openProviderSettings,
			disableServerFallback,
			findModel,
			continuationOf,
			retryContinuation: (details) => {
				void requestContinuation(workspaceId, details.projectId).catch((err: unknown) =>
					toast.error(errorText(err), t("chat.turn.continuation.retryFailed")),
				);
			},
			openHandoffSource: (details) => {
				const container = selectChatsContainer(useAppStore.getState());
				if (!container) return;
				void openWorkspace(
					{
						workspaceId: details.sourceWorkspaceId,
						projectId: container.id,
						sessionId: details.sourceSessionId,
					},
					t("chat.turn.handoff.sourceGone"),
				);
			},
			openWorkspace,
			WorkspaceName: LiveWorkspaceName,
			hostProtocol,
		}),
		[
			cancelAutomaticReveal,
			continuationOf,
			disableServerFallback,
			findModel,
			focusComposer,
			landingChord,
			mayClaimFocus,
			navigation,
			hostProtocol,
			openMcpSettings,
			openProviderSettings,
			openSubagentTranscript,
			readMcpOutput,
			resultOpener,
			revealElement,
			sessionId,
			t,
			workspaceId,
		],
	);
	const resourceScope = useMemo(() => ({ workspaceId, sessionId }), [workspaceId, sessionId]);

	return (
		<ChatActionsContext.Provider value={chatActions}>
			<PendingExtUiContext.Provider value={pendingExtUi}>
				<InteractionStatesContext.Provider value={interactionContext}>
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
							inert={inspectorOpen || undefined}
							className={cn(
								"relative min-h-0 flex-1 overflow-y-hidden",
								chatLineWidthBounded ? "overflow-x-hidden" : "overflow-x-auto",
							)}
						>
							{/* One provider above the list: its value is the single transcript-wide callback, so a
						    per-row provider would only re-commit that identical value for every visible row. */}
							<ResourceScopeProvider value={resourceScope}>
								<TranscriptProvider navigation={navigation} flashedItemId={flashItemId}>
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
													? "w-full [container-type:inline-size]"
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
												<TranscriptItem
													id={row.id}
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
													aria-posinset={index - firstItemIndex + 1}
													aria-setsize={rows.length}
													data-testid="chat-row"
													data-chat-row-id={row.id}
													data-chat-row-index={index - firstItemIndex}
													className={cn(measureClassName, "rounded-sm px-chat-gutter py-4")}
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
														<div
															ref={streamEdgeRef}
															data-testid="chat-stream-edge"
															className="h-0"
														/>
													) : null}
												</TranscriptItem>
											)}
										/>
									</FoldGeometryProvider>
								</TranscriptProvider>
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
								inert={inspectorOpen || undefined}
								onClick={(event) => {
									scrollToLatest();
									if (event.detail === 0) navigation.focusNewest(true);
								}}
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
								inert={inspectorOpen || undefined}
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
					{dockTarget && dockedCall
						? createPortal(
								<ResourceScopeProvider value={resourceScope}>
									<DockedTool
										key={dockedCall.toolCallId}
										call={dockedCall}
										workspaceRoot={workspaceRoot}
										onOpenFile={onOpenFile}
									/>
								</ResourceScopeProvider>,
								dockTarget,
							)
						: null}
				</InteractionStatesContext.Provider>
			</PendingExtUiContext.Provider>
		</ChatActionsContext.Provider>
	);
});

function DockedTool({
	call,
	workspaceRoot,
	onOpenFile,
}: {
	call: PendingInteraction;
	workspaceRoot: string | undefined;
	onOpenFile: ((path: string) => void) | undefined;
}) {
	const Renderer = useToolRenderer(call.toolName);
	const interaction = useToolInteraction(call.toolCallId, call.toolName, "dock");
	const props: ToolRenderProps = { ...call, workspaceRoot, onOpenFile, interaction };
	return (
		<ToolRendererBoundary
			renderer={Renderer}
			toolCallId={call.toolCallId}
			status={call.status}
			streaming={call.streaming}
			fallback={
				<div data-testid="tool-renderer-fallback">
					<DefaultToolRenderer {...props} />
				</div>
			}
		>
			<Renderer {...props} />
		</ToolRendererBoundary>
	);
}

export default ChatTranscript;
