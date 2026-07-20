// The browser↔host API — ours, not pi's. Methods are request/response; channels are server→client push.

import type {
	AppConfig,
	BranchList,
	DiffStats,
	FileNode,
	GithubAuthStatus,
	GitStatus,
	HistoryScope,
	HistorySearchResult,
	JbcentralConnectResult,
	LoginReply,
	Project,
	ProjectPathStatus,
	ProviderStatusReport,
	SpecGraphSnapshot,
	TodoItem,
	TodoPlan,
	TodoStatus,
	Workspace,
} from "./domain";
import type {
	AskUserAnswersDetails,
	AskUserQuestionResult,
	ExtUiResponse,
	ImageContent,
	SessionStats,
	SessionSummary,
	SlashCommandInfo,
	ThinkingLevel,
	TranscriptMessage,
	WireCustomMessage,
	WireModel,
} from "./piProtocol";

/** Bumped on any breaking wire change; sent in `server.welcome` so a stale UI can detect host drift. */
// v4: model.* / session.create / session.setModel / SessionSummary now carry `WireModel` (pi's `Model`
// minus the secret-bearing `baseUrl`/`headers`); the host re-resolves the real model by `{provider,id}`.
// v5: workspace registry membership now streams to every client — `workspace.created` + `workspace.removed`
// join the existing `workspace.updated` (the workspace lifecycle trio; see `WS_CHANNELS`).
// v6: the worktree change notifier — `workspace.fsChanged` streams debounced fs-invalidation nudges so
// clients re-read files/specs/git state instead of polling.
// v7: server-synced app settings — `server.welcome` now carries `config: AppConfig` (the initial theme
// travels with the handshake), `settings.update` persists a partial, and `settings.changed` broadcasts
// the new config to every client so they converge (the same shared-state pattern as the workspace trio).
// v8: `ask_user_question` is ack + terminate — the tool no longer blocks; answers travel as
// `ask-user-answers` custom messages, and `session.getMessages` now returns `TranscriptMessage[]`
// (pi-canonical + `custom` role) so the questionnaire card can pair answers by tool call id.
// v9: chat-history search — `history.search` reads a lazy in-memory index over pi's session files
// (prompt recall + full-conversation matches, scoped chat/workspace/project/all, recency-ordered).
export const PROTOCOL_VERSION = 9;

/**
 * The `server.welcome` push payload (the first message on every WS connect). `protocolVersion` lets a
 * stale UI detect host drift; `appVersion` is the host launcher's baked release version (a released
 * binary stamps it — `undefined` when run from source); `projects` seeds the initial project list.
 */
export interface ServerWelcome {
	protocolVersion: number;
	appVersion?: string;
	projects: Project[];
	/** The server-synced app settings (theme, …) — applied on connect so the initial paint matches. */
	config: AppConfig;
}

/**
 * The `workspace.removed` push payload. Only the ids: the workspace record is already gone by the time the
 * event fires, and a client locates the row to drop by `projectId` + `id`. (`workspace.created`/`.updated`
 * carry a bare `Workspace` snapshot instead.)
 */
export interface WorkspaceRemoved {
	projectId: string;
	id: string;
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
	// A chat's TODO list (pi-todos), scoped by `sessionId`. Read + the user's write ops (the agent writes
	// the same per-session file via its own todo_* tools in-session; these are the UI's editing path).
	todoList: "todo.list",
	todoAdd: "todo.add",
	todoUpdate: "todo.update",
	todoRemove: "todo.remove",
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
	// call's id; the host delivers it to the session as an `ask-user-answers` custom message, starting the
	// next turn (or steering the current one).
	sessionAnswerQuestion: "session.answerQuestion",
	// Read side of the wire (hydrate-then-stream): a client lists a workspace's sessions and pulls a
	// transcript to rebuild its view on connect.
	sessionList: "session.list",
	sessionGetMessages: "session.getMessages",
	modelList: "model.list",
	modelDefault: "model.default",
	// Auth-provider status (the Welcome strip): per-provider configured + auth kind, jbcentral wiring.
	// Every read revalidates host-side (auth + registry reload), so a Refresh is just a re-request.
	providerStatus: "provider.status",
	// In-app provider auth (the Welcome strip's Sign-in). loginStart kicks off pi's OAuth flow DETACHED and
	// returns a handle immediately (the flow can take minutes — it must not sit on the request); frames
	// stream on the `provider.login` channel, and loginReply answers a select/prompt frame. setApiKey/logout
	// mutate auth.json directly. All revalidate the shared registry, so a following provider.status re-read reflects them.
	providerLoginStart: "provider.loginStart",
	providerLoginReply: "provider.loginReply",
	providerLoginCancel: "provider.loginCancel",
	providerSetApiKey: "provider.setApiKey",
	providerLogout: "provider.logout",
	// In-app JetBrains AI (jbcentral proxy) wiring: connect routes Claude+GPT via your JetBrains plan (writes
	// models.json + refreshes the registry), disconnect undoes it, login launches `jbcentral login` (browser).
	providerJbcentralConnect: "provider.jbcentralConnect",
	providerJbcentralDisconnect: "provider.jbcentralDisconnect",
	providerJbcentralLogin: "provider.jbcentralLogin",
	// Persist a partial change to the server-synced app settings (e.g. the theme). The host merges, saves
	// `config.json`, and broadcasts `settings.changed` — the caller converges on that push, not optimism.
	settingsUpdate: "settings.update",
	historySearch: "history.search",
} as const;

