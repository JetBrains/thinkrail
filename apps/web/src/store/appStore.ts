import type {
	ExtUiRequest,
	Model,
	PiEvent,
	Project,
	SessionStats,
	SessionSummary,
	SlashCommandInfo,
	ThinkingLevel,
	Workspace,
} from "@thinkrail/contracts";
import { create } from "zustand";
import type { ChatTurn, ExtUiDialogRequest, ToolResultState } from "../chat/types";
import type { ConnectionStatus } from "../transport";

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
}
export interface ChatTab {
	kind: "chat";
	id: string; // `${workspaceId}:${sessionId}` — the AgentSession id is the one id model
	workspaceId: string;
	name: string;
	sessionId: string;
}
export type EditorTab = FileTab | ChatTab;

/** A terminal tab. `clientId` is the stable UI key; the server PTY id is owned by its `TerminalInstance`. */
export interface TerminalTab {
	clientId: string;
	workspaceId: string;
	title: string;
}

/** A chat tab the user closed — reopenable from history; its session + runtime stay alive in `sessions`. */
export interface ClosedChat {
	sessionId: string;
	title: string;
	closedAt: number;
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
	currentAssistantId: string | null;
	isStreaming: boolean;
	/** This chat's model + thinking level (display only; `pi` owns them). */
	model: Model<string> | null;
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

function newRuntime(model: Model<string> | null, thinkingLevel: ThinkingLevel): SessionRuntime {
	return {
		turns: [],
		toolResults: {},
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
			// The message's true terminal: pi forwards only *streaming* variants as `message_update` (the
			// LLM-level done/error become this event), so without it the turn would stay flagged streaming
			// until `agent_end` — seconds or minutes later when tools run (and never, for a tool blocked on
			// user input like `ask_user_question`). Adopt the final message too: it carries `stopReason`,
			// which the renderers use to spot dead (aborted/errored) tool calls.
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
	/** Chat tabs the user closed, per workspace (most-recent-first) — reopenable while their runtime lives. */
	closedChatsByWorkspace: Record<string, ClosedChat[]>;
	/** Terminals are workspace-scoped too; their instances stay mounted (hidden) to preserve buffers. */
	terminalsByWorkspace: Record<string, TerminalTab[]>;
	activeTerminalByWorkspace: Record<string, string | null>;
	/** One runtime per live chat (keyed by `sessionId`) — many can stream at once; switching is a swap. */
	sessions: Record<string, SessionRuntime>;
	/** Models with configured auth (cheap win #1) — fetched once, shared by every chat's picker. */
	models: Model<string>[];
	/**
	 * A request to surface a file's diff in the right-panel Changes view (e.g. a chat turn-divider's
	 * "files changed" chip). The panels watch it and switch tab / select the file when it targets the
	 * active workspace; a fresh object each call so identical re-requests still fire.
	 */
	changesRequest: { workspaceId: string; path: string } | null;
	setStatus: (status: ConnectionStatus) => void;
	setWelcome: (protocolVersion: number) => void;
	setProjects: (projects: Project[]) => void;
	setWorkspaces: (projectId: string, workspaces: Workspace[]) => void;
	/**
	 * Fold a server-pushed `workspace.updated` snapshot in (e.g. the auto-rename): merge by id into the
	 * project's list. A project never fetched, or an id absent from its list, is a no-op — the next
	 * `workspace.list` reconciles.
	 */
	updateWorkspace: (workspace: Workspace) => void;
	/** Optimistically drop a workspace from its project's list (the remove flow drops the row before
	 * the host finishes tearing the worktree down). A missing project/id is a no-op. */
	removeWorkspace: (projectId: string, workspaceId: string) => void;
	selectProject: (projectId: string) => void;
	setActiveWorkspace: (id: string | null) => void;
	openTab: (tab: EditorTab) => void;
	closeTab: (id: string) => void;
	setActiveTab: (id: string) => void;
	/** Set a markdown file tab's view mode (rendered ↔ source); kept on the tab so it survives tab switches. */
	setFileTabView: (id: string, view: "rendered" | "source") => void;
	clearWorkspaceTabs: (workspaceId: string) => void;
	addTerminal: (workspaceId: string) => void;
	closeTerminalTab: (workspaceId: string, clientId: string) => void;
	setActiveTerminalTab: (workspaceId: string, clientId: string) => void;
	openChatSession: (
		workspaceId: string,
		sessionId: string,
		model: Model<string> | null,
		thinkingLevel: ThinkingLevel,
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
		turns: ChatTurn[],
		toolResults: Record<string, ToolResultState>,
		activate?: boolean,
	) => void;
	appendUserMessage: (sessionId: string, text: string) => void;
	/**
	 * Surface a failed send as a visible error turn. The turn-driving wire calls (`session.prompt`/`steer`/
	 * `followUp`/`create`) can reject before any pi event streams — e.g. `prompt()` throws "no API key" /
	 * validates a bad model. Without this the rejection is swallowed and the chat looks frozen.
	 */
	appendErrorTurn: (sessionId: string, text: string) => void;
	handlePiEvent: (event: PiEvent, sessionId: string) => void;
	setModels: (models: Model<string>[]) => void;
	setCurrentModel: (sessionId: string, model: Model<string>) => void;
	setThinkingLevel: (sessionId: string, level: ThinkingLevel) => void;
	setStats: (sessionId: string, stats: SessionStats) => void;
	setCommands: (sessionId: string, commands: SlashCommandInfo[]) => void;
	setChatDraft: (sessionId: string, text: string) => void;
	/** Reply to a chat's active dialog (clears it, promoting the queue; the transport send is `ChatView`'s job). */
	clearPendingExtUi: (sessionId: string, id: string) => void;
	/** Route an inbound `pi.extensionUi` frame to its session's runtime (dialogs/notices/status/widget/title). */
	applyExtUi: (request: ExtUiRequest) => void;
	/** Ask the right panel to open `path`'s diff in its Changes view (deep-link from chat). */
	requestChangesView: (workspaceId: string, path: string) => void;
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

export const useAppStore = create<AppState>((set) => ({
	status: "connecting",
	protocolVersion: null,
	projects: [],
	workspaces: {},
	selectedProjectId: null,
	activeWorkspaceId: null,
	tabsByWorkspace: {},
	activeTabByWorkspace: {},
	closedChatsByWorkspace: {},
	terminalsByWorkspace: {},
	activeTerminalByWorkspace: {},
	sessions: {},
	models: [],
	changesRequest: null,
	setStatus: (status) => set({ status }),
	setWelcome: (protocolVersion) => set({ protocolVersion }),
	setProjects: (projects) => set({ projects }),
	setWorkspaces: (projectId, workspaces) =>
		set((s) => ({ workspaces: { ...s.workspaces, [projectId]: workspaces } })),
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
	selectProject: (selectedProjectId) => set({ selectedProjectId }),
	setActiveWorkspace: (activeWorkspaceId) => set({ activeWorkspaceId }),
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
	clearWorkspaceTabs: (workspaceId) =>
		set((s) => {
			// Drop the runtimes of this workspace's chats — both open tabs and closed-to-history ones (their
			// AgentSessions are freed on host shutdown).
			const sessions = { ...s.sessions };
			for (const tab of s.tabsByWorkspace[workspaceId] ?? []) {
				if (tab.kind === "chat") delete sessions[tab.sessionId];
			}
			for (const closed of s.closedChatsByWorkspace[workspaceId] ?? [])
				delete sessions[closed.sessionId];
			const { [workspaceId]: _tabs, ...tabsByWorkspace } = s.tabsByWorkspace;
			const { [workspaceId]: _activeTab, ...activeTabByWorkspace } = s.activeTabByWorkspace;
			const { [workspaceId]: _closed, ...closedChatsByWorkspace } = s.closedChatsByWorkspace;
			// Dropping the terminals unmounts their instances, which close the PTYs server-side.
			const { [workspaceId]: _terms, ...terminalsByWorkspace } = s.terminalsByWorkspace;
			const { [workspaceId]: _activeTerm, ...activeTerminalByWorkspace } =
				s.activeTerminalByWorkspace;
			return {
				tabsByWorkspace,
				activeTabByWorkspace,
				closedChatsByWorkspace,
				terminalsByWorkspace,
				activeTerminalByWorkspace,
				sessions,
			};
		}),
	addTerminal: (workspaceId) =>
		set((s) => {
			const list = s.terminalsByWorkspace[workspaceId] ?? [];
			const clientId = crypto.randomUUID();
			const tab: TerminalTab = { clientId, workspaceId, title: `Terminal ${list.length + 1}` };
			return {
				terminalsByWorkspace: { ...s.terminalsByWorkspace, [workspaceId]: [...list, tab] },
				activeTerminalByWorkspace: { ...s.activeTerminalByWorkspace, [workspaceId]: clientId },
			};
		}),
	closeTerminalTab: (workspaceId, clientId) =>
		set((s) => {
			const list = (s.terminalsByWorkspace[workspaceId] ?? []).filter(
				(t) => t.clientId !== clientId,
			);
			const wasActive = s.activeTerminalByWorkspace[workspaceId] === clientId;
			return {
				terminalsByWorkspace: { ...s.terminalsByWorkspace, [workspaceId]: list },
				activeTerminalByWorkspace: {
					...s.activeTerminalByWorkspace,
					[workspaceId]: wasActive
						? (list.at(-1)?.clientId ?? null)
						: (s.activeTerminalByWorkspace[workspaceId] ?? null),
				},
			};
		}),
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
	hydrateSession: (summary, turns, toolResults, activate = false) =>
		set((s) => {
			if (s.sessions[summary.sessionId]) return {}; // a live/ahead runtime wins — never clobber it
			const wsId = summary.workspaceId;
			const runtime: SessionRuntime = {
				...newRuntime(summary.model, summary.thinkingLevel),
				turns,
				toolResults,
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
			const closed = s.closedChatsByWorkspace[wsId] ?? [];
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
	requestChangesView: (workspaceId, path) => set({ changesRequest: { workspaceId, path } }),
}));
