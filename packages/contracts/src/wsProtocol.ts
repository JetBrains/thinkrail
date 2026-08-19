// The browser↔host API — ours, not pi's. Methods are request/response; channels are server→client push.

import type {
	AppConfig,
	BranchList,
	DiffStats,
	EditorInfo,
	ExistingWorktreeCandidate,
	FileNode,
	GitCommit,
	GitDiffScope,
	GithubAuthStatus,
	GitStatus,
	HistoryScope,
	HistorySearchResult,
	JbcentralActionResult,
	JbcentralConnectResult,
	JbcentralLoginResult,
	LayoutReplaceParams,
	LayoutReplaceResult,
	LoginReply,
	OpenBranchReview,
	Project,
	ProjectPathStatus,
	ProviderStatusReport,
	ReviewAnchor,
	ReviewComment,
	ReviewCommentKind,
	ReviewCommentStatus,
	ReviewSnapshot,
	SpecGraphSnapshot,
	Template,
	TemplateInfo,
	TemplateScope,
	TodoItem,
	TodoPlan,
	TodoStatus,
	Workspace,
	WorkspaceLayoutSnapshot,
} from "./domain";
import type {
	AskUserAnswersDetails,
	AskUserQuestionResult,
	ExtUiResponse,
	ImageContent,
	RefreshedModels,
	SessionStats,
	SessionSummary,
	SkillCatalogEntry,
	SlashCommandInfo,
	ThinkingLevel,
	TranscriptMessage,
	WireCustomMessage,
	WireModel,
} from "./piProtocol";

/**
 * A batch of one terminal's output. Addressed to the PTY's owning client, never broadcast.
 *
 * `truncated` says the host had to drop the *oldest* held output to stay bounded — a shell can emit faster than
 * it can be shipped and `bun-pty` offers no way to slow it down — so the client can mark the gap instead of
 * appearing to have simply printed less.
 */
export interface TerminalDataPush {
	id: string;
	data: string;
	truncated?: boolean;
}

/** The shell behind a terminal exited; its tab is now dead and must say so instead of looking alive. */
export interface TerminalExitPush {
	id: string;
	exitCode: number;
}

/**
 * Another client took this tab over, so we are no longer the one receiving its output.
 *
 * Addressed by `tabKey` rather than PTY id because the displaced client may never have learned the id — and
 * `tabKey` is what its tab is keyed on regardless.
 */
export interface TerminalDetachedPush {
	workspaceId: string;
	tabKey: string;
}

/**
 * One terminal tab, as the host reports it. The tab list is host state — the rail renders this rather than
 * keeping a list of its own, so the two can never disagree about which shells exist.
 *
 * Deliberately carries no "is something running" flag. That question is only ever asked to decide whether
 * closing needs confirmation, and any answer cached from list time is exactly wrong by then: start a dev server
 * after the rail loaded and a stale `busy: false` would wave the close through silently. `terminal.close`
 * answers it atomically instead.
 */
export interface TerminalTabInfo {
	tabKey: string;
	title: string;
}

/**
 * The host's tab list for one workspace — an idempotent snapshot, never a delta, so folding it twice is
 * harmless and a late subscriber can be caught up with the newest one.
 */
