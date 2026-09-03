import {
	PARENT_SIGNAL_OWNER_ENV,
	processRunnerInterruption,
	runE2eProcess,
	waitForE2eProcessDrain,
} from "../processRunner";
import { E2E_TIMING_FILE_ENV, startE2eRunTiming } from "../runTiming";

const statePath = process.argv[2];
const cleanupPath = process.argv[3];
const timingPath = process.argv[4];
if (!statePath || !cleanupPath) {
	throw new Error("Nested signal runner state and cleanup paths are required");
}

const timing = timingPath
	? startE2eRunTiming("no-agent", [], {
			env: { ...process.env, [E2E_TIMING_FILE_ENV]: timingPath },
		})
	: null;
const result = await runE2eProcess(
	[process.execPath, "e2e/fixtures/signal-runner.ts", statePath, cleanupPath],
	{
		env: { ...process.env, [PARENT_SIGNAL_OWNER_ENV]: "1" },
		terminationGraceMs: 500,
	},
);
await waitForE2eProcessDrain();
timing?.finish(result.exitCode, { interrupted: processRunnerInterruption() !== null });
process.exitCode = result.exitCode;