/** Server→client push channels. */
export const WS_CHANNELS = {
	serverWelcome: "server.welcome",
	piEvent: "pi.event",
	piExtensionUi: "pi.extensionUi",
	// In-app login flow updates (a `LoginPush` per frame), keyed by loginId. Session-less — a login runs on
	// the Welcome screen before any session exists, so this is the sibling of pi.extensionUi, not scoped to one.
	providerLogin: "provider.login",
	terminalData: "terminal.data",
	// The workspace-registry lifecycle trio, broadcast to every client so registry membership is shared
	// domain state (architecture #9), not per-client. All three are emitted by the `workspaces` module's
	// injected publisher (host maps kind → channel); every client reacts identically (no per-client
	// optimism). `created`/`updated` carry the full persisted `Workspace` snapshot (idempotent under
	// last-value replay, never a delta — `updated` is the auto-rename); `removed` carries a `WorkspaceRemoved`
	// id pair (the record is already gone).
	workspaceCreated: "workspace.created",
	workspaceUpdated: "workspace.updated",
	workspaceRemoved: "workspace.removed",
	// The worktree change notifier (a `WorkspaceFsChangedPayload` per frame), broadcast to every client.
	// A debounced invalidation nudge, not data — receivers re-read via the read methods they already use.
	workspaceFsChanged: "workspace.fsChanged",
	// The server-synced app settings changed (carries the full `AppConfig`), broadcast to every client so
	// they converge — the initiator applies on this push too, never optimistically.
	settingsChanged: "settings.changed",
} as const;

export type WsMethod = (typeof WS_METHODS)[keyof typeof WS_METHODS];
export type WsChannel = (typeof WS_CHANNELS)[keyof typeof WS_CHANNELS];

/**
 * The `customType` of the transcript message that carries an `ask_user_question` reply back to the agent
 * (host-injected via pi's `sendCustomMessage`, starting/steering a turn). Both ends key on it: the host
 * builds these messages; the UI pairs them with the questionnaire card by `details.toolCallId`
 * (`AskUserAnswersDetails`) and never renders them as their own bubble.
 */
export const ASK_USER_ANSWERS_CUSTOM_TYPE = "ask-user-answers";

/**
 * A correctly-paired `ask-user-answers` message. `WireCustomMessage.customType` stays `string` (the
 * namespace is open — any pi extension can mint custom messages, and they all cross the wire), so the
 * strictness lives at the two points that matter instead: the host's builder is HELD to this type (a
 * tag↔details mismatch is a compile error at the one place the message is minted), and
 * {@link isAskUserAnswersMessage} narrows to it.
 */
export interface AskUserAnswersMessage extends WireCustomMessage<AskUserAnswersDetails> {
	customType: typeof ASK_USER_ANSWERS_CUSTOM_TYPE;
	details: AskUserAnswersDetails;
}

/**
 * THE narrowing point for `ask-user-answers` messages, shared by every consumer (web hydration, the
 * event reducer, the server's answerability check) instead of hand-rolled checks. Wire data is untrusted
 * — another process, possibly another protocol version — so it validates the `details` shape, not just
 * the tag: a malformed reply is ignored rather than trusted on its customType.
 */
