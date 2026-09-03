#!/usr/bin/env bun

import { holdE2eIdleSleep } from "./idleSleep";
import { type E2eRunTiming, startE2eRunTiming } from "./runTiming";

async function main(args: string[], timing: E2eRunTiming): Promise<number> {
	await holdE2eIdleSleep();
	timing.setSelection({ playwrightArgs: args });
	const playwright = Bun.spawn(
		[process.execPath, "x", "playwright", "test", "-c", "playwright.binary.config.ts", ...args],
		{
			stdin: "inherit",
			stdout: "inherit",
			stderr: "inherit",
		},
	);
	return timing.timePhase("playwright", () => playwright.exited);
}

const args = process.argv.slice(2);
const timing = startE2eRunTiming("binary", args);
let exitCode = 1;
try {
	exitCode = await main(args, timing);
} catch (error) {
	console.error(error instanceof Error ? error.message : error);
}
timing.finish(exitCode);
process.exitCode = exitCode;
