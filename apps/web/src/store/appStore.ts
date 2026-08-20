import type {
	AppConfig,
	AskUserQuestionResult,
	ExtUiRequest,
	GitDiffScope,
	LayoutChangedPayload,
	LayoutSettings,
	LayoutToolId,
	LoginFrame,
	LoginPush,
	PiEvent,
	Project,
	RefreshedModels,
	ReviewChangedPayload,
	ReviewSnapshot,
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
	WorkspaceLayoutSnapshot,
} from "@thinkrail/contracts";
import { DEFAULT_CONFIG, isAskUserAnswersMessage, isControlMessage } from "@thinkrail/contracts";
import { create } from "zustand";
import type { LoginState } from "../auth";
import { assistantFailureText } from "../chat/assistantFailure";
import type { HydratedRuntime } from "../chat/hydrate";
import type { ChatTurn, CompactionState, ExtUiDialogRequest, ToolResultState } from "../chat/types";
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
import type { ConnectionStatus } from "../transport";
import {
	type HistoryTarget,
	selectActiveWorkspaceProjectId,
	selectLayoutResourcePlacement,
	selectWorkspaceNavTick,
	selectWorkspaceSessionIds,
	selectWorkspaceTick,
} from "./selectors";

/** A center tab. File tabs (Monaco) and chat tabs share the strip, discriminated by `kind`. */
export interface FileTab {
	kind: "file";
	id: string; // collision-safe `(workspaceId, path)` identity
	workspaceId: string;
	name: string;
	path: string;
	content: string;
	/** Markdown tabs only: view mode. Absent = rendered (the default); source shows Monaco. */
	view?: "rendered" | "source";
	/** The workspace fs tick `content` was loaded at (see `fsChangesByWorkspace`). Absent = initial load
	 * (tick 0) — `FilePane` re-reads when the workspace has ticked past this. */
	loadedTick?: number;
}
export interface ChatTab {
	kind: "chat";
	id: string; // collision-safe `(workspaceId, sessionId)` identity; sessionId remains pi's one session id
	workspaceId: string;
	name: string;
	sessionId: string;
}
/**
 * Browser-local resolved content for a registered virtual document — never backed by a worktree file (so
 * no fs re-read / source toggle). Shared placement strips this cache to its rehydratable resolver identity;
 * `docPath` is a synthetic `.md` path used for link resolution and a readable label.
 */
export interface DocTab {
	kind: "doc";
	id: string;
	workspaceId: string;
	name: string;
	content: string;
	docPath: string;
	/** Stable resolver source identity; shared layout persists this reference, never `content`. */
	sourceId: string;
}
/**
 * A read-only diff of one changed file over one **diff scope** (opened from the Changes panel; one tab per
 * file *and scope*). `view` is the layout — absent = split (side-by-side), the default. `rendered`
 * (markdown paths only — `DiffPane` gates the toggle) swaps raw Monaco lines for compiled documents:
 * split shows base | worktree previews side by side, inline shows the worktree preview alone.
 * `ignoreWhitespace` hides whitespace-only changes (Monaco's `ignoreTrimWhitespace`), per tab.
 */
export type DiffTabView = "split" | "inline";
export interface DiffTab {
	kind: "diff";
	// Collision-safe `(workspaceId, scopeKey, path)` identity — stable, so re-clicking a file in the same scope focuses its
	// tab, while a different scope of that file is a different tab (its content can't change meaning
	// because the rail's scope flipped underneath it).
	id: string;
	workspaceId: string;
	name: string;
	path: string;
	/** What this tab diffs — fixed at open time and re-read with (never re-derived from the panel's scope). */
	scope: GitDiffScope;
	/**
	 * The review **target** this tab's content was actually read against (`selectDiffTabTargetRef`: the
	 * workspace's diff base for a `branch` scope, `""` for the scopes that have no such dimension). Persisted
	 * *with* the content — and **required**, so no diff tab can exist without saying which target its two sides
	 * came from: a background tab (panes mount only while active) whose target moved must detect the drift when
	 * it is activated, and "the target as of mount" cannot — it would silently show the old target's diff under
	 * the new target's label.
	 */
	loadedTarget: string;
	original: string;
	modified: string;
	view?: DiffTabView;
	rendered?: boolean;
	ignoreWhitespace?: boolean;
	/** The workspace fs tick the contents were loaded at — same live-refresh contract as `FileTab`. */
	loadedTick?: number;
}
/**
 * The chat plan's **live review-map page** (a center tab): renders the session's TODO plan from the
 * host (live — the pane refetches off `pi.event` like the plan popup) with per-item change sets and
 * click-through navigation to diffs/Changes. Markdown is an *export* of this page (`planMarkdown`),
 * never its source — the page replaced the old static `doc`-snapshot route.
 */
export interface PlanTab {
	kind: "plan";
	/** `${workspaceId}:plan:${sessionId}` — one plan page per chat; re-opening focuses it. */
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

/**
 * Preserve an existing semantic cache id; otherwise use the preferred id only if another resource does not
 * already own it. Shared placement ids are opaque, so this guard is what lets them coexist with the
 * browser's canonical tuple ids without metadata replacement or duplicate React keys.
 */
function availableEditorTabId(tabs: readonly EditorTab[], tab: EditorTab): string {
	const identity = editorResourceIdentity(tab);
	const existing = tabs.find((candidate) => editorResourceIdentity(candidate) === identity);
	if (existing) return existing.id;
	if (!tabs.some((candidate) => candidate.id === tab.id)) return tab.id;
	let fallback = randomId("editor-cache");
	while (tabs.some((candidate) => candidate.id === fallback)) fallback = randomId("editor-cache");
	return fallback;
}

/**
 * How an open/reveal treats its destination center group's structural preview slot. `preview` is a light
 * browse (tree click/link follow); `keep` is deliberate. The shell model—not the resource cache—applies it.
 */
export type TabIntent = "preview" | "keep";

export interface PendingLayoutWrite {
	mutationId: string;
	/** Captured base: `null` creates from absence; a number replaces that exact accepted revision. */
	expectedRevision: number | null;
	document: WorkspaceLayoutDocument;
}

/** A browser-local destination and its request-time navigation clock for one deferred center open. */
export interface CenterNavigationStamp {
	groupId: string;
	clock: number;
}

/** Exact-chat intent from the client-local route. The catalog validates membership before the shell opens
 * the shared placement; the global compatibility tick makes any newer local center navigation cancel it. */
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
	/** The request-time navigation already counted by the caller; retained for settlement-time arbitration. */
	navigation?: CenterNavigationStamp | null;
	/** Automatic restoration can suppress an accepted structural selection from counting as navigation. */
	countNavigation?: boolean;
	/** A click upgraded to a double click replaces the destination group's preview slot but lands kept. */
	claimPreview?: boolean;
}

/** Arrangement-agnostic requests consumed by the shell-owned workbench integration. */
export type LayoutIntent =
	| {
			id: string;
			kind: "open";
			workspaceId: string;
			tab: EditorTab;
			intent: TabIntent;
			targetGroupId?: string;
			activate?: boolean;
			/** A coalesced preview→keep gesture still claims the structural preview slot. */
			claimPreview?: boolean;
			/** Request-time navigation retained for accepted-focus arbitration without counting it twice. */
			navigation?: CenterNavigationStamp | null;
			/** Automatic restoration may focus without superseding an earlier user navigation. */
			countNavigation?: boolean;
	  }
	| { id: string; kind: "close"; workspaceId: string; tabId: string }
	| {
			id: string;
			kind: "select";
			workspaceId: string;
			tabId: string;
			/** Semantic fallback when the browser cache id differs from an opaque shared placement id. */
			resource?: EditorTab;
			keep?: boolean;
			/** Another control (for example history search) may own focus after selection. */
			focus?: boolean;
			/** Correlates a deferred history-open selection with the still-current overlay request. */
			historyRequestId?: string;
			/** Request-time navigation retained so accepted selection does not count it twice. */
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
			navigation?: CenterNavigationStamp | null;
			countNavigation?: boolean;
	  }
	| { id: string; kind: "close-terminal"; workspaceId: string; tabKey: string }
	| { id: string; kind: "select-terminal"; workspaceId: string; tabKey: string }
	| { id: string; kind: "toggle-side"; workspaceId: string; side: "left" | "right" };
export type LayoutIntentInput = LayoutIntent extends infer Intent
	? Intent extends { id: string }
		? Omit<Intent, "id">
		: never
	: never;

/**
 * A section of the settings dialog (a const-object "enum", the codebase convention). Extensible — the live
 * sections are providers, GitHub, appearance, layout, terminal, templates, and privacy.
 */
export const SettingsSection = {
	Providers: "providers",
	Github: "github",
	Appearance: "appearance",
	Layout: "layout",
	Terminal: "terminal",
	Templates: "templates",
	Privacy: "privacy",
} as const;
export type SettingsSection = (typeof SettingsSection)[keyof typeof SettingsSection];

/** A transient notification. `error` persists until dismissed; `success`/`info` auto-dismiss (the Toaster
 * owns the timer). `title` is optional — a bare `message` is the common case. */
export interface Toast {
	id: string;
	variant: "error" | "success" | "info";
	message: string;
	title?: string;
}

/** Toast-queue cap: the viewport stacks without scrolling, so past a screenful the oldest drop to keep
 * the newest visible. */
const MAX_TOASTS = 5;

/**
 * A terminal tab — a local mirror of host state, not the authority.
 *
 * The host owns the tab list (`terminal.list`); `tabKey` is the durable identity it keys shells on, so this
 * store never holds the only record of a running shell. That inversion is deliberate: when the browser was the
 * sole keeper of the tab→shell mapping, losing it mid-round-trip spawned a duplicate shell and orphaned the
 * original for the life of the host.
 */
export interface TerminalTab {
	tabKey: string;
	workspaceId: string;
	title: string;
	/** A command to run once, only if the attach actually created this shell (e.g. "Open in Vim"). */
	initialCommand?: string;
	/**
	 * This client minted the tab and its `terminal.attach` has not landed yet, so the host does not know about
	 * it. Only such a tab may survive an authoritative list that omits it — anything else missing from the
	 * host's list is a tab that genuinely no longer exists (another client closed it), and keeping it would let
	 * its instance re-attach and resurrect both the tab and a shell.
	 */
	attachPending?: true;
}

