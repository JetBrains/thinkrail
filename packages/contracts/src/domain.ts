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
	 * `workspace.list`, non-removable and non-renamable (enforced server-side). `"external"` marks an
	 * explicitly attached, user-owned worktree: ThinkRail may forget its app state but must never rename
	 * its branch or reclaim its checkout. Absent = a ThinkRail-managed worktree. An explicit wire field —
	 * clients must never infer ownership from ids or paths.
	 */
	kind?: "default" | "external";
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
	 * **Creation provenance** for a managed worktree — the ref it was cut from (`git worktree add …
	 * <baseBranch>`). For user-owned Default/external workspaces, whose creation provenance is not ours to
	 * claim, this is the repository-default initial review target and the UI shows only `on <branch>`.
	 * It is *not* necessarily what the diff is measured against after re-pointing: see `diffBase`.
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

/** Minimal open code-review metadata for the active workspace branch. */
export interface OpenBranchReview {
	kind: "pull-request" | "merge-request";
	number: number;
}

/** One unattached checkout from `git worktree list`, shown in the existing-worktree chooser. */
export type ExistingWorktreeCandidate =
	| { path: string; branch: string; status: "available" }
	| { path: string; status: "detached" };

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
 * The `workspace.fsChanged` push frame from the host's worktree change notifier: either an observed
 * on-disk change (agent edit, terminal command, Finder) or a pathless synchronization nudge. An
 * **invalidation nudge, not data** — clients re-read via the existing read methods, so a duplicate or
 * replayed frame is harmless. `paths` are worktree-relative and deduped, capped host-side;
 * `truncated: true` means that generic path list is incomplete, so path consumers treat it as a wildcard.
 * `skillChange` is independent evidence accumulated before the cap: `detected` means a concrete project
 * skill path was observed, `unknown` means the platform supplied no classifiable path (including watcher
 * startup uncertainty), and `none` means no skill path was observed and no such uncertainty remains.
 *
 * An **empty, non-truncated, skill-neutral** frame (`paths: []`, `truncated: false`,
 * `skillChange: "none"`) is the pathless variant: re-read the workspace without claiming a file changed.
 * The host emits it when worktree git metadata moves (a `commit`/`reset`/`switch` in a terminal), which
 * invalidates git-derived reads (`git.status`, an `uncommitted`-scope diff) while leaving the working tree
 * untouched. Same contract: re-read, don't patch.
 */
export type WorkspaceSkillChange = "none" | "detected" | "unknown";

