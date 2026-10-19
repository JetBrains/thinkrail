import type { OpenBranchReview } from "@thinkrail/contracts";
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
}

function commits(count: number): string {
	return `${count} commit${count === 1 ? "" : "s"}`;
}

function remoteValue(status: BranchFacts): RemoteValue {
	if (!status.hasOrigin) return { kind: "noOrigin" };
	if (!status.published) return { kind: "unpublished" };
	if (status.ahead === undefined || status.behind === undefined) return { kind: "published" };
	if (status.ahead === 0 && status.behind === 0) return { kind: "inSync" };
	return { kind: "counts", ahead: status.ahead, behind: status.behind };
}

function remotePrimary(status: BranchFacts): ShipAction | null {
	if (!status.hasOrigin) return null;
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

function finale(context: ShipContext): ShipArm {
	const remove: ShipAction[] = context.removable
		? [{ id: "remove", label: "Remove workspace…", short: "Remove", tone: "danger" }]
		: [];
	if (context.settled) {
		return {
			primary: null,
			secondary: [
				{ id: "keepActive", label: "Keep active", short: "Keep active", tone: "neutral" },
				...remove,
			],
		};
	}
	return context.canSettle
		? {
				primary: { id: "settle", label: "Settle workspace", short: "Settle", tone: "primary" },
				secondary: remove,
			}
		: { primary: null, secondary: remove };
}

function reviewArm(context: ShipContext, noun: "PR" | "MR"): ShipArm {
	const { status, review } = context;
	if (review)
		return isOpenBranchReview(review) ? { primary: null, secondary: [] } : finale(context);
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
