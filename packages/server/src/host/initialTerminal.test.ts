import { afterEach, beforeEach, expect, test } from "bun:test";
import { mkdirSync, mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { INITIAL_TERMINAL_TAB_KEY, type Workspace } from "@thinkrail/contracts";
import { loadWorkspaces, saveWorkspaces } from "../persistence";
import { listTerminals, resetTerminalState } from "../terminal";
import { provisionInitialTerminal } from "./initialTerminal";

let dataDir: string;
const savedDataDir = process.env.THINKRAIL_DATA_DIR;

function pendingWorkspace(): Workspace {
	return {
		id: "workspace",
		projectId: "project",
		name: "Workspace",
		branch: "workspace",
		worktreePath: join(dataDir, "worktree"),
		baseBranch: "main",
		initialTerminalPending: true,
	};
}

beforeEach(() => {
	dataDir = mkdtempSync(join(tmpdir(), "trpi-initial-terminal-test-"));
	process.env.THINKRAIL_DATA_DIR = dataDir;
	mkdirSync(join(dataDir, "worktree"));
	resetTerminalState();
});

afterEach(() => {
	resetTerminalState();
	rmSync(dataDir, { recursive: true, force: true });
	if (savedDataDir === undefined) delete process.env.THINKRAIL_DATA_DIR;
	else process.env.THINKRAIL_DATA_DIR = savedDataDir;
});

test("failed initial reservation stays pending; retry completes once without duplication", () => {
	const workspace = pendingWorkspace();
	saveWorkspaces([workspace]);
	mkdirSync(join(dataDir, "terminals.json"));

	const failed = provisionInitialTerminal(workspace);
	expect(failed.initialTerminalPending).toBe(true);
	expect(loadWorkspaces()[0]?.initialTerminalPending).toBe(true);
	expect(listTerminals(workspace.id)).toEqual([]);

	rmSync(join(dataDir, "terminals.json"), { recursive: true });
	const completed = provisionInitialTerminal(failed);
	const repeated = provisionInitialTerminal(completed);
	expect(completed.initialTerminalPending).toBeUndefined();
	expect(repeated.initialTerminalPending).toBeUndefined();
	expect(loadWorkspaces()[0]?.initialTerminalPending).toBeUndefined();
	expect(listTerminals(workspace.id)).toEqual([
		{ tabKey: INITIAL_TERMINAL_TAB_KEY, title: "Terminal 1" },
	]);
});