export interface TerminalTabsPush {
	workspaceId: string;
	tabs: TerminalTabInfo[];
}

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
// v9: `git.diff` (unified patch text) is replaced by `git.diffFile` — both sides of one file's change
// (base-branch content + worktree content), feeding the center Monaco diff tab.
// v10: `provider.setApiKey` is removed — API-key setup goes through the interactive login channel
// (`provider.loginStart` gains `type?: "oauth" | "api_key"`), so multi-prompt providers (azure, vertex)
// work and `ProviderStatus.canApiKey` is pi's provider-owned truth (`Provider.auth.apiKey.login`).
// v11: `skill.list` previews a project's skill-only command catalog before a workspace/session exists.
// v12: `project.setTrust` records the per-project trust grant that gates its committed cross-agent skill
// aliases; `Project` gains an optional `trusted` field carried in `server.welcome` / `project.list`.
// v13: the workspace Skills manager — `skills.state` (catalog + per-skill decision), `session.reloadResources`
// (apply skill changes to a running session), `project.acknowledgeSkills` / `project.setSkillEnabled` /
// `workspace.setSkillOverride`; `Project` gains `acknowledgedSkills`/`disabledSkills`, `Workspace` gains
// `skillOverrides`.
// v14: group/source toggles + pre-session manager — `project.setGroupEnabled` (turn a plugin or source tier,
// incl. `@plugins`, on/off at the project baseline) + `project.skills` (project-scoped catalog for Welcome /
// New Workspace); `Project` gains `disabledGroups`, `SkillCatalogEntry` gains `group`.
// v15: chat-history search — `history.search` reads a lazy in-memory index over pi's session files
// (prompt recall + full-conversation matches, scoped chat/workspace/project/all, recency-ordered). The
// messages section is assistant-only (a user-role hit only ever duplicates its own prompt's text);
// `PromptHit` carries optional `messageIndex`/`anchorText` so the prompt row itself is jumpable — the
// location a dropped user-role message hit used to carry.
// v16: prompt-template CRUD — template.* reads/writes pi's prompt dirs (global + project), so
// templates stay pi-CLI-portable. `template.list` is metadata-only (`TemplateInfo`, no `content` — the
// host reads just each file's bounded frontmatter head); the full text travels solely on the by-name
// `template.get`/`template.save` path (`Template`), both size-capped host-side.
// v17: `WireModel` gains `thinkingLevels` (pi's per-model supported effort levels, host-computed via
// pi-ai `getSupportedThinkingLevels`) so the effort picker offers only what the active model can do;
// `model.clampThinking` exposes pi's own `clampThinkingLevel` for a `{model, level}` pair, so the
// pre-session picker adjusts effort the same way `model.default` and live sessions already do.
// v18: the built-in Default workspace — `Workspace.kind: "default"` marks the project folder itself as
// a per-project, non-removable, non-renamable workspace, ensured lazily and pinned first in
// `workspace.list`; `workspace.remove` rejects it.
// v19: `model.refresh` awaits the host's single-flighted catalog refresh and returns the
// post-refresh list (the picker's freshness affordance) as `RefreshedModels` — `{ models, complete }`,
// where `complete` says whether the pass actually settled inside the host's budget (only then is the
// list authoritative) — with `force` bypassing pi's 4h provider freshness throttle.
// v20: `TodoGroupItem.status` — a group's derived task lifecycle (`pending|active|done`), computed by the
// host from the steps and **required** on the DTO; clients render it instead of deriving it, so an older
// host would leave a newer UI bucketing every group as `pending`.
// v21: the Changes panel's **diff scope** — `git.status` / `git.diffFile` take an optional `GitDiffScope`
// (branch / uncommitted / one commit; omitted = `branch`, so an older client is unchanged), `git.listCommits`
// lists the branch's commits for the scope menu, and `workspace.setDiffBase` re-points the diff target
// (`Workspace.diffBase`, resolved server-side as `diffBase ?? baseBranch` — `baseBranch` is now creation
// provenance only).
// v22: a failed response may name its failure — `WsResponse.errorCode` (`WsErrorCode`, today only
// `UNKNOWN_COMMIT`), so a client can react to one specific failure instead of pattern-matching the message.
// Additive and optional: an older client simply sees the `error` string it always saw.
// v23: the workspace row's "Open in" menu — `editor.list` probes the host's PATH for installed
// editors/IDEs (`EditorInfo[]`, never a fixed client list), `workspace.openIn` launches one detached at a
// workspace's `worktreePath`, `workspace.reveal` opens the host's file manager there.
// v24: lossless project close/reopen — Project.closed marks rail membership, server.welcome carries open
// + recent project views, and project.updated streams full snapshots so every client converges.
// v25: existing-worktree adoption — `Workspace.kind: "external"` marks user-owned checkouts;
// `workspace.listExisting` discovers candidates and `workspace.openExisting` registers one in place.
// v26: terminals belong to ONE client, keyed by the `?client=` page identity on the socket URL (stable across
// that client's reconnects, new on reload). Output is addressed to the owner instead of broadcast to a topic
// every socket subscribed to, and carries an optional `truncated` flag when the host had to drop held output;
// `terminal.exit` announces a dead shell; `terminal.alive` lets a tab re-attaching to a shell it detached
// earlier confirm it is still there. `terminal.create` additionally takes the client's measured `cols`/`rows`.
// v27: unresolved requests survive reconnect: the client replays the same request id and the host deduplicates
// by `(clientKey, requestId)`. The client acknowledges each response it processes (`WsAck`), which is what lets
// the host free the retained copy — an *un*acknowledged one may have died with its socket and stays replayable.
// The version prevents a replaying UI from connecting to a pre-dedup host and executing a mutation twice after
// a lost response.
// v28: a terminal is identified by `(workspaceId, tabKey)` — a pair the client can always re-derive — and the
// HOST owns the tab list. `terminal.attach` is idempotent get-or-create and replaces `terminal.create` +
// `terminal.alive` (both gone): one call answers "give me this tab's shell", so there is no window in which a
// client holds the only pointer to a running shell. Shells are owner-scoped rather than per-page, so they now
// survive a reload, a closed browser and a different browser; attach is exclusive, and taking one over tells
// the previous client via `terminal.detached`. Attach also returns the recorded output to repaint (`replay`),
// which is what a revived tab shows after a host restart.
// v29: review mode — `review.*` (draft comments anchored to files/diffs; add/edit + DRAFT-only delete;
// manual resolve, final) with the `review.changed` full-snapshot push. A diff's ORIGINAL side carries
// its own comments (`review.commentAdd` takes the tab's `scope`, resolved and pinned onto the anchor as
// `baseRef`). Sends land, in order of preference, in the client's last OPEN chat (the optional
// `sessionId`), the key's pinned chat (`Review.fileSessions`, key = path or "" for anchorless remarks),
// or a new one; both sends answer `ReviewSendResult` (`reused` → hydrate, don't open as new), and
// `review.sendBatch` returns every session it touched. `review.fileDone` + `Review.doneFiles` keep a
// fully-resolved file listed until the user finishes it.
// v30: `GitDiffScope.kind: "pinned"` — worktree vs one immutable commit (`baseRef`). The review
// sidebar reopens a base-side comment through it, so navigation shows the very blob the anchor pinned
// at creation instead of re-resolving a mutable branch/uncommitted scope whose original side has moved.
// v31: `workspace.watchReady` orders a fresh watcher's conservative startup wildcard before web clients
// capture a session skill-load baseline; `startupNudge` lets a replayed response restore a push lost with
// its socket before that baseline is captured.
// v32: `agent_settled` is the automatic-run terminal and carries final assistant metadata;
// `SessionSummary.lastSettlement` closes live reconnect gaps after Pi rebuilds context.
// v33: `WorkspaceFsChangedPayload.skillChange` separates detected/unknown skill evidence from generic path
// truncation, so a large non-skill build cannot masquerade as a skill edit while over-cap skill paths remain
// detectable.
// v34: `session.delete` — remove a chat for good (dispose if live, then move its transcript to the OS
// trash), triggered from the history / closed-chats list.
// v35: `session.deleted` broadcasts permanent deletion so every client converges and stale hydration can
// no longer restore the removed chat.
// v36: `review.close` atomically archives non-draft records and publishes the fresh open snapshot; clients
// no longer follow it with an initiating-only `review.get` fold.
// v37: `workspace.openReview` returns the active branch's optional GitHub PR / GitLab MR number.
// v38: `session.getMessages` keeps pi's `compactionSummary` messages, so a hydrated transcript can say
// where compaction replaced earlier messages instead of starting mid-conversation.
// v39: the TODO review map — `TodoItem.artifacts` (mirrored `TodoArtifact`, incl. the host-owned `commit`
// kind) rides `todo.list`, whose decoration also derives a commit artifact's `files` from git (absent =
// unresolvable sha, degrade silently).
// v40: host-synchronized workspace workbench layouts — versioned full-document `layout.get` /
// exact-base `layout.replace`, monotonic revisions, typed accepted/conflict results, `layout.changed`
// broadcasts, and layout preset settings. Conflicts carry current state and never persist the stale document.
// v41: JetBrains Central adds typed lifecycle/action states plus connect, disconnect, update, and login
// methods.
// v42: Central changes are applied through watched runtime generations; restart/recovery/blocked outcomes are
// removed, `provider.changed` invalidates provider/model reads, and live chats retain their own generation.
// v43: configured Central status reports the closed proxy-stopped observation and exposes Start proxy.
// v44: `workspace.list.includeDiffStats` can skip only the synchronous per-workspace diff-stat fan-out while
// preserving complete authoritative membership/order for cold client-local navigation restoration.
export const PROTOCOL_VERSION = 44;

