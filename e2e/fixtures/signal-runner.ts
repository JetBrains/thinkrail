import { runE2eProcess } from "../processRunner";

const statePath = process.argv[2];
const cleanupPath = process.argv[3];
if (!statePath || !cleanupPath)
	throw new Error("Signal runner state and cleanup paths are required");
const result = await runE2eProcess(
	[
		process.execPath,
		"e2e/fixtures/signal-tree-child.ts",
		statePath,
		cleanupPath,
		String(process.pid),
	],
	{ terminationGraceMs: 500 },
);
process.exitCode = result.exitCode;
