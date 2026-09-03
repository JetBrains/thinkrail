import { join } from "node:path";
import {
	CENTRAL_PLAYWRIGHT_RUNNER_AUTH_ENV,
	createAgentRunPlan,
	WEB_BUILD_READY_ENV,
} from "./agentRunPlan";
import { REAL_CENTRAL_E2E_ENV } from "./fixtures/centralAgent";
import {
	countSelectedPlaywrightTests,
	createPlaywrightListArgs,
	type FullRunPhase,
	selectFocusedFullRunPhases,
} from "./fullRunPlan";
import { holdE2eIdleSleep } from "./idleSleep";
import {
	PARENT_SIGNAL_OWNER_ENV,
	processRunnerInterruption,
	runE2eProcess,
	signalExitCode,
	waitForE2eProcessDrain,
} from "./processRunner";
import {
	type E2eRunTiming,
	isPlaywrightListRun,
	startE2eRunTiming,
	withE2eTimingParent,
} from "./runTiming";

const bun = process.execPath;

function noAgentEnv(): NodeJS.ProcessEnv {
	const env: NodeJS.ProcessEnv = { ...process.env, THINKRAIL_E2E_SKIP_BUILD: "1" };
	delete env.THINKRAIL_E2E_LANE;
	delete env.PLAYWRIGHT_BLOB_OUTPUT_FILE;
	delete env[REAL_CENTRAL_E2E_ENV];
	delete env[CENTRAL_PLAYWRIGHT_RUNNER_AUTH_ENV];
	return env;
}

function agentEnv(): NodeJS.ProcessEnv {
	return createAgentRunPlan(bun, ["--list"], process.env).env;
}

function phaseRunnerEnv(
	phase: FullRunPhase,
	webBuildReady: boolean,
	parentRunId: string,
): NodeJS.ProcessEnv {
	const env = withE2eTimingParent(phase === "agent" ? agentEnv() : noAgentEnv(), parentRunId);
	env[PARENT_SIGNAL_OWNER_ENV] = "1";
	if (phase === "agent" && webBuildReady) env[WEB_BUILD_READY_ENV] = "1";
	return env;
}

async function countSelectedTests(phase: FullRunPhase, args: readonly string[]): Promise<number> {
	const result = await runE2eProcess(
		[bun, "x", "playwright", "test", ...createPlaywrightListArgs(args)],
		{ env: phase === "agent" ? agentEnv() : noAgentEnv(), stdout: "pipe" },
	);
	const count = countSelectedPlaywrightTests(result.stdout);
	if (result.exitCode !== 0 && !(count === 0 && result.stdout.includes("No tests found"))) {
		throw new Error(`${phase} Playwright selection preflight exited ${result.exitCode}`);
	}
	return count;
}

async function runPhase(
	phase: FullRunPhase,
	args: readonly string[],
	webBuildReady: boolean,
	timing: E2eRunTiming,
): Promise<number> {
	const runner = phase === "agent" ? "run-agent.ts" : "run.ts";
	return (
		await timing.timePhase(phase, () =>
			runE2eProcess([bun, "--preload", "./e2e/idleSleepPreload.ts", join("e2e", runner), ...args], {
				env: phaseRunnerEnv(phase, webBuildReady, timing.runId),
			}),
		)
	).exitCode;
}

async function main(args: string[], timing: E2eRunTiming): Promise<number> {
	await holdE2eIdleSleep();
	const listOnly = isPlaywrightListRun(args);
	let phases: FullRunPhase[] = ["no-agent", "agent"];
	if (args.length > 0 && !listOnly) {
		const noAgentTests = await countSelectedTests("no-agent", args);
		const agentTests = await countSelectedTests("agent", args);
		phases = selectFocusedFullRunPhases(noAgentTests, agentTests);
	}
	timing.setSelection({ playwrightArgs: args, phases });
	let webBuildReady = false;
	if (!listOnly) {
		const { exitCode } = await timing.timeBuild(() => runE2eProcess([bun, "run", "build:web"]));
		if (exitCode !== 0) return exitCode;
		webBuildReady = true;
	}
	for (const phase of phases) {
		const exitCode = await runPhase(phase, args, webBuildReady, timing);
		if (exitCode !== 0) return exitCode;
	}
	return 0;
}

const args = process.argv.slice(2);
const timing = startE2eRunTiming("full", args);
let exitCode = 1;
try {
	exitCode = await main(args, timing);
} catch (error) {
	const interruption = processRunnerInterruption();
	if (interruption) exitCode = signalExitCode(interruption);
	else console.error(error instanceof Error ? error.message : error);
}
const interruption = processRunnerInterruption();
if (interruption) await waitForE2eProcessDrain();
timing.finish(exitCode, { interrupted: interruption !== null });
process.exitCode = exitCode;
