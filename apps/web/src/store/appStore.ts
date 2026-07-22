import type {
	AppConfig,
	AskUserQuestionResult,
	ExtUiRequest,
	LoginFrame,
	LoginPush,
	PiEvent,
	Project,
	SessionStats,
	SessionSummary,
	SlashCommandInfo,
	ThemeId,
	ThinkingLevel,
	WireModel,
	Workspace,
	WorkspaceFsChangedPayload,
} from "@thinkrail/contracts";
import { isAskUserAnswersMessage, Theme } from "@thinkrail/contracts";
import { create } from "zustand";
import type { LoginState } from "../auth";
import type { HydratedRuntime } from "../chat/hydrate";
import type { ChatTurn, ExtUiDialogRequest, ToolResultState } from "../chat/types";
import type { ConnectionStatus } from "../transport";
import { DOC_HISTORY_LIMIT, readDocHistory, writeDocHistory } from "./docHistoryStorage";
import { type PanelCollapsed, readPanelCollapsed, writePanelCollapsed } from "./panelLayoutStorage";

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
/** A Changes diff opened in the center: lean — `DiffPane` fetches and reconstructs the two sides
 * itself (nothing content-shaped to keep in the store), so the tab is just an address. */
export interface DiffTab {
	kind: "diff";
	id: string; // `diff:${workspaceId}:${path}` — distinct from the same path's file tab, focus-on-reopen
	workspaceId: string;
	name: string;
	path: string;
}
export type EditorTab = FileTab | ChatTab | DiffTab;

/**
 * A section of the settings dialog (a const-object "enum", the codebase convention). Extensible — the live
 * sections are providers, github, and appearance (the theme picker).
 */
export const SettingsSection = {
	Providers: "providers",
	Github: "github",
	Appearance: "appearance",
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

/** A terminal tab. `clientId` is the stable UI key; the server PTY id is owned by its `TerminalInstance`. */
export interface TerminalTab {
	clientId: string;
	workspaceId: string;
	/** Stable creation-order number, shown as the tab label ("1", "2", …); never reused/renumbered. */
	n: number;
	/** Full name ("Terminal N"), shown in the backgrounded list + the close aria-label. */
	title: string;
}

/** One entry in the per-workspace opened-documents History (view state only): enough to re-open the
 * document as a center tab. NOT chat — only file / diff tabs are recorded. */
export interface DocHistoryEntry {
	kind: "file" | "diff";
	path: string; // worktree-relative
	name: string; // basename, shown in the menu
}

/**
 * The live state of one chat session, keyed by its `sessionId` in `store.sessions`. The host already runs
 * N independent `AgentSession`s, so each gets its own runtime here — events route to it by id, letting
 * several chats stream concurrently while switching tabs is an instant in-memory swap.
 */
export interface SessionRuntime {
	/** Conversation as pi-canonical turns (user/assistant messages + web-local system notices). */
	turns: ChatTurn[];
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
			return {
				...rt,
				turns: [
					...rt.turns,
					{
						kind: "retry",
						id: crypto.randomUUID(),
						attempt: event.attempt,
						maxAttempts: event.maxAttempts,
						delayMs: event.delayMs,
					},
				],
			};
		case "auto_retry_end":
			// The retry resolved → normal streaming/answer rendering replaces the indicator.
			return rt.turns.some((t) => t.kind === "retry")
				? { ...rt, turns: rt.turns.filter((t) => t.kind !== "retry") }
				: rt;
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
			if (request.text === null) {
				const { [request.key]: _drop, ...extUiStatus } = rt.extUiStatus;
				return { ...rt, extUiStatus };
			}
			return { ...rt, extUiStatus: { ...rt.extUiStatus, [request.key]: request.text } };
		}
		case "setWidget": {
			if (request.content === null) {
				const { [request.key]: _drop, ...extUiWidget } = rt.extUiWidget;
				return { ...rt, extUiWidget };
			}
			return { ...rt, extUiWidget: { ...rt.extUiWidget, [request.key]: request.content } };
		}
		default:
			return rt;
	}
}

