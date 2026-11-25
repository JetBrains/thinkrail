import { afterEach, beforeEach, expect, onTestFinished, spyOn, test } from "bun:test";
import { randomUUID } from "node:crypto";
import { chmodSync, mkdirSync, mkdtempSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { type Workspace, WS_CHANNELS } from "@thinkrail/contracts";
import { removeTree } from "@thinkrail/shared/removeTree";
import { saveWorkspaces } from "../persistence";
import { resetConfigCache } from "../settings";
import * as terminal from "../terminal";
import { getWorkspace, setWorkspacePublisher, setWorkspaceReview } from "../workspaces";
import { handleRequest } from "./handlers";

const CTX = { clientKey: "terminal-activity-client" };
const FOCUS_IN = "\u001b[I";
const FOCUS_OUT = "\u001b[O";
const ENV_NAMES = ["THINKRAIL_DATA_DIR", "PI_CODING_AGENT_DIR", "SHELL", "HOME"] as const;
const savedEnv = new Map(ENV_NAMES.map((name) => [name, process.env[name]]));
let dataDir: string;
let workspace: Workspace;
let updates: unknown[];

beforeEach(() => {
	dataDir = mkdtempSync(join(tmpdir(), "trpi-terminal-activity-"));
	process.env.THINKRAIL_DATA_DIR = dataDir;
	process.env.PI_CODING_AGENT_DIR = join(dataDir, "pi");
	process.env.HOME = dataDir;
	resetConfigCache();
	const worktreePath = join(dataDir, "worktree");
	mkdirSync(worktreePath);
	workspace = {
		id: randomUUID(),
		projectId: "terminal-activity-project",
		name: "Parked work",
		branch: "parked-work",
		baseBranch: "main",
		worktreePath,
		lastActiveAt: 1,
		settledOverride: "settled",
		settledAt: 2,
	};
	saveWorkspaces([workspace]);
	updates = [];
	setWorkspacePublisher((event) => updates.push(event));
});

afterEach(() => {
	terminal.resetTerminalState();
	terminal.setTerminalPublisher(() => "unavailable");
	terminal.setTerminalTabsPublisher(() => {});
	setWorkspacePublisher(null);
	resetConfigCache();
	removeTree(dataDir);
	for (const [name, value] of savedEnv) {
		if (value === undefined) delete process.env[name];
		else process.env[name] = value;
	}
});

test.each([
	["focus in", FOCUS_IN, false],
	["focus out", FOCUS_OUT, false],
	["consecutive focus reports", FOCUS_IN + FOCUS_OUT + FOCUS_IN, false],
	["empty input", "", false],
	["typing", "work", true],
	["mixed focus and typing", `${FOCUS_IN}work${FOCUS_OUT}`, true],
	["Enter after a focus report", `${FOCUS_IN}\r`, true],
	["newline after a focus report", `${FOCUS_OUT}\n`, true],
	["space", " ", true],
	["arrow key", "\u001b[A", true],
	["Escape key", "\u001b", true],
	["partial focus prefix", "\u001b[", true],
	["partial focus suffix", "[I", true],
])("terminal.write attributes %s without altering the input", async (_name, data, active) => {
	const write = spyOn(terminal, "writeTerminal").mockReturnValue(workspace.id);
	onTestFinished(() => write.mockRestore());
	const before = readFileSync(join(dataDir, "workspaces.json"), "utf8");
	expect(await handleRequest("terminal.write", { id: "fixture-pty", data }, CTX)).toEqual({
		ok: true,
	});
	expect(write).toHaveBeenCalledTimes(1);
	expect(write).toHaveBeenCalledWith("fixture-pty", data, CTX.clientKey);
	if (active) {
		const current = getWorkspace(workspace.id);
		expect(current.settledOverride).toBeUndefined();
		expect(current.settledAt).toBeUndefined();
		expect(current.lastActiveAt).toBeGreaterThan(1);
		expect(updates).toHaveLength(1);
	} else {
		expect(readFileSync(join(dataDir, "workspaces.json"), "utf8")).toBe(before);
		expect(updates).toEqual([]);
	}
});

test("a displaced write cannot reactivate the terminal's workspace", async () => {
	const write = spyOn(terminal, "writeTerminal").mockReturnValue(null);
	onTestFinished(() => write.mockRestore());
	await handleRequest("terminal.write", { id: "displaced-pty", data: "work" }, CTX);
	expect(getWorkspace(workspace.id)).toEqual(workspace);
	expect(updates).toEqual([]);
});

test("focus leaves an explicit active pin unchanged", async () => {
	saveWorkspaces([{ ...workspace, settledOverride: "active" }]);
	const write = spyOn(terminal, "writeTerminal").mockReturnValue(workspace.id);
	onTestFinished(() => write.mockRestore());
	await handleRequest("terminal.write", { id: "fixture-pty", data: FOCUS_IN }, CTX);
	expect(getWorkspace(workspace.id)).toEqual({ ...workspace, settledOverride: "active" });
	expect(updates).toEqual([]);
});

test("a focus report cannot become coalesced activity when a later review refresh reports a merge", async () => {
	const lastActiveAt = Date.now() - 2_000;
	const row: Workspace = {
		...workspace,
		lastActiveAt,
		review: { kind: "pull-request", number: 7, state: "open" },
	};
	delete row.settledOverride;
	delete row.settledAt;
	saveWorkspaces([row]);
	const write = spyOn(terminal, "writeTerminal").mockReturnValue(workspace.id);
	onTestFinished(() => write.mockRestore());
	await handleRequest("terminal.write", { id: "fixture-pty", data: FOCUS_OUT }, CTX);
	const review = {
		kind: "pull-request",
		number: 7,
		state: "merged",
		changedAt: lastActiveAt + 1_000,
	} as const;
	setWorkspaceReview(workspace.id, review, workspace.branch);
	expect(getWorkspace(workspace.id).lastActiveAt).toBe(lastActiveAt);
	expect(getWorkspace(workspace.id).review).toEqual(review);
	expect(updates).toHaveLength(1);
});

test.skipIf(process.platform === "win32")(
	"real PTY focus bytes arrive intact without waking a parked workspace, and mixed typing does wake it",
	async () => {
		const shell = join(dataDir, "echo-input.js");
		writeFileSync(
			shell,
			`#!${process.execPath}\n` +
				"process.stdin.setRawMode(true);\nlet received = Buffer.alloc(0);\n" +
				'process.stdin.on("data", (data) => { received = Buffer.concat([received, data]); process.stdout.write("INPUT:" + received.toString("hex") + ";END\\n"); });\n' +
				'process.stdin.resume();\nprocess.stdout.write("READY\\n");\n',
		);
		chmodSync(shell, 0o755);
		process.env.SHELL = shell;
		let output = "";
		terminal.setTerminalPublisher((_client, channel, data) => {
			if (
				channel === WS_CHANNELS.terminalData &&
				typeof data === "object" &&
				data !== null &&
				"data" in data &&
				typeof data.data === "string"
			) {
				output += data.data;
			}
			return "delivered";
		});
		const waitFor = async (text: string) => {
			const deadline = Date.now() + 10_000;
			while (!output.includes(text)) {
				if (Date.now() > deadline) throw new Error(`PTY did not print ${text}: ${output}`);
				await Bun.sleep(10);
			}
		};
		const attached = (await handleRequest(
			"terminal.attach",
			{ workspaceId: workspace.id, tabKey: "focus-reports" },
			CTX,
		)) as terminal.AttachResult;
		await waitFor("READY");
		const before = readFileSync(join(dataDir, "workspaces.json"), "utf8");
		let received = "";
		for (const data of [FOCUS_IN, FOCUS_OUT, FOCUS_IN + FOCUS_OUT]) {
			await handleRequest("terminal.write", { id: attached.id, data }, CTX);
			received += data;
			await waitFor(`INPUT:${Buffer.from(received).toString("hex")};END`);
			expect(readFileSync(join(dataDir, "workspaces.json"), "utf8")).toBe(before);
		}
		await handleRequest(
			"terminal.write",
			{ id: attached.id, data: "displaced" },
			{ clientKey: "not-attached" },
		);
		expect(getWorkspace(workspace.id)).toEqual(workspace);
		expect(updates).toEqual([]);
		const mixed = `${FOCUS_IN}real work\r${FOCUS_OUT}`;
		await handleRequest("terminal.write", { id: attached.id, data: mixed }, CTX);
		received += mixed;
		await waitFor(`INPUT:${Buffer.from(received).toString("hex")};END`);
		expect(getWorkspace(workspace.id).settledOverride).toBeUndefined();
		expect(getWorkspace(workspace.id).lastActiveAt).toBeGreaterThan(1);
		expect(updates).toHaveLength(1);
	},
	30_000,
);
