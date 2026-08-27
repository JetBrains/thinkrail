import type {
	AppConfig,
	AskUserQuestionResult,
	ComposerGrowthLimit,
	ExtUiRequest,
	GitDiffScope,
	HostPlatform,
	LayoutAuxiliaryRegion,
	LayoutPreset,
	LayoutToolId,
	LoginFrame,
	LoginPush,
	PiEvent,
	Project,
	RefreshedModels,
	ReviewChangedPayload,
	ReviewSnapshot,
	SessionEventPayload,
	SessionQueueState,
	SessionStats,
	SessionSummary,
	SlashCommandInfo,
	SpecGraphNode,
	TerminalTabInfo,
	ThemeId,
	ThinkingLevel,
	UserMessage,
	WireModel,
	Workspace,
	WorkspaceFsChangedPayload,
	WorkspaceLayoutDocument,
} from "@thinkrail/contracts";
import {
	customMessageText,
	DEFAULT_CONFIG,
	isAskUserAnswersMessage,
	isControlMessage,
	isSubagentCompletionMessage,
} from "@thinkrail/contracts";
import { create } from "zustand";
import type { LoginState } from "../auth";
import { assistantFailureText } from "../chat/assistantFailure";
import type { HydratedRuntime } from "../chat/hydrate";
import type {
	ChatAttachment,
	ChatTurn,
	CompactionState,
	ExtUiDialogRequest,
	ToolResultState,
} from "../chat/types";
import {
	type LayoutAttention,
	layoutResourceIdentity,
	matchesSkillInvocationCommand,
	parseSkillInvocation,
	randomId,
	readLayoutNavigationClock,
	shallowEqualArrays,
	tupleKey,
	userText,
} from "../lib";
import type { WorkbenchFrame, WorkspaceViewState } from "../shell/layout";
import type { ConnectionStatus } from "../transport";
import {
	type HistoryTarget,
	selectActiveWorkspaceProjectId,
	selectLayoutResourcePlacement,
	selectWorkspaceById,
	selectWorkspaceNavTick,
	selectWorkspaceSessionIds,
	selectWorkspaceTick,
} from "./selectors";

export interface FileTab {
	kind: "file";
	id: string;
	workspaceId: string;
	name: string;
	path: string;
	content: string;
	view?: "rendered" | "source";
	loadedTick?: number;
}
export interface ChatTab {
	kind: "chat";
	id: string;
	workspaceId: string;
	name: string;
	sessionId: string;
}
export interface DocTab {
	kind: "doc";
	id: string;
	workspaceId: string;
	name: string;
	content: string;
	docPath: string;
	sourceId: string;
}
export type DiffTabView = "split" | "inline";
export interface DiffTab {
	kind: "diff";
	id: string;
	workspaceId: string;
	name: string;
	path: string;
	scope: GitDiffScope;
	loadedTarget: string;
	original: string;
	modified: string;
	view?: DiffTabView;
	rendered?: boolean;
	ignoreWhitespace?: boolean;
	loadedTick?: number;
}
export interface PlanTab {
	kind: "plan";
	id: string;
	workspaceId: string;
	name: string;
	sessionId: string;
}
export type EditorTab = FileTab | ChatTab | DocTab | DiffTab | PlanTab;

export function chatTabId(workspaceId: string, sessionId: string): string {
	return tupleKey("chat", workspaceId, sessionId);
}

function editorResourceIdentity(tab: EditorTab): string {
	if (tab.kind === "doc") {
		return tupleKey("layout-resource", "document", "todo-plan", tab.sourceId);
	}
	if (tab.kind === "plan") {
		return tupleKey("layout-resource", "document", "todo-plan", tab.sessionId);
	}
	return layoutResourceIdentity(tab);
}

function editorSessionId(tab: EditorTab): string | null {
	if (tab.kind === "chat" || tab.kind === "plan") return tab.sessionId;
	return tab.kind === "doc" ? tab.sourceId : null;
}

function availableEditorTabId(tabs: readonly EditorTab[], tab: EditorTab): string {
	const identity = editorResourceIdentity(tab);
	const existing = tabs.find((candidate) => editorResourceIdentity(candidate) === identity);
	if (existing) return existing.id;
	if (!tabs.some((candidate) => candidate.id === tab.id)) return tab.id;
	let fallback = randomId("editor-cache");
	while (tabs.some((candidate) => candidate.id === fallback)) fallback = randomId("editor-cache");
	return fallback;
}

export type TabIntent = "preview" | "keep";

export interface LocalLayoutPreferences {
	defaultPresetId: string;
	maxSideGroups: number;
	maxBottomGroups: number;
}

export const DEFAULT_LOCAL_LAYOUT_PREFERENCES: LocalLayoutPreferences = {
	defaultPresetId: "balanced",
	maxSideGroups: 6,
	maxBottomGroups: 3,
};

export interface LocalLayoutStatePayload {
	frame: WorkbenchFrame;
	viewsByWorkspace: Record<string, WorkspaceViewState>;
	documentsByWorkspace: Record<string, WorkspaceLayoutDocument>;
	attentionByWorkspace: Record<string, LayoutAttention>;
	preferences: LocalLayoutPreferences;
	legacyImportAttempted: Record<string, true>;
}

export interface CenterNavigationStamp {
	groupId: string;
	clock: number;
}

export interface RouteChatTarget {
	workspaceId: string;
	sessionId: string;
	navTick: number;
	navigation: CenterNavigationStamp | null;
	validated: boolean;
}

export interface LayoutOpenOptions {
	targetGroupId?: string;
	activate?: boolean;
	navigation?: CenterNavigationStamp | null;
	countNavigation?: boolean;
	claimPreview?: boolean;
}

export type LayoutIntent =
	| {
			id: string;
			kind: "open";
			workspaceId: string;
			tab: EditorTab;
			intent: TabIntent;
			targetGroupId?: string;
			activate?: boolean;
			claimPreview?: boolean;
			navigation?: CenterNavigationStamp | null;
			countNavigation?: boolean;
	  }
	| { id: string; kind: "close"; workspaceId: string; tabId: string }
	| {
			id: string;
			kind: "select";
			workspaceId: string;
			tabId: string;
			resource?: EditorTab;
			keep?: boolean;
			focus?: boolean;
			historyRequestId?: string;
			navigation?: CenterNavigationStamp | null;
			countNavigation?: boolean;
	  }
	| { id: string; kind: "reveal-tool"; workspaceId: string; tool: LayoutToolId }
	| { id: string; kind: "remove-session"; workspaceId: string; sessionId: string }
	| {
			id: string;
			kind: "place-terminal";
			workspaceId: string;
			tabKey: string;
			title: string;
			targetGroupId?: string;
			targetArea?: "center" | LayoutAuxiliaryRegion;
			reveal?: false;
			navigation?: CenterNavigationStamp | null;
			countNavigation?: boolean;
	  }
	| { id: string; kind: "close-terminal"; workspaceId: string; tabKey: string }
	| { id: string; kind: "select-terminal"; workspaceId: string; tabKey: string }
	| { id: string; kind: "toggle-side"; workspaceId: string; side: "left" | "right" }
	| { id: string; kind: "toggle-bottom"; workspaceId: string };
export type LayoutIntentInput = LayoutIntent extends infer Intent
	? Intent extends { id: string }
		? Omit<Intent, "id">
		: never
	: never;

export const SettingsSection = {
	Providers: "providers",
	Github: "github",
	Appearance: "appearance",
	Chat: "chat",
	Layout: "layout",
	Terminal: "terminal",
	Templates: "templates",
	Review: "review",
	Privacy: "privacy",
} as const;
export type SettingsSection = (typeof SettingsSection)[keyof typeof SettingsSection];

export interface Toast {
	id: string;
	variant: "error" | "success" | "info";
	message: string;
	title?: string;
}

const MAX_TOASTS = 5;

export interface TerminalTab {
	tabKey: string;
	workspaceId: string;
	title: string;
	initialCommand?: string;
	reservationPending?: true;
}

export interface ClosedChat {
	sessionId: string;
	title: string;
	closedAt: number;
}

export interface ChatLocationRequest {
	workspaceId: string;
	projectId: string;
	sessionId: string;
	messageIndex: number;
	anchorText: string;
	navigation?: CenterNavigationStamp | null;
}

export interface SessionRuntime {
	turns: ChatTurn[];
	turnIdByMessageIndex?: (string | null)[];
	toolResults: Record<string, ToolResultState>;
	askAnswers: Record<string, AskUserQuestionResult>;
	currentAssistantId: string | null;
	attemptAssistantId: string | null;
	isStreaming: boolean;
	queue: SessionQueueState;
	model: WireModel | null;
	thinkingLevel: ThinkingLevel;
	eventRevision: number;
	syncedConnectionGeneration: number;
	stats: SessionStats | null;
	commands: SlashCommandInfo[];
	draft: string;
	pendingExtUi: ExtUiDialogRequest | null;
	extUiQueue: ExtUiDialogRequest[];
	extUiStatus: Record<string, string>;
	extUiWidget: Record<string, string[]>;
}

const EMPTY_QUEUE: SessionQueueState = { steering: [], followUp: [] };

function newRuntime(
	model: WireModel | null,
	thinkingLevel: ThinkingLevel,
	syncedConnectionGeneration = 0,
): SessionRuntime {
	return {
		turns: [],
		toolResults: {},
		askAnswers: {},
		currentAssistantId: null,
		attemptAssistantId: null,
		isStreaming: false,
		queue: EMPTY_QUEUE,
		model,
		thinkingLevel,
		eventRevision: 0,
		syncedConnectionGeneration,
		stats: null,
		commands: [],
		draft: "",
		pendingExtUi: null,
		extUiQueue: [],
		extUiStatus: {},
		extUiWidget: {},
	};
}

export const EMPTY_RUNTIME: SessionRuntime = newRuntime(null, "medium");

function clearTurnStreaming(turns: ChatTurn[]): ChatTurn[] {
	if (!turns.some((t) => t.kind === "assistant" && t.streaming)) return turns;
	return turns.map((t) => (t.kind === "assistant" && t.streaming ? { ...t, streaming: false } : t));
}

function consumeFailureRecoveries(turns: ChatTurn[]): ChatTurn[] {
	if (!turns.some((turn) => turn.kind === "error" && turn.recovery)) return turns;
	return turns.map((turn) => {
		if (turn.kind !== "error" || !turn.recovery) return turn;
		const { recovery, ...rest } = turn;
		return rest;
	});
}

function removeSupersededAssistant(
	turns: ChatTurn[],
	attemptAssistantId: string | null,
): ChatTurn[] {
	if (!attemptAssistantId) return turns;
	const index = turns.findIndex(
		(turn) =>
			turn.id === attemptAssistantId &&
			turn.kind === "assistant" &&
			assistantFailureText(turn.message) !== null,
	);
	return index < 0 ? turns : [...turns.slice(0, index), ...turns.slice(index + 1)];
}

function compactionOutcome(event: Extract<PiEvent, { type: "compaction_end" }>): CompactionState {
	if (event.aborted) return { status: "cancelled" };
	if (event.errorMessage) return { status: "failed", detail: event.errorMessage };
	const tokensBefore = event.result?.tokensBefore;
	const tokensAfter = event.result?.estimatedTokensAfter;
	return {
		status: "done",
		...(typeof tokensBefore === "number" ? { tokensBefore } : {}),
		...(typeof tokensAfter === "number" ? { tokensAfter } : {}),
		...(event.willRetry ? { resuming: true } : {}),
	};
}

function clearCompactionResuming(turns: ChatTurn[]): ChatTurn[] {
	if (!turns.some((t) => t.kind === "compaction" && t.resuming)) return turns;
	return turns.map((t) => {
		if (t.kind !== "compaction" || !t.resuming) return t;
		const { resuming, ...rest } = t;
		return rest;
	});
}

function settleCompactionTurn(
	turns: ChatTurn[],
	event: Extract<PiEvent, { type: "compaction_end" }>,
): ChatTurn[] {
	const outcome = compactionOutcome(event);
	const index = turns.findLastIndex((t) => t.kind === "compaction" && t.status === "running");
	if (index < 0) return [...turns, { kind: "compaction", id: crypto.randomUUID(), ...outcome }];
	return turns.map((t, i) => (i === index ? { kind: "compaction", id: t.id, ...outcome } : t));
}

function reconcileCompactionTurns(
	current: ChatTurn[],
	hydrated: ChatTurn[],
	isStreaming: boolean,
): ChatTurn[] {
	const live = current.findLast(
		(turn) => turn.kind === "compaction" && turn.status === "done" && turn.summary === undefined,
	);
	if (live?.kind !== "compaction") return hydrated;
	const index = hydrated.findLastIndex(
		(turn) =>
			turn.kind === "compaction" &&
			turn.summary !== undefined &&
			(live.tokensBefore === undefined || turn.tokensBefore === live.tokensBefore),
	);
	if (index < 0) return hydrated;
	return hydrated.map((turn, turnIndex) =>
		turnIndex === index && turn.kind === "compaction"
			? {
					...turn,
					id: live.id,
					...(live.tokensAfter !== undefined ? { tokensAfter: live.tokensAfter } : {}),
					...(isStreaming && live.resuming ? { resuming: true as const } : {}),
				}
			: turn,
	);
}

type RetrySource = Extract<ChatTurn, { kind: "retry" }>["source"];

function appendRetryTurn(
	rt: SessionRuntime,
	source: RetrySource,
	event: { attempt: number; maxAttempts: number; delayMs: number },
): SessionRuntime {
	return {
		...rt,
		turns: [
			...rt.turns.filter((t) => !(t.kind === "retry" && t.source === source)),
			{
				kind: "retry",
				id: crypto.randomUUID(),
				source,
				attempt: event.attempt,
				maxAttempts: event.maxAttempts,
				delayMs: event.delayMs,
			},
		],
	};
}

function clearRetryTurns(rt: SessionRuntime, source: RetrySource): SessionRuntime {
	return rt.turns.some((t) => t.kind === "retry" && t.source === source)
		? { ...rt, turns: rt.turns.filter((t) => !(t.kind === "retry" && t.source === source)) }
		: rt;
}

