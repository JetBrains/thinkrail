#!/usr/bin/env bun

import { holdE2eIdleSleep } from "./idleSleep";

async function main(): Promise<number> {
	await holdE2eIdleSleep();
	const playwright = Bun.spawn(
		[
			process.execPath,
			"x",
			"playwright",
			"test",
			"-c",
			"playwright.binary.config.ts",
			...process.argv.slice(2),
		],
		{
			stdin: "inherit",
			stdout: "inherit",
			stderr: "inherit",
		},
	);
	return playwright.exited;
}

try {
	process.exitCode = await main();
} catch (error) {
	console.error(error instanceof Error ? error.message : error);
	process.exitCode = 1;
}
