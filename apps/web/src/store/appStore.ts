import type {
	ExtUiRequest,
	Model,
	PiEvent,
	Project,
	SessionStats,
	SlashCommandInfo,
	ThinkingLevel,
	Workspace,
} from "@thinkrail-pi/contracts";
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

/** Fold one pi event into a session's runtime (Appendix B). Pure — returns the same ref when nothing changes. */
export function reduceSessionEvent(rt: SessionRuntime, event: PiEvent): SessionRuntime {
	switch (event.type) {
		case "agent_start":
			return { ...rt, isStreaming: true };
		case "message_start":
			// User turns are shown optimistically on send; the assistant turn is created lazily on the first
			// message_update (from its `partial` snapshot) — here we just reserve its id.
			return event.message.role === "assistant"
				? { ...rt, currentAssistantId: crypto.randomUUID() }
				: rt;
		case "message_update": {
			const id = rt.currentAssistantId;
			if (!id) return rt;
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
			const streaming = !(ame.type === "done" || ame.type === "error");
			const turn: ChatTurn = { kind: "assistant", id, message: snapshot, streaming };
			return {
				...rt,
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
			if (event.willRetry) return rt; // auto-retry / compaction follows — stay streaming
			return {
				...rt,
				turns: [...rt.turns, { kind: "system", id: crypto.randomUUID(), text: "✓ Done" }],
				isStreaming: false,
				currentAssistantId: null,
			};
		case "auto_retry_start":
			return {
				...rt,
				turns: [
					...rt.turns,
					{
						kind: "system",
						id: crypto.randomUUID(),
						text: `Retrying (${event.attempt}/${event.maxAttempts})…`,
					},
				],
			};
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
	/** Terminals are workspace-scoped too; their instances stay mounted (hidden) to preserve buffers. */
	terminalsByWorkspace: Record<string, TerminalTab[]>;
	activeTerminalByWorkspace: Record<string, string | null>;
	/** One runtime per live chat (keyed by `sessionId`) — many can stream at once; switching is a swap. */
	sessions: Record<string, SessionRuntime>;
	/** Models with configured auth (cheap win #1) — fetched once, shared by every chat's picker. */
	models: Model<string>[];
	setStatus: (status: ConnectionStatus) => void;
	setWelcome: (protocolVersion: number) => void;
	setProjects: (projects: Project[]) => void;
	setWorkspaces: (projectId: string, workspaces: Workspace[]) => void;
	selectProject: (projectId: string) => void;
	setActiveWorkspace: (id: string) => void;
	openTab: (tab: EditorTab) => void;
	closeTab: (id: string) => void;
	setActiveTab: (id: string) => void;
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
	appendUserMessage: (sessionId: string, text: string) => void;
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
	terminalsByWorkspace: {},
	activeTerminalByWorkspace: {},
	sessions: {},
	models: [],
	setStatus: (status) => set({ status }),
	setWelcome: (protocolVersion) => set({ protocolVersion }),
	setProjects: (projects) => set({ projects }),
	setWorkspaces: (projectId, workspaces) =>
		set((s) => ({ workspaces: { ...s.workspaces, [projectId]: workspaces } })),
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
	clearWorkspaceTabs: (workspaceId) =>
		set((s) => {
			// Drop the runtimes of this workspace's chats too (their AgentSessions are freed on host shutdown).
			const sessions = { ...s.sessions };
			for (const tab of s.tabsByWorkspace[workspaceId] ?? []) {
				if (tab.kind === "chat") delete sessions[tab.sessionId];
			}
			const { [workspaceId]: _tabs, ...tabsByWorkspace } = s.tabsByWorkspace;
			const { [workspaceId]: _activeTab, ...activeTabByWorkspace } = s.activeTabByWorkspace;
			// Dropping the terminals unmounts their instances, which close the PTYs server-side.
			const { [workspaceId]: _terms, ...terminalsByWorkspace } = s.terminalsByWorkspace;
			const { [workspaceId]: _activeTerm, ...activeTerminalByWorkspace } =
				s.activeTerminalByWorkspace;
			return {
				tabsByWorkspace,
				activeTabByWorkspace,
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
}));