interface AppState {
	status: ConnectionStatus;
	protocolVersion: number | null;
	projects: Project[];
	workspaces: Record<string, Workspace[]>;
	selectedProjectId: string | null;
	activeWorkspaceId: string | null;
	/** Center tabs belong to a workspace — switching workspaces swaps the visible tab set. */
	tabsByWorkspace: Record<string, EditorTab[]>;
	activeTabByWorkspace: Record<string, string | null>;
	/** Opened-documents History (view state, per workspace, most-recent-first, capped at 10; persisted to
	 * localStorage). File/diff tabs only — never chat. The History menu lists it; clicking re-opens a tab. */
	docHistoryByWorkspace: Record<string, DocHistoryEntry[]>;
	/** Terminals are workspace-scoped too; their instances stay mounted (hidden) to preserve buffers. */
	terminalsByWorkspace: Record<string, TerminalTab[]>;
	activeTerminalByWorkspace: Record<string, string | null>;
	/** Terminals whose tab was closed but whose process is still running (a view detach, not a kill),
	 * per workspace, most-recent-first. Their instances stay mounted (hidden) so the PTY survives. */
	backgroundedTerminalsByWorkspace: Record<string, TerminalTab[]>;
	/** Monotonic per-workspace terminal counter — drives stable "Terminal N" names that are never reused
	 * or renumbered when one is closed. */
	terminalCounterByWorkspace: Record<string, number>;
	/** Which side panels are collapsed (client-only view state, persisted to localStorage). */
	panelCollapsed: PanelCollapsed;
	/** The onboarding overlay: `"first-run"` (blocking) / `"review"` (closable, logo re-open) / null.
	 * Transient open-state only — the persisted "seen" flag lives in `onboardingStorage` (localStorage). */
	onboarding: "first-run" | "review" | null;
	/** One runtime per live chat (keyed by `sessionId`) — many can stream at once; switching is a swap. */
	sessions: Record<string, SessionRuntime>;
	/** Models with configured auth (cheap win #1) — fetched once, shared by every chat's picker. */
	models: WireModel[];
	/**
	 * A request to surface a file's diff in the right-panel Changes view (e.g. a chat turn-divider's
	 * "files changed" chip). The panels watch it and switch tab / select the file when it targets the
	 * active workspace; a fresh object each call so identical re-requests still fire.
	 */
	changesRequest: { workspaceId: string; path: string } | null;
	/**
	 * A one-shot request to switch the right rail to a given tab (a fresh nonce each call so repeat
	 * requests still fire). Used by the project row's settings gear to jump the already-open project rail
	 * to "hooks". `tab` is a plain string to keep the store free of the panel's tab union.
	 */
	railTabRequest: { tab: string; nonce: number } | null;
	/**
	 * The live-refresh signal, per workspace: `tick` increments on every `workspace.fsChanged` push (the
	 * host's debounced worktree change notifier); `paths`/`truncated` are the LAST batch only. Panels
	 * select their workspace's entry and silently refetch on `tick` change — the store holds only the
	 * signal, never fetches.
	 */
	fsChangesByWorkspace: Record<string, { tick: number; paths: string[]; truncated: boolean }>;
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
	/** Which project-entry dialog is open (create / open-local / clone), or null. Opened from the projects
	 * rail + Welcome; the three flows are mocked (see `panels/projectActions`, `panels/ProjectDialogs`). */
	projectDialog: "create" | "open" | "clone" | null;
	/** The active UI theme (host-owned; `applyConfig` sets it from `server.welcome` / `settings.changed`).
	 * The DOM side-effect (`applyTheme`) is the shell's job — this holds the value the UI reads. */
	theme: ThemeId;
	/** Transient notifications, oldest-first (the Toaster renders + times them out). At-most a handful live
	 * at once; a failed wire call that has no better home (no chat tab to host an error turn) lands here. */
	toasts: Toast[];
	setStatus: (status: ConnectionStatus) => void;
	setWelcome: (protocolVersion: number) => void;
	setProjects: (projects: Project[]) => void;
	setWorkspaces: (projectId: string, workspaces: Workspace[]) => void;
	/**
	 * Fold a server-pushed `workspace.created` snapshot in (**upsert** by id). A project never fetched is a
	 * **no-op** — a client that hasn't opened the project reconciles on its next `workspace.list` rather
	 * than being handed a partial one-row list (a wrong count); otherwise add if absent / merge if present
	 * (idempotent with the creating client's own post-create re-list).
	 */
	addWorkspace: (workspace: Workspace) => void;
	/**
	 * Fold a server-pushed `workspace.updated` snapshot in (e.g. the auto-rename): merge by id into the
	 * project's list. A project never fetched, or an id absent from its list, is a no-op — the next
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
	 * client's active workspace** re-select its owning project — which activates a sibling workspace
	 * when any remain, else falls back to the project's Welcome — and raise a neutral toast (reads
	 * correctly for both the initiator and an observer).
	 */
	applyWorkspaceRemoved: (projectId: string, workspaceId: string) => void;
	/**
	 * Select a project: re-enter its last-active workspace (falling back to the newest in the cached
	 * list) when it has any — the Welcome surface only shows for a project with **no** workspaces.
	 * Decides purely from the cached `workspaces[projectId]`, so callers refresh the list first (the
	 * panels' `selectProjectWithWorkspaces` helper) to avoid deciding on stale/absent data.
	 */
	selectProject: (projectId: string) => void;
	/** Clear the selection back to the Welcome screen (no project, no workspace) — the header logo. */
	showWelcome: () => void;
	/** Enter a workspace and select its owning project in one state transition. */
	activateWorkspace: (workspace: Pick<Workspace, "id" | "projectId">) => void;
	openTab: (tab: EditorTab) => void;
	closeTab: (id: string) => void;
	setActiveTab: (id: string) => void;
	/** Set a markdown file tab's view mode (rendered ↔ source); kept on the tab so it survives tab switches. */
	setFileTabView: (id: string, view: "rendered" | "source") => void;
	/** Fold a `workspace.fsChanged` push into the live-refresh signal (tick++, last batch replaces). */
	noteFsChanged: (payload: WorkspaceFsChangedPayload) => void;
	/** Replace a file tab's content after a live re-read, recording the fs tick it was loaded at. The tab
	 * is located across workspaces by its (globally unique) id; a closed tab is a no-op. */
	updateFileTabContent: (id: string, content: string, tick: number) => void;
	clearWorkspaceTabs: (workspaceId: string) => void;
	addTerminal: (workspaceId: string) => void;
	/** Close a terminal tab = **detach** it (view action): move it to the backgrounded list with its
	 * process kept alive (its instance stays mounted). NOT a process kill. */
	closeTerminalTab: (workspaceId: string, clientId: string) => void;
	/** Reattach a backgrounded terminal: bring its tab back (with its original number) + activate it. */
	reattachTerminal: (workspaceId: string, clientId: string) => void;
	setActiveTerminalTab: (workspaceId: string, clientId: string) => void;
	/** Collapse/expand a side panel (view-only; persisted to localStorage, never sent to the server). */
	togglePanel: (side: "left" | "right" | "terminal") => void;
	/** Open the onboarding overlay (`"first-run"` blocking on first launch, `"review"` from the logo). */
	openOnboarding: (mode: "first-run" | "review") => void;
	/** Close the onboarding overlay (finish / Done). */
	closeOnboarding: () => void;
	openChatSession: (
		workspaceId: string,
		sessionId: string,
		model: WireModel | null,
		thinkingLevel: ThinkingLevel,
	) => void;
	/** Drop a chat's runtime on tab close (the `AgentSession` is disposed over the wire by the caller). */
	closeChatRuntime: (sessionId: string) => void;
	/** Record a document open in the per-workspace History (view state): prepend most-recent, dedupe by
	 * kind+path, cap at 10, persist to localStorage. File/diff only — never chat. */
	noteDocOpened: (workspaceId: string, entry: DocHistoryEntry) => void;
	/**
	 * Rebuild a chat's runtime + tab from the host's report on connect — a no-op if a runtime already exists.
	 * `activate` focuses the tab (a user-driven reopen); otherwise it only takes focus if the workspace has
	 * none yet (auto-restore must not steal focus).
	 */
	hydrateSession: (summary: SessionSummary, hydrated: HydratedRuntime, activate?: boolean) => void;
	appendUserMessage: (sessionId: string, text: string) => void;
	/**
	 * Surface a failed send as a visible error turn. The turn-driving wire calls (`session.prompt`/`steer`/
	 * `followUp`/`create`) can reject before any pi event streams — e.g. `prompt()` throws "no API key" /
	 * validates a bad model. Without this the rejection is swallowed and the chat looks frozen.
	 */
	appendErrorTurn: (sessionId: string, text: string) => void;
	handlePiEvent: (event: PiEvent, sessionId: string) => void;
	setModels: (models: WireModel[]) => void;
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
	/** Open / close a project-entry dialog (create / open / clone). */
	openProjectDialog: (kind: "create" | "open" | "clone") => void;
	closeProjectDialog: () => void;
	closeSettings: () => void;
	setSettingsSection: (section: SettingsSection) => void;
	/** Fold the server-synced app config in (from `server.welcome` / the `settings.changed` broadcast). */
	applyConfig: (config: AppConfig) => void;
	/** Ask the right panel to open `path`'s diff in its Changes view (deep-link from chat). */
	requestChangesView: (workspaceId: string, path: string) => void;
	/** Ask the right rail to switch to `tab` (e.g. the project gear → "hooks"). */
	requestRailTab: (tab: string) => void;
	/** Enqueue a toast; returns its id so a caller can dismiss it early. An identical live toast (same
	 * variant/title/message — e.g. a retried failure) coalesces: no twin is added, the existing id returns.
	 * The queue caps at `MAX_TOASTS` (oldest drop). Prefer the `toast` helper. */
	pushToast: (toast: Omit<Toast, "id">) => string;
	/** Drop a toast (user dismiss or the Toaster's auto-timeout). A missing id is a no-op. */
	dismissToast: (id: string) => void;
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

export const useAppStore = create<AppState>((set, get) => ({
	status: "connecting",
	protocolVersion: null,
	projects: [],
	workspaces: {},
	selectedProjectId: null,
	activeWorkspaceId: null,
	tabsByWorkspace: {},
	activeTabByWorkspace: {},
	docHistoryByWorkspace: readDocHistory(),
	panelCollapsed: readPanelCollapsed(),
	onboarding: null,
	terminalsByWorkspace: {},
	activeTerminalByWorkspace: {},
	backgroundedTerminalsByWorkspace: {},
	terminalCounterByWorkspace: {},
	sessions: {},
	models: [],
	changesRequest: null,
	railTabRequest: null,
	fsChangesByWorkspace: {},
	activeLogin: null,
	settingsOpen: false,
	settingsSection: SettingsSection.Providers,
	projectDialog: null,
	theme: Theme.Dark,
	toasts: [],
	setStatus: (status) => set({ status }),
	setWelcome: (protocolVersion) => set({ protocolVersion }),
	setProjects: (projects) => set({ projects }),
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
					// Spread over the existing record: the push is the persisted snapshot, which carries no
					// computed diffStats — a plain replace would wipe the +/− badge until the next list.
					[workspace.projectId]: list.map((w) =>
						w.id === workspace.id ? { ...w, ...workspace } : w,
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
		// Drop the live-refresh signal too — a removed workspace's fs tick record must not linger.
		set((state) => {
			const { [workspaceId]: _gone, ...rest } = state.fsChangesByWorkspace;
			return { fsChangesByWorkspace: rest };
		});
		if (wasActive) {
			s.selectProject(projectId); // re-enters a sibling workspace, or the project's Welcome when none remain
			toast.info(`Workspace "${name ?? "?"}" was removed`);
		}
	},
	// Selecting a project opens its read-only project view in the center (never auto-enters a workspace);
	// entering the 3-column workspace view is only via `activateWorkspace` (a workspace row / creation).
	selectProject: (selectedProjectId) => set({ selectedProjectId, activeWorkspaceId: null }),
	showWelcome: () => set({ selectedProjectId: null, activeWorkspaceId: null }),
	activateWorkspace: (workspace) =>
		set({ selectedProjectId: workspace.projectId, activeWorkspaceId: workspace.id }),
	openTab: (tab) =>
		set((s) => {
			const tabs = s.tabsByWorkspace[tab.workspaceId] ?? [];
			return {
				tabsByWorkspace: tabs.some((t) => t.id === tab.id)
					? s.tabsByWorkspace
					: { ...s.tabsByWorkspace, [tab.workspaceId]: [...tabs, tab] },
				activeTabByWorkspace: { ...s.activeTabByWorkspace, [tab.workspaceId]: tab.id },
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
			};
		}),
	setActiveTab: (id) =>
		set((s) =>
			s.activeWorkspaceId
				? { activeTabByWorkspace: { ...s.activeTabByWorkspace, [s.activeWorkspaceId]: id } }
				: {},
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
	noteFsChanged: (payload) =>
		set((s) => {
			const prev = s.fsChangesByWorkspace[payload.workspaceId];
			return {
				fsChangesByWorkspace: {
					...s.fsChangesByWorkspace,
					[payload.workspaceId]: {
						tick: (prev?.tick ?? 0) + 1,
						paths: payload.paths,
						truncated: payload.truncated,
					},
				},
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
	clearWorkspaceTabs: (workspaceId) =>
		set((s) => {
			// Drop the runtimes of this workspace's open chat tabs (their AgentSessions are freed on host
			// shutdown).
			const sessions = { ...s.sessions };
			for (const tab of s.tabsByWorkspace[workspaceId] ?? []) {
				if (tab.kind === "chat") delete sessions[tab.sessionId];
			}
			const { [workspaceId]: _tabs, ...tabsByWorkspace } = s.tabsByWorkspace;
			const { [workspaceId]: _activeTab, ...activeTabByWorkspace } = s.activeTabByWorkspace;
			// The worktree is gone — its opened-documents History (invalid paths now) goes with it.
			const { [workspaceId]: _docs, ...docHistoryByWorkspace } = s.docHistoryByWorkspace;
			writeDocHistory(docHistoryByWorkspace);
			// The worktree is gone — unmount its terminals (open + backgrounded), closing their PTYs, and
			// drop its numbering counter.
			const { [workspaceId]: _terms, ...terminalsByWorkspace } = s.terminalsByWorkspace;
			const { [workspaceId]: _activeTerm, ...activeTerminalByWorkspace } =
				s.activeTerminalByWorkspace;
			const { [workspaceId]: _bgTerms, ...backgroundedTerminalsByWorkspace } =
				s.backgroundedTerminalsByWorkspace;
			const { [workspaceId]: _termCount, ...terminalCounterByWorkspace } =
				s.terminalCounterByWorkspace;
			return {
				tabsByWorkspace,
				activeTabByWorkspace,
				docHistoryByWorkspace,
				terminalsByWorkspace,
				activeTerminalByWorkspace,
				backgroundedTerminalsByWorkspace,
				terminalCounterByWorkspace,
				sessions,
			};
		}),
	addTerminal: (workspaceId) =>
		set((s) => {
			const list = s.terminalsByWorkspace[workspaceId] ?? [];
			const clientId = crypto.randomUUID();
			// Stable numbering: a monotonic per-workspace counter, so a number is never reused or renumbered
			// when a terminal is closed (Terminal 1 + Terminal 3 stay 1 and 3).
			const n = (s.terminalCounterByWorkspace[workspaceId] ?? 0) + 1;
			const tab: TerminalTab = { clientId, workspaceId, n, title: `Terminal ${n}` };
			return {
				terminalsByWorkspace: { ...s.terminalsByWorkspace, [workspaceId]: [...list, tab] },
				activeTerminalByWorkspace: { ...s.activeTerminalByWorkspace, [workspaceId]: clientId },
				terminalCounterByWorkspace: { ...s.terminalCounterByWorkspace, [workspaceId]: n },
			};
		}),
	closeTerminalTab: (workspaceId, clientId) =>
		set((s) => {
			// Detach, don't kill: move the tab to the backgrounded list (its instance stays mounted, so the
			// PTY keeps running) instead of dropping it.
			const open = s.terminalsByWorkspace[workspaceId] ?? [];
			const detached = open.find((t) => t.clientId === clientId);
			if (!detached) return {};
			const list = open.filter((t) => t.clientId !== clientId);
			const wasActive = s.activeTerminalByWorkspace[workspaceId] === clientId;
			const bg = s.backgroundedTerminalsByWorkspace[workspaceId] ?? [];
			return {
				terminalsByWorkspace: { ...s.terminalsByWorkspace, [workspaceId]: list },
				backgroundedTerminalsByWorkspace: {
					...s.backgroundedTerminalsByWorkspace,
					[workspaceId]: [detached, ...bg.filter((t) => t.clientId !== clientId)],
				},
				activeTerminalByWorkspace: {
					...s.activeTerminalByWorkspace,
					[workspaceId]: wasActive
						? (list.at(-1)?.clientId ?? null)
						: (s.activeTerminalByWorkspace[workspaceId] ?? null),
				},
			};
		}),
	reattachTerminal: (workspaceId, clientId) =>
		set((s) => {
			const bg = s.backgroundedTerminalsByWorkspace[workspaceId] ?? [];
			const tab = bg.find((t) => t.clientId === clientId);
			if (!tab) return {};
			const open = s.terminalsByWorkspace[workspaceId] ?? [];
			return {
				// Back to a tab (with its original number) + active; its instance never unmounted, so its
				// buffer + process are intact.
				terminalsByWorkspace: { ...s.terminalsByWorkspace, [workspaceId]: [...open, tab] },
				backgroundedTerminalsByWorkspace: {
					...s.backgroundedTerminalsByWorkspace,
					[workspaceId]: bg.filter((t) => t.clientId !== clientId),
				},
				activeTerminalByWorkspace: { ...s.activeTerminalByWorkspace, [workspaceId]: clientId },
			};
		}),
	togglePanel: (side) =>
		set((s) => {
			const panelCollapsed = { ...s.panelCollapsed, [side]: !s.panelCollapsed[side] };
			writePanelCollapsed(panelCollapsed);
			return { panelCollapsed };
		}),
	openOnboarding: (onboarding) => set({ onboarding }),
	closeOnboarding: () => set({ onboarding: null }),
	setActiveTerminalTab: (workspaceId, clientId) =>
		set((s) => ({
			activeTerminalByWorkspace: { ...s.activeTerminalByWorkspace, [workspaceId]: clientId },
		})),
	openChatSession: (workspaceId, sessionId, model, thinkingLevel) =>
		set((s) => {
			const id = `${workspaceId}:${sessionId}`;
			const tab: ChatTab = { kind: "chat", id, workspaceId, name: "Chat", sessionId };
			const tabs = s.tabsByWorkspace[workspaceId] ?? [];
			return {
				tabsByWorkspace: tabs.some((t) => t.id === id)
					? s.tabsByWorkspace
					: { ...s.tabsByWorkspace, [workspaceId]: [...tabs, tab] },
				activeTabByWorkspace: { ...s.activeTabByWorkspace, [workspaceId]: id },
				// Keep any existing runtime (idempotent); otherwise start a fresh one.
				sessions: s.sessions[sessionId]
					? s.sessions
					: { ...s.sessions, [sessionId]: newRuntime(model, thinkingLevel) },
			};
		}),
	closeChatRuntime: (sessionId) =>
		set((s) => {
			if (!s.sessions[sessionId]) return {};
			const { [sessionId]: _drop, ...sessions } = s.sessions;
			return { sessions };
		}),
	noteDocOpened: (workspaceId, entry) =>
		set((s) => {
			const list = s.docHistoryByWorkspace[workspaceId] ?? [];
			// Move-to-top: drop any existing entry for the same document, prepend, cap at the limit.
			const deduped = list.filter((e) => !(e.kind === entry.kind && e.path === entry.path));
			const next = [entry, ...deduped].slice(0, DOC_HISTORY_LIMIT);
			const docHistoryByWorkspace = { ...s.docHistoryByWorkspace, [workspaceId]: next };
			writeDocHistory(docHistoryByWorkspace);
			return { docHistoryByWorkspace };
		}),
	hydrateSession: (summary, hydrated, activate = false) =>
		set((s) => {
			if (s.sessions[summary.sessionId]) return {}; // a live/ahead runtime wins — never clobber it
			const wsId = summary.workspaceId;
			const runtime: SessionRuntime = {
				...newRuntime(summary.model, summary.thinkingLevel),
				turns: hydrated.turns,
				toolResults: hydrated.toolResults,
				askAnswers: hydrated.askAnswers,
				isStreaming: summary.isStreaming,
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
			return {
				sessions: { ...s.sessions, [summary.sessionId]: runtime },
				tabsByWorkspace: tabs.some((t) => t.id === id)
					? s.tabsByWorkspace
					: { ...s.tabsByWorkspace, [wsId]: [...tabs, tab] },
				// Focus on an explicit reopen; otherwise only if the workspace has no active tab yet (auto-restore
				// must not steal focus). Keyed to the summary's workspace, not the active one.
				activeTabByWorkspace:
					activate || !hasActive
						? { ...s.activeTabByWorkspace, [wsId]: id }
						: s.activeTabByWorkspace,
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
	setModels: (models) => set({ models }),
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
	openProjectDialog: (kind) => set({ projectDialog: kind }),
	closeProjectDialog: () => set({ projectDialog: null }),
	openSettings: (section = SettingsSection.Providers) =>
		set({ settingsOpen: true, settingsSection: section }),
	closeSettings: () => set({ settingsOpen: false }),
	setSettingsSection: (section) => set({ settingsSection: section }),
	applyConfig: (config) => set({ theme: config.theme }),
	requestChangesView: (workspaceId, path) => set({ changesRequest: { workspaceId, path } }),
	requestRailTab: (tab) => set({ railTabRequest: { tab, nonce: Date.now() } }),
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
