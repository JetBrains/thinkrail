import type { OpenBranchReview, ReviewMergeState } from "@thinkrail/contracts";
import { isShellInert } from "../lib";
import type { BranchFacts } from "./branchStatusState";
import { isOpenBranchReview } from "./useBranchStatus";

export type ShipActionId =
	| "publish"
	| "push"
	| "sync"
	| "openPr"
	| "openDraftPr"
	| "createMr"
	| "mergeLocal"
	| "fixChecks"
	| "ready"
	| "mergePr"
	| "reopen"
	| "deleteRemote"
	| "settle"
	| "keepActive"
	| "remove";

export type ShipTone = "primary" | "warning" | "neutral" | "danger";

export interface ShipAction {
	id: ShipActionId;
	label: string;
	short: string;
	tone: ShipTone;
	disabled?: true;
	hint?: string;
}

export type RemoteValue =
	| { kind: "noOrigin" }
	| { kind: "unreachable" }
	| { kind: "unpublished" }
	| { kind: "published" }
	| { kind: "inSync" }
	| { kind: "counts"; ahead: number; behind: number };

export type ReviewValue = "base" | "none" | "review";

export interface ShipArm {
	primary: ShipAction | null;
	secondary: ShipAction[];
}

export interface ShipModel {
	noun: "PR" | "MR";
	remote: ShipArm & { value: RemoteValue };
	review: ShipArm & { value: ReviewValue };
}

export interface ShipContext {
	status: BranchFacts;
	review: OpenBranchReview | null;
	base: string;
	canSettle: boolean;
	settled: boolean;
	removable: boolean;
	reviewActions: boolean;
}

const MERGEABLE_STATES = new Set<ReviewMergeState>(["clean", "unstable", "has_hooks"]);

function commits(count: number): string {
	return `${count} commit${count === 1 ? "" : "s"}`;
}

function remoteValue(status: BranchFacts): RemoteValue {
	if (!status.hasOrigin) return { kind: "noOrigin" };
	if (status.published === null) return { kind: "unreachable" };
	if (!status.published) return { kind: "unpublished" };
	if (status.ahead === undefined || status.behind === undefined) return { kind: "published" };
	if (status.ahead === 0 && status.behind === 0) return { kind: "inSync" };
	return { kind: "counts", ahead: status.ahead, behind: status.behind };
}

function remotePrimary(status: BranchFacts): ShipAction | null {
	if (!status.hasOrigin || status.published === null) return null;
	if (!status.published) {
		return status.aheadOfBase > 0
			? { id: "publish", label: "Publish branch", short: "Publish", tone: "primary" }
			: null;
	}
	const ahead = status.ahead ?? 0;
	if ((status.behind ?? 0) > 0) {
		return { id: "sync", label: "Sync with origin…", short: "Sync…", tone: "warning" };
	}
	return ahead > 0
		? { id: "push", label: `Push ${commits(ahead)}`, short: `Push ${ahead}`, tone: "primary" }
		: null;
}

function finale(context: ShipContext, review: OpenBranchReview, noun: "PR" | "MR"): ShipArm {
	const extra: ShipAction[] = [];
	if (
		context.reviewActions &&
		review.state === "closed" &&
		review.kind === "pull-request" &&
		context.status.provider === "github" &&
		!context.status.onBase
	) {
		extra.push({
			id: "reopen",
			label: `Reopen ${noun} on GitHub`,
			short: "Reopen",
			tone: "neutral",
		});
	}
	if (context.reviewActions && context.status.published && !context.status.onBase) {
		extra.push({
			id: "deleteRemote",
			label: "Delete remote branch…",
			short: "Delete branch",
			tone: "danger",
		});
	}
	const remove: ShipAction[] = context.removable
		? [{ id: "remove", label: "Remove workspace…", short: "Remove", tone: "danger" }]
		: [];
	if (context.settled) {
		return {
			primary: null,
			secondary: [
				{ id: "keepActive", label: "Keep active", short: "Keep active", tone: "neutral" },
				...extra,
				...remove,
			],
		};
	}
	return context.canSettle
		? {
				primary: { id: "settle", label: "Settle workspace", short: "Settle", tone: "primary" },
				secondary: [...extra, ...remove],
			}
		: { primary: null, secondary: [...extra, ...remove] };
}

