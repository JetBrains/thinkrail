import type {
	GitDiffScope,
	Project,
	SpecGraphNode,
	WireModel,
	Workspace,
} from "@thinkrail/contracts";
import { isAbsolutePath, normalizePath } from "../lib";
import type { EditorTab, TerminalTab } from "./appStore";

interface ActiveWorkspaceState {
	activeWorkspaceId: string | null;
	workspaces: Record<string, Workspace[]>;
}

interface ProjectContextState extends ActiveWorkspaceState {
	selectedProjectId: string | null;
	projects: Project[];
}

/**
 * The built-in Default workspace — the project folder itself. Clients key off the wire's `kind` field
 * only; this predicate is the single place it's read (rail row, receipt, scope spine, folder-mode entry).
 */
export function isDefaultWorkspace(workspace: Pick<Workspace, "kind">): boolean {
	return workspace.kind === "default";
}

/** An explicitly attached existing worktree whose checkout stays user-owned. */
export function isExternalWorkspace(workspace: Pick<Workspace, "kind">): boolean {
	return workspace.kind === "external";
}

/** User-owned checkouts never carry ThinkRail-created-worktree provenance or reclaim semantics. */
export function isUserOwnedWorkspace(workspace: Pick<Workspace, "kind">): boolean {
	return isDefaultWorkspace(workspace) || isExternalWorkspace(workspace);
}

/** Resolve the active workspace from the project-grouped collection without duplicating it in state. */
export function selectActiveWorkspace(state: ActiveWorkspaceState): Workspace | null {
	return state.activeWorkspaceId ? selectWorkspaceById(state, state.activeWorkspaceId) : null;
}

/** The workspace with this id, wherever it sits in the project-grouped collection. */
export function selectWorkspaceById(
	state: ActiveWorkspaceState,
	workspaceId: string,
): Workspace | null {
	for (const workspaces of Object.values(state.workspaces)) {
		const workspace = workspaces.find((candidate) => candidate.id === workspaceId);
		if (workspace) return workspace;
	}
	return null;
}

/** The project that owns the active workspace; null while there is no active/resolved workspace. */
export function selectActiveWorkspaceProjectId(state: ActiveWorkspaceState): string | null {
	return selectActiveWorkspace(state)?.projectId ?? null;
}

/** Shell location context: the active workspace owner takes precedence over the selected Project Home. */
export function selectContextProject(state: ProjectContextState): Project | null {
	const projectId = selectActiveWorkspace(state)?.projectId ?? state.selectedProjectId;
	return state.projects.find((project) => project.id === projectId) ?? null;
}

/** Where the shell's global `Ctrl+R` sends its history-open request — see `selectHistoryTarget`. */
export interface HistoryTarget {
	workspaceId: string;
	/** The chat tab to make active (already active in the common case). */
	tabId: string;
	sessionId: string;
}

/**
 * The chat the active workspace's history search belongs to: the active tab when it *is* a chat,
 * otherwise the workspace's most recently opened one. Null only when the workspace has no chat tab at
 * all (or there's no active workspace) — the one case where `Ctrl+R` has nothing to open.
 *
 * The fallback is the point. `CenterTabs` mounts one tab body at a time, so with a file/diff/doc tab
 * active there is no `ChatView` to route to — and since the chord is swallowed app-wide, resolving to
 * "no target" there would make `Ctrl+R` silently do *nothing* over Monaco, a diff, or the file tree:
 * precisely the places the global handler exists to cover. Returning the chat tab (which the caller
 * activates, atomically with the request) means the chord always lands somewhere.
 */
export function selectHistoryTarget(state: {
	activeWorkspaceId: string | null;
	tabsByWorkspace: Record<string, EditorTab[]>;
	activeTabByWorkspace: Record<string, string | null>;
}): HistoryTarget | null {
	const workspaceId = state.activeWorkspaceId;
	if (!workspaceId) return null;
	const tabs = state.tabsByWorkspace[workspaceId] ?? [];
	const activeTabId = state.activeTabByWorkspace[workspaceId] ?? null;
	const active = tabs.find((t) => t.id === activeTabId);
	// `findLast`, not `find`: tabs are appended in open order, so the last chat tab is the most recently
	// opened one — the best "which chat did they mean" answer available without an MRU we don't track.
	const chat = active?.kind === "chat" ? active : tabs.findLast((t) => t.kind === "chat");
	return chat ? { workspaceId, tabId: chat.id, sessionId: chat.sessionId } : null;
}

/**
 * The catalog entry for a model ref, matched by `{provider,id}`. A session's own `model` is the snapshot
 * it was created with, while `models` is refreshed live — so anything reading host-computed facts off a
 * model (today `thinkingLevels`, which drives the effort picker's disabled rows) must read them here,
 * not off the snapshot. Null when the ref is absent from the catalog: the caller then falls back to the
 * snapshot rather than blanking the UI.
 */
