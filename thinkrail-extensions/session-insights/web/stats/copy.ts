import type { MessageKey } from "@thinkrail/locales";
import type {
	Activity,
	CompareMetricId,
	CompareStat,
	CompareVerdict,
	ExitMeaning,
	FindingGroup,
	FindingRule,
	FindingSeverity,
	FlowOutcome,
	FlowState,
	HotspotAction,
	HotspotSort,
	MissCause,
	SliceBy,
	UsageMarkerKind,
} from "@thinkrail/pi-session-insights/core";
import type { InsightsSection } from "../listIntent";

export const SECTION_LABEL = {
	findings: "sessionInsights.stats.section.findings",
	usage: "sessionInsights.stats.section.usage",
	hotspots: "sessionInsights.stats.section.hotspots",
	sequences: "sessionInsights.stats.section.sequences",
	ab: "sessionInsights.stats.section.ab",
} as const satisfies Record<InsightsSection, MessageKey>;

export const ACTIVITY_LABEL = {
	search: "sessionInsights.activity.search",
	read: "sessionInsights.activity.read",
	edit: "sessionInsights.activity.edit",
	test: "sessionInsights.activity.test",
	build: "sessionInsights.activity.build",
	lint: "sessionInsights.activity.lint",
	git: "sessionInsights.activity.git",
	run: "sessionInsights.activity.run",
	plan: "sessionInsights.activity.plan",
	specs: "sessionInsights.activity.specs",
	subagent: "sessionInsights.activity.subagent",
	ask: "sessionInsights.activity.ask",
	web: "sessionInsights.activity.web",
	skill: "sessionInsights.activity.skill",
	mcp: "sessionInsights.activity.mcp",
	other: "sessionInsights.activity.other",
} as const satisfies Record<Activity, MessageKey>;

export const FLOW_STATE_LABEL = {
	recovered: "sessionInsights.sequences.state.recovered",
	repeatFailed: "sessionInsights.sequences.state.repeatFailed",
	notRun: "sessionInsights.sequences.state.notRun",
	look: "sessionInsights.sequences.state.look",
	edit: "sessionInsights.sequences.state.edit",
	run: "sessionInsights.sequences.state.run",
	otherError: "sessionInsights.sequences.state.otherError",
	other: "sessionInsights.sequences.state.other",
	end: "sessionInsights.sequences.state.end",
} as const satisfies Record<FlowState, MessageKey>;

export const FLOW_OUTCOME_LABEL = {
	recovered: "sessionInsights.sequences.outcome.recovered",
	later: "sessionInsights.sequences.outcome.later",
	never: "sessionInsights.sequences.outcome.never",
	ended: "sessionInsights.sequences.outcome.ended",
} as const satisfies Record<FlowOutcome, MessageKey>;

export const FLOW_OUTCOME_SHORT = {
	recovered: "sessionInsights.sequences.outcomeShort.recovered",
	later: "sessionInsights.sequences.outcomeShort.later",
	never: "sessionInsights.sequences.outcomeShort.never",
	ended: "sessionInsights.sequences.outcomeShort.ended",
} as const satisfies Record<FlowOutcome, MessageKey>;

export const COMPARE_METRIC_LABEL = {
	sessions: "sessionInsights.slices.metric.sessions",
	failedShare: "sessionInsights.slices.metric.failedShare",
	toolCalls: "sessionInsights.slices.metric.toolCalls",
	turns: "sessionInsights.slices.metric.turns",
	tokens: "sessionInsights.slices.metric.tokens",
	cost: "sessionInsights.slices.metric.cost",
	activeTime: "sessionInsights.slices.metric.activeTime",
	retries: "sessionInsights.slices.metric.retries",
	contextPeak: "sessionInsights.slices.metric.contextPeak",
} as const satisfies Record<CompareMetricId, MessageKey>;

