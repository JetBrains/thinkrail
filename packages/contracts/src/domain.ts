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
	/**
	 * This workspace's combine-mode override, chosen at create time (an "Advanced" control, shown only
	 * when the project declares hooks) and fixed for the workspace's whole life — read at every hook
	 * invocation, not just `onCreate`. `undefined` inherits the project's committed default
	 * (`HookConfigFile.combineMode`, itself defaulting to `"both"`).
	 */
	hookCombineMode?: CombineMode;
	/**
	 * The last known state of each declared lifecycle hook, nested by `HookSource` because a
	 * `combineMode` of `"both"` runs Shared *and* Local for the same event — persisted so a
	 * reconnecting/reloaded client learns about a still-pending `onCreate` without waiting on a live
	 * `workspace.hook` push. An already-connected client's live view comes from the `workspace.hook`
	 * event stream directly, not a round-trip through this field — this is durability across reconnects,
	 * not the live update path. For a script hook, `HookStatus.command` carries a display label (e.g.
	 * `script: .thinkrail/hooks/teardown.sh`), not the file contents.
	 */
	hookStatus?: Partial<Record<HookName, Partial<Record<HookSource, HookStatus>>>>;
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

/** Names of the workspace lifecycle hooks a project can declare in `.thinkrail/hooks.json`. */
export type HookName = "onCreate" | "onDelete" | "preMerge" | "postMerge";

/**
 * How a project's Shared and Local commands for the *same* event combine — one setting for all four
 * `HookName`s, not per-event. `both` (the default) runs Shared then Local, in that fixed order, so a
 * personal addition can only extend the team's baseline, never silently replace it; `shared`/`local` run
 * only that one tier. Resolved as `Workspace.hookCombineMode ?? HookConfigFile.combineMode ?? "both"`.
 */
export type CombineMode = "both" | "shared" | "local";

/**
 * Which tier a hook command/status/event belongs to: `shared` is committed in `.thinkrail/hooks.json`
 * (versioned, delivered to everyone on the repo — the team's reviewed setup); `local` is host-local
 * (`hookOverrides.json`), this machine only, never committed. Both tiers are scoped to a single project —
 * there is no machine-global or role tier.
 */
export type HookSource = "shared" | "local";

/**
 * One hook's declared value. A bare string is an inline command (the back-compatible shorthand — same as
 * `{ command }`, spelled out); `{ script }` is a path to a script file, run with `sh <path>` instead of
 * `sh -c "<command>"`. A Shared `script` path resolves relative to the worktree root (it propagates into
 * every worktree the same way the rest of `.thinkrail/hooks.json` does); a Local `script` path may be
 * absolute or worktree-relative.
 */
export type HookValue = string | { command: string } | { script: string };

/**
 * The parsed shape of a project's committed `.thinkrail/hooks.json` — the Shared tier's declared hooks
 * plus the project-wide default `combineMode`. Types-only: the server owns parsing, including back-compat
 * with the legacy flat file (`{ onCreate: "…" }`, no `version`/`hooks` keys), which reads as
 * `{ version: 1, combineMode: "both", hooks: <the flat object> }`.
 */
export interface HookConfigFile {
	version: 1;
	combineMode: CombineMode;
	hooks: Partial<Record<HookName, HookValue>>;
}

/** One hook's last known state, persisted on its `Workspace` record — see `Workspace.hookStatus`. */
export interface HookStatus {
	state: "awaitingApproval" | "running" | "succeeded" | "failed";
	/** The exact command that produced this state — carried so an approval prompt can show it verbatim. */
	command?: string;
	/** Set only when `state === "failed"` and the command actually ran (vs. never got approved). */
	exitCode?: number;
}

