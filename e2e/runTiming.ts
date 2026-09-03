import { randomUUID } from "node:crypto";
import { appendFileSync, mkdirSync } from "node:fs";
import { basename, dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

export const E2E_TIMING_FILE_ENV = "THINKRAIL_E2E_TIMING_FILE";
export const E2E_TIMING_PARENT_RUN_ID_ENV = "THINKRAIL_E2E_TIMING_PARENT_RUN_ID";

export type E2eRunMode = "no-agent" | "agent" | "full" | "binary" | "desktop";
export type E2eRunOutcome = "passed" | "failed" | "interrupted";

export interface E2eRunSelection {
	playwrightArgs: string[];
	shardCount?: number;
	phases?: string[];
}

export interface E2eRunShardTiming {
	index: number;
	count: number;
	durationMs: number;
}

export interface E2eRunPhaseTiming {
	name: string;
	durationMs: number;
}

export interface E2eRunTimingRecordV1 {
	version: 1;
	runId: string;
	parentRunId?: string;
	mode: E2eRunMode;
	args: string[];
	selection: E2eRunSelection;
	startedAt: string;
	durationMs: number;
	buildDurationMs?: number;
	shards?: E2eRunShardTiming[];
	phases?: E2eRunPhaseTiming[];
	outcome: E2eRunOutcome;
	exitCode: number;
}

export interface E2eRunTimingDependencies {
	env?: NodeJS.ProcessEnv;
	now?: () => number;
	wallNow?: () => Date;
	runId?: () => string;
	append?: (path: string, line: string) => void;
	warn?: (message: string) => void;
}

export interface E2eRunTiming {
	readonly runId: string;
	setSelection(selection: E2eRunSelection): void;
	timeBuild<T>(run: () => T | Promise<T>): Promise<T>;
	timeShard<T>(index: number, count: number, run: () => T | Promise<T>): Promise<T>;
	timePhase<T>(name: string, run: () => T | Promise<T>): Promise<T>;
	finish(exitCode: number, options?: { interrupted?: boolean }): number;
}

const repoRoot = fileURLToPath(new URL("..", import.meta.url));
const defaultTimingFile = fileURLToPath(new URL("./.run-timings.jsonl", import.meta.url));
let preloadedTiming: { mode: E2eRunMode; args: string[]; timing: E2eRunTiming } | undefined;

function appendTimingLine(path: string, line: string): void {
	mkdirSync(dirname(path), { recursive: true });
	appendFileSync(path, line);
}

function timingFile(env: NodeJS.ProcessEnv): string {
	const configured = env[E2E_TIMING_FILE_ENV];
	return configured ? resolve(repoRoot, configured) : defaultTimingFile;
}

function duration(startedAt: number, now: () => number): number {
	return Math.max(0, Math.round(now() - startedAt));
}

function message(error: unknown): string {
	return error instanceof Error ? error.message : String(error);
}

export function withE2eTimingParent(env: NodeJS.ProcessEnv, runId: string): NodeJS.ProcessEnv {
	return { ...env, [E2E_TIMING_PARENT_RUN_ID_ENV]: runId };
}

const optionsWithRequiredValues = new Set([
	"--browser",
	"-c",
	"--config",
	"-g",
	"--grep",
	"-G",
	"--grep-invert",
	"--global-timeout",
	"-j",
	"--workers",
	"--last-failed-file",
	"--max-failures",
	"--output",
	"--project",
	"--repeat-each",
	"--reporter",
	"--retries",
	"--run-agents",
	"--shard",
	"--shards",
	"--test-list",
	"--test-list-invert",
	"--timeout",
	"--trace",
	"--tsconfig",
	"--ui-host",
	"--ui-port",
	"--update-source-method",
]);

export function isPlaywrightListRun(args: readonly string[]): boolean {
	for (let index = 0; index < args.length; index += 1) {
		const arg = args[index];
		if (arg === "--") return false;
		if (arg === "--list") return true;
		if (optionsWithRequiredValues.has(arg)) index += 1;
	}
	return false;
}

export function e2eRunModeForEntrypoint(entrypoint: string | undefined): E2eRunMode | null {
	switch (basename(entrypoint ?? "")) {
		case "run.ts":
			return "no-agent";
		case "run-agent.ts":
			return "agent";
		case "run-full.ts":
			return "full";
		case "run-binary.ts":
			return "binary";
		case "run-desktop.ts":
			return "desktop";
		default:
			return null;
	}
}

function createE2eRunTiming(
	mode: E2eRunMode,
	args: readonly string[],
	dependencies: E2eRunTimingDependencies = {},
): E2eRunTiming {
	const env = dependencies.env ?? process.env;
	const now = dependencies.now ?? performance.now.bind(performance);
	const wallNow = dependencies.wallNow ?? (() => new Date());
	const append = dependencies.append ?? appendTimingLine;
	const warn = dependencies.warn ?? ((warning: string) => console.error(warning));
	const runId = (dependencies.runId ?? randomUUID)();
	const parentRunId = env[E2E_TIMING_PARENT_RUN_ID_ENV] || undefined;
	const startedAt = wallNow().toISOString();
	const monotonicStartedAt = now();
	const suppressed = isPlaywrightListRun(args);
	const rawArgs = [...args];
	let selection: E2eRunSelection = { playwrightArgs: [...args] };
	let buildDurationMs: number | undefined;
	const shards: E2eRunShardTiming[] = [];
	const phases: E2eRunPhaseTiming[] = [];
	let finished = false;

	const measure = async <T>(run: () => T | Promise<T>, measured: (value: number) => void) => {
		const measurementStartedAt = now();
		try {
			return await run();
		} finally {
			measured(duration(measurementStartedAt, now));
		}
	};

	return {
		runId,
		setSelection(nextSelection) {
			selection = {
				...nextSelection,
				playwrightArgs: [...nextSelection.playwrightArgs],
				...(nextSelection.phases ? { phases: [...nextSelection.phases] } : {}),
			};
		},
		timeBuild(run) {
			return measure(run, (value) => {
				buildDurationMs = value;
			});
		},
		timeShard(index, count, run) {
			return measure(run, (durationMs) => {
				shards.push({ index, count, durationMs });
			});
		},
		timePhase(name, run) {
			return measure(run, (durationMs) => {
				phases.push({ name, durationMs });
			});
		},
		finish(exitCode, options = {}) {
			if (finished) return exitCode;
			finished = true;
			if (suppressed) return exitCode;
			const record: E2eRunTimingRecordV1 = {
				version: 1,
				runId,
				...(parentRunId ? { parentRunId } : {}),
				mode,
				args: rawArgs,
				selection,
				startedAt,
				durationMs: duration(monotonicStartedAt, now),
				...(buildDurationMs === undefined ? {} : { buildDurationMs }),
				...(shards.length === 0
					? {}
					: { shards: [...shards].sort((left, right) => left.index - right.index) }),
				...(phases.length === 0 ? {} : { phases: [...phases] }),
				outcome: options.interrupted ? "interrupted" : exitCode === 0 ? "passed" : "failed",
				exitCode,
			};
			const path = timingFile(env);
			try {
				append(path, `${JSON.stringify(record)}\n`);
			} catch (error) {
				warn(`E2E: could not append timing record to ${path}: ${message(error)}`);
			}
			return exitCode;
		},
	};
}

export function preloadE2eRunTiming(
	entrypoint: string | undefined,
	args: readonly string[],
	dependencies: E2eRunTimingDependencies = {},
): E2eRunTiming | null {
	const mode = e2eRunModeForEntrypoint(entrypoint);
	if (!mode) return null;
	const timing = createE2eRunTiming(mode, args, dependencies);
	preloadedTiming = { mode, args: [...args], timing };
	return timing;
}

export function startE2eRunTiming(
	mode: E2eRunMode,
	args: readonly string[],
	dependencies: E2eRunTimingDependencies = {},
): E2eRunTiming {
	if (
		Object.keys(dependencies).length === 0 &&
		preloadedTiming?.mode === mode &&
		preloadedTiming.args.length === args.length &&
		preloadedTiming.args.every((arg, index) => arg === args[index])
	) {
		const timing = preloadedTiming.timing;
		preloadedTiming = undefined;
		return timing;
	}
	return createE2eRunTiming(mode, args, dependencies);
}
