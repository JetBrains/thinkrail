import type { RunExecution } from "@thinkrail/contracts";

export const RUN_SKILL = "running-the-project";

export const SETUP_RUN_PROMPT = `/skill:${RUN_SKILL} Set up how this project is prepared and run in this workspace: learn the recipe, try it, and save it with run_project.`;

export function fixRunPrompt(execution: RunExecution | null, targetLabel: string | null): string {
	const target = targetLabel ?? execution?.targetId ?? "the primary target";
	if (!execution) {
		return `/skill:${RUN_SKILL} The project's run target "${target}" needs attention; diagnose with run_project and fix the project code or the recipe.`;
	}
	const run = `run ${execution.runId}`;
	const state =
		execution.status === "exited"
			? `exited with code ${execution.exitCode ?? "unknown"}`
			: execution.status === "stopped"
				? "was stopped"
				: "is running and the user asked for help with it";
	return `/skill:${RUN_SKILL} Run target "${target}" (${run}) ${state} in this workspace. Inspect it with run_project output (runId ${execution.runId}) and run_project recipe, fix the project code or the recipe, then verify with run_project run.`;
}
