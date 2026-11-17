import type { WireModel } from "./piProtocol";

export const PR_BABYSIT_MODES = ["auto_push", "stage_for_approval"] as const;
export type PrBabysitMode = (typeof PR_BABYSIT_MODES)[number];

export const INDEPENDENT_REVIEW_MODES = [
	"review_and_auto_queue",
	"review_for_approval",
	"post_to_github",
	"off",
] as const;
export type IndependentReviewMode = (typeof INDEPENDENT_REVIEW_MODES)[number];

export const PR_BABYSIT_ITEM_SOURCES = ["github_thread", "ci_check", "independent_review"] as const;
export type PrBabysitItemSource = (typeof PR_BABYSIT_ITEM_SOURCES)[number];

export const PR_BABYSIT_ITEM_STATUSES = [
	"pending_review_approval",
	"queued",
	"working",
	"pushed",
	"needs_human",
	"resolved",
	"dismissed",
] as const;
export type PrBabysitItemStatus = (typeof PR_BABYSIT_ITEM_STATUSES)[number];

export const REVIEW_FINDING_SEVERITIES = ["blocker", "warning", "suggestion"] as const;
export type ReviewFindingSeverity = (typeof REVIEW_FINDING_SEVERITIES)[number];

export const PR_BABYSIT_MAX_PUSH_CYCLES = { min: 1, max: 50, default: 5 } as const;

/** Text the babysitter and reviewer stamp on everything they post, so neither ever answers its own comments. */
export const PR_BABYSIT_MARKER = "[helios-babysit]";
export const PR_REVIEW_MARKER = "[helios-review]";

/** Global defaults (`AppConfig.prBabysit`); a babysit session snapshots them when it starts. */
export interface PrBabysitConfig {
	mode: PrBabysitMode;
	independentReviewMode: IndependentReviewMode;
	autoResolveThreads: boolean;
	fixFailingChecks: boolean;
	maxPushCycles: number;
	/** The model the fixing chat runs on; `null` uses the new-chat default. */
	babysitModel: WireModel | null;
	/** The model the read-only reviewer runs on; `null` uses the plan reviewer's model, then the new-chat default. */
	reviewerModel: WireModel | null;
}

export const DEFAULT_PR_BABYSIT_CONFIG: PrBabysitConfig = {
	mode: "stage_for_approval",
	independentReviewMode: "review_for_approval",
	autoResolveThreads: false,
	fixFailingChecks: true,
	maxPushCycles: PR_BABYSIT_MAX_PUSH_CYCLES.default,
	babysitModel: null,
	reviewerModel: null,
};

function oneOf<T extends string>(values: readonly T[], value: unknown): value is T {
	return typeof value === "string" && (values as readonly string[]).includes(value);
}

export function isPrBabysitMode(value: unknown): value is PrBabysitMode {
	return oneOf(PR_BABYSIT_MODES, value);
}

export function isIndependentReviewMode(value: unknown): value is IndependentReviewMode {
	return oneOf(INDEPENDENT_REVIEW_MODES, value);
}

export function isPrBabysitItemStatus(value: unknown): value is PrBabysitItemStatus {
	return oneOf(PR_BABYSIT_ITEM_STATUSES, value);
}

export function isReviewFindingSeverity(value: unknown): value is ReviewFindingSeverity {
	return oneOf(REVIEW_FINDING_SEVERITIES, value);
}

export function isMaxPushCycles(value: unknown): value is number {
	return (
		typeof value === "number" &&
		Number.isInteger(value) &&
		value >= PR_BABYSIT_MAX_PUSH_CYCLES.min &&
		value <= PR_BABYSIT_MAX_PUSH_CYCLES.max
	);
}

function isModelRef(value: unknown): value is WireModel {
	if (!value || typeof value !== "object" || Array.isArray(value)) return false;
	const { provider, id } = value as { provider?: unknown; id?: unknown };
	return typeof provider === "string" && provider !== "" && typeof id === "string" && id !== "";
}

