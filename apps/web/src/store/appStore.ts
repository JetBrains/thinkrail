import type {
	AppConfig,
	AskUserQuestionResult,
	ExtUiRequest,
	GitDiffScope,
	LoginFrame,
	LoginPush,
	PiEvent,
	Project,
	RefreshedModels,
	SessionStats,
	SessionSummary,
	SlashCommandInfo,
	SpecGraphNode,
	TerminalTabInfo,
	ThemeId,
	ThinkingLevel,
	WireModel,
	Workspace,
	WorkspaceFsChangedPayload,
} from "@thinkrail/contracts";
import { DEFAULT_CONFIG, isAskUserAnswersMessage } from "@thinkrail/contracts";
import { create } from "zustand";
import type { LoginState } from "../auth";
import type { HydratedRuntime } from "../chat/hydrate";
import type { ChatTurn, ExtUiDialogRequest, ToolResultState } from "../chat/types";
import { shallowEqualArrays } from "../lib";
import type { ConnectionStatus } from "../transport";
import {
	type HistoryTarget,
	isSkillPath,
	selectActiveWorkspaceProjectId,
	selectWorkspaceNavTick,
	selectWorkspaceTick,
} from "./selectors";

/** A center tab. File tabs (Monaco) and chat tabs share the strip, discriminated by `kind`. */
export interface FileTab {
	kind: "file";
	id: string; // `${workspaceId}:${path}` — stable, so re-opening a file focuses its tab
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
	id: string; // `${workspaceId}:${sessionId}` — the AgentSession id is the one id model
	workspaceId: string;
	name: string;
	sessionId: string;
}
/**
 * An **ephemeral** rendered-markdown tab — content only, never backed by a file on disk (so no fs
 * re-read / source toggle). Used for on-demand snapshots like the chat's TODO plan compiled to markdown.
 * `docPath` is a synthetic `.md` name (for the preview's link/heading resolution + a readable label).
 */
