import type { ReviewComment, ReviewSnapshot } from "@thinkrail/contracts";
import { getProjects } from "../projects";
import { getReviewSnapshot } from "../reviews";
import {
	clearAllPendingReviews,
	dropTodoReview,
	reviewedShaSuperseded,
	todoReviewRecord,
} from "../todos";
import { listWorkspaceRecords } from "../workspaces";
import { itemReviewActive } from "./planReviewQueue";

interface ItemRef {
	workspaceId: string;
	sessionId: string;
	id: string;
}

const activeFixItems = new Set<string>();
const activeFixKey = (sessionId: string, todoId: string): string =>
	JSON.stringify([sessionId, todoId]);

export function claimItemFix(sessionId: string, todoId: string): boolean {
	const key = activeFixKey(sessionId, todoId);
	if (activeFixItems.has(key)) return false;
	activeFixItems.add(key);
	return true;
}

export function releaseItemFix(sessionId: string, todoId: string): void {
	activeFixItems.delete(activeFixKey(sessionId, todoId));
}

/** See host/SPEC.md (todo.remove) — covers the tail past the verdict that the durable `pending` mark can't. */
export function isItemUnderActiveReview(sessionId: string, id: string): boolean {
	return activeFixItems.has(activeFixKey(sessionId, id)) || itemReviewActive(sessionId, id);
}

function isFindingStale(workspaceId: string, comment: ReviewComment): boolean {
	const origin = comment.origin;
	return (
		comment.anchorState === "outdated" &&
		origin !== undefined &&
		reviewedShaSuperseded(
			{ workspaceId, sessionId: origin.sessionId, id: origin.todoId },
			origin.reviewedSha,
		)
	);
}

export function markClientStale<T extends ReviewSnapshot>(snapshot: T, workspaceId: string): T {
	return {
		...snapshot,
		comments: snapshot.comments.map((c) =>
			isFindingStale(workspaceId, c) ? { ...c, stale: true } : c,
		),
	};
}

async function itemFindings(p: ItemRef): Promise<ReviewComment[]> {
	return (await getReviewSnapshot(p.workspaceId)).comments.filter(
		(c) =>
			c.author === "agent" &&
			c.origin?.todoId === p.id &&
			c.origin.sessionId === p.sessionId &&
			!isFindingStale(p.workspaceId, c),
	);
}

export async function itemFixFindings(p: ItemRef): Promise<ReviewComment[]> {
	return (await itemFindings(p)).filter((c) => c.status === "draft");
}

/** The approve gate's set — WIDER than the fix candidates: a `sent` finding the worker fixed without
 * resolving is still unresolved, and only `resolve_comment`/dismiss closes one. See host/SPEC.md. */
export async function itemOpenFindings(p: ItemRef): Promise<ReviewComment[]> {
	return (await itemFindings(p)).filter((c) => c.status === "draft" || c.status === "sent");
}

/**
 * A `changes_requested` verdict must not outlive its findings. Call AFTER a finding on the item was
 * removed (deleted/resolved): if the item is still `changes_requested` and now has NO open findings,
 * drop its review record so it reads `unreviewed` again. Only ever reached via a finding removal, so a
 * findings-less whole-change verdict (which never had a comment to remove) is never touched.
 */
export async function clearChangesRequestedIfResolved(p: ItemRef): Promise<void> {
	if (todoReviewRecord(p)?.state !== "changes_requested") return;
	if ((await itemOpenFindings(p)).length > 0) return;
	dropTodoReview(p);
}

/** Boot-time host-restart reconciliation — see host/SPEC.md ("reconcilePendingReviewsOnBoot"). */
export function reconcilePendingReviewsOnBoot(): void {
	for (const project of getProjects()) {
		for (const ws of listWorkspaceRecords(project.id)) {
			for (const { sessionId, itemIds } of clearAllPendingReviews(ws.worktreePath)) {
				console.warn(
					`review: cleared ${itemIds.length} stale pending mark(s) from a previous host run ` +
						`(workspace ${ws.id}, session ${sessionId}): ${itemIds.join(", ")}`,
				);
			}
		}
	}
}