export const COMPARE_STAT_LABEL = {
	count: "sessionInsights.slices.stat.count",
	ratio: "sessionInsights.slices.stat.ratio",
	median: "sessionInsights.slices.stat.median",
	mean: "sessionInsights.slices.stat.mean",
} as const satisfies Record<CompareStat, MessageKey>;

export const VERDICT_LABEL = {
	none: "sessionInsights.slices.verdict.none",
	better: "sessionInsights.slices.verdict.better",
	worse: "sessionInsights.slices.verdict.worse",
	higher: "sessionInsights.slices.verdict.higher",
	lower: "sessionInsights.slices.verdict.lower",
	same: "sessionInsights.slices.verdict.same",
	noData: "sessionInsights.slices.verdict.noData",
	tooFew: "sessionInsights.slices.verdict.tooFew",
} as const satisfies Record<CompareVerdict, MessageKey>;

export const SLICE_BY_LABEL = {
	model: "sessionInsights.slices.by.model",
	period: "sessionInsights.slices.by.period",
	project: "sessionInsights.slices.by.project",
	label: "sessionInsights.slices.by.label",
	filter: "sessionInsights.slices.by.filter",
} as const satisfies Record<SliceBy, MessageKey>;

export const GROUP_LABEL = {
	skills: "sessionInsights.findings.group.skills",
	commands: "sessionInsights.findings.group.commands",
	context: "sessionInsights.findings.group.context",
	files: "sessionInsights.findings.group.files",
} as const satisfies Record<FindingGroup, MessageKey>;

export const GROUP_NOTE = {
	skills: "sessionInsights.findings.groupNote.skills",
	commands: "sessionInsights.findings.groupNote.commands",
	context: "sessionInsights.findings.groupNote.context",
	files: "sessionInsights.findings.groupNote.files",
} as const satisfies Record<FindingGroup, MessageKey>;

export const SEVERITY_LABEL = {
	error: "sessionInsights.findings.severity.error",
	warning: "sessionInsights.findings.severity.warning",
	info: "sessionInsights.findings.severity.info",
} as const satisfies Record<FindingSeverity, MessageKey>;

export const RULE_TITLE = {
	skillNeverLoaded: "sessionInsights.findings.rule.skillNeverLoaded.title",
	skillUnlisted: "sessionInsights.findings.rule.skillUnlisted.title",
	commandFailing: "sessionInsights.findings.rule.commandFailing.title",
	falseError: "sessionInsights.findings.rule.falseError.title",
	loop: "sessionInsights.findings.rule.loop.title",
	poorRecovery: "sessionInsights.findings.rule.poorRecovery.title",
	oversizedOutput: "sessionInsights.findings.rule.oversizedOutput.title",
	contextLimit: "sessionInsights.findings.rule.contextLimit.title",
	cacheMisses: "sessionInsights.findings.rule.cacheMisses.title",
	costOutlier: "sessionInsights.findings.rule.costOutlier.title",
	tokenOutlier: "sessionInsights.findings.rule.tokenOutlier.title",
	subagentsOutside: "sessionInsights.findings.rule.subagentsOutside.title",
	rework: "sessionInsights.findings.rule.rework.title",
	repeatedInstruction: "sessionInsights.findings.rule.repeatedInstruction.title",
	unverifiedClaim: "sessionInsights.findings.rule.unverifiedClaim.title",
} as const satisfies Record<FindingRule, MessageKey>;

export const RULE_WHY = {
	skillNeverLoaded: "sessionInsights.findings.rule.skillNeverLoaded.why",
	skillUnlisted: "sessionInsights.findings.rule.skillUnlisted.why",
	commandFailing: "sessionInsights.findings.rule.commandFailing.why",
	falseError: "sessionInsights.findings.rule.falseError.why",
	loop: "sessionInsights.findings.rule.loop.why",
	poorRecovery: "sessionInsights.findings.rule.poorRecovery.why",
	oversizedOutput: "sessionInsights.findings.rule.oversizedOutput.why",
	contextLimit: "sessionInsights.findings.rule.contextLimit.why",
	cacheMisses: "sessionInsights.findings.rule.cacheMisses.why",
	costOutlier: "sessionInsights.findings.rule.costOutlier.why",
	tokenOutlier: "sessionInsights.findings.rule.tokenOutlier.why",
	subagentsOutside: "sessionInsights.findings.rule.subagentsOutside.why",
	rework: "sessionInsights.findings.rule.rework.why",
	repeatedInstruction: "sessionInsights.findings.rule.repeatedInstruction.why",
	unverifiedClaim: "sessionInsights.findings.rule.unverifiedClaim.why",
} as const satisfies Record<FindingRule, MessageKey>;

