import { rmSync } from "node:fs";
import { createAgentRunPlan, WEB_BUILD_READY_ENV } from "./agentRunPlan";
import { E2E_DATA_DIR } from "./fixtures/paths";
import { holdE2eIdleSleep } from "./idleSleep";
import { PARENT_SIGNAL_OWNER_ENV, runE2eProcess } from "./processRunner";

const bun = process.execPath;

async function main(): Promise<number> {
	await holdE2eIdleSleep();
	const playwrightArgs = process.argv.slice(2);
	const plan = createAgentRunPlan(bun, playwrightArgs, process.env, {
		webBuildReady: process.env[WEB_BUILD_READY_ENV] === "1",
	});
	if (plan.buildCommand) {
		const { exitCode } = await runE2eProcess(plan.buildCommand);
		if (exitCode !== 0) return exitCode;
	}
	if (!playwrightArgs.includes("--list")) rmSync(E2E_DATA_DIR, { recursive: true, force: true });
	delete plan.env[PARENT_SIGNAL_OWNER_ENV];
	return (await runE2eProcess(plan.playwrightCommand, { env: plan.env })).exitCode;
}

try {
	process.exitCode = await main();
} catch (error) {
	console.error(error instanceof Error ? error.message : error);
	process.exitCode = 1;
}
