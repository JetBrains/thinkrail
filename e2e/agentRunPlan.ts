import { stripAmbientPiCredentials } from "./ambientCredentials";
import { isRealCentralE2e, REAL_CENTRAL_E2E_ENV } from "./fixtures/centralAgent";

export const CENTRAL_PLAYWRIGHT_RUNNER_AUTH_ENV = "THINKRAIL_E2E_CENTRAL_RUNNER_AUTHORIZED";
export const WEB_BUILD_READY_ENV = "THINKRAIL_E2E_WEB_BUILD_READY";

export interface AgentRunPlan {
	buildCommand: string[] | null;
	playwrightCommand: string[];
	env: NodeJS.ProcessEnv;
}

export function assertCentralPlaywrightRunner(
	env: NodeJS.ProcessEnv,
	args: readonly string[],
): void {
	const authorized =
		env.THINKRAIL_E2E_SKIP_BUILD === "1" && env[CENTRAL_PLAYWRIGHT_RUNNER_AUTH_ENV] === "1";
	if (isRealCentralE2e(env) && !authorized && !args.includes("--list")) {
		throw new Error(
			"Real-Central Playwright execution must use `bun run e2e:agent` or `bun run e2e:full`",
		);
	}
}

export function createAgentRunPlan(
	bun: string,
	playwrightArgs: string[],
	env: NodeJS.ProcessEnv = process.env,
	options: { webBuildReady?: boolean } = {},
): AgentRunPlan {
	const listOnly = playwrightArgs.includes("--list");
	const buildCommand =
		listOnly || options.webBuildReady === true ? null : [bun, "run", "build:web"];
	const childEnv = stripAmbientPiCredentials({
		...env,
		THINKRAIL_E2E_SKIP_BUILD: "1",
		[REAL_CENTRAL_E2E_ENV]: "1",
	});
	childEnv[CENTRAL_PLAYWRIGHT_RUNNER_AUTH_ENV] = "1";
	delete childEnv[WEB_BUILD_READY_ENV];
	delete childEnv.THINKRAIL_E2E_LANE;
	delete childEnv.PLAYWRIGHT_BLOB_OUTPUT_FILE;
	return {
		buildCommand,
		playwrightCommand: [bun, "x", "playwright", "test", ...playwrightArgs, "--workers=1"],
		env: childEnv,
	};
}
