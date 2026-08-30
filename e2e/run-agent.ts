import { rmSync } from "node:fs";
import { dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { createAgentRunPlan } from "./agentRunPlan";
import { E2E_DATA_DIR } from "./fixtures/paths";

const rootDir = dirname(dirname(fileURLToPath(import.meta.url)));
const bun = process.execPath;

async function run(command: string[], env: NodeJS.ProcessEnv = process.env): Promise<number> {
	const child = Bun.spawn(command, {
		cwd: rootDir,
		env,
		stdin: "ignore",
		stdout: "inherit",
		stderr: "inherit",
	});
	return child.exited;
}

async function main(): Promise<number> {
	const playwrightArgs = process.argv.slice(2);
	const plan = createAgentRunPlan(bun, playwrightArgs);
	if (plan.buildCommand) {
		const buildCode = await run(plan.buildCommand);
		if (buildCode !== 0) return buildCode;
	}
	if (!playwrightArgs.includes("--list")) rmSync(E2E_DATA_DIR, { recursive: true, force: true });
	return run(plan.playwrightCommand, plan.env);
}

try {
	process.exitCode = await main();
} catch (error) {
	console.error(error instanceof Error ? error.message : error);
	process.exitCode = 1;
}
