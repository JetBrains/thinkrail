import type { ThinkingLevel } from "@thinkrail/contracts";
import type { MessageKey } from "@thinkrail/locales";
import type { Translator } from "@thinkrail/locales/react";
import type {
	AgentBadge,
	CardType,
	GithubFilter,
	GithubProblem,
	InboxReason,
	Preset,
	Transition,
	WipKey,
	Workflow,
} from "./api";

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
} as const satisfies Record<Preset, MessageKey>;

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
