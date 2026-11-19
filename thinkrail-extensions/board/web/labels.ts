import type { ThinkingLevel } from "@thinkrail/contracts";
import type { MessageKey } from "@thinkrail/locales";
import type { Translator } from "@thinkrail/locales/react";
import type {
	AgentBadge,
	ArtifactStatus,
	CardType,
	Category,
	GithubFilter,
	GithubProblem,
	InboxReason,
	OpenspecStage,
	Preset,
	Transition,
	WipKey,
	Workflow,
} from "./api";
import type {
	ForecastMiss,
	Health,
	HealthReason,
	Horizon,
	RoadmapChat,
	StackCategory,
} from "./roadmapApi";

const COLUMN_TITLES: Readonly<Record<string, MessageKey>> = {
	triage: "board.column.triage",
	backlog: "board.column.backlog",
	ready: "board.column.ready",
	designing: "board.column.designing",
	building: "board.column.building",
	review: "board.column.review",
	done: "board.column.done",
	canceled: "board.column.canceled",
	todo: "board.column.todo",
	doing: "board.column.doing",
	planning: "board.column.planning",
	"ready-to-apply": "board.column.readyToApply",
	"in-progress": "board.column.inProgress",
	complete: "board.column.complete",
	archived: "board.column.archived",
};

export function columnTitle(t: Translator, column: string): string {
	const key = COLUMN_TITLES[column];
	return key ? t(key) : column;
}

export const TYPE_LABELS = {
	feature: "board.type.feature",
	bug: "board.type.bug",
	chore: "board.type.chore",
} as const satisfies Record<CardType, MessageKey>;

export const PRESET_LABELS = {
	"agentic-kanban": "board.preset.agenticKanban",
	solo: "board.preset.solo",
	"spec-driven": "board.preset.specDriven",
} as const satisfies Record<Preset, MessageKey>;

export const STAGE_LABELS = {
	planning: "board.openspec.stage.planning",
	ready: "board.openspec.stage.ready",
	"in-progress": "board.openspec.stage.inProgress",
	complete: "board.openspec.stage.complete",
	archived: "board.openspec.stage.archived",
} as const satisfies Record<OpenspecStage, MessageKey>;

export const ARTIFACT_STATUS_LABELS = {
	done: "board.openspec.artifact.done",
	ready: "board.openspec.artifact.ready",
	blocked: "board.openspec.artifact.blocked",
	skipped: "board.openspec.artifact.skipped",
} as const satisfies Record<ArtifactStatus, MessageKey>;

const ARTIFACT_NAMES: Readonly<Record<string, MessageKey>> = {
	proposal: "board.openspec.tab.proposal",
	specs: "board.openspec.tab.specs",
	design: "board.openspec.tab.design",
	tasks: "board.openspec.tab.tasks",
};

/** A spec-driven artifact's name (Proposal, Spec deltas, …); a custom schema's artifact shows its id. */
export function artifactName(t: Translator, id: string): string {
	const key = ARTIFACT_NAMES[id];
	return key ? t(key) : id;
}

export const WORKFLOW_LABELS = {
	implement: "board.workflow.implement",
	brainstorm: "board.workflow.brainstorm",
} as const satisfies Record<Workflow, MessageKey>;

export const BADGE_LABELS = {
	working: "board.badge.working",
	waiting: "board.badge.waiting",
	failed: "board.badge.failed",
	finished: "board.badge.finished",
	unread: "board.badge.unread",
} as const satisfies Record<AgentBadge, MessageKey>;

export const ACTOR_LABELS = {
	human: "board.actor.human",
	agent: "board.actor.agent",
	git: "board.actor.git",
	automation: "board.actor.automation",
} as const satisfies Record<Transition["actor"], MessageKey>;

export const EFFORT_LABELS = {
	off: "board.effort.off",
	minimal: "board.effort.minimal",
	low: "board.effort.low",
	medium: "board.effort.medium",
	high: "board.effort.high",
	xhigh: "board.effort.xhigh",
	max: "board.effort.max",
} as const satisfies Record<ThinkingLevel, MessageKey>;

export const WIP_LABELS = {
	needsYou: "board.wip.needsYou",
	review: "board.wip.review",
	agents: "board.wip.agents",
} as const satisfies Record<WipKey, MessageKey>;

const START_WARNINGS = {
	review: "board.wip.startWarningReview",
	needsYou: "board.wip.startWarningNeedsYou",
} as const satisfies Record<"review" | "needsYou", MessageKey>;

/** Start's question past a human-attention limit (`attentionWarning`'s figures). */
export function startWarningText(
	t: Translator,
	warning: { key: "review" | "needsYou"; n: number; limit: number },
): string {
	return t(START_WARNINGS[warning.key], { n: warning.n, limit: warning.limit });
}

