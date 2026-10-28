/** Timeout budget for Git to create a worktree checkout. */
export const WORKSPACE_CREATE_GIT_TIMEOUT_MS = 10 * 60_000;

/** Best-effort timeout budget for removing a checkout if worktree creation times out. */
export const WORKSPACE_CREATE_CLEANUP_TIMEOUT_MS = 2 * 60_000;

/** Client budget includes the fallback fetch, checkout, cleanup, and time for the reply to arrive. */
export const WORKSPACE_CREATE_REQUEST_TIMEOUT_MS = 15 * 60_000;
