import type { PiExtensionFactory } from "@thinkrail/ext";
import { Type } from "typebox";
import {
	clip,
	countsText,
	excerpt,
	formatDuration,
	locationOf,
	OUTCOME_LABEL,
	type RunResult,
} from "./model";

const TEXT_LIMIT = 4_000;
const TEXT_FAILURES = 10;
const FAILURE_LINES = 6;
const TICK_MS = 1_000;

export type AgentRun =
	| { ok: true; result: RunResult; joined: boolean }
	| { ok: false; message: string };

export interface AgentRequest {
	sessionId: string;
	cwd: string;
	filter?: string;
	signal: AbortSignal | undefined;
}

export interface Progress {
	running: true;
	command: string;
	elapsedMs: number;
}

export type RunForAgent = (
	request: AgentRequest,
	onStart: (command: string, startedAt: number) => void,
) => Promise<AgentRun>;

const RunTestsParams = Type.Object({
	filter: Type.Optional(
		Type.String({
			description:
				"Only run test files whose path contains this text (space-separated for several). Omit to run every test.",
		}),
	),
});

export const summaryText = (result: RunResult, joined: boolean) => {
	const lines = [
		`${OUTCOME_LABEL[result.outcome]}: ${countsText(result.counts)} in ${formatDuration(result.durationMs)}.`,
		`Command: ${result.command} (workspace root)`,
		...(joined ? [`Joined a run already started from the ${result.by}.`] : []),
		...(result.message ? [result.message] : []),
	];
	if (result.outcome === "failed") {
		lines.push("", "Failures:");
		for (const failure of result.failures.slice(0, TEXT_FAILURES)) {
			const where = locationOf(failure);
			lines.push(`- ${failure.name}${where ? ` (${where})` : ""}`);
			lines.push(
				...excerpt(failure.error, FAILURE_LINES, 600)
					.split("\n")
					.map((line) => `    ${line}`),
			);
		}
		const more = result.failuresTotal - Math.min(result.failures.length, TEXT_FAILURES);
		if (more > 0) lines.push(`- … ${more} more failing tests`);
	} else if (result.outcome !== "passed" && result.output) {
		lines.push(
			"",
			"Output (tail):",
			excerpt(result.output.split("\n").slice(-40).join("\n"), 40, 2_000),
		);
	}
	return clip(lines.join("\n"), TEXT_LIMIT);
};

export const testRunnerPi =
	(runForAgent: RunForAgent): PiExtensionFactory =>
	(pi) => {
		pi.registerTool({
			name: "run_tests",
			label: "Run tests",
			description:
				"Run the workspace's tests (package.json `test` script, else `bun test`) and get pass/fail counts plus failing tests with error excerpts. The user sees the same result in the Tests panel.",
			parameters: RunTestsParams,
			async execute(_id, params, signal, onUpdate, ctx) {
				let ticker: ReturnType<typeof setInterval> | undefined;
				const onStart = (command: string, startedAt: number) => {
					const report = () => {
						const details: Progress = {
							running: true,
							command,
							elapsedMs: Date.now() - startedAt,
						};
						onUpdate?.({
							content: [{ type: "text", text: `Running ${command}…` }],
							details,
						});
					};
					report();
					ticker = setInterval(report, TICK_MS);
				};
				try {
					const run = await runForAgent(
						{
							sessionId: ctx.sessionManager.getSessionId(),
							cwd: ctx.cwd,
							...(params.filter ? { filter: params.filter } : {}),
							signal,
						},
						onStart,
					);
					if (!run.ok) throw new Error(run.message);
					return {
						content: [{ type: "text", text: summaryText(run.result, run.joined) }],
						details: run.result,
					};
				} finally {
					if (ticker) clearInterval(ticker);
				}
			},
		});
	};
