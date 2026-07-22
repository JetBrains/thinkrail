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
 * Where the chat TODO lists live — one JSON file per session under the context scratch dir, so the plans
 * are ephemeral (gitignored with the rest of `context/`) alongside the other per-conversation working
 * files. The pi-free `pi-todos/core` cannot import this package (it stays portable to vanilla `pi`), so it
 * carries its own local mirror of this value; this is the host-side source of truth (the server filters
 * and attributes paths against it). Keep the two in step.
 */
export const WORKSPACE_TODOS_DIR = `${WORKSPACE_CONTEXT_DIR}/todos`;