export const RULE_ACTION = {
	skillNeverLoaded: "sessionInsights.findings.rule.skillNeverLoaded.action",
	skillUnlisted: "sessionInsights.findings.rule.skillUnlisted.action",
	commandFailing: "sessionInsights.findings.rule.commandFailing.action",
	falseError: "sessionInsights.findings.rule.falseError.action",
	loop: "sessionInsights.findings.rule.loop.action",
	poorRecovery: "sessionInsights.findings.rule.poorRecovery.action",
	oversizedOutput: "sessionInsights.findings.rule.oversizedOutput.action",
	contextLimit: "sessionInsights.findings.rule.contextLimit.action",
	cacheMisses: "sessionInsights.findings.rule.cacheMisses.action",
	costOutlier: "sessionInsights.findings.rule.costOutlier.action",
	tokenOutlier: "sessionInsights.findings.rule.tokenOutlier.action",
	subagentsOutside: "sessionInsights.findings.rule.subagentsOutside.action",
	rework: "sessionInsights.findings.rule.rework.action",
	repeatedInstruction: "sessionInsights.findings.rule.repeatedInstruction.action",
	unverifiedClaim: "sessionInsights.findings.rule.unverifiedClaim.action",
} as const satisfies Record<FindingRule, MessageKey>;

/** A draft line shown as a labelled template; `null` where the rule suggests no text. */
export const RULE_TEMPLATE = {
	skillNeverLoaded: "sessionInsights.findings.rule.skillNeverLoaded.template",
	skillUnlisted: "sessionInsights.findings.rule.skillUnlisted.template",
	commandFailing: null,
	falseError: null,
	loop: null,
	poorRecovery: null,
	oversizedOutput: "sessionInsights.findings.rule.oversizedOutput.template",
	contextLimit: "sessionInsights.findings.rule.contextLimit.template",
	cacheMisses: null,
	costOutlier: null,
	tokenOutlier: null,
	subagentsOutside: null,
	rework: "sessionInsights.findings.rule.rework.template",
	repeatedInstruction: "sessionInsights.findings.rule.repeatedInstruction.template",
	unverifiedClaim: "sessionInsights.findings.rule.unverifiedClaim.template",
} as const satisfies Record<FindingRule, MessageKey | null>;

export const EXIT_MEANING = {
	checksPending: "sessionInsights.findings.exit.checksPending",
	noMatch: "sessionInsights.findings.exit.noMatch",
	differences: "sessionInsights.findings.exit.differences",
	conditionFalse: "sessionInsights.findings.exit.conditionFalse",
} as const satisfies Record<ExitMeaning, MessageKey>;

export const EXIT_TEMPLATE = {
	checksPending: "sessionInsights.findings.exitTemplate.checksPending",
	noMatch: "sessionInsights.findings.exitTemplate.noMatch",
	differences: "sessionInsights.findings.exitTemplate.differences",
	conditionFalse: "sessionInsights.findings.exitTemplate.conditionFalse",
} as const satisfies Record<ExitMeaning, MessageKey>;

