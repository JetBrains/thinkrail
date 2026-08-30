import { rmSync } from "node:fs";
import { dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { REAL_CENTRAL_E2E_ENV } from "./fixtures/centralAgent";
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
	const listOnly = playwrightArgs.includes("--list");
	if (!listOnly && process.env.THINKRAIL_E2E_SKIP_BUILD !== "1") {
		const buildCode = await run([bun, "run", "build:web"]);
		if (buildCode !== 0) return buildCode;
	}
	if (!listOnly) rmSync(E2E_DATA_DIR, { recursive: true, force: true });

	const env: NodeJS.ProcessEnv = {
		...process.env,
		THINKRAIL_E2E_SKIP_BUILD: "1",
		[REAL_CENTRAL_E2E_ENV]: "1",
	};
	delete env.THINKRAIL_E2E_LANE;
	delete env.PLAYWRIGHT_BLOB_OUTPUT_FILE;
	return run([bun, "x", "playwright", "test", ...playwrightArgs, "--workers=1"], env);
}

try {
	process.exitCode = await main();
} catch (error) {
	console.error(error instanceof Error ? error.message : error);
	process.exitCode = 1;
}
