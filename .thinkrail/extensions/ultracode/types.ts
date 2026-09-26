import type { PipelineStage } from "./parallel";

export type JsonSchema = Record<string, unknown>;

export type Effort = "off" | "minimal" | "low" | "medium" | "high" | "xhigh";

export interface AgentOptions {
	label?: string;
	phase?: string;
	schema?: JsonSchema;
	model?: string;
	effort?: Effort;
	tools?: string[] | string | boolean;
	system?: string;
	agentType?: string;
	maxTurns?: number;
}

export interface UltracodeMeta {
	name: string;
	description: string;
	phases?: Array<{ title: string; detail?: string }>;
}

export interface UltracodeRuntimeApi {
	agent: (prompt: string, options?: AgentOptions) => Promise<unknown>;
	parallel: <T>(
		tasks: Array<() => Promise<T>>,
		opts?: { failFast?: boolean },
	) => Promise<Array<T | null>>;
	pipeline: <T>(items: readonly T[], ...stages: Array<PipelineStage<T>>) => Promise<unknown[]>;
	phase: (title: string) => void;
	log: (message: string) => void;
	args: unknown;
}
