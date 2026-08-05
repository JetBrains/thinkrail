// The `project.refsChanged` seam — modeled exactly on `fsNudge.ts`'s publisher-injection inversion (a
// module-level nullable function, `null` a silent no-op in unit tests), living in `host` for the same
// reason that one does: a git ref moving in the project repo's shared `.git` is invisible to every
// worktree's own file-watcher, and this module is where `remotes` (which owns no publish channel of its
// own — see `remotes/SPEC.md`'s "forbidden: host") gets wired to one.
//
// Unlike `nudgeBaseRefWorkspaces`, this has nothing to fan OUT over: `ProjectRefsChangedPayload` carries
// only a `projectId` (see `contracts/domain.ts`), and every real caller (`git.prefetch`'s success path,
// the new `git.fetchNow` handler) already has one in hand before calling this — `git.prefetch` receives
// it as a param, `git.fetchNow` resolves it once from the workspace it was given. So one call publishes
// exactly one frame, however many workspaces that project has open — never one per workspace, which is
// what a naive copy of `fsNudge`'s per-workspace loop would produce for a payload shape that doesn't vary
// per workspace in the first place.
import type { ProjectRefsChangedPayload } from "@thinkrail/contracts";

type RefsNudgePublisher = (payload: ProjectRefsChangedPayload) => void;

let publish: RefsNudgePublisher | null = null;

export function setRefsNudgePublisher(publisher: RefsNudgePublisher | null): void {
	publish = publisher;
}

/** Nudge `projectId`'s clients that its shared git metadata may have moved — an invalidation, not data
 * (see `ProjectRefsChangedPayload`'s doc); a duplicate/replayed frame is harmless. */
export function nudgeProjectRefsChanged(projectId: string): void {
	if (!publish) return;
	publish({ projectId });
}
