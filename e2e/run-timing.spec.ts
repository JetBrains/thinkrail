import { existsSync, mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { expect, test } from "@playwright/test";
import {
	E2E_TIMING_FILE_ENV,
	E2E_TIMING_PARENT_RUN_ID_ENV,
	type E2eRunTimingRecordV1,
	e2eRunModeForEntrypoint,
	isPlaywrightListRun,
	preloadE2eRunTiming,
	startE2eRunTiming,
	withE2eTimingParent,
} from "./runTiming";

test("a completed run records stable v1 selection, lineage, and monotonic timings", async () => {
	let now = 100;
	const lines: string[] = [];
	const selection = { playwrightArgs: ["e2e/host.spec.ts"], shardCount: 2, phases: ["no-agent"] };
	const timing = startE2eRunTiming("no-agent", ["--serial", "e2e/host.spec.ts"], {
		env: { [E2E_TIMING_PARENT_RUN_ID_ENV]: "parent-run" },
		now: () => now,
		wallNow: () => new Date("2026-09-03T12:00:00.000Z"),
		runId: () => "run-1",
		append: (_path, line) => lines.push(line),
	});
	timing.setSelection(selection);
	selection.playwrightArgs.push("mutated");
	selection.phases.push("mutated");

	now = 110;
	await timing.timeBuild(() => {
		now = 125;
	});
	now = 130;
	await timing.timeShard(2, 2, () => {
		now = 160;
	});
	now = 165;
	await timing.timeShard(1, 2, () => {
		now = 175;
	});
	now = 180;
	await timing.timePhase("report-merge", () => {
		now = 190;
	});
	now = 200;

	expect(timing.finish(0)).toBe(0);
	expect(timing.finish(9)).toBe(9);
	expect(lines).toHaveLength(1);
	expect(JSON.parse(lines[0] ?? "") as E2eRunTimingRecordV1).toEqual({
		version: 1,
		runId: "run-1",
		parentRunId: "parent-run",
		mode: "no-agent",
		args: ["--serial", "e2e/host.spec.ts"],
		selection: {
			playwrightArgs: ["e2e/host.spec.ts"],
			shardCount: 2,
			phases: ["no-agent"],
		},
		startedAt: "2026-09-03T12:00:00.000Z",
		durationMs: 100,
		buildDurationMs: 15,
		shards: [
			{ index: 1, count: 2, durationMs: 10 },
			{ index: 2, count: 2, durationMs: 30 },
		],
		phases: [{ name: "report-merge", durationMs: 10 }],
		outcome: "passed",
		exitCode: 0,
	});
});

test("the default writer creates an overridden path and appends compact records", () => {
	const directory = mkdtempSync(join(tmpdir(), "thinkrail-e2e-timing-"));
	const path = join(directory, "nested", "runs.jsonl");
	try {
		for (const [runId, exitCode] of [
			["run-a", 0],
			["run-b", 2],
		] as const) {
			startE2eRunTiming("binary", [], {
				env: { [E2E_TIMING_FILE_ENV]: path },
				now: () => 5,
				wallNow: () => new Date("2026-09-03T12:00:00.000Z"),
				runId: () => runId,
			}).finish(exitCode);
		}
		const content = readFileSync(path, "utf8");
		expect(content.endsWith("\n")).toBe(true);
		expect(
			content
				.trimEnd()
				.split("\n")
				.map((line) => JSON.parse(line)),
		).toMatchObject([
			{ runId: "run-a", outcome: "passed", exitCode: 0 },
			{ runId: "run-b", outcome: "failed", exitCode: 2 },
		]);
	} finally {
		rmSync(directory, { recursive: true, force: true });
	}
});

test("the preload starts total timing before the runner module claims it", () => {
	let now = 10;
	const lines: string[] = [];
	const preloaded = preloadE2eRunTiming("/repo/e2e/run-binary.ts", ["e2e/host.spec.ts"], {
		now: () => now,
		append: (_path, line) => lines.push(line),
	});
	now = 25;
	const claimed = startE2eRunTiming("binary", ["e2e/host.spec.ts"]);
	expect(claimed).toBe(preloaded);
	now = 50;
	claimed.finish(0);
	expect(JSON.parse(lines[0] ?? "").durationMs).toBe(40);
});

test("early failures retain an effective fallback selection and runner modes are explicit", () => {
	const lines: string[] = [];
	startE2eRunTiming("agent", ["--invalid"], {
		append: (_path, line) => lines.push(line),
	}).finish(1);
	expect(JSON.parse(lines[0] ?? "")).toMatchObject({
		mode: "agent",
		selection: { playwrightArgs: ["--invalid"] },
		outcome: "failed",
	});
	expect(e2eRunModeForEntrypoint("/repo/e2e/run.ts")).toBe("no-agent");
	expect(e2eRunModeForEntrypoint("run-agent.ts")).toBe("agent");
	expect(e2eRunModeForEntrypoint("/repo/e2e/run-full.ts")).toBe("full");
	expect(e2eRunModeForEntrypoint("/repo/e2e/run-binary.ts")).toBe("binary");
	expect(e2eRunModeForEntrypoint("/repo/e2e/run-desktop.ts")).toBe("desktop");
	expect(e2eRunModeForEntrypoint("/repo/e2e/unknown.ts")).toBeNull();
});

test("list-only runs produce no record or filesystem path", () => {
	const directory = mkdtempSync(join(tmpdir(), "thinkrail-e2e-timing-list-"));
	const path = join(directory, "missing", "runs.jsonl");
	try {
		expect(isPlaywrightListRun(["e2e/host.spec.ts", "--list"])).toBe(true);
		expect(isPlaywrightListRun(["--grep", "--list"])).toBe(false);
		expect(isPlaywrightListRun(["--grep", "--list", "--list"])).toBe(true);
		expect(isPlaywrightListRun(["--", "--list"])).toBe(false);
		const timing = startE2eRunTiming("full", ["--list"], {
			env: { [E2E_TIMING_FILE_ENV]: path },
		});
		timing.setSelection({ playwrightArgs: ["--list"], phases: ["no-agent", "agent"] });
		expect(timing.finish(0)).toBe(0);
		expect(existsSync(join(directory, "missing"))).toBe(false);
	} finally {
		rmSync(directory, { recursive: true, force: true });
	}
});

test("timing failures warn without changing results and parent environments stay immutable", () => {
	const lines: string[] = [];
	const interrupted = startE2eRunTiming("desktop", [], {
		append: (_path, line) => lines.push(line),
	});
	expect(interrupted.finish(130, { interrupted: true })).toBe(130);
	expect(JSON.parse(lines[0] ?? "")).toMatchObject({ outcome: "interrupted", exitCode: 130 });

	const warnings: string[] = [];
	const blockedPath = join(tmpdir(), "thinkrail-blocked", "runs.jsonl");
	const failedWrite = startE2eRunTiming("desktop", [], {
		env: { [E2E_TIMING_FILE_ENV]: blockedPath },
		append: () => {
			throw new Error("disk denied");
		},
		warn: (warning) => warnings.push(warning),
	});
	expect(failedWrite.finish(7)).toBe(7);
	expect(warnings).toEqual([`E2E: could not append timing record to ${blockedPath}: disk denied`]);

	const env = { KEEP: "yes" };
	const childEnv = withE2eTimingParent(env, "parent-run");
	expect(env).toEqual({ KEEP: "yes" });
	expect(childEnv).toEqual({
		KEEP: "yes",
		[E2E_TIMING_PARENT_RUN_ID_ENV]: "parent-run",
	});
});
