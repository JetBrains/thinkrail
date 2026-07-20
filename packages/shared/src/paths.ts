// Worktree-relative path conventions ThinkRail owns, named once so current and future consumers agree
// (today: the host seeds the scratch dir and git ignores it). Server-side only — the host creates and
// ignores these; the browser never needs them. Distinct from the *home* state dir (`~/.thinkrail`,
// resolved in the server's persistence module): these live inside a workspace worktree.

/**
 * ThinkRail's repo-local directory inside a workspace's worktree. Today it holds the ephemeral `context/`
 * scratch dir; it is also the intended home for future host-managed files under a worktree (e.g. a cached
 * spec index), so the base name is shared rather than inlined. Not hidden from the file tree — future
 * content here should stay visible.
 */
export const WORKSPACE_INTERNAL_DIR = ".thinkrail";

/**
 * Ephemeral scratch dir (relative to the worktree root) for temp docs — brainstorming's task-specs and
 * any workflow working files. The host seeds it per worktree; the spec tools still scan it (they ignore
 * only node_modules/.git/dist/build, not `.gitignore`), so its task-specs stay live for the agent while
 * invisible to git.
 */
export const WORKSPACE_CONTEXT_DIR = `${WORKSPACE_INTERNAL_DIR}/context`;

/**
 * Committed hook config (relative to the worktree root) — a project's own `onCreate`/`onDelete`/`preMerge`/
 * `postMerge` commands. Unlike `context/`, this one is a normal tracked file: it's checked out the moment
 * `git worktree add` creates the worktree, so it's already present by the time the `onCreate` hook needs it.
 */
export const WORKSPACE_HOOKS_CONFIG_FILE = `${WORKSPACE_INTERNAL_DIR}/hooks.json`;