export function selectCatalogModel(
	models: readonly WireModel[],
	ref: Pick<WireModel, "provider" | "id"> | null,
): WireModel | null {
	if (!ref) return null;
	return models.find((m) => m.provider === ref.provider && m.id === ref.id) ?? null;
}

/**
 * The **default** diff scope: the workspace's work since diverging from its diff base (the scope that
 * predates the scope selector; the host measures it from the merge-base). A shared module constant, not a fresh object per read, so
 * {@link selectDiffScope} is referentially stable for a workspace that never picked a scope.
 */
export const BRANCH_SCOPE: GitDiffScope = { kind: "branch" };

/**
 * What the Changes panel of this workspace is diffing. Per **workspace**, not app-wide like `changesView`: a
 * scope is a property of that branch's review (a commit sha means nothing in another worktree), so it must
 * not follow the user across workspaces.
 */
export function selectDiffScope(
	state: { diffScopeByWorkspace: Record<string, GitDiffScope> },
	workspaceId: string,
): GitDiffScope {
	return state.diffScopeByWorkspace[workspaceId] ?? BRANCH_SCOPE;
}

/**
 * The ref a workspace's changes are measured **against**, mirroring the host's own resolution
 * (`diffBase ?? baseBranch`: the re-pointed review target, else the ref the worktree was cut from). The
 * client needs it to label the target-branch picker and to key the Changes read — so it lives here once,
 * rather than being re-derived in the panel. `""` when the workspace isn't known yet.
 */
export function selectDiffBaseRef(state: ActiveWorkspaceState, workspaceId: string): string {
	const workspace = selectWorkspaceById(state, workspaceId);
	return workspace ? (workspace.diffBase ?? workspace.baseBranch) : "";
}

/**
 * The **live dimension** of an open diff tab's content, beyond the workspace's fs tick: a `branch`-scope tab
 * shows "this file vs the workspace's *current* review target", so re-pointing that target (a
 * `workspace.setDiffBase` broadcast) has to re-read the tab — exactly like a file change does. A `commit`
 * scope has no such dimension (a sha is immutable), hence `""`: nothing to watch.
 *
 * An `uncommitted` tab is `""` too, and needs nothing more: its `HEAD` *can* move without the worktree's files
 * moving (a `git commit`/`reset`/`checkout` in a terminal), but the host watches each worktree's resolved git
 * metadata and pushes a **pathless** `fsChanged` nudge when a ref moves — so that case arrives on the same fs
 * tick every other live read uses, rather than needing a second dimension here.
 */
export function selectDiffTabTargetRef(
	state: ActiveWorkspaceState,
	tab: { workspaceId: string; scope: GitDiffScope },
): string {
	return tab.scope.kind === "branch" ? selectDiffBaseRef(state, tab.workspaceId) : "";
}

/** Whether a worktree-relative path is inside a skill directory — the auto-detect trigger for a reload. */
export function isSkillPath(path: string): boolean {
	return /(^|\/)\.(claude|github|gemini|pi|agents)\/skills(\/|$)/.test(path);
}

/**
 * Whether a path **as pi reported it** (worktree-relative or absolute — a tool call's `path` argument is
 * whichever the agent passed) designates the worktree-relative `rel`. Shared by every consumer that has to
 * line an agent-reported path up against a worktree-relative one (the Changes deep link, the spec
 * classifier).
 *
 * The suffix rule applies to **absolute reports only**, and is anchored at a separator. Both halves matter:
 * unanchored, `/wt/src/a-foo.ts` would match the entry `src/foo.ts`; applied to relative reports,
 * `module-b/SPEC.md` would match the *root* entry `SPEC.md` — turning every module spec in a repo into the
 * root one, and every nested file into whatever short entry it happens to end with.
 */
export function matchesWorktreePath(reported: string, rel: string): boolean {
	const path = normalizePath(reported);
	if (path === rel) return true;
	return isAbsolutePath(path) && path.endsWith(`/${rel}`);
}

/**
 * A predicate over agent-reported paths: is this file a **spec** — i.e. a node of the workspace's spec
 * graph? This is the one definition the app uses to route an agent-written file to the Specs side rather
 * than the Changes side (see `chat`'s turn divider), and it deliberately reuses the very snapshot the Specs
 * panel renders, so the two can never disagree. Closes over the paths alone, not the nodes.
 */
export function specPathMatcher(nodes: SpecGraphNode[]): (path: string) => boolean {
	const paths = nodes.map((node) => node.path);
	return (reported) => paths.some((rel) => matchesWorktreePath(reported, rel));
}

