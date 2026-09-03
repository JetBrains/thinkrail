import { rmSync } from "node:fs";
import { createAgentRunPlan, WEB_BUILD_READY_ENV } from "./agentRunPlan";
import { E2E_DATA_DIR } from "./fixtures/paths";
import { holdE2eIdleSleep } from "./idleSleep";
import {
	PARENT_SIGNAL_OWNER_ENV,
	processRunnerInterruption,
	runE2eProcess,
	waitForE2eProcessDrain,
} from "./processRunner";
import { type E2eRunTiming, isPlaywrightListRun, startE2eRunTiming } from "./runTiming";

const bun = process.execPath;

async function main(playwrightArgs: string[], timing: E2eRunTiming): Promise<number> {
	await holdE2eIdleSleep();
	timing.setSelection({ playwrightArgs });
	const plan = createAgentRunPlan(bun, playwrightArgs, process.env, {
		webBuildReady: process.env[WEB_BUILD_READY_ENV] === "1",
	});
	if (plan.buildCommand) {
		const { exitCode } = await timing.timeBuild(() => runE2eProcess(plan.buildCommand));
		if (exitCode !== 0) return exitCode;
	}
	if (!isPlaywrightListRun(playwrightArgs)) rmSync(E2E_DATA_DIR, { recursive: true, force: true });
	delete plan.env[PARENT_SIGNAL_OWNER_ENV];
	return (
		await timing.timePhase("playwright", () =>
			runE2eProcess(plan.playwrightCommand, { env: plan.env }),
		)
	).exitCode;
}

const playwrightArgs = process.argv.slice(2);
const timing = startE2eRunTiming("agent", playwrightArgs);
let exitCode = 1;
try {
	exitCode = await main(playwrightArgs, timing);
} catch (error) {
	console.error(error instanceof Error ? error.message : error);
}
const interruption = processRunnerInterruption();
if (interruption) await waitForE2eProcessDrain();
timing.finish(exitCode, { interrupted: interruption !== null });
process.exitCode = exitCode;
