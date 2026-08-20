import { defaultSessionDirFor, writeFixtureSession } from "@thinkrail/server/history-test-fixtures";
import { E2E_PI_AGENT_DIR } from "./paths";

export const E2E_EXTERNAL_CWD = "/tmp/thinkrail-e2e-external";

const BASE_TS = 1_700_000_000_000;

export function seedExternalCwdSessions(agentDir: string = E2E_PI_AGENT_DIR): void {
	const dir = defaultSessionDirFor(agentDir, E2E_EXTERNAL_CWD);

	writeFixtureSession(dir, {
		id: "e2e-fixture-deploy-docs",
		cwd: E2E_EXTERNAL_CWD,
		messages: [
			{ role: "user", text: "deploy the docs site", timestamp: BASE_TS },
			{
				role: "assistant",
				text: "Deployed the docs site — all checks green.",
				timestamp: BASE_TS + 1_000,
			},
			{ role: "user", text: "fix the flaky watcher test", timestamp: BASE_TS + 2_000 },
			{
				role: "assistant",
				text: "Fixed it: the debounce window overlaps with the poll interval, so I widened it.",
				timestamp: BASE_TS + 3_000,
			},
		],
	});

	writeFixtureSession(dir, {
		id: "e2e-fixture-dependency-pins",
		cwd: E2E_EXTERNAL_CWD,
		messages: [{ role: "user", text: "update dependency pins", timestamp: BASE_TS + 10_000 }],
	});
}

export function seedWorkspaceSession(
	worktreePath: string,
	opts: Omit<Parameters<typeof writeFixtureSession>[1], "cwd">,
): { id: string; path: string } {
	const dir = defaultSessionDirFor(E2E_PI_AGENT_DIR, worktreePath);
	return writeFixtureSession(dir, { ...opts, cwd: worktreePath });
}
