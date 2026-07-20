// App entities — the nouns the wire moves. project → workspace (git worktree) → {chats, files, terminals}.

export type TabStatus = "idle" | "running" | "waiting" | "error";

/** A git repository the user has opened. */
export interface Project {
	id: string;
	name: string;
	/** Absolute path to the git repo root. */
	path: string;
	/** Stable, unique, filesystem-safe slug from the name — the worktrees dir for this project. */
	slug: string;
	/** Epoch ms of last open, for sort order. */
	lastOpened: number;
}

/**
 * What a candidate project path is, so the UI can decide how to open it: an existing git repo (open
 * directly), a plain directory that could be `git init`ed (offer to initialise), or a broken path
 * (show an error). Answered by `project.inspect`.
 */
export type ProjectPathStatus = { kind: "repo" | "initable" | "missing" | "notDirectory" };

export interface DiffStats {
	added: number;
	removed: number;
}

/** A git worktree under a project — its own branch + cwd; the anchor for files/git/terminals/chats. */
export interface Workspace {
	id: string;
	projectId: string;
	/**
	 * Human-readable display label shown in the UI (Title Case, spaces) — decoupled from `branch`. May
	 * repeat across workspaces; the branch is what's uniqued. Equals `branch` only for the auto
	 * `workspace-N` placeholder.
	 */
	name: string;
	/** The git branch this worktree is on — a kebab slug derived from `name`, uniqued (refs + worktree dirs). */
	branch: string;
	/** Absolute path to the worktree (the cwd everything downstream uses). */
	worktreePath: string;
	/** Branch the worktree's diff is measured against. */
	baseBranch: string;
	/**
	 * Set once the workspace carries a deliberate name (assist auto-rename or a user rename; user-named
	 * creation sets it too). Absent = still the auto `workspace-N` default, eligible for exactly one
	 * assist rename on a settled turn.
	 */
	renamed?: boolean;
	diffStats?: DiffStats;
}

/**
 * The `workspace.fsChanged` push frame: the host's worktree watcher noticed on-disk changes (agent
 * edits, terminal commands, Finder). An **invalidation nudge, not data** — clients re-read via the
 * existing read methods, so a duplicate/replayed frame is harmless. `paths` are worktree-relative and
 * deduped, capped host-side; `truncated: true` = treat as a wildcard (anything may have changed).
 */
export interface WorkspaceFsChangedPayload {
	workspaceId: string;
	paths: string[];
	truncated: boolean;
}

/** A chat tab bound to a workspace. `id` is the UI tab id; `sessionId` is the pi `AgentSession` id. */
export interface Session {
	id: string;
	workspaceId: string;
	sessionId: string;
	title: string;
	status: TabStatus;
}

export type FileKind = "file" | "dir";

/** A node in a worktree's file tree. `children` is present once a directory is expanded (lazy). */
export interface FileNode {
	/** Path relative to the worktree root. */
	path: string;
	name: string;
	kind: FileKind;
	gitignored?: boolean;
	children?: FileNode[];
}

/**
 * A node of a worktree's spec-graph, as the Specs viewer renders it. Mirrored from `pi-spec-graph`'s
 * core model (never imported — the extension package stays out of the wire); `type`/`status` stay
 * `string` so the wire tolerates whatever is on disk.
 */
export interface SpecGraphNode {
	id: string;
	type: string;
	/** Frontmatter `title`, falling back to `id` host-side. */
	title: string;
	status?: string;
	/** Path relative to the worktree root — feeds the open-file flow. */
	path: string;
	/** Parent spec id (the tree edge); absent or dangling → rendered as a root. */
	parent?: string;
	dependsOn: string[];
	references: string[];
	implements: string[];
	tags: string[];
}

/** The whole-graph snapshot `spec.graph` returns; the client derives the tree. */
export interface SpecGraphSnapshot {
	nodes: SpecGraphNode[];
}

/** Lifecycle of a backlog item (mirrors `pi-todos`' core vocabulary; the extension is never imported). */
export type TodoStatus = "pending" | "in_progress" | "done";
/** Who added the item — the agent's plan vs the user's request. */
export type TodoOrigin = "agent" | "user";

/**
 * One item of a chat's TODO plan, as the chat's plan popup renders it. Mirrored from `pi-todos`' core
 * `Todo` (never imported — the extension package stays out of the wire). The plan is scoped to a chat
 * session.
 */