export function reduceSessionEvent(rt: SessionRuntime, event: PiEvent): SessionRuntime {
	switch (event.type) {
		case "agent_start":
			return {
				...rt,
				turns: consumeFailureRecoveries(rt.turns),
				isStreaming: true,
				attemptAssistantId: null,
			};
		case "queue_update":
			return {
				...rt,
				queue: {
					steering: event.steering,
					followUp: event.followUp,
					...(event.hasImages ? { hasImages: true as const } : {}),
				},
			};
		case "message_start": {
			if (event.message.role === "assistant")
				return {
					...rt,
					currentAssistantId: crypto.randomUUID(),
					attemptAssistantId: null,
					turns: clearTurnStreaming(rt.turns),
				};
			if (event.message.role === "user") {
				const message = event.message as UserMessage;
				const text = userText(message.content);
				if (isControlMessage(text)) return rt;
				const last = rt.turns[rt.turns.length - 1];
				if (last?.kind === "user") {
					const optimisticText = userText(last.message.content);
					if (optimisticText === text) return rt;
					const invocation = parseSkillInvocation(text);
					if (invocation && matchesSkillInvocationCommand(optimisticText, invocation)) {
						return {
							...rt,
							turns: [...rt.turns.slice(0, -1), { kind: "user", id: last.id, message }],
						};
					}
				}
				return {
					...rt,
					turns: [...rt.turns, { kind: "user", id: crypto.randomUUID(), message }],
				};
			}
			return rt;
		}
		case "message_update": {
			const ame = event.assistantMessageEvent;
			const snapshot =
				"partial" in ame
					? ame.partial
					: ame.type === "done"
						? ame.message
						: ame.type === "error"
							? ame.error
							: null;
			if (!snapshot) return rt;
			const id = rt.currentAssistantId ?? crypto.randomUUID();
			const streaming = !(ame.type === "done" || ame.type === "error");
			const turn: ChatTurn = { kind: "assistant", id, message: snapshot, streaming };
			return {
				...rt,
				currentAssistantId: streaming ? id : null,
				attemptAssistantId: streaming ? rt.attemptAssistantId : id,
				turns: rt.turns.some((t) => t.id === id)
					? rt.turns.map((t) => (t.id === id ? turn : t))
					: [...rt.turns, turn],
			};
		}
		case "message_end": {
			if (isAskUserAnswersMessage(event.message)) {
				const { toolCallId, result } = event.message.details;
				return { ...rt, askAnswers: { ...rt.askAnswers, [toolCallId]: result } };
			}
			if (isSubagentCompletionMessage(event.message)) {
				return {
					...rt,
					turns: [
						...rt.turns,
						{
							kind: "subagentCompletion",
							id: crypto.randomUUID(),
							details: event.message.details,
							text: customMessageText(event.message.content),
						},
					],
				};
			}
			if (event.message.role !== "assistant" || !rt.currentAssistantId) return rt;
			const id = rt.currentAssistantId;
			const turn: ChatTurn = { kind: "assistant", id, message: event.message, streaming: false };
			return {
				...rt,
				currentAssistantId: null,
				attemptAssistantId: id,
				turns: rt.turns.some((t) => t.id === id)
					? rt.turns.map((t) => (t.id === id ? turn : t))
					: [...rt.turns, turn],
			};
		}
		case "tool_execution_start":
			return {
				...rt,
				toolResults: {
					...rt.toolResults,
					[event.toolCallId]: { status: "running", raw: undefined },
				},
			};
		case "tool_execution_update":
			return {
				...rt,
				toolResults: {
					...rt.toolResults,
					[event.toolCallId]: { status: "running", raw: event.partialResult },
				},
			};
		case "tool_execution_end":
			return {
				...rt,
				toolResults: {
					...rt.toolResults,
					[event.toolCallId]: { status: event.isError ? "error" : "done", raw: event.result },
				},
			};
		case "agent_end":
			return rt;
		case "agent_settled": {
			const failure = assistantFailureText(event.terminal);
			const closer: ChatTurn = failure
				? {
						kind: "error",
						id: crypto.randomUUID(),
						text: failure,
						recovery: "try-again",
					}
				: { kind: "system", id: crypto.randomUUID(), text: "✓ Done", endedAt: Date.now() };
			return {
				...rt,
				turns: [
					...clearCompactionResuming(clearTurnStreaming(rt.turns)).filter(
						(turn) => turn.kind !== "retry",
					),
					closer,
				],
				isStreaming: false,
				currentAssistantId: null,
				attemptAssistantId: null,
			};
		}
		case "compaction_start":
			return {
				...rt,
				turns: [...rt.turns, { kind: "compaction", id: crypto.randomUUID(), status: "running" }],
			};
		case "compaction_end": {
			const settled = settleCompactionTurn(rt.turns, event);
			return event.reason === "overflow" && event.willRetry
				? {
						...rt,
						turns: removeSupersededAssistant(settled, rt.attemptAssistantId),
						attemptAssistantId: null,
					}
				: { ...rt, turns: settled };
		}
		case "auto_retry_start":
			return appendRetryTurn(
				{
					...rt,
					turns: removeSupersededAssistant(rt.turns, rt.attemptAssistantId),
					attemptAssistantId: null,
				},
				"turn",
				event,
			);
		case "auto_retry_end":
			return clearRetryTurns(rt, "turn");
		case "summarization_retry_scheduled":
			return appendRetryTurn(rt, "summarization", event);
		case "summarization_retry_finished":
			return clearRetryTurns(rt, "summarization");
		case "thinking_level_changed":
			return { ...rt, thinkingLevel: event.level };
		default:
			return rt;
	}
}

function reduceExtUi(
	rt: SessionRuntime,
	request: Exclude<ExtUiRequest, { kind: "setTitle" }>,
): SessionRuntime {
	switch (request.kind) {
		case "dismiss":
			if (rt.pendingExtUi?.id === request.id) {
				const [next, ...rest] = rt.extUiQueue;
				return { ...rt, pendingExtUi: next ?? null, extUiQueue: rest };
			}
			if (rt.extUiQueue.some((q) => q.id === request.id))
				return { ...rt, extUiQueue: rt.extUiQueue.filter((q) => q.id !== request.id) };
			return rt;
		case "select":
		case "confirm":
		case "input":
		case "editor":
			return rt.pendingExtUi
				? { ...rt, extUiQueue: [...rt.extUiQueue, request] }
				: { ...rt, pendingExtUi: request };
		case "notify": {
			const kind = request.level === "error" ? "error" : "system";
			return {
				...rt,
				turns: [...rt.turns, { kind, id: crypto.randomUUID(), text: request.message }],
			};
		}
		case "setStatus": {
			if (request.text === null)
				return { ...rt, extUiStatus: omitKey(rt.extUiStatus, request.key) };
			return { ...rt, extUiStatus: { ...rt.extUiStatus, [request.key]: request.text } };
		}
		case "setWidget": {
			if (request.content === null)
				return { ...rt, extUiWidget: omitKey(rt.extUiWidget, request.key) };
			return { ...rt, extUiWidget: { ...rt.extUiWidget, [request.key]: request.content } };
		}
		default:
			return rt;
	}
}

interface AppState {
	status: ConnectionStatus;
	connectionGeneration: number;
	welcomeGeneration: number;
	protocolVersion: number | null;
	hostPlatform: HostPlatform | null;
	projects: Project[];
	recentProjects: Project[];
	workspaces: Record<string, Workspace[]>;
	removedWorkspaceIds: Record<string, true>;
	expandedProjectIds: Record<string, true>;
	selectedProjectId: string | null;
	activeWorkspaceId: string | null;
	workspaceSelectionHistory: string[];
	routeChatTarget: RouteChatTarget | null;
	routeChatTargetGeneration: number;
	workbenchFrame: WorkbenchFrame | null;
	workspaceViewsByWorkspace: Record<string, WorkspaceViewState>;
	layoutStateReady: boolean;
	localLayoutPreferences: LocalLayoutPreferences;
	legacyLayoutImportAttempted: Record<string, true>;
	layoutDocumentsByWorkspace: Record<string, WorkspaceLayoutDocument>;
	layoutAttentionByWorkspace: Record<string, LayoutAttention>;
	layoutProjectionEpochByWorkspace: Record<string, number>;
	layoutIntents: LayoutIntent[];
	tabsByWorkspace: Record<string, EditorTab[]>;
	activeTabByWorkspace: Record<string, string | null>;
	previewTabByWorkspace: Record<string, string>;
	navTickByWorkspace: Record<string, number>;
	closedChatsByWorkspace: Record<string, ClosedChat[]>;
	deletedSessionsByWorkspace: Record<string, Record<string, true>>;
	terminalsByWorkspace: Record<string, TerminalTab[]>;
	activeTerminalByWorkspace: Record<string, string | null>;
	sessions: Record<string, SessionRuntime>;
	extUiOrphans: ExtUiRequest[];
	models: WireModel[];
	providerVersion: number;
	templatesVersion: number;
	modelsRefreshing: boolean;
	modelsFresh: boolean;
	changesRequest: {
		workspaceId: string;
		path: string;
		navTick: number;
		navigation: CenterNavigationStamp | null;
	} | null;
	chatLocationRequest: ChatLocationRequest | null;
	historyOpenRequest: { id: string; sessionId: string } | null;
	specRequest: {
		workspaceId: string;
		path: string;
		navigation: CenterNavigationStamp | null;
	} | null;
	specsByWorkspace: Record<string, SpecGraphNode[]>;
	reviewsByWorkspace: Record<string, ReviewSnapshot>;
	reviewFocusRequest: { workspaceId: string; commentId: string } | null;
	fsChangesByWorkspace: Record<string, { tick: number; paths: string[]; truncated: boolean }>;
	skillChangeTickByWorkspace: Record<string, number>;
	skillsSyncedTickBySession: Record<string, number>;
	activeLogin: LoginState | null;
	settingsOpen: boolean;
	settingsSection: SettingsSection;
	theme: ThemeId;
	analyticsEnabled: boolean;
	terminalReplayKb: number;
	composerGrowthLimit: ComposerGrowthLimit;
	reviewModel: WireModel | undefined;
	reviewEffort: ThinkingLevel | undefined;
	reviewAutoFix: boolean;
	customLayoutPresets: LayoutPreset[];
	toasts: Toast[];
	setStatus: (status: ConnectionStatus) => void;
	installWelcomeSnapshot: (
		protocolVersion: number,
		projects: Project[],
		recentProjects: Project[],
		config?: AppConfig,
		hostPlatform?: HostPlatform,
	) => void;
	installProjectSnapshot: (projects: Project[], recentProjects: Project[]) => void;
	applyProjectUpdated: (project: Project) => void;
	setWorkspaces: (projectId: string, workspaces: Workspace[]) => void;
	addWorkspace: (workspace: Workspace) => void;
	updateWorkspace: (workspace: Workspace) => void;
	removeWorkspace: (projectId: string, workspaceId: string) => void;
	applyWorkspaceRemoved: (projectId: string, workspaceId: string) => void;
	selectProject: (projectId: string, opts?: { reveal?: boolean }) => void;
	toggleProjectExpanded: (projectId: string) => void;
	expandProject: (projectId: string) => void;
	hydrateExpandedProjects: (projectIds: readonly string[]) => void;
	selectMain: () => void;
	activateWorkspace: (workspace: Pick<Workspace, "id" | "projectId">) => void;
	activateWorkspaceFromRoute: (
		workspace: Pick<Workspace, "id" | "projectId">,
		sessionId?: string,
	) => void;
	validateRouteChatTarget: (sessionId: string) => void;
	clearRouteChatTarget: () => void;
	hydrateLocalLayoutState: (payload: LocalLayoutStatePayload) => void;
	applyLocalLayoutState: (
		payload: LocalLayoutStatePayload,
		changedWorkspaceIds: readonly string[],
		invalidateProjection?: boolean,
	) => void;
	setLocalLayoutPreferences: (preferences: LocalLayoutPreferences) => void;
	setLayoutAttention: (workspaceId: string, attention: LayoutAttention) => void;
	syncLegacySelection: (
		workspaceId: string,
		selection: { kind: "editor"; tabId: string } | { kind: "terminal"; tabKey: string } | null,
	) => void;
	enqueueLayoutIntent: (intent: LayoutIntentInput) => string;
	consumeLayoutIntent: (id: string) => void;
	openTab: (
		tab: EditorTab,
		intent: TabIntent,
		syncLayout?: boolean,
		options?: LayoutOpenOptions,
	) => void;
	openDoc: (tab: DocTab | PlanTab) => void;
	closeTab: (
		id: string,
		syncLayout?: boolean,
		countNavigation?: boolean,
		workspaceId?: string,
	) => void;
	setActiveTab: (id: string, intent?: TabIntent, syncLayout?: boolean) => void;
	beginCenterNavigation: (
		workspaceId: string,
		preferredGroupId?: string,
	) => CenterNavigationStamp | null;
	noteNavigation: (workspaceId: string) => void;
	setFileTabView: (id: string, view: "rendered" | "source") => void;
	setDiffTabView: (id: string, view: DiffTabView) => void;
	setDiffTabRendered: (id: string, rendered: boolean) => void;
	setDiffTabIgnoreWhitespace: (id: string, ignoreWhitespace: boolean) => void;
	changesView: "list" | "tree";
	setChangesView: (view: "list" | "tree") => void;
	diffScopeByWorkspace: Record<string, GitDiffScope>;
	setDiffScope: (workspaceId: string, scope: GitDiffScope) => void;
	noteFsChanged: (payload: WorkspaceFsChangedPayload) => void;
	markSkillsSynced: (sessionId: string, syncedTick: number) => void;
	updateFileTabContent: (workspaceId: string, id: string, content: string, tick: number) => void;
	updateDiffTabContent: (
		workspaceId: string,
		id: string,
		original: string,
		modified: string,
		tick: number,
		loadedTarget: string,
	) => void;
	clearWorkspaceTabs: (workspaceId: string) => void;
	addTerminal: (
		workspaceId: string,
		initialCommand?: string,
		targetGroupId?: string,
		targetArea?: "center" | LayoutAuxiliaryRegion,
		reveal?: boolean,
		requestedTabKey?: string,
	) => void;
	setWorkspaceTerminals: (workspaceId: string, tabs: TerminalTabInfo[]) => void;
	confirmTerminalReservation: (workspaceId: string, tabKey: string) => void;
	rejectTerminalReservation: (workspaceId: string, tabKey: string) => void;
	consumeTerminalInitialCommand: (workspaceId: string, tabKey: string) => void;
	closeTerminalTab: (workspaceId: string, tabKey: string, syncLayout?: boolean) => void;
	setActiveTerminalTab: (workspaceId: string, tabKey: string, syncLayout?: boolean) => void;
	openChatSession: (
		workspaceId: string,
		sessionId: string,
		model: WireModel | null,
		thinkingLevel: ThinkingLevel,
		syncedTick?: number,
		options?: LayoutOpenOptions,
	) => void;
	closeChatRuntime: (sessionId: string) => void;
	closeChatToHistory: (
		sessionId: string,
		syncLayout?: boolean,
		workspaceId?: string,
		countNavigation?: boolean,
	) => void;
	deleteChat: (workspaceId: string, sessionId: string, countNavigation?: boolean) => void;
	reconcileWorkspaceSessions: (
		workspaceId: string,
		baselineSessionIds: readonly string[],
		authoritativeSessionIds: readonly string[],
	) => void;
	reopenChat: (workspaceId: string, sessionId: string, options?: LayoutOpenOptions) => void;
	restorePlacedChatCache: (
		workspaceId: string,
		tabId: string,
		sessionId: string,
		title: string,
	) => void;
	noteClosedChats: (workspaceId: string, entries: ClosedChat[]) => void;
	hydrateSession: (
		summary: SessionSummary,
		hydrated: HydratedRuntime,
		activate?: boolean,
		syncedTick?: number,
		options?: LayoutOpenOptions,
	) => void;
	reconcileSession: (
		summary: SessionSummary,
		hydrated: HydratedRuntime,
		expectedEventRevision: number,
		connectionGeneration: number,
	) => boolean;
	appendUserMessage: (sessionId: string, text: string, attachments?: ChatAttachment[]) => void;
	appendErrorTurn: (sessionId: string, text: string) => void;
	appendCompactionFailureUnlessObserved: (
		sessionId: string,
		observedTurnIds: ReadonlySet<string>,
		detail: string,
	) => void;
	handlePiEvent: (event: PiEvent, sessionId: string) => void;
	handlePiEvents: (payloads: readonly SessionEventPayload[]) => void;
	setModelsForProviderVersion: (providerVersion: number, models: WireModel[]) => void;
	noteProviderChanged: () => void;
	bumpTemplatesVersion: () => void;
	beginModelsRefresh: () => number;
	finishModelsRefresh: (providerVersion: number, result: RefreshedModels | null) => void;
	dropModelsFreshness: () => void;
	setCurrentModel: (sessionId: string, model: WireModel) => void;
	setThinkingLevel: (sessionId: string, level: ThinkingLevel) => void;
	setStats: (sessionId: string, stats: SessionStats) => void;
	setCommands: (sessionId: string, commands: SlashCommandInfo[]) => void;
	setChatDraft: (sessionId: string, text: string) => void;
	clearPendingExtUi: (sessionId: string, id: string) => void;
	applyExtUi: (request: ExtUiRequest) => void;
	beginLogin: (loginId: string, providerId: string) => void;
	applyLoginFrame: (push: LoginPush) => void;
	clearLoginInput: () => void;
	clearLogin: () => void;
	openSettings: (section?: SettingsSection) => void;
	closeSettings: () => void;
	setSettingsSection: (section: SettingsSection) => void;
	applyConfig: (config: AppConfig) => void;
	requestToolView: (workspaceId: string, tool: LayoutToolId) => void;
	requestChangesView: (workspaceId: string, path: string) => void;
	clearChangesRequest: () => void;
	requestChatLocation: (req: ChatLocationRequest) => void;
	clearChatLocation: () => void;
	requestHistoryOpen: (target: HistoryTarget) => void;
	clearHistoryOpen: () => void;
	requestSpecView: (workspaceId: string, path: string) => void;
	clearSpecRequest: () => void;
	setWorkspaceSpecs: (workspaceId: string, nodes: SpecGraphNode[]) => void;
	setWorkspaceReview: (workspaceId: string, snapshot: ReviewSnapshot) => void;
	requestReviewFocus: (workspaceId: string, commentId: string) => void;
	clearReviewFocus: (commentId?: string) => void;
	applyReviewChanged: (payload: ReviewChangedPayload) => void;
	pushToast: (toast: Omit<Toast, "id">) => string;
	dismissToast: (id: string) => void;
}