/**
 * The `workspace.hook` push payload — one frame per hook-state transition, broadcast to every client so a
 * workspace tab's setup/teardown status stays in sync everywhere (same convergence model as the
 * workspace-lifecycle trio). `hookAwaitingApproval` fires instead of `hookStarted` when the hook's command
 * hasn't been approved yet (or has changed since).
 *
 * Every variant carries `source: HookSource`. A `combineMode` of `"both"` runs Shared *then* Local for the
 * same `hook`, as two ordered entries (Shared first) — each gets its own
 * `hookStarted`/`hookOutput`/`hookSucceeded`/`hookFailed`/`hookAwaitingApproval` sequence tagged by its
 * `source`, so a client tells the two runs apart instead of conflating them into one. An unapproved entry
 * halts the remaining ones (see `submodule-server-workspaces-hooks`'s SPEC.md for the run/approval order).
 *
 * `workspace.hooks.approve` only records the approval for that project+hook — it does not itself re-run
 * anything. For `onDelete`/`preMerge`, that's enough: their next natural invocation (the next delete, the
 * next merge) checks approval fresh and runs. `onCreate` has no such "next invocation" — it fires exactly
 * once, at creation time — so approving it after the fact does not retroactively bootstrap a workspace
 * already sitting at `hookAwaitingApproval`. Re-running an already-created workspace's `onCreate` is not
 * implemented; see `submodule-server-workspaces-hooks`'s SPEC.md.
 *
 * `projectId` and `workspaceName` travel on every variant so a client can still describe a hook event
 * usefully after the workspace's own record is gone (e.g. removed mid-teardown) — see
 * `submodule-web-store`'s `applyWorkspaceHookEvent`.
 */
export type WorkspaceHookEvent =
	| {
			kind: "hookAwaitingApproval";
			workspaceId: string;
			workspaceName: string;
			projectId: string;
			hook: HookName;
			source: HookSource;
			command: string;
	  }
	| {
			kind: "hookStarted";
			workspaceId: string;
			workspaceName: string;
			projectId: string;
			hook: HookName;
			source: HookSource;
			command: string;
	  }
	| {
			kind: "hookOutput";
			workspaceId: string;
			workspaceName: string;
			projectId: string;
			hook: HookName;
			source: HookSource;
			chunk: string;
	  }
	| {
			kind: "hookSucceeded";
			workspaceId: string;
			workspaceName: string;
			projectId: string;
			hook: HookName;
			source: HookSource;
			command: string;
	  }
	| {
			kind: "hookFailed";
			workspaceId: string;
			workspaceName: string;
			projectId: string;
			hook: HookName;
			source: HookSource;
			command: string;
			exitCode: number;
	  };

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
 * The selectable UI themes. A const-object "enum" (the codebase's `WS_METHODS`/`WS_CHANNELS` convention):
 * enum ergonomics (`Theme.Dark`) + a runtime-iterable value list (`THEME_IDS`, the picker source), while the
 * values stay plain strings so they cross JSON/the wire with no casts. `Dark` is the default ThinkRail dark;
 * `Light`, `Darcula` (classic IntelliJ surfaces, ThinkRail violet accent), and `Gruvbox` (the vim classic —
 * warm retro darks, orange accent) are the additions. A client that doesn't know a theme id falls back to
 * Dark's `:root` tokens, so adding a value here is wire-compatible.
 */
export const Theme = {
	Dark: "dark",
	Light: "light",
	Darcula: "darcula",
	Gruvbox: "gruvbox",
} as const;
export type ThemeId = (typeof Theme)[keyof typeof Theme];
export const THEME_IDS: readonly ThemeId[] = Object.values(Theme);

/**
 * Server-synced app settings — OUR config, persisted host-side as `config.json` under the data dir and
 * delivered to every client in `server.welcome`. A small, extensible bag (theme is the first member);
 * mutate a subset via `settings.update`, converge on the `settings.changed` broadcast.
 */
export interface AppConfig {
	theme: ThemeId;
}

/** The config a fresh host (no `config.json` yet) falls back to. */
export const DEFAULT_CONFIG: AppConfig = { theme: Theme.Dark };
