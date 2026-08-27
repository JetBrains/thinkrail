import type { AgentSettlement, PiEvent } from "@thinkrail/contracts";
import { notifyExtUi } from "../agent";
import { clearReviewPending, readReviewMeta } from "../todos";
import { getWorkspace } from "../workspaces";

const reviewerToWorker = new Map<string, { workspaceId: string; sessionId: string }>();

export function setReviewerSessionWorkspaceMapping(
	reviewerSessionId: string,
	workspaceId: string,
	workerSessionId: string,
): void {
	reviewerToWorker.set(reviewerSessionId, { workspaceId, sessionId: workerSessionId });
}

export function clearReviewerSessionWorkspaceMapping(reviewerSessionId: string): void {
	reviewerToWorker.delete(reviewerSessionId);
}

export function reviewerWorkerFor(
	reviewerSessionId: string,
): { workspaceId: string; sessionId: string } | null {
	return reviewerToWorker.get(reviewerSessionId) ?? null;
}

export type ReviewerTermination = "crashed" | "aborted" | "no-verdict";

export function reviewerTermination(terminal: AgentSettlement | null): ReviewerTermination {
	if (terminal?.errorMessage) return "crashed";
	switch (terminal?.stopReason) {
		case "error":
		case "length":
			return "crashed";
		case "aborted":
			return "aborted";
		default:
			return "no-verdict";
	}
}

const TERMINATION_NOTICE: Record<
	ReviewerTermination,
	{ message: string; level: "info" | "warning" | "error" }
> = {
	crashed: {
		message:
			"Review session crashed — the findings are not available. Please try the review again.",
		level: "error",
	},
	aborted: {
		message: "Review stopped before a verdict — start the review again when ready.",
		level: "info",
	},
	"no-verdict": {
		message:
			"The reviewer finished without a verdict — the review was cleared. Start it again if needed.",
		level: "warning",
	},
};

export interface ReviewerCleanup {
	workspaceId: string;
	sessionId: string;
	itemIds: string[];
}

export function maybeCleanupStuckReviewSession(
	sessionId: string,
	event: PiEvent,
): ReviewerCleanup | null {
	if (event.type !== "agent_settled") return null;
	const mapping = reviewerToWorker.get(sessionId);
	if (!mapping) return null;
	try {
		const ws = getWorkspace(mapping.workspaceId);
		const meta = readReviewMeta(ws.worktreePath, mapping.sessionId);
		const itemIds = Object.keys(meta.pending);
		if (itemIds.length === 0) return null;
		clearReviewerSessionWorkspaceMapping(sessionId);
		for (const itemId of itemIds) {
			clearReviewPending(ws.worktreePath, mapping.sessionId, itemId);
		}
		const notice = TERMINATION_NOTICE[reviewerTermination(event.terminal)];
		notifyExtUi(sessionId, notice.message, notice.level);
		return { ...mapping, itemIds };
	} catch (err) {
		console.warn(`cleanup reviewer termination (${sessionId}): ${err}`);
		return null;
	}
}
