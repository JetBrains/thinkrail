import type { ExtensionContext } from "@earendil-works/pi-coding-agent";
import type { PiExtensionFactory } from "@thinkrail/ext";
import { Type } from "typebox";
import { type RunSummary, TOOL_NAME } from "./model";

export interface StartRequest {
	script: string;
	args: unknown;
	resumeFromRunId?: string;
	resumeRetryFailed: boolean;
	concurrency?: number;
	maxAgents?: number;
	maxCost?: number;
	agentTimeoutMs?: number;
	ctx: ExtensionContext;
	signal: AbortSignal | undefined;
	onUpdate: (text: string, details: RunSummary) => void;
}

export type StartRun = (request: StartRequest) => Promise<{ text: string; details: RunSummary }>;

const Params = Type.Object({
	script: Type.String({
		description:
			"A self-contained JavaScript orchestration script. Must begin with " +
			"`export const meta = { name, description, phases? }` (a pure object literal) " +
			"followed by the body. Globals: `agent(prompt, opts?)` runs one child agent " +
			"(pass `opts.schema` as a JSON Schema to force validated JSON, else returns text; " +
			"resolves null when the child fails); `parallel(tasks, opts?)` runs an array of " +
			"`() => Promise` (a thrown task yields null; `{ failFast: true }` rejects on the first " +
			"failure); `pipeline(items, ...stages)` runs every item through every stage with no " +
			"barrier, each stage called as `(prevResult, originalItem, index)`; `phase(title)` " +
			"marks a phase; `log(msg)` adds a progress line; `args` holds the JSON passed below. " +
			"Use top-level `await` and `return <finalValue>`: the value is the tool result. " +
			"agent opts: { label, phase, schema, model ('provider/id' or a unique part of it), " +
			"effort (off|minimal|low|medium|high|xhigh), tools (string[]; [] = none), system " +
			"(replaces the child's system prompt), agentType (.pi/agents/<name>.md), maxTurns }.",
	}),
	args: Type.Optional(
		Type.Any({ description: "Optional JSON value exposed to the script as the `args` global." }),
	),
	resumeFromRunId: Type.Optional(
		Type.String({
			description:
				"Run id of an earlier Ultracode run (printed in its result). The script runs again from the " +
				"top, but every agent call whose prompt and options are unchanged is served from that run's " +
				"journal instead of being spawned. Replay stops at the first changed call.",
		}),
	),
	resumeRetryFailed: Type.Optional(
		Type.Boolean({
			description: "With resumeFromRunId: run the agents that failed in that run again.",
		}),
	),
	concurrency: Type.Optional(
		Type.Integer({
			minimum: 1,
			maximum: 16,
			description: "Agents running at once. Default 6.",
		}),
	),
	maxAgents: Type.Optional(
		Type.Integer({ minimum: 1, description: "agent() calls allowed. Default 1000." }),
	),
	maxCost: Type.Optional(
		Type.Number({
			exclusiveMinimum: 0,
			description: "USD budget. No new agent starts once the run has spent this much.",
		}),
	),
	agentTimeoutMs: Type.Optional(
		Type.Integer({ minimum: 1, description: "Wall clock one agent may take. Off by default." }),
	),
});

const DESCRIPTION = [
	"Run a dynamic workflow: author a JavaScript orchestration script and execute it OUTSIDE the",
	"main context. Use it to fan work out across many isolated child agents and fan their results",
	"back into one value: codebase audits, multi-area review with independent verification, design",
	"panels, staged migrations. Children are ThinkRail subagents of this chat; the user watches the",
	"run live in the Workflow run tab. Keep intermediate results in plain variables and push side",
	"effects into the agents. `Date.now()`, argless `new Date()` and `Math.random()` throw, because a",
	"resumed run must replay identically. Each run journals its agent results, so a fixed script can",
	"run again with `resumeFromRunId` to reuse the unchanged prefix.",
].join("\n");

export const ultracodePi =
	(start: StartRun): PiExtensionFactory =>
	(pi) => {
		pi.registerTool({
			name: TOOL_NAME,
			label: "Workflow",
			description: DESCRIPTION,
			promptSnippet:
				"Ultracode: author and run a JS script that fans out child agents (agent/parallel/pipeline/phase/log) and returns one value.",
			promptGuidelines: [
				"Reach for Ultracode when a task decomposes into many independent sub-tasks whose results merge, not for a single lookup or edit.",
				"The script must `export const meta = {...}` as a pure literal and `return` its final value.",
				"After a partial failure, fix the script and call Ultracode again with `resumeFromRunId` set to the failed run id.",
			],
			parameters: Params,
			executionMode: "sequential",
			async execute(_id, params, signal, onUpdate, ctx) {
				const { text, details } = await start({
					script: params.script,
					args: params.args,
					...(params.resumeFromRunId !== undefined
						? { resumeFromRunId: params.resumeFromRunId }
						: {}),
					resumeRetryFailed: params.resumeRetryFailed === true,
					...(params.concurrency !== undefined ? { concurrency: params.concurrency } : {}),
					...(params.maxAgents !== undefined ? { maxAgents: params.maxAgents } : {}),
					...(params.maxCost !== undefined ? { maxCost: params.maxCost } : {}),
					...(params.agentTimeoutMs !== undefined ? { agentTimeoutMs: params.agentTimeoutMs } : {}),
					ctx,
					signal,
					onUpdate: (partial, summary) =>
						onUpdate?.({ content: [{ type: "text", text: partial }], details: summary }),
				});
				return { content: [{ type: "text", text }], details };
			},
		});
	};