export const MISS_CAUSE_LABEL = {
	modelChange: "sessionInsights.context.cause.modelChange",
	modelReselected: "sessionInsights.context.cause.modelReselected",
	systemPrompt: "sessionInsights.context.cause.systemPrompt",
	tools: "sessionInsights.context.cause.tools",
	compaction: "sessionInsights.context.cause.compaction",
	contextEdit: "sessionInsights.context.cause.contextEdit",
	thinkingLevel: "sessionInsights.context.cause.thinkingLevel",
	pause: "sessionInsights.context.cause.pause",
	none: "sessionInsights.context.cause.unexplained",
} as const satisfies Record<MissCause | "none", MessageKey>;

export const ACTION_LABEL = {
	spec: "sessionInsights.hotspots.action.spec",
	test: "sessionInsights.hotspots.action.test",
	plan: "sessionInsights.hotspots.action.plan",
	template: "sessionInsights.hotspots.action.template",
	split: "sessionInsights.hotspots.action.split",
	hub: "sessionInsights.hotspots.action.hub",
	upfront: "sessionInsights.hotspots.action.upfront",
	review: "sessionInsights.hotspots.action.review",
	none: "sessionInsights.hotspots.action.none",
} as const satisfies Record<HotspotAction, MessageKey>;

export const ACTION_STEPS = {
	spec: ["sessionInsights.hotspots.step.specCompare", "sessionInsights.hotspots.step.specDecision"],
	test: ["sessionInsights.hotspots.step.testWhy", "sessionInsights.hotspots.step.testDescribe"],
	plan: ["sessionInsights.hotspots.step.planUpfront"],
	template: ["sessionInsights.hotspots.step.template"],
	split: [
		"sessionInsights.hotspots.step.splitSteps",
		"sessionInsights.hotspots.step.splitDescribe",
	],
	hub: ["sessionInsights.hotspots.step.hub"],
	upfront: ["sessionInsights.hotspots.step.upfront"],
	review: ["sessionInsights.hotspots.step.review"],
	none: [],
} as const satisfies Record<HotspotAction, readonly MessageKey[]>;

export const SORT_LABEL = {
	touches: "sessionInsights.hotspots.sort.touches",
	changes: "sessionInsights.hotspots.sort.changes",
	sessions: "sessionInsights.hotspots.sort.sessions",
} as const satisfies Record<HotspotSort, MessageKey>;

export const MARKER_LABEL = {
	unpricedModel: "sessionInsights.usage.marker.unpricedModel",
	costStopped: "sessionInsights.usage.marker.costStopped",
	subagentSpend: "sessionInsights.usage.marker.subagentSpend",
} as const satisfies Record<UsageMarkerKind, MessageKey>;

export const MARKER_NOTE = {
	unpricedModel: "sessionInsights.usage.markerNote.unpricedModel",
	costStopped: "sessionInsights.usage.markerNote.costStopped",
	subagentSpend: "sessionInsights.usage.markerNote.subagentSpend",
} as const satisfies Record<UsageMarkerKind, MessageKey>;

export const ACTION_RULE = {
	spec: "sessionInsights.hotspots.rule.spec",
	test: "sessionInsights.hotspots.rule.test",
	plan: "sessionInsights.hotspots.rule.plan",
	template: "sessionInsights.hotspots.rule.template",
	split: "sessionInsights.hotspots.rule.split",
	hub: "sessionInsights.hotspots.rule.hub",
	upfront: "sessionInsights.hotspots.rule.upfront",
	review: "sessionInsights.hotspots.rule.review",
	none: "sessionInsights.hotspots.rule.none",
} as const satisfies Record<HotspotAction, MessageKey>;

export const ACTION_SIGNAL = {
	spec: "sessionInsights.hotspots.signal.spec",
	test: "sessionInsights.hotspots.signal.test",
	plan: "sessionInsights.hotspots.signal.plan",
	template: "sessionInsights.hotspots.signal.template",
	split: "sessionInsights.hotspots.signal.split",
	hub: "sessionInsights.hotspots.signal.hub",
	review: "sessionInsights.hotspots.signal.review",
} as const satisfies Record<Exclude<HotspotAction, "upfront" | "none">, MessageKey>;
