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
	/** Closed projects stay known (and keep their id/workspace associations) but leave the open-project rail.
	 * Absent means open, so persisted records from before this field remain open without migration. */
	closed?: true;
	/**
	 * Whether the user has engaged trust for this project — the gate on loading its **committed cross-agent
	 * skill aliases** (`.claude/skills`, `.github/skills`, `.gemini/skills`), which are attacker-controlled
	 * for a cloned repo and injected into the agent's system prompt. `undefined` = undecided (untrusted).
	 * Personal (`~/.claude` …), pi-native, and ThinkRail-bundled skills load regardless.
	 */
	trusted?: boolean;
	/**
	 * Names of project-scoped alias skills the user has **acknowledged**. Granting trust acknowledges every
	 * such skill present at that moment; a skill that appears later (a pull, or a branch that ships a new
	 * one) is *not* here until confirmed — so trusting today's checkout can't silently admit tomorrow's
	 * committed skill. A project-scoped skill loads only when `trusted` **and** its name is in this set.
	 */
	acknowledgedSkills?: string[];
	/** Names disabled at the project baseline (any source), overridable per-workspace. */
	disabledSkills?: string[];
	/**
	 * Group keys disabled at the project baseline — a plugin name or a source tier
	 * (`project`/`personal`/`bundled`/`pi`), plus the special `@plugins` (all plugin skills). Turns a whole
	 * plugin/source off in one toggle and keeps future skills in that group off; a per-skill toggle overrides.
	 */
	disabledGroups?: string[];
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
	 * `"default"` marks the built-in per-project **Default workspace** — the project folder itself
	 * (git's main working tree) surfaced as a workspace. Exactly one per project, pinned first in
	 * `workspace.list`, non-removable and non-renamable (enforced server-side). Absent = a normal
	 * worktree workspace. An explicit wire field — clients must never detect it by id convention.
	 */
	kind?: "default";
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
	/**
	 * **Creation provenance** — the ref this worktree was cut from (`git worktree add … <baseBranch>`), or
	 * for the Default workspace the repo's default branch. Shown in the UI as `branch · from baseBranch`.
	 * It is *not* necessarily what the diff is measured against: see `diffBase`.
	 */
	baseBranch: string;
	/**
	 * **The diff target** — the ref the workspace's changes are measured against, when the user has
	 * re-pointed it (`workspace.setDiffBase`). Absent = measure against `baseBranch`. Two fields because
	 * the two meanings diverge the moment a target is re-pointed: creation provenance never moves, the
	 * review target does. Every *read* resolves `diffBase ?? baseBranch` server-side, in one place (the git
	 * module's `diffBaseRef`); a client only mirrors the resolution to label its target-branch picker.
	 */
	diffBase?: string;
	/**
	 * Set once the workspace carries a deliberate name (assist auto-rename or a user rename; user-named
	 * creation sets it too). Absent = still the auto `workspace-N` default, eligible for exactly one
	 * assist rename on a settled turn.
	 */
	renamed?: boolean;
	diffStats?: DiffStats;
	/**
	 * Per-skill enable/disable **overrides** for this workspace, keyed by skill name — `"on"` forces an
	 * admissible skill on (even if the project baseline disabled it), `"off"` forces it off. Absent → the
	 * project baseline (`Project.disabledSkills`) applies. Never un-gates an untrusted/unacknowledged
	 * project alias (admissibility is checked first).
	 */
	skillOverrides?: Record<string, "on" | "off">;
}

/**
 * A host-installed editor/IDE the "Open in" menu can offer, from `editor.list` — never a fixed client
 * list: the host probes its own PATH (+ a few well-known JetBrains launcher names) and only names what it
 * actually found, so the menu never carries a dead entry for an app the host doesn't have. `kind` is
 * routing info the client needs: `"gui"` spawns the app detached via `workspace.openIn`; `"terminal"` (Vim)
 * has no window of its own — the client opens/focuses that workspace's embedded terminal and runs it there
 * instead of asking the host to spawn a TTY-less child process.
 */
