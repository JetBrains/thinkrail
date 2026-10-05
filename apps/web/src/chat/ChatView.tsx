import { RiArrowDownLine as ArrowDown, RiArrowUpLine as ArrowUp } from "@remixicon/react";
import {
	type AskUserQuestionResult,
	type PromptHit,
	type QueueLane,
	type SessionQueueContent,
	sameModel,
	type TemplateInfo,
	type ThinkingLevel,
} from "@thinkrail/contracts";
import {
	type RefCallback,
	useCallback,
	useEffect,
	useInsertionEffect,
	useMemo,
	useRef,
	useState,
} from "react";
import { Virtuoso, type VirtuosoHandle } from "react-virtuoso";
import { Button } from "@/components/ui/button";
import {
	Dialog,
	DialogContent,
	DialogDescription,
	DialogFooter,
	DialogTitle,
} from "@/components/ui/dialog";
import { Popover, PopoverAnchor, PopoverTrigger } from "@/components/ui/popover";
import { useNow } from "@/components/useNow";
import { cn } from "@/lib";
import { type ParsedTemplate, templateToSlashCommand, useTemplateCommandPicker } from "@/prompt";
import {
	EMPTY_RUNTIME,
	SettingsSection,
	selectCanRenameChat,
	selectCatalogModel,
	selectCompactionTurnIds,
	selectReadyCompletionActivation,
	selectSkillsStale,
	selectWorkspaceById,
	specPathMatcher,
	toast,
	useAppStore,
} from "@/store";
import { errorText, getTransport } from "@/transport";
import { ACTIVITY_BREADCRUMB_HEIGHT, ActivityBreadcrumbTrail } from "./activityBreadcrumbs";
import { AskStatesContext, deriveAskStates } from "./askState";
import { type ChatActions, ChatActionsContext } from "./ChatActions";
import { ChatHeader } from "./ChatHeader";
import { ChatPlanContent, ChatPlanStripContent } from "./ChatPlan";
import {
	Composer,
	type ComposerHandle,
	type ComposerSubmitDisposition,
	type MentionCandidate,
	type SubmitBehavior,
} from "./Composer";
import type { ChatMessageOrder } from "./chatPreferences";
import { ExtUiDialog } from "./ExtUiDialog";
import { FoldGeometryProvider } from "./foldState";
import { HistoryOverlay } from "./HistoryOverlay";
import type { ModelSelection } from "./ModelEffortPicker";
import { deriveMessageActions } from "./messageActions";
import {
	compactSubmissionError,
	mergeNativeChatCommands,
	parseNativeChatCommand,
	prepareNameChatCommand,
} from "./nativeCommands";
import { hostSessionGlance, planGlance } from "./planView";
import { QueueStrip } from "./QueueStrip";
import { CommandLogView, ResourcesButton, ResourcesDock, ResourcesInspector } from "./resources";
import { estimateChatRowHeights } from "./rowHeightEstimates";
import { type ChatRow, deriveRows, projectRows, rowIndexForTurn } from "./rows";
import { SkillsDialog } from "./SkillsDialog";
import { type StreamStatus, StreamStatusSlot, streamStatus } from "./StreamIndicator";
import { SubagentTranscriptDialog, SubagentTranscriptPane } from "./SubagentTranscriptDialog";
import { TemplateEditorDialog } from "./TemplateEditorDialog";
import { useChatResources, useCommandLog } from "./useChatResources";
import { useModelCatalog } from "./useModelCatalog";
import { useModelPreferences } from "./useModelPreferences";
import { useSessionStats } from "./useSessionStats";
import "./tools/register";
import { ChatTurnView } from "./turns";
import type { ChatAttachment, ChatTurn } from "./types";
import { useChatScroll } from "./useChatScroll";
import { useChatTodos } from "./useChatTodos";
import { useHistorySearch } from "./useHistorySearch";
import { useTranscriptSync } from "./useTranscriptSync";
import { advanceVirtualRows, initialVirtualRows } from "./virtualRows";

const TRY_AGAIN_PROMPT = "Try again.";
const CHAT_VIEWPORT_INCREASE = 800;
const CHAT_MIN_OVERSCAN_ITEMS = 2;
const chatLocationRevealClaims = new WeakMap<object, object>();

function turnAnchorText(turn: ChatTurn): string {
	if (turn.kind === "user") {
		const { content } = turn.message;
		return typeof content === "string"
			? content
			: content
					.filter((b) => b.type === "text")
					.map((b) => b.text)
					.join("\n");
	}
	if (turn.kind === "assistant") {
		return turn.message.content
			.filter((b) => b.type === "text")
			.map((b) => b.text)
			.join("\n");
	}
	return "";
}

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

