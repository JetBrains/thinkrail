#!/usr/bin/env bun

import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { holdE2eIdleSleep } from "./idleSleep";
import { laneShard, parseJobShard } from "./shardPlan";
import { shardTestListArgs } from "./shardTestLists";

async function main(): Promise<number> {
	await holdE2eIdleSleep();
	const playwrightArgs = ["-c", "playwright.binary.config.ts", ...process.argv.slice(2)];
	const listDir = mkdtempSync(join(tmpdir(), "thinkrail-e2e-test-lists-"));
	try {
		const [testListArgs = []] = await shardTestListArgs(
			playwrightArgs,
			[laneShard(parseJobShard(process.env.THINKRAIL_E2E_JOB_SHARD), 1, 1)],
			process.env,
			listDir,
		);
		const playwright = Bun.spawn(
			[process.execPath, "x", "playwright", "test", ...playwrightArgs, ...testListArgs],
			{
				stdin: "inherit",
				stdout: "inherit",
				stderr: "inherit",
			},
		);
		return await playwright.exited;
	} finally {
		rmSync(listDir, { recursive: true, force: true });
	}
}

try {
	process.exitCode = await main();
} catch (error) {
	console.error(error instanceof Error ? error.message : error);
	process.exitCode = 1;
}
