import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

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
	const args = process.argv.slice(2);
	if (!args.includes("--list")) {
		const buildCode = await run([bun, "run", "build:web"]);
		if (buildCode !== 0) return buildCode;
	}
	const env = { ...process.env, THINKRAIL_E2E_SKIP_BUILD: "1" };
	const noAgentCode = await run([bun, join("e2e", "run.ts"), ...args], env);
	if (noAgentCode !== 0) return noAgentCode;
	return run([bun, join("e2e", "run-agent.ts"), ...args], env);
}

try {
	process.exitCode = await main();
} catch (error) {
	console.error(error instanceof Error ? error.message : error);
	process.exitCode = 1;
}