export default function ChatView({
	sessionId,
	workspaceId,
	onOpenFile,
}: {
	sessionId: string;
	workspaceId: string;
	onOpenFile?: ((path: string) => void) | undefined;
}) {
	const sessionRuntime = useAppStore((s) => s.sessions[sessionId]);
	const runtime = sessionRuntime ?? EMPTY_RUNTIME;
	const status = useAppStore((s) => s.status);
	const connectionGeneration = useAppStore((s) => s.connectionGeneration);
	const canRenameChat = useAppStore(selectCanRenameChat);
	useTranscriptSync({
		workspaceId,
		sessionId,
		runtime,
		status,
		connectionGeneration,
		enabled: sessionRuntime !== undefined,
	});
	const composerGrowthLimit = useAppStore((state) => state.composerGrowthLimit);
	const chatLineWidth = useAppStore((state) => state.chatLineWidth);
	const chatLineWidthBounded = useAppStore((state) => state.chatLineWidthBounded);
	const chatMessageOrder = useAppStore((state) => state.chatMessageOrder);
	const streamingResponseMovement = useAppStore((state) => state.streamingResponseMovement);
	const { models, refreshing: modelsRefreshing, refresh: onRefreshModels } = useModelCatalog();
	const modelPreferences = useModelPreferences(models);
	const projectId = useAppStore(
		(s) =>
			Object.values(s.workspaces)
				.flat()
				.find((w) => w.id === workspaceId)?.projectId,
	);
	const [skillsOpen, setSkillsOpen] = useState(false);
	const skillsStale = useAppStore((s) => selectSkillsStale(s, workspaceId, sessionId));
	const workspaceRoot = useAppStore(
		(s) => selectWorkspaceById(s, workspaceId)?.worktreePath ?? undefined,
	);
	const workspaces = useAppStore((s) => s.workspaces);
	const workspaceNames = useMemo(() => {
		const map: Record<string, string> = {};
		for (const list of Object.values(workspaces)) {
			for (const w of list) map[w.id] = w.name;
		}
		return map;
	}, [workspaces]);
	const specNodes = useAppStore((s) => s.specsByWorkspace[workspaceId]);
	const isSpec = useMemo(() => specPathMatcher(specNodes ?? []), [specNodes]);
	const {
		turns,
		toolResults,
		isStreaming,
		settlementTick,
		statsRefreshTick,
		syncedConnectionGeneration,
		currentAssistantId,
		stats,
		commands,
		draft,
		queue,
		pendingExtUi,
		extUiStatus,
		extUiWidget,
		model: sessionModel,
		thinkingLevel,
	} = runtime;

	const currentModel = selectCatalogModel(models, sessionModel) ?? sessionModel;
	const refreshStats = useSessionStats({
		sessionId,
		statsRefreshTick,
		syncedConnectionGeneration,
		status,
		connectionGeneration,
		enabled: sessionRuntime !== undefined,
	});

	const chronologicalRows = useMemo(
		() => deriveRows(turns, toolResults, isStreaming, isSpec),
		[turns, toolResults, isStreaming, isSpec],
	);
	const rows = useMemo(
		() => projectRows(chronologicalRows, chatMessageOrder),
		[chronologicalRows, chatMessageOrder],
	);
	const completionId = runtime.hostState?.completion?.completionId ?? null;
	const completionAnchorRowId = completionId ? (chronologicalRows.at(-1)?.id ?? null) : null;
	const readyCompletionId = useAppStore((state) =>
		selectReadyCompletionActivation(state, workspaceId, sessionId),
	);
	const directActivationTick = useAppStore(
		(state) => state.directChatActivationTickBySession[sessionId] ?? 0,
	);
	useEffect(() => {
		if (!readyCompletionId) return;
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
	}, [directActivationTick, readyCompletionId, sessionId]);
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

	const recentPrompts = useMemo(() => {
		const texts = turns
			.filter((t) => t.kind === "user")
			.map((t) => turnAnchorText(t))
			.filter(Boolean);
		return [...new Set(texts.reverse())];
	}, [turns]);

	const [mentionQuery, setMentionQuery] = useState<string | null>(null);
	const [mentionCandidates, setMentionCandidates] = useState<MentionCandidate[]>([]);
	const plan = useChatTodos(workspaceId, sessionId);
	const [planOpen, setPlanOpen] = useState(false);
	const [slashActive, setSlashActive] = useState(false);
	const [templates, setTemplates] = useState<TemplateInfo[]>([]);
	const [templatesEmpty, setTemplatesEmpty] = useState(false);
	const [saveAsTemplateHit, setSaveAsTemplateHit] = useState<PromptHit | null>(null);
	const [transcriptSelection, setTranscriptSelection] = useState<{
		workspaceId: string;
		sessionId: string;
		childSessionId: string;
	} | null>(null);
	const transcriptChildId =
		transcriptSelection?.workspaceId === workspaceId && transcriptSelection.sessionId === sessionId
			? transcriptSelection.childSessionId
			: null;
	const setTranscriptChildId = useCallback(
		(childSessionId: string | null) =>
			setTranscriptSelection(childSessionId ? { workspaceId, sessionId, childSessionId } : null),
		[workspaceId, sessionId],
	);
	const composerRef = useRef<ComposerHandle>(null);
	const resources = useChatResources(workspaceId, sessionId);
	const resourcesTrigger = useRef<HTMLButtonElement>(null);
	const [stopAllOpen, setStopAllOpen] = useState(false);
	const [inspector, setInspector] = useState<{
		workspaceId: string;
		sessionId: string;
		open: boolean;
		selectedId: string | null;
	} | null>(null);
	const inspectorOpen =
		inspector?.workspaceId === workspaceId && inspector.sessionId === sessionId && inspector.open;
	const inspectorSelectedId =
		inspector?.workspaceId === workspaceId && inspector.sessionId === sessionId
			? inspector.selectedId
			: null;
	const openInspector = useCallback(
		(selectedId?: string) =>
			setInspector((previous) => ({
				workspaceId,
				sessionId,
				open: true,
				selectedId:
					selectedId ??
					(previous?.workspaceId === workspaceId && previous.sessionId === sessionId
						? previous.selectedId
						: null),
			})),
		[workspaceId, sessionId],
	);
	const setInspectorOpen = useCallback(
		(open: boolean) => {
			if (open) openInspector();
			else setInspector((previous) => (previous ? { ...previous, open: false } : previous));
		},
		[openInspector],
	);
	const selectResource = useCallback(
		(selectedId: string) =>
			setInspector((previous) =>
				previous?.workspaceId === workspaceId && previous.sessionId === sessionId
					? { ...previous, selectedId }
					: { workspaceId, sessionId, open: true, selectedId },
			),
		[workspaceId, sessionId],
	);
	const selectedCommandId =
		inspectorOpen &&
		inspectorSelectedId &&
		[...resources.groups.commands, ...resources.groups.finishedCommands].some(
			(command) => command.id === inspectorSelectedId,
		)
			? inspectorSelectedId
			: null;
	const selectedSubagentId =
		inspectorOpen &&
		inspectorSelectedId &&
		[...resources.groups.subagents, ...resources.groups.finishedSubagents].some(
			(child) => child.childSessionId === inspectorSelectedId,
		)
			? inspectorSelectedId
			: null;
	const commandLog = useCommandLog(workspaceId, sessionId, selectedCommandId);
	const now = useNow();
	const returnToResources = (event: Event) => {
		event.preventDefault();
		if (resourcesTrigger.current) resourcesTrigger.current.focus();
		else composerRef.current?.refocus();
	};
	useEffect(() => {
		if (!resources.knownUnsupported) return;
		setInspector(null);
		setStopAllOpen(false);
	}, [resources.knownUnsupported]);

	const virtuosoRef = useRef<VirtuosoHandle>(null);
	const latestDividerRowId = useMemo(
		() => chronologicalRows.findLast((candidate) => candidate.kind === "divider")?.id ?? null,
		[chronologicalRows],
	);
	const stillRunning = useMemo(
		() =>
			resources.visible && resources.authoritative && resources.groups.activeCount > 0
				? { count: resources.groups.activeCount, onOpen: () => openInspector() }
				: undefined,
		[resources.visible, resources.authoritative, resources.groups.activeCount, openInspector],
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
	const measureClassName = transcriptMeasureClassName(chatLineWidthBounded);
	const chatViewRef = useCallback(
		(element: HTMLDivElement | null) => {
			if (element) {
				element.style.setProperty(
					"--chat-transcript-width",
					`calc(${chatLineWidth}ch + var(--space-24))`,
				);
			}
		},
		[chatLineWidth],
	);
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

	const {
		state: historyState,
		openOverlay,
		close: closeHistory,
		setQuery,
		cycleScope,
		setScope,
		toggleStage,
		moveSelection,
		openMessage,
	} = useHistorySearch(sessionId, workspaceId, projectId);
	useEffect(() => {
		useAppStore.getState().setChatObscured(sessionId, historyState.open);
		return () => useAppStore.getState().setChatObscured(sessionId, false);
	}, [historyState.open, sessionId]);

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
		getTransport()
			.request("session.getCommands", { sessionId })
			.then((c) => useAppStore.getState().setCommands(sessionId, c))
			.catch(() => {});
	}, [sessionId]);

	useEffect(() => {
		if (!slashActive) return;
		let cancelled = false;
		getTransport()
			.request("template.list", { workspaceId })
			.then((res) => {
				if (cancelled) return;
				setTemplates(res.templates);
				setTemplatesEmpty(res.templates.length === 0);
			})
			.catch(() => {});
		return () => {
			cancelled = true;
		};
	}, [slashActive, workspaceId]);

	const mergedCommands = useMemo(
		() =>
			mergeNativeChatCommands(
				[
					...commands.filter((command) => command.source !== "prompt"),
					...templates.map(templateToSlashCommand),
				],
				canRenameChat,
			),
		[canRenameChat, commands, templates],
	);

	useEffect(() => {
		if (mentionQuery === null) {
			setMentionCandidates([]);
			return;
		}
		const slash = mentionQuery.lastIndexOf("/");
		const dir = slash >= 0 ? mentionQuery.slice(0, slash) : "";
		const prefix = (slash >= 0 ? mentionQuery.slice(slash + 1) : mentionQuery).toLowerCase();
		let cancelled = false;
		const timer = setTimeout(() => {
			getTransport()
				.request("fs.readDir", { workspaceId, path: dir })
				.then((nodes) => {
					if (cancelled) return;
					setMentionCandidates(
						nodes
							.filter((n) => n.name.toLowerCase().startsWith(prefix))
							.slice(0, 12)
							.map((n) => ({ path: n.path, name: n.name, kind: n.kind })),
					);
				})
				.catch(() => {
					if (!cancelled) setMentionCandidates([]);
				});
		}, 120);
		return () => {
			cancelled = true;
			clearTimeout(timer);
		};
	}, [mentionQuery, workspaceId]);

	const onMentionQuery = useCallback((q: string | null) => setMentionQuery(q), []);

	const liveRuntime = () => useAppStore.getState().sessions[sessionId];
	const pairSelection = useRef(0);

	const requestLevel = useCallback(
		(level: ThinkingLevel, previous: ThinkingLevel) =>
			getTransport()
				.request("session.setThinkingLevel", { sessionId, level })
				.catch((error: unknown) => {
					if (useAppStore.getState().sessions[sessionId]?.thinkingLevel === level) {
						useAppStore.getState().setThinkingLevel(sessionId, previous);
					}
					toast.error(errorText(error), "Couldn't change the effort level");
				}),
		[sessionId],
	);

	useEffect(() => {
		if (!currentModel || currentModel.thinkingLevels.includes(thinkingLevel)) return;
		let cancelled = false;
		getTransport()
			.request("model.clampThinking", {
				provider: currentModel.provider,
				id: currentModel.id,
				level: thinkingLevel,
			})
			.then((clamped) => {
				if (cancelled || clamped.level === thinkingLevel) return;
				pairSelection.current += 1;
				useAppStore.getState().setThinkingLevel(sessionId, clamped.level);
				return requestLevel(clamped.level, thinkingLevel);
			})
			.catch(() => {});
		return () => {
			cancelled = true;
		};
	}, [currentModel, thinkingLevel, sessionId, requestLevel]);

	const onSelectThinking = (level: ThinkingLevel) => {
		if (level === thinkingLevel) return;
		pairSelection.current += 1;
		useAppStore.getState().setThinkingLevel(sessionId, level);
		void requestLevel(level, thinkingLevel);
	};

	const onSelectModel = ({ model, level }: ModelSelection) => {
		if (sameModel(model, currentModel)) {
			if (level) onSelectThinking(level);
			return;
		}
		const previous = { model: sessionModel, level: thinkingLevel };
		const selection = ++pairSelection.current;
		const superseded = () => selection !== pairSelection.current;
		useAppStore.getState().setCurrentModel(sessionId, model);
		if (level) useAppStore.getState().setThinkingLevel(sessionId, level);
		getTransport()
			.request("session.setModel", { sessionId, model })
			.then(
				() => (level && !superseded() ? requestLevel(level, previous.level) : undefined),
				(error: unknown) => {
					if (sameModel(liveRuntime()?.model, model)) {
						if (previous.model) useAppStore.getState().setCurrentModel(sessionId, previous.model);
						if (level && !superseded()) {
							useAppStore.getState().setThinkingLevel(sessionId, previous.level);
						}
					}
					toast.error(errorText(error), `Couldn't switch to ${model.name}`);
				},
			)
			.then(() => refreshStats());
	};

	const restoreTextToDraft = (text: string) => {
		if (!text.trim()) return;
		const current = useAppStore.getState().sessions[sessionId]?.draft ?? "";
		const combined = [text, current].filter((t) => t.trim()).join("\n\n");
		useAppStore.getState().setChatDraft(sessionId, combined);
		composerRef.current?.refocus();
	};

	const restoreQueueContentToDraft = (content: SessionQueueContent): void => {
		const messages = [...content.steering, ...content.followUp];
		restoreTextToDraft(messages.map((message) => message.text).join("\n\n"));
		const images = messages.flatMap((message) => message.images ?? []);
		composerRef.current?.restoreAttachments(
			images.map((image, index) => ({
				name: `queued-image-${index + 1}`,
				content: image,
			})),
		);
	};

	const drainQueueToDraft = async (): Promise<void> => {
		const content = await getTransport().request("session.clearQueue", {
			sessionId,
			requireTextOnly: true,
		});
		restoreQueueContentToDraft(content);
	};

	const performCompact = (instructions?: string) => {
		const observedTurnIds = selectCompactionTurnIds(useAppStore.getState(), sessionId);
		void drainQueueToDraft()
			.then(() =>
				getTransport().request("session.compact", {
					sessionId,
					...(instructions ? { instructions } : {}),
				}),
			)
			.catch((err) =>
				useAppStore
					.getState()
					.appendCompactionFailureUnlessObserved(sessionId, observedTurnIds, errorText(err)),
			);
	};

	const performRename = (title: string) => {
		void getTransport()
			.request("session.rename", { workspaceId, sessionId, title })
			.catch((err) => useAppStore.getState().appendErrorTurn(sessionId, errorText(err)));
	};

	const performSend = (
		text: string,
		attachments: ChatAttachment[],
		behavior: Exclude<SubmitBehavior, "interrupt">,
	) => {
		const queued = behavior !== "send";
		if (!queued && (text || attachments.length > 0)) {
			armImmediateTurn();
			useAppStore.getState().appendUserMessage(sessionId, text, attachments);
		}
		const images = attachments.map((a) => a.content);
		const params = { sessionId, text, ...(images.length > 0 ? { images } : {}) };
		const method =
			behavior === "steer"
				? "session.steer"
				: behavior === "followUp"
					? "session.followUp"
					: "session.prompt";
		getTransport()
			.request(method, params)
			.catch((err) => {
				useAppStore.getState().appendErrorTurn(sessionId, errorText(err));
				if (queued) restoreTextToDraft(text);
				else {
					const streaming = useAppStore.getState().sessions[sessionId]?.isStreaming ?? false;
					cancelImmediateTurn(streaming);
				}
			});
	};

	const onSubmit = (
		text: string,
		attachments: ChatAttachment[],
		behavior: SubmitBehavior,
	): ComposerSubmitDisposition => {
		const nativeCommand = parseNativeChatCommand(text, canRenameChat);
		if (nativeCommand?.kind === "compact") {
			const submissionError = compactSubmissionError(
				attachments.length > 0,
				queue.hasImages === true,
			);
			if (submissionError) return { accepted: false, reason: submissionError };
			performCompact(nativeCommand.instructions);
			return { accepted: true };
		}
		if (nativeCommand?.kind === "name") {
			const prepared = prepareNameChatCommand(nativeCommand.title, attachments.length > 0);
			if ("reason" in prepared) return { accepted: false, reason: prepared.reason };
			performRename(prepared.title);
			return { accepted: true };
		}
		if (behavior !== "interrupt") {
			performSend(text, attachments, behavior);
			return { accepted: true };
		}
		getTransport()
			.request("session.abort", { sessionId })
			.then(() => performSend(text, attachments, "send"))
			.catch((err) => {
				useAppStore.getState().appendErrorTurn(sessionId, errorText(err));
				restoreTextToDraft(text);
			});
		return { accepted: true };
	};

	const removeQueued = (kind: QueueLane, index: number) =>
		getTransport().request("session.removeQueued", { sessionId, kind, index });

	const onEditQueued = (kind: QueueLane, index: number) =>
		void removeQueued(kind, index)
			.then(({ removed }) => {
				if (removed === null) return;
				restoreQueueContentToDraft({ steering: [removed], followUp: [] });
			})
			.catch(() => {});

	const onRemoveQueued = (kind: QueueLane, index: number) =>
		void removeQueued(kind, index).catch(() => {});

	const onAbort = () => {
		void getTransport()
			.request("session.abort", { sessionId, restoreQueue: true })
			.then(({ restoredQueue }) => {
				if (restoredQueue) restoreQueueContentToDraft(restoredQueue);
			})
			.catch(() => {});
	};

	const onHistoryOpen = () => openOverlay(draft);

	const onManageTemplates = () => useAppStore.getState().openSettings(SettingsSection.Templates);

	const onDismissHistory = () => {
		closeHistory();
		composerRef.current?.refocus();
	};

	const onInsertHit = (hit: PromptHit) => {
		composerRef.current?.insertText(hit.text);
		closeHistory();
	};

	const onInsertAndSendHit = (hit: PromptHit) => {
		composerRef.current?.insertAndSubmit(hit.text, isStreaming ? "followUp" : "send");
		closeHistory();
	};

	const onSaveAsTemplateHit = (hit: PromptHit) => {
		closeHistory();
		setSaveAsTemplateHit(hit);
	};

	const onDeleteHistoryChat = async (targetWorkspaceId: string, targetSessionId: string) => {
		try {
			await getTransport().request("session.delete", {
				workspaceId: targetWorkspaceId,
				sessionId: targetSessionId,
			});
			closeHistory();
			useAppStore.getState().deleteChat(targetWorkspaceId, targetSessionId);
		} catch (err) {
			toast.error(errorText(err), "Couldn't delete the chat");
		}
	};

	const loadTemplate = useCallback(
		(name: string) => getTransport().request("template.get", { workspaceId, name }),
		[workspaceId],
	);
	const applyTemplate = useCallback(
		(template: ParsedTemplate) => composerRef.current?.insertTemplate(template),
		[],
	);
	const { pending: templatePending, pick: onPickTemplate } = useTemplateCommandPicker({
		draft,
		contextKey: `${workspaceId}:${sessionId}`,
		load: loadTemplate,
		onApply: applyTemplate,
	});

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
			toast.error("couldn't locate the message — the session may have changed");
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
				else if (result === "missing")
					toast.error("couldn't locate the message — the session may have changed");
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

	const historyOpenRequest = useAppStore((s) => s.historyOpenRequest);
	const historyOverlayOpen = historyState.open;
	useEffect(() => {
		if (historyOpenRequest?.sessionId !== sessionId) return;
		if (useAppStore.getState().historyOpenRequest !== historyOpenRequest) return;
		useAppStore.getState().clearHistoryOpen();
		if (historyOverlayOpen) cycleScope();
		else composerRef.current?.openHistory();
	}, [historyOpenRequest, sessionId, historyOverlayOpen, cycleScope]);

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
			useAppStore.getState().requestToolView(workspaceId, tool);
		},
		[workspaceId],
	);

	const askStates = useMemo(
		() => deriveAskStates(runtime.turns, runtime.askAnswers, runtime.toolResults),
		[runtime.turns, runtime.askAnswers, runtime.toolResults],
	);
	const askContext = useMemo(
		() => ({ states: askStates, focusScope: askFocusScope }),
		[askStates, askFocusScope],
	);

	const planGlanceState = useMemo(
		() => hostSessionGlance(runtime.hostState, planGlance(isStreaming, askStates)),
		[askStates, isStreaming, runtime.hostState],
	);

	const chatActions = useMemo<ChatActions>(
		() => ({
			answerQuestion: (toolCallId: string, result: AskUserQuestionResult) =>
				getTransport()
					.request("session.answerQuestion", { sessionId, toolCallId, result })
					.then(() => undefined),
			cancelAutomaticReveal,
			focusComposer: () => composerRef.current?.refocus(),
			openSubagentTranscript: setTranscriptChildId,
			revealChatElement: revealElement,
		}),
		[cancelAutomaticReveal, revealElement, sessionId, setTranscriptChildId],
	);

	const onExtUiReply = (value: string | boolean | null) => {
		if (!pendingExtUi) return;
		const id = pendingExtUi.id;
		useAppStore.getState().clearPendingExtUi(sessionId, id);
		getTransport()
			.request("session.extUiReply", { response: { id, value } })
			.catch(() => {});
	};

	const widgetEntries = Object.entries(extUiWidget);

	return (
		<ChatActionsContext.Provider value={chatActions}>
			<AskStatesContext.Provider value={askContext}>
				<div
					ref={chatViewRef}
					onPointerDownCapture={(event) => {
						const target = event.target;
						if (target instanceof Element && target.closest('[data-testid="history-overlay"]'))
							return;
						useAppStore.getState().noteDirectChatActivation(sessionId);
					}}
					data-testid="chat-view"
					data-line-width-bounded={chatLineWidthBounded}
					data-message-order={chatMessageOrder}
					className="flex h-full min-h-0 min-w-0 flex-col bg-container-workspace-bg [container-type:size]"
				>
					<Popover open={planOpen} onOpenChange={setPlanOpen}>
						<PopoverAnchor asChild>
							<div className="shrink-0">
								<ChatHeader
									resources={
										resources.visible ? (
											<ResourcesButton
												ref={resourcesTrigger}
												activeCount={resources.authoritative ? resources.groups.activeCount : null}
												open={inspectorOpen}
												onClick={() => setInspectorOpen(!inspectorOpen)}
											/>
										) : null
									}
									stats={stats}
									statusEntries={Object.entries(extUiStatus)}
									left={
										plan.data ? (
											<PopoverTrigger asChild>
												<button
													type="button"
													data-testid="chat-plan-toggle"
													data-open={planOpen}
													className="flex min-w-0 max-w-full items-center gap-4 overflow-clip whitespace-nowrap text-text-muted tr-text-metadata hover:text-text-default"
												>
													<ChatPlanStripContent
														plan={plan}
														open={planOpen}
														glance={planGlanceState}
													/>
												</button>
											</PopoverTrigger>
										) : null
									}
									skillsStale={skillsStale}
									{...(projectId ? { onOpenSkills: () => setSkillsOpen(true) } : {})}
								/>
							</div>
						</PopoverAnchor>
						<ChatPlanContent plan={plan} glance={planGlanceState} />
					</Popover>
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
														if (element && !historyState.open) {
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
											"rounded-[var(--radius-sm)] px-12 py-4 transition-colors data-[flash]:bg-primary-subtle",
										)}
									>
										<FoldGeometryProvider onBeforeChange={prepareFoldChange}>
											<ChatTurnView
												row={row}
												workspaceRoot={workspaceRoot}
												onOpenFile={onOpenFile}
												agentResponded={messageActions.agentRespondedByUserId.get(row.id) ?? false}
												isFinalAnswer={messageActions.finalAnswerRowIds.has(row.id)}
												onOpenSpec={onOpenSpec}
												onOpenChange={onOpenChange}
												onReveal={onReveal}
												onTryAgain={() => performSend(TRY_AGAIN_PROMPT, [], "send")}
												stillRunning={row.id === latestDividerRowId ? stillRunning : undefined}
											/>
										</FoldGeometryProvider>
										{chatMessageOrder === "newest-first" &&
										runwayActive &&
										index === firstItemIndex ? (
											<div ref={streamEdgeRef} data-testid="chat-stream-edge" className="h-0" />
										) : null}
									</div>
								)}
							/>
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
							<button
								type="button"
								data-testid={
									chatMessageOrder === "newest-first" ? "scroll-to-top" : "scroll-to-bottom"
								}
								onClick={scrollToLatest}
								className="-translate-x-1/2 absolute bottom-12 left-1/2 flex items-center gap-4 rounded-[var(--radius-sm)] border border-border-default bg-container-elevated-bg px-8 py-4 text-text-muted tr-text-metadata shadow-[var(--shadow-md)] hover:bg-control-bg-hovered hover:text-text-default"
							>
								{chatMessageOrder === "newest-first" ? (
									<ArrowUp className="size-12" />
								) : (
									<ArrowDown className="size-12" />
								)}
								{scrollButtonLabel}
							</button>
						) : null}
						{resources.visible ? (
							<ResourcesInspector
								open={inspectorOpen}
								onOpenChange={setInspectorOpen}
								onCloseAutoFocus={returnToResources}
								{...resources.groups}
								now={now}
								authoritative={resources.authoritative}
								loading={resources.loading}
								stale={resources.stale}
								error={resources.projection?.error ?? null}
								actions={resources.actions}
								selectedId={inspectorSelectedId}
								onSelect={selectResource}
								onRetry={resources.retry}
								onStopCommand={resources.stopCommand}
								onStopSubagent={resources.stopSubagent}
								onStopAll={() => setStopAllOpen(true)}
								detail={
									selectedCommandId ? (
										<CommandLogView {...commandLog} onRetry={commandLog.retry} />
									) : selectedSubagentId ? (
										<SubagentTranscriptPane
											key={selectedSubagentId}
											workspaceId={workspaceId}
											parentSessionId={sessionId}
											childSessionId={selectedSubagentId}
										/>
									) : null
								}
							/>
						) : null}
					</div>
					{widgetEntries.length > 0 ? (
						<div className="shrink-0 border-border-default border-t bg-container-elevated-bg px-12 py-4 text-text-muted tr-text-metadata">
							{widgetEntries.map(([key, lines]) => (
								<div key={key}>{lines.join(" ")}</div>
							))}
						</div>
					) : null}
					<QueueStrip queue={queue} onEdit={onEditQueued} onRemove={onRemoveQueued} />
					{resources.visible && !inspectorOpen ? (
						<ResourcesDock
							commands={resources.groups.commands}
							subagents={resources.groups.subagents}
							now={now}
							authoritative={resources.authoritative}
							actions={resources.actions}
							onInspect={openInspector}
							onStopCommand={resources.stopCommand}
							onStopSubagent={resources.stopSubagent}
						/>
					) : null}
					<div className="relative shrink-0">
						<HistoryOverlay
							state={historyState}
							workspaceNames={workspaceNames}
							onQueryChange={setQuery}
							onSetScope={setScope}
							onToggleStage={toggleStage}
							onMoveSelection={moveSelection}
							onClose={onDismissHistory}
							onInsert={onInsertHit}
							onInsertAndSend={onInsertAndSendHit}
							onOpenMessage={openMessage}
							onSaveAsTemplate={onSaveAsTemplateHit}
							onDeleteChat={(wsId, id) => void onDeleteHistoryChat(wsId, id)}
						/>
						<Composer
							ref={composerRef}
							value={draft}
							onChange={(v) => useAppStore.getState().setChatDraft(sessionId, v)}
							isStreaming={isStreaming}
							growthLimit={composerGrowthLimit}
							commands={mergedCommands}
							templatePending={templatePending}
							mentionCandidates={mentionCandidates}
							recentPrompts={recentPrompts}
							models={models}
							modelsRefreshing={modelsRefreshing}
							onRefreshModels={onRefreshModels}
							currentModel={currentModel}
							thinkingLevel={thinkingLevel}
							modelPreferences={modelPreferences}
							onMentionQuery={onMentionQuery}
							onSlashActive={setSlashActive}
							onSelectModel={onSelectModel}
							onSelectThinking={onSelectThinking}
							onSubmit={onSubmit}
							onAbort={onAbort}
							onHistoryOpen={onHistoryOpen}
							onPickTemplate={onPickTemplate}
							onManageTemplates={onManageTemplates}
							templatesEmpty={templatesEmpty}
						/>
					</div>
					<TemplateEditorDialog
						open={saveAsTemplateHit != null}
						onOpenChange={(open) => {
							if (!open) setSaveAsTemplateHit(null);
						}}
						workspaceId={workspaceId}
						initialBody={saveAsTemplateHit?.text ?? ""}
					/>
					{pendingExtUi ? (
						<ExtUiDialog key={pendingExtUi.id} request={pendingExtUi} onReply={onExtUiReply} />
					) : null}
					<Dialog open={stopAllOpen} onOpenChange={setStopAllOpen}>
						<DialogContent onCloseAutoFocus={returnToResources}>
							<DialogTitle>Stop all subagents?</DialogTitle>
							<DialogDescription>
								Stop {resources.groups.subagents.length} active subagents in this chat? The main
								chat and future delegation are unaffected.
							</DialogDescription>
							<DialogFooter>
								<Button variant="ghost" onClick={() => setStopAllOpen(false)}>
									Cancel
								</Button>
								<Button
									data-testid="resources-stop-all-confirm"
									disabled={
										!resources.authoritative ||
										resources.groups.subagents.length === 0 ||
										resources.actions.all?.pending
									}
									onClick={() => {
										resources.stopAll();
										setStopAllOpen(false);
									}}
								>
									Stop {resources.groups.subagents.length} subagents
								</Button>
							</DialogFooter>
						</DialogContent>
					</Dialog>
					{transcriptChildId ? (
						<SubagentTranscriptDialog
							key={`${workspaceId}:${sessionId}:${transcriptChildId}`}
							workspaceId={workspaceId}
							parentSessionId={sessionId}
							childSessionId={transcriptChildId}
							onOpenChange={(open) => {
								if (!open) setTranscriptChildId(null);
							}}
						/>
					) : null}
					{projectId ? (
						<SkillsDialog
							projectId={projectId}
							workspace={{
								workspaceId,
								sessionId,
								streaming: isStreaming,
								stale: skillsStale,
								onReloaded: (syncedTick) =>
									useAppStore.getState().markSkillsSynced(sessionId, syncedTick),
							}}
							open={skillsOpen}
							onOpenChange={setSkillsOpen}
						/>
					) : null}
				</div>
			</AskStatesContext.Provider>
		</ChatActionsContext.Provider>
	);
}