export interface WorkspaceFsChangedPayload {
	workspaceId: string;
	paths: string[];
	truncated: boolean;
	skillChange: WorkspaceSkillChange;
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
 * What an item's artifact points at — mirrors `pi-todos`' core vocabulary. `file`/`change`/`spec` are
 * addressed by a worktree-relative `path`; a `commit` carries the `sha` its work was recorded as (the host
 * commits per done item) and opens the Changes panel at the `commit:{sha}` scope.
 */
export type TodoArtifactKind = "file" | "change" | "spec" | "commit";

/** A link from a TODO item to what its work produced (files/specs by the agent; changes/commit by the host). */
export interface TodoArtifact {
	kind: TodoArtifactKind;
	/** Worktree-relative nav address — present for `file`/`change`/`spec`; a `commit` uses `sha` instead. */
	path?: string;
	/** Display text; the UI falls back to the path's basename when absent. */
	label?: string;
	/** For `spec` only: the durable spec-graph id. */
	specId?: string;
	/** For `commit` only: the sha the item's changes were committed as. */
	sha?: string;
	/**
	 * For `commit` only — **host-derived, never stored**: the commit's recorded changes (path + status +
	 * `+/−` line counts), resolved from git by `todo.list`'s decoration (memoized by sha — immutable, so
	 * the cache never staleness-checks). Absent when the sha no longer resolves (a GC'd history rewrite) —
	 * the client's signal to degrade the affordance silently.
	 */
	files?: GitFileChange[];
}

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
	/** Links to what the work produced — the host attaches `change`/`commit` on `done` (see the todos module). */
	artifacts?: TodoArtifact[];
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
 * - `pinned` — the worktree vs one IMMUTABLE commit (`baseRef`, a full oid). The review sidebar's
 *   navigation surface for a base-side comment: the anchor pinned the blob it quotes at creation, and
 *   this scope is what reopens exactly that original side later — a `branch`/`uncommitted` scope
 *   re-resolves against the current fork point/`HEAD`, which moves out from under the comment when the
 *   worktree commits or the review target is re-pointed.
 */
export type GitDiffScope =
	| { kind: "branch" }
	| { kind: "uncommitted" }
	| { kind: "commit"; sha: string }
	| { kind: "pinned"; baseRef: string };

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
export type ProviderAuthKind = "oauth" | "api-key" | "env" | "other";

/** One model provider's auth status, as the host reports it (read-only; no credential values). */
export interface ProviderStatus {
	/** pi's provider id, e.g. `anthropic`. */
	id: string;
	/** Human display name, e.g. `Anthropic`. */
	name: string;
	/** Whether the provider is usable (any auth form: stored, env var, models.json, or runtime). */
	configured: boolean;
	/** The auth source kind, when configured. Central configuration is reported only by `JbcentralStatus`. */
	kind?: ProviderAuthKind;
	/** Optional human hint for the source (e.g. the env var name, or `models.json`). */
	detail?: string;
	/** In-app OAuth login is available for this provider (`provider.loginStart`). */
	canOAuth?: boolean;
	/** Interactive API-key login is available (`provider.loginStart` with `type: "api_key"`) — pi's
	 * provider-owned truth (`Provider.auth.apiKey.login`), multi-prompt providers included. */
	canApiKey?: boolean;
	/** The provider has a removable `auth.json` credential (`provider.logout`) — false for env / models.json
	 * auth, which the host can't unset (so the strip shows no Sign-out for those). */
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

export type JbcentralAction = "connect" | "disconnect" | "start-proxy" | "update";

export type JbcentralProbeFailureReason =
	| "launch-failed"
	| "timed-out"
	| "output-too-large"
	| "nonzero-exit";

export type JbcentralActionFailureReason =
	| "not-installed"
	| "unsupported-version"
	| "version-probe-failed"
	| "central-action-failed"
	| "artifact-missing"
	| "artifact-present"
	| "candidate-failed";

/** Closed JetBrains AI lifecycle. No child output, paths, model data, or loader diagnostics are permitted. */
export type JbcentralStatus =
	| { state: "absent" }
	| { state: "outdated"; version: string }
	/**
	 * `signedOut` is a *positive* observation of Central holding no credentials — an unavailable or
	 * unreadable probe reports `false`, so the UI never demands a sign-in it cannot substantiate.
	 */
	| { state: "supported"; version: string; signedOut: boolean }
	| {
			state: "configured";
			version: string;
			signedOut: boolean;
			/** Positive observation only: unavailable/unrecognized proxy status reports `false`. */
			proxyStopped: boolean;
	  }
	| { state: "malformed-version" }
	| { state: "probe-failed"; reason: JbcentralProbeFailureReason }
	| { state: "configuring"; action?: JbcentralAction }
	| {
			state: "load-failed";
			/** Whether the latest observed global artifact state requested Central in the new generation. */
			configured: boolean;
			action?: JbcentralAction;
			reason: "candidate-failed";
	  };

/** The `provider.status` result: configured providers first, then the rest alphabetically. */
export interface ProviderStatusReport {
	providers: ProviderStatus[];
	jbcentral: JbcentralStatus;
	/** The host's per-OS install command for the JetBrains Central CLI — rendered by the card when absent or
	 * outdated (reflects the host's OS, not the browser's). */
	jbcentralInstall: JbcentralInstall;
}

export type JbcentralActionResult =
	| { outcome: "applied" }
	| { outcome: "failed"; reason: JbcentralActionFailureReason };

/** Kept as the connect method's named result type; all Central mutations share this closed union. */
export type JbcentralConnectResult = JbcentralActionResult;

export type JbcentralLoginResult =
	| { outcome: "launched" }
	| {
			outcome: "failed";
			reason: "not-installed" | "unsupported-version" | "version-probe-failed" | "launch-failed";
	  };

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

/** Stable singleton feature views that may live in either side region, never in the center. */
export type LayoutToolId = "projects" | "specs" | "files" | "changes" | "review";

/** A file-like resource placed in a center group. Content and editor state remain browser-local caches. */
export interface LayoutFileTab {
	kind: "file";
	id: string;
	name: string;
	path: string;
}

/** A diff identity includes its immutable scope; loaded content and view controls remain browser-local. */
export interface LayoutDiffTab {
	kind: "diff";
	id: string;
	name: string;
	path: string;
	scope: GitDiffScope;
}

/** One durable pi session placed as a workbench tab. */
export interface LayoutChatTab {
	kind: "chat";
	id: string;
	name: string;
	sessionId: string;
}

/**
 * A registered, rehydratable virtual document. Arbitrary inline content is deliberately absent: every
 * independently shipped client must be able to resolve a shared placement from `documentKind` + `sourceId`.
 */
export interface LayoutDocumentTab {
	kind: "document";
	id: string;
	name: string;
	documentKind: "todo-plan";
	sourceId: string;
	docPath: string;
}

/** A terminal placement references the terminal domain's durable `(workspaceId, tabKey)` identity. */
export interface LayoutTerminalTab {
	kind: "terminal";
	id: string;
	name: string;
	tabKey: string;
}

/** A singleton side tool. */
export interface LayoutToolTab {
	kind: "tool";
	/** Opaque stable placement key; `tool` is the singleton's semantic identity. */
	id: string;
	name: string;
	tool: LayoutToolId;
}

export type LayoutCenterTab =
	| LayoutFileTab
	| LayoutDiffTab
	| LayoutChatTab
	| LayoutDocumentTab
	| LayoutTerminalTab;
export type LayoutSideTab = LayoutToolTab | LayoutTerminalTab;
export type LayoutTab = LayoutCenterTab | LayoutSideTab;

/** A center leaf. Selection is device-local; only membership/order and a file/diff preview identity are shared. */
export interface LayoutCenterGroup {
	kind: "group";
	id: string;
	tabs: LayoutCenterTab[];
	previewTabId?: string;
}

/** Recursive binary center split. Weights are normalized positive values; children preserve visual order. */
export interface LayoutCenterSplit {
	kind: "split";
	id: string;
	direction: "horizontal" | "vertical";
	weights: [number, number];
	children: [LayoutCenterNode, LayoutCenterNode];
}

export type LayoutCenterNode = LayoutCenterGroup | LayoutCenterSplit;

/** One independently resizable/foldable side group. */
export interface LayoutSideGroup {
	id: string;
	weight: number;
	folded: boolean;
	tabs: LayoutSideTab[];
}

/** One outer side. `width` is a normalized workbench fraction, not a viewport-derived projection. */
export interface LayoutSideRegion {
	visible: boolean;
	width: number;
	groups: LayoutSideGroup[];
}

/** Where a closed singleton should return if its prior group still exists. */
export interface LayoutToolRestoreTarget {
	side: "left" | "right";
	groupId?: string;
	index: number;
}

/**
 * The complete shared structural layout for one workspace. `version` is intentionally in the document so
 * persisted values can migrate independently of the outer WS protocol version.
 */
export interface WorkspaceLayoutDocument {
	version: 1;
	center: LayoutCenterNode;
	left: LayoutSideRegion;
	right: LayoutSideRegion;
	toolRestoreTargets: Partial<Record<LayoutToolId, LayoutToolRestoreTarget>>;
}

export interface WorkspaceLayoutSnapshot {
	workspaceId: string;
	revision: number;
	document: WorkspaceLayoutDocument;
}

/** Client-authored full replacement. `mutationId` correlates optimism; it is not the concurrency token. */
export interface LayoutReplaceParams {
	workspaceId: string;
	mutationId: string;
	/** `null` creates only while absent; a number replaces only that exact current revision. */
	expectedRevision: number | null;
	document: WorkspaceLayoutDocument;
}

/** Accepted replacement broadcast and accepted-result payload. */
export interface LayoutChangedPayload {
	snapshot: WorkspaceLayoutSnapshot;
	mutationId: string;
}

/** Expected synchronization result for a full-document replacement. */
export type LayoutReplaceResult =
	| { status: "accepted"; payload: LayoutChangedPayload }
	| { status: "conflict"; current: WorkspaceLayoutSnapshot | null };

/** Resource-free center shape captured by a portable preset. */
export interface LayoutPresetCenterGroup {
	kind: "group";
	id: string;
}
export interface LayoutPresetCenterSplit {
	kind: "split";
	id: string;
	direction: "horizontal" | "vertical";
	weights: [number, number];
	children: [LayoutPresetCenterNode, LayoutPresetCenterNode];
}
export type LayoutPresetCenterNode = LayoutPresetCenterGroup | LayoutPresetCenterSplit;

export interface LayoutPresetSideGroup {
	id: string;
	weight: number;
	folded: boolean;
	tools: LayoutToolId[];
}
export interface LayoutPresetSideRegion {
	visible: boolean;
	width: number;
	groups: LayoutPresetSideGroup[];
}

export interface LayoutPreset {
	id: string;
	name: string;
	center: LayoutPresetCenterNode;
	left: LayoutPresetSideRegion;
	right: LayoutPresetSideRegion;
}

export interface LayoutSettings {
	defaultPresetId: string;
	customPresets: LayoutPreset[];
	maxSideGroups: number;
}

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
	/**
	 * How much of each terminal's recent output the host keeps to repaint a reattaching client, in KiB.
	 *
	 * A remount builds a fresh xterm buffer, so this is what stands between a surviving shell and a blank pane.
	 * Costs memory per live terminal and disk in `terminals.json`, so it is bounded and adjustable rather than
	 * generous by fiat. `0` disables replay entirely.
	 */
	terminalReplayKb: number;
	/** Host-synchronized workbench defaults and portable custom presets. */
	layout: LayoutSettings;
}

/** Bounds for `AppConfig.terminalReplayKb`, enforced host-side so a hand-edited config cannot exhaust memory. */
export const TERMINAL_REPLAY_KB = { min: 0, max: 1024, default: 64 } as const;

/** The config a fresh host (no `config.json` yet) falls back to. */
export const DEFAULT_CONFIG: AppConfig = {
	theme: "dark",
	analyticsEnabled: true,
	terminalReplayKb: TERMINAL_REPLAY_KB.default,
	layout: {
		defaultPresetId: "balanced",
		customPresets: [],
		maxSideGroups: 6,
	},
};

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

// ---- review mode (draft comments on files/diffs → AI sessions) ----

/** What a review comment is attached to: a line range, a diff-side range, a whole file, or the review. */
export type ReviewCommentKind = "inline" | "diff" | "file" | "review";

/** A comment's lifecycle. Orthogonal to {@link ReviewAnchorState} — "was it discussed" vs "is the
 * anchor alive" never overwrite each other. */
export type ReviewCommentStatus = "draft" | "sent" | "resolved" | "dismissed";

/** Whether a comment's anchor still holds against the current worktree: `anchored` (content unchanged),
 * `moved` (the fragment was found elsewhere and the line range silently re-pinned), or `outdated` (the
 * fragment is gone/ambiguous — the comment keeps its creation-time snapshot). Host-derived. */
export type ReviewAnchorState = "anchored" | "moved" | "outdated";

/**
 * One member of an anchor's ordered fallback chain (most precise first), modeled on the W3C Web
 * Annotation selectors so non-code media slot in later. V1 authors populate `lineRange` + `textQuote`;
 * `diffHunk` and `structural` are forward slots (kept in the union so persisted anchors never migrate).
 */
export type ReviewSelector =
	| { kind: "lineRange"; startLine: number; endLine: number }
	| { kind: "textQuote"; exact: string; prefix: string; suffix: string }
	| { kind: "diffHunk"; hunkHeader: string }
	| { kind: "structural"; scheme: string; ref: string };

/** Where a comment is pinned. `side` matters for diff comments (`base` anchors are never re-anchored —
 * the blob they name is immutable). `contentHash` is the host-computed sha-256 of the
 * file at comment time (the cheap "nothing changed" check). A `file`-level comment carries only `path`. */
export interface ReviewAnchor {
	/** Worktree-relative path. */
	path: string;
	side: "base" | "worktree";
	/**
	 * `base` anchors only: the ref whose blob the line range + fragment were captured against — the
	 * diff's ORIGINAL side, resolved host-side from the tab's scope (a merge-base, `HEAD`, or a commit).
	 * A base anchor means "this pre-change content", so it is read back from here, never from the
	 * worktree (whose lines say something else entirely).
	 */
	baseRef?: string;
	/**
	 * `base` anchors only: the diff scope the remark was made in — the tab identity that reopens the very
	 * diff whose ORIGINAL side it quotes. Stored because that surface is the *only* one rendering the
	 * pre-change blob: navigating a base comment to the plain file tab lands on worktree lines that say
	 * something else, with no card to focus. Absent on comments made before this was persisted, and on
	 * every worktree anchor (a file tab renders those).
	 */
	scope?: GitDiffScope;
	contentHash?: string;
	selectors: ReviewSelector[];
}

/** A draft/sent review comment. `sessionId` links the chat the comment was sent into — its file's
 * review chat (see `Review.fileSessions`). */
export interface ReviewComment {
	id: string;
	reviewId: string;
	kind: ReviewCommentKind;
	/** `null` for `kind: "review"` (the whole change set). */
	anchor: ReviewAnchor | null;
	/** The comment text (markdown). */
	body: string;
	status: ReviewCommentStatus;
	anchorState: ReviewAnchorState;
	sessionId?: string;
	resolvedBy?: "agent" | "user";
	/** The agent's note passed to `resolve_comment` (what it did about the remark). */
	resolveNote?: string;
	createdAt: number;
	sentAt?: number;
	resolvedAt?: number;
}

/** A workspace's review — at most one `open` per workspace (created lazily, archived by `review.close`).
 * `fileSessions` maps a review key to its chat: comments sharing a key share ONE chat for the review's
 * life — the first send creates it, every later send (single or batch) follows up into it. The key is
 * the comment's file path, or the **empty string** for anchorless (whole-change-set) remarks, which are
 * pinned like a file so a second overall remark continues the same discussion. */
export interface Review {
	id: string;
	workspaceId: string;
	status: "open" | "closed";
	/**
	 * The **original side of the reviewed diff**, resolved to a full commit oid at creation — the immutable
	 * diff identity comments were made against: the **fork point** (`merge-base` of the diff target and
	 * `HEAD`), which is what the branch-scope diff displays — not the target's tip, whose later upstream
	 * commits the review never showed. Immutable on purpose: the target is re-pointable mid-review and
	 * its branch can move, but what the review *is* must not. Degrades to the raw ref string when it
	 * wouldn't resolve.
	 */
	baseSha: string;
	fileSessions?: Record<string, string>;
	/** Session keys (path, or "" for the whole-change-set bucket) whose review the user marked
	 * finished — a fully-resolved file stays listed until this says "we're done here"; a new comment
	 * on the file clears it. */
	doneFiles?: string[];
	createdAt: number;
	closedAt?: number;
}

/** The `review.get` read: the open review + all its comments. */
export interface ReviewSnapshot {
	review: Review;
	comments: ReviewComment[];
}

/** The `review.changed` push — the full snapshot (idempotent under last-value replay), plus the
 * workspace it belongs to so clients can key their fold. */
export interface ReviewChangedPayload extends ReviewSnapshot {
	workspaceId: string;
}
