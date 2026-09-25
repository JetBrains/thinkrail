export const EXT_NAME = "test-runner";
export const CHANNEL_PREFIX = "tests:";
export const MAX_FAILURES = 30;
export const MAX_ERROR_LINES = 30;
export const MAX_ERROR_CHARS = 1_500;
export const RESULT_OUTPUT_CHARS = 4_000;
export const FILTER_MAX_CHARS = 200;

export const channelKey = (workspaceId: string) => `${CHANNEL_PREFIX}${workspaceId}`;

export type Outcome = "passed" | "failed" | "error" | "cancelled" | "timeout";
export type RunBy = "panel" | "agent";

export interface Counts {
	pass: number;
	fail: number;
	skip: number;
}

export interface Failure {
	name: string;
	file?: string;
	line?: number;
	error: string;
}

export interface RunResult {
	command: string;
	filter?: string;
	by: RunBy;
	startedAt: number;
	durationMs: number;
	outcome: Outcome;
	exitCode: number | null;
	source: "junit" | "console";
	counts: Counts;
	failures: Failure[];
	failuresTotal: number;
	output: string;
	message?: string;
}

export interface Running {
	command: string;
	filter?: string;
	by: RunBy;
	startedAt: number;
	lastLine: string;
}

export type RunnerInfo =
	| { state: "ready"; label: string; structured: boolean }
	| { state: "error"; message: string };

export interface TestsState {
	runner: RunnerInfo;
	running?: Running;
	last?: RunResult;
}

export interface RunReply {
	started: boolean;
	reason?: string;
}

const OUTCOMES: readonly Outcome[] = ["passed", "failed", "error", "cancelled", "timeout"];

export const isRecord = (value: unknown): value is Record<string, unknown> =>
	typeof value === "object" && value !== null;

const isCounts = (value: unknown): value is Counts =>
	isRecord(value) &&
	typeof value.pass === "number" &&
	typeof value.fail === "number" &&
	typeof value.skip === "number";

const isFailure = (value: unknown): value is Failure =>
	isRecord(value) && typeof value.name === "string" && typeof value.error === "string";

export const isRunResult = (value: unknown): value is RunResult =>
	isRecord(value) &&
	typeof value.command === "string" &&
	typeof value.startedAt === "number" &&
	typeof value.durationMs === "number" &&
	OUTCOMES.some((outcome) => outcome === value.outcome) &&
	isCounts(value.counts) &&
	Array.isArray(value.failures) &&
	value.failures.every(isFailure) &&
	typeof value.failuresTotal === "number" &&
	typeof value.output === "string";

export const isRunReply = (value: unknown): value is RunReply =>
	isRecord(value) && typeof value.started === "boolean";

export const clip = (text: string, max: number) =>
	text.length <= max ? text : `${text.slice(0, max - 1)}…`;

export const tail = (text: string, max: number) =>
	text.length <= max ? text : `…${text.slice(text.length - max + 1)}`;

export const excerpt = (text: string, lines: number, chars: number) => {
	const kept = text.replace(/\s+$/, "").split("\n");
	const cut = kept.length > lines ? [...kept.slice(0, lines), "…"] : kept;
	return clip(cut.join("\n"), chars);
};

export const formatDuration = (ms: number) => {
	if (ms < 1_000) return `${Math.round(ms)}ms`;
	if (ms < 60_000) return `${(ms / 1_000).toFixed(1)}s`;
	return `${Math.floor(ms / 60_000)}m ${Math.round((ms % 60_000) / 1_000)}s`;
};

const UNITS = [
	["d", 86_400_000],
	["h", 3_600_000],
	["m", 60_000],
] as const;

export const formatAgo = (ms: number) => {
	for (const [unit, size] of UNITS) if (ms >= size) return `${Math.floor(ms / size)}${unit} ago`;
	return "just now";
};

export const OUTCOME_LABEL: Record<Outcome, string> = {
	passed: "Passed",
	failed: "Failed",
	error: "Run failed",
	cancelled: "Cancelled",
	timeout: "Timed out",
};

export const countsText = ({ pass, fail, skip }: Counts) =>
	`${pass} passed, ${fail} failed, ${skip} skipped`;

export const locationOf = (failure: Pick<Failure, "file" | "line">) =>
	failure.file ? `${failure.file}${failure.line ? `:${failure.line}` : ""}` : undefined;

export const fixDraft = (failure: Failure, result: Pick<RunResult, "command">) => {
	const where = locationOf(failure);
	return [
		`The test "${failure.name}" fails${where ? ` in ${where}` : ""}.`,
		`Command: ${result.command}`,
		"",
		"Error:",
		"```",
		failure.error,
		"```",
		"",
		`Find the cause and fix it, then call run_tests${failure.file ? ` with filter "${failure.file}"` : ""} to confirm it passes.`,
	].join("\n");
};