function sortProjects(projects: Project[]): Project[] {
	return [...projects].sort((a, b) => b.lastOpened - a.lastOpened);
}

function configPatch(config: AppConfig) {
	return {
		theme: config.theme,
		analyticsEnabled: config.analyticsEnabled,
		terminalReplayKb: config.terminalReplayKb,
		composerGrowthLimit: config.composerGrowthLimit ?? DEFAULT_CONFIG.composerGrowthLimit,
		customLayoutPresets: config.customLayoutPresets ?? DEFAULT_CONFIG.customLayoutPresets,
		reviewModel: config.reviewModel,
		reviewEffort: config.reviewEffort,
		reviewAutoFix: config.reviewAutoFix ?? DEFAULT_CONFIG.reviewAutoFix,
	};
}

function upsertProject(projects: Project[], project: Project): Project[] {
	return projects.some((candidate) => candidate.id === project.id)
		? projects.map((candidate) => (candidate.id === project.id ? project : candidate))
		: [...projects, project];
}

function withExpandedProject(
	record: Record<string, true>,
	projectId: string,
): Record<string, true> {
	return record[projectId] ? record : { ...record, [projectId]: true };
}

function withWorkspaceSelected(history: string[], workspaceId: string): string[] {
	return history[0] === workspaceId
		? history
		: [workspaceId, ...history.filter((id) => id !== workspaceId)];
}

function recentWorkspaceFallback(
	state: Pick<
		AppState,
		| "projects"
		| "workspaces"
		| "activeWorkspaceId"
		| "removedWorkspaceIds"
		| "workspaceSelectionHistory"
	>,
	excludedWorkspaceId: string,
): Workspace | null {
	const openProjectIds = new Set(state.projects.map((project) => project.id));
	for (const workspaceId of state.workspaceSelectionHistory) {
		if (workspaceId === excludedWorkspaceId || state.removedWorkspaceIds[workspaceId]) continue;
		const workspace = selectWorkspaceById(state, workspaceId);
		if (workspace && openProjectIds.has(workspace.projectId)) return workspace;
	}
	return null;
}

function pruneExpandedProjects(
	state: Pick<AppState, "expandedProjectIds">,
	projects: Project[],
): Pick<AppState, "expandedProjectIds"> | Record<string, never> {
	const open = new Set(projects.map((project) => project.id));
	const kept = Object.keys(state.expandedProjectIds).filter((id) => open.has(id));
	if (kept.length === Object.keys(state.expandedProjectIds).length) return {};
	return {
		expandedProjectIds: Object.fromEntries(kept.map((id) => [id, true as const])),
	};
}

function reconcileProjectNavigation(
	state: Pick<AppState, "selectedProjectId" | "activeWorkspaceId" | "workspaces">,
	projects: Project[],
): Pick<AppState, "selectedProjectId" | "activeWorkspaceId"> | Record<string, never> {
	const currentProjectId = selectActiveWorkspaceProjectId(state) ?? state.selectedProjectId;
	if (!currentProjectId || projects.some((project) => project.id === currentProjectId)) return {};
	return { selectedProjectId: projects[0]?.id ?? null, activeWorkspaceId: null };
}

function omitKey<T>(record: Record<string, T>, key: string): Record<string, T> {
	const { [key]: _dropped, ...rest } = record;
	return rest;
}

function appendLayoutIntent(intents: LayoutIntent[], input: LayoutIntentInput): LayoutIntent[] {
	return [...intents, { ...input, id: randomId("layout-intent") } as LayoutIntent];
}

function layoutOpenIntentFields(options: LayoutOpenOptions) {
	return {
		...(options.targetGroupId ? { targetGroupId: options.targetGroupId } : {}),
		...(options.activate === false ? { activate: false } : {}),
		...(Object.hasOwn(options, "navigation") ? { navigation: options.navigation } : {}),
		...(options.countNavigation !== undefined ? { countNavigation: options.countNavigation } : {}),
		...(options.claimPreview ? { claimPreview: true } : {}),
	};
}

function navigationCountedAtRequest(options: LayoutOpenOptions): boolean {
	return Object.hasOwn(options, "navigation");
}

function isSessionDeleted(
	state: Pick<AppState, "deletedSessionsByWorkspace">,
	workspaceId: string,
	sessionId: string,
): boolean {
	return state.deletedSessionsByWorkspace[workspaceId]?.[sessionId] === true;
}

function patchDiffTab(
	state: Pick<AppState, "activeWorkspaceId" | "tabsByWorkspace">,
	id: string,
	patch: Partial<Omit<DiffTab, "kind" | "id">>,
): Partial<AppState> {
	const wsId = state.activeWorkspaceId;
	if (!wsId) return {};
	const tabs = state.tabsByWorkspace[wsId] ?? [];
	if (!tabs.some((t) => t.id === id && t.kind === "diff")) return {};
	return {
		tabsByWorkspace: {
			...state.tabsByWorkspace,
			[wsId]: tabs.map((t) => (t.id === id && t.kind === "diff" ? { ...t, ...patch } : t)),
		},
	};
}

function sameSpecNode(a: SpecGraphNode, b: SpecGraphNode): boolean {
	return (
		a.id === b.id &&
		a.type === b.type &&
		a.title === b.title &&
		a.status === b.status &&
		a.path === b.path &&
		a.parent === b.parent &&
		shallowEqualArrays(a.dependsOn, b.dependsOn) &&
		shallowEqualArrays(a.references, b.references) &&
		shallowEqualArrays(a.implements, b.implements) &&
		shallowEqualArrays(a.tags, b.tags)
	);
}

function bumpNav(s: AppState, workspaceId: string): Record<string, number> {
	return { ...s.navTickByWorkspace, [workspaceId]: selectWorkspaceNavTick(s, workspaceId) + 1 };
}

function advanceCenterNavigation(
	s: AppState,
	workspaceId: string,
	preferredGroupId?: string,
): {
	stamp: CenterNavigationStamp | null;
	patch: Pick<AppState, "navTickByWorkspace" | "layoutAttentionByWorkspace">;
} {
	const attention = s.layoutAttentionByWorkspace[workspaceId];
	if (!attention) {
		return {
			stamp: null,
			patch: {
				navTickByWorkspace: bumpNav(s, workspaceId),
				layoutAttentionByWorkspace: s.layoutAttentionByWorkspace,
			},
		};
	}
	const fallbackGroupId =
		readLayoutNavigationClock(attention, attention.lastFocusedCenterGroupId) !== undefined
			? attention.lastFocusedCenterGroupId
			: (Object.keys(attention.navigationClockByGroup).find(
					(candidate) => readLayoutNavigationClock(attention, candidate) !== undefined,
				) ?? attention.lastFocusedCenterGroupId);
	const groupId =
		preferredGroupId && readLayoutNavigationClock(attention, preferredGroupId) !== undefined
			? preferredGroupId
			: fallbackGroupId;
	const clock = (readLayoutNavigationClock(attention, groupId) ?? 0) + 1;
	return {
		stamp: { groupId, clock },
		patch: {
			navTickByWorkspace: bumpNav(s, workspaceId),
			layoutAttentionByWorkspace: {
				...s.layoutAttentionByWorkspace,
				[workspaceId]: {
					...attention,
					lastFocusedCenterGroupId: groupId,
					navigationClockByGroup: Object.assign(
						Object.create(null),
						attention.navigationClockByGroup,
						{ [groupId]: clock },
					) as Record<string, number>,
				},
			},
		},
	};
}

export function captureCenterNavigation(
	state: { layoutAttentionByWorkspace: Record<string, LayoutAttention> },
	workspaceId: string,
): CenterNavigationStamp | null {
	const attention = state.layoutAttentionByWorkspace[workspaceId];
	if (!attention) return null;
	const groupId = attention.lastFocusedCenterGroupId;
	return {
		groupId,
		clock: readLayoutNavigationClock(attention, groupId) ?? 0,
	};
}

export function layoutOpenOptionsForNavigation(
	state: {
		layoutAttentionByWorkspace: Record<string, LayoutAttention>;
		activeWorkspaceId?: string | null;
	},
	workspaceId: string,
	stamp: CenterNavigationStamp | null,
): LayoutOpenOptions {
	if (!stamp) {
		return state.activeWorkspaceId !== undefined && state.activeWorkspaceId !== workspaceId
			? { activate: false, navigation: stamp }
			: { navigation: stamp };
	}
	const attention = state.layoutAttentionByWorkspace[workspaceId];
	const clock = attention ? readLayoutNavigationClock(attention, stamp.groupId) : undefined;
	const destinationSurvived = clock !== undefined;
	const workspaceStillActive =
		state.activeWorkspaceId === undefined || state.activeWorkspaceId === workspaceId;
	const activate =
		workspaceStillActive &&
		(!destinationSurvived ||
			(clock === stamp.clock && attention?.lastFocusedCenterGroupId === stamp.groupId));
	return {
		targetGroupId: stamp.groupId,
		...(activate ? {} : { activate: false }),
		navigation: stamp,
	};
}

export function shouldAdvanceAcceptedNavigation(
	attention: LayoutAttention,
	navigation: CenterNavigationStamp | null | undefined,
): boolean {
	if (navigation === undefined || navigation === null) return true;
	return readLayoutNavigationClock(attention, navigation.groupId) === undefined;
}

export function isCenterNavigationCurrent(
	state: { layoutAttentionByWorkspace: Record<string, LayoutAttention> },
	workspaceId: string,
	stamp: CenterNavigationStamp | null,
): boolean {
	if (!stamp) return true;
	const attention = state.layoutAttentionByWorkspace[workspaceId];
	const clock = attention ? readLayoutNavigationClock(attention, stamp.groupId) : undefined;
	return clock === undefined || clock === stamp.clock;
}

function layoutIntentTargetsSession(
	intent: LayoutIntent,
	workspaceId: string,
	sessionId: string,
): boolean {
	if (intent.workspaceId !== workspaceId) return false;
	if (intent.kind === "open") return editorSessionId(intent.tab) === sessionId;
	if (intent.kind === "select" && intent.resource) {
		return editorSessionId(intent.resource) === sessionId;
	}
	return false;
}

