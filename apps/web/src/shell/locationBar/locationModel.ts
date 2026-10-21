import type { OpenBranchReview, ReviewChecks, ReviewDetails } from "@thinkrail/contracts";
import { type Translator, t } from "@thinkrail/locales/react";
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

export function reviewStateLabel(t: Translator, review: OpenBranchReview): string {
	if (review.state === "merged") return t("shell.location.review.merged");
	if (review.state === "closed") return t("shell.location.review.closed");
	return isDraft(review) ? t("shell.location.review.draft") : t("shell.location.review.open");
}

/** `PR #12` while open, `Draft #12` as a draft; `Merged #12` / `Closed #12` afterwards (MRs keep their `!`). */
export function reviewChipLabel(t: Translator, review: OpenBranchReview): string {
	const ref = `${review.kind === "pull-request" ? "#" : "!"}${review.number}`;
	if (isDraft(review)) return t("shell.location.review.chipDraft", { ref });
	if (isOpenBranchReview(review)) {
		return review.kind === "pull-request"
			? t("shell.location.review.chipPr", { ref })
			: t("shell.location.review.chipMr", { ref });
	}
	return review.state === "merged"
		? t("shell.location.review.chipMerged", { ref })
		: t("shell.location.review.chipClosed", { ref });
}

export type ChecksVerdict = "failing" | "pending" | "passing";

export function checksVerdict(checks: ReviewChecks): ChecksVerdict {
	if (checks.failing > 0) return "failing";
	return checks.pending > 0 ? "pending" : "passing";
}

export function checksSummary(t: Translator, checks: ReviewChecks): string {
	const total = checks.passing + checks.pending + checks.failing;
	switch (checksVerdict(checks)) {
		case "failing": {
			const names = checks.failingNames.join(", ");
			return names
				? t("shell.location.checks.failingNamed", { count: checks.failing, names })
				: t("shell.location.checks.failing", { count: checks.failing });
		}
		case "pending":
			return t("shell.location.checks.running", { pending: checks.pending, count: total });
		case "passing":
			return t("shell.location.checks.passed", { count: total });
	}
}

export type ReviewSummary = { text: string; tone: "success" | "warning" | "muted" };

function people(logins: string[]): string {
	return logins.map((login) => `@${login}`).join(", ");
}

export function reviewSummary(t: Translator, details: ReviewDetails): ReviewSummary | null {
	const approvers = details.reviewers.filter((r) => r.state === "approved").map((r) => r.login);
	const blockers = details.reviewers
		.filter((r) => r.state === "changes_requested")
		.map((r) => r.login);
	if (
		details.reviewDecision === "changes_requested" ||
		(!details.reviewDecision && blockers.length)
	) {
		return {
			text: blockers.length
				? t("shell.location.decision.changesRequestedBy", { people: people(blockers) })
				: t("shell.location.decision.changesRequested"),
			tone: "warning",
		};
	}
	if (details.reviewDecision === "approved" || (!details.reviewDecision && approvers.length)) {
		return {
			text: approvers.length
				? t("shell.location.decision.approvedBy", { people: people(approvers) })
				: t("shell.location.decision.approved"),
			tone: "success",
		};
	}
	if (details.reviewDecision === "review_required") {
		return { text: t("shell.location.decision.waiting"), tone: "muted" };
	}
	return null;
}

export function projectInitial(name: string): string {
	const first = [...name.trim()][0];
	return first ? first.toLocaleUpperCase() : "?";
}

export function pluralCommits(count: number): string {
	return t("shell.location.commits", { count });
}
