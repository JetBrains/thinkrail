import type { Project, SpecGraphNode, Workspace } from "@thinkrail/contracts";
import type { EditorTab } from "./appStore";

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

/** Resolve the active workspace from the project-grouped collection without duplicating it in state. */
export function selectActiveWorkspace(state: ActiveWorkspaceState): Workspace | null {
	if (!state.activeWorkspaceId) return null;
	for (const workspaces of Object.values(state.workspaces)) {
		const workspace = workspaces.find((candidate) => candidate.id === state.activeWorkspaceId);
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
	// Separators normalized first, then the absolute check — the same shape as `chat/tools/toolHelpers`
	// (re-stated rather than imported: the store may not depend on `chat` beyond types).
	const path = reported.replaceAll("\\", "/");
	if (path === rel) return true;
	return isAbsolutePath(path) && path.endsWith(`/${rel}`);
}

/** Posix or Windows absolute path — the two forms a pi tool call's `path` can arrive in. */
function isAbsolutePath(path: string): boolean {
	return path.startsWith("/") || /^[A-Za-z]:\//.test(path);
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
