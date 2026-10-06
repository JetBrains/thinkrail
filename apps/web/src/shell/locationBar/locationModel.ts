import type { OpenBranchReview } from "@thinkrail/contracts";

export interface RemoteCounts {
	unpushed: number;
	behind: number;
}

export function reviewIsOpen(review: OpenBranchReview): boolean {
	return review.state === undefined || review.state === "open";
}

/** Divergence only matters while the review is open; against a merged branch it is noise. */
export function remoteCounts(review: OpenBranchReview | null): RemoteCounts | null {
	if (!review || !reviewIsOpen(review)) return null;
	const unpushed = review.unpushedCommits ?? 0;
	const behind = review.behindCommits ?? 0;
	return unpushed > 0 || behind > 0 ? { unpushed, behind } : null;
}

export type ReviewTone = "success" | "info" | "neutral";

export function reviewTone(review: OpenBranchReview): ReviewTone {
	return review.state === "merged" ? "info" : review.state === "closed" ? "neutral" : "success";
}

export function reviewStateLabel(review: OpenBranchReview): "Open" | "Merged" | "Closed" {
	return review.state === "merged" ? "Merged" : review.state === "closed" ? "Closed" : "Open";
}

/** `PR #12` while open; `Merged #12` / `Closed #12` afterwards (MRs keep their `!`). */
export function reviewChipLabel(review: OpenBranchReview): string {
	const ref = `${review.kind === "pull-request" ? "#" : "!"}${review.number}`;
	if (reviewIsOpen(review)) return `${review.kind === "pull-request" ? "PR" : "MR"} ${ref}`;
	return `${reviewStateLabel(review)} ${ref}`;
}

export function projectInitial(name: string): string {
	const first = [...name.trim()][0];
	return first ? first.toLocaleUpperCase() : "?";
}

export function pluralCommits(count: number): string {
	return `${count} commit${count === 1 ? "" : "s"}`;
}
