import { join } from "node:path";
import {
	CENTRAL_PLAYWRIGHT_RUNNER_AUTH_ENV,
	createAgentRunPlan,
	WEB_BUILD_READY_ENV,
} from "./agentRunPlan";
import { REAL_CENTRAL_E2E_ENV } from "./fixtures/centralAgent";
import {
	countSelectedPlaywrightTests,
	type FullRunPhase,
	selectFocusedFullRunPhases,
} from "./fullRunPlan";
import {
	PARENT_SIGNAL_OWNER_ENV,
	processRunnerInterruption,
	runE2eProcess,
	signalExitCode,
} from "./processRunner";

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

function phaseRunnerEnv(phase: FullRunPhase, webBuildReady: boolean): NodeJS.ProcessEnv {
	const env = phase === "agent" ? agentEnv() : noAgentEnv();
	env[PARENT_SIGNAL_OWNER_ENV] = "1";
	if (phase === "agent" && webBuildReady) env[WEB_BUILD_READY_ENV] = "1";
	return env;
}

async function countSelectedTests(phase: FullRunPhase, args: readonly string[]): Promise<number> {
	const result = await runE2eProcess(
		[bun, "x", "playwright", "test", ...args, "--list", "--reporter=json", "--workers=1"],
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
): Promise<number> {
	const runner = phase === "agent" ? "run-agent.ts" : "run.ts";
	return (
		await runE2eProcess([bun, join("e2e", runner), ...args], {
			env: phaseRunnerEnv(phase, webBuildReady),
		})
	).exitCode;
}

async function main(): Promise<number> {
	const args = process.argv.slice(2);
	const listOnly = args.includes("--list");
	let phases: FullRunPhase[] = ["no-agent", "agent"];
	if (args.length > 0 && !listOnly) {
		const noAgentTests = await countSelectedTests("no-agent", args);
		const agentTests = await countSelectedTests("agent", args);
		phases = selectFocusedFullRunPhases(noAgentTests, agentTests);
	}
	let webBuildReady = false;
	if (!listOnly) {
		const { exitCode } = await runE2eProcess([bun, "run", "build:web"]);
		if (exitCode !== 0) return exitCode;
		webBuildReady = true;
	}
	for (const phase of phases) {
		const exitCode = await runPhase(phase, args, webBuildReady);
		if (exitCode !== 0) return exitCode;
	}
	return 0;
}

try {
	process.exitCode = await main();
} catch (error) {
	const interruption = processRunnerInterruption();
	if (interruption) process.exitCode = signalExitCode(interruption);
	else {
		console.error(error instanceof Error ? error.message : error);
		process.exitCode = 1;
	}
}
