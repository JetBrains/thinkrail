import type { OpenBranchReview, ReviewChecks, ReviewDetails } from "@thinkrail/contracts";
import { isOpenBranchReview } from "../../panels/useBranchStatus";

export interface RemoteCounts {
	unpushed: number;
	behind: number;
}

export function remoteCounts(
	review: OpenBranchReview | null,
	detailsKnown = true,
): RemoteCounts | "unknown" | null {
	if (!review || !isOpenBranchReview(review)) return null;
	if (!detailsKnown) return "unknown";
	const unpushed = review.unpushedCommits ?? 0;
	const behind = review.behindCommits ?? 0;
	return unpushed > 0 || behind > 0 ? { unpushed, behind } : null;
}

export type ReviewTone = "success" | "info" | "neutral";

function isDraft(review: OpenBranchReview): boolean {
	return isOpenBranchReview(review) && review.details?.draft === true;
}

export function reviewTone(review: OpenBranchReview): ReviewTone {
	if (review.state === "merged") return "info";
	return review.state === "closed" || isDraft(review) ? "neutral" : "success";
}

export function reviewStateLabel(review: OpenBranchReview): "Open" | "Draft" | "Merged" | "Closed" {
	if (review.state === "merged") return "Merged";
	if (review.state === "closed") return "Closed";
	return isDraft(review) ? "Draft" : "Open";
}

/** `PR #12` while open, `Draft #12` as a draft; `Merged #12` / `Closed #12` afterwards (MRs keep their `!`). */
export function reviewChipLabel(review: OpenBranchReview): string {
	const ref = `${review.kind === "pull-request" ? "#" : "!"}${review.number}`;
	if (isDraft(review)) return `Draft ${ref}`;
	if (isOpenBranchReview(review)) return `${review.kind === "pull-request" ? "PR" : "MR"} ${ref}`;
	return `${reviewStateLabel(review)} ${ref}`;
}

export type ChecksVerdict = "failing" | "pending" | "passing";

export function checksVerdict(checks: ReviewChecks): ChecksVerdict {
	if (checks.failing > 0) return "failing";
	return checks.pending > 0 ? "pending" : "passing";
}

function plural(count: number, noun: string): string {
	return `${count} ${noun}${count === 1 ? "" : "s"}`;
}

export function checksSummary(checks: ReviewChecks): string {
	const total = checks.passing + checks.pending + checks.failing;
	switch (checksVerdict(checks)) {
		case "failing": {
			const names = checks.failingNames.join(", ");
			return `${plural(checks.failing, "check")} failing${names ? `: ${names}` : ""}`;
		}
		case "pending":
			return `${checks.pending} of ${plural(total, "check")} running`;
		case "passing":
			return `${plural(total, "check")} passed`;
	}
}

export type ReviewSummary = { text: string; tone: "success" | "warning" | "muted" };

function people(logins: string[]): string {
	return logins.map((login) => `@${login}`).join(", ");
}

export function reviewSummary(details: ReviewDetails): ReviewSummary | null {
	const approvers = details.reviewers.filter((r) => r.state === "approved").map((r) => r.login);
	const blockers = details.reviewers
		.filter((r) => r.state === "changes_requested")
		.map((r) => r.login);
	if (
		details.reviewDecision === "changes_requested" ||
		(!details.reviewDecision && blockers.length)
	) {
		return {
			text: blockers.length ? `Changes requested by ${people(blockers)}` : "Changes requested",
			tone: "warning",
		};
	}
	if (details.reviewDecision === "approved" || (!details.reviewDecision && approvers.length)) {
		return {
			text: approvers.length ? `Approved by ${people(approvers)}` : "Approved",
			tone: "success",
		};
	}
	if (details.reviewDecision === "review_required") {
		return { text: "Waiting for review", tone: "muted" };
	}
	return null;
}

export function projectInitial(name: string): string {
	const first = [...name.trim()][0];
	return first ? first.toLocaleUpperCase() : "?";
}

export function pluralCommits(count: number): string {
	return `${count} commit${count === 1 ? "" : "s"}`;
}
