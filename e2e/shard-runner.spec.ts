import { readFileSync } from "node:fs";
import { expect, test } from "@playwright/test";
import { E2E_IDLE_SLEEP_OWNER_ENV, holdE2eIdleSleep } from "./idleSleep";
import {
	AUTO_E2E_SHARD_CAP,
	automaticShardCount,
	MAX_E2E_SHARDS,
	parseRunnerArgs,
	resolveShardCount,
} from "./shardPlan";

function rootScripts(): Record<string, string> {
	return (
		JSON.parse(readFileSync(new URL("../package.json", import.meta.url), "utf8")) as {
			scripts: Record<string, string>;
		}
	).scripts;
}

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
	const scripts = rootScripts();
	for (const name of [
		"e2e",
		"e2e:serial",
		"e2e:focused",
		"e2e:repair",
		"e2e:binary",
		"e2e:desktop",
		"e2e:full",
		"e2e:full:headed",
		"e2e:agent",
		"e2e:agent:headed",
		"e2e:headed",
		"e2e:ui",
	]) {
		expect(scripts[name]).toContain("bun --preload ./e2e/idleSleepPreload.ts");
	}
});

test("iteration commands separate first-failure focus from complete remembered repair", () => {
	const scripts = rootScripts();
	expect(scripts.e2e).toBe("bun --preload ./e2e/idleSleepPreload.ts e2e/run.ts");
	expect(scripts["e2e:focused"]).toBe(
		"bun --preload ./e2e/idleSleepPreload.ts e2e/run.ts --serial --max-failures=1",
	);
	expect(scripts["e2e:repair"]).toBe(
		"bun --preload ./e2e/idleSleepPreload.ts e2e/run.ts --serial --last-failed",
	);
	expect(scripts["e2e:repair"]).not.toContain("max-failures");
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