/** A chat tab the user closed — reopenable from history; its session + runtime stay alive in `sessions`. */
export interface ClosedChat {
	sessionId: string;
	title: string;
	closedAt: number;
}

/**
 * A history-search "jump to message" deep link: which workspace/session/message to open and scroll to.
 * `anchorText` (a prefix of the hit's message text, from `MessageHit`) lets the consumer validate/fall
 * back if the live transcript drifted from the indexed hit (e.g. after compaction).
 */
export interface ChatLocationRequest {
	/** The workspace that owns the target chat. */
	workspaceId: string;
	/** The project that owns `workspaceId` — carried so a cross-project jump can activate both IDs
	 * atomically (and load the destination project's workspaces first if it hasn't been opened yet). */
	projectId: string;
	sessionId: string;
	messageIndex: number;
	anchorText: string;
	/** Destination and local clock captured before a cross-workspace switch when already hydrated. */
	navigation?: CenterNavigationStamp | null;
}

/**
 * The live state of one chat session, keyed by its `sessionId` in `store.sessions`. The host already runs
 * N independent `AgentSession`s, so each gets its own runtime here — events route to it by id, letting
 * several chats stream concurrently while switching tabs is an instant in-memory swap.
 */
export interface SessionRuntime {
	/** Conversation as pi-canonical turns (user/assistant messages + web-local system notices). */
	turns: ChatTurn[];
	/**
	 * Message-position → turn id, from hydration (`hydrate.ts`'s `HydratedRuntime`); absent until this
	 * chat has been hydrated (a freshly created session never sets it). The `chatLocationRequest`
	 * jump-to-message deep link resolves its `messageIndex` against this map, falling back to the
	 * request's `anchorText` when absent (e.g. an already-live chat `hydrateSession` no-op'd on).
	 */
	turnIdByMessageIndex?: (string | null)[];
	/** Live tool state keyed by toolCallId; paired with the toolCall block inside an assistant turn. */
	toolResults: Record<string, ToolResultState>;
	/** `ask_user_question` replies keyed by tool call id (from `ask-user-answers` custom messages). */
	askAnswers: Record<string, AskUserQuestionResult>;
	currentAssistantId: string | null;
	/** Latest assistant turn observed in the current attempt; scopes overflow-recovery removal. */
	attemptAssistantId: string | null;
	isStreaming: boolean;
	/** This chat's model + thinking level (display only; `pi` owns them). */
	model: WireModel | null;
	thinkingLevel: ThinkingLevel;
	/** Token/cost stats (cheap win #3), refreshed after each turn. */
	stats: SessionStats | null;
	/** Slash commands / skills (cheap win #2). */
	commands: SlashCommandInfo[];
	/** Composer draft, so switching tabs preserves unsent text. */
	draft: string;
	/** The extension-UI dialog awaiting a reply (one shown at a time; overlapping dialogs queue behind it). */
	pendingExtUi: ExtUiDialogRequest | null;
	/** Dialogs that arrived while one was already open — shown FIFO so none orphans its server promise. */
	extUiQueue: ExtUiDialogRequest[];
	/** Extension status-bar entries / widgets (the fire-and-forget `setStatus`/`setWidget` calls). */
	extUiStatus: Record<string, string>;
	extUiWidget: Record<string, string[]>;
}

function newRuntime(model: WireModel | null, thinkingLevel: ThinkingLevel): SessionRuntime {
	return {
		turns: [],
		toolResults: {},
		askAnswers: {},
		currentAssistantId: null,
		attemptAssistantId: null,
		isStreaming: false,
		model,
		thinkingLevel,
		stats: null,
		commands: [],
		draft: "",
		pendingExtUi: null,
		extUiQueue: [],
		extUiStatus: {},
		extUiWidget: {},
	};
}

/** A stable empty runtime for the brief window before a session's runtime exists (read-only fallback). */
export const EMPTY_RUNTIME: SessionRuntime = newRuntime(null, "medium");

/**
 * Clear the `streaming` flag on every assistant turn (returning the same array ref when none was set, to
 * preserve the reducer's "same ref when nothing changes" contract). pi splits one agent run into several
 * assistant messages (one per tool round), but only sends a terminal `done`/`error` for some of them — so
 * an earlier in-flight turn can keep `streaming: true` forever, leaving a stray live-indicator behind. We
 * sweep the flag whenever a *new* assistant message starts and again when the run ends, so at most one turn
 * is ever marked streaming and none survives the turn.
 */
function clearTurnStreaming(turns: ChatTurn[]): ChatTurn[] {
	if (!turns.some((t) => t.kind === "assistant" && t.streaming)) return turns;
	return turns.map((t) => (t.kind === "assistant" && t.streaming ? { ...t, streaming: false } : t));
}

/** Drop the failed assistant attempt Pi removed from its rebuilt context before an overflow retry. */
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

/** Drop `resuming` from compaction turns — the run settled, nothing is resuming anymore. */
function clearCompactionResuming(turns: ChatTurn[]): ChatTurn[] {
	if (!turns.some((t) => t.kind === "compaction" && t.resuming)) return turns;
	return turns.map((t) => {
		if (t.kind !== "compaction" || !t.resuming) return t;
		const { resuming, ...rest } = t;
		return rest;
	});
}

/** Settle the trailing running compaction turn in place (same id — fold stability), or append the
 * settled notice when none is running (client connected mid-compaction). */
function settleCompactionTurn(
	turns: ChatTurn[],
	event: Extract<PiEvent, { type: "compaction_end" }>,
): ChatTurn[] {
	const outcome = compactionOutcome(event);
	const index = turns.findLastIndex((t) => t.kind === "compaction" && t.status === "running");
	if (index < 0) return [...turns, { kind: "compaction", id: crypto.randomUUID(), ...outcome }];
	return turns.map((t, i) => (i === index ? { kind: "compaction", id: t.id, ...outcome } : t));
}

type RetrySource = Extract<ChatTurn, { kind: "retry" }>["source"];

/** Replace-or-append the one live retry countdown of a source (turn vs summarization flows overlap). */
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

/** Drop a source's retry countdown (its flow resolved); other sources' countdowns stay. */
function clearRetryTurns(rt: SessionRuntime, source: RetrySource): SessionRuntime {
	return rt.turns.some((t) => t.kind === "retry" && t.source === source)
		? { ...rt, turns: rt.turns.filter((t) => !(t.kind === "retry" && t.source === source)) }
		: rt;
}