export interface TodoItem {
	id: string;
	title: string;
	status: TodoStatus;
	origin: TodoOrigin;
	note?: string;
	createdAt: string;
	updatedAt: string;
}

/** A named container of items — the agent's thematic cluster within a plan. */
export interface TodoGroupItem {
	id: string;
	title: string;
	todos: TodoItem[];
}

/**
 * A chat's whole TODO plan: loose items (the agent's standalone tasks + everything the user adds — never
 * grouped) followed by named groups, each carrying its own items.
 */
export interface TodoPlan {
	todos: TodoItem[];
	groups: TodoGroupItem[];
}

export type GitFileStatus = "added" | "modified" | "deleted" | "renamed" | "untracked";

export interface GitFileChange {
	/** Path relative to the worktree root. */
	path: string;
	status: GitFileStatus;
}

export interface GitStatus {
	branch: string;
	changes: GitFileChange[];
}

/** A repo's branches for the New-Workspace base picker. `defaultBranch` is `origin/main` when known. */
export interface BranchList {
	/** Local branch names (`git for-each-ref refs/heads`), e.g. `main`, `feature/x`. */
	local: string[];
	/** Remote-tracking branches under `origin` (e.g. `origin/main`), minus `origin/HEAD`. */
	remote: string[];
	/** Preselected base — `origin/HEAD` target → `origin/main` → repo `HEAD` branch (in that order). */
	defaultBranch: string;
}

/** Local `gh` CLI auth status (read-only, shelled server-side) for the New-Workspace + Settings surfaces. */
/** How a model provider is authenticated — drives the status row's label, never carries secrets. */
export type ProviderAuthKind = "oauth" | "api-key" | "env" | "central" | "other";

/** One model provider's auth status, as the host reports it (read-only; no credential values). */
export interface ProviderStatus {
	/** pi's provider id, e.g. `anthropic`. */
	id: string;
	/** Human display name, e.g. `Anthropic`. */
	name: string;
	/** Whether the provider is usable (any auth form: stored, env var, models.json, proxy). */
	configured: boolean;
	/** The auth source kind, when configured. `central` = routed through the JetBrains Central proxy. */
	kind?: ProviderAuthKind;
	/** Optional human hint for the source (e.g. the env var name, or `models.json`). */
	detail?: string;
	/** In-app OAuth login is available for this provider (`provider.loginStart`). */
	canOAuth?: boolean;
	/** In-app single-key API-key entry is available (`provider.setApiKey`) — false for multi-field creds. */
	canApiKey?: boolean;
	/** The provider has a removable `auth.json` credential (`provider.logout`) — false for env / central /
	 * models.json auth, which the host can't unset (so the strip shows no Sign-out for those). */
	canLogout?: boolean;
}

/**
 * How to install the JetBrains Central CLI (`central`) on the host — a copyable, per-OS one-liner the
 * JetBrains AI card renders proactively (before any connect attempt). Reflects the **host's** OS, never the
 * browser's: `central` must be installed on the machine running the host, which may be remote (V2
 * Tailscale/phone), so the command can't be inferred from the browser. The single source of truth for the
 * command lives host-side (`@thinkrail/shared/jbcentral`) and travels over the wire here.
 */
export interface JbcentralInstall {
	/** The host OS this command targets (`process.platform`: `darwin` | `linux` | `win32` | …). */
	platform: string;
	/** The shell the command runs in — `bash` on macOS/Linux, `powershell` on Windows. */
	shell: "bash" | "powershell";
	/** The one-line install command to copy/run on the host. */
	command: string;
}

/** The `provider.status` result: configured providers first, then the rest alphabetically. */
export interface ProviderStatusReport {
	providers: ProviderStatus[];
	/** Whether any provider's effective baseUrl routes through the jbcentral proxy (JetBrains AI is wired). */
	jbcentralWired: boolean;
	/** Whether the `central` CLI is installed on the host (drives the in-app JetBrains AI card's state). */
	jbcentralInstalled: boolean;
	/** The host's per-OS install command for the JetBrains Central CLI — rendered by the card when not
	 * installed (reflects the host's OS, not the browser's). */
	jbcentralInstall: JbcentralInstall;
}

/**
 * The outcome of an in-app `provider.jbcentralConnect` attempt — a small state machine the JetBrains AI card
 * walks the user through: connected, or the reason it couldn't (install the CLI / sign in / a hard error).
 */
