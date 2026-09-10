import type { ReviewComment, ReviewSnapshot } from "@thinkrail/contracts";
import { getProjects } from "../projects";
import { getReviewSnapshot } from "../reviews";
import { clearAllPendingReviews, reviewedShaSuperseded } from "../todos";
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
