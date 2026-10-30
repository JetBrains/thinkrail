import { afterEach, beforeEach, expect, test } from "bun:test";
import { mkdirSync, mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { Workspace } from "@thinkrail/contracts";
import { removeTree } from "@thinkrail/shared/removeTree";
import { saveWorkspaces } from "../persistence";
import {
	attachTerminal,
	type CommandTabEnd,
	closeAllTerminals,
	closeTerminalTab,
	closeWorkspaceTerminals,
	listTerminals,
	onCommandTabEnded,
	readTerminalRecording,
	resetTerminalState,
	setTerminalPublisher,
	setTerminalTabsPublisher,
	startCommandTab,
	stopCommandTab,
} from "./terminalManager";

const WS = "ws-run";
const TAB = "thinkrail-run:dev";
const END_TIMEOUT_MS = 15_000;
const STOP_TEST_TIMEOUT_MS = 20_000;

let dataDir: string;
const savedDataDir = process.env.THINKRAIL_DATA_DIR;
let ends: CommandTabEnd[] = [];
const endSignals = new Set<() => void>();

function waitForEnd(
	predicate: (end: CommandTabEnd) => boolean = () => true,
): Promise<CommandTabEnd> {
	const found = ends.find(predicate);
	if (found) return Promise.resolve(found);
	return new Promise((resolve, reject) => {
		const timeout = setTimeout(() => {
			endSignals.delete(signal);
			reject(new Error(`Timed out after ${END_TIMEOUT_MS}ms waiting for a command tab to end`));
		}, END_TIMEOUT_MS);
		const signal = () => {
			const end = ends.find(predicate);
			if (!end) return;
			clearTimeout(timeout);
			endSignals.delete(signal);
			resolve(end);
		};
		endSignals.add(signal);
	});
}

async function waitForRecording(tabKey: string, marker: string): Promise<string> {
	const deadline = Date.now() + END_TIMEOUT_MS;
	while (Date.now() < deadline) {
		const recording = readTerminalRecording(WS, tabKey, 1_000_000);
		if (recording?.includes(marker)) return recording;
		await Bun.sleep(20);
	}
	throw new Error(`Timed out waiting for ${marker} in the recording of ${tabKey}`);
}

function isAlive(pid: number): boolean {
	try {
		process.kill(pid, 0);
		return true;
	} catch {
		return false;
	}
}

async function waitForDeath(pid: number): Promise<void> {
	const deadline = Date.now() + END_TIMEOUT_MS;
	while (Date.now() < deadline) {
		if (!isAlive(pid)) return;
		await Bun.sleep(20);
	}
	throw new Error(`Process ${pid} is still alive`);
}

beforeEach(() => {
	dataDir = mkdtempSync(join(tmpdir(), "trpi-command-tab-test-"));
	process.env.THINKRAIL_DATA_DIR = dataDir;
	const worktreePath = join(dataDir, "worktree");
	mkdirSync(worktreePath);
	saveWorkspaces([{ id: WS, worktreePath } as Workspace]);
	ends = [];
	endSignals.clear();
	onCommandTabEnded((end) => {
		ends.push(end);
		for (const signal of endSignals) signal();
	});
	setTerminalPublisher(() => "delivered");
});

afterEach(() => {
	resetTerminalState();
	setTerminalPublisher(() => "unavailable");
	setTerminalTabsPublisher(() => {});
	removeTree(dataDir);
	if (savedDataDir === undefined) delete process.env.THINKRAIL_DATA_DIR;
	else process.env.THINKRAIL_DATA_DIR = savedDataDir;
});

test.skipIf(process.platform === "win32")(
	"a command tab reports the script's exit code and keeps its last screen for a non-spawning attach",
	async () => {
		startCommandTab(WS, TAB, "Run: dev", { script: "printf 'TR_%s\\n' 'OUT'; exit 3", env: {} });
		expect(listTerminals(WS)).toEqual([{ tabKey: TAB, title: "Run: dev", kind: "command" }]);

		const end = await waitForEnd();
		expect(end).toEqual({ workspaceId: WS, tabKey: TAB, reason: "exit", exitCode: 3 });
		expect(readTerminalRecording(WS, TAB, 1_000_000)).toContain("TR_OUT");

		const attached = attachTerminal(WS, TAB, "client-1");
		expect(attached.exited).toBe(true);
		expect(attached.created).toBe(false);
		expect(attached.replay).toContain("TR_OUT");
		expect(listTerminals(WS)).toHaveLength(1);
	},
);

test.skipIf(process.platform === "win32")(
	"compound commands run to the end and injected variables survive the environment filter",
	async () => {
		startCommandTab(WS, TAB, "Run: dev", {
			script: "printf a; printf b && printf c; printf '%s' \"-$PORT-$THINKRAIL_RUN_TARGET-\"",
			env: { PORT: "5174", THINKRAIL_RUN_TARGET: "dev" },
		});
		const end = await waitForEnd();
		expect(end.exitCode).toBe(0);
		expect(readTerminalRecording(WS, TAB, 1_000_000)).toContain("abc-5174-dev-");
	},
);

test.skipIf(process.platform === "win32")(
	"stopping kills the whole process group, including a grandchild, and reads as stopped",
	async () => {
		startCommandTab(WS, TAB, "Run: dev", {
			script: "sh -c 'echo PID_$$_PID; exec sleep 1000' & wait",
			env: {},
		});
		const recording = await waitForRecording(TAB, "_PID");
		const pid = Number(/PID_(\d+)_PID/.exec(recording)?.[1]);
		expect(isAlive(pid)).toBe(true);

		expect(stopCommandTab(WS, TAB)).toBe(true);
		const end = await waitForEnd();
		expect(end.reason).toBe("stopped");
		await waitForDeath(pid);
		expect(stopCommandTab(WS, TAB)).toBe(false);
	},
	STOP_TEST_TIMEOUT_MS,
);

test.skipIf(process.platform === "win32")(
	"a process that ignores SIGTERM is killed after the grace period",
	async () => {
		startCommandTab(WS, TAB, "Run: dev", {
			script: "trap '' TERM; echo READY; sleep 1000",
			env: {},
		});
		await waitForRecording(TAB, "READY");
		stopCommandTab(WS, TAB);
		const end = await waitForEnd();
		expect(end.reason).toBe("stopped");
	},
	STOP_TEST_TIMEOUT_MS,
);

test.skipIf(process.platform === "win32")(
	"a live command tab is busy to close; a forced close ends it as closed",
	async () => {
		startCommandTab(WS, TAB, "Run: dev", { script: "echo READY; sleep 1000", env: {} });
		await waitForRecording(TAB, "READY");
		expect(closeTerminalTab(WS, TAB)).toEqual({ closed: false, busy: true });
		expect(closeTerminalTab(WS, TAB, true)).toEqual({ closed: true, busy: false });
		const end = await waitForEnd();
		expect(end).toEqual({ workspaceId: WS, tabKey: TAB, reason: "closed", exitCode: null });
		expect(listTerminals(WS)).toEqual([]);
	},
);

test.skipIf(process.platform === "win32")(
	"closing the workspace and stopping the host report every live command tab",
	async () => {
		startCommandTab(WS, TAB, "Run: dev", { script: "echo READY; sleep 1000", env: {} });
		await waitForRecording(TAB, "READY");
		closeWorkspaceTerminals(WS);
		expect((await waitForEnd()).reason).toBe("workspace-closed");

		ends = [];
		startCommandTab(WS, TAB, "Run: dev", { script: "echo READY; sleep 1000", env: {} });
		await waitForRecording(TAB, "READY");
		closeAllTerminals();
		expect((await waitForEnd()).reason).toBe("host-stop");
	},
);

test.skipIf(process.platform === "win32")(
	"a running command tab cannot be started twice, and a restart gets a fresh recording",
	async () => {
		startCommandTab(WS, TAB, "Run: dev", { script: "echo FIRST; sleep 1000", env: {} });
		await waitForRecording(TAB, "FIRST");
		expect(() => startCommandTab(WS, TAB, "Run: dev", { script: "true", env: {} })).toThrow(
			"already running",
		);
		stopCommandTab(WS, TAB, { force: true });
		await waitForEnd();

		startCommandTab(WS, TAB, "Run: dev", { script: "echo SECOND", env: {} });
		await waitForEnd((end) => end.reason === "exit");
		const recording = readTerminalRecording(WS, TAB, 1_000_000) ?? "";
		expect(recording).toContain("SECOND");
		expect(recording).not.toContain("FIRST");
	},
);

test("a command tab needs its namespace and a known workspace, and a failed start leaves no tab", () => {
	expect(() => startCommandTab(WS, "tab-a", "Run", { script: "true", env: {} })).toThrow(
		"namespace",
	);
	expect(() => startCommandTab("ws-missing", TAB, "Run", { script: "true", env: {} })).toThrow(
		"Unknown workspace",
	);
	expect(listTerminals("ws-missing")).toEqual([]);
});
