import { PARENT_SIGNAL_OWNER_ENV, runE2eProcess } from "../processRunner";

const statePath = process.argv[2];
const cleanupPath = process.argv[3];
if (!statePath || !cleanupPath) {
	throw new Error("Nested signal runner state and cleanup paths are required");
}

const result = await runE2eProcess(
	[process.execPath, "e2e/fixtures/signal-runner.ts", statePath, cleanupPath],
	{
		env: { ...process.env, [PARENT_SIGNAL_OWNER_ENV]: "1" },
		terminationGraceMs: 500,
	},
);
process.exitCode = result.exitCode;