export interface JbcentralConnectResult {
	outcome: "connected" | "needs-install" | "needs-login" | "error";
	/** The failure detail when `outcome === "error"`. The `needs-install` case carries no message — the card
	 * renders the per-OS command from `ProviderStatusReport.jbcentralInstall`. */
	message?: string;
}

/**
 * A single update in an in-app OAuth login flow, pushed host→client on the `provider.login` channel
 * (keyed by `loginId`). Frames **accumulate** into the client's per-login state rather than replacing it:
 * `authUrl` and `prompt` can be live at once (the anthropic/openai browser-vs-paste race — open the URL
 * *or* paste the code). `success`/`error` are terminal. `select`/`prompt` await a `provider.loginReply`.
 */
export type LoginFrame =
	| { kind: "authUrl"; url: string; instructions?: string }
	| { kind: "deviceCode"; userCode: string; verificationUri: string; expiresInSeconds?: number }
	| { kind: "select"; message: string; options: { id: string; label: string }[] }
	| { kind: "prompt"; message: string; placeholder?: string; allowEmpty?: boolean }
	| { kind: "progress"; message: string }
	| { kind: "success" }
	| { kind: "error"; message: string };

/** The `provider.login` push payload: a frame tagged with its login handle + the provider it authenticates. */
export interface LoginPush {
	loginId: string;
	providerId: string;
	frame: LoginFrame;
}

/** The browser's answer to a `select`/`prompt` frame — resolves the parked pi login callback by `loginId`. */
export interface LoginReply {
	loginId: string;
	value: string;
}

export interface GithubAuthStatus {
	connected: boolean;
	/** The authenticated github.com account, when connected. */
	login?: string;
	/** The token's OAuth scopes, when reported by `gh auth status`. */
	scopes?: string[];
}

/**
 * An opaque UI-theme selection. The independently shipped web client owns its manifest catalog, so the
 * host must be able to persist an id it did not know when built. A client without that manifest resolves
 * its own bundled default; no theme enum/list belongs on the wire.
 */
export type ThemeId = string;

/**
 * Server-synced app settings — OUR config, persisted host-side as `config.json` under the data dir and
 * delivered to every client in `server.welcome`. A small, extensible bag (theme is the first member);
 * mutate a subset via `settings.update`, converge on the `settings.changed` broadcast.
 */
export interface AppConfig {
	theme: ThemeId;
}

/** The config a fresh host (no `config.json` yet) falls back to. */
export const DEFAULT_CONFIG: AppConfig = { theme: "dark" };

/** History-search scope — the overlay's cycle: this chat → workspace → project → everywhere. */
export type HistoryScope =
	| { kind: "chat"; sessionId: string }
	| { kind: "workspace"; workspaceId: string }
	| { kind: "project"; projectId: string }
	| { kind: "all" };

/** One recalled prompt (prompts section: deduped by normalized text, newest kept, recency-ordered). */
export interface PromptHit {
	text: string;
	timestamp: number;
	sessionId: string;
	/** pi's session display name, when set. */
	sessionTitle?: string;
	/** Mapped from the session's cwd via the workspace registry; absent for unmapped (pi-CLI) cwds. */
	workspaceId?: string;
	projectId?: string;
	cwd: string;
}

/** One full-text conversation match. `messageIndex` is the position in the `session.getMessages`
 * transcript; `anchorText` (a prefix of the message text) lets the client validate/fall back if the
 * live transcript drifted from the indexed file (e.g. after compaction). */
export interface MessageHit extends PromptHit {
	role: "user" | "assistant";
	snippet: string;
	messageIndex: number;
	anchorText: string;
}

/** `history.search` result. `indexing` = the one-time cold build is still running (show "indexing…"). */
export interface HistorySearchResult {
	prompts: PromptHit[];
	messages: MessageHit[];
	promptTotal: number;
	messageTotal: number;
	indexing: boolean;
}

/** Scope of a prompt template — global (pi's global dir) or project-scoped. */
export type TemplateScope = "global" | "project";

/** A prompt template: a re-usable text snippet with optional metadata. */
export interface TemplateInfo {
	/** The template's unique name (within its scope). */
	name: string;
	/** Optional description of the template's purpose. */
	description?: string;
	/** Optional hint for argument placeholders or usage. */
	argumentHint?: string;
	/** The full file text: frontmatter + body. */
	content: string;
	/** Where the template lives — global or project-scoped. */
	scope: TemplateScope;
	/** Absolute path to the template file on disk. */
	filePath: string;
}