/**
 * The `server.welcome` push payload (the first message on every WS connect). `protocolVersion` lets a
 * stale UI detect host drift; `appVersion` is the host launcher's baked release version (a released
 * binary stamps it — `undefined` when run from source); `projects` seeds the open rail and
 * `recentProjects` seeds Add project → Recents.
 */
export interface ServerWelcome {
	protocolVersion: number;
	appVersion?: string;
	/** Open projects only, ordered by last open. */
	projects: Project[];
	/** Every known project (open + closed), ordered by last open. */
	recentProjects: Project[];
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

/** A permanent chat deletion, broadcast so every client's projection drops the session. */
export interface SessionDeletedPayload {
	workspaceId: string;
	sessionId: string;
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
	// Record the user's trust grant for a project — gates loading its committed cross-agent skill aliases.
	projectSetTrust: "project.setTrust",
	// Confirm project-scoped skills that appeared after trust (re-confirm-new) + set the project-baseline
	// enable/disable for any skill.
	projectAcknowledgeSkills: "project.acknowledgeSkills",
	projectSetSkillEnabled: "project.setSkillEnabled",
	// Names of the project's committed alias skills present in its current checkout — powers the presence-
	// gated trust notice (shown as a count, never attacker-controlled text) before any workspace exists.
	projectAliasSkills: "project.aliasSkills",
	// Turn a whole group (a plugin, a source tier, or `@plugins`) on/off at the project baseline; the
	// project-scoped skill catalog for the pre-session manager (Welcome / New Workspace).
	projectSetGroupEnabled: "project.setGroupEnabled",
	projectSkills: "project.skills",
	workspaceCreate: "workspace.create",
	workspaceListExisting: "workspace.listExisting",
	workspaceOpenExisting: "workspace.openExisting",
	workspaceList: "workspace.list",
	workspaceOpenReview: "workspace.openReview",
	workspaceRemove: "workspace.remove",
	workspaceDiffStats: "workspace.diffStats",
	// Per-workspace per-skill enable/disable override (over the project baseline).
	workspaceSetSkillOverride: "workspace.setSkillOverride",
	// Re-point the ref the workspace's diff is measured against (`null` clears back to the creation base).
	workspaceSetDiffBase: "workspace.setDiffBase",
	// Await the fresh watcher's startup wildcard before capturing a session skill-load baseline.
	workspaceWatchReady: "workspace.watchReady",
	// The workspace row's "Open in" menu: launch a detected editor detached at the worktree, or reveal the
	// worktree in the host's file manager.
	workspaceOpenIn: "workspace.openIn",
	workspaceReveal: "workspace.reveal",
	// Host-installed editors/IDEs the "Open in" menu can offer (probed once per connection, not per-workspace).
	editorList: "editor.list",
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
	gitDiffFile: "git.diffFile",
	// The workspace branch's own commits (`<diff base>..HEAD`, newest first) — the scope menu's commit list,
	// fetched lazily when that menu first opens.
	gitListCommits: "git.listCommits",
	terminalAttach: "terminal.attach",
	terminalList: "terminal.list",
	terminalWrite: "terminal.write",
	terminalResize: "terminal.resize",
	terminalClose: "terminal.close",
	dialogSelectDirectory: "dialog.selectDirectory",
	// Skill-only command preview for New Workspace, before a worktree/session exists.
	skillList: "skill.list",
	// The workspace Skills manager: full catalog + per-skill admission decision for a workspace's worktree.
	skillsState: "skills.state",
	// session.* — the pi engine; the Composer + cheap wins (model/thinking/stats/skills).
	sessionCreate: "session.create",
	sessionPrompt: "session.prompt",
	sessionSteer: "session.steer",
	sessionFollowUp: "session.followUp",
	sessionAbort: "session.abort",
	sessionDispose: "session.dispose",
	// Delete a chat for good: dispose it if live, then move its transcript to the OS trash (recoverable).
	sessionDelete: "session.delete",
	sessionSetModel: "session.setModel",
	sessionSetThinkingLevel: "session.setThinkingLevel",
	sessionCompact: "session.compact",
	sessionGetStats: "session.getStats",
	sessionGetCommands: "session.getCommands",
	// Re-scan skills/settings and rebuild the system prompt for a running session (active-chat reload).
	sessionReloadResources: "session.reloadResources",
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
	// Awaited catalog refresh (the picker's freshness affordance): resolves when the pi.dev catalog pass
	// lands, returning the post-refresh list. `force` bypasses pi's 4h provider freshness throttle — set
	// it for a user-initiated refresh, leave it off for an implicit one (picker open).
	modelRefresh: "model.refresh",
	modelDefault: "model.default",
	// pi's own clamp for a `{model, desired-level}` pair. The pre-session picker has no session to ask,
	// and re-deriving pi's clamp client-side would give that one path a policy of its own.
	modelClampThinking: "model.clampThinking",
	// Auth-provider status (the Welcome strip): per-provider configured + auth kind, Central lifecycle.
	// Every read revalidates host-side (auth + registry reload), so a Refresh is just a re-request.
	providerStatus: "provider.status",
	// In-app provider auth (the Welcome strip's Sign-in). loginStart kicks off pi's login flow (OAuth or
	// interactive API-key entry, per `type`) DETACHED and returns a handle immediately (a flow can take
	// minutes — it must not sit on the request); frames stream on the `provider.login` channel, and
	// loginReply answers a select/prompt frame. logout mutates auth.json directly. All revalidate the
	// shared registry, so a following provider.status re-read reflects them.
	providerLoginStart: "provider.loginStart",
	providerLoginReply: "provider.loginReply",
	providerLoginCancel: "provider.loginCancel",
	providerLogout: "provider.logout",
	// Native JetBrains AI setup through Central's reviewed PI commands; the browser receives closed states only.
	providerJbcentralConnect: "provider.jbcentralConnect",
	providerJbcentralDisconnect: "provider.jbcentralDisconnect",
	providerJbcentralStartProxy: "provider.jbcentralStartProxy",
	providerJbcentralLogin: "provider.jbcentralLogin",
	providerJbcentralUpdate: "provider.jbcentralUpdate",
	// One canonical structural workbench document per workspace.
	layoutGet: "layout.get",
	layoutReplace: "layout.replace",
	// Persist a partial change to the server-synced app settings (e.g. the theme). The host merges, saves
	// `config.json`, and broadcasts `settings.changed` — the caller converges on that push, not optimism.
	settingsUpdate: "settings.update",
	historySearch: "history.search",
	// Review mode: the open review + comment authoring (add / edit / resolve — comments are records,
	// never deleted), sends (single or batch → the chat pinned for each comment's key, see
	// `Review.fileSessions`), close.
	reviewGet: "review.get",
	reviewCommentAdd: "review.commentAdd",
	reviewCommentUpdate: "review.commentUpdate",
	reviewCommentDelete: "review.commentDelete",
	reviewFileDone: "review.fileDone",
	reviewSendComment: "review.sendComment",
	reviewSendBatch: "review.sendBatch",
	reviewClose: "review.close",
	// Prompt-template CRUD: list/read/write/delete pi's global + project-scoped templates.
	templateList: "template.list",
	templateGet: "template.get",
	templateSave: "template.save",
	templateDelete: "template.delete",
} as const;

/** Server→client push channels. */
export const WS_CHANNELS = {
	serverWelcome: "server.welcome",
	// Full persisted snapshot after open/reopen/close. One idempotent channel avoids opened/closed event
	// streams replaying out of order; `Project.closed` says which projection the record belongs to.
	projectUpdated: "project.updated",
	piEvent: "pi.event",
	piExtensionUi: "pi.extensionUi",
	// Permanent chat deletion is shared domain state. This event carries the owning workspace + session id;
	// clients retain a tombstone so an older session.list/getMessages response cannot resurrect the chat.
	sessionDeleted: "session.deleted",
	// In-app login flow updates (a `LoginPush` per frame), keyed by loginId. Session-less — a login runs on
	// the Welcome screen before any session exists, so this is the sibling of pi.extensionUi, not scoped to one.
	providerLogin: "provider.login",
	// Data-free Central/provider invalidation. Clients re-read provider.status and model.list; this event is
	// deliberately non-replayable because reconnect reads repair any missed transition.
	providerChanged: "provider.changed",
	// Every terminal channel is addressed to the ONE client currently attached to that PTY, never broadcast: a
	// shell's bytes are tokens, keys and private paths, and a second browser filtering them out client-side is
	// not isolation. Which client that is can change (attach is exclusive with takeover) — what never happens
	// is a frame going to a socket that did not attach.
	terminalData: "terminal.data",
	/** `{ id, exitCode }` — the shell behind a terminal exited, so its tab is now dead and must say so. */
	terminalExit: "terminal.exit",
	/**
	 * `{ workspaceId, tabKey }` — another client attached to this tab, so this one is no longer the recipient.
	 * A PTY has one size, so only one client can have its layout honoured; rather than silently reflowing
	 * whoever else is looking (tmux's smallest-client rule, its most complained-about behaviour), the displaced
	 * client is told and offers to take the tab back.
	 */
	terminalDetached: "terminal.detached",
	/**
	 * `{ workspaceId, tabs }` — the host's tab list for a workspace changed (a tab was opened or closed).
	 *
	 * BROADCAST, unlike the three channels above: which terminals exist is shared domain state (architecture
	 * #9), the same as the workspace lifecycle trio, so every client converges. Only the *contents* of a shell
	 * are addressed to one client. Without this, a tab closed in one browser leaves another with a dead
	 * instance mounted and accepting input.
	 */
	terminalTabs: "terminal.tabs",
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
	// One accepted, persisted full workbench snapshot; all clients fold by monotonic revision.
	layoutChanged: "layout.changed",
	// A workspace's review state changed (a `ReviewChangedPayload` — the full snapshot). Emitted on every
	// mutation: UI edits, agent `resolve_comment` calls, re-anchoring. All clients converge on it — the
	// initiator too, never optimistically (the workspace-trio pattern).
	reviewChanged: "review.changed",
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

/**
 * What a review send returns: the chat its package went into, shaped like `session.create` plus the one
 * fact only the host knows — whether that chat was **reused** (a file's earlier review chat, followed up
 * into) or created by this very call.
 *
 * The client cannot infer it: a reused chat may be one it has never seen (a second client, or this one
 * after a reload — review state and pi transcripts both outlive the host). Opening such a session as if
 * it were new gives it an empty runtime, so the user lands in a blank conversation whose comments are
 * already marked sent. On `reused`, `model`/`thinkingLevel` are placeholders (the session already runs
 * its own) and the client must take the hydration path instead.
 */
export interface ReviewSendResult {
	sessionId: string;
	model: WireModel | null;
	thinkingLevel: ThinkingLevel;
	reused: boolean;
}

/** Result of the session-skill startup barrier. */
export interface WorkspaceWatchReadyResult {
	/** True unless the watcher was already known ready; fold the replay-safe conservative fallback. */
	startupNudge: boolean;
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
	// Persist the user's trust decision for a project. Trust gates loading the repo's committed cross-agent
	// skill aliases (`.claude/skills` etc.); the updated `Project` echoes back so the client refreshes.
	"project.setTrust": { params: { id: string; trusted: boolean }; result: Project };
	// Confirm project-scoped skills that appeared after trust (`names` join `acknowledgedSkills`), and set a
	// skill's project-baseline enabled state. Both echo the updated `Project` back for the store.
	"project.acknowledgeSkills": { params: { id: string; names: string[] }; result: Project };
	"project.setSkillEnabled": {
		params: { id: string; name: string; enabled: boolean };
		result: Project;
	};
	// Present committed alias skill names in the project's current checkout (for the presence-gated notice).
	"project.aliasSkills": { params: { projectId: string }; result: string[] };
	// Turn a group on/off at the project baseline (`group` = a plugin name, a source tier, or `@plugins`).
	"project.setGroupEnabled": {
		params: { id: string; group: string; enabled: boolean };
		result: Project;
	};
	// Project-scoped skill catalog (current checkout, no workspace overrides) for the pre-session manager.
	"project.skills": { params: { projectId: string }; result: SkillCatalogEntry[] };
	// `baseRef`: the base branch the worktree is cut from (a remote ref is fetched first); when
	// omitted, the worktree branches off the repo's current HEAD (the default behavior).
	"workspace.create": {
		params: { projectId: string; name?: string; baseRef?: string };
		result: Workspace;
	};
	"workspace.listExisting": {
		params: { projectId: string };
		result: ExistingWorktreeCandidate[];
	};
	"workspace.openExisting": {
		params: { projectId: string; path: string };
		result: Workspace;
	};
	"workspace.list": {
		params: { projectId: string; includeDiffStats?: boolean };
		result: Workspace[];
	};
	"workspace.openReview": {
		params: { workspaceId: string };
		result: OpenBranchReview | null;
	};
	"workspace.remove": { params: { id: string }; result: Ack };
	"workspace.diffStats": { params: { id: string }; result: DiffStats };
	// Per-workspace per-skill override over the project baseline; `null` clears it. Echoes the `Workspace`.
	"workspace.setSkillOverride": {
		params: { id: string; name: string; override: "on" | "off" | null };
		result: Workspace;
	};
	// Re-point the diff target (`Workspace.diffBase`); `null` clears back to the creation base. Echoes the
	// updated `Workspace` **and** broadcasts `workspace.updated`, so every client converges on the push.
	"workspace.setDiffBase": { params: { id: string; ref: string | null }; result: Workspace };
	// Wait for a fresh watcher's startup wildcard before a client captures its session skill-load baseline.
	"workspace.watchReady": {
		params: { workspaceId: string };
		result: WorkspaceWatchReadyResult;
	};
	// Launch an `EditorInfo.id` from `editor.list`, detached, at the workspace's `worktreePath`. GUI editors
	// only — a `"terminal"`-kind entry (Vim) has no window of its own; the client runs it in that workspace's
	// embedded terminal instead of calling this.
	"workspace.openIn": { params: { id: string; editor: string }; result: Ack };
	// Open the host's file manager at the workspace's `worktreePath` (Finder / Explorer / the Linux desktop's
	// default file manager).
	"workspace.reveal": { params: { id: string }; result: Ack };
	// Editors/IDEs the host actually has installed — probed via PATH lookups, so the list never offers an
	// app that would fail to launch. Host-wide, not workspace-scoped: safe to fetch once and cache.
	"editor.list": { params: Record<string, never>; result: EditorInfo[] };
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
	// `scope` (default `{ kind: "branch" }`) selects **what** is diffed; see `GitDiffScope`. An unresolvable
	// scope (a commit that a rebase/reset removed) is REJECTED — the panel treats that as "reset the scope"
	// rather than staying wedged on a dead sha.
	"git.status": { params: { workspaceId: string; scope?: GitDiffScope }; result: GitStatus };
	// One changed file, both sides of the `scope`'s range: `original` = the file at the range's start (empty
	// for untracked/added — and for a renamed file's new path, which degrades to an add-style diff),
	// `modified` = the file at its end (the worktree for branch/uncommitted, the commit's tree for `commit`;
	// empty when deleted). Feeds Monaco's diff editor, which needs two contents rather than a unified patch.
	"git.diffFile": {
		params: { workspaceId: string; path: string; scope?: GitDiffScope };
		result: { original: string; modified: string };
	};
	// Commits on the workspace's branch that its diff base doesn't have (`git log <base>..HEAD`), newest
	// first and capped host-side — the scope menu's commit rows.
	"git.listCommits": { params: { workspaceId: string }; result: { commits: GitCommit[] } };
	/**
	 * Give me this tab's shell — idempotent get-or-create, and the only way a PTY is ever born.
	 *
	 * Calling it twice for the same `(workspaceId, tabKey)` returns the same shell, so a client never has to
	 * remember an id, ask whether one is still alive, or decide whether to make another. That is the whole
	 * point: the previous protocol made the client hold the only pointer to a running shell between a "does
	 * this still exist?" question and its answer, and losing it there orphaned the shell for the life of the
	 * host. `created` distinguishes a fresh shell from an adopted one — a one-shot `initialCommand` may only
	 * run on the former.
	 *
	 * `cols`/`rows` are the client's already-measured grid; a PTY spawned at a default 80×24 renders its first
	 * prompt at the wrong size and then reflows, which can visibly garble it. `replay` is the shell's recorded
	 * recent output, to repaint before live frames resume — a remount is a fresh xterm buffer, so without it a
	 * surviving shell comes back behind a blank screen. After a host restart it is what a revived tab shows.
	 */
	"terminal.attach": {
		params: { workspaceId: string; tabKey: string; title?: string; cols?: number; rows?: number };
		result: { id: string; created: boolean; replay?: string };
	};
	/** This workspace's tab list, host-owned: the rail renders it rather than remembering one of its own. */
	"terminal.list": {
		params: { workspaceId: string };
		result: { tabs: TerminalTabInfo[] };
	};
	"terminal.write": { params: { id: string; data: string }; result: Ack };
	"terminal.resize": { params: { id: string; cols: number; rows: number }; result: Ack };
	/**
	 * Close a tab and kill its shell — the one client-driven kill, and an explicit user gesture by definition.
	 * Keyed by `tabKey`, not by PTY id: the tab is what the user closed, and the shell behind it may since have
	 * been replaced. Unmounting a view never routes here.
	 *
	 * Refuses and reports `busy` when the shell has child processes, unless `force` says the user confirmed.
	 * The check and the kill happen in the same synchronous handler, so nothing can start between them — which
	 * is why this is one call rather than a "is it busy?" question the client answers separately and stalely.
	 * `closed: false, busy: false` means there was no such tab.
	 */
	"terminal.close": {
		params: { workspaceId: string; tabKey: string; force?: boolean };
		result: { closed: boolean; busy: boolean };
	};
	"dialog.selectDirectory": { params: Record<string, never>; result: { path: string | null } };
	// Preview from the selected project's current checkout; the eventual worktree session is authoritative.
	"skill.list": { params: { projectId: string }; result: SlashCommandInfo[] };
	// The workspace Skills manager's catalog: every discovered skill for the worktree + its admission verdict.
	"skills.state": { params: { workspaceId: string }; result: SkillCatalogEntry[] };
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
	"session.delete": { params: { workspaceId: string; sessionId: string }; result: Ack };
	"session.setModel": { params: { sessionId: string; model: WireModel }; result: Ack };
	"session.setThinkingLevel": { params: { sessionId: string; level: ThinkingLevel }; result: Ack };
	"session.compact": { params: { sessionId: string; instructions?: string }; result: Ack };
	"session.getStats": { params: { sessionId: string }; result: SessionStats };
	"session.getCommands": { params: { sessionId: string }; result: SlashCommandInfo[] };
	// Re-scan skills/settings + rebuild the system prompt for one running session (skipped while streaming).
	"session.reloadResources": { params: { sessionId: string }; result: Ack };
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
	// pi's `clampThinkingLevel` for a model the client is about to select, by `{provider,id}` ref. The
	// host owns this so every path agrees: `model.default` clamps the same way, and a live session gets
	// it from pi directly via `thinking_level_changed`. Throws if the ref isn't an available model.
	"model.clampThinking": {
		params: { provider: string; id: string; level: ThinkingLevel };
		result: { level: ThinkingLevel };
	};
	// `model.list` serves the current snapshot (its refresh is detached); this AWAITS the single-flighted
	// refresh and serves the post-refresh snapshot — refresh failures still resolve with the current list.
	// `force` bypasses pi's 4h provider freshness throttle, so a user-initiated refresh actually fetches;
	// without it the pass is a no-op inside that window. The reply carries `complete` because the host caps
	// the wait: a timed-out pass still answers, but with a list that is current rather than settled — see
	// `RefreshedModels`.
	"model.refresh": { params: { force?: boolean }; result: RefreshedModels };
	// The model/thinking a fresh session resolves to (settings default, else first available) — so the
	// New-Workspace dialog shows the exact pre-session model, not a placeholder.
	"model.default": {
		params: Record<string, never>;
		result: { model: WireModel | null; thinkingLevel: ThinkingLevel };
	};
	"provider.status": { params: Record<string, never>; result: ProviderStatusReport };
	// Mints a loginId and starts pi's login flow detached (`type` absent = "oauth"; "api_key" drives the
	// provider-owned interactive key entry — possibly multi-prompt); frames arrive on `provider.login`.
	"provider.loginStart": {
		params: { providerId: string; type?: "oauth" | "api_key" };
		result: { loginId: string };
	};
	// Answers a live `select`/`prompt` frame (option id / typed text / pasted code) for the given login.
	"provider.loginReply": { params: LoginReply; result: Ack };
	// Cancels an in-flight login: aborts the flow AND settles any parked callback so pi doesn't hang.
	"provider.loginCancel": { params: { loginId: string }; result: Ack };
	// Removes a provider's stored credentials (auth.json) and refreshes the registry.
	"provider.logout": { params: { providerId: string }; result: Ack };
	// Native Central PI actions. Results and status are closed unions: no Central/extension output crosses.
	"provider.jbcentralConnect": { params: Record<string, never>; result: JbcentralConnectResult };
	"provider.jbcentralDisconnect": { params: Record<string, never>; result: JbcentralActionResult };
	"provider.jbcentralStartProxy": { params: Record<string, never>; result: JbcentralActionResult };
	"provider.jbcentralLogin": { params: Record<string, never>; result: JbcentralLoginResult };
	"provider.jbcentralUpdate": { params: Record<string, never>; result: JbcentralActionResult };
	// Hydrate one complete workspace layout, then replace only from the exact accepted base revision.
	"layout.get": {
		params: { workspaceId: string };
		result: WorkspaceLayoutSnapshot | null;
	};
	"layout.replace": { params: LayoutReplaceParams; result: LayoutReplaceResult };
	// Merge a top-level partial into server-synced settings. A supplied layout is one complete value.
	"settings.update": { params: { config: Partial<AppConfig> }; result: AppConfig };
	// Prompt recall + full-text conversation search over pi's persisted sessions (and live ones — pi
	// appends as messages complete). Server-side index; results capped (default 50/section), true totals.
	"history.search": {
		params: { query: string; scope: HistoryScope; limit?: number };
		result: HistorySearchResult;
	};
	// The open review + its comments (created lazily on first read). The read re-anchors server-side, so
	// anchor states are true as of this snapshot.
	"review.get": { params: { workspaceId: string }; result: ReviewSnapshot };
	// Add a draft comment. The client supplies the anchor's `lineRange`; the host reads the side's own
	// content and fills `contentHash` + the drift-tolerant `textQuote` + the initial `anchorState`.
	// `scope` is required for a `side: "base"` anchor: it names which diff the original side belongs to,
	// so the host resolves the same ref the editor is showing and stamps it on the anchor (`baseRef`).
	"review.commentAdd": {
		params: {
			workspaceId: string;
			kind: ReviewCommentKind;
			anchor: ReviewAnchor | null;
			body: string;
			scope?: GitDiffScope;
		};
		result: ReviewComment;
	};
	// Edit a draft's body, or flip status (manual resolve/dismiss — `resolvedBy: "user"`; resolved is
	// FINAL, a reopen is rejected — a fresh remark is a fresh comment).
	"review.commentUpdate": {
		params: { workspaceId: string; id: string; body?: string; status?: ReviewCommentStatus };
		result: ReviewComment;
	};
	// Send ONE comment into its file's review chat (created on the first send for that file; later sends
	// `followUp` into it, and then `model`/`thinkingLevel` are ignored). The structured package is the
	// prompt; the session carries the review tools. Returns the session like `session.create`.
	"review.sendComment": {
		params: {
			workspaceId: string;
			id: string;
			/** The client's last open chat — the preferred landing; omitted → the key's pinned chat / new. */
			sessionId?: string;
			model?: WireModel;
			thinkingLevel?: ThinkingLevel;
		};
		result: ReviewSendResult;
	};
	// Send all (or the given) draft comments as one batch, grouped per file: each file's comments go to
	// that file's review chat (reused via `followUp` when it exists — then `model`/`thinkingLevel` are
	// ignored). Answers with EVERY session the batch touched, in group order — a batch spanning two
	// files starts two chats, and naming only one of them leaves the other invisible to the user while
	// its comments already read as sent.
	"review.sendBatch": {
		params: {
			workspaceId: string;
			commentIds?: string[];
			/** The client's last open chat — the preferred landing; omitted → each key's pinned chat / new. */
			sessionId?: string;
			model?: WireModel;
			thinkingLevel?: ThinkingLevel;
		};
		result: { sessions: ReviewSendResult[] };
	};
	// Delete a DRAFT (the one deletable state; a sent comment is a record and is rejected).
	"review.commentDelete": { params: { workspaceId: string; id: string }; result: Ack };
	// Mark one file's review finished (`path`: the comment's file, or "" for the whole-change-set
	// bucket). Rejected while the file still has unresolved comments; a new comment re-opens the file.
	"review.fileDone": { params: { workspaceId: string; path: string }; result: Ack };
	// Atomic Clear: archive non-draft records, discard drafts, and publish a fresh open snapshot.
	"review.close": { params: { workspaceId: string }; result: Ack };
	// List all templates (global + project-scoped). `workspaceId` needed to resolve the project dir;
	// omitted → global templates only.
	"template.list": {
		params: { workspaceId?: string };
		result: { templates: TemplateInfo[] };
	};
	// Fetch a single template by name — the only read that carries the full `content` (list is
	// metadata-only). `scope` is optional (project wins over global when omitted). `workspaceId` is
	// required only if the template may be project-scoped.
	"template.get": {
		params: { workspaceId?: string; name: string; scope?: TemplateScope };
		result: Template;
	};
	// Save a template (creates or overwrites). Returns the persisted `Template`.
	"template.save": {
		params: {
			workspaceId?: string;
			scope: TemplateScope;
			name: string;
			content: string;
		};
		result: Template;
	};
	// Delete a template. Returns `Ack` on success.
	"template.delete": {
		params: { workspaceId?: string; scope: TemplateScope; name: string };
		result: Ack;
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

/**
 * Client→host receipt for responses it has processed, batched (one frame may cover many ids).
 *
 * It is the *only* proof the host has that a reply landed. A `send` that succeeds says the bytes were
 * queued, not that the page read them — a socket dying with a reply still in its buffer looks identical to
 * a delivered one. So until the id is acknowledged the host keeps the result replayable, and the page's
 * reconnect replay gets the original result instead of a second execution; once acknowledged the page can
 * never replay that id, and the retained copy has no reader left.
 */
export interface WsAck {
	ack: string[];
}

/**
 * Client→host reconciliation, sent on every (re)connect ahead of the replays: the complete set of ids this
 * page still considers unresolved. Every *other* settled result the host holds for it is free to go.
 *
 * A receipt is only as reliable as the socket carrying it, and once one is lost nothing would ever re-send it —
 * the request it named is already gone from the page's pending map, so it is neither replayed nor acknowledged
 * again. Rather than confirm the confirmations, each reconnect simply restates the whole truth, which repairs
 * every receipt the previous socket took down with it.
 */
export interface WsResume {
	resume: string[];
}

/** Anything the client sends: a request, a receipt, or a reconnect reconciliation (discriminate on the key). */
export type WsClientMessage = WsRequest | WsAck | WsResume;

/**
 * A failure the **host names**, so a client can react to *this* error rather than to "something failed".
 * Only failures with a distinct client behaviour earn a code; everything else stays a plain message.
 * - `UNKNOWN_COMMIT` — a `commit` diff scope names a commit the repo no longer has (a rebase, a branch
 *   reset). The Changes panel falls back to the branch scope **with a toast**; any *other* failure (timeout,
 *   dropped socket, git error) must leave the user's chosen scope alone.
 */
export type WsErrorCode = "UNKNOWN_COMMIT";

/** Host→client reply, correlated by `id`. `errorCode` is set only for a {@link WsErrorCode} failure. */
export interface WsResponse {
	id: string;
	ok: boolean;
	result?: unknown;
	error?: string;
	errorCode?: WsErrorCode;
}

/** Host→client push on a channel (no correlation id). */
export interface WsPush {
	channel: WsChannel;
	data: unknown;
}

/** Anything the host sends: a correlated response or a channel push (discriminate on `channel`). */
export type WsServerMessage = WsResponse | WsPush;