/** Each field independently: a malformed one falls back to its own default. */
export function normalizePrBabysitConfig(value: unknown): PrBabysitConfig {
	const record =
		value && typeof value === "object" && !Array.isArray(value)
			? (value as Record<string, unknown>)
			: {};
	const d = DEFAULT_PR_BABYSIT_CONFIG;
	return {
		mode: isPrBabysitMode(record.mode) ? record.mode : d.mode,
		independentReviewMode: isIndependentReviewMode(record.independentReviewMode)
			? record.independentReviewMode
			: d.independentReviewMode,
		autoResolveThreads:
			typeof record.autoResolveThreads === "boolean"
				? record.autoResolveThreads
				: d.autoResolveThreads,
		fixFailingChecks:
			typeof record.fixFailingChecks === "boolean" ? record.fixFailingChecks : d.fixFailingChecks,
		maxPushCycles: isMaxPushCycles(record.maxPushCycles) ? record.maxPushCycles : d.maxPushCycles,
		babysitModel: isModelRef(record.babysitModel) ? record.babysitModel : null,
		reviewerModel: isModelRef(record.reviewerModel) ? record.reviewerModel : null,
	};
}

/** A strict check for a `settings.update` / `prBabysit.start` patch: every present key must be valid. */
export function prBabysitConfigPatchProblem(value: unknown): string | null {
	if (!value || typeof value !== "object" || Array.isArray(value)) return "must be an object";
	const record = value as Record<string, unknown>;
	const known: Record<keyof PrBabysitConfig, (v: unknown) => boolean> = {
		mode: isPrBabysitMode,
		independentReviewMode: isIndependentReviewMode,
		autoResolveThreads: (v) => typeof v === "boolean",
		fixFailingChecks: (v) => typeof v === "boolean",
		maxPushCycles: isMaxPushCycles,
		babysitModel: (v) => v === null || isModelRef(v),
		reviewerModel: (v) => v === null || isModelRef(v),
	};
	for (const [key, field] of Object.entries(record)) {
		const check = Object.hasOwn(known, key) ? known[key as keyof PrBabysitConfig] : undefined;
		if (!check) return `has an unknown field ${key}`;
		if (!check(field)) return `has an invalid ${key}`;
	}
	return null;
}

export type PrBabysitItemType = "review_thread" | "check_run" | "finding";

export interface PrBabysitItem {
	itemId: string;
	source: PrBabysitItemSource;
	itemType: PrBabysitItemType;
	/** GitHub review thread node id (`github_thread`). */
	threadId?: string;
	/** The newest handled comment's REST id; a newer comment on the thread re-queues it. */
	lastCommentId?: number;
	path?: string;
	line?: number;
	severity?: ReviewFindingSeverity;
	author?: string;
	summary: string;
	suggestedFix?: string;
	/** Check run / comment URL on GitHub. */
	detailsUrl?: string;
	status: PrBabysitItemStatus;
	/** The fix commit (pushed or staged). */
	commitSha?: string;
	errorMessage?: string;
	/** `provider/id` of the reviewer that filed an `independent_review` finding. */
	reviewerModel?: string;
	/** The PR head this finding was filed against. */
	headOid?: string;
	/** An `independent_review` finding the user (or `post_to_github`) posted to the PR. */
	postedToGithub?: boolean;
	updatedAt: number;
}

export type PrBabysitSessionStatus =
	| "watching"
	| "reviewing"
	| "fixing"
	| "needs_human"
	| "stopped"
	| "merged"
	| "closed"
	| "error";

export type PrCheckState = "pending" | "success" | "failure";

export interface PrBabysitSessionState {
	workspaceId: string;
	owner: string;
	repo: string;
	prNumber: number;
	headRefName: string;
	baseRefName: string;
	headOid?: string;
	prUrl?: string;
	active: boolean;
	status: PrBabysitSessionStatus;
	config: PrBabysitConfig;
	lastReviewedOid?: string;
	/** Autonomous pushes so far; reaching `config.maxPushCycles` stops pushing and asks for a human. */
	cycleCount: number;
	/** The workspace chat the fixer runs in (and the reviewer's parent). */
	babysitSessionId?: string;
	viewerLogin?: string;
	checks?: PrCheckState;
	reviewing: boolean;
	error?: string;
	items: PrBabysitItem[];
	updatedAt: number;
}

export type PrBabysitEventKind =
	| "reviewer_started"
	| "reviewer_finished"
	| "finding_created"
	| "item_working"
	| "item_pushed"
	| "needs_human"
	| "state_changed"
	| "stopped";

/** `prBabysit.changed` push: what happened plus the whole session state after it (`null` once forgotten). */
export interface PrBabysitEvent {
	workspaceId: string;
	kind: PrBabysitEventKind;
	itemId?: string;
	state: PrBabysitSessionState | null;
}

export type PrBabysitItemAction = "retry" | "dismiss";
