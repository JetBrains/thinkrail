// The browser↔host API — ours, not pi's. Methods are request/response; channels are server→client push.

import type { AuthFlowStart, AuthStatusResult } from "./authProtocol";
import type {
	BranchList,
	DiffStats,
	FileNode,
	GithubAuthStatus,
	GitStatus,
	Project,
	ProjectPathStatus,
	SpecGraphSnapshot,
	Workspace,
} from "./domain";
import type {
	AskUserQuestionResult,
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

/**
 * The `server.welcome` push payload (the first message on every WS connect). `protocolVersion` lets a
 * stale UI detect host drift; `appVersion` is the host launcher's baked release version (a released
 * binary stamps it — `undefined` when run from source); `projects` seeds the initial project list.
 */
export interface ServerWelcome {
	protocolVersion: number;
	appVersion?: string;
	projects: Project[];
}

/** Request/response methods. `session.*` drives the pi engine. */
export const WS_METHODS = {
	projectOpen: "project.open",
	projectList: "project.list",
	projectClose: "project.close",
	// Classify a candidate path (existing repo / initable dir / broken) so the UI picks how to open it,
	// and initialise a plain directory as a git repo (init + commit) before opening it.
	projectInspect: "project.inspect",
	projectInit: "project.init",
	// Lazy per-project "has any registered spec?" (the Welcome screen's "Set up project" signal) — a
	// full-tree walk, so it's on-demand for the one project shown, never eagerly for every project.
	projectHasSpecs: "project.hasSpecs",
	workspaceCreate: "workspace.create",
	workspaceList: "workspace.list",
	workspaceRemove: "workspace.remove",
	workspaceDiffStats: "workspace.diffStats",
	// gh-backed New-Workspace surface: branch list per project + local `gh` auth status.
	gitListBranches: "git.listBranches",
	// Background freshness fetch of a remote base ref, fired when the New-Workspace dialog opens/picks a
	// base — keeps the ~2s network round-trip off the create critical path.
	gitPrefetch: "git.prefetch",
	githubAuthStatus: "github.authStatus",
	githubRefresh: "github.refresh",
	fsReadDir: "fs.readDir",
	fsReadFile: "fs.readFile",
	specGraph: "spec.graph",
	gitStatus: "git.status",
	gitDiff: "git.diff",
	terminalCreate: "terminal.create",
	terminalWrite: "terminal.write",
	terminalResize: "terminal.resize",
	terminalClose: "terminal.close",
	dialogSelectDirectory: "dialog.selectDirectory",
	// session.* — the pi engine; the Composer + cheap wins (model/thinking/stats/skills).
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
	// Inline `ask_user_question` reply: the browser sends the questionnaire result, correlated by the tool
	// call's id, to resolve the blocked tool `execute`.
	sessionAnswerQuestion: "session.answerQuestion",
	// Read side of the wire (hydrate-then-stream): a client lists a workspace's sessions and pulls a
	// transcript to rebuild its view on connect.
	sessionList: "session.list",
	sessionGetMessages: "session.getMessages",
	modelList: "model.list",
	modelDefault: "model.default",
	// auth.* — the provider-auth surface (the connect gate + Settings→Providers). Flow-starting
	// methods return a `flowId`; their progress streams on the `auth.event` channel.
	authStatus: "auth.status",
	authLogin: "auth.login",
	authAnswer: "auth.answer",
	authCancel: "auth.cancel",
	authSetApiKey: "auth.setApiKey",
	authLogout: "auth.logout",
	jbcentralInstall: "jbcentral.install",
	jbcentralLogin: "jbcentral.login",
	jbcentralConfigure: "jbcentral.configure",
	jbcentralUnwire: "jbcentral.unwire",
} as const;

/** Server→client push channels. */
export const WS_CHANNELS = {
	serverWelcome: "server.welcome",
	piEvent: "pi.event",
	piExtensionUi: "pi.extensionUi",
	terminalData: "terminal.data",
	// A host-initiated workspace mutation (the auto-rename), broadcast to every client. `data` is the
	// full persisted `Workspace` snapshot — idempotent under last-value replay, never a delta.
	workspaceUpdated: "workspace.updated",
	// Provider-auth flow frames (`AuthEvent`): OAuth urls/codes/prompts, jbcentral step progress, and
	// the `changed` invalidation that tells clients to re-fetch `auth.status` + `model.list`.
	authEvent: "auth.event",
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
	// Read-only classification of a path (repo / initable / missing / notDirectory) — the UI calls this
	// after a failed `project.open` to decide between an init offer and a plain error.
	"project.inspect": { params: { path: string }; result: ProjectPathStatus };
	// `git init` + `git add -A` + an (allow-empty) initial commit, then open the folder as a project.
	"project.init": { params: { path: string }; result: Project };
	// Does the project's repo carry any registered spec? Computed lazily (a full-tree walk), so it's
	// requested only for the project the Welcome screen renders — never eagerly for every project.
	"project.hasSpecs": { params: { projectId: string }; result: { hasSpecs: boolean } };
	// `baseRef`: the base branch the worktree is cut from (a remote ref is fetched first); when
	// omitted, the worktree branches off the repo's current HEAD (the default behavior).
	"workspace.create": {
		params: { projectId: string; name?: string; baseRef?: string };
		result: Workspace;
	};
	"workspace.list": { params: { projectId: string }; result: Workspace[] };
	"workspace.remove": { params: { id: string }; result: Ack };
	"workspace.diffStats": { params: { id: string }; result: DiffStats };
	"git.listBranches": { params: { projectId: string }; result: BranchList };
	// Best-effort background `git fetch` of a remote ref (`origin/<b>`); `ok` reports whether the fetch ran
	// (offline / non-remote ref → `false`). The UI fires-and-forgets it to warm the ref before create.
	"git.prefetch": { params: { projectId: string; ref: string }; result: { ok: boolean } };
	"github.authStatus": { params: Record<string, never>; result: GithubAuthStatus };
	"github.refresh": { params: Record<string, never>; result: GithubAuthStatus };
	"fs.readDir": { params: { workspaceId: string; path: string }; result: FileNode[] };
	"fs.readFile": { params: { workspaceId: string; path: string }; result: { content: string } };
	"spec.graph": { params: { workspaceId: string }; result: SpecGraphSnapshot };
	"git.status": { params: { workspaceId: string }; result: GitStatus };
	"git.diff": { params: { workspaceId: string; path?: string }; result: { diff: string } };
	"terminal.create": { params: { workspaceId: string }; result: { id: string } };
	"terminal.write": { params: { id: string; data: string }; result: Ack };
	"terminal.resize": { params: { id: string; cols: number; rows: number }; result: Ack };
	"terminal.close": { params: { id: string }; result: Ack };
	"dialog.selectDirectory": { params: Record<string, never>; result: { path: string | null } };
	"session.create": {
		// `model`/`thinkingLevel`: applied at create time via `createAgentSession`, e.g. the
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
	"session.answerQuestion": {
		params: { sessionId: string; toolCallId: string; result: AskUserQuestionResult };
		result: Ack;
	};
	"session.list": { params: { workspaceId: string }; result: SessionSummary[] };
	// Re-opens the session from disk if it isn't already live, so the returned `summary` reflects the
	// now-live model/thinking (a disk `SessionSummary` only carries placeholders).
	"session.getMessages": {
		params: { sessionId: string; workspaceId: string };
		result: { summary: SessionSummary; messages: Message[] };
	};
	"auth.status": { params: Record<string, never>; result: AuthStatusResult };
	// Starts the pi OAuth flow for a provider (`anthropic` / `openai-codex` / `github-copilot`).
	// Starting any flow cancels a still-running one (last click wins, across all clients).
	"auth.login": { params: { providerId: string }; result: AuthFlowStart };
	// Reply to a `prompt` / `select` / `manual-code` event, correlated by `requestId`. `null` cancels
	// the pending question (and with it the flow, if the flow can't proceed without it).
	"auth.answer": { params: { requestId: string; value: string | null }; result: Ack };
	"auth.cancel": { params: { flowId: string }; result: Ack };
	// The one write that carries a credential value (client→host). Result = fresh status snapshot.
	"auth.setApiKey": { params: { providerId: string; key: string }; result: AuthStatusResult };
	"auth.logout": { params: { providerId: string }; result: AuthStatusResult };
	// jbcentral steps, each an idempotent, separately-retryable flow (events on `auth.event`):
	// install (runs the official installer — the UI shows the exact command first), login (spawns
	// `jbcentral login`; the browser opens host-side), configure (`add claude` + `add codex` + wire
	// the proxy into models.json + reload the model registry).
	"jbcentral.install": { params: Record<string, never>; result: AuthFlowStart };
	"jbcentral.login": { params: Record<string, never>; result: AuthFlowStart };
	"jbcentral.configure": { params: Record<string, never>; result: AuthFlowStart };
	// Drop the proxy overrides from models.json (Settings escape hatch). Result = fresh status.
	"jbcentral.unwire": { params: Record<string, never>; result: AuthStatusResult };
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

/** Client→host request. `sessionId` routes a command to a specific session. */
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