export interface EditorInfo {
	/** Stable across a host's lifetime, but not a wire-versioned enum — new candidates can appear freely. */
	id: string;
	/** Display label, e.g. "VS Code", "WebStorm". */
	label: string;
	kind: "gui" | "terminal";
}

/**
 * The `workspace.fsChanged` push frame: the host's worktree watcher noticed on-disk changes (agent
 * edits, terminal commands, Finder). An **invalidation nudge, not data** — clients re-read via the
 * existing read methods, so a duplicate/replayed frame is harmless. `paths` are worktree-relative and
 * deduped, capped host-side; `truncated: true` = treat as a wildcard (anything may have changed).
 *
 * An **empty, non-truncated** frame (`paths: []`, `truncated: false`) is the pathless variant: something
 * the reads depend on moved *without* naming a file — the host emits it when a worktree's git metadata
 * moves (a `commit`/`reset`/`switch` in a terminal), which invalidates the git-derived reads (`git.status`,
 * an `uncommitted`-scope diff) while leaving the working tree untouched. Same contract: re-read, don't
 * patch. Path-driven consumers see no paths and correctly do nothing extra.
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

/**
 * A group's lifecycle as a *task*: `active` = some step is in progress, `done` = every step is, else
 * `pending`. **Derived from the steps by the host** (`pi-todos`' `groupStatus`) and shipped on the DTO, so
 * the rule has one home — clients render it, they never re-derive it.
 */
export type TodoGroupStatus = "pending" | "active" | "done";

/** A named container of items — the agent's task within a plan (its items are the steps). */
export interface TodoGroupItem {
	id: string;
	title: string;
	todos: TodoItem[];
	/** Derived, never stored — see {@link TodoGroupStatus}. */
	status: TodoGroupStatus;
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
	/**
	 * Lines added / removed over the scope's range (`git diff --numstat`; untracked files count their whole
	 * content as added). Omitted when git reports no per-line count — binary files, or a rename whose
	 * numstat path couldn't be resolved. Used by the Changes tree's per-file / per-folder `+/−` badge.
	 */
	added?: number;
	removed?: number;
}

export interface GitStatus {
	branch: string;
	changes: GitFileChange[];
}

/**
 * **What** is being diffed — the Changes panel's scope selector, and part of a diff tab's identity (a
 * tab's content must never change meaning because the rail's scope flipped underneath it). Omitted on the
 * wire = `{ kind: "branch" }`, so an older client keeps working unchanged.
 *
 * - `branch` — what this workspace changed since diverging from its diff base (`diffBase ??
 *   baseBranch`): the range starts at their **merge-base** (the fork point), never at the base's tip —
 *   upstream work landing on the base is not this workspace's change and never shows up here.
 * - `uncommitted` — the worktree vs `HEAD` (what a commit here would record).
 * - `commit` — one commit alone (`sha^` vs `sha`; a root commit degrades to an add-style diff).
 */
export type GitDiffScope =
	| { kind: "branch" }
	| { kind: "uncommitted" }
	| { kind: "commit"; sha: string };

/** One commit on the workspace's branch (not on its diff base) — a row of the scope menu's commit list. */
export interface GitCommit {
	sha: string;
	/** Abbreviated oid as git prints it (`%h`) — the display form. */
	shortSha: string;
	subject: string;
	author: string;
	/** Commit date, ISO 8601 (`%cI`). */
	committedAt: string;
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
	/** Interactive API-key login is available (`provider.loginStart` with `type: "api_key"`) — pi's
	 * provider-owned truth (`Provider.auth.apiKey.login`), multi-prompt providers included. */
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
	| {
			kind: "prompt";
			message: string;
			placeholder?: string;
			allowEmpty?: boolean;
			/** pi marked the prompt `secret` (an API key) — the dialog masks the input. */
			secret?: boolean;
	  }
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
	/**
	 * Anonymous usage analytics on/off (default on — the opt-out posture; a first-run notice + this
	 * switch are the transparency half). This boolean is the ONLY analytics fact on the wire: events
	 * are emitted host-side and the per-install id never leaves the host (it lives in the server-only
	 * `installation.json`, deliberately not in this broadcast bag).
	 */
	analyticsEnabled: boolean;
}

