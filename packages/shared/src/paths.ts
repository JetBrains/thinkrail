// Worktree-relative path conventions ThinkRail owns, named once so the places that create, hide, and
// ignore them can't drift. Server-side only (the host seeds/reads them; the browser never needs them —
// the file reader filters the internal dir out before the wire). Distinct from the *home* state dir
// (`~/.thinkrail`, resolved in the server's persistence module): these live inside a workspace worktree.

/**
 * ThinkRail's repo-local directory inside a workspace's worktree. Git-ignored and hidden from the
 * All-files tree (the same treatment as `.git`) — everything under it is host-managed, not project source.
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
 * The `.gitignore` body seeded into the context dir: a lone `*` matches the `.gitignore` file itself, so
 * the whole dir has zero git footprint (nothing in `git status`, nothing committable).
 */
export const WORKSPACE_CONTEXT_GITIGNORE = "*\n";
