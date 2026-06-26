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
	/** Chat is a single active session in M11/M12 (global state); it moves into per-session runtimes at M13. */
	chatSessionId: string | null;
	/** Conversation as pi-canonical turns (user/assistant messages + web-local system notices). */
	turns: ChatTurn[];
	/** Live tool state keyed by toolCallId; paired with the toolCall block inside an assistant turn. */
	toolResults: Record<string, ToolResultState>;
	currentAssistantId: string | null;
	isStreaming: boolean;
	/** Models with configured auth (cheap win #1) — fetched once, shared by every chat's picker. */
	models: Model<string>[];
	/** The active chat's model + thinking level (display only; `pi` owns them). */
	currentModel: Model<string> | null;
	thinkingLevel: ThinkingLevel;
	/** The active chat's token/cost stats (cheap win #3), refreshed after each turn. */
	stats: SessionStats | null;
	/** The active chat's slash commands / skills (cheap win #2). */
	commands: SlashCommandInfo[];
	/** Per-session composer draft, so switching tabs (M13) preserves unsent text. */
	chatDrafts: Record<string, string>;
	/** The extension-UI dialog awaiting a reply (one shown at a time; overlapping dialogs queue behind it). */
	pendingExtUi: ExtUiDialogRequest | null;
	/** Dialogs that arrived while one was already open — shown FIFO so none orphans its server promise. */
	extUiQueue: ExtUiDialogRequest[];
	/** Extension status-bar entries / widgets (the fire-and-forget `setStatus`/`setWidget` calls). */
	extUiStatus: Record<string, string>;
	extUiWidget: Record<string, string[]>;
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
	appendUserMessage: (text: string) => void;
	handlePiEvent: (event: PiEvent, sessionId: string) => void;
	setModels: (models: Model<string>[]) => void;
	setCurrentModel: (model: Model<string>) => void;
	setThinkingLevel: (level: ThinkingLevel) => void;
	setStats: (stats: SessionStats) => void;
	setCommands: (commands: SlashCommandInfo[]) => void;
	setChatDraft: (sessionId: string, text: string) => void;
	/** Reply to the active extension-UI dialog (clears it; the transport send is `ChatView`'s job). */
	clearPendingExtUi: (id: string) => void;
	/** Fold an inbound `pi.extensionUi` frame into the store (dialogs, notices, status/widget, title). */
	applyExtUi: (request: ExtUiRequest) => void;
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
	chatSessionId: null,
	turns: [],
	toolResults: {},
	currentAssistantId: null,
	isStreaming: false,
	models: [],
	currentModel: null,
	thinkingLevel: "medium",
	stats: null,
	commands: [],
	chatDrafts: {},
	pendingExtUi: null,
	extUiQueue: [],
	extUiStatus: {},
	extUiWidget: {},
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
				chatSessionId: sessionId,
				turns: [],
				toolResults: {},
				currentAssistantId: null,
				isStreaming: false,
				currentModel: model,
				thinkingLevel,
				stats: null,
				commands: [],
				pendingExtUi: null,
				extUiQueue: [],
				extUiStatus: {},
				extUiWidget: {},
			};
		}),
	appendUserMessage: (text) =>
		set(
			(s): Partial<AppState> => ({
				turns: [
					...s.turns,
					{
						kind: "user",
						id: crypto.randomUUID(),
						message: { role: "user", content: text, timestamp: Date.now() },
					},
				],
			}),
		),
	// The event→store dispatcher: pi events become pi-canonical turns + a tool-result map. Per-session at M13.
	handlePiEvent: (event, sessionId) =>
		set((s): Partial<AppState> => {
			if (s.chatSessionId !== sessionId) return {}; // M11: only the one active chat
			switch (event.type) {
				case "agent_start":
					return { isStreaming: true };
				case "message_start":
					// User turns are shown optimistically on send; the assistant turn is created lazily on the
					// first message_update (from its `partial` snapshot) — here we just reserve its id.
					return event.message.role === "assistant"
						? { currentAssistantId: crypto.randomUUID() }
						: {};
				case "message_update": {
					const id = s.currentAssistantId;
					if (!id) return {};
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
					if (!snapshot) return {};
					const streaming = !(ame.type === "done" || ame.type === "error");
					const turn: ChatTurn = { kind: "assistant", id, message: snapshot, streaming };
					return {
						turns: s.turns.some((t) => t.id === id)
							? s.turns.map((t) => (t.id === id ? turn : t))
							: [...s.turns, turn],
					};
				}
				case "tool_execution_start":
					return {
						toolResults: {
							...s.toolResults,
							[event.toolCallId]: { status: "running", raw: undefined },
						},
					};
				case "tool_execution_update":
					return {
						toolResults: {
							...s.toolResults,
							[event.toolCallId]: { status: "running", raw: event.partialResult },
						},
					};
				case "tool_execution_end":
					return {
						toolResults: {
							...s.toolResults,
							[event.toolCallId]: { status: event.isError ? "error" : "done", raw: event.result },
						},
					};
				case "agent_end":
					if (event.willRetry) return {}; // auto-retry / compaction follows — stay streaming
					return {
						turns: [...s.turns, { kind: "system", id: crypto.randomUUID(), text: "✓ Done" }],
						isStreaming: false,
						currentAssistantId: null,
					};
				case "auto_retry_start":
					return {
						turns: [
							...s.turns,
							{
								kind: "system",
								id: crypto.randomUUID(),
								text: `Retrying (${event.attempt}/${event.maxAttempts})…`,
							},
						],
					};
				case "thinking_level_changed":
					return { thinkingLevel: event.level };
				default:
					return {};
			}
		}),
	setModels: (models) => set({ models }),
	setCurrentModel: (currentModel) => set({ currentModel }),
	setThinkingLevel: (thinkingLevel) => set({ thinkingLevel }),
	setStats: (stats) => set({ stats }),
	setCommands: (commands) => set({ commands }),
	setChatDraft: (sessionId, text) =>
		set((s) => ({ chatDrafts: { ...s.chatDrafts, [sessionId]: text } })),
	clearPendingExtUi: (id) =>
		set((s) => {
			if (s.pendingExtUi?.id !== id) return {};
			const [next, ...rest] = s.extUiQueue;
			return { pendingExtUi: next ?? null, extUiQueue: rest };
		}),
	// Inbound pi.extensionUi frames. M11/M12 render only the active chat, so dialogs/notices/status/widget
	// apply to `chatSessionId`; per-session routing arrives at M13.
	applyExtUi: (request) =>
		set((s): Partial<AppState> => {
			// `dismiss` (server-initiated close) drops the matching dialog from the head or the queue.
			if (request.kind === "dismiss") {
				if (s.pendingExtUi?.id === request.id) {
					const [next, ...rest] = s.extUiQueue;
					return { pendingExtUi: next ?? null, extUiQueue: rest };
				}
				if (s.extUiQueue.some((q) => q.id === request.id))
					return { extUiQueue: s.extUiQueue.filter((q) => q.id !== request.id) };
				return {};
			}
			if (request.sessionId !== s.chatSessionId) return {};
			switch (request.kind) {
				case "select":
				case "confirm":
				case "input":
				case "editor":
					// Show it now, or queue behind the open one so its server promise still gets answered.
					return s.pendingExtUi
						? { extUiQueue: [...s.extUiQueue, request] }
						: { pendingExtUi: request };
				case "notify":
					return {
						turns: [...s.turns, { kind: "system", id: crypto.randomUUID(), text: request.message }],
					};
				case "setStatus": {
					if (request.text === null) {
						const { [request.key]: _drop, ...extUiStatus } = s.extUiStatus;
						return { extUiStatus };
					}
					return { extUiStatus: { ...s.extUiStatus, [request.key]: request.text } };
				}
				case "setWidget": {
					if (request.content === null) {
						const { [request.key]: _drop, ...extUiWidget } = s.extUiWidget;
						return { extUiWidget };
					}
					return { extUiWidget: { ...s.extUiWidget, [request.key]: request.content } };
				}
				case "setTitle": {
					const wsId = s.activeWorkspaceId;
					if (!wsId) return {};
					const tabs = (s.tabsByWorkspace[wsId] ?? []).map((t) =>
						t.kind === "chat" && t.sessionId === request.sessionId
							? { ...t, name: request.title }
							: t,
					);
					return { tabsByWorkspace: { ...s.tabsByWorkspace, [wsId]: tabs } };
				}
				default:
					return {};
			}
		}),
}));
