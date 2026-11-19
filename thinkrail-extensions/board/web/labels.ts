import type { ThinkingLevel } from "@thinkrail/contracts";
import type { MessageKey } from "@thinkrail/locales";
import type { Translator } from "@thinkrail/locales/react";
import type { AgentBadge, CardType, Preset, Transition, Workflow } from "./api";

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
