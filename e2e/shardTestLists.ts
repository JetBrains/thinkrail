import { readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { runE2eProcess } from "./processRunner";
import {
	interleavedTestList,
	isShardArg,
	type LaneShard,
	listedPlaywrightTests,
} from "./shardPlan";

async function listAndDeal(
	playwrightArgs: readonly string[],
	shards: readonly (LaneShard | undefined)[],
	env: NodeJS.ProcessEnv,
	dir: string,
): Promise<string[][]> {
	const report = join(dir, "listing.json");
	const listingEnv: NodeJS.ProcessEnv = { ...env, PLAYWRIGHT_JSON_OUTPUT_FILE: report };
	delete listingEnv.PLAYWRIGHT_JSON_OUTPUT_DIR;
	delete listingEnv.PLAYWRIGHT_JSON_OUTPUT_NAME;
	const listing = await runE2eProcess(
		[
			process.execPath,
			"x",
			"playwright",
			"test",
			...playwrightArgs,
			"--forbid-only",
			"--list",
			"--reporter=json",
		],
		{ env: listingEnv, stdout: "pipe" },
	);
	let output = "";
	try {
		output = readFileSync(report, "utf8");
	} catch {}
	const tests = listedPlaywrightTests(output);
	if (listing.exitCode !== 0) {
		throw new Error(`Playwright shard listing exited ${listing.exitCode}`);
	}
	return shards.map((shard) => {
		if (!shard) return [];
		const file = join(dir, `lane-${shard.lane}-of-${shard.laneCount}.txt`);
		writeFileSync(file, interleavedTestList(tests, shard));
		return ["--test-list", file];
	});
}

export function shardTestListArgs(
	playwrightArgs: readonly string[],
	shards: readonly (LaneShard | undefined)[],
	env: NodeJS.ProcessEnv,
	dir: string,
): Promise<string[][]> {
	if (shards.every((shard) => shard === undefined)) return Promise.resolve(shards.map(() => []));
	if (playwrightArgs.some(isShardArg)) {
		throw new Error(
			"an explicit --shard needs one local lane and no THINKRAIL_E2E_JOB_SHARD; the runner deals shards itself",
		);
	}
	return listAndDeal(playwrightArgs, shards, env, dir);
}
