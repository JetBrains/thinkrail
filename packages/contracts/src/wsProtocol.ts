// The browser↔host API — ours, not pi's. Methods are request/response; channels are server→client push.

import type {
	BranchList,
	DiffStats,
	FileNode,
	GithubAuthStatus,
	GitStatus,
	Project,
	Workspace,
} from "./domain";
import type {
	ExtUiResponse,
	ImageContent,
	Message,
	Model,
	SessionStats,
	SessionSummary,
	SlashCommandInfo,
	ThinkingLevel,
} from "./piProtocol";

/** Bumped on any breaking wire change; sent in `server.welcome` so a stale UI can detect host drift. */
export const PROTOCOL_VERSION = 1;

/** Request/response methods. `session.*` (the pi engine) is added at M10. */
export const WS_METHODS = {
	projectOpen: "project.open",
	projectList: "project.list",
	projectClose: "project.close",
	workspaceCreate: "workspace.create",
	workspaceList: "workspace.list",
	workspaceRemove: "workspace.remove",
	workspaceDiffStats: "workspace.diffStats",
	// gh-backed New-Workspace surface (M14): branch list per project + local `gh` auth status.
	gitListBranches: "git.listBranches",
	githubAuthStatus: "github.authStatus",
	githubRefresh: "github.refresh",
	fsReadDir: "fs.readDir",
	fsReadFile: "fs.readFile",
	gitStatus: "git.status",
	gitDiff: "git.diff",
	terminalCreate: "terminal.create",
	terminalWrite: "terminal.write",
	terminalResize: "terminal.resize",
	terminalClose: "terminal.close",
	dialogSelectDirectory: "dialog.selectDirectory",
	// session.* — the pi engine (M10); the Composer + cheap wins (model/thinking/stats/skills) join at M12.
	sessionCreate: "session.create",
	sessionPrompt: "session.prompt",
	sessionSteer: "session.steer",
	sessionFollowUp: "session.followUp",
	sessionAbort: "session.abort",
	sessionDispose: "session.dispose",
	sessionSetModel: "session.setModel",
	sessionSetThinkingLevel: "session.setThinkingLevel",
	sessionCompact: "session.compact",
	sessionGetStats: "session.getStats",
	sessionGetCommands: "session.getCommands",
	sessionExtUiReply: "session.extUiReply",
	// Read side of the wire (hydrate-then-stream, M16): a client lists a workspace's sessions and pulls a
	// transcript to rebuild its view on connect.
	sessionList: "session.list",
	sessionGetMessages: "session.getMessages",
	modelList: "model.list",
	modelDefault: "model.default",
} as const;

/** Server→client push channels. */
export const WS_CHANNELS = {
	serverWelcome: "server.welcome",
	piEvent: "pi.event",
	piExtensionUi: "pi.extensionUi",
	terminalData: "terminal.data",
} as const;

export type WsMethod = (typeof WS_METHODS)[keyof typeof WS_METHODS];
export type WsChannel = (typeof WS_CHANNELS)[keyof typeof WS_CHANNELS];

/** Wire result for methods that return nothing meaningful — the host coerces a void handler to this. */
export interface Ack {
	ok: true;
}

