import type { AgentUsage } from "@thinkrail/ext";

export const EXT_NAME = "ultracode";
export const TOOL_NAME = "Ultracode";
export const RUNS_KEY = "runs";
export const RUN_PREFIX = "run:";

export const runKey = (runId: string) => `${RUN_PREFIX}${runId}`;

export type RunStatus = "running" | "completed" | "failed" | "aborted";
export type AgentState = "queued" | "running" | "done" | "failed" | "aborted";

export type Usage = Omit<AgentUsage, "contextTokens">;

export interface PhaseRow {
	index: number;
	title: string;
	detail?: string;
}

export interface AgentRow {
	index: number;
	label: string;
	phaseIndex: number;
	state: AgentState;
	attempt: number;
	queuedAt: number;
	prompt: string;
	usage: Usage;
	childId?: string;
	model?: string;
	startedAt?: number;
	endedAt?: number;
	activity?: string;
	output?: string;
	result?: unknown;
	error?: string;
	replayed?: boolean;
}

export interface Limits {
	concurrency: number;
	maxAgents: number;
	maxCost?: number;
	agentTimeoutMs?: number;
}

export interface WorkflowRun {
	runId: string;
	name: string;
	description: string;
	status: RunStatus;
	parentSessionId: string;
	startedAt: number;
	endedAt?: number;
	phases: PhaseRow[];
	agents: AgentRow[];
	logs: string[];
	limits: Limits;
	args?: unknown;
	result?: unknown;
	error?: string;
	resumedFrom?: string;
}

export interface Counts {
	total: number;
	queued: number;
	running: number;
	done: number;
	failed: number;
	aborted: number;
	replayed: number;
}

export interface RunSummary {
	runId: string;
	name: string;
	status: RunStatus;
	parentSessionId: string;
	startedAt: number;
	endedAt?: number;
	phase?: string;
	counts: Counts;
	cost: number;
	maxCost?: number;
}

export const emptyUsage = (): Usage => ({
	input: 0,
	output: 0,
	cacheRead: 0,
	cacheWrite: 0,
	cost: 0,
	turns: 0,
});

export const addUsage = (a: Usage, b: Usage): Usage => ({
	input: a.input + b.input,
	output: a.output + b.output,
	cacheRead: a.cacheRead + b.cacheRead,
	cacheWrite: a.cacheWrite + b.cacheWrite,
	cost: a.cost + b.cost,
	turns: a.turns + b.turns,
});

export const tokensOf = (usage: Usage) =>
	usage.input + usage.output + usage.cacheRead + usage.cacheWrite;

export const runUsage = (run: Pick<WorkflowRun, "agents">) =>
	run.agents.reduce(
		(sum, agent) => (agent.replayed ? sum : addUsage(sum, agent.usage)),
		emptyUsage(),
	);

export const countAgents = (agents: readonly AgentRow[]): Counts => {
	const counts: Counts = {
		total: agents.length,
		queued: 0,
		running: 0,
		done: 0,
		failed: 0,
		aborted: 0,
		replayed: 0,
	};
	for (const agent of agents) {
		counts[agent.state] += 1;
		if (agent.replayed) counts.replayed += 1;
	}
	return counts;
};

export const currentPhase = (run: Pick<WorkflowRun, "phases" | "agents">) => {
	const active = run.agents.findLast(
		(agent) => agent.state === "running" || agent.state === "queued",
	);
	const index = active?.phaseIndex ?? run.phases.at(-1)?.index;
	return run.phases.find((phase) => phase.index === index)?.title;
};

export const summarize = (run: WorkflowRun): RunSummary => {
	const phase = currentPhase(run);
	return {
		runId: run.runId,
		name: run.name,
		status: run.status,
		parentSessionId: run.parentSessionId,
		startedAt: run.startedAt,
		...(run.endedAt !== undefined ? { endedAt: run.endedAt } : {}),
		...(phase !== undefined ? { phase } : {}),
		counts: countAgents(run.agents),
		cost: runUsage(run).cost,
		...(run.limits.maxCost !== undefined ? { maxCost: run.limits.maxCost } : {}),
	};
};

export const formatCost = (cost: number) =>
	cost === 0 ? "$0" : cost < 0.01 ? `$${cost.toFixed(4)}` : `$${cost.toFixed(2)}`;

export const formatTokens = (tokens: number) =>
	tokens < 1_000
		? String(tokens)
		: tokens < 1_000_000
			? `${Math.round(tokens / 1_000)}k`
			: `${(tokens / 1_000_000).toFixed(1)}M`;

export const formatDuration = (ms: number) => {
	const seconds = Math.max(0, Math.round(ms / 1_000));
	if (seconds < 60) return `${seconds}s`;
	const minutes = Math.floor(seconds / 60);
	return minutes < 60
		? `${minutes}m ${seconds % 60}s`
		: `${Math.floor(minutes / 60)}h ${minutes % 60}m`;
};

export const clip = (text: string, max: number) =>
	text.length > max ? `${text.slice(0, max - 1)}…` : text;

export const clipTail = (text: string, max: number) =>
	text.length > max ? `…${text.slice(text.length - max + 1)}` : text;

export const isRecord = (value: unknown): value is Record<string, unknown> =>
	typeof value === "object" && value !== null && !Array.isArray(value);

const RUN_STATUSES: readonly string[] = ["running", "completed", "failed", "aborted"];

export const isWorkflowRun = (value: unknown): value is WorkflowRun =>
	isRecord(value) &&
	typeof value.runId === "string" &&
	typeof value.name === "string" &&
	typeof value.status === "string" &&
	RUN_STATUSES.includes(value.status) &&
	Array.isArray(value.phases) &&
	Array.isArray(value.agents);

export const isRunSummary = (value: unknown): value is RunSummary =>
	isRecord(value) &&
	typeof value.runId === "string" &&
	typeof value.name === "string" &&
	typeof value.status === "string" &&
	RUN_STATUSES.includes(value.status) &&
	isRecord(value.counts) &&
	typeof value.cost === "number";
