import { expect, test } from "@playwright/test";
import {
	AUTO_E2E_SHARD_CAP,
	automaticShardCount,
	MAX_E2E_SHARDS,
	parseRunnerArgs,
	resolveShardCount,
} from "./shardPlan";

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
