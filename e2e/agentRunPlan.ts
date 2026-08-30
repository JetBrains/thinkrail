import { REAL_CENTRAL_E2E_ENV } from "./fixtures/centralAgent";

export interface AgentRunPlan {
	buildCommand: string[] | null;
	playwrightCommand: string[];
	env: NodeJS.ProcessEnv;
}

export function createAgentRunPlan(
	bun: string,
	playwrightArgs: string[],
	env: NodeJS.ProcessEnv = process.env,
): AgentRunPlan {
	const listOnly = playwrightArgs.includes("--list");
	const childEnv: NodeJS.ProcessEnv = {
		...env,
		THINKRAIL_E2E_SKIP_BUILD: "1",
		[REAL_CENTRAL_E2E_ENV]: "1",
	};
	delete childEnv.THINKRAIL_E2E_LANE;
	delete childEnv.PLAYWRIGHT_BLOB_OUTPUT_FILE;
	return {
		buildCommand:
			listOnly || env.THINKRAIL_E2E_SKIP_BUILD === "1" ? null : [bun, "run", "build:web"],
		playwrightCommand: [bun, "x", "playwright", "test", ...playwrightArgs, "--workers=1"],
		env: childEnv,
	};
}
