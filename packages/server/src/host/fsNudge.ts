import type { WorkspaceFsChangedPayload } from "@thinkrail/contracts";
import { diffBaseRef } from "../git";
import { listWorkspaceRecords } from "../workspaces";

/**
 * Host-side invalidation for a git ref that moved **without any worktree seeing it**: the app's own
 * background `git fetch` (`git.prefetch`) writes only to the project repo's shared `.git`
 * (`refs/remotes/…`), which is outside every linked worktree's watched root *and* outside its
 * non-recursive `.git/worktrees/<name>` metadata watcher — so no `watch`-module signal can exist. The
 * `git.prefetch` handler calls this when the fetch actually moved the ref, and it fans the same
 * **pathless** `fsChanged` frame the repo-metadata seam uses (an invalidation, not data: no `.git` path
 * ever reaches a client) out to the workspaces whose branch-scope diff is measured against that ref.
 * Re-reads are idempotent — a workspace whose merge-base didn't move re-reads into identical state.
 *
 * Lives in `host` (not `git`/`watch`): it is host mediation between two feature modules, exactly like the
 * repo-metadata fanout wired next to it in `createServer`.
 */
type FsNudgePublisher = (payload: WorkspaceFsChangedPayload) => void;

// Injected by `createServer` (the same publisher inversion the watch/workspaces seams use). `null` in
// unit tests → the nudge is a silent no-op.
let publish: FsNudgePublisher | null = null;

/** Install (or clear with `null`) the sink the nudge frames are published through. */
export function setFsNudgePublisher(publisher: FsNudgePublisher | null): void {
	publish = publisher;
}

/**
 * Nudge every workspace of `projectId` whose diff base is `ref` (the moved remote-tracking ref, e.g.
 * `origin/main`) to re-read its git-derived views. Workspaces measuring against another ref — or another
 * project's — are deliberately not woken: their diffs cannot have changed meaning.
 */
export function nudgeBaseRefWorkspaces(projectId: string, ref: string): void {
	if (!publish) return;
	for (const ws of listWorkspaceRecords(projectId)) {
		if (diffBaseRef(ws) === ref) publish({ workspaceId: ws.id, paths: [], truncated: false });
	}
}
