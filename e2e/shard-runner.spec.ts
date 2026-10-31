import { spawnSync } from "node:child_process";
import { mkdirSync, mkdtempSync, readdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { expect, test } from "@playwright/test";
import { resolveBunExecutable } from "./fixtures/executables";
import { E2E_IDLE_SLEEP_OWNER_ENV, holdE2eIdleSleep } from "./idleSleep";
import { E2E_ROOT_DIR } from "./processRunner";
import {
	AUTO_E2E_SHARD_CAP,
	automaticShardCount,
	interleavedTestList,
	type ListedTest,
	laneShard,
	listedPlaywrightTests,
	MAX_E2E_SHARDS,
	parseJobShard,
	parseRunnerArgs,
	resolveShardCount,
} from "./shardPlan";
import { shardTestListArgs } from "./shardTestLists";

test("one macOS runner owns one pid-scoped idle-sleep assertion", async () => {
	const env: NodeJS.ProcessEnv = {};
	const commands: string[][] = [];
	let unrefCount = 0;
	const spawn = (command: string[]) => {
		commands.push(command);
		return {
			exited: new Promise<number>(() => {}),
			unref: () => {
				unrefCount += 1;
			},
		};
	};
	const wait = async () => {};

	await expect(holdE2eIdleSleep({ env, pid: 42, platform: "darwin", spawn, wait })).resolves.toBe(
		true,
	);
	expect(commands).toEqual([["/usr/bin/caffeinate", "-i", "-w", "42"]]);
	expect(unrefCount).toBe(1);
	expect(env[E2E_IDLE_SLEEP_OWNER_ENV]).toBe("1");
	await expect(holdE2eIdleSleep({ env, pid: 42, platform: "darwin", spawn, wait })).resolves.toBe(
		false,
	);
	expect(commands).toHaveLength(1);

	const linuxEnv: NodeJS.ProcessEnv = {};
	await expect(holdE2eIdleSleep({ env: linuxEnv, platform: "linux", spawn })).resolves.toBe(false);
	expect(linuxEnv[E2E_IDLE_SLEEP_OWNER_ENV]).toBe("1");
	expect(commands).toHaveLength(1);
});

test("a macOS assertion that exits during startup fails the runner", async () => {
	await expect(
		holdE2eIdleSleep({
			env: {},
			pid: 42,
			platform: "darwin",
			spawn: () => ({ exited: Promise.resolve(9), unref: () => {} }),
			wait: () => new Promise<void>(() => {}),
		}),
	).rejects.toThrow("idle-sleep assertion exited during startup with code 9");
});

test("every public browser E2E command preloads the idle-sleep assertion", () => {
	const rootPackage = JSON.parse(
		readFileSync(new URL("../package.json", import.meta.url), "utf8"),
	) as { scripts: Record<string, string> };
	for (const name of [
		"e2e",
		"e2e:serial",
		"e2e:binary",
		"e2e:desktop",
		"e2e:full",
		"e2e:full:headed",
		"e2e:agent",
		"e2e:agent:headed",
		"e2e:headed",
		"e2e:ui",
	]) {
		expect(rootPackage.scripts[name]).toContain("bun --preload ./e2e/idleSleepPreload.ts");
	}
});

test("automatic shard count budgets two CPUs per browser/host pair and stays bounded", () => {
	expect(automaticShardCount(Number.NaN)).toBe(1);
	expect(automaticShardCount(1)).toBe(1);
	expect(automaticShardCount(2)).toBe(1);
	expect(automaticShardCount(4)).toBe(2);
	expect(automaticShardCount(16)).toBe(AUTO_E2E_SHARD_CAP);
	expect(automaticShardCount(128)).toBe(AUTO_E2E_SHARD_CAP);
});

test("focused Playwright arguments default serial while explicit counts win", () => {
	expect(
		resolveShardCount({
			availableCpuCount: 16,
			hasPlaywrightArgs: false,
		}),
	).toBe(8);
	expect(
		resolveShardCount({
			availableCpuCount: 16,
			hasPlaywrightArgs: true,
		}),
	).toBe(1);
	expect(
		resolveShardCount({
			envValue: "6",
			availableCpuCount: 2,
			hasPlaywrightArgs: true,
		}),
	).toBe(6);
	expect(
		resolveShardCount({
			shardOverride: 3,
			envValue: "6",
			availableCpuCount: 2,
			hasPlaywrightArgs: true,
		}),
	).toBe(3);
});

test("runner flags are consumed without changing Playwright arguments", () => {
	expect(parseRunnerArgs(["--serial", "e2e/host.spec.ts", "--grep", "health"])).toEqual({
		shardOverride: 1,
		playwrightArgs: ["e2e/host.spec.ts", "--grep", "health"],
	});
	expect(parseRunnerArgs(["--shards=12"])).toEqual({
		shardOverride: 12,
		playwrightArgs: [],
	});
	expect(parseRunnerArgs(["--shards", "4", "--last-failed"])).toEqual({
		shardOverride: 4,
		playwrightArgs: ["--last-failed"],
	});
});

test("job slices and lanes resolve to lane shards, and the runner owns --shard", () => {
	expect(parseJobShard(undefined)).toBeUndefined();
	expect(parseJobShard("")).toBeUndefined();
	expect(parseJobShard("2/3")).toEqual({ index: 2, total: 3 });
	for (const raw of ["0/2", "3/2", "1/0", "2", "a/b", "1/2/3"]) {
		expect(() => parseJobShard(raw)).toThrow(/THINKRAIL_E2E_JOB_SHARD/);
	}

	expect(laneShard(undefined, 1, 1)).toBeUndefined();
	expect(laneShard(undefined, 2, 3)).toEqual({ job: undefined, lane: 2, laneCount: 3 });
	expect(laneShard({ index: 2, total: 3 }, 1, 1)).toEqual({
		job: { index: 2, total: 3 },
		lane: 1,
		laneCount: 1,
	});
	expect(() =>
		shardTestListArgs(["--shard=1/2"], [laneShard({ index: 2, total: 4 }, 1, 1)], {}, "unused"),
	).toThrow(/explicit --shard/);
	expect(() =>
		shardTestListArgs(["--shard", "1/2"], [laneShard(undefined, 1, 2)], {}, "unused"),
	).toThrow(/explicit --shard/);
});

test("invalid or conflicting shard overrides fail loudly", () => {
	expect(() => parseRunnerArgs(["--shards=0"])).toThrow(/integer/);
	expect(() => parseRunnerArgs([`--shards=${MAX_E2E_SHARDS + 1}`])).toThrow(/integer/);
	expect(() => parseRunnerArgs(["--serial", "--shards=2"])).toThrow(/more than once/);
	expect(() =>
		resolveShardCount({
			envValue: "many",
			availableCpuCount: 16,
			hasPlaywrightArgs: false,
		}),
	).toThrow(/THINKRAIL_E2E_SHARDS/);
});

function spec(title: string, file = "a.spec.ts") {
	return { title, file };
}

function listing(specs: unknown[], suites: unknown[] = [], errors: unknown[] = []): string {
	return JSON.stringify({
		errors,
		suites: [{ file: "a.spec.ts", title: "a.spec.ts", specs, suites }],
	});
}

test("shard listing reads every test with its describe path", () => {
	const tests = listedPlaywrightTests(
		JSON.stringify({
			errors: [],
			suites: [
				{
					file: "a.spec.ts",
					title: "a.spec.ts",
					specs: [spec("top")],
					suites: [{ title: "group", specs: [spec("inner")], suites: [] }],
				},
				{ file: "b.spec.ts", title: "b.spec.ts", specs: [spec("only", "b.spec.ts")] },
			],
		}),
	);
	expect(tests).toEqual([
		{ file: "a.spec.ts", titles: ["top"] },
		{ file: "a.spec.ts", titles: ["group", "inner"] },
		{ file: "b.spec.ts", titles: ["only"] },
	]);
	expect(listedPlaywrightTests(listing([], [{ title: "", specs: [spec("anonymous")] }]))).toEqual([
		{ file: "a.spec.ts", titles: ["anonymous"] },
	]);
	expect(listedPlaywrightTests(listing([spec("repeated"), spec("repeated")]))).toEqual([
		{ file: "a.spec.ts", titles: ["repeated"] },
	]);
	expect(() => listedPlaywrightTests("not json")).toThrow(/did not return JSON/);
	expect(() => listedPlaywrightTests(listing([], [], [{ message: "boom" }]))).toThrow(/boom/);
});

test("shard listing rejects tests a test list cannot select exactly once", () => {
	expect(() =>
		listedPlaywrightTests(listing([spec("group")], [{ title: "group", specs: [spec("x")] }])),
	).toThrow(/also selects/);
	for (const title of ["a \u203A b", " padded", "two\nlines"]) {
		expect(() => listedPlaywrightTests(listing([spec(title)]))).toThrow(/cannot be addressed/);
	}
	expect(() => listedPlaywrightTests(listing([spec("shared", "helpers.ts")]))).toThrow(
		/declared in helpers\.ts/,
	);
});

test("interleaved lists deal jobs, then lanes, so every test lands in exactly one lane", () => {
	const tests: ListedTest[] = Array.from({ length: 11 }, (_, index) => ({
		file: index < 4 ? "slow.spec.ts" : "fast.spec.ts",
		titles: ["group", `t${index}`],
	}));
	const line = (test: ListedTest) => [test.file, ...test.titles].join(" \u203A ");
	expect(interleavedTestList(tests, { job: undefined, lane: 1, laneCount: 3 })).toBe(
		[0, 3, 6, 9].map((index) => `${line(tests[index] as ListedTest)}\n`).join(""),
	);
	const lanesPerJob = [2, 3, 1];
	const lines = lanesPerJob.flatMap((laneCount, job) =>
		Array.from({ length: laneCount }, (_, lane) =>
			interleavedTestList(tests, { job: { index: job + 1, total: 3 }, lane: lane + 1, laneCount }),
		).flatMap((list) => list.split("\n").filter(Boolean)),
	);
	expect(lines.toSorted()).toEqual(tests.map(line).toSorted());
});

test("Playwright selects exactly the tests each interleaved list names", async () => {
	const parent = join(E2E_ROOT_DIR, "test-results");
	mkdirSync(parent, { recursive: true });
	const dir = mkdtempSync(join(parent, "shard-lists-"));
	try {
		mkdirSync(join(dir, "specs"));
		writeFileSync(
			join(dir, "specs", "a.spec.ts"),
			[
				'import { test } from "@playwright/test";',
				'test("plain", () => {});',
				'test("with > arrow", () => {});',
				'test.describe("group", () => { test("plain", () => {}); test.describe("nested", () => { test("deep", () => {}); }); });',
				'test.describe(() => { test("anonymous group", () => {}); });',
			].join("\n"),
		);
		writeFileSync(
			join(dir, "specs", "b.spec.ts"),
			'import { test } from "@playwright/test";\ntest("plain", () => {});\ntest("@tagged title", () => {});\n',
		);
		writeFileSync(
			join(dir, "playwright.config.ts"),
			'import { defineConfig } from "@playwright/test";\nexport default defineConfig({ testDir: "./specs", fullyParallel: true });\n',
		);
		const list = (args: string[]) => {
			const result = spawnSync(
				resolveBunExecutable(),
				[
					"x",
					"playwright",
					"test",
					"-c",
					join(dir, "playwright.config.ts"),
					...args,
					"--list",
					"--reporter=json",
				],
				{ cwd: dir, encoding: "utf8", env: { ...process.env, CI: "" } },
			);
			return listedPlaywrightTests(result.stdout);
		};
		const all = list([]);
		expect(all).toHaveLength(7);
		const selected = [1, 2, 3].map((index) => {
			const file = join(dir, `shard-${index}.txt`);
			writeFileSync(file, interleavedTestList(all, { job: undefined, lane: index, laneCount: 3 }));
			return list(["--test-list", file]);
		});
		expect(selected.map((tests) => tests.length)).toEqual([3, 2, 2]);
		const key = (test: ListedTest) => [test.file, ...test.titles].join("\0");
		expect(selected.flat().map(key).toSorted()).toEqual(all.map(key).toSorted());
	} finally {
		rmSync(dir, { recursive: true, force: true });
	}
});

test("no browser spec runs in serial mode, which dealt shards would split", () => {
	const specs = readdirSync(join(E2E_ROOT_DIR, "e2e"), {
		recursive: true,
		encoding: "utf8",
	}).filter((file) => file.endsWith(".spec.ts") && !file.startsWith("workflows"));
	expect(specs.length).toBeGreaterThan(0);
	const serial = specs.filter((file) =>
		/describe\.serial|mode:\s*["']serial["']/.test(
			readFileSync(join(E2E_ROOT_DIR, "e2e", file), "utf8"),
		),
	);
	expect(serial).toEqual([]);
});