export interface DocTab {
	kind: "doc";
	id: string;
	workspaceId: string;
	name: string;
	content: string;
	docPath: string;
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
	// `${workspaceId}:diff:${scopeKey}:${path}` — stable, so re-clicking a file in the same scope focuses its
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
export type EditorTab = FileTab | ChatTab | DocTab | DiffTab;

/**
 * How an open/reveal treats the workspace's single **preview slot**. `preview` is a light "I'm just
 * browsing" open (a tree click, a link follow) that reuses the slot; `keep` is a deliberate open (a
 * double click) that takes a tab of its own. See `previewTabByWorkspace`.
 */
export type TabIntent = "preview" | "keep";

/**
 * A section of the settings dialog (a const-object "enum", the codebase convention). Extensible — the live
 * sections are providers, github, appearance (the theme picker), templates (prompt-template manager),
 * and privacy (the analytics toggle).
 */
export const SettingsSection = {
	Providers: "providers",
	Github: "github",
	Appearance: "appearance",
	Terminal: "terminal",
	Templates: "templates",
	Privacy: "privacy",
} as const;
export type SettingsSection = (typeof SettingsSection)[keyof typeof SettingsSection];

/**
 * The right panel's views. The id lives here, not in `panels`, because the *intent* to show one is store
 * state (`rightTabRequest`) that chat raises and the panel obeys — `RightPanel` reads the union back.
 */
export type RightPanelTab = "specs" | "files" | "changes";

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
			return { ...rt, isStreaming: true };
		case "message_start":
			// User turns are shown optimistically on send; the assistant turn is created lazily on the first
			// message_update (from its `partial` snapshot) — here we just reserve its id. A new assistant
			// message also finalizes the previous one (pi may not send it a terminal `done`), so its live
			// indicator doesn't linger.
			return event.message.role === "assistant"
				? { ...rt, currentAssistantId: crypto.randomUUID(), turns: clearTurnStreaming(rt.turns) }
				: rt;
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
			// until `agent_end` — seconds or minutes later when tools run. Adopt the final message too: it
			// carries `stopReason`, which the renderers use to spot dead (aborted/errored) tool calls.
			if (event.message.role !== "assistant" || !rt.currentAssistantId) return rt;
			const id = rt.currentAssistantId;
			const turn: ChatTurn = { kind: "assistant", id, message: event.message, streaming: false };
			return {
				...rt,
				currentAssistantId: null,
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
		case "agent_end": {
			if (event.willRetry) return rt; // auto-retry / compaction follows — stay streaming
			// Did the run terminally fail? pi ends an errored turn (retries exhausted / non-retryable, e.g. a
			// nonexistent model 404-ing) with `willRetry: false` and a last assistant message carrying
			// `stopReason: "error"` + the provider's `errorMessage`. Surface that as a visible error turn
			// instead of a misleading "✓ Done" — otherwise a bad model just looks like nothing happened.
			const lastAssistant = [...event.messages]
				.reverse()
				.find((m): m is Extract<typeof m, { role: "assistant" }> => m.role === "assistant");
			const closer: ChatTurn =
				lastAssistant?.stopReason === "error"
					? {
							kind: "error",
							id: crypto.randomUUID(),
							text: lastAssistant.errorMessage || "The agent run ended in an error.",
						}
					: // `endedAt` timestamps the turn end so the round summary (shown right here) can measure the
						// turn's duration — user-submit → agent_end — without waiting for the next user turn.
						{ kind: "system", id: crypto.randomUUID(), text: "✓ Done", endedAt: Date.now() };
			return {
				...rt,
				// Drop any lingering retry countdown + sweep any turn still flagged streaming; the run concluded.
				turns: [...clearTurnStreaming(rt.turns).filter((t) => t.kind !== "retry"), closer],
				isStreaming: false,
				currentAssistantId: null,
			};
		}
		case "auto_retry_start":
			// Show a live countdown over the back-off; cleared on auto_retry_end (or the final agent_end).
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
	protocolVersion: number | null;
	/** Open projects shown in the left rail, newest first. */
	projects: Project[];
	/** Every known project (open + closed) shown under Add project → Recents, newest first. */
	recentProjects: Project[];
	workspaces: Record<string, Workspace[]>;
	selectedProjectId: string | null;
	activeWorkspaceId: string | null;
	/** Center tabs belong to a workspace — switching workspaces swaps the visible tab set. */
	tabsByWorkspace: Record<string, EditorTab[]>;
	activeTabByWorkspace: Record<string, string | null>;
	/**
	 * The workspace's **preview tab** — the one reusable slot a light open lands in (rendered italic; see
	 * `panels/SPEC.md`). Keyed like `activeTabByWorkspace`, so "at most one preview tab per workspace" is
	 * structural rather than a rule every writer has to remember, and the `EditorTab` union stays pure data.
	 * Absent = this workspace has no preview tab.
	 */
	previewTabByWorkspace: Record<string, string>;
	/**
	 * Monotonic count of **center-area navigations** per workspace. Rendered by nothing: it exists so a
	 * **slow read can tell it was overtaken**. A click is instant and an `fs.readFile` is not, so
	 * `panels/openTabs.ts` records this count when it starts a read and drops a `preview` that lands after
	 * the count has moved — otherwise the file would steal focus back from wherever the user went, and claim
	 * the preview slot from it. It lives here rather than in that module so **no focus transition can bypass
	 * it**: `openDoc`/`setActiveTab`/`closeTab`/`openChatSession`/`closeChatToHistory`/`reopenChat`/
	 * `requestHistoryOpen` all bump it, `hydrateSession` only when it actually takes focus, and
	 * `noteNavigation` covers an intent whose focus change hasn't reached the store yet.
	 *
	 * **`openTab` deliberately does NOT bump it** — it *is* the read completion being ordered, so counting it
	 * would make an earlier read's own commit look like user navigation and drop the later one. Two browse
	 * clicks in a row is exactly that case: clicking an unopened file writes no store state, so both reads
	 * would record the same count and the first to land would invalidate the second, leaving the *first*
	 * click's file open. `openTabs.ts` therefore bumps this at **request** time and is the only caller of
	 * `openTab`; a request and a completion are different events and only the request counts as navigating.
	 */
	navTickByWorkspace: Record<string, number>;
	/** Chat tabs the user closed, per workspace (most-recent-first) — reopenable while their runtime lives. */
	closedChatsByWorkspace: Record<string, ClosedChat[]>;
	/** Terminals are workspace-scoped too; their instances stay mounted (hidden) to preserve buffers. */
	terminalsByWorkspace: Record<string, TerminalTab[]>;
	activeTerminalByWorkspace: Record<string, string | null>;
	/** One runtime per live chat (keyed by `sessionId`) — many can stream at once; switching is a swap. */
	sessions: Record<string, SessionRuntime>;
	/** Models with configured auth (cheap win #1) — fetched once, shared by every chat's picker. */
	models: WireModel[];
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
	 * Which right-panel view to show, when something outside it asks (a chat turn-divider chip). The panel
	 * watches this ONE field, so "flip to a view" is a single concept rather than a side effect read off
	 * each path intent below — a chip that only *reveals* a view (expanding its artifact list) needs no path
	 * at all. Workspace-scoped, so a request from another workspace's chat can't move the active panel; a
	 * fresh object each call so identical re-requests still fire, and **consumed** by the panel that obeys it
	 * (`clearRightTabRequest`) — an unconsumed flip would re-fire whenever the workspace is re-activated,
	 * moving the tab the user has since chosen.
	 */
	rightTabRequest: { workspaceId: string; tab: RightPanelTab } | null;
	/**
	 * A request to surface a file in the right-panel Changes view (e.g. a chat turn-divider's "files
	 * changed" chip). `ChangesPanel` highlights the file's row AND opens its diff tab (a path no longer in
	 * the diff degrades to highlight-only), then **consumes** the request (`clearChangesRequest`) — it
	 * opens a center tab, so a replay on a git-status re-read would steal the user's tab. Travels with a
	 * `rightTabRequest` for the flip. A fresh object each call so identical re-requests still fire.
	 *
	 * `navTick` stamps the center-navigation count **as the chip was clicked**. The panel cannot act on the
	 * request until `git.status` resolves the path against the diff, so the click and the open are a round
	 * trip apart; without the stamp the open would mark itself as the navigation on arrival and override
	 * whatever the user did in between. See `ChangesPanel`.
	 */
	changesRequest: { workspaceId: string; path: string; navTick: number } | null;
	/**
	 * A history-search "jump to message" deep link, set by `requestChatLocation` and consumed by
	 * `CenterTabs` (open/hydrate the target chat tab) then `ChatView` (scroll to the anchored turn, then
	 * clear it) — a fresh object each call so identical re-requests (e.g. the same hit clicked twice)
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
	historyOpenRequest: { sessionId: string } | null;
	/**
	 * A request to surface a spec in the right-panel Specs view (e.g. a chat turn-divider's "specs" chip).
	 * The panels watch it and **open the rendered spec** — unlike a diff, a spec doc has nothing to preview
	 * short of opening it, and the tree row lights up on its own (rows key off the active tab id). Travels
	 * with a `rightTabRequest` for the flip, and is **consumed** once handled (it opens a center tab, so a
	 * replay would steal the user's tab). A fresh object each call so identical re-requests still fire.
	 */
	specRequest: { workspaceId: string; path: string } | null;
	/**
	 * Each workspace's spec-graph snapshot (`spec.graph`), fetched by the Specs panel and kept here so the
	 * chat can classify a written path as a spec without a second read — the ONE definition of "this file is
	 * a spec", shared by the panel that lists them and the turn divider that counts them. Absent until the
	 * first fetch lands; the panel refetches on the workspace fs tick, so it tracks the filesystem.
	 */
	specsByWorkspace: Record<string, SpecGraphNode[]>;
	/**
	 * The live-refresh signal, per workspace: `tick` increments on every `workspace.fsChanged` push (the
	 * host's debounced worktree change notifier); `paths`/`truncated` are the LAST batch only. Panels
	 * select their workspace's entry and silently refetch on `tick` change — the store holds only the
	 * signal, never fetches.
	 */
	fsChangesByWorkspace: Record<string, { tick: number; paths: string[]; truncated: boolean }>;
	/**
	 * Per workspace, the `fsChangesByWorkspace` tick of the most recent *skill-relevant* batch — a change
	 * under a `.claude|.github|.gemini|.pi|.agents/skills` dir, or a truncated wildcard we can't inspect.
	 * Folded alongside the fs signal in `noteFsChanged`; compared against a session's
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
	/** Transient notifications, oldest-first (the Toaster renders + times them out). At-most a handful live
	 * at once; a failed wire call that has no better home (no chat tab to host an error turn) lands here. */
	toasts: Toast[];
	setStatus: (status: ConnectionStatus) => void;
	setWelcome: (protocolVersion: number) => void;
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
	/** Enter a workspace and select its owning project in one state transition. */
	activateWorkspace: (workspace: Pick<Workspace, "id" | "projectId">) => void;
	/**
	 * Open a center tab — an already-open id focuses instead of duplicating. `intent: "preview"` puts it in
	 * the workspace's preview slot, **replacing the previous preview tab at its index** so the strip doesn't
	 * reshuffle under the cursor; `intent: "keep"` appends a normal tab and releases the slot if it pointed
	 * at this id. Chat tabs and `openDoc` never take the slot (see `previewTabByWorkspace`).
	 */
	openTab: (tab: EditorTab, intent: TabIntent) => void;
	/** Open (or refresh + focus, if already open) an ephemeral rendered-markdown `doc` tab. Re-invoking
	 * with the same id replaces its content so a "compile current state" action always shows the latest. */
	openDoc: (tab: DocTab) => void;
	closeTab: (id: string) => void;
	/** Activate a tab. `intent: "keep"` also promotes it out of the preview slot — one-way: nothing ever
	 * demotes a kept tab back to preview. */
	setActiveTab: (id: string, intent?: TabIntent) => void;
	/**
	 * Record a center-area navigation whose focus change hasn't reached the store yet — starting a chat,
	 * whose tab only appears once `session.create` returns. Supersedes any read in flight for the workspace
	 * (see `navTickByWorkspace`), so a file the user has navigated away from can't activate itself on arrival.
	 */
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
	/** Replace a file tab's content after a live re-read, recording the fs tick it was loaded at. The tab
	 * is located across workspaces by its (globally unique) id; a closed tab is a no-op. */
	updateFileTabContent: (id: string, content: string, tick: number) => void;
	/**
	 * Replace a diff tab's two sides after a live re-read (see `DiffPane`), recording the fs tick **and** the
	 * review target the fresh content was read against — the two dimensions a diff tab is live in, written
	 * together so neither can outlive the content it describes.
	 */
	updateDiffTabContent: (
		id: string,
		original: string,
		modified: string,
		tick: number,
		loadedTarget: string,
	) => void;
	clearWorkspaceTabs: (workspaceId: string) => void;
	addTerminal: (workspaceId: string, initialCommand?: string) => void;
	setWorkspaceTerminals: (workspaceId: string, tabs: TerminalTabInfo[]) => void;
	settleTerminalAttach: (workspaceId: string, tabKey: string) => void;
	consumeTerminalInitialCommand: (workspaceId: string, tabKey: string) => void;
	closeTerminalTab: (workspaceId: string, tabKey: string) => void;
	setActiveTerminalTab: (workspaceId: string, tabKey: string) => void;
	openChatSession: (
		workspaceId: string,
		sessionId: string,
		model: WireModel | null,
		thinkingLevel: ThinkingLevel,
		/** Skills sync baseline — the workspace tick captured *before* `session.create` (see
		 * `selectWorkspaceTick`); omit to anchor at call time (fine when there's no async load in between). */
		syncedTick?: number,
	) => void;
	/** Drop a chat's runtime on tab close (the `AgentSession` is disposed over the wire by the caller). */
	closeChatRuntime: (sessionId: string) => void;
	/** Close a chat tab to history: remove the tab but keep its runtime + session alive for reopening. */
	closeChatToHistory: (sessionId: string) => void;
	/** Reopen a chat from history (its runtime is still live, so the full transcript returns instantly). */
	reopenChat: (sessionId: string) => void;
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
		/** Skills sync baseline — the workspace tick captured *before* `session.getMessages`, passed **only**
		 * for a disk-only attach (which reloads resources against current disk). Omit for a live restore
		 * (transcript only, no reload): the baseline is left unset so the chat stays conservatively stale. */
		syncedTick?: number,
	) => void;
	appendUserMessage: (sessionId: string, text: string) => void;
	/**
	 * Surface a failed send as a visible error turn. The turn-driving wire calls (`session.prompt`/`steer`/
	 * `followUp`/`create`) can reject before any pi event streams — e.g. `prompt()` throws "no API key" /
	 * validates a bad model. Without this the rejection is swallowed and the chat looks frozen.
	 */
	appendErrorTurn: (sessionId: string, text: string) => void;
	handlePiEvent: (event: PiEvent, sessionId: string) => void;
	setModels: (models: WireModel[]) => void;
	bumpTemplatesVersion: () => void;
	/** Atomic begin/finish of the awaited catalog refresh — `finish` lands the new list (null = failed
	 * refresh: keep the current list, and with it its provenance) and clears the flag in ONE write. The
	 * host's `complete` decides provenance: a capped wait can answer with a list that is current but not
	 * settled, and only a settled one is authority. */
	beginModelsRefresh: () => void;
	finishModelsRefresh: (result: RefreshedModels | null) => void;
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
	/** Ask the right panel to show one of its views — no path, just the flip (a chip revealing its list). */
	requestRightTab: (workspaceId: string, tab: RightPanelTab) => void;
	/** Ask the right panel to surface `path` in its Changes view (deep-link from chat); flips to it too. */
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
	 * tab **atomically** with the request: the chord fires over any tab, and `CenterTabs` mounts one tab
	 * body at a time, so a request for a chat that isn't on screen would never be consumed.
	 */
	requestHistoryOpen: (target: HistoryTarget) => void;
	/** Dismiss the history-open request once `ChatView` has acted on it. */
	clearHistoryOpen: () => void;
	/** Ask the right panel to open `path` in its Specs view (deep-link from chat); flips to it too. */
	requestSpecView: (workspaceId: string, path: string) => void;
	/** Drop the spec deep-link once a panel has acted on it (it opens a tab — it must fire exactly once). */
	clearSpecRequest: () => void;
	/** Drop the view request once the panel has flipped, so re-activating a workspace can't replay it. */
	clearRightTabRequest: () => void;
	/** Record a workspace's fetched spec-graph snapshot (`useWorkspaceSpecs`' read lands here). */
	setWorkspaceSpecs: (workspaceId: string, nodes: SpecGraphNode[]) => void;
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
 * Whether a re-read produced the same graph. The Specs read refetches on every worktree fs tick, and most
 * ticks change no spec at all — keeping the previous array identity on those makes the refetch free for
 * `ChatView`, whose `isSpec` memo (and with it `deriveRows` over the whole transcript, for every open chat)
 * would otherwise be invalidated about once a second during any file activity.
 */
/**
 * Advance a workspace's center-navigation count (see `navTickByWorkspace`). Every action that moves the
 * active tab folds this into its own `set`, so the bump is atomic with the focus change it describes and
 * a caller can't forget it separately.
 */
function bumpNav(s: AppState, workspaceId: string): Record<string, number> {
	return { ...s.navTickByWorkspace, [workspaceId]: selectWorkspaceNavTick(s, workspaceId) + 1 };
}

function sameSpecGraph(prev: SpecGraphNode[] | undefined, next: SpecGraphNode[]): boolean {
	if (!prev || prev.length !== next.length) return false;
	return prev.every((node, i) => {
		const candidate = next[i];
		return candidate !== undefined && sameSpecNode(node, candidate);
	});
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
	protocolVersion: null,
	projects: [],
	recentProjects: [],
	workspaces: {},
	selectedProjectId: null,
	activeWorkspaceId: null,
	tabsByWorkspace: {},
	activeTabByWorkspace: {},
	previewTabByWorkspace: {},
	navTickByWorkspace: {},
	closedChatsByWorkspace: {},
	terminalsByWorkspace: {},
	activeTerminalByWorkspace: {},
	sessions: {},
	models: [],
	templatesVersion: 0,
	rightTabRequest: null,
	modelsRefreshing: false,
	modelsFresh: false,
	changesRequest: null,
	specRequest: null,
	specsByWorkspace: {},
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
	toasts: [],
	setStatus: (status) => set({ status }),
	setWelcome: (protocolVersion) => set({ protocolVersion }),
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
		set((s) => ({ workspaces: { ...s.workspaces, [projectId]: workspaces } })),
	addWorkspace: (workspace) =>
		set((s) => {
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
					// the +/− badge until the next list.
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
		s.removeWorkspace(projectId, workspaceId);
		s.clearWorkspaceTabs(workspaceId); // drops the row's tabs + terminals + chat runtimes
		// Drop the live-refresh signal + the cached spec graph too — a removed workspace's records must not
		// linger (the worktree is gone; a same-id workspace can never come back).
		set((state) => ({
			fsChangesByWorkspace: omitKey(state.fsChangesByWorkspace, workspaceId),
			skillChangeTickByWorkspace: omitKey(state.skillChangeTickByWorkspace, workspaceId),
			specsByWorkspace: omitKey(state.specsByWorkspace, workspaceId),
			diffScopeByWorkspace: omitKey(state.diffScopeByWorkspace, workspaceId),
		}));
		if (wasActive) {
			s.selectProject(projectId); // atomically fall back to the removed workspace's Project Home
			toast.info(`Workspace "${name ?? "?"}" was removed`);
		}
	},
	selectProject: (selectedProjectId) => set({ selectedProjectId, activeWorkspaceId: null }),
	activateWorkspace: (workspace) =>
		set({ selectedProjectId: workspace.projectId, activeWorkspaceId: workspace.id }),
	openTab: (tab, intent) =>
		set((s) => {
			const wsId = tab.workspaceId;
			const tabs = s.tabsByWorkspace[wsId] ?? [];
			const preview = s.previewTabByWorkspace[wsId];
			const activeTabByWorkspace = { ...s.activeTabByWorkspace, [wsId]: tab.id };
			// Already open: focus it. A `keep` promotes it; a `preview` deliberately leaves every tab's state
			// alone, so re-clicking a kept tab in the tree never demotes it and never steals the slot.
			if (tabs.some((t) => t.id === tab.id)) {
				return {
					activeTabByWorkspace,
					previewTabByWorkspace:
						intent === "keep" && preview === tab.id
							? omitKey(s.previewTabByWorkspace, wsId)
							: s.previewTabByWorkspace,
				};
			}
			// A preview open reuses the outgoing tab's position, so browsing a tree swaps one tab in place
			// instead of reshuffling the strip under the cursor.
			const at = intent === "preview" && preview ? tabs.findIndex((t) => t.id === preview) : -1;
			return {
				tabsByWorkspace: {
					...s.tabsByWorkspace,
					[wsId]: at === -1 ? [...tabs, tab] : tabs.with(at, tab),
				},
				activeTabByWorkspace,
				previewTabByWorkspace:
					intent === "preview"
						? { ...s.previewTabByWorkspace, [wsId]: tab.id }
						: s.previewTabByWorkspace,
			};
		}),
	openDoc: (tab) =>
		set((s) => {
			const tabs = s.tabsByWorkspace[tab.workspaceId] ?? [];
			const exists = tabs.some((t) => t.id === tab.id);
			return {
				tabsByWorkspace: {
					...s.tabsByWorkspace,
					[tab.workspaceId]: exists ? tabs.map((t) => (t.id === tab.id ? tab : t)) : [...tabs, tab],
				},
				activeTabByWorkspace: { ...s.activeTabByWorkspace, [tab.workspaceId]: tab.id },
				navTickByWorkspace: bumpNav(s, tab.workspaceId),
			};
		}),
	closeTab: (id) =>
		set((s) => {
			const wsId = s.activeWorkspaceId;
			if (!wsId) return {};
			const tabs = (s.tabsByWorkspace[wsId] ?? []).filter((t) => t.id !== id);
			const wasActive = s.activeTabByWorkspace[wsId] === id;
			return {
				tabsByWorkspace: { ...s.tabsByWorkspace, [wsId]: tabs },
				activeTabByWorkspace: {
					...s.activeTabByWorkspace,
					[wsId]: wasActive ? (tabs.at(-1)?.id ?? null) : (s.activeTabByWorkspace[wsId] ?? null),
				},
				// Only a close that actually moves focus is a navigation. Closing some other tab in the strip
				// leaves the user exactly where they were, so counting it would discard a browse still in
				// flight — the clicked file would never open.
				navTickByWorkspace: wasActive ? bumpNav(s, wsId) : s.navTickByWorkspace,
				// A closed tab must never leave a dangling slot id behind.
				...(s.previewTabByWorkspace[wsId] === id
					? { previewTabByWorkspace: omitKey(s.previewTabByWorkspace, wsId) }
					: {}),
			};
		}),
	setActiveTab: (id, intent) =>
		set((s) => {
			const wsId = s.activeWorkspaceId;
			if (!wsId) return {};
			return {
				activeTabByWorkspace: { ...s.activeTabByWorkspace, [wsId]: id },
				navTickByWorkspace: bumpNav(s, wsId),
				...(intent === "keep" && s.previewTabByWorkspace[wsId] === id
					? { previewTabByWorkspace: omitKey(s.previewTabByWorkspace, wsId) }
					: {}),
			};
		}),
	noteNavigation: (workspaceId) => set((s) => ({ navTickByWorkspace: bumpNav(s, workspaceId) })),
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
		set((s) => ({ diffScopeByWorkspace: { ...s.diffScopeByWorkspace, [workspaceId]: scope } })),
	noteFsChanged: (payload) =>
		set((s) => {
			const prev = s.fsChangesByWorkspace[payload.workspaceId];
			const tick = (prev?.tick ?? 0) + 1;
			// A skill-dir change (or a truncated wildcard we can't inspect) advances the workspace's
			// skill-change tick, flagging every session that loaded skills before it (selectSkillsStale).
			const skillChanged = payload.truncated || payload.paths.some(isSkillPath);
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
	updateFileTabContent: (id, content, tick) =>
		set((s) => {
			for (const [wsId, tabs] of Object.entries(s.tabsByWorkspace)) {
				if (!tabs.some((t) => t.id === id && t.kind === "file")) continue;
				return {
					tabsByWorkspace: {
						...s.tabsByWorkspace,
						[wsId]: tabs.map((t) =>
							t.id === id && t.kind === "file" ? { ...t, content, loadedTick: tick } : t,
						),
					},
				};
			}
			return {};
		}),
	updateDiffTabContent: (id, original, modified, tick, loadedTarget) =>
		set((s) => {
			for (const [wsId, tabs] of Object.entries(s.tabsByWorkspace)) {
				if (!tabs.some((t) => t.id === id && t.kind === "diff")) continue;
				return {
					tabsByWorkspace: {
						...s.tabsByWorkspace,
						[wsId]: tabs.map((t) =>
							t.id === id && t.kind === "diff"
								? { ...t, original, modified, loadedTick: tick, loadedTarget }
								: t,
						),
					},
				};
			}
			return {};
		}),
	clearWorkspaceTabs: (workspaceId) =>
		set((s) => {
			// Drop the runtimes of this workspace's chats — both open tabs and closed-to-history ones (their
			// AgentSessions are freed on host shutdown).
			const sessions = { ...s.sessions };
			const skillsSyncedTickBySession = { ...s.skillsSyncedTickBySession };
			for (const tab of s.tabsByWorkspace[workspaceId] ?? []) {
				if (tab.kind === "chat") {
					delete sessions[tab.sessionId];
					delete skillsSyncedTickBySession[tab.sessionId];
				}
			}
			for (const closed of s.closedChatsByWorkspace[workspaceId] ?? []) {
				delete sessions[closed.sessionId];
				delete skillsSyncedTickBySession[closed.sessionId];
			}
			return {
				tabsByWorkspace: omitKey(s.tabsByWorkspace, workspaceId),
				activeTabByWorkspace: omitKey(s.activeTabByWorkspace, workspaceId),
				previewTabByWorkspace: omitKey(s.previewTabByWorkspace, workspaceId),
				navTickByWorkspace: omitKey(s.navTickByWorkspace, workspaceId),
				closedChatsByWorkspace: omitKey(s.closedChatsByWorkspace, workspaceId),
				// Dropping the terminals unmounts their instances, which close the PTYs server-side.
				terminalsByWorkspace: omitKey(s.terminalsByWorkspace, workspaceId),
				activeTerminalByWorkspace: omitKey(s.activeTerminalByWorkspace, workspaceId),
				sessions,
				skillsSyncedTickBySession,
			};
		}),
	addTerminal: (workspaceId, initialCommand) =>
		set((s) => {
			const list = s.terminalsByWorkspace[workspaceId] ?? [];
			const tabKey = crypto.randomUUID();
			const tab: TerminalTab = {
				tabKey,
				workspaceId,
				title: nextTerminalTitle(list),
				attachPending: true,
				...(initialCommand ? { initialCommand } : {}),
			};
			// No create call: mounting the instance attaches, and attach is what registers the tab host-side.
			return {
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
	closeTerminalTab: (workspaceId, tabKey) =>
		set((s) => {
			const list = (s.terminalsByWorkspace[workspaceId] ?? []).filter((t) => t.tabKey !== tabKey);
			const wasActive = s.activeTerminalByWorkspace[workspaceId] === tabKey;
			return {
				terminalsByWorkspace: { ...s.terminalsByWorkspace, [workspaceId]: list },
				activeTerminalByWorkspace: {
					...s.activeTerminalByWorkspace,
					[workspaceId]: wasActive
						? (list.at(-1)?.tabKey ?? null)
						: (s.activeTerminalByWorkspace[workspaceId] ?? null),
				},
			};
		}),
	setActiveTerminalTab: (workspaceId, tabKey) =>
		set((s) => ({
			activeTerminalByWorkspace: { ...s.activeTerminalByWorkspace, [workspaceId]: tabKey },
		})),
	openChatSession: (workspaceId, sessionId, model, thinkingLevel, syncedTick) =>
		set((s) => {
			const id = `${workspaceId}:${sessionId}`;
			const tab: ChatTab = { kind: "chat", id, workspaceId, name: "Chat", sessionId };
			const tabs = s.tabsByWorkspace[workspaceId] ?? [];
			const fresh = !s.sessions[sessionId];
			return {
				tabsByWorkspace: tabs.some((t) => t.id === id)
					? s.tabsByWorkspace
					: { ...s.tabsByWorkspace, [workspaceId]: [...tabs, tab] },
				activeTabByWorkspace: { ...s.activeTabByWorkspace, [workspaceId]: id },
				navTickByWorkspace: bumpNav(s, workspaceId),
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
	closeChatToHistory: (sessionId) =>
		set((s) => {
			const wsId = s.activeWorkspaceId;
			if (!wsId) return {};
			const tabs = s.tabsByWorkspace[wsId] ?? [];
			const tab = tabs.find((t) => t.kind === "chat" && t.sessionId === sessionId);
			if (!tab) return {};
			const remaining = tabs.filter((t) => t.id !== tab.id);
			const wasActive = s.activeTabByWorkspace[wsId] === tab.id;
			const entry: ClosedChat = { sessionId, title: tab.name, closedAt: Date.now() };
			return {
				tabsByWorkspace: { ...s.tabsByWorkspace, [wsId]: remaining },
				// Same rule as `closeTab`: only a close that moves focus counts as a navigation.
				navTickByWorkspace: wasActive ? bumpNav(s, wsId) : s.navTickByWorkspace,
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
			};
		}),
	reopenChat: (sessionId) =>
		set((s) => {
			const wsId = s.activeWorkspaceId;
			if (!wsId) return {};
			const closed = s.closedChatsByWorkspace[wsId] ?? [];
			const entry = closed.find((c) => c.sessionId === sessionId);
			if (!entry) return {};
			const id = `${wsId}:${sessionId}`;
			const tab: ChatTab = { kind: "chat", id, workspaceId: wsId, name: entry.title, sessionId };
			const tabs = s.tabsByWorkspace[wsId] ?? [];
			return {
				// The runtime is still live in `sessions`, so the reopened tab shows the full transcript.
				tabsByWorkspace: tabs.some((t) => t.id === id)
					? s.tabsByWorkspace
					: { ...s.tabsByWorkspace, [wsId]: [...tabs, tab] },
				activeTabByWorkspace: { ...s.activeTabByWorkspace, [wsId]: id },
				navTickByWorkspace: bumpNav(s, wsId),
				closedChatsByWorkspace: {
					...s.closedChatsByWorkspace,
					[wsId]: closed.filter((c) => c.sessionId !== sessionId),
				},
			};
		}),
	noteClosedChats: (workspaceId, entries) =>
		set((s) => {
			const existing = s.closedChatsByWorkspace[workspaceId] ?? [];
			const known = new Set([
				...existing.map((c) => c.sessionId),
				...(s.tabsByWorkspace[workspaceId] ?? [])
					.filter((t): t is ChatTab => t.kind === "chat")
					.map((t) => t.sessionId),
			]);
			const fresh = entries.filter((e) => !known.has(e.sessionId) && !s.sessions[e.sessionId]);
			if (fresh.length === 0) return {};
			return {
				closedChatsByWorkspace: {
					...s.closedChatsByWorkspace,
					// Newest-first; disk entries carry their last-modified time as `closedAt`.
					[workspaceId]: [...existing, ...fresh].sort((a, b) => b.closedAt - a.closedAt),
				},
			};
		}),
	hydrateSession: (summary, hydrated, activate = false, syncedTick) =>
		set((s) => {
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
			const id = `${wsId}:${summary.sessionId}`;
			const tab: ChatTab = {
				kind: "chat",
				id,
				workspaceId: wsId,
				name: summary.title,
				sessionId: summary.sessionId,
			};
			const tabs = s.tabsByWorkspace[wsId] ?? [];
			const hasActive = s.activeTabByWorkspace[wsId] != null;
			const closed = s.closedChatsByWorkspace[wsId] ?? [];
			return {
				sessions: { ...s.sessions, [summary.sessionId]: runtime },
				// Advance the sync baseline ONLY when this restore actually (re)loaded resources against current
				// disk — a disk-only attach, where the caller passes its request-start tick. A LIVE restore
				// reused the server session's already-loaded skills (`getMessages` returns only the transcript,
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
				tabsByWorkspace: tabs.some((t) => t.id === id)
					? s.tabsByWorkspace
					: { ...s.tabsByWorkspace, [wsId]: [...tabs, tab] },
				// Focus on an explicit reopen; otherwise only if the workspace has no active tab yet (auto-restore
				// must not steal focus). Keyed to the summary's workspace, not the active one.
				activeTabByWorkspace:
					activate || !hasActive
						? { ...s.activeTabByWorkspace, [wsId]: id }
						: s.activeTabByWorkspace,
				// Only a hydrate that TOOK focus is a navigation; a background auto-restore must not
				// supersede a read the user is waiting on.
				navTickByWorkspace: activate || !hasActive ? bumpNav(s, wsId) : s.navTickByWorkspace,
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
				turns: [...clearTurnStreaming(rt.turns), { kind: "error", id: crypto.randomUUID(), text }],
			})),
		),
	// The event→store dispatcher: route each pi event to its session's runtime, so chats stream independently.
	handlePiEvent: (event, sessionId) =>
		set((s) => withRuntime(s, sessionId, (rt) => reduceSessionEvent(rt, event))),
	// A `model.list` snapshot: current, but never authoritative — installing it drops `modelsFresh`.
	setModels: (models) => set({ models, modelsFresh: false }),
	bumpTemplatesVersion: () => set((s) => ({ templatesVersion: s.templatesVersion + 1 })),
	beginModelsRefresh: () => set({ modelsRefreshing: true }),
	dropModelsFreshness: () => set({ modelsFresh: false }),
	// The only writer of `modelsFresh: true` — and only for a list that actually arrived AND settled.
	finishModelsRefresh: (result) =>
		set((s) => ({
			modelsRefreshing: false,
			models: result?.models ?? s.models,
			modelsFresh: result ? result.complete : s.modelsFresh,
		})),
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
					if (tabs.some((t) => t.kind === "chat" && t.sessionId === request.sessionId)) {
						return {
							tabsByWorkspace: {
								...s.tabsByWorkspace,
								[wsId]: tabs.map((t) =>
									t.kind === "chat" && t.sessionId === request.sessionId
										? { ...t, name: request.title }
										: t,
								),
							},
						};
					}
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
	applyConfig: (config) =>
		set({
			theme: config.theme,
			analyticsEnabled: config.analyticsEnabled,
			terminalReplayKb: config.terminalReplayKb,
		}),
	requestRightTab: (workspaceId, tab) => set({ rightTabRequest: { workspaceId, tab } }),
	// The path intent and the flip always travel together — one action, so no call site can send half of it.
	// The nav count is stamped here, at the click, because that is when the user navigated — the panel only
	// gets to act on this a `git.status` round trip later.
	requestChangesView: (workspaceId, path) =>
		set((s) => ({
			changesRequest: { workspaceId, path, navTick: selectWorkspaceNavTick(s, workspaceId) },
			rightTabRequest: { workspaceId, tab: "changes" },
		})),
	clearChangesRequest: () => set({ changesRequest: null }),
	// Activate project + workspace together (the same atomicity `activateWorkspace` upholds) so a jump into
	// another project can never leave `selectedProjectId` on the source while `activeWorkspaceId` points
	// elsewhere. The caller (`useHistorySearch.openMessage`) ensures the target project's workspaces are
	// loaded first, so `selectActiveWorkspace` can resolve `activeWorkspaceId`.
	requestChatLocation: (req) =>
		set({
			chatLocationRequest: req,
			selectedProjectId: req.projectId,
			activeWorkspaceId: req.workspaceId,
		}),
	clearChatLocation: () => set({ chatLocationRequest: null }),
	requestHistoryOpen: (target) =>
		set((s) => ({
			historyOpenRequest: { sessionId: target.sessionId },
			activeTabByWorkspace: { ...s.activeTabByWorkspace, [target.workspaceId]: target.tabId },
			navTickByWorkspace: bumpNav(s, target.workspaceId),
		})),
	clearHistoryOpen: () => set({ historyOpenRequest: null }),
	requestSpecView: (workspaceId, path) =>
		set({ specRequest: { workspaceId, path }, rightTabRequest: { workspaceId, tab: "specs" } }),
	clearSpecRequest: () => set({ specRequest: null }),
	clearRightTabRequest: () => set({ rightTabRequest: null }),
	setWorkspaceSpecs: (workspaceId, nodes) =>
		set((s) =>
			sameSpecGraph(s.specsByWorkspace[workspaceId], nodes)
				? {}
				: { specsByWorkspace: { ...s.specsByWorkspace, [workspaceId]: nodes } },
		),
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
