import type { ExtensionContext } from "@earendil-works/pi-coding-agent";
import type { ThinkingLevel } from "@thinkrail/contracts";

export type AgentParent = string | Pick<ExtensionContext, "sessionManager">;

export interface AgentSpec {
	task: string;
	role?: string;
	systemPrompt?: string;
	tools?: string[];
	excludeTools?: string[];
	model?: { provider: string; id: string };
	thinkingLevel?: ThinkingLevel;
	contextFiles?: boolean;
	skills?: string[];
	extensions?: boolean;
	maxTurns?: number;
}

export interface AgentSpawnOptions {
	parent: AgentParent;
	signal?: AbortSignal | undefined;
	maxConcurrent?: number;
}

export type AgentRunStatus = "completed" | "error" | "aborted";
export type AgentStatus = "queued" | "running" | AgentRunStatus;

export interface AgentUsage {
	input: number;
	output: number;
	cacheRead: number;
	cacheWrite: number;
	cost: number;
	turns: number;
	contextTokens: number;
}

export interface AgentProgress {
	status: AgentStatus;
	model?: string;
	usage: AgentUsage;
	durationMs: number;
	activity?: string;
}

export interface AgentResult extends Omit<AgentProgress, "status" | "activity"> {
	status: AgentRunStatus;
	finalText?: string;
	errorMessage?: string;
}

interface AgentEventBase {
	agentId: string;
	parentSessionId: string;
	role?: string;
}

export type AgentEvent = AgentEventBase &
	(
		| { type: "queued" | "started" }
		| { type: "progress"; progress: AgentProgress }
		| { type: "settled"; result: AgentResult }
	);

export interface AgentHandle {
	readonly id: string;
	readonly parentSessionId: string;
	readonly status: AgentStatus;
	readonly progress: AgentProgress | undefined;
	readonly result: Promise<AgentResult>;
	cancel(): Promise<AgentResult>;
	onEvent(fn: (event: AgentEvent) => void): () => void;
}

export interface TrAgents {
	spawn(spec: AgentSpec, options: AgentSpawnOptions): Promise<AgentHandle>;
	run(spec: AgentSpec, options: AgentSpawnOptions): Promise<AgentResult>;
	list(): AgentHandle[];
	onEvent(fn: (event: AgentEvent) => void): () => void;
}