/** The config a fresh host (no `config.json` yet) falls back to. */
export const DEFAULT_CONFIG: AppConfig = { theme: "dark", analyticsEnabled: true };

/**
 * Prefix on the internal "wake the agent" nudge the client sends when a TODO is added. It is control
 * traffic, not conversation: hidden from the rendered transcript (never appended live, skipped on
 * hydrate) and excluded from history search. Lives on the wire so both the web client (which authors and
 * hides it) and the host history indexer (which must skip it) agree on the exact marker.
 */
export const TODO_NUDGE_PREFIX = "[thinkrail:todo-nudge] ";

/**
 * True when a send's text is internal control traffic rather than a user-authored message. The one
 * shared reading of the marker above — the client hides these on hydrate, the host skips them in the
 * history index and does not count them as sent messages in analytics.
 */
export function isControlMessage(text: string): boolean {
	return text.startsWith(TODO_NUDGE_PREFIX);
}

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
	/**
	 * The kept-newest occurrence's position in `session.getMessages` order — the same jump anchor a
	 * `MessageHit` carries, letting the prompt row itself be jumped to. Optional for tolerance; a v10+
	 * host always sets it alongside `anchorText`.
	 */
	messageIndex?: number;
	/**
	 * The kept-newest occurrence's message-text prefix — the same drift-tolerant jump validation a
	 * `MessageHit` carries. Optional for tolerance; a v10+ host always sets it alongside `messageIndex`.
	 */
	anchorText?: string;
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

/**
 * Protocol maximum for `history.search`'s `limit`. The client asks for far fewer; this is the hard
 * ceiling the host clamps a request to (defense in depth), so a malformed/oversized/negative `limit`
 * can neither defeat the cap nor hit `Array.slice`'s negative-index semantics.
 */
export const MAX_HISTORY_LIMIT = 200;

/** Protocol maximum for a `history.search` `query`, in characters — bounds worst-case matching work. */
export const MAX_HISTORY_QUERY_LENGTH = 200;

/** `history.search` result. `indexing` = a build is still in flight — the one-time cold build, or a
 * background warm revalidation — so results may not yet be complete/current; the client keeps re-querying
 * (and may show "indexing…") until it clears. */
export interface HistorySearchResult {
	prompts: PromptHit[];
	messages: MessageHit[];
	promptTotal: number;
	messageTotal: number;
	indexing: boolean;
}

/** Scope of a prompt template — global (pi's global dir) or project-scoped. */
export type TemplateScope = "global" | "project";

/** A prompt template's metadata — what `template.list` returns. Deliberately body-free: both list
 * consumers (the composer's `/` menu, the Templates settings rows) render metadata only, and shipping
 * every file's full text would make a listing cost the whole corpus (the host reads only each file's
 * bounded frontmatter head to build these). The full text travels solely on the by-name `template.get`/
 * `template.save` path, as {@link Template}. */
export interface TemplateInfo {
	/** The template's unique name (within its scope). */
	name: string;
	/** Optional description of the template's purpose. */
	description?: string;
	/** Optional hint for argument placeholders or usage. */
	argumentHint?: string;
	/** Where the template lives — global or project-scoped. */
	scope: TemplateScope;
	/** Absolute path to the template file on disk. */
	filePath: string;
}

/** A full prompt template: metadata + the complete file text (frontmatter + body). */
export interface Template extends TemplateInfo {
	/** The full file text: frontmatter + body. */
	content: string;
}