function openReviewArm(context: ShipContext, review: OpenBranchReview, noun: "PR" | "MR"): ShipArm {
	const { status } = context;
	const details = review.details;
	if (!context.reviewActions || review.kind !== "pull-request" || !details || status.onBase) {
		return { primary: null, secondary: [] };
	}
	const candidates: ShipAction[] = [];
	if ((details.checks?.failing ?? 0) > 0) {
		candidates.push({
			id: "fixChecks",
			label: "Fix with agent",
			short: "Fix checks",
			tone: "warning",
		});
	}
	if (details.draft) {
		candidates.push({ id: "ready", label: "Ready for review", short: "Ready", tone: "primary" });
	} else if (
		MERGEABLE_STATES.has(details.mergeState) &&
		status.ahead === 0 &&
		status.behind === 0
	) {
		candidates.push({
			id: "mergePr",
			label: `Merge ${noun} on GitHub…`,
			short: `Merge ${noun}`,
			tone: "primary",
		});
	}
	const remoteFirst = (status.ahead ?? 0) > 0 || (status.behind ?? 0) > 0;
	if (remoteFirst) return { primary: null, secondary: candidates };
	const [primary = null, ...secondary] = candidates;
	return { primary, secondary };
}

function reviewArm(context: ShipContext, noun: "PR" | "MR"): ShipArm {
	const { status, review } = context;
	if (review)
		return isOpenBranchReview(review)
			? openReviewArm(context, review, noun)
			: finale(context, review, noun);
	if (status.onBase || status.aheadOfBase === 0) return { primary: null, secondary: [] };
	const mergeLocal: ShipAction = {
		id: "mergeLocal",
		label: `Merge into ${context.base} locally`,
		short: `Merge into ${context.base}`,
		tone: "neutral",
		disabled: true,
		hint: "Coming soon",
	};
	if (status.provider === "github") {
		return {
			primary: { id: "openPr", label: `Open ${noun}`, short: `Open ${noun}`, tone: "primary" },
			secondary: [
				{
					id: "openDraftPr",
					label: `Open draft ${noun}`,
					short: `Open draft ${noun}`,
					tone: "neutral",
				},
				mergeLocal,
			],
		};
	}
	if (status.provider === "gitlab") {
		return {
			primary: {
				id: "createMr",
				label: "Create MR on GitLab",
				short: "Create MR",
				tone: "primary",
			},
			secondary: [mergeLocal],
		};
	}
	return { primary: null, secondary: [mergeLocal] };
}

export function shipActions(context: ShipContext): ShipModel {
	const { status, review } = context;
	const noun =
		review?.kind === "merge-request" || (!review && status.provider === "gitlab") ? "MR" : "PR";
	return {
		noun,
		remote: { value: remoteValue(status), primary: remotePrimary(status), secondary: [] },
		review: {
			value: review ? "review" : status.onBase ? "base" : "none",
			...reviewArm(context, noun),
		},
	};
}

export function syncCommand(branch: string, status: BranchFacts | null): string | null {
	if (status?.pushesElsewhere || !isShellInert(branch)) return null;
	return `git pull --rebase origin ${branch}`;
}

export function fixChecksPrompt(review: OpenBranchReview, branch: string, base: string): string {
	const failing = review.details?.checks?.failingNames ?? [];
	return [
		`CI is failing on PR #${review.number} (${branch} → ${base})${failing.length > 0 ? `: ${failing.join(", ")}` : ""}.`,
		`Find out why — \`gh pr checks ${review.number}\` lists the checks and \`gh run view <run-id> --log-failed\` shows a failed run's log. Fix the cause, run the relevant checks locally, commit the fix, and push the branch.`,
	].join("\n\n");
}

export function integratePrompt(branch: string, status: BranchFacts | null): string {
	const behind = status?.behind ?? 0;
	const ahead = status?.ahead ?? 0;
	const remote = status?.pushesElsewhere
		? `The branch \`${branch}\` in origin's push repository (\`git remote get-url --push origin\`)`
		: `\`origin/${branch}\``;
	const missing = `${remote} has ${behind > 0 ? commits(behind) : "commits"} this checkout doesn't`;
	return [
		ahead > 0
			? `${missing}, and the local branch has ${commits(ahead)} it doesn't, so a plain push is rejected.`
			: `${missing} yet.`,
		...(status?.pushesElsewhere
			? ["Origin fetches from a different repository, so don't integrate by pulling from origin."]
			: []),
		"Integrate the remote commits into the local branch — rebase onto them (or merge them) and resolve any conflicts — without force-pushing and without dropping either side's commits. Don't push; I'll push from the topbar once the branch is integrated.",
	].join("\n\n");
}