function withoutChat(
	s: AppState,
	workspaceId: string,
	sessionId: string,
	countNavigation: boolean,
): AppState {
	if (s.removedWorkspaceIds[workspaceId]) return s;
	const alreadyDeleted = isSessionDeleted(s, workspaceId, sessionId);
	const tabs = s.tabsByWorkspace[workspaceId] ?? [];
	const sessionTabs = tabs.filter((candidate) => editorSessionId(candidate) === sessionId);
	const closed = s.closedChatsByWorkspace[workspaceId] ?? [];
	const inHistory = closed.some((chat) => chat.sessionId === sessionId);
	const hasRuntime = s.sessions[sessionId] !== undefined;
	const hasSkillBaseline = Object.hasOwn(s.skillsSyncedTickBySession, sessionId);
	const targetsLocation =
		s.chatLocationRequest?.workspaceId === workspaceId &&
		s.chatLocationRequest.sessionId === sessionId;
	const targetsRoute =
		s.routeChatTarget?.workspaceId === workspaceId && s.routeChatTarget.sessionId === sessionId;
	const targetsHistory = s.historyOpenRequest?.sessionId === sessionId;
	const hasStaleLayoutIntent = s.layoutIntents.some((intent) =>
		layoutIntentTargetsSession(intent, workspaceId, sessionId),
	);
	if (
		alreadyDeleted &&
		sessionTabs.length === 0 &&
		!inHistory &&
		!hasRuntime &&
		!hasSkillBaseline &&
		!targetsLocation &&
		!targetsRoute &&
		!targetsHistory &&
		!hasStaleLayoutIntent
	) {
		return s;
	}

	const removedTabIds = new Set(sessionTabs.map((candidate) => candidate.id));
	const remaining =
		sessionTabs.length > 0 ? tabs.filter((candidate) => !removedTabIds.has(candidate.id)) : tabs;
	const wasActive =
		s.activeTabByWorkspace[workspaceId] !== null &&
		removedTabIds.has(s.activeTabByWorkspace[workspaceId] ?? "");
	const survivingLayoutIntents = hasStaleLayoutIntent
		? s.layoutIntents.filter(
				(intent) => !layoutIntentTargetsSession(intent, workspaceId, sessionId),
			)
		: s.layoutIntents;
	return {
		...s,
		layoutIntents: alreadyDeleted
			? survivingLayoutIntents
			: appendLayoutIntent(survivingLayoutIntents, {
					kind: "remove-session",
					workspaceId,
					sessionId,
				}),
		...(!alreadyDeleted
			? {
					deletedSessionsByWorkspace: Object.assign(
						Object.create(null),
						s.deletedSessionsByWorkspace,
						{
							[workspaceId]: Object.assign(
								Object.create(null),
								s.deletedSessionsByWorkspace[workspaceId],
								{ [sessionId]: true as const },
							) as Record<string, true>,
						},
					) as Record<string, Record<string, true>>,
				}
			: {}),
		...(sessionTabs.length > 0
			? { tabsByWorkspace: { ...s.tabsByWorkspace, [workspaceId]: remaining } }
			: {}),
		...(wasActive
			? {
					activeTabByWorkspace: {
						...s.activeTabByWorkspace,
						[workspaceId]: remaining.at(-1)?.id ?? null,
					},
					navTickByWorkspace: countNavigation ? bumpNav(s, workspaceId) : s.navTickByWorkspace,
				}
			: {}),
		...(inHistory
			? {
					closedChatsByWorkspace: {
						...s.closedChatsByWorkspace,
						[workspaceId]: closed.filter((chat) => chat.sessionId !== sessionId),
					},
				}
			: {}),
		...(hasRuntime ? { sessions: omitKey(s.sessions, sessionId) } : {}),
		...(hasSkillBaseline
			? { skillsSyncedTickBySession: omitKey(s.skillsSyncedTickBySession, sessionId) }
			: {}),
		...(targetsLocation ? { chatLocationRequest: null } : {}),
		...(targetsRoute ? { routeChatTarget: null } : {}),
		...(targetsHistory ? { historyOpenRequest: null } : {}),
	};
}

function sameSpecGraph(prev: SpecGraphNode[] | undefined, next: SpecGraphNode[]): boolean {
	if (!prev || prev.length !== next.length) return false;
	return prev.every((node, i) => {
		const candidate = next[i];
		return candidate !== undefined && sameSpecNode(node, candidate);
	});
}

function sameReviewSnapshot(prev: ReviewSnapshot | undefined, next: ReviewSnapshot): boolean {
	return prev !== undefined && JSON.stringify(prev) === JSON.stringify(next);
}

const EXT_UI_ORPHAN_LIMIT = 64;
const REPLAYABLE_EXT_UI: ReadonlySet<ExtUiRequest["kind"]> = new Set([
	"notify",
	"setStatus",
	"setWidget",
	"setTitle",
]);

function bufferExtUiOrphan(s: AppState, request: ExtUiRequest): Partial<AppState> {
	return REPLAYABLE_EXT_UI.has(request.kind)
		? { extUiOrphans: [...s.extUiOrphans, request].slice(-EXT_UI_ORPHAN_LIMIT) }
		: {};
}

function replayExtUiOrphans(
	sessionId: string,
	set: (updater: (s: AppState) => Partial<AppState>) => void,
	get: () => AppState,
): void {
	if (!get().sessions[sessionId]) return;
	const replay = get().extUiOrphans.filter((frame) => frame.sessionId === sessionId);
	if (replay.length === 0) return;
	set((s) => ({ extUiOrphans: s.extUiOrphans.filter((frame) => frame.sessionId !== sessionId) }));
	for (const frame of replay) get().applyExtUi(frame);
}

function renameChat(s: AppState, sessionId: string, title: string): Partial<AppState> | null {
	let found = false;
	for (const [wsId, tabs] of Object.entries(s.tabsByWorkspace)) {
		const chat = tabs.find(
			(tab): tab is ChatTab => tab.kind === "chat" && tab.sessionId === sessionId,
		);
		if (!chat) continue;
		found = true;
		const cacheChanged = chat.name !== title;
		const renamed = cacheChanged ? { ...chat, name: title } : chat;
		const matchesQueuedOpen = (
			intent: LayoutIntent,
		): intent is Extract<LayoutIntent, { kind: "open" }> =>
			intent.kind === "open" &&
			intent.workspaceId === wsId &&
			intent.tab.kind === "chat" &&
			intent.tab.sessionId === chat.sessionId;
		const queuedOpen = s.layoutIntents.find(matchesQueuedOpen);
		const placement = selectLayoutResourcePlacement(s, wsId, chat);
		const queuedChanged = queuedOpen !== undefined && queuedOpen.tab.name !== title;
		const placementChanged = placement !== null && placement.tab.name !== title;
		if (!cacheChanged && !queuedChanged && !placementChanged) continue;
		return {
			layoutIntents: queuedOpen
				? queuedChanged || placementChanged
					? s.layoutIntents.map((intent) =>
							matchesQueuedOpen(intent)
								? {
										...intent,
										tab: {
											...intent.tab,
											...(placementChanged && placement ? { id: placement.tabId } : {}),
											name: title,
										},
									}
								: intent,
						)
					: s.layoutIntents
				: placementChanged && placement
					? appendLayoutIntent(s.layoutIntents, {
							kind: "open",
							workspaceId: wsId,
							tab: { ...renamed, id: placement.tabId },
							intent: "keep",
							activate: false,
						})
					: s.layoutIntents,
			tabsByWorkspace: cacheChanged
				? {
						...s.tabsByWorkspace,
						[wsId]: tabs.map((tab) => (tab.id === chat.id ? renamed : tab)),
					}
				: s.tabsByWorkspace,
		};
	}
	for (const [wsId, chats] of Object.entries(s.closedChatsByWorkspace)) {
		if (!chats.some((chat) => chat.sessionId === sessionId)) continue;
		found = true;
		return {
			closedChatsByWorkspace: {
				...s.closedChatsByWorkspace,
				[wsId]: chats.map((chat) => (chat.sessionId === sessionId ? { ...chat, title } : chat)),
			},
		};
	}
	return found ? {} : null;
}

function withRuntime(
	s: AppState,
	sessionId: string,
	update: (rt: SessionRuntime) => SessionRuntime,
): Partial<AppState> {
	const rt = s.sessions[sessionId];
	if (!rt) return {};
	const next = update(rt);
	return next === rt ? {} : { sessions: { ...s.sessions, [sessionId]: next } };
}

function newLoginState(loginId: string, providerId: string): LoginState {
	return { loginId, providerId, status: "active" };
}

function foldLoginFrame(state: LoginState, frame: LoginFrame): LoginState {
	switch (frame.kind) {
		case "authUrl":
			return {
				...state,
				url: frame.url,
				...(frame.instructions ? { instructions: frame.instructions } : {}),
			};
		case "deviceCode":
			return {
				...state,
				deviceCode: {
					userCode: frame.userCode,
					verificationUri: frame.verificationUri,
					...(frame.expiresInSeconds ? { expiresInSeconds: frame.expiresInSeconds } : {}),
				},
			};
		case "select": {
			const { progress: _p, ...rest } = state;
			return { ...rest, input: { kind: "select", message: frame.message, options: frame.options } };
		}
		case "prompt": {
			const { progress: _p, ...rest } = state;
			return {
				...rest,
				input: {
					kind: "prompt",
					message: frame.message,
					...(frame.placeholder ? { placeholder: frame.placeholder } : {}),
					...(frame.allowEmpty ? { allowEmpty: true } : {}),
					...(frame.secret ? { secret: true } : {}),
				},
			};
		}
		case "progress":
			return { ...state, progress: frame.message };
		case "success": {
			const { input: _i, progress: _p, ...rest } = state;
			return { ...rest, status: "success" };
		}
		case "error": {
			const { input: _i, progress: _p, ...rest } = state;
			return { ...rest, status: "error", error: frame.message };
		}
	}
}

function nextTerminalTitle(list: TerminalTab[]): string {
	const used = list
		.map((tab) => Number.parseInt(/^Terminal (\d+)$/.exec(tab.title)?.[1] ?? "", 10))
		.filter((n) => Number.isInteger(n));
	return `Terminal ${Math.max(0, ...used) + 1}`;
}