const TASK_SPEC_STATUSES: Readonly<Record<string, MessageKey>> = {
	draft: "board.taskSpec.status.draft",
	active: "board.taskSpec.status.active",
	stale: "board.taskSpec.status.stale",
	done: "board.taskSpec.status.done",
	deprecated: "board.taskSpec.status.deprecated",
};

/** A task-spec's status in words; one outside the spec vocabulary shows as written. */
export function taskSpecStatusLabel(t: Translator, status: string | null): string {
	if (status === null) return t("board.taskSpec.status.none");
	const key = TASK_SPEC_STATUSES[status];
	return key ? t(key) : status;
}

export const GITHUB_FILTER_LABELS = {
	open: "board.github.filter.open",
	mine: "board.github.filter.mine",
} as const satisfies Record<GithubFilter, MessageKey>;

export const GITHUB_PROBLEMS = {
	missing: "board.github.problem.missing",
	unauthenticated: "board.github.problem.unauthenticated",
} as const satisfies Record<GithubProblem, MessageKey>;

export const INBOX_REASON_LABELS = {
	needs_you: "board.inbox.reason.needsYou",
	failed: "board.inbox.reason.failed",
} as const satisfies Record<InboxReason, MessageKey>;

export const HORIZON_LABELS = {
	now: "board.roadmap.horizon.now",
	next: "board.roadmap.horizon.next",
	later: "board.roadmap.horizon.later",
} as const satisfies Record<Horizon, MessageKey>;

export const HORIZON_HINTS = {
	now: "board.roadmap.horizon.nowHint",
	next: "board.roadmap.horizon.nextHint",
	later: "board.roadmap.horizon.laterHint",
} as const satisfies Record<Horizon, MessageKey>;

export const HEALTH_LABELS = {
	on_track: "board.roadmap.health.onTrack",
	at_risk: "board.roadmap.health.atRisk",
	off_track: "board.roadmap.health.offTrack",
} as const satisfies Record<Health, MessageKey>;

export const STACK_LABELS = {
	completed: "board.roadmap.progress.done",
	review: "board.roadmap.progress.review",
	started: "board.roadmap.progress.started",
	unstarted: "board.roadmap.progress.ready",
	backlog: "board.roadmap.progress.backlog",
} as const satisfies Record<StackCategory, MessageKey>;

export const FORECAST_MISSES = {
	"no-scope": "board.roadmap.forecast.noScope",
	history: "board.roadmap.forecast.history",
	"no-completions": "board.roadmap.forecast.noCompletions",
} as const satisfies Record<ForecastMiss, MessageKey>;

export const ROADMAP_CHAT_LABELS = {
	plan: "board.roadmap.chat.plan",
	shape: "board.roadmap.chat.shape",
	report: "board.roadmap.chat.report",
	review: "board.roadmap.chat.review",
	close: "board.roadmap.chat.close",
} as const satisfies Record<RoadmapChat, MessageKey>;

/** An ISO day (`YYYY-MM-DD`) in the reader's locale; one that does not parse shows as written. */
export function dayText(iso: string): string {
	const date = new Date(`${iso}T00:00:00Z`);
	return Number.isNaN(date.getTime())
		? iso
		: date.toLocaleDateString(undefined, { timeZone: "UTC", dateStyle: "medium" });
}

/** Why a health was suggested, in words: each reason kind's key with its figures. */
export function healthReasonText(t: Translator, reason: HealthReason): string {
	switch (reason.kind) {
		case "forecast_late":
			return t("board.roadmap.reason.forecastLate", {
				p85: dayText(reason.p85),
				target: dayText(reason.target),
			});
		case "blocked":
			return t("board.roadmap.reason.blocked", { ids: reason.cardIds.join(", ") });
		case "waiting":
			return t("board.roadmap.reason.waiting", { ids: reason.cardIds.join(", ") });
		case "review_wip":
			return t("board.roadmap.reason.reviewWip", { count: reason.count, limit: reason.limit });
		case "failed":
			return t("board.roadmap.reason.failed", { ids: reason.cardIds.join(", ") });
		case "appetite":
			return t("board.roadmap.reason.appetite", { percent: reason.usedPercent });
	}
}

export const CATEGORY_LABELS = {
	triage: "board.roadmap.category.triage",
	backlog: "board.roadmap.category.backlog",
	unstarted: "board.roadmap.category.unstarted",
	started: "board.roadmap.category.started",
	review: "board.roadmap.category.review",
	completed: "board.roadmap.category.completed",
	canceled: "board.roadmap.category.canceled",
} as const satisfies Record<Category, MessageKey>;