/**
 * A workspace's current live-refresh tick (0 before any fs change). Snapshot it at the **start** of a
 * skill-loading round-trip (session create / reload / hydrate) and record it as that session's sync
 * baseline once the load resolves — so a skill change whose `fsChanged` frame folds *while the load is in
 * flight* stays past the baseline and keeps the reload badge lit (the load saw the pre-change skills).
 */
export function selectWorkspaceTick(
	state: { fsChangesByWorkspace: Record<string, { tick: number }> },
	workspaceId: string,
): number {
	return state.fsChangesByWorkspace[workspaceId]?.tick ?? 0;
}

/**
 * The workspace's center-navigation count (`navTickByWorkspace`) — the thing a deferred open compares
 * against to tell whether the user has moved on since they asked for it. Read it through here rather than
 * indexing the record: the "missing key means 0" default is the whole contract, and a caller that forgot it
 * would read `undefined` and never match a stamp.
 */
export function selectWorkspaceNavTick(
	state: { navTickByWorkspace: Record<string, number> },
	workspaceId: string,
): number {
	return state.navTickByWorkspace[workspaceId] ?? 0;
}

interface SkillsStaleState {
	/** Per workspace, the fs tick of the most recent skill-relevant `fsChanged` batch (see `noteFsChanged`). */
	skillChangeTickByWorkspace: Record<string, number>;
	/** Per session, the fs tick it last loaded/reloaded skills at (session create + successful reload). */
	skillsSyncedTickBySession: Record<string, number>;
}

/**
 * A session's Skills badge is stale when a skill-dir change landed on disk *after* the session last loaded
 * (or reloaded) its skills — the workspace's last skill-change tick is past this session's sync tick. Being
 * store-derived, it survives `ChatView` remounts on tab switch (the reported bug); being keyed per session,
 * a sibling or newer chat that loaded the current skills is not flagged, and a reload clears only its own.
 */
export function selectSkillsStale(
	state: SkillsStaleState,
	workspaceId: string,
	sessionId: string,
): boolean {
	return (
		(state.skillChangeTickByWorkspace[workspaceId] ?? 0) >
		(state.skillsSyncedTickBySession[sessionId] ?? 0)
	);
}

/** The terminal slices a panel reads. Narrow on purpose — a selector takes what it needs, not the store. */
export interface TerminalState {
	activeWorkspaceId: string | null;
	terminalsByWorkspace: Record<string, TerminalTab[]>;
	activeTerminalByWorkspace: Record<string, string | null>;
}

/** Stable empty list, so "no terminals" doesn't hand back a fresh array and re-render on every read. */
const NO_TERMINALS: TerminalTab[] = [];

/** The active workspace's terminal tabs, in tab-strip order. */
export function selectWorkspaceTerminals(state: TerminalState): TerminalTab[] {
	if (!state.activeWorkspaceId) return NO_TERMINALS;
	return state.terminalsByWorkspace[state.activeWorkspaceId] ?? NO_TERMINALS;
}

/** Which of the active workspace's terminals is showing, or null when it has none. */
export function selectActiveTerminalId(state: TerminalState): string | null {
	if (!state.activeWorkspaceId) return null;
	return state.activeTerminalByWorkspace[state.activeWorkspaceId] ?? null;
}

/** The workspace's "current" chat — where a review send should land: the ACTIVE tab when it is a
 * chat, else the most recently opened chat tab, else `null` (the host then creates a fresh one). The
 * ONE derivation of "the last open chat", shared by every send affordance. */
export function selectLastOpenChatSession(
	state: {
		tabsByWorkspace: Record<string, { kind: string; id: string; sessionId?: string }[]>;
		activeTabByWorkspace: Record<string, string | null>;
	},
	workspaceId: string,
): string | null {
	const tabs = state.tabsByWorkspace[workspaceId] ?? [];
	const activeId = state.activeTabByWorkspace[workspaceId];
	const active = tabs.find((t) => t.id === activeId);
	if (active?.kind === "chat" && active.sessionId) return active.sessionId;
	for (let i = tabs.length - 1; i >= 0; i--) {
		const tab = tabs[i];
		if (tab?.kind === "chat" && tab.sessionId) return tab.sessionId;
	}
	return null;
}

/** A workspace's pending review drafts — the Review tab badge + the "Send review (N)" count. The ONE
 * derivation of "how many drafts", so the badge and the footer can never disagree. */
export function selectReviewDraftCount(
	state: { reviewsByWorkspace: Record<string, { comments: { status: string }[] }> },
	workspaceId: string | null,
): number {
	if (!workspaceId) return 0;
	const snapshot = state.reviewsByWorkspace[workspaceId];
	return snapshot ? snapshot.comments.filter((c) => c.status === "draft").length : 0;
}
