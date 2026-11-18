import type { Activity, FlowOutcome, FlowState } from "@thinkrail/pi-session-insights/core";

interface Look {
	bg: string;
	fill: string;
	stroke: string;
	text: string;
}

/** Activities on the categorical series: runs share the shell series, plans and specs the planning one. */
export const ACTIVITY_LOOK = {
	search: {
		bg: "bg-series-1",
		fill: "fill-series-1",
		stroke: "stroke-series-1",
		text: "text-series-1",
	},
	read: {
		bg: "bg-series-5",
		fill: "fill-series-5",
		stroke: "stroke-series-5",
		text: "text-series-5",
	},
	edit: {
		bg: "bg-series-2",
		fill: "fill-series-2",
		stroke: "stroke-series-2",
		text: "text-series-2",
	},
	test: {
		bg: "bg-series-4",
		fill: "fill-series-4",
		stroke: "stroke-series-4",
		text: "text-series-4",
	},
	build: {
		bg: "bg-series-4",
		fill: "fill-series-4",
		stroke: "stroke-series-4",
		text: "text-series-4",
	},
	lint: {
		bg: "bg-series-4",
		fill: "fill-series-4",
		stroke: "stroke-series-4",
		text: "text-series-4",
	},
	git: {
		bg: "bg-series-4",
		fill: "fill-series-4",
		stroke: "stroke-series-4",
		text: "text-series-4",
	},
	run: {
		bg: "bg-series-4",
		fill: "fill-series-4",
		stroke: "stroke-series-4",
		text: "text-series-4",
	},
	plan: {
		bg: "bg-series-7",
		fill: "fill-series-7",
		stroke: "stroke-series-7",
		text: "text-series-7",
	},
	specs: {
		bg: "bg-series-7",
		fill: "fill-series-7",
		stroke: "stroke-series-7",
		text: "text-series-7",
	},
	subagent: {
		bg: "bg-series-6",
		fill: "fill-series-6",
		stroke: "stroke-series-6",
		text: "text-series-6",
	},
	ask: { bg: "bg-primary", fill: "fill-primary", stroke: "stroke-primary", text: "text-primary" },
	web: {
		bg: "bg-series-1",
		fill: "fill-series-1",
		stroke: "stroke-series-1",
		text: "text-series-1",
	},
	skill: {
		bg: "bg-series-3",
		fill: "fill-series-3",
		stroke: "stroke-series-3",
		text: "text-series-3",
	},
	mcp: {
		bg: "bg-series-8",
		fill: "fill-series-8",
		stroke: "stroke-series-8",
		text: "text-series-8",
	},
	other: {
		bg: "bg-series-8",
		fill: "fill-series-8",
		stroke: "stroke-series-8",
		text: "text-series-8",
	},
} as const satisfies Record<Activity, Look>;

/** A process-map node's frame in its activity's colour. */
export const ACTIVITY_BORDER = {
	search: "border-series-1",
	read: "border-series-5",
	edit: "border-series-2",
	test: "border-series-4",
	build: "border-series-4",
	lint: "border-series-4",
	git: "border-series-4",
	run: "border-series-4",
	plan: "border-series-7",
	specs: "border-series-7",
	subagent: "border-series-6",
	ask: "border-primary",
	web: "border-series-1",
	skill: "border-series-3",
	mcp: "border-series-8",
	other: "border-series-8",
} as const satisfies Record<Activity, string>;

/** What follows a failure: recovery in the success colour, failures in the error colour. */
export const STATE_LOOK = {
	recovered: { fill: "fill-feedback-success", stroke: "stroke-feedback-success" },
	repeatFailed: { fill: "fill-feedback-error", stroke: "stroke-feedback-error" },
	look: { fill: "fill-series-5", stroke: "stroke-series-5" },
	edit: { fill: "fill-series-2", stroke: "stroke-series-2" },
	run: { fill: "fill-series-4", stroke: "stroke-series-4" },
	otherError: { fill: "fill-feedback-error-muted", stroke: "stroke-feedback-error" },
	other: { fill: "fill-series-8", stroke: "stroke-series-8" },
	end: { fill: "fill-text-subtle", stroke: "stroke-text-subtle" },
} as const satisfies Record<FlowState, { fill: string; stroke: string }>;

export const OUTCOME_LOOK = {
	recovered: { fill: "fill-feedback-success", bg: "bg-feedback-success" },
	later: { fill: "fill-feedback-info", bg: "bg-feedback-info" },
	never: { fill: "fill-feedback-warning", bg: "bg-feedback-warning" },
	ended: { fill: "fill-text-subtle", bg: "bg-text-subtle" },
} as const satisfies Record<FlowOutcome, { fill: string; bg: string }>;