export function isAskUserAnswersMessage(message: unknown): message is AskUserAnswersMessage {
	if (!message || typeof message !== "object") return false;
	const m = message as { role?: unknown; customType?: unknown; details?: unknown };
	if (m.role !== "custom" || m.customType !== ASK_USER_ANSWERS_CUSTOM_TYPE) return false;
	const details = m.details as Partial<AskUserAnswersDetails> | undefined;
	return (
		typeof details?.toolCallId === "string" &&
		!!details.result &&
		Array.isArray(details.result.answers) &&
		typeof details.result.cancelled === "boolean"
	);
}

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
	"todo.list": {
		params: { workspaceId: string; sessionId: string };
		result: TodoPlan;
	};
	"todo.add": {
		params: { workspaceId: string; sessionId: string; title: string; note?: string };
		result: TodoItem;
	};
	"todo.update": {
		params: {
			workspaceId: string;
			sessionId: string;
			id: string;
			status?: TodoStatus;
			title?: string;
			note?: string;
		};
		result: TodoItem;
	};
	"todo.remove": { params: { workspaceId: string; sessionId: string; id: string }; result: Ack };
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
		params: { workspaceId: string; model?: WireModel; thinkingLevel?: ThinkingLevel };
		// The resolved model/thinking the new session starts with (pi picks defaults from auth + settings).
		result: { sessionId: string; model: WireModel | null; thinkingLevel: ThinkingLevel };
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
	"session.setModel": { params: { sessionId: string; model: WireModel }; result: Ack };
	"session.setThinkingLevel": { params: { sessionId: string; level: ThinkingLevel }; result: Ack };
	"session.compact": { params: { sessionId: string; instructions?: string }; result: Ack };
	"session.getStats": { params: { sessionId: string }; result: SessionStats };
	"session.getCommands": { params: { sessionId: string }; result: SlashCommandInfo[] };
	"session.extUiReply": { params: { response: ExtUiResponse }; result: Ack };
	// Rejects when the tool call is unknown, already answered, superseded by a later user message, or not
	// an awaiting ask — so a stale card fails loud instead of silently parking an answer.
	"session.answerQuestion": {
		params: { sessionId: string; toolCallId: string; result: AskUserQuestionResult };
		result: Ack;
	};
	"session.list": { params: { workspaceId: string }; result: SessionSummary[] };
	// Re-opens the session from disk if it isn't already live, so the returned `summary` reflects the
	// now-live model/thinking (a disk `SessionSummary` only carries placeholders).
	"session.getMessages": {
		params: { sessionId: string; workspaceId: string };
		result: { summary: SessionSummary; messages: TranscriptMessage[] };
	};
	"model.list": { params: Record<string, never>; result: WireModel[] };
	// The model/thinking a fresh session resolves to (settings default, else first available) — so the
	// New-Workspace dialog shows the exact pre-session model, not a placeholder.
	"model.default": {
		params: Record<string, never>;
		result: { model: WireModel | null; thinkingLevel: ThinkingLevel };
	};
	"provider.status": { params: Record<string, never>; result: ProviderStatusReport };
	// Mints a loginId and starts pi's OAuth flow detached; frames arrive on the `provider.login` channel.
	"provider.loginStart": { params: { providerId: string }; result: { loginId: string } };
	// Answers a live `select`/`prompt` frame (option id / typed text / pasted code) for the given login.
	"provider.loginReply": { params: LoginReply; result: Ack };
	// Cancels an in-flight login: aborts the flow AND settles any parked callback so pi doesn't hang.
	"provider.loginCancel": { params: { loginId: string }; result: Ack };
	// Stores a single API key for a provider (auth.json) and refreshes the registry. Not for multi-field creds.
	"provider.setApiKey": { params: { providerId: string; key: string }; result: Ack };
	// Removes a provider's stored credentials (auth.json) and refreshes the registry.
	"provider.logout": { params: { providerId: string }; result: Ack };
	// Wire Claude+GPT through the local jbcentral proxy (JetBrains AI). Returns a small state machine —
	// connected / needs-install / needs-login / error — the JetBrains AI card walks the user through.
	"provider.jbcentralConnect": { params: Record<string, never>; result: JbcentralConnectResult };
	"provider.jbcentralDisconnect": { params: Record<string, never>; result: Ack };
	// Launch `jbcentral login` (its browser sign-in) on the host, best-effort.
	"provider.jbcentralLogin": { params: Record<string, never>; result: { launched: boolean } };
	// Merge a partial into the server-synced app settings, persist it, and broadcast `settings.changed`.
	// Returns the merged, persisted `AppConfig`.
	"settings.update": { params: { config: Partial<AppConfig> }; result: AppConfig };
	// Prompt recall + full-text conversation search over pi's persisted sessions (and live ones — pi
	// appends as messages complete). Server-side index; results capped (default 50/section), true totals.
	"history.search": {
		params: { query: string; scope: HistoryScope; limit?: number };
		result: HistorySearchResult;
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
