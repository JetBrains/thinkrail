import type {
	PrBabysitItem,
	PrBabysitItemSource,
	PrBabysitSessionStatus,
	ReviewFindingSeverity,
} from "@thinkrail/contracts";
import type { MessageKey } from "@thinkrail/locales";
import type { Translator } from "@thinkrail/locales/react";

export const PR_BABYSIT_SOURCE_LABEL: Record<PrBabysitItemSource, MessageKey> = {
	github_thread: "prBabysit.source.githubThread",
	ci_check: "prBabysit.source.ciCheck",
	independent_review: "prBabysit.source.independentReview",
};

export const PR_BABYSIT_SEVERITY_LABEL: Record<ReviewFindingSeverity, MessageKey> = {
	blocker: "prBabysit.severity.blocker",
	warning: "prBabysit.severity.warning",
	suggestion: "prBabysit.severity.suggestion",
};

export const PR_BABYSIT_SESSION_LABEL: Record<PrBabysitSessionStatus, MessageKey> = {
	watching: "prBabysit.session.watching",
	reviewing: "prBabysit.session.reviewing",
	fixing: "prBabysit.session.fixing",
	needs_human: "prBabysit.session.needsHuman",
	stopped: "prBabysit.session.stopped",
	merged: "prBabysit.session.merged",
	closed: "prBabysit.session.closed",
	error: "prBabysit.session.error",
};

/** The live status badge text; a staged fix (`needs_human` with a commit and no error) reads "Staged <sha>". */
export function prBabysitItemStatusLabel(t: Translator, item: PrBabysitItem): string {
	const sha = item.commitSha?.slice(0, 7);
	switch (item.status) {
		case "pending_review_approval":
			return t("prBabysit.status.pendingApproval");
		case "queued":
			return t("prBabysit.status.queued");
		case "working":
			return t("prBabysit.status.working");
		case "pushed":
			return sha ? t("prBabysit.status.pushedSha", { sha }) : t("prBabysit.status.pushed");
		case "needs_human":
			return sha && !item.errorMessage
				? t("prBabysit.status.stagedSha", { sha })
				: t("prBabysit.status.needsHuman");
		case "resolved":
			return t("prBabysit.status.resolved");
		case "dismissed":
			return t("prBabysit.status.dismissed");
	}
}

export type PrBabysitItemActionId =
	| "fix"
	| "post"
	| "openDiff"
	| "approvePush"
	| "retry"
	| "dismiss";

/** Which buttons an item offers, in display order — derived from its source and status only. */
export function prBabysitItemActions(item: PrBabysitItem): PrBabysitItemActionId[] {
	const actions: PrBabysitItemActionId[] = [];
	const finding = item.source === "independent_review";
	if (item.status === "pending_review_approval") actions.push("fix");
	if (finding && !item.postedToGithub && item.status !== "dismissed") actions.push("post");
	if (item.commitSha) actions.push("openDiff");
	if (item.status === "needs_human" && item.commitSha) actions.push("approvePush");
	if (
		item.status === "needs_human" ||
		item.status === "dismissed" ||
		item.status === "resolved" ||
		(item.status === "pushed" && !finding)
	)
		actions.push("retry");
	if (
		item.status === "pending_review_approval" ||
		item.status === "queued" ||
		item.status === "needs_human"
	)
		actions.push("dismiss");
	return actions;
}