export const useAppStore = create<AppState>((set, get) => ({
	status: "connecting",
	connectionGeneration: 0,
	welcomeGeneration: 0,
	protocolVersion: null,
	hostPlatform: null,
	projects: [],
	recentProjects: [],
	workspaces: {},
	removedWorkspaceIds: Object.create(null) as Record<string, true>,
	expandedProjectIds: Object.create(null) as Record<string, true>,
	selectedProjectId: null,
	activeWorkspaceId: null,
	workspaceSelectionHistory: [],
	routeChatTarget: null,
	routeChatTargetGeneration: 0,
	workbenchFrame: null,
	workspaceViewsByWorkspace: {},
	layoutStateReady: false,
	localLayoutPreferences: { ...DEFAULT_LOCAL_LAYOUT_PREFERENCES },
	legacyLayoutImportAttempted: {},
	layoutDocumentsByWorkspace: {},
	layoutAttentionByWorkspace: {},
	layoutProjectionEpochByWorkspace: {},
	layoutIntents: [],
	tabsByWorkspace: {},
	activeTabByWorkspace: {},
	previewTabByWorkspace: {},
	navTickByWorkspace: {},
	closedChatsByWorkspace: {},
	deletedSessionsByWorkspace: Object.create(null) as Record<string, Record<string, true>>,
	terminalsByWorkspace: {},
	activeTerminalByWorkspace: {},
	sessions: {},
	extUiOrphans: [],
	models: [],
	providerVersion: 0,
	templatesVersion: 0,
	modelsRefreshing: false,
	modelsFresh: false,
	changesRequest: null,
	specRequest: null,
	specsByWorkspace: {},
	reviewsByWorkspace: {},
	reviewFocusRequest: null,
	changesView: "list",
	diffScopeByWorkspace: {},
	chatLocationRequest: null,
	historyOpenRequest: null,
	fsChangesByWorkspace: {},
	skillChangeTickByWorkspace: {},
	skillsSyncedTickBySession: {},
	activeLogin: null,
	settingsOpen: false,
	settingsSection: SettingsSection.Providers,
	theme: DEFAULT_CONFIG.theme,
	analyticsEnabled: DEFAULT_CONFIG.analyticsEnabled,
	terminalReplayKb: DEFAULT_CONFIG.terminalReplayKb,
	composerGrowthLimit: DEFAULT_CONFIG.composerGrowthLimit,
	customLayoutPresets: DEFAULT_CONFIG.customLayoutPresets,
	reviewModel: DEFAULT_CONFIG.reviewModel,
	reviewEffort: DEFAULT_CONFIG.reviewEffort,
	reviewAutoFix: DEFAULT_CONFIG.reviewAutoFix,
	toasts: [],
	setStatus: (status) =>
		set((state) => ({
			status,
			connectionGeneration:
				status === "connected" ? state.connectionGeneration + 1 : state.connectionGeneration,
		})),
	installWelcomeSnapshot: (protocolVersion, projects, recentProjects, config, hostPlatform) =>
		set((state) => {
			const openProjects = sortProjects(projects.filter((project) => project.closed !== true));
			return {
				protocolVersion,
				projects: openProjects,
				recentProjects: sortProjects(recentProjects),
				hostPlatform: hostPlatform ?? null,
				...(config ? configPatch(config) : {}),
				...reconcileProjectNavigation(state, openProjects),
				...pruneExpandedProjects(state, openProjects),
				welcomeGeneration: state.welcomeGeneration + 1,
			};
		}),
	installProjectSnapshot: (projects, recentProjects) =>
		set((state) => {
			const openProjects = sortProjects(projects.filter((project) => project.closed !== true));
			return {
				projects: openProjects,
				recentProjects: sortProjects(recentProjects),
				...reconcileProjectNavigation(state, openProjects),
				...pruneExpandedProjects(state, openProjects),
			};
		}),
	applyProjectUpdated: (project) =>
		set((state) => {
			const projects =
				project.closed === true
					? state.projects.filter((candidate) => candidate.id !== project.id)
					: sortProjects(upsertProject(state.projects, project));
			return {
				projects,
				recentProjects: sortProjects(upsertProject(state.recentProjects, project)),
				...reconcileProjectNavigation(state, projects),
				...pruneExpandedProjects(state, projects),
			};
		}),
	setWorkspaces: (projectId, workspaces) =>
		set((s) => ({
			workspaces: {
				...s.workspaces,
				[projectId]: workspaces.filter((workspace) => !s.removedWorkspaceIds[workspace.id]),
			},
		})),
	addWorkspace: (workspace) =>
		set((s) => {
			if (s.removedWorkspaceIds[workspace.id]) return {};
			const list = s.workspaces[workspace.projectId];
			if (!list) return {};
			return {
				workspaces: {
					...s.workspaces,
					[workspace.projectId]: list.some((w) => w.id === workspace.id)
						? list.map((w) => (w.id === workspace.id ? { ...w, ...workspace } : w))
						: [...list, workspace],
				},
			};
		}),
	updateWorkspace: (workspace) =>
		set((s) => {
			const list = s.workspaces[workspace.projectId];
			if (!list?.some((w) => w.id === workspace.id)) return {};
			return {
				workspaces: {
					...s.workspaces,
					[workspace.projectId]: list.map((w) =>
						w.id === workspace.id
							? { ...workspace, ...(w.diffStats ? { diffStats: w.diffStats } : {}) }
							: w,
					),
				},
			};
		}),
	removeWorkspace: (projectId, workspaceId) =>
		set((s) => {
			const list = s.workspaces[projectId];
			if (!list) return {};
			return {
				workspaces: { ...s.workspaces, [projectId]: list.filter((w) => w.id !== workspaceId) },
			};
		}),
	applyWorkspaceRemoved: (projectId, workspaceId) => {
		const s = get();
		const wasActive = s.activeWorkspaceId === workspaceId;
		const fallbackWorkspace = wasActive ? recentWorkspaceFallback(s, workspaceId) : null;
		const name = s.workspaces[projectId]?.find((w) => w.id === workspaceId)?.name;
		set((state) => {
			const removedSessions = new Set(selectWorkspaceSessionIds(state, workspaceId));
			return {
				removedWorkspaceIds: Object.assign(Object.create(null), state.removedWorkspaceIds, {
					[workspaceId]: true,
				}) as Record<string, true>,
				workspaceSelectionHistory: state.workspaceSelectionHistory.filter(
					(id) => id !== workspaceId,
				),
				fsChangesByWorkspace: omitKey(state.fsChangesByWorkspace, workspaceId),
				skillChangeTickByWorkspace: omitKey(state.skillChangeTickByWorkspace, workspaceId),
				specsByWorkspace: omitKey(state.specsByWorkspace, workspaceId),
				diffScopeByWorkspace: omitKey(state.diffScopeByWorkspace, workspaceId),
				reviewsByWorkspace: omitKey(state.reviewsByWorkspace, workspaceId),
				changesRequest:
					state.changesRequest?.workspaceId === workspaceId ? null : state.changesRequest,
				specRequest: state.specRequest?.workspaceId === workspaceId ? null : state.specRequest,
				chatLocationRequest:
					state.chatLocationRequest?.workspaceId === workspaceId ? null : state.chatLocationRequest,
				routeChatTarget:
					state.routeChatTarget?.workspaceId === workspaceId ? null : state.routeChatTarget,
				historyOpenRequest:
					state.historyOpenRequest && removedSessions.has(state.historyOpenRequest.sessionId)
						? null
						: state.historyOpenRequest,
				reviewFocusRequest:
					state.reviewFocusRequest?.workspaceId === workspaceId ? null : state.reviewFocusRequest,
			};
		});
		s.removeWorkspace(projectId, workspaceId);
		s.clearWorkspaceTabs(workspaceId);
		if (wasActive) {
			if (fallbackWorkspace) s.activateWorkspace(fallbackWorkspace);
			else s.selectProject(projectId);
			toast.info(`Workspace "${name ?? "?"}" was removed`);
		}
	},
	selectProject: (selectedProjectId, opts) =>
		set((state) => ({
			selectedProjectId,
			activeWorkspaceId: null,
			...(opts?.reveal
				? { expandedProjectIds: withExpandedProject(state.expandedProjectIds, selectedProjectId) }
				: {}),
		})),
	toggleProjectExpanded: (projectId) =>
		set((state) => ({
			expandedProjectIds: state.expandedProjectIds[projectId]
				? omitKey(state.expandedProjectIds, projectId)
				: withExpandedProject(state.expandedProjectIds, projectId),
		})),
	expandProject: (projectId) =>
		set((state) => {
			const expandedProjectIds = withExpandedProject(state.expandedProjectIds, projectId);
			return expandedProjectIds === state.expandedProjectIds ? {} : { expandedProjectIds };
		}),
	hydrateExpandedProjects: (projectIds) =>
		set(() => ({
			expandedProjectIds: Object.fromEntries(projectIds.map((id) => [id, true as const])),
		})),
	selectMain: () =>
		set({ selectedProjectId: null, activeWorkspaceId: null, routeChatTarget: null }),
	activateWorkspace: (workspace) =>
		set((state) =>
			state.removedWorkspaceIds[workspace.id]
				? {}
				: {
						selectedProjectId: workspace.projectId,
						activeWorkspaceId: workspace.id,
						workspaceSelectionHistory: withWorkspaceSelected(
							state.workspaceSelectionHistory,
							workspace.id,
						),
					},
		),
	activateWorkspaceFromRoute: (workspace, sessionId) =>
		set((state) => {
			if (state.removedWorkspaceIds[workspace.id]) return {};
			const advanced = advanceCenterNavigation(state, workspace.id);
			return {
				...advanced.patch,
				selectedProjectId: workspace.projectId,
				activeWorkspaceId: workspace.id,
				workspaceSelectionHistory: withWorkspaceSelected(
					state.workspaceSelectionHistory,
					workspace.id,
				),
				routeChatTarget: sessionId
					? {
							workspaceId: workspace.id,
							sessionId,
							navTick: selectWorkspaceNavTick(state, workspace.id) + 1,
							navigation: advanced.stamp,
							validated: false,
						}
					: null,
				routeChatTargetGeneration: sessionId
					? state.routeChatTargetGeneration + 1
					: state.routeChatTargetGeneration,
			};
		}),
	validateRouteChatTarget: (sessionId) =>
		set((state) => {
			const target = state.routeChatTarget;
			if (!target || target.sessionId !== sessionId || target.validated) return state;
			return { routeChatTarget: { ...target, validated: true } };
		}),
	clearRouteChatTarget: () =>
		set((state) => (state.routeChatTarget ? { routeChatTarget: null } : state)),
	hydrateLocalLayoutState: (payload) =>
		set((state) =>
			state.layoutStateReady
				? {}
				: {
						workbenchFrame: payload.frame,
						workspaceViewsByWorkspace: payload.viewsByWorkspace,
						layoutDocumentsByWorkspace: payload.documentsByWorkspace,
						layoutAttentionByWorkspace: payload.attentionByWorkspace,
						localLayoutPreferences: payload.preferences,
						legacyLayoutImportAttempted: payload.legacyImportAttempted,
						layoutStateReady: true,
					},
		),
	applyLocalLayoutState: (payload, changedWorkspaceIds, invalidateProjection = false) =>
		set((state) => {
			const layoutProjectionEpochByWorkspace = { ...state.layoutProjectionEpochByWorkspace };
			if (invalidateProjection) {
				for (const workspaceId of changedWorkspaceIds) {
					layoutProjectionEpochByWorkspace[workspaceId] =
						(layoutProjectionEpochByWorkspace[workspaceId] ?? 0) + 1;
				}
			}
			return {
				workbenchFrame: payload.frame,
				workspaceViewsByWorkspace: payload.viewsByWorkspace,
				layoutDocumentsByWorkspace: payload.documentsByWorkspace,
				layoutAttentionByWorkspace: payload.attentionByWorkspace,
				localLayoutPreferences: payload.preferences,
				legacyLayoutImportAttempted: payload.legacyImportAttempted,
				layoutProjectionEpochByWorkspace,
			};
		}),
	setLocalLayoutPreferences: (preferences) => set({ localLayoutPreferences: preferences }),
	setLayoutAttention: (workspaceId, attention) =>
		set((state) =>
			state.removedWorkspaceIds[workspaceId]
				? {}
				: {
						layoutAttentionByWorkspace: {
							...state.layoutAttentionByWorkspace,
							[workspaceId]: attention,
						},
					},
		),
	syncLegacySelection: (workspaceId, selection) =>
		set((state) => {
			if (state.removedWorkspaceIds[workspaceId]) return {};
			if (selection?.kind === "terminal") {
				if (
					!state.terminalsByWorkspace[workspaceId]?.some(
						(terminal) => terminal.tabKey === selection.tabKey,
					)
				) {
					return {};
				}
				if (
					state.activeTerminalByWorkspace[workspaceId] === selection.tabKey &&
					state.activeTabByWorkspace[workspaceId] === null
				) {
					return {};
				}
				return {
					activeTerminalByWorkspace: {
						...state.activeTerminalByWorkspace,
						[workspaceId]: selection.tabKey,
					},
					activeTabByWorkspace: { ...state.activeTabByWorkspace, [workspaceId]: null },
				};
			}
			if (selection?.kind === "editor") {
				if (!state.tabsByWorkspace[workspaceId]?.some((tab) => tab.id === selection.tabId)) {
					return {};
				}
				if (
					state.activeTabByWorkspace[workspaceId] === selection.tabId &&
					state.activeTerminalByWorkspace[workspaceId] === null
				) {
					return {};
				}
				return {
					activeTabByWorkspace: {
						...state.activeTabByWorkspace,
						[workspaceId]: selection.tabId,
					},
					activeTerminalByWorkspace: {
						...state.activeTerminalByWorkspace,
						[workspaceId]: null,
					},
				};
			}
			if (
				state.activeTabByWorkspace[workspaceId] === null &&
				state.activeTerminalByWorkspace[workspaceId] === null
			) {
				return {};
			}
			return {
				activeTabByWorkspace: { ...state.activeTabByWorkspace, [workspaceId]: null },
				activeTerminalByWorkspace: {
					...state.activeTerminalByWorkspace,
					[workspaceId]: null,
				},
			};
		}),
	enqueueLayoutIntent: (intent) => {
		const id = randomId("layout-intent");
		set((state) =>
			state.removedWorkspaceIds[intent.workspaceId]
				? {}
				: { layoutIntents: [...state.layoutIntents, { ...intent, id } as LayoutIntent] },
		);
		return id;
	},
	consumeLayoutIntent: (id) =>
		set((state) => ({ layoutIntents: state.layoutIntents.filter((intent) => intent.id !== id) })),
	openTab: (tab, intent, syncLayout = true, options = {}) =>
		set((s) => {
			const wsId = tab.workspaceId;
			const sessionId = editorSessionId(tab);
			if (
				s.removedWorkspaceIds[wsId] ||
				(sessionId !== null && isSessionDeleted(s, wsId, sessionId))
			) {
				return {};
			}
			const tabs = s.tabsByWorkspace[wsId] ?? [];
			const resolvedId = availableEditorTabId(tabs, tab);
			const resolvedTab = resolvedId === tab.id ? tab : { ...tab, id: resolvedId };
			const previewCompatible = resolvedTab.kind === "file" || resolvedTab.kind === "diff";
			const effectiveIntent = previewCompatible ? intent : "keep";
			const claimPreview = previewCompatible && options.claimPreview === true;
			const preview = s.previewTabByWorkspace[wsId];
			const activeTabByWorkspace =
				options.activate === false
					? s.activeTabByWorkspace
					: { ...s.activeTabByWorkspace, [wsId]: resolvedTab.id };
			const openIntent: LayoutIntentInput = {
				kind: "open",
				workspaceId: wsId,
				tab: resolvedTab,
				intent: effectiveIntent,
				...layoutOpenIntentFields(claimPreview ? options : { ...options, claimPreview: false }),
			};
			const existingIndex = tabs.findIndex((candidate) => candidate.id === resolvedTab.id);
			if (existingIndex >= 0) {
				const existing = tabs[existingIndex];
				return {
					...(syncLayout
						? {
								layoutIntents: appendLayoutIntent(s.layoutIntents, openIntent),
							}
						: {}),
					tabsByWorkspace:
						existing === resolvedTab
							? s.tabsByWorkspace
							: { ...s.tabsByWorkspace, [wsId]: tabs.with(existingIndex, resolvedTab) },
					activeTabByWorkspace,
					previewTabByWorkspace:
						effectiveIntent === "keep" &&
						(preview === resolvedTab.id || (claimPreview && preview !== undefined))
							? omitKey(s.previewTabByWorkspace, wsId)
							: s.previewTabByWorkspace,
				};
			}
			const at =
				!s.layoutDocumentsByWorkspace[wsId] &&
				(effectiveIntent === "preview" || claimPreview) &&
				preview
					? tabs.findIndex((t) => t.id === preview)
					: -1;
			return {
				...(syncLayout
					? {
							layoutIntents: appendLayoutIntent(s.layoutIntents, openIntent),
						}
					: {}),
				tabsByWorkspace: {
					...s.tabsByWorkspace,
					[wsId]: at === -1 ? [...tabs, resolvedTab] : tabs.with(at, resolvedTab),
				},
				activeTabByWorkspace,
				previewTabByWorkspace:
					effectiveIntent === "preview"
						? { ...s.previewTabByWorkspace, [wsId]: resolvedTab.id }
						: claimPreview && preview
							? omitKey(s.previewTabByWorkspace, wsId)
							: s.previewTabByWorkspace,
			};
		}),
	openDoc: (tab) =>
		set((s) => {
			const sessionId = editorSessionId(tab);
			if (
				s.removedWorkspaceIds[tab.workspaceId] ||
				(sessionId !== null && isSessionDeleted(s, tab.workspaceId, sessionId))
			) {
				return {};
			}
			const tabs = s.tabsByWorkspace[tab.workspaceId] ?? [];
			const existing = tabs.find(
				(candidate) => editorResourceIdentity(candidate) === editorResourceIdentity(tab),
			);
			const id = availableEditorTabId(tabs, tab);
			const resolvedTab = id === tab.id ? tab : { ...tab, id };
			const navigation = advanceCenterNavigation(s, tab.workspaceId);
			return {
				...navigation.patch,
				layoutIntents: appendLayoutIntent(s.layoutIntents, {
					kind: "open",
					workspaceId: tab.workspaceId,
					tab: resolvedTab,
					intent: "keep",
					...(navigation.stamp ? { targetGroupId: navigation.stamp.groupId } : {}),
					navigation: navigation.stamp,
				}),
				tabsByWorkspace: {
					...s.tabsByWorkspace,
					[tab.workspaceId]: existing
						? tabs.map((candidate) => (candidate === existing ? resolvedTab : candidate))
						: [...tabs, resolvedTab],
				},
				activeTabByWorkspace: { ...s.activeTabByWorkspace, [tab.workspaceId]: resolvedTab.id },
			};
		}),
	closeTab: (id, syncLayout = true, countNavigation = true, workspaceId) =>
		set((s) => {
			const wsId = workspaceId ?? s.activeWorkspaceId;
			if (!wsId || s.removedWorkspaceIds[wsId]) return {};
			const tabs = (s.tabsByWorkspace[wsId] ?? []).filter((t) => t.id !== id);
			const wasActive = s.activeTabByWorkspace[wsId] === id;
			return {
				...(syncLayout
					? {
							layoutIntents: appendLayoutIntent(s.layoutIntents, {
								kind: "close",
								workspaceId: wsId,
								tabId: id,
							}),
						}
					: {}),
				tabsByWorkspace: { ...s.tabsByWorkspace, [wsId]: tabs },
				activeTabByWorkspace: {
					...s.activeTabByWorkspace,
					[wsId]: wasActive ? (tabs.at(-1)?.id ?? null) : (s.activeTabByWorkspace[wsId] ?? null),
				},
				navTickByWorkspace: wasActive && countNavigation ? bumpNav(s, wsId) : s.navTickByWorkspace,
				...(s.previewTabByWorkspace[wsId] === id
					? { previewTabByWorkspace: omitKey(s.previewTabByWorkspace, wsId) }
					: {}),
			};
		}),
	setActiveTab: (id, intent, syncLayout = true) =>
		set((s) => {
			const wsId = s.activeWorkspaceId;
			if (!wsId) return {};
			return {
				...(syncLayout
					? {
							layoutIntents: appendLayoutIntent(s.layoutIntents, {
								kind: "select",
								workspaceId: wsId,
								tabId: id,
								...(intent === "keep" ? { keep: true } : {}),
							}),
						}
					: {}),
				activeTabByWorkspace: { ...s.activeTabByWorkspace, [wsId]: id },
				navTickByWorkspace: bumpNav(s, wsId),
				...(intent === "keep" && s.previewTabByWorkspace[wsId] === id
					? { previewTabByWorkspace: omitKey(s.previewTabByWorkspace, wsId) }
					: {}),
			};
		}),
	beginCenterNavigation: (workspaceId, preferredGroupId) => {
		let stamp: CenterNavigationStamp | null = null;
		set((s) => {
			if (s.removedWorkspaceIds[workspaceId]) return {};
			const advanced = advanceCenterNavigation(s, workspaceId, preferredGroupId);
			stamp = advanced.stamp;
			return advanced.patch;
		});
		return stamp;
	},
	noteNavigation: (workspaceId) =>
		set((s) =>
			s.removedWorkspaceIds[workspaceId] ? {} : { navTickByWorkspace: bumpNav(s, workspaceId) },
		),
	setFileTabView: (id, view) =>
		set((s) => {
			const wsId = s.activeWorkspaceId;
			if (!wsId) return {};
			const tabs = s.tabsByWorkspace[wsId] ?? [];
			if (!tabs.some((t) => t.id === id && t.kind === "file")) return {};
			return {
				tabsByWorkspace: {
					...s.tabsByWorkspace,
					[wsId]: tabs.map((t) => (t.id === id && t.kind === "file" ? { ...t, view } : t)),
				},
			};
		}),
	setDiffTabView: (id, view) => set((s) => patchDiffTab(s, id, { view })),
	setDiffTabRendered: (id, rendered) => set((s) => patchDiffTab(s, id, { rendered })),
	setDiffTabIgnoreWhitespace: (id, ignoreWhitespace) =>
		set((s) => patchDiffTab(s, id, { ignoreWhitespace })),
	setChangesView: (view) => set({ changesView: view }),
	setDiffScope: (workspaceId, scope) =>
		set((s) =>
			s.removedWorkspaceIds[workspaceId]
				? {}
				: { diffScopeByWorkspace: { ...s.diffScopeByWorkspace, [workspaceId]: scope } },
		),
	noteFsChanged: (payload) =>
		set((s) => {
			if (s.removedWorkspaceIds[payload.workspaceId]) return {};
			const prev = s.fsChangesByWorkspace[payload.workspaceId];
			const tick = (prev?.tick ?? 0) + 1;
			const skillChanged = payload.skillChange !== "none";
			return {
				fsChangesByWorkspace: {
					...s.fsChangesByWorkspace,
					[payload.workspaceId]: { tick, paths: payload.paths, truncated: payload.truncated },
				},
				...(skillChanged
					? {
							skillChangeTickByWorkspace: {
								...s.skillChangeTickByWorkspace,
								[payload.workspaceId]: tick,
							},
						}
					: {}),
			};
		}),
	markSkillsSynced: (sessionId, syncedTick) =>
		set((s) => {
			if (!s.sessions[sessionId]) return {};
			const synced = Math.max(s.skillsSyncedTickBySession[sessionId] ?? 0, syncedTick);
			return {
				skillsSyncedTickBySession: { ...s.skillsSyncedTickBySession, [sessionId]: synced },
			};
		}),
	updateFileTabContent: (workspaceId, id, content, tick) =>
		set((s) => {
			if (s.removedWorkspaceIds[workspaceId]) return {};
			const tabs = s.tabsByWorkspace[workspaceId] ?? [];
			if (!tabs.some((tab) => tab.id === id && tab.kind === "file")) return {};
			return {
				tabsByWorkspace: {
					...s.tabsByWorkspace,
					[workspaceId]: tabs.map((tab) =>
						tab.id === id && tab.kind === "file" ? { ...tab, content, loadedTick: tick } : tab,
					),
				},
			};
		}),
	updateDiffTabContent: (workspaceId, id, original, modified, tick, loadedTarget) =>
		set((s) => {
			if (s.removedWorkspaceIds[workspaceId]) return {};
			const tabs = s.tabsByWorkspace[workspaceId] ?? [];
			if (!tabs.some((tab) => tab.id === id && tab.kind === "diff")) return {};
			return {
				tabsByWorkspace: {
					...s.tabsByWorkspace,
					[workspaceId]: tabs.map((tab) =>
						tab.id === id && tab.kind === "diff"
							? { ...tab, original, modified, loadedTick: tick, loadedTarget }
							: tab,
					),
				},
			};
		}),
	clearWorkspaceTabs: (workspaceId) =>
		set((s) => {
			const sessions = { ...s.sessions };
			const skillsSyncedTickBySession = { ...s.skillsSyncedTickBySession };
			for (const sessionId of selectWorkspaceSessionIds(s, workspaceId)) {
				delete sessions[sessionId];
				delete skillsSyncedTickBySession[sessionId];
			}
			return {
				workspaceViewsByWorkspace: omitKey(s.workspaceViewsByWorkspace, workspaceId),
				legacyLayoutImportAttempted: omitKey(s.legacyLayoutImportAttempted, workspaceId),
				layoutDocumentsByWorkspace: omitKey(s.layoutDocumentsByWorkspace, workspaceId),
				layoutAttentionByWorkspace: omitKey(s.layoutAttentionByWorkspace, workspaceId),
				layoutProjectionEpochByWorkspace: omitKey(s.layoutProjectionEpochByWorkspace, workspaceId),
				layoutIntents: s.layoutIntents.filter((intent) => intent.workspaceId !== workspaceId),
				tabsByWorkspace: omitKey(s.tabsByWorkspace, workspaceId),
				activeTabByWorkspace: omitKey(s.activeTabByWorkspace, workspaceId),
				previewTabByWorkspace: omitKey(s.previewTabByWorkspace, workspaceId),
				navTickByWorkspace: omitKey(s.navTickByWorkspace, workspaceId),
				closedChatsByWorkspace: omitKey(s.closedChatsByWorkspace, workspaceId),
				terminalsByWorkspace: omitKey(s.terminalsByWorkspace, workspaceId),
				activeTerminalByWorkspace: omitKey(s.activeTerminalByWorkspace, workspaceId),
				sessions,
				skillsSyncedTickBySession,
			};
		}),
	addTerminal: (
		workspaceId,
		initialCommand,
		targetGroupId,
		targetArea = "center",
		reveal = true,
		requestedTabKey,
	) =>
		set((s) => {
			if (s.removedWorkspaceIds[workspaceId]) return {};
			const list = s.terminalsByWorkspace[workspaceId] ?? [];
			const tabKey = requestedTabKey ?? randomId("terminal");
			if (list.some((tab) => tab.tabKey === tabKey)) return {};
			const navigation =
				targetGroupId && targetArea === "center"
					? advanceCenterNavigation(s, workspaceId, targetGroupId)
					: null;
			const tab: TerminalTab = {
				tabKey,
				workspaceId,
				title: nextTerminalTitle(list),
				reservationPending: true,
				...(initialCommand ? { initialCommand } : {}),
			};
			return {
				...(navigation?.patch ?? {}),
				layoutIntents: appendLayoutIntent(s.layoutIntents, {
					kind: "place-terminal",
					workspaceId,
					tabKey,
					title: tab.title,
					...(targetGroupId
						? {
								targetGroupId,
								...(targetArea !== "center" ? { targetArea } : {}),
								...(targetArea === "center" ? { navigation: navigation?.stamp ?? null } : {}),
							}
						: {}),
					...(reveal ? {} : { reveal: false as const }),
				}),
				terminalsByWorkspace: { ...s.terminalsByWorkspace, [workspaceId]: [...list, tab] },
				activeTerminalByWorkspace: { ...s.activeTerminalByWorkspace, [workspaceId]: tabKey },
			};
		}),
	setWorkspaceTerminals: (workspaceId, tabs) =>
		set((s) => {
			if (s.removedWorkspaceIds[workspaceId]) return {};
			const local = s.terminalsByWorkspace[workspaceId] ?? [];
			const known = new Set(tabs.map((tab) => tab.tabKey));
			const pending = local.filter((tab) => !known.has(tab.tabKey) && tab.reservationPending);
			const merged: TerminalTab[] = [
				...tabs.map((tab) => {
					const existing = local.find((candidate) => candidate.tabKey === tab.tabKey);
					return {
						tabKey: tab.tabKey,
						workspaceId,
						title: tab.title,
						...(existing?.initialCommand ? { initialCommand: existing.initialCommand } : {}),
					};
				}),
				...pending,
			];
			const active = s.activeTerminalByWorkspace[workspaceId] ?? null;
			const activeSurvives = merged.some((tab) => tab.tabKey === active);
			return {
				terminalsByWorkspace: { ...s.terminalsByWorkspace, [workspaceId]: merged },
				activeTerminalByWorkspace: {
					...s.activeTerminalByWorkspace,
					[workspaceId]: activeSurvives ? active : (merged.at(-1)?.tabKey ?? null),
				},
			};
		}),
	confirmTerminalReservation: (workspaceId, tabKey) =>
		set((s) => {
			if (s.removedWorkspaceIds[workspaceId]) return {};
			const list = s.terminalsByWorkspace[workspaceId] ?? [];
			if (!list.some((tab) => tab.tabKey === tabKey && tab.reservationPending)) return s;
			return {
				terminalsByWorkspace: {
					...s.terminalsByWorkspace,
					[workspaceId]: list.map(({ reservationPending, ...rest }) =>
						rest.tabKey === tabKey
							? rest
							: { ...rest, ...(reservationPending ? { reservationPending } : {}) },
					),
				},
			};
		}),
	rejectTerminalReservation: (workspaceId, tabKey) =>
		set((s) => {
			if (s.removedWorkspaceIds[workspaceId]) return {};
			const list = s.terminalsByWorkspace[workspaceId] ?? [];
			if (!list.some((tab) => tab.tabKey === tabKey && tab.reservationPending)) return s;
			const terminals = list.filter((tab) => tab.tabKey !== tabKey);
			const active = s.activeTerminalByWorkspace[workspaceId] ?? null;
			return {
				terminalsByWorkspace: { ...s.terminalsByWorkspace, [workspaceId]: terminals },
				activeTerminalByWorkspace: {
					...s.activeTerminalByWorkspace,
					[workspaceId]: active === tabKey ? (terminals.at(-1)?.tabKey ?? null) : active,
				},
				layoutIntents: s.layoutIntents.filter(
					(intent) =>
						intent.kind !== "place-terminal" ||
						intent.workspaceId !== workspaceId ||
						intent.tabKey !== tabKey,
				),
			};
		}),
	consumeTerminalInitialCommand: (workspaceId, tabKey) =>
		set((s) => {
			if (s.removedWorkspaceIds[workspaceId]) return {};
			const list = s.terminalsByWorkspace[workspaceId] ?? [];
			if (!list.some((t) => t.tabKey === tabKey && t.initialCommand)) return s;
			return {
				terminalsByWorkspace: {
					...s.terminalsByWorkspace,
					[workspaceId]: list.map(({ initialCommand, ...rest }) =>
						rest.tabKey === tabKey
							? rest
							: { ...rest, ...(initialCommand ? { initialCommand } : {}) },
					),
				},
			};
		}),
	closeTerminalTab: (workspaceId, tabKey, syncLayout = true) =>
		set((s) => {
			if (s.removedWorkspaceIds[workspaceId]) return {};
			const list = (s.terminalsByWorkspace[workspaceId] ?? []).filter((t) => t.tabKey !== tabKey);
			const wasActive = s.activeTerminalByWorkspace[workspaceId] === tabKey;
			return {
				...(syncLayout
					? {
							layoutIntents: appendLayoutIntent(s.layoutIntents, {
								kind: "close-terminal",
								workspaceId,
								tabKey,
							}),
						}
					: {}),
				terminalsByWorkspace: { ...s.terminalsByWorkspace, [workspaceId]: list },
				activeTerminalByWorkspace: {
					...s.activeTerminalByWorkspace,
					[workspaceId]: wasActive
						? (list.at(-1)?.tabKey ?? null)
						: (s.activeTerminalByWorkspace[workspaceId] ?? null),
				},
			};
		}),
	setActiveTerminalTab: (workspaceId, tabKey, syncLayout = true) =>
		set((s) =>
			s.removedWorkspaceIds[workspaceId]
				? {}
				: {
						...(syncLayout
							? {
									layoutIntents: appendLayoutIntent(s.layoutIntents, {
										kind: "select-terminal",
										workspaceId,
										tabKey,
									}),
								}
							: {}),
						activeTerminalByWorkspace: { ...s.activeTerminalByWorkspace, [workspaceId]: tabKey },
					},
		),
	openChatSession: (workspaceId, sessionId, model, thinkingLevel, syncedTick, options = {}) => {
		set((s) => {
			if (s.removedWorkspaceIds[workspaceId] || isSessionDeleted(s, workspaceId, sessionId)) {
				return {};
			}
			const tabs = s.tabsByWorkspace[workspaceId] ?? [];
			const existing = tabs.find(
				(candidate): candidate is ChatTab =>
					candidate.kind === "chat" && candidate.sessionId === sessionId,
			);
			const preferred: ChatTab = existing ?? {
				kind: "chat",
				id: chatTabId(workspaceId, sessionId),
				workspaceId,
				name: "Chat",
				sessionId,
			};
			const id = existing?.id ?? availableEditorTabId(tabs, preferred);
			const tab: ChatTab = id === preferred.id ? preferred : { ...preferred, id };
			const fresh = !s.sessions[sessionId];
			const history = s.closedChatsByWorkspace[workspaceId] ?? [];
			const inHistory = history.some((entry) => entry.sessionId === sessionId);
			return {
				layoutIntents: appendLayoutIntent(s.layoutIntents, {
					kind: "open",
					workspaceId,
					tab,
					intent: "keep",
					...layoutOpenIntentFields(options),
				}),
				tabsByWorkspace: existing
					? s.tabsByWorkspace
					: { ...s.tabsByWorkspace, [workspaceId]: [...tabs, tab] },
				closedChatsByWorkspace: inHistory
					? {
							...s.closedChatsByWorkspace,
							[workspaceId]: history.filter((entry) => entry.sessionId !== sessionId),
						}
					: s.closedChatsByWorkspace,
				activeTabByWorkspace:
					options.activate === false
						? s.activeTabByWorkspace
						: { ...s.activeTabByWorkspace, [workspaceId]: id },
				navTickByWorkspace:
					options.activate === false || navigationCountedAtRequest(options)
						? s.navTickByWorkspace
						: bumpNav(s, workspaceId),
				sessions: fresh
					? {
							...s.sessions,
							[sessionId]: newRuntime(model, thinkingLevel, s.connectionGeneration),
						}
					: s.sessions,
				...(fresh
					? {
							skillsSyncedTickBySession: {
								...s.skillsSyncedTickBySession,
								[sessionId]: syncedTick ?? selectWorkspaceTick(s, workspaceId),
							},
						}
					: {}),
			};
		});
		replayExtUiOrphans(sessionId, set, get);
	},
	closeChatRuntime: (sessionId) =>
		set((s) => {
			if (!s.sessions[sessionId]) return {};
			return {
				sessions: omitKey(s.sessions, sessionId),
				skillsSyncedTickBySession: omitKey(s.skillsSyncedTickBySession, sessionId),
			};
		}),
	closeChatToHistory: (sessionId, syncLayout = true, workspaceId, countNavigation = true) =>
		set((s) => {
			const wsId = workspaceId ?? s.activeWorkspaceId;
			if (!wsId || s.removedWorkspaceIds[wsId]) return {};
			const tabs = s.tabsByWorkspace[wsId] ?? [];
			const tab = tabs.find((t) => t.kind === "chat" && t.sessionId === sessionId);
			if (!tab) return {};
			const remaining = tabs.filter((t) => t.id !== tab.id);
			const wasActive = s.activeTabByWorkspace[wsId] === tab.id;
			const entry: ClosedChat = { sessionId, title: tab.name, closedAt: Date.now() };
			const targetsLocation =
				s.chatLocationRequest?.workspaceId === wsId &&
				s.chatLocationRequest.sessionId === sessionId;
			const targetsHistory = s.historyOpenRequest?.sessionId === sessionId;
			return {
				...(syncLayout
					? {
							layoutIntents: appendLayoutIntent(s.layoutIntents, {
								kind: "close",
								workspaceId: wsId,
								tabId: tab.id,
							}),
						}
					: {}),
				tabsByWorkspace: { ...s.tabsByWorkspace, [wsId]: remaining },
				navTickByWorkspace: wasActive && countNavigation ? bumpNav(s, wsId) : s.navTickByWorkspace,
				activeTabByWorkspace: {
					...s.activeTabByWorkspace,
					[wsId]: wasActive
						? (remaining.at(-1)?.id ?? null)
						: (s.activeTabByWorkspace[wsId] ?? null),
				},
				closedChatsByWorkspace: {
					...s.closedChatsByWorkspace,
					[wsId]: [entry, ...(s.closedChatsByWorkspace[wsId] ?? [])],
				},
				...(targetsLocation ? { chatLocationRequest: null } : {}),
				...(targetsHistory ? { historyOpenRequest: null } : {}),
			};
		}),
	deleteChat: (workspaceId, sessionId, countNavigation = true) =>
		set((s) => withoutChat(s, workspaceId, sessionId, countNavigation)),
	reconcileWorkspaceSessions: (workspaceId, baselineSessionIds, authoritativeSessionIds) =>
		set((s) => {
			if (s.removedWorkspaceIds[workspaceId]) return {};
			const authoritative = new Set(authoritativeSessionIds);
			let next = s;
			for (const sessionId of baselineSessionIds) {
				if (!authoritative.has(sessionId)) {
					next = withoutChat(next, workspaceId, sessionId, false);
				}
			}
			return next;
		}),
	reopenChat: (wsId, sessionId, options = {}) =>
		set((s) => {
			if (s.removedWorkspaceIds[wsId] || isSessionDeleted(s, wsId, sessionId)) return {};
			const closed = s.closedChatsByWorkspace[wsId] ?? [];
			const entry = closed.find((c) => c.sessionId === sessionId);
			if (!entry) return {};
			const tabs = s.tabsByWorkspace[wsId] ?? [];
			const existing = tabs.find(
				(candidate): candidate is ChatTab =>
					candidate.kind === "chat" && candidate.sessionId === sessionId,
			);
			const preferred: ChatTab = {
				kind: "chat",
				id: existing?.id ?? chatTabId(wsId, sessionId),
				workspaceId: wsId,
				name: entry.title,
				sessionId,
			};
			const id = existing?.id ?? availableEditorTabId(tabs, preferred);
			const tab: ChatTab = id === preferred.id ? preferred : { ...preferred, id };
			return {
				layoutIntents: appendLayoutIntent(s.layoutIntents, {
					kind: "open",
					workspaceId: wsId,
					tab,
					intent: "keep",
					...layoutOpenIntentFields(options),
				}),
				tabsByWorkspace: existing
					? existing.name === tab.name
						? s.tabsByWorkspace
						: {
								...s.tabsByWorkspace,
								[wsId]: tabs.map((candidate) => (candidate === existing ? tab : candidate)),
							}
					: { ...s.tabsByWorkspace, [wsId]: [...tabs, tab] },
				activeTabByWorkspace:
					options.activate === false
						? s.activeTabByWorkspace
						: { ...s.activeTabByWorkspace, [wsId]: id },
				navTickByWorkspace:
					options.activate === false || navigationCountedAtRequest(options)
						? s.navTickByWorkspace
						: bumpNav(s, wsId),
				closedChatsByWorkspace: {
					...s.closedChatsByWorkspace,
					[wsId]: closed.filter((c) => c.sessionId !== sessionId),
				},
			};
		}),
	restorePlacedChatCache: (workspaceId, tabId, sessionId, title) =>
		set((s) => {
			if (s.removedWorkspaceIds[workspaceId] || isSessionDeleted(s, workspaceId, sessionId)) {
				return {};
			}
			const tabs = s.tabsByWorkspace[workspaceId] ?? [];
			const placed = tabs.find(
				(tab): tab is ChatTab => tab.kind === "chat" && tab.sessionId === sessionId,
			);
			const idAvailable = (candidateId: string) =>
				!tabs.some((candidate) => candidate !== placed && candidate.id === candidateId);
			const canonicalId = chatTabId(workspaceId, sessionId);
			const available = [tabId, placed?.id, canonicalId].find(
				(candidateId): candidateId is string =>
					candidateId !== undefined && idAvailable(candidateId),
			);
			let id = available ?? randomId("chat-cache");
			while (!idAvailable(id)) id = randomId("chat-cache");
			const closed = s.closedChatsByWorkspace[workspaceId] ?? [];
			const inHistory = closed.some((chat) => chat.sessionId === sessionId);
			const metadataChanged = placed?.name !== title || placed.id !== id;
			if (placed && !inHistory && !metadataChanged) return {};
			const tab: ChatTab = { kind: "chat", id, workspaceId, name: title, sessionId };
			const retargeted = placed !== undefined && placed.id !== id;
			return {
				tabsByWorkspace: placed
					? metadataChanged
						? {
								...s.tabsByWorkspace,
								[workspaceId]: tabs.map((candidate) => (candidate === placed ? tab : candidate)),
							}
						: s.tabsByWorkspace
					: { ...s.tabsByWorkspace, [workspaceId]: [...tabs, tab] },
				closedChatsByWorkspace: inHistory
					? {
							...s.closedChatsByWorkspace,
							[workspaceId]: closed.filter((chat) => chat.sessionId !== sessionId),
						}
					: s.closedChatsByWorkspace,
				activeTabByWorkspace:
					retargeted && s.activeTabByWorkspace[workspaceId] === placed?.id
						? { ...s.activeTabByWorkspace, [workspaceId]: id }
						: s.activeTabByWorkspace,
				previewTabByWorkspace:
					retargeted && s.previewTabByWorkspace[workspaceId] === placed?.id
						? { ...s.previewTabByWorkspace, [workspaceId]: id }
						: s.previewTabByWorkspace,
			};
		}),
	noteClosedChats: (workspaceId, entries) =>
		set((s) => {
			if (s.removedWorkspaceIds[workspaceId]) return {};
			const existing = s.closedChatsByWorkspace[workspaceId] ?? [];
			const open = new Set(
				(s.tabsByWorkspace[workspaceId] ?? [])
					.filter((tab): tab is ChatTab => tab.kind === "chat")
					.map((tab) => tab.sessionId),
			);
			const incoming = new Map(
				entries
					.filter(
						(entry) =>
							!isSessionDeleted(s, workspaceId, entry.sessionId) &&
							!open.has(entry.sessionId) &&
							!s.sessions[entry.sessionId],
					)
					.map((entry) => [entry.sessionId, entry]),
			);
			let changed = false;
			const refreshed = existing.map((entry) => {
				const replacement = incoming.get(entry.sessionId);
				if (!replacement) return entry;
				incoming.delete(entry.sessionId);
				if (replacement.title === entry.title) return entry;
				changed = true;
				return { ...entry, title: replacement.title };
			});
			if (incoming.size > 0) changed = true;
			if (!changed) return {};
			return {
				closedChatsByWorkspace: {
					...s.closedChatsByWorkspace,
					[workspaceId]: [...refreshed, ...incoming.values()].sort(
						(a, b) => b.closedAt - a.closedAt,
					),
				},
			};
		}),
	hydrateSession: (summary, hydrated, activate = false, syncedTick, options = {}) => {
		set((s) => {
			if (
				s.removedWorkspaceIds[summary.workspaceId] ||
				isSessionDeleted(s, summary.workspaceId, summary.sessionId)
			) {
				return {};
			}
			if (s.sessions[summary.sessionId]) return {};
			const wsId = summary.workspaceId;
			const runtime: SessionRuntime = {
				...newRuntime(summary.model, summary.thinkingLevel, s.connectionGeneration),
				turns: hydrated.turns,
				toolResults: hydrated.toolResults,
				askAnswers: hydrated.askAnswers,
				isStreaming: summary.isStreaming,
				...(summary.queue ? { queue: summary.queue } : {}),
				...(hydrated.turnIdByMessageIndex
					? { turnIdByMessageIndex: hydrated.turnIdByMessageIndex }
					: {}),
			};
			const tabs = s.tabsByWorkspace[wsId] ?? [];
			const existing = tabs.find(
				(candidate): candidate is ChatTab =>
					candidate.kind === "chat" && candidate.sessionId === summary.sessionId,
			);
			const preferred: ChatTab = {
				kind: "chat",
				id: existing?.id ?? chatTabId(wsId, summary.sessionId),
				workspaceId: wsId,
				name: summary.title,
				sessionId: summary.sessionId,
			};
			const id = existing?.id ?? availableEditorTabId(tabs, preferred);
			const tab: ChatTab = id === preferred.id ? preferred : { ...preferred, id };
			const hasActive = s.activeTabByWorkspace[wsId] != null;
			const takesFocus = options.activate !== false && (activate || !hasActive);
			const closed = s.closedChatsByWorkspace[wsId] ?? [];
			return {
				...(activate
					? {
							layoutIntents: appendLayoutIntent(s.layoutIntents, {
								kind: "open",
								workspaceId: wsId,
								tab,
								intent: "keep",
								...layoutOpenIntentFields(options),
							}),
						}
					: {}),
				sessions: { ...s.sessions, [summary.sessionId]: runtime },
				...(syncedTick !== undefined
					? {
							skillsSyncedTickBySession: {
								...s.skillsSyncedTickBySession,
								[summary.sessionId]: syncedTick,
							},
						}
					: {}),
				tabsByWorkspace: existing
					? existing.name === tab.name
						? s.tabsByWorkspace
						: {
								...s.tabsByWorkspace,
								[wsId]: tabs.map((candidate) => (candidate === existing ? tab : candidate)),
							}
					: { ...s.tabsByWorkspace, [wsId]: [...tabs, tab] },
				activeTabByWorkspace: takesFocus
					? { ...s.activeTabByWorkspace, [wsId]: id }
					: s.activeTabByWorkspace,
				navTickByWorkspace:
					takesFocus && !navigationCountedAtRequest(options)
						? bumpNav(s, wsId)
						: s.navTickByWorkspace,
				closedChatsByWorkspace: closed.some((c) => c.sessionId === summary.sessionId)
					? {
							...s.closedChatsByWorkspace,
							[wsId]: closed.filter((c) => c.sessionId !== summary.sessionId),
						}
					: s.closedChatsByWorkspace,
			};
		});
		replayExtUiOrphans(summary.sessionId, set, get);
	},
	reconcileSession: (summary, hydrated, expectedEventRevision, connectionGeneration) => {
		let applied = false;
		set((s) => {
			const current = s.sessions[summary.sessionId];
			if (
				!current ||
				current.eventRevision !== expectedEventRevision ||
				s.removedWorkspaceIds[summary.workspaceId] ||
				isSessionDeleted(s, summary.workspaceId, summary.sessionId) ||
				!selectWorkspaceSessionIds(s, summary.workspaceId).includes(summary.sessionId)
			) {
				return {};
			}
			const { turnIdByMessageIndex: _previousMessageIndex, ...preserved } = current;
			void _previousMessageIndex;
			const runtime: SessionRuntime = {
				...preserved,
				turns: reconcileCompactionTurns(current.turns, hydrated.turns, summary.isStreaming),
				toolResults: hydrated.toolResults,
				askAnswers: hydrated.askAnswers,
				currentAssistantId: null,
				attemptAssistantId: null,
				isStreaming: summary.isStreaming,
				queue: summary.queue ?? EMPTY_QUEUE,
				model: summary.model,
				thinkingLevel: summary.thinkingLevel,
				eventRevision: current.eventRevision + 1,
				syncedConnectionGeneration: Math.max(
					current.syncedConnectionGeneration,
					connectionGeneration,
				),
				...(hydrated.turnIdByMessageIndex
					? { turnIdByMessageIndex: hydrated.turnIdByMessageIndex }
					: {}),
			};
			applied = true;
			return { sessions: { ...s.sessions, [summary.sessionId]: runtime } };
		});
		return applied;
	},
	appendUserMessage: (sessionId, text, attachments) =>
		set((s) =>
			withRuntime(s, sessionId, (rt) => ({
				...rt,
				turns: [
					...consumeFailureRecoveries(rt.turns),
					{
						kind: "user",
						id: crypto.randomUUID(),
						message: {
							role: "user",
							content:
								attachments && attachments.length > 0
									? [
											...(text ? [{ type: "text" as const, text }] : []),
											...attachments.map((a) => a.content),
										]
									: text,
							timestamp: Date.now(),
						},
						...(attachments && attachments.length > 0
							? { attachmentNames: attachments.map((a) => a.name) }
							: {}),
					},
				],
			})),
		),
	appendErrorTurn: (sessionId, text) =>
		set((s) =>
			withRuntime(s, sessionId, (rt) => ({
				...rt,
				isStreaming: false,
				currentAssistantId: null,
				attemptAssistantId: null,
				turns: [...clearTurnStreaming(rt.turns), { kind: "error", id: crypto.randomUUID(), text }],
			})),
		),
	appendCompactionFailureUnlessObserved: (sessionId, observedTurnIds, detail) =>
		set((s) =>
			withRuntime(s, sessionId, (rt) => {
				const lifecycleObserved = rt.turns.some(
					(turn) => turn.kind === "compaction" && !observedTurnIds.has(turn.id),
				);
				return lifecycleObserved
					? rt
					: {
							...rt,
							turns: [
								...rt.turns,
								{ kind: "compaction", id: crypto.randomUUID(), status: "failed", detail },
							],
						};
			}),
		),
	handlePiEvent: (event, sessionId) => get().handlePiEvents([{ event, sessionId }]),
	handlePiEvents: (payloads) =>
		set((s) => {
			let sessions = s.sessions;
			for (const { event, sessionId } of payloads) {
				const runtime = sessions[sessionId];
				if (!runtime) continue;
				if (sessions === s.sessions) sessions = { ...sessions };
				const next = reduceSessionEvent(runtime, event);
				sessions[sessionId] = {
					...next,
					eventRevision: runtime.eventRevision + 1,
				};
			}
			return sessions === s.sessions ? s : { sessions };
		}),
	setModelsForProviderVersion: (providerVersion, models) =>
		set((s) => (s.providerVersion === providerVersion ? { models, modelsFresh: false } : s)),
	noteProviderChanged: () =>
		set((s) => ({
			models: [],
			modelsFresh: false,
			modelsRefreshing: false,
			providerVersion: s.providerVersion + 1,
		})),
	bumpTemplatesVersion: () => set((s) => ({ templatesVersion: s.templatesVersion + 1 })),
	beginModelsRefresh: () => {
		const providerVersion = get().providerVersion;
		set({ modelsRefreshing: true });
		return providerVersion;
	},
	dropModelsFreshness: () => set({ modelsFresh: false }),
	finishModelsRefresh: (providerVersion, result) =>
		set((s) =>
			s.providerVersion === providerVersion
				? {
						modelsRefreshing: false,
						models: result?.models ?? s.models,
						modelsFresh: result ? result.complete : s.modelsFresh,
					}
				: s,
		),
	setCurrentModel: (sessionId, model) =>
		set((s) => withRuntime(s, sessionId, (rt) => ({ ...rt, model }))),
	setThinkingLevel: (sessionId, level) =>
		set((s) => withRuntime(s, sessionId, (rt) => ({ ...rt, thinkingLevel: level }))),
	setStats: (sessionId, stats) => set((s) => withRuntime(s, sessionId, (rt) => ({ ...rt, stats }))),
	setCommands: (sessionId, commands) =>
		set((s) => withRuntime(s, sessionId, (rt) => ({ ...rt, commands }))),
	setChatDraft: (sessionId, draft) =>
		set((s) => withRuntime(s, sessionId, (rt) => ({ ...rt, draft }))),
	clearPendingExtUi: (sessionId, id) =>
		set((s) =>
			withRuntime(s, sessionId, (rt) => {
				if (rt.pendingExtUi?.id !== id) return rt;
				const [next, ...rest] = rt.extUiQueue;
				return { ...rt, pendingExtUi: next ?? null, extUiQueue: rest };
			}),
		),
	applyExtUi: (request) =>
		set((s): Partial<AppState> => {
			if (request.kind === "setTitle")
				return renameChat(s, request.sessionId, request.title) ?? bufferExtUiOrphan(s, request);
			if (!s.sessions[request.sessionId]) return bufferExtUiOrphan(s, request);
			return withRuntime(s, request.sessionId, (rt) => reduceExtUi(rt, request));
		}),
	beginLogin: (loginId, providerId) =>
		set((s) =>
			s.activeLogin?.loginId === loginId ? {} : { activeLogin: newLoginState(loginId, providerId) },
		),
	applyLoginFrame: (push) =>
		set((s) => {
			const cur = s.activeLogin;
			if (cur && cur.loginId !== push.loginId && cur.status === "active") return {};
			const base =
				cur && cur.loginId === push.loginId ? cur : newLoginState(push.loginId, push.providerId);
			return { activeLogin: foldLoginFrame(base, push.frame) };
		}),
	clearLoginInput: () =>
		set((s) => {
			if (!s.activeLogin?.input) return {};
			const { input: _drop, ...rest } = s.activeLogin;
			return { activeLogin: rest };
		}),
	clearLogin: () => set({ activeLogin: null }),
	openSettings: (section = SettingsSection.Providers) =>
		set({ settingsOpen: true, settingsSection: section }),
	closeSettings: () => set({ settingsOpen: false }),
	setSettingsSection: (section) => set({ settingsSection: section }),
	applyConfig: (config) => set(configPatch(config)),
	requestToolView: (workspaceId, tool) =>
		set((state) =>
			state.removedWorkspaceIds[workspaceId]
				? {}
				: {
						layoutIntents: appendLayoutIntent(state.layoutIntents, {
							kind: "reveal-tool",
							workspaceId,
							tool,
						}),
					},
		),
	requestChangesView: (workspaceId, path) =>
		set((s) => {
			if (s.removedWorkspaceIds[workspaceId]) return {};
			const advanced = advanceCenterNavigation(s, workspaceId);
			return {
				layoutIntents: appendLayoutIntent(s.layoutIntents, {
					kind: "reveal-tool",
					workspaceId,
					tool: "changes",
				}),
				changesRequest: {
					workspaceId,
					path,
					navTick: selectWorkspaceNavTick(s, workspaceId) + 1,
					navigation: advanced.stamp,
				},
				...advanced.patch,
			};
		}),
	clearChangesRequest: () => set({ changesRequest: null }),
	requestChatLocation: (req) =>
		set((state) => {
			if (
				state.removedWorkspaceIds[req.workspaceId] ||
				isSessionDeleted(state, req.workspaceId, req.sessionId)
			) {
				return {};
			}
			const hydrated = state.layoutAttentionByWorkspace[req.workspaceId] !== undefined;
			const advanced = hydrated ? advanceCenterNavigation(state, req.workspaceId) : null;
			return {
				...(advanced?.patch ?? {}),
				chatLocationRequest: {
					...req,
					...(advanced ? { navigation: advanced.stamp } : {}),
				},
				selectedProjectId: req.projectId,
				activeWorkspaceId: req.workspaceId,
				workspaceSelectionHistory: withWorkspaceSelected(
					state.workspaceSelectionHistory,
					req.workspaceId,
				),
			};
		}),
	clearChatLocation: () => set({ chatLocationRequest: null }),
	requestHistoryOpen: (target) =>
		set((s) => {
			if (
				s.removedWorkspaceIds[target.workspaceId] ||
				isSessionDeleted(s, target.workspaceId, target.sessionId)
			) {
				return {};
			}
			const cache = s.tabsByWorkspace[target.workspaceId]?.find(
				(candidate): candidate is ChatTab =>
					candidate.kind === "chat" && candidate.sessionId === target.sessionId,
			);
			const resource: ChatTab =
				cache ??
				({
					kind: "chat",
					id: target.tabId,
					workspaceId: target.workspaceId,
					name: "Chat",
					sessionId: target.sessionId,
				} satisfies ChatTab);
			const resourcePlacement = selectLayoutResourcePlacement(s, target.workspaceId, resource);
			const navigation = advanceCenterNavigation(
				s,
				target.workspaceId,
				resourcePlacement?.area === "center" ? resourcePlacement.groupId : undefined,
			);
			const historyRequestId = randomId("history-open");
			return {
				...navigation.patch,
				layoutIntents: appendLayoutIntent(s.layoutIntents, {
					kind: "select",
					workspaceId: target.workspaceId,
					tabId: resourcePlacement?.tabId ?? target.tabId,
					resource,
					focus: false,
					historyRequestId,
					navigation: navigation.stamp,
				}),
				historyOpenRequest: { id: historyRequestId, sessionId: target.sessionId },
				activeTabByWorkspace: cache
					? { ...s.activeTabByWorkspace, [target.workspaceId]: cache.id }
					: s.activeTabByWorkspace,
			};
		}),
	clearHistoryOpen: () => set({ historyOpenRequest: null }),
	requestSpecView: (workspaceId, path) =>
		set((s) => {
			if (s.removedWorkspaceIds[workspaceId]) return {};
			const advanced = advanceCenterNavigation(s, workspaceId);
			return {
				layoutIntents: appendLayoutIntent(s.layoutIntents, {
					kind: "reveal-tool",
					workspaceId,
					tool: "specs",
				}),
				specRequest: { workspaceId, path, navigation: advanced.stamp },
				...advanced.patch,
			};
		}),
	clearSpecRequest: () => set({ specRequest: null }),
	setWorkspaceSpecs: (workspaceId, nodes) =>
		set((s) =>
			s.removedWorkspaceIds[workspaceId] || sameSpecGraph(s.specsByWorkspace[workspaceId], nodes)
				? {}
				: { specsByWorkspace: { ...s.specsByWorkspace, [workspaceId]: nodes } },
		),
	requestReviewFocus: (workspaceId, commentId) =>
		set((state) =>
			state.removedWorkspaceIds[workspaceId]
				? {}
				: { reviewFocusRequest: { workspaceId, commentId } },
		),
	clearReviewFocus: (commentId) =>
		set((state) =>
			commentId !== undefined && state.reviewFocusRequest?.commentId !== commentId
				? {}
				: { reviewFocusRequest: null },
		),
	setWorkspaceReview: (workspaceId, snapshot) =>
		set((s) =>
			s.removedWorkspaceIds[workspaceId] ||
			sameReviewSnapshot(s.reviewsByWorkspace[workspaceId], snapshot)
				? {}
				: { reviewsByWorkspace: { ...s.reviewsByWorkspace, [workspaceId]: snapshot } },
		),
	applyReviewChanged: (payload) =>
		set((s) => {
			if (s.removedWorkspaceIds[payload.workspaceId]) return {};
			const next = { review: payload.review, comments: payload.comments };
			return sameReviewSnapshot(s.reviewsByWorkspace[payload.workspaceId], next)
				? {}
				: { reviewsByWorkspace: { ...s.reviewsByWorkspace, [payload.workspaceId]: next } };
		}),
	pushToast: (toast) => {
		const twin = get().toasts.find(
			(t) => t.variant === toast.variant && t.title === toast.title && t.message === toast.message,
		);
		if (twin) return twin.id;
		const id = crypto.randomUUID();
		set((s) => ({ toasts: [...s.toasts, { ...toast, id }].slice(-MAX_TOASTS) }));
		return id;
	},
	dismissToast: (id) =>
		set((s) =>
			s.toasts.some((t) => t.id === id) ? { toasts: s.toasts.filter((t) => t.id !== id) } : {},
		),
}));

export const toast = {
	error: (message: string, title?: string) =>
		useAppStore.getState().pushToast({ variant: "error", message, ...(title ? { title } : {}) }),
	success: (message: string, title?: string) =>
		useAppStore.getState().pushToast({ variant: "success", message, ...(title ? { title } : {}) }),
	info: (message: string, title?: string) =>
		useAppStore.getState().pushToast({ variant: "info", message, ...(title ? { title } : {}) }),
};