/** Per-method params + result. Both ends (web request, server handler) are typed off this. */
export interface WsMethodMap {
	"project.open": { params: { path: string }; result: Project };
	"project.list": { params: Record<string, never>; result: Project[] };
	"project.close": { params: { id: string }; result: Ack };
	// `baseRef` (M14): the base branch the worktree is cut from (a remote ref is fetched first); when
	// omitted, the worktree branches off the repo's current HEAD (the M5 behavior).
	"workspace.create": {
		params: { projectId: string; name?: string; baseRef?: string };
		result: Workspace;
	};
	"workspace.list": { params: { projectId: string }; result: Workspace[] };
	"workspace.remove": { params: { id: string }; result: Ack };
	"workspace.diffStats": { params: { id: string }; result: DiffStats };
	"git.listBranches": { params: { projectId: string }; result: BranchList };
	"github.authStatus": { params: Record<string, never>; result: GithubAuthStatus };
	"github.refresh": { params: Record<string, never>; result: GithubAuthStatus };
	"fs.readDir": { params: { workspaceId: string; path: string }; result: FileNode[] };
	"fs.readFile": { params: { workspaceId: string; path: string }; result: { content: string } };
	"git.status": { params: { workspaceId: string }; result: GitStatus };
	"git.diff": { params: { workspaceId: string; path?: string }; result: { diff: string } };
	"terminal.create": { params: { workspaceId: string }; result: { id: string } };
	"terminal.write": { params: { id: string; data: string }; result: Ack };
	"terminal.resize": { params: { id: string; cols: number; rows: number }; result: Ack };
	"terminal.close": { params: { id: string }; result: Ack };
	"dialog.selectDirectory": { params: Record<string, never>; result: { path: string | null } };
	"session.create": {
		// `model`/`thinkingLevel` (M14): applied at create time via `createAgentSession`, e.g. the
		// New-Workspace dialog's pre-session picks. Omitted → pi resolves defaults from auth + settings.
		params: { workspaceId: string; model?: Model<string>; thinkingLevel?: ThinkingLevel };
		// The resolved model/thinking the new session starts with (pi picks defaults from auth + settings).
		result: { sessionId: string; model: Model<string> | null; thinkingLevel: ThinkingLevel };
	};
	"session.prompt": {
		params: { sessionId: string; text: string; images?: ImageContent[] };
		result: Ack;
	};
	"session.steer": {
		params: { sessionId: string; text: string; images?: ImageContent[] };
		result: Ack;
	};
	"session.followUp": {
		params: { sessionId: string; text: string; images?: ImageContent[] };
		result: Ack;
	};
	"session.abort": { params: { sessionId: string }; result: Ack };
	"session.dispose": { params: { sessionId: string }; result: Ack };
	"session.setModel": { params: { sessionId: string; model: Model<string> }; result: Ack };
	"session.setThinkingLevel": { params: { sessionId: string; level: ThinkingLevel }; result: Ack };
	"session.compact": { params: { sessionId: string; instructions?: string }; result: Ack };
	"session.getStats": { params: { sessionId: string }; result: SessionStats };
	"session.getCommands": { params: { sessionId: string }; result: SlashCommandInfo[] };
	"session.extUiReply": { params: { response: ExtUiResponse }; result: Ack };
	"session.list": { params: { workspaceId: string }; result: SessionSummary[] };
	// Re-opens the session from disk if it isn't already live, so the returned `summary` reflects the
	// now-live model/thinking (a disk `SessionSummary` only carries placeholders).
	"session.getMessages": {
		params: { sessionId: string; workspaceId: string };
		result: { summary: SessionSummary; messages: Message[] };
	};
	"model.list": { params: Record<string, never>; result: Model<string>[] };
	// The model/thinking a fresh session resolves to (settings default, else first available) — so the
	// New-Workspace dialog shows the exact pre-session model, not a placeholder.
	"model.default": {
		params: Record<string, never>;
		result: { model: Model<string> | null; thinkingLevel: ThinkingLevel };
	};
}

export type WsMethodName = keyof WsMethodMap;
export type WsParams<M extends WsMethodName> = WsMethodMap[M]["params"];
export type WsResult<M extends WsMethodName> = WsMethodMap[M]["result"];

/** Client→host request. `sessionId` routes a command to a specific session (M10+). */
export interface WsRequest<M extends WsMethodName = WsMethodName> {
	id: string;
	method: M;
	params: WsParams<M>;
	sessionId?: string;
}

/** Host→client reply, correlated by `id`. */
export interface WsResponse {
	id: string;
	ok: boolean;
	result?: unknown;
	error?: string;
}

/** Host→client push on a channel (no correlation id). */
export interface WsPush {
	channel: WsChannel;
	data: unknown;
}

/** Anything the host sends: a correlated response or a channel push (discriminate on `channel`). */
export type WsServerMessage = WsResponse | WsPush;