/** Fold one pi event into a session's runtime. Pure — returns the same ref when nothing changes. */
export function reduceSessionEvent(rt: SessionRuntime, event: PiEvent): SessionRuntime {
	switch (event.type) {
		case "agent_start":
			return { ...rt, isStreaming: true, attemptAssistantId: null };
		case "message_start": {
			// The assistant turn is created lazily on the first message_update (from its `partial`
			// snapshot) — here we just reserve its id. A new assistant message also finalizes the previous
			// one (pi may not send it a terminal `done`), so its live indicator doesn't linger.
			if (event.message.role === "assistant")
				return {
					...rt,
					currentAssistantId: crypto.randomUUID(),
					attemptAssistantId: null,
					turns: clearTurnStreaming(rt.turns),
				};
			// A USER message: composer sends append it optimistically (skip the echo — the last turn is
			// its twin), but a HOST-fired prompt (a review send's context package) has no optimistic
			// append — folding it here is what makes the opened review chat start with the sent message
			// instead of a blank transcript. Control messages (pi-todos nudges) stay hidden, like in
			// hydration.
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
			// Streaming variants carry `partial`; the terminals carry `message` (done) / `error`.
			const snapshot =
				"partial" in ame
					? ame.partial
					: ame.type === "done"
						? ame.message
						: ame.type === "error"
							? ame.error
							: null;
			if (!snapshot) return rt;
			// Adopt the in-flight turn even if we missed `message_start` (e.g. hydrated mid-stream) by minting
			// an id; `partial` is cumulative, so the next update reconstructs the whole turn. Set on streaming,
			// clear on a terminal variant.
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
			// An `ask-user-answers` custom message (the questionnaire reply the host injected) indexes into
			// `askAnswers` — the questionnaire card is its rendering, it never becomes a turn. The shared
			// guard validates the details shape, not just the tag; every other custom message falls through
			// to the assistant-only logic below, which ignores it.
			if (isAskUserAnswersMessage(event.message)) {
				const { toolCallId, result } = event.message.details;
				return { ...rt, askAnswers: { ...rt.askAnswers, [toolCallId]: result } };
			}
			// The message's true terminal: pi forwards only *streaming* variants as `message_update` (the
			// LLM-level done/error become this event), so without it the turn would stay flagged streaming
			// until final `agent_settled` — seconds or minutes later when tools run. Adopt the final message too: it
			// carries `stopReason`, which the renderers use to spot dead (aborted/errored) tool calls.
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
			// Attempt-level only: provider retry, compaction/recovery, or queued work may still follow even
			// when `willRetry` is false. `agent_settled` is the one automatic-work terminal.
			return rt;
		case "agent_settled": {
			const failure = assistantFailureText(event.terminal);
			const closer: ChatTurn = failure
				? { kind: "error", id: crypto.randomUUID(), text: failure }
				: // `endedAt` measures the whole automatic run — prompt through retries/compaction/continuations.
					{ kind: "system", id: crypto.randomUUID(), text: "✓ Done", endedAt: Date.now() };
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
			// Show a live countdown over the back-off; cleared on auto_retry_end (or final settlement).
			// Replace-or-append per source: the event fires once per attempt, and the two retry flows
			// (turn vs summarization) may overlap — each keeps exactly one indicator.
			return appendRetryTurn(rt, "turn", event);
		case "auto_retry_end":
			// The retry resolved → normal streaming/answer rendering replaces the indicator.
			return clearRetryTurns(rt, "turn");
		case "summarization_retry_scheduled":
			// A compaction / branch-summary LLM call is backing off (pi ≥0.81.1) — same countdown treatment.
			return appendRetryTurn(rt, "summarization", event);
		case "summarization_retry_finished":
			return clearRetryTurns(rt, "summarization");
		case "thinking_level_changed":
			return { ...rt, thinkingLevel: event.level };
		default:
			return rt;
	}
}

/** Fold an inbound `pi.extensionUi` frame (everything but `setTitle`, which renames a tab) into a runtime. */
function reduceExtUi(
	rt: SessionRuntime,
	request: Exclude<ExtUiRequest, { kind: "setTitle" }>,
): SessionRuntime {
	switch (request.kind) {
		case "dismiss":
			// Server-initiated close — drop the matching dialog from the head (promoting the queue) or the queue.
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
			// Show it now, or queue behind the open one so its server promise still gets answered.
			return rt.pendingExtUi
				? { ...rt, extUiQueue: [...rt.extUiQueue, request] }
				: { ...rt, pendingExtUi: request };
		case "notify":
			return {
				...rt,
				turns: [...rt.turns, { kind: "system", id: crypto.randomUUID(), text: request.message }],
			};
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
	/** Monotonic connection-open generation. Advances with every `connected` status so consumers can
	 * distinguish a reconnect from the previous open socket even though both settle on the same status. */
	connectionGeneration: number;
	/** Advances only when one complete `server.welcome` snapshot lands atomically. */
	welcomeGeneration: number;
	protocolVersion: number | null;
	/** Open projects shown in the Projects tool, newest first. */
	projects: Project[];
	/** Every known project (open + closed) shown under Add project → Recents, newest first. */
	recentProjects: Project[];
	workspaces: Record<string, Workspace[]>;
	/** Permanent local tombstones keep late layout/session reads from recreating removed workspace state. */
	removedWorkspaceIds: Record<string, true>;
	selectedProjectId: string | null;
	activeWorkspaceId: string | null;
	/** Validated-but-unresolved exact-chat route intent; never backend/shared placement state. */
	routeChatTarget: RouteChatTarget | null;
	/** Install edge for same-workspace route targets; clearing does not retrigger catalog reconciliation. */
	routeChatTargetGeneration: number;
	/** Latest accepted host snapshot and the optimistic projection currently rendered. */
	layoutSnapshotsByWorkspace: Record<string, WorkspaceLayoutSnapshot>;
	layoutDocumentsByWorkspace: Record<string, WorkspaceLayoutDocument>;
	layoutAttentionByWorkspace: Record<string, LayoutAttention>;
	layoutPendingByWorkspace: Record<string, PendingLayoutWrite[]>;
	/** Incremented when a nonmatching accepted document or rollback replaces the rendered projection. */
	layoutRemoteEpochByWorkspace: Record<string, number>;
	layoutIntents: LayoutIntent[];
	/** Center resource render caches belong to a workspace — layout documents own placement/order. */
	tabsByWorkspace: Record<string, EditorTab[]>;
	activeTabByWorkspace: Record<string, string | null>;
	/**
	 * Pre-layout compatibility hint for the legacy array cache. Once a layout document is hydrated, previews
	 * never replace cache entries across groups: each center group's actual preview id lives in
	 * `WorkspaceLayoutDocument`, and the cache remains render data rather than placement authority.
	 */
	previewTabByWorkspace: Record<string, string>;
	/**
	 * Compatibility workspace-wide navigation clock for callers that can run before layout attention exists.
	 * Once hydrated, deferred opens use `LayoutAttention.navigationClockByGroup` and request-time destination
	 * stamps, so activity in one center group does not invalidate another group's preview.
	 */
	navTickByWorkspace: Record<string, number>;
	/** Chat tabs the user closed, per workspace (most-recent-first) — reopenable while their runtime lives. */
	closedChatsByWorkspace: Record<string, ClosedChat[]>;
	/** Page-lifetime deletion tombstones. They order async session reads behind `session.deleted`, preventing
	 * an older list/transcript response from restoring a permanently removed chat. */
	deletedSessionsByWorkspace: Record<string, Record<string, true>>;
	/** Terminal domain catalogs are workspace-scoped; placement visibility decides which bodies mount. */
	terminalsByWorkspace: Record<string, TerminalTab[]>;
	activeTerminalByWorkspace: Record<string, string | null>;
	/** One runtime per live chat (keyed by `sessionId`) — many can stream at once; switching is a swap. */
	sessions: Record<string, SessionRuntime>;
	/** Models with configured auth (cheap win #1) — fetched once, shared by every chat's picker. */
	models: WireModel[];
	/** Monotonic host-provider invalidation folded from `provider.changed`; orders async catalog/status reads. */
	providerVersion: number;
	/** Bare invalidation counter for the composer's `/`-menu template cache (`chat/ChatView.tsx`) — the
	 * Templates settings panel (Task B6) bumps it after a `template.save`/`delete`; the store holds only
	 * the counter, never fetches (see `chat/SPEC.md`'s Template slots bullet). */
	templatesVersion: number;
	/** An awaited `model.refresh` is in flight (the picker's freshness affordance) — guards re-entry
	 * and spins the picker's refresh row. */
	modelsRefreshing: boolean;
	/**
	 * Provenance of the `models` list above: true only while it holds the installed result of an awaited
	 * forced `model.refresh` — the one read whose catalog pass had finished when the host answered.
	 *
	 * It lives HERE, beside the list it describes, because `models` is app-wide: a `model.list` install
	 * from any consumer (a picker open, another chat mounting) replaces the list, and authority has to
	 * fall with it. Held as a consumer's local flag instead, it would outlive the list it was about and a
	 * removed model would get confirmed as present, then rejected by `create()`. `model.list` can never
	 * set it, nor can a refresh whose wait was **capped** (`RefreshedModels.complete: false` — current list,
	 * unsettled pass) — `model.list`'s handler starts a *detached* refresh and answers from before it, so the registry can
	 * move underneath the reply with the client none the wiser. A consumer *activating* drops it up front
	 * (`dropModelsFreshness`), because a flag left by an earlier consumer says nothing about whether the
	 * inherited list still matches the registry this activation will be judged against.
	 */
	modelsFresh: boolean;
	/**
	 * A request to surface a file in the Changes tool (e.g. a chat turn-divider's "files changed"
	 * chip). `ChangesPanel` highlights the file's row AND opens its diff tab (a path no longer in the diff
	 * degrades to highlight-only), then **consumes** the request (`clearChangesRequest`) — it opens a center
	 * tab, so a replay on a git-status re-read would steal the user's tab. The same atomic action emits the
	 * shell-owned reveal-tool intent. A fresh object each call so identical re-requests still fire.
	 *
	 * The destination-group clock and compatibility `navTick` are stamped **as the chip is clicked**. The
	 * panel cannot act until `git.status` resolves the path, so without request-time routing the delayed open
	 * could land in a different group or override a newer navigation. See `ChangesPanel`.
	 */
	changesRequest: {
		workspaceId: string;
		path: string;
		navTick: number;
		navigation: CenterNavigationStamp | null;
	} | null;
	/**
	 * A history-search "jump to message" deep link, set by `requestChatLocation` and consumed by
	 * `WorkspaceWorkbench` (open/hydrate the target chat tab) then `ChatView` (scroll to the anchored
	 * turn, then clear it) — a fresh object each call so identical re-requests (e.g. the same hit clicked twice)
	 * still fire.
	 */
	chatLocationRequest: ChatLocationRequest | null;
	/**
	 * A request to open (or, when it is already open, re-trigger) the active chat's history-search
	 * overlay, set by the shell's global `Ctrl+R` handler and consumed by that chat's `ChatView`. The
	 * chord is swallowed app-wide (it would otherwise reload the page), so it fires with focus anywhere —
	 * the file tree, an editor, the transcript — and this is how it reaches the one mounted `ChatView`.
	 * A fresh object each call so a repeated chord still fires.
	 */
	historyOpenRequest: { id: string; sessionId: string } | null;
	/**
	 * A request to surface a spec in the Specs tool (e.g. a chat turn-divider's "specs" chip). The panel
	 * watches it and **opens the rendered spec** — unlike a diff, a spec doc has nothing to preview short of
	 * opening it, and the tree row lights up on its own (rows key off the active tab id). The same atomic
	 * action emits the shell-owned reveal-tool intent; the path request is **consumed** once handled because
	 * replay would steal the user's center tab. A fresh object each call lets identical re-requests fire.
	 */
	specRequest: {
		workspaceId: string;
		path: string;
		navigation: CenterNavigationStamp | null;
	} | null;
	/**
	 * Each workspace's spec-graph snapshot (`spec.graph`), fetched by the Specs panel and kept here so the
	 * chat can classify a written path as a spec without a second read — the ONE definition of "this file is
	 * a spec", shared by the panel that lists them and the turn divider that counts them. Absent until the
	 * first fetch lands; the panel refetches on the workspace fs tick, so it tracks the filesystem.
	 */
	specsByWorkspace: Record<string, SpecGraphNode[]>;
	/**
	 * Each workspace's review snapshot (the open review + its comments). Seeded by the ReviewPanel's
	 * `review.get` read (`setWorkspaceReview`) and converged by `review.changed` pushes
	 * (`applyReviewChanged`) — full snapshots, idempotent under replay; never an optimistic mutation.
	 */
	reviewsByWorkspace: Record<string, ReviewSnapshot>;
	/**
	 * A "focus this review comment in its file" deep link (a Review-panel row click): the pane over that
	 * file consumes it — Monaco reveals the anchor line, the preview scrolls the in-flow card into view
	 * — then clears it. A fresh object each call so re-clicking the same row still fires.
	 */
	reviewFocusRequest: { workspaceId: string; commentId: string } | null;
	/**
	 * The live-refresh signal, per workspace: `tick` increments on every `workspace.fsChanged` push (the
	 * host's debounced worktree change notifier); `paths`/`truncated` are the LAST batch only. Panels
	 * select their workspace's entry and silently refetch on `tick` change — the store holds only the
	 * signal, never fetches.
	 */
	fsChangesByWorkspace: Record<string, { tick: number; paths: string[]; truncated: boolean }>;
	/**
	 * Per workspace, the `fsChangesByWorkspace` tick of the most recent *skill-relevant* batch — host
	 * evidence is `detected` for a concrete project-skill path or `unknown` for a truly pathless event;
	 * generic path-list truncation with `skillChange: "none"` is deliberately irrelevant. Folded alongside
	 * the fs signal in `noteFsChanged`; compared against a session's
	 * `skillsSyncedTickBySession` to derive the Skills-reload badge (`selectSkillsStale`). Accumulated (not
	 * overwritten by a later non-skill batch), so a genuine pending skill change is never lost.
	 */
	skillChangeTickByWorkspace: Record<string, number>;
	/**
	 * Per session, the workspace fs tick it last loaded/reloaded its skills at — set when the runtime is
	 * created (`openChatSession`/`hydrateSession`, anchored to *now* so only a later change flags it) and
	 * bumped on a successful reload (`markSkillsSynced`). Drives `selectSkillsStale`.
	 */
	skillsSyncedTickBySession: Record<string, number>;
	/**
	 * The in-flight in-app OAuth login, if any (flat + session-less — a login runs on the Welcome screen
	 * before any session exists, so it must NOT live under a session runtime, or its frames get dropped).
	 * At most one at a time (the dialog is modal).
	 */
	activeLogin: LoginState | null;
	/** The settings dialog surface — kept in the store so any component (the top-bar gear, the Welcome
	 * provider warning) can open it to a section without prop-drilling through the shell. */
	settingsOpen: boolean;
	settingsSection: SettingsSection;
	/** The active UI theme (host-owned; `applyConfig` sets it from `server.welcome` / `settings.changed`).
	 * The DOM side-effect (`applyTheme`) is the shell's job — this holds the value the UI reads. */
	theme: ThemeId;
	/** Anonymous-usage-analytics switch (host-owned, same `applyConfig` fold as `theme`). Only this boolean
	 * ever reaches a client — events are emitted host-side and the install id never crosses the wire. */
	analyticsEnabled: boolean;
	/** How much terminal output the host keeps for replay, in KiB (host-owned; same `applyConfig` fold). */
	terminalReplayKb: number;
	/** Host-owned preset/default/side-limit settings. */
	layoutSettings: LayoutSettings;
	/** Transient notifications, oldest-first (the Toaster renders + times them out). At-most a handful live
	 * at once; a failed wire call that has no better home (no chat tab to host an error turn) lands here. */
	toasts: Toast[];
	setStatus: (status: ConnectionStatus) => void;
	/** Install protocol, project views, optional config, and the complete-welcome edge in one write. */
	installWelcomeSnapshot: (
		protocolVersion: number,
		projects: Project[],
		recentProjects: Project[],
		config?: AppConfig,
	) => void;
	/** Install the host's open + recent project views atomically and repair stale navigation. */
	installProjectSnapshot: (projects: Project[], recentProjects: Project[]) => void;
	/** Fold one authoritative project snapshot into both views and repair navigation after close. */
	applyProjectUpdated: (project: Project) => void;
	setWorkspaces: (projectId: string, workspaces: Workspace[]) => void;
	/**
	 * Fold a server-pushed `workspace.created` snapshot in (**upsert** by id). A project never fetched is a
	 * **no-op** — a client that hasn't opened the project reconciles on its next `workspace.list` rather
	 * than being handed a partial one-row list (a wrong count); otherwise add if absent / merge if present
	 * (idempotent with the creating client's own post-create re-list).
	 */
	addWorkspace: (workspace: Workspace) => void;
	/**
	 * Fold a server-pushed `workspace.updated` snapshot in (e.g. the auto-rename): **replace** the record by
	 * id in the project's list, carrying over only the locally-computed `diffStats`. The push is
	 * authoritative — a *merge* could never clear an optional field the server dropped (`diffBase` back to
	 * the creation base, the last `skillOverrides` entry), leaving the client reading a value the host no
	 * longer has. A project never fetched, or an id absent from its list, is a no-op — the next
	 * `workspace.list` reconciles.
	 */
	updateWorkspace: (workspace: Workspace) => void;
	/** Drop a workspace from its project's list (a missing project/id is a no-op). The primitive behind
	 * `applyWorkspaceRemoved`; not called directly by the remove flow (that reacts to the push). */
	removeWorkspace: (projectId: string, workspaceId: string) => void;
	/**
	 * React to a server-pushed `workspace.removed` — the **entire** removal reaction, run identically by
	 * every client (including the one that initiated the remove, so there's no per-client optimism): drop
	 * the row + clear its tabs/terminals/chat runtimes (`clearWorkspaceTabs`), and **if it was this
	 * client's active workspace** return to its owning Project Home and raise a neutral toast (reads
	 * correctly for both the initiator and an observer).
	 */
	applyWorkspaceRemoved: (projectId: string, workspaceId: string) => void;
	/** Enter a project's home, atomically clearing any active workspace. */
	selectProject: (projectId: string) => void;
	/** Enter the client-local main/Welcome location. */
	selectMain: () => void;
	/** Enter a workspace and select its owning project in one state transition. */
	activateWorkspace: (workspace: Pick<Workspace, "id" | "projectId">) => void;
	/** Apply a validated route and optionally install its exact-chat target in the same local-state write. */
	activateWorkspaceFromRoute: (
		workspace: Pick<Workspace, "id" | "projectId">,
		sessionId?: string,
	) => void;
	/** Mark the current route target present in a successful authoritative session catalog. */
	validateRouteChatTarget: (sessionId: string) => void;
	clearRouteChatTarget: () => void;
	installLayoutSnapshot: (snapshot: WorkspaceLayoutSnapshot, mutationId?: string) => void;
	applyLayoutChanged: (payload: LayoutChangedPayload) => void;
	beginLayoutCommit: (
		workspaceId: string,
		document: WorkspaceLayoutDocument,
		mutationId: string,
	) => void;
	rejectLayoutCommit: (workspaceId: string, mutationId: string) => void;
	applyLayoutConflict: (
		workspaceId: string,
		mutationId: string,
		current: WorkspaceLayoutSnapshot | null,
	) => void;
	setLayoutAttention: (workspaceId: string, attention: LayoutAttention) => void;
	/** Mirror a selected workbench resource into the temporary legacy render-cache projection without
	 * counting structural reconciliation as user navigation. */
	syncLegacySelection: (
		workspaceId: string,
		selection: { kind: "editor"; tabId: string } | { kind: "terminal"; tabKey: string } | null,
	) => void;
	enqueueLayoutIntent: (intent: LayoutIntentInput) => string;
	consumeLayoutIntent: (id: string) => void;
	/** Cache a center resource and queue its arrangement-agnostic open. The shell owns actual placement,
	 * per-group preview replacement, and attention; options preserve a deferred request's destination. */
	openTab: (
		tab: EditorTab,
		intent: TabIntent,
		syncLayout?: boolean,
		options?: LayoutOpenOptions,
	) => void;
	/** Cache and open a registered center document or live plan page. Shared placement keeps only its
	 * resolver identity, never inline markdown. */
	openDoc: (tab: DocTab | PlanTab) => void;
	closeTab: (
		id: string,
		syncLayout?: boolean,
		countNavigation?: boolean,
		workspaceId?: string,
	) => void;
	/** Activate a tab. `intent: "keep"` also promotes it out of the preview slot — one-way: nothing ever
	 * demotes a kept tab back to preview. */
	setActiveTab: (id: string, intent?: TabIntent, syncLayout?: boolean) => void;
	/** Advance the last-focused center group's local clock at request time and return its destination stamp. */
	beginCenterNavigation: (
		workspaceId: string,
		preferredGroupId?: string,
	) => CenterNavigationStamp | null;
	/** Advance the compatibility workspace clock for a focus change already represented in local attention. */
	noteNavigation: (workspaceId: string) => void;
	/** Set a markdown file tab's view mode (rendered ↔ source); kept on the tab so it survives tab switches. */
	setFileTabView: (id: string, view: "rendered" | "source") => void;
	setDiffTabView: (id: string, view: DiffTabView) => void;
	setDiffTabRendered: (id: string, rendered: boolean) => void;
	setDiffTabIgnoreWhitespace: (id: string, ignoreWhitespace: boolean) => void;
	/** How the Changes panel lays out its changed files — flat `list` or a `tree` of folders. App-wide,
	 * persisted in the store (not per workspace) so the choice survives workspace switches. */
	changesView: "list" | "tree";
	setChangesView: (view: "list" | "tree") => void;
	/**
	 * What each workspace's Changes panel diffs (see `selectDiffScope` for the default). Per workspace, not
	 * app-wide: a scope belongs to that branch's review — a commit sha means nothing in another worktree.
	 */
	diffScopeByWorkspace: Record<string, GitDiffScope>;
	setDiffScope: (workspaceId: string, scope: GitDiffScope) => void;
	/** Fold a `workspace.fsChanged` push into the live-refresh signal (tick++, last batch replaces). */
	noteFsChanged: (payload: WorkspaceFsChangedPayload) => void;
	/**
	 * Record a session's skills as synced to `syncedTick` — the workspace fs tick captured at the *start* of
	 * the reload round-trip (`selectWorkspaceTick`), so a skill change folded while the reload was in flight
	 * (which the reload did not load) stays past the baseline and keeps the badge lit.
	 */
	markSkillsSynced: (sessionId: string, syncedTick: number) => void;
	/** Replace a file tab's content after a live re-read, recording the fs tick it was loaded at. Shared
	 * placement ids are only workspace-local, so the captured workspace participates in the lookup. */
	updateFileTabContent: (workspaceId: string, id: string, content: string, tick: number) => void;
	/**
	 * Replace a diff tab's two sides after a live re-read (see `DiffPane`), recording the fs tick **and** the
	 * review target the fresh content was read against — the two dimensions a diff tab is live in, written
	 * together so neither can outlive the content it describes.
	 */
	updateDiffTabContent: (
		workspaceId: string,
		id: string,
		original: string,
		modified: string,
		tick: number,
		loadedTarget: string,
	) => void;
	clearWorkspaceTabs: (workspaceId: string) => void;
	addTerminal: (workspaceId: string, initialCommand?: string, targetGroupId?: string) => void;
	setWorkspaceTerminals: (workspaceId: string, tabs: TerminalTabInfo[]) => void;
	settleTerminalAttach: (workspaceId: string, tabKey: string) => void;
	consumeTerminalInitialCommand: (workspaceId: string, tabKey: string) => void;
	closeTerminalTab: (workspaceId: string, tabKey: string, syncLayout?: boolean) => void;
	setActiveTerminalTab: (workspaceId: string, tabKey: string, syncLayout?: boolean) => void;
	openChatSession: (
		workspaceId: string,
		sessionId: string,
		model: WireModel | null,
		thinkingLevel: ThinkingLevel,
		/** Skills sync baseline — the workspace tick captured after `workspace.watchReady` and *before*
		 * `session.create`; omit to anchor at call time (fine when there's no async load in between). */
		syncedTick?: number,
		/** Request-time destination/activation arbitration for a deferred create. */
		options?: LayoutOpenOptions,
	) => void;
	/** Drop a chat's runtime on tab close (the `AgentSession` is disposed over the wire by the caller). */
	closeChatRuntime: (sessionId: string) => void;
	/** Close a chat tab to history: remove the tab but keep its runtime + session alive for reopening. */
	closeChatToHistory: (
		sessionId: string,
		syncLayout?: boolean,
		workspaceId?: string,
		countNavigation?: boolean,
	) => void;
	/** Tombstone a server-deleted chat and drop every client-side surface/state bucket in one write. */
	deleteChat: (workspaceId: string, sessionId: string, countNavigation?: boolean) => void;
	/**
	 * Reconcile a `session.list` result against the local membership captured when that read began. Only
	 * baseline ids absent from the authoritative result are deleted, so a session created while the read
	 * was in flight cannot be removed by its older response.
	 */
	reconcileWorkspaceSessions: (
		workspaceId: string,
		baselineSessionIds: readonly string[],
		authoritativeSessionIds: readonly string[],
	) => void;
	/** Reopen a chat from history (its runtime is still live, so the full transcript returns instantly). */
	reopenChat: (workspaceId: string, sessionId: string, options?: LayoutOpenOptions) => void;
	/** Reconcile the legacy render cache to an authoritative shared chat placement, without navigating. */
	restorePlacedChatCache: (
		workspaceId: string,
		tabId: string,
		sessionId: string,
		title: string,
	) => void;
	/**
	 * Record disk-only sessions (from `session.list`) in chat-history so they can be reopened on demand.
	 * Skips any already live, open as a tab, or already listed — so it's idempotent across re-hydration.
	 */
	noteClosedChats: (workspaceId: string, entries: ClosedChat[]) => void;
	/**
	 * Rebuild a chat's runtime + tab from the host's report on connect — a no-op if a runtime already exists.
	 * Drops the session from chat-history (it's open now). `activate` focuses the tab (a user-driven reopen);
	 * otherwise it only takes focus if the workspace has none yet (auto-restore must not steal focus).
	 */
	hydrateSession: (
		summary: SessionSummary,
		hydrated: HydratedRuntime,
		activate?: boolean,
		/** Skills sync baseline — captured after `workspace.watchReady` and *before* `session.getMessages`,
		 * passed **only** for a disk-only attach (which reloads resources against current disk). Omit for a
		 * live restore (transcript only, no reload): the baseline is left unset so the chat stays stale. */
		syncedTick?: number,
		options?: LayoutOpenOptions,
	) => void;
	appendUserMessage: (sessionId: string, text: string) => void;
	/**
	 * Surface a failed send as a visible error turn. The turn-driving wire calls (`session.prompt`/`steer`/
	 * `followUp`/`create`) can reject before any pi event streams — e.g. `prompt()` throws "no API key" /
	 * validates a bad model. Without this the rejection is swallowed and the chat looks frozen.
	 */
	appendErrorTurn: (sessionId: string, text: string) => void;
	handlePiEvent: (event: PiEvent, sessionId: string) => void;
	/** Install a model-list reply only if no newer provider invalidation has landed. */
	setModelsForProviderVersion: (providerVersion: number, models: WireModel[]) => void;
	/** Atomically invalidate model choices and advance the provider generation observed by settings. */
	noteProviderChanged: () => void;
	bumpTemplatesVersion: () => void;
	/** Atomic begin/finish of the awaited catalog refresh — `finish` lands the new list (null = failed
	 * refresh: keep the current list, and with it its provenance) and clears the flag in ONE write. The
	 * host's `complete` decides provenance: a capped wait can answer with a list that is current but not
	 * settled, and only a settled one is authority. */
	beginModelsRefresh: () => number;
	finishModelsRefresh: (providerVersion: number, result: RefreshedModels | null) => void;
	/** Give up authority without replacing the list — a consumer activating can't yet know whether the
	 * list it inherited still matches the host registry. */
	dropModelsFreshness: () => void;
	setCurrentModel: (sessionId: string, model: WireModel) => void;
	setThinkingLevel: (sessionId: string, level: ThinkingLevel) => void;
	setStats: (sessionId: string, stats: SessionStats) => void;
	setCommands: (sessionId: string, commands: SlashCommandInfo[]) => void;
	setChatDraft: (sessionId: string, text: string) => void;
	/** Reply to a chat's active dialog (clears it, promoting the queue; the transport send is `ChatView`'s job). */
	clearPendingExtUi: (sessionId: string, id: string) => void;
	/** Route an inbound `pi.extensionUi` frame to its session's runtime (dialogs/notices/status/widget/title). */
	applyExtUi: (request: ExtUiRequest) => void;
	/** Open the login dialog for a just-started login (the `provider.loginStart` handle). */
	beginLogin: (loginId: string, providerId: string) => void;
	/** Fold an inbound `provider.login` frame into `activeLogin` (creating it if the frame beat `beginLogin`). */
	applyLoginFrame: (push: LoginPush) => void;
	/** Drop the input from the active login the moment a reply is sent (avoids a double-submit). */
	clearLoginInput: () => void;
	/** Dismiss the login dialog (cancel or after a terminal frame). */
	clearLogin: () => void;
	/** Open the settings dialog, optionally deep-linked to a section (defaults to Providers). */
	openSettings: (section?: SettingsSection) => void;
	closeSettings: () => void;
	setSettingsSection: (section: SettingsSection) => void;
	/** Fold the server-synced app config in (from `server.welcome` / the `settings.changed` broadcast). */
	applyConfig: (config: AppConfig) => void;
	/** Reveal a singleton workbench tool — no path, just the tool (a chip revealing its list). */
	requestToolView: (workspaceId: string, tool: LayoutToolId) => void;
	/** Reveal Changes and surface `path` in it (deep-link from chat). */
	requestChangesView: (workspaceId: string, path: string) => void;
	/** Drop the Changes deep-link once handled (it opens a diff tab — it must fire exactly once). */
	clearChangesRequest: () => void;
	/**
	 * Open a history-search hit: sets `chatLocationRequest` AND switches `activeWorkspaceId` (the hit's
	 * chat can live in a different workspace than the one the search ran from).
	 */
	requestChatLocation: (req: ChatLocationRequest) => void;
	/** Dismiss the jump deep link once `ChatView` has consumed it (scrolled to the anchored turn). */
	clearChatLocation: () => void;
	/**
	 * Ask a chat to open its history-search overlay (the shell's global `Ctrl+R`). Activates the target
	 * tab **atomically** with the request: the chord fires over any tab, and the workbench mounts one tab
	 * body at a time, so a request for a chat that isn't on screen would never be consumed.
	 */
	requestHistoryOpen: (target: HistoryTarget) => void;
	/** Dismiss the history-open request once `ChatView` has acted on it. */
	clearHistoryOpen: () => void;
	/** Reveal Specs and open `path` in its rendered-document view (deep-link from chat). */
	requestSpecView: (workspaceId: string, path: string) => void;
	/** Drop the spec deep-link once a panel has acted on it (it opens a tab — it must fire exactly once). */
	clearSpecRequest: () => void;
	/** Record a workspace's fetched spec-graph snapshot (`useWorkspaceSpecs`' read lands here). */
	setWorkspaceSpecs: (workspaceId: string, nodes: SpecGraphNode[]) => void;
	/** Record a workspace's review snapshot (the ReviewPanel's `review.get` read lands here). */
	setWorkspaceReview: (workspaceId: string, snapshot: ReviewSnapshot) => void;
	/** Ask the file's pane to focus a review comment (open the tab first — the pane consumes this). */
	requestReviewFocus: (workspaceId: string, commentId: string) => void;
	/** Drop the focus request once a pane has acted on it (it scrolls — it must fire exactly once). */
	clearReviewFocus: (commentId?: string) => void;
	/** Fold a `review.changed` push in — the same full snapshot every client converges on. */
	applyReviewChanged: (payload: ReviewChangedPayload) => void;
	/** Enqueue a toast; returns its id so a caller can dismiss it early. An identical live toast (same
	 * variant/title/message — e.g. a retried failure) coalesces: no twin is added, the existing id returns.
	 * The queue caps at `MAX_TOASTS` (oldest drop). Prefer the `toast` helper. */
	pushToast: (toast: Omit<Toast, "id">) => string;
	/** Drop a toast (user dismiss or the Toaster's auto-timeout). A missing id is a no-op. */
	dismissToast: (id: string) => void;
}

/** Newest-first project ordering, copied so a wire array is never mutated in place. */
function sortProjects(projects: Project[]): Project[] {
	return [...projects].sort((a, b) => b.lastOpened - a.lastOpened);
}

/** One config projection shared by startup welcome and later `settings.changed` pushes. */
function configPatch(config: AppConfig) {
	return {
		theme: config.theme,
		analyticsEnabled: config.analyticsEnabled,
		terminalReplayKb: config.terminalReplayKb,
		layoutSettings: config.layout ?? DEFAULT_CONFIG.layout,
	};
}

/** Replace one full project snapshot by id, or append it when this client has not seen it yet. */
function upsertProject(projects: Project[], project: Project): Project[] {
	return projects.some((candidate) => candidate.id === project.id)
		? projects.map((candidate) => (candidate.id === project.id ? project : candidate))
		: [...projects, project];
}

/**
 * A project close is domain state, but the fallback is this client's view state. Repair it only when the
 * current Project Home or active workspace belongs to a project no longer in the open projection.
 */
function reconcileProjectNavigation(
	state: Pick<AppState, "selectedProjectId" | "activeWorkspaceId" | "workspaces">,
	projects: Project[],
): Pick<AppState, "selectedProjectId" | "activeWorkspaceId"> | Record<string, never> {
	const currentProjectId = selectActiveWorkspaceProjectId(state) ?? state.selectedProjectId;
	if (!currentProjectId || projects.some((project) => project.id === currentProjectId)) return {};
	return { selectedProjectId: projects[0]?.id ?? null, activeWorkspaceId: null };
}

/**
 * A record without `key` — the immutable delete behind every per-workspace / per-session cleanup here
 * (`applyWorkspaceRemoved`, `clearWorkspaceTabs`, `closeSession`, the ext-UI request drops). One helper so a
 * new keyed map added to the state can be cleaned up with a single readable line.
 */
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

/** Whether this page has already observed permanent deletion of a workspace chat. */
function isSessionDeleted(
	state: Pick<AppState, "deletedSessionsByWorkspace">,
	workspaceId: string,
	sessionId: string,
): boolean {
	return state.deletedSessionsByWorkspace[workspaceId]?.[sessionId] === true;
}

/**
 * Merge a partial into one diff tab of the **active** workspace — the shared body of every per-tab diff
 * view toggle (layout, rendered, hide-whitespace), so adding a toggle is one line instead of another copy
 * of the locate-and-map dance. Returns an empty patch (a no-op `set`) when there is no such tab.
 */
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

/** Field-wise equality of two spec-graph nodes — every field the DTO carries, so "unchanged" is honest. */
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

/**
 * Advance a workspace's compatibility center-navigation count. New deferred opens additionally use the
 * destination group's local clock; this scalar remains while legacy render-cache actions are migrated.
 */
function bumpNav(s: AppState, workspaceId: string): Record<string, number> {
	return { ...s.navTickByWorkspace, [workspaceId]: selectWorkspaceNavTick(s, workspaceId) + 1 };
}

function bumpLayoutProjectionEpoch(s: AppState, workspaceId: string): Record<string, number> {
	return {
		...s.layoutRemoteEpochByWorkspace,
		[workspaceId]: (s.layoutRemoteEpochByWorkspace[workspaceId] ?? 0) + 1,
	};
}

function nextExpectedLayoutRevision(state: AppState, workspaceId: string): number | null {
	const predecessor = state.layoutPendingByWorkspace[workspaceId]?.at(-1);
	if (predecessor) {
		return predecessor.expectedRevision === null ? 1 : predecessor.expectedRevision + 1;
	}
	return state.layoutSnapshotsByWorkspace[workspaceId]?.revision ?? null;
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

/** Capture the current center destination without superseding an earlier user navigation. */
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

/**
 * Whether accepting a structural focus must advance its destination clock. A surviving request group was
 * already advanced at request time; a removed group cannot carry that clock forward, so its rerouted
 * destination advances once when the resource actually lands.
 */
export function shouldAdvanceAcceptedNavigation(
	attention: LayoutAttention,
	navigation: CenterNavigationStamp | null | undefined,
): boolean {
	if (navigation === undefined || navigation === null) return true;
	return readLayoutNavigationClock(attention, navigation.groupId) === undefined;
}

/** A removed destination deliberately reads as current: the shell reroutes it to current last focus. */
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

/**
 * The immutable chat-deletion fold shared by a direct `session.deleted` event and reconnect membership
 * reconciliation. Returning the original state makes both paths idempotent without duplicating cleanup.
 */
function withoutChat(
	s: AppState,
	workspaceId: string,
	sessionId: string,
	countNavigation: boolean,
): AppState {
	if (s.removedWorkspaceIds[workspaceId]) return s;
	const alreadyDeleted = isSessionDeleted(s, workspaceId, sessionId);
	const tabs = s.tabsByWorkspace[workspaceId] ?? [];
	// A chat owns its transcript plus any registered legacy document or live plan page.
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

/**
 * Whether a re-read produced the same graph. The Specs read refetches on every worktree fs tick, and most
 * ticks change no spec at all — keeping the previous array identity on those makes the refetch free for
 * `ChatView`, whose `isSpec` memo (and with it `deriveRows` over the whole transcript, for every open chat)
 * would otherwise be invalidated about once a second during any file activity.
 */
function sameSpecGraph(prev: SpecGraphNode[] | undefined, next: SpecGraphNode[]): boolean {
	if (!prev || prev.length !== next.length) return false;
	return prev.every((node, i) => {
		const candidate = next[i];
		return candidate !== undefined && sameSpecNode(node, candidate);
	});
}

/**
 * Whether a re-read/push carries the same review snapshot. The ReviewPanel's read refetches on every
 * worktree fs tick (`useWorkspaceRead`), and most ticks change no comment — keeping the previous object
 * identity there (the `sameSpecGraph` pattern) spares every review consumer a re-render per tick. The
 * DTOs are small plain-JSON trees, so a structural stringify compare is the honest cheap check.
 */
function sameReviewSnapshot(prev: ReviewSnapshot | undefined, next: ReviewSnapshot): boolean {
	return prev !== undefined && JSON.stringify(prev) === JSON.stringify(next);
}

/** Apply an immutable update to one session's runtime; a no-op (and no new `sessions` object) if it's gone. */
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

/** A fresh in-app login (the `provider.loginStart` handle arrived, or the first frame did). */
function newLoginState(loginId: string, providerId: string): LoginState {
	return { loginId, providerId, status: "active" };
}

/**
 * Fold one streamed `LoginFrame` into the accumulating login state. `url`/`deviceCode` add to what's shown;
 * `select`/`prompt` set the live input (dropping stale progress); `success`/`error` are terminal and clear
 * the input/progress. Keys are dropped rather than set to `undefined` (`exactOptionalPropertyTypes`).
 */
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

/**
 * The next free "Terminal N" label: one past the highest number currently in use.
 *
 * `list.length + 1` collided — with two terminals open, closing "Terminal 1" and adding another produced a
 * second "Terminal 2". The number is parsed back out of the title because the title is where it lives; an
 * unparseable one (a future rename) simply doesn't constrain the next number.
 */
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
	projects: [],
	recentProjects: [],
	workspaces: {},
	removedWorkspaceIds: Object.create(null) as Record<string, true>,
	selectedProjectId: null,
	activeWorkspaceId: null,
	routeChatTarget: null,
	routeChatTargetGeneration: 0,
	layoutSnapshotsByWorkspace: {},
	layoutDocumentsByWorkspace: {},
	layoutAttentionByWorkspace: {},
	layoutPendingByWorkspace: {},
	layoutRemoteEpochByWorkspace: {},
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
	layoutSettings: DEFAULT_CONFIG.layout,
	toasts: [],
	setStatus: (status) =>
		set((state) => ({
			status,
			connectionGeneration:
				status === "connected" ? state.connectionGeneration + 1 : state.connectionGeneration,
		})),
	installWelcomeSnapshot: (protocolVersion, projects, recentProjects, config) =>
		set((state) => {
			const openProjects = sortProjects(projects.filter((project) => project.closed !== true));
			return {
				protocolVersion,
				projects: openProjects,
				recentProjects: sortProjects(recentProjects),
				...(config ? configPatch(config) : {}),
				...reconcileProjectNavigation(state, openProjects),
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
			// Unlisted project → no-op: reconcile on its next `workspace.list` rather than seed a partial
			// one-row list. Otherwise upsert by id (merge if somehow already present).
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
					// The push replaces the record (so a field the server *dropped* clears here too), except for
					// `diffStats`: the persisted snapshot carries no computed stats, and a bare replace would wipe
					// the list-computed aggregate until the next list.
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
		const name = s.workspaces[projectId]?.find((w) => w.id === workspaceId)?.name;
		// Install finality FIRST. Zustand subscribers run synchronously after each write; without this first
		// transaction, a terminal/dialog subscriber reacting to cleanup could recreate a workspace-scoped map
		// in the gap before the tombstone existed.
		set((state) => {
			const removedSessions = new Set(selectWorkspaceSessionIds(state, workspaceId));
			return {
				removedWorkspaceIds: Object.assign(Object.create(null), state.removedWorkspaceIds, {
					[workspaceId]: true,
				}) as Record<string, true>,
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
		s.clearWorkspaceTabs(workspaceId); // drops the row's tabs + terminals + chat runtimes
		if (wasActive) {
			s.selectProject(projectId); // atomically fall back to the removed workspace's Project Home
			toast.info(`Workspace "${name ?? "?"}" was removed`);
		}
	},
	selectProject: (selectedProjectId) => set({ selectedProjectId, activeWorkspaceId: null }),
	selectMain: () =>
		set({ selectedProjectId: null, activeWorkspaceId: null, routeChatTarget: null }),
	activateWorkspace: (workspace) =>
		set((state) =>
			state.removedWorkspaceIds[workspace.id]
				? {}
				: { selectedProjectId: workspace.projectId, activeWorkspaceId: workspace.id },
		),
	activateWorkspaceFromRoute: (workspace, sessionId) =>
		set((state) => {
			if (state.removedWorkspaceIds[workspace.id]) return {};
			const advanced = advanceCenterNavigation(state, workspace.id);
			return {
				...advanced.patch,
				selectedProjectId: workspace.projectId,
				activeWorkspaceId: workspace.id,
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
	installLayoutSnapshot: (snapshot, mutationId) =>
		set((state) => {
			const workspaceId = snapshot.workspaceId;
			if (state.removedWorkspaceIds[workspaceId]) return {};
			const current = state.layoutSnapshotsByWorkspace[workspaceId];
			const pending = state.layoutPendingByWorkspace[workspaceId] ?? [];
			const matched = mutationId
				? pending.findIndex((write) => write.mutationId === mutationId)
				: -1;
			// An acknowledgement for a later queued write proves every predecessor was already ordered before it
			// by the host. Settle the whole accepted prefix so an out-of-order/lost earlier response cannot
			// project an obsolete mutation back over the newest accepted document.
			const remaining = matched >= 0 ? pending.slice(matched + 1) : pending;
			const newer = !current || snapshot.revision > current.revision;
			const accepted = newer ? snapshot : current;
			if (!accepted) return {};
			const projected = remaining.at(-1)?.document ?? accepted.document;
			return {
				layoutSnapshotsByWorkspace: {
					...state.layoutSnapshotsByWorkspace,
					[workspaceId]: accepted,
				},
				layoutDocumentsByWorkspace: {
					...state.layoutDocumentsByWorkspace,
					[workspaceId]: projected,
				},
				layoutPendingByWorkspace: {
					...state.layoutPendingByWorkspace,
					[workspaceId]: remaining,
				},
				layoutRemoteEpochByWorkspace:
					newer && matched < 0
						? bumpLayoutProjectionEpoch(state, workspaceId)
						: state.layoutRemoteEpochByWorkspace,
			};
		}),
	applyLayoutChanged: (payload) =>
		get().installLayoutSnapshot(payload.snapshot, payload.mutationId),
	beginLayoutCommit: (workspaceId, document, mutationId) =>
		set((state) =>
			state.removedWorkspaceIds[workspaceId]
				? {}
				: {
						layoutDocumentsByWorkspace: {
							...state.layoutDocumentsByWorkspace,
							[workspaceId]: document,
						},
						layoutPendingByWorkspace: {
							...state.layoutPendingByWorkspace,
							[workspaceId]: [
								...(state.layoutPendingByWorkspace[workspaceId] ?? []),
								{
									mutationId,
									expectedRevision: nextExpectedLayoutRevision(state, workspaceId),
									document,
								},
							],
						},
					},
		),
	rejectLayoutCommit: (workspaceId, mutationId) =>
		set((state) => {
			const pending = state.layoutPendingByWorkspace[workspaceId] ?? [];
			const rejectedIndex = pending.findIndex((write) => write.mutationId === mutationId);
			if (rejectedIndex < 0) return {};
			const remaining = pending.slice(0, rejectedIndex);
			const fallback = remaining.at(-1)?.document;
			const accepted = state.layoutSnapshotsByWorkspace[workspaceId];
			if (!accepted) {
				return {
					layoutPendingByWorkspace: {
						...state.layoutPendingByWorkspace,
						[workspaceId]: remaining,
					},
					layoutDocumentsByWorkspace: fallback
						? {
								...state.layoutDocumentsByWorkspace,
								[workspaceId]: fallback,
							}
						: omitKey(state.layoutDocumentsByWorkspace, workspaceId),
					layoutRemoteEpochByWorkspace: bumpLayoutProjectionEpoch(state, workspaceId),
				};
			}
			return {
				layoutPendingByWorkspace: {
					...state.layoutPendingByWorkspace,
					[workspaceId]: remaining,
				},
				layoutDocumentsByWorkspace: {
					...state.layoutDocumentsByWorkspace,
					[workspaceId]: remaining.at(-1)?.document ?? accepted.document,
				},
				layoutRemoteEpochByWorkspace: bumpLayoutProjectionEpoch(state, workspaceId),
			};
		}),
	applyLayoutConflict: (workspaceId, mutationId, current) =>
		set((state) => {
			if (state.removedWorkspaceIds[workspaceId]) return {};
			const pending = state.layoutPendingByWorkspace[workspaceId] ?? [];
			const conflictingIndex = pending.findIndex((write) => write.mutationId === mutationId);
			if (conflictingIndex < 0) return {};
			const remaining = pending.slice(0, conflictingIndex);
			const expectedRevision = pending[conflictingIndex]?.expectedRevision;
			const alreadyAccepted = state.layoutSnapshotsByWorkspace[workspaceId];
			// A later accepted broadcast can overtake the conflict response in transit. Preserve that newer
			// authority instead of regressing to the snapshot (or absence) observed when the host checked.
			const accepted = current
				? !alreadyAccepted || current.revision >= alreadyAccepted.revision
					? current
					: alreadyAccepted
				: alreadyAccepted &&
						(expectedRevision === null ||
							(expectedRevision !== undefined && alreadyAccepted.revision > expectedRevision))
					? alreadyAccepted
					: null;
			const projected = remaining.at(-1)?.document ?? accepted?.document;
			return {
				layoutSnapshotsByWorkspace: accepted
					? { ...state.layoutSnapshotsByWorkspace, [workspaceId]: accepted }
					: omitKey(state.layoutSnapshotsByWorkspace, workspaceId),
				layoutDocumentsByWorkspace: projected
					? { ...state.layoutDocumentsByWorkspace, [workspaceId]: projected }
					: omitKey(state.layoutDocumentsByWorkspace, workspaceId),
				layoutPendingByWorkspace: {
					...state.layoutPendingByWorkspace,
					[workspaceId]: remaining,
				},
				layoutRemoteEpochByWorkspace: bumpLayoutProjectionEpoch(state, workspaceId),
			};
		}),
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
			// Already open: focus it. A `keep` promotes it; a `preview` deliberately leaves every tab's state
			// alone, so re-clicking a kept tab in the tree never demotes it and never steals the slot.
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
			// Before layout hydration, preserve the retired one-strip cache behavior. A hydrated workbench must
			// append instead: replacing this workspace-wide hint would evict another center group's preview body.
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
				// Only an accepted user close that actually moves focus is navigation. Structural cache
				// reconciliation suppresses this compatibility bump.
				navTickByWorkspace: wasActive && countNavigation ? bumpNav(s, wsId) : s.navTickByWorkspace,
				// A closed tab must never leave a dangling slot id behind.
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
			// The host classifies skill evidence before its generic path cap, so a large concrete non-skill
			// batch cannot masquerade as a resource change and an over-cap skill path is not lost.
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
			// A reload can resolve after its chat was disposed (closeChatRuntime/clearWorkspaceTabs) — don't
			// resurrect a dropped baseline for a session that no longer exists.
			if (!s.sessions[sessionId]) return {};
			// Monotonic: out-of-order reload completions (an older request landing last) must never move the
			// baseline backward and re-light the badge — "synced up to at least tick X" only ever advances.
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
			// Drop the runtimes of this workspace's chats — both open tabs and closed-to-history ones (their
			// AgentSessions are freed on host shutdown).
			const sessions = { ...s.sessions };
			const skillsSyncedTickBySession = { ...s.skillsSyncedTickBySession };
			for (const sessionId of selectWorkspaceSessionIds(s, workspaceId)) {
				delete sessions[sessionId];
				delete skillsSyncedTickBySession[sessionId];
			}
			return {
				layoutSnapshotsByWorkspace: omitKey(s.layoutSnapshotsByWorkspace, workspaceId),
				layoutDocumentsByWorkspace: omitKey(s.layoutDocumentsByWorkspace, workspaceId),
				layoutAttentionByWorkspace: omitKey(s.layoutAttentionByWorkspace, workspaceId),
				layoutPendingByWorkspace: omitKey(s.layoutPendingByWorkspace, workspaceId),
				layoutRemoteEpochByWorkspace: omitKey(s.layoutRemoteEpochByWorkspace, workspaceId),
				layoutIntents: s.layoutIntents.filter((intent) => intent.workspaceId !== workspaceId),
				tabsByWorkspace: omitKey(s.tabsByWorkspace, workspaceId),
				activeTabByWorkspace: omitKey(s.activeTabByWorkspace, workspaceId),
				previewTabByWorkspace: omitKey(s.previewTabByWorkspace, workspaceId),
				navTickByWorkspace: omitKey(s.navTickByWorkspace, workspaceId),
				closedChatsByWorkspace: omitKey(s.closedChatsByWorkspace, workspaceId),
				// Deletion tombstones deliberately survive: an older read can still settle after teardown.
				// Dropping terminal catalogs unmounts browser bodies; workspace cleanup remains host-owned.
				terminalsByWorkspace: omitKey(s.terminalsByWorkspace, workspaceId),
				activeTerminalByWorkspace: omitKey(s.activeTerminalByWorkspace, workspaceId),
				sessions,
				skillsSyncedTickBySession,
			};
		}),
	// Create one attach-pending domain tab and ask the layout engine to place it. A center Group Header
	// captures its group so terminal creation remains available even when no terminal body is mounted.
	addTerminal: (workspaceId, initialCommand, targetGroupId) =>
		set((s) => {
			if (s.removedWorkspaceIds[workspaceId]) return {};
			const list = s.terminalsByWorkspace[workspaceId] ?? [];
			const navigation = targetGroupId
				? advanceCenterNavigation(s, workspaceId, targetGroupId)
				: null;
			const tabKey = randomId("terminal");
			const tab: TerminalTab = {
				tabKey,
				workspaceId,
				title: nextTerminalTitle(list),
				attachPending: true,
				...(initialCommand ? { initialCommand } : {}),
			};
			// No create call: mounting the instance attaches, and attach is what registers the tab host-side.
			return {
				...(navigation?.patch ?? {}),
				layoutIntents: appendLayoutIntent(s.layoutIntents, {
					kind: "place-terminal",
					workspaceId,
					tabKey,
					title: tab.title,
					...(targetGroupId ? { targetGroupId, navigation: navigation?.stamp ?? null } : {}),
				}),
				terminalsByWorkspace: { ...s.terminalsByWorkspace, [workspaceId]: [...list, tab] },
				activeTerminalByWorkspace: { ...s.activeTerminalByWorkspace, [workspaceId]: tabKey },
			};
		}),
	/**
	 * Adopt the host's tab list for a workspace.
	 *
	 * Host order and titles win. A tab is kept despite being absent from that list ONLY while its own attach is
	 * still in flight — that request is what registers it, so dropping it would unmount the very instance about
	 * to make the call. Any other local tab the host does not list has genuinely gone (another client closed
	 * it), and preserving it would let its instance re-attach and bring back both the tab and a shell.
	 */
	setWorkspaceTerminals: (workspaceId, tabs) =>
		set((s) => {
			if (s.removedWorkspaceIds[workspaceId]) return {};
			const local = s.terminalsByWorkspace[workspaceId] ?? [];
			const known = new Set(tabs.map((tab) => tab.tabKey));
			const pending = local.filter((tab) => !known.has(tab.tabKey) && tab.attachPending);
			const merged: TerminalTab[] = [
				...tabs.map((tab) => {
					const existing = local.find((candidate) => candidate.tabKey === tab.tabKey);
					// Confirmed by the host, so no longer pending whatever this client thought.
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
	/** The tab's attach landed: the host knows about it, so it is no longer exempt from an authoritative list. */
	settleTerminalAttach: (workspaceId, tabKey) =>
		set((s) => {
			if (s.removedWorkspaceIds[workspaceId]) return {};
			const list = s.terminalsByWorkspace[workspaceId] ?? [];
			if (!list.some((t) => t.tabKey === tabKey && t.attachPending)) return s;
			return {
				terminalsByWorkspace: {
					...s.terminalsByWorkspace,
					[workspaceId]: list.map(({ attachPending, ...rest }) =>
						rest.tabKey === tabKey
							? rest
							: { ...rest, ...(attachPending ? { attachPending } : {}) },
					),
				},
			};
		}),
	/**
	 * Spend a tab's one-shot `initialCommand`, so it can never run a second time.
	 *
	 * `created` alone is not enough to gate on: a tab whose shell exited gets a *fresh* one on the next attach,
	 * which is also `created` — so an "Open in Vim" tab would reopen vim every time the workspace was revisited.
	 * The intent belongs to the tab's creation, not to any shell behind it.
	 */
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
	openChatSession: (workspaceId, sessionId, model, thinkingLevel, syncedTick, options = {}) =>
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
				activeTabByWorkspace:
					options.activate === false
						? s.activeTabByWorkspace
						: { ...s.activeTabByWorkspace, [workspaceId]: id },
				navTickByWorkspace:
					options.activate === false || navigationCountedAtRequest(options)
						? s.navTickByWorkspace
						: bumpNav(s, workspaceId),
				// Keep any existing runtime (idempotent); otherwise start a fresh one.
				sessions: fresh
					? { ...s.sessions, [sessionId]: newRuntime(model, thinkingLevel) }
					: s.sessions,
				// A fresh session loads the current on-disk skills, so anchor its sync tick to the load's
				// request-start (caller-captured; else now): only a *later* skill change flags it stale, and
				// an idempotent re-open must not re-anchor an already-stale session.
				...(fresh
					? {
							skillsSyncedTickBySession: {
								...s.skillsSyncedTickBySession,
								[sessionId]: syncedTick ?? selectWorkspaceTick(s, workspaceId),
							},
						}
					: {}),
			};
		}),
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
			const targetsRoute =
				s.routeChatTarget?.workspaceId === wsId && s.routeChatTarget.sessionId === sessionId;
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
				// Accepted user closes count; shared-layout/cache reconciliation does not impersonate one.
				navTickByWorkspace: wasActive && countNavigation ? bumpNav(s, wsId) : s.navTickByWorkspace,
				activeTabByWorkspace: {
					...s.activeTabByWorkspace,
					[wsId]: wasActive
						? (remaining.at(-1)?.id ?? null)
						: (s.activeTabByWorkspace[wsId] ?? null),
				},
				// Prepend (most-recent-first); the runtime in `sessions` is intentionally left alive.
				closedChatsByWorkspace: {
					...s.closedChatsByWorkspace,
					[wsId]: [entry, ...(s.closedChatsByWorkspace[wsId] ?? [])],
				},
				...(targetsLocation ? { chatLocationRequest: null } : {}),
				...(targetsRoute ? { routeChatTarget: null } : {}),
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
				// The runtime is still live in `sessions`, so the reopened tab shows the full transcript.
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
			const known = new Set([
				...existing.map((c) => c.sessionId),
				...(s.tabsByWorkspace[workspaceId] ?? [])
					.filter((t): t is ChatTab => t.kind === "chat")
					.map((t) => t.sessionId),
			]);
			const fresh = entries.filter(
				(e) =>
					!isSessionDeleted(s, workspaceId, e.sessionId) &&
					!known.has(e.sessionId) &&
					!s.sessions[e.sessionId],
			);
			if (fresh.length === 0) return {};
			return {
				closedChatsByWorkspace: {
					...s.closedChatsByWorkspace,
					// Newest-first; disk entries carry their last-modified time as `closedAt`.
					[workspaceId]: [...existing, ...fresh].sort((a, b) => b.closedAt - a.closedAt),
				},
			};
		}),
	hydrateSession: (summary, hydrated, activate = false, syncedTick, options = {}) =>
		set((s) => {
			if (
				s.removedWorkspaceIds[summary.workspaceId] ||
				isSessionDeleted(s, summary.workspaceId, summary.sessionId)
			) {
				return {};
			}
			if (s.sessions[summary.sessionId]) return {}; // a live/ahead runtime wins — never clobber it
			const wsId = summary.workspaceId;
			const runtime: SessionRuntime = {
				...newRuntime(summary.model, summary.thinkingLevel),
				turns: hydrated.turns,
				toolResults: hydrated.toolResults,
				askAnswers: hydrated.askAnswers,
				isStreaming: summary.isStreaming,
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
				// Advance the sync baseline ONLY when this restore actually (re)loaded resources against current
				// disk — a disk-only attach, where the caller passes its post-readiness request-start tick. A LIVE
				// restore reused the server session's already-loaded skills (`getMessages` returns only the transcript,
				// no reload) and the client can't date them, so the caller passes no tick: leave the baseline
				// unset → the chat stays conservatively stale if a skill change has been observed, never falsely
				// clearing the badge for a live session that predates the change.
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
				// Focus on an explicit reopen; otherwise only if the workspace has no active tab yet (auto-restore
				// must not steal focus). Keyed to the summary's workspace, not the active one.
				activeTabByWorkspace: takesFocus
					? { ...s.activeTabByWorkspace, [wsId]: id }
					: s.activeTabByWorkspace,
				// Only a hydrate that TOOK focus is a navigation; a background auto-restore must not
				// supersede a read the user is waiting on.
				navTickByWorkspace:
					takesFocus && !navigationCountedAtRequest(options)
						? bumpNav(s, wsId)
						: s.navTickByWorkspace,
				// It's open now, so it leaves history (if it was a disk-only entry there).
				closedChatsByWorkspace: closed.some((c) => c.sessionId === summary.sessionId)
					? {
							...s.closedChatsByWorkspace,
							[wsId]: closed.filter((c) => c.sessionId !== summary.sessionId),
						}
					: s.closedChatsByWorkspace,
			};
		}),
	appendUserMessage: (sessionId, text) =>
		set((s) =>
			withRuntime(s, sessionId, (rt) => ({
				...rt,
				turns: [
					...rt.turns,
					{
						kind: "user",
						id: crypto.randomUUID(),
						message: { role: "user", content: text, timestamp: Date.now() },
					},
				],
			})),
		),
	appendErrorTurn: (sessionId, text) =>
		set((s) =>
			withRuntime(s, sessionId, (rt) => ({
				...rt,
				// The send never started a run — clear streaming so the composer + loader don't hang.
				isStreaming: false,
				currentAssistantId: null,
				attemptAssistantId: null,
				turns: [...clearTurnStreaming(rt.turns), { kind: "error", id: crypto.randomUUID(), text }],
			})),
		),
	// The event→store dispatcher: route each pi event to its session's runtime, so chats stream independently.
	handlePiEvent: (event, sessionId) =>
		set((s) => withRuntime(s, sessionId, (rt) => reduceSessionEvent(rt, event))),
	// A `model.list` snapshot: current, but never authoritative — installing it drops `modelsFresh`.
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
	// The only writer of `modelsFresh: true` — and only for a list that actually arrived AND settled.
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
			// `setTitle` renames the session's chat tab (it lives in exactly one workspace), not the runtime.
			if (request.kind === "setTitle") {
				for (const [wsId, tabs] of Object.entries(s.tabsByWorkspace)) {
					const chat = tabs.find(
						(tab): tab is ChatTab => tab.kind === "chat" && tab.sessionId === request.sessionId,
					);
					if (!chat) continue;
					const cacheChanged = chat.name !== request.title;
					const renamed = cacheChanged ? { ...chat, name: request.title } : chat;
					const matchesQueuedOpen = (
						intent: LayoutIntent,
					): intent is Extract<LayoutIntent, { kind: "open" }> =>
						intent.kind === "open" &&
						intent.workspaceId === wsId &&
						intent.tab.kind === "chat" &&
						intent.tab.sessionId === chat.sessionId;
					const queuedOpen = s.layoutIntents.find(matchesQueuedOpen);
					const placement = selectLayoutResourcePlacement(s, wsId, chat);
					const queuedChanged = queuedOpen !== undefined && queuedOpen.tab.name !== request.title;
					const placementChanged = placement !== null && placement.tab.name !== request.title;
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
														name: request.title,
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
					if (!chats.some((chat) => chat.sessionId === request.sessionId)) continue;
					return {
						closedChatsByWorkspace: {
							...s.closedChatsByWorkspace,
							[wsId]: chats.map((chat) =>
								chat.sessionId === request.sessionId ? { ...chat, title: request.title } : chat,
							),
						},
					};
				}
				return {};
			}
			return withRuntime(s, request.sessionId, (rt) => reduceExtUi(rt, request));
		}),
	beginLogin: (loginId, providerId) =>
		set((s) =>
			// A frame can beat the loginStart response (a provider that fires onAuth synchronously): if the
			// frame already created this login, keep its folded state; otherwise open a fresh one.
			s.activeLogin?.loginId === loginId ? {} : { activeLogin: newLoginState(loginId, providerId) },
		),
	applyLoginFrame: (push) =>
		set((s) => {
			const cur = s.activeLogin;
			// Ignore a frame for some other still-active login (modal — only one runs at a time).
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
	// The path intent and the flip always travel together — one action, so no call site can send half of it.
	// The nav count is stamped here, at the click, because that is when the user navigated — the panel only
	// gets to act on this a `git.status` round trip later.
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
	// Activate project + workspace together (the same atomicity `activateWorkspace` upholds) so a jump into
	// another project can never leave `selectedProjectId` on the source while `activeWorkspaceId` points
	// elsewhere. The caller (`useHistorySearch.openMessage`) ensures the target project's workspaces are
	// loaded first, so `selectActiveWorkspace` can resolve `activeWorkspaceId`.
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

/**
 * Ergonomic entry point for firing a toast from anywhere — components and non-React call sites alike (a
 * `.catch` in a fire-and-forget wire call). Thin wrapper over `pushToast`; returns the toast id.
 */
export const toast = {
	error: (message: string, title?: string) =>
		useAppStore.getState().pushToast({ variant: "error", message, ...(title ? { title } : {}) }),
	success: (message: string, title?: string) =>
		useAppStore.getState().pushToast({ variant: "success", message, ...(title ? { title } : {}) }),
	info: (message: string, title?: string) =>
		useAppStore.getState().pushToast({ variant: "info", message, ...(title ? { title } : {}) }),
};
