import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import { mkdirSync, mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { Workspace } from "@thinkrail/contracts";
import { saveTerminalSessions, saveWorkspaces } from "../persistence";
import {
	attachTerminal,
	closeTerminalTab,
	closeWorkspaceTerminals,
	listTerminals,
	persistTerminalSessions,
	reserveTerminal,
	resetTerminalState,
	resizeTerminal,
	reviveTerminalSessions,
	setTerminalPublisher,
	setTerminalTabsPublisher,
	writeTerminal,
} from "./terminalManager";

const WS = "ws-1";
let dataDir: string;
const savedDataDir = process.env.THINKRAIL_DATA_DIR;

let pushed: { clientKey: string; channel: string; data: unknown }[] = [];

beforeEach(() => {
	dataDir = mkdtempSync(join(tmpdir(), "trpi-terminal-test-"));
	process.env.THINKRAIL_DATA_DIR = dataDir;
	const worktreePath = join(dataDir, "worktree");
	mkdirSync(worktreePath);
	saveWorkspaces([{ id: WS, worktreePath } as Workspace]);
	pushed = [];
	setTerminalPublisher((clientKey, channel, data) => {
		pushed.push({ clientKey, channel, data });
		return "delivered";
	});
});

afterEach(() => {
	resetTerminalState();
	setTerminalPublisher(() => "unavailable");
	setTerminalTabsPublisher(() => {});
	rmSync(dataDir, { recursive: true, force: true });
	if (savedDataDir === undefined) delete process.env.THINKRAIL_DATA_DIR;
	else process.env.THINKRAIL_DATA_DIR = savedDataDir;
});

test("attaching twice to a tab returns the SAME shell", () => {
	const first = attachTerminal(WS, "tab-a", "client-1");
	const second = attachTerminal(WS, "tab-a", "client-1");

	expect(first.created).toBe(true);
	expect(second.created).toBe(false);
	expect(second.id).toBe(first.id);
});

test("re-entering after the view went away adopts the shell instead of spawning a second one", () => {
	const original = attachTerminal(WS, "tab-a", "client-1");
	const afterLeaving = attachTerminal(WS, "tab-a", "client-1");
	const afterLeavingAgain = attachTerminal(WS, "tab-a", "client-1");

	expect(afterLeaving.id).toBe(original.id);
	expect(afterLeavingAgain.id).toBe(original.id);
	expect(listTerminals(WS)).toHaveLength(1);
});

test("concurrent attaches on one tab cannot both spawn", () => {
	const results = [1, 2, 3, 4].map(() => attachTerminal(WS, "tab-a", "client-1"));

	expect(new Set(results.map((r) => r.id)).size).toBe(1);
	expect(results.filter((r) => r.created)).toHaveLength(1);
});

test("different tabs get different shells", () => {
	const a = attachTerminal(WS, "tab-a", "client-1");
	const b = attachTerminal(WS, "tab-b", "client-1");

	expect(b.id).not.toBe(a.id);
	expect(listTerminals(WS).map((t) => t.tabKey)).toEqual(["tab-a", "tab-b"]);
});

test("a second client takes the tab over and the first is told", () => {
	attachTerminal(WS, "tab-a", "client-1");
	pushed = [];

	const taken = attachTerminal(WS, "tab-a", "client-2");

	expect(taken.created).toBe(false);
	const detached = pushed.filter((frame) => frame.channel === "terminal.detached");
	expect(detached).toHaveLength(1);
	expect(detached[0]?.clientKey).toBe("client-1");
	expect(detached[0]?.data).toEqual({ workspaceId: WS, tabKey: "tab-a" });
});

test("re-attaching as the same client does not announce a takeover", () => {
	attachTerminal(WS, "tab-a", "client-1");
	pushed = [];

	attachTerminal(WS, "tab-a", "client-1");

	expect(pushed.filter((frame) => frame.channel === "terminal.detached")).toHaveLength(0);
});

test("reserving a tab persists catalog membership without starting its shell", () => {
	const seen: unknown[] = [];
	setTerminalTabsPublisher((workspaceId, tabs) => seen.push({ workspaceId, tabs }));

	expect(reserveTerminal(WS, "tab-a", "Reserved")).toEqual({
		tabKey: "tab-a",
		title: "Reserved",
	});
	expect(reserveTerminal(WS, "tab-a", "Ignored rename")).toEqual({
		tabKey: "tab-a",
		title: "Reserved",
	});
	expect(listTerminals(WS)).toEqual([{ tabKey: "tab-a", title: "Reserved" }]);
	expect(seen).toEqual([{ workspaceId: WS, tabs: [{ tabKey: "tab-a", title: "Reserved" }] }]);
	expect(attachTerminal(WS, "tab-a", "client-1").created).toBe(true);

	resetTerminalState();
	reviveTerminalSessions();
	expect(listTerminals(WS)).toEqual([{ tabKey: "tab-a", title: "Reserved" }]);
});

test("a failed reservation persistence rolls back without publishing membership", () => {
	const seen: unknown[] = [];
	setTerminalTabsPublisher((workspaceId, tabs) => seen.push({ workspaceId, tabs }));
	mkdirSync(join(dataDir, "terminals.json"));

	expect(() => reserveTerminal(WS, "tab-a", "Reserved")).toThrow();
	expect(listTerminals(WS)).toEqual([]);
	expect(seen).toEqual([]);
});

test("reservations and attachments reject malformed or excessive catalog entries", () => {
	expect(() => reserveTerminal(WS, "", "Terminal")).toThrow("Invalid terminal tab key");
	expect(() => reserveTerminal(WS, "x".repeat(501), "Terminal")).toThrow(
		"Invalid terminal tab key",
	);
	expect(() => reserveTerminal(WS, "tab-a", "")).toThrow("Invalid terminal title");
	expect(() => reserveTerminal(WS, "tab-a", "x".repeat(1001))).toThrow("Invalid terminal title");
	expect(() => attachTerminal(WS, "", "client-1")).toThrow("Invalid terminal tab key");
	expect(() => attachTerminal(WS, "tab-a", "client-1", { title: "" })).toThrow(
		"Invalid terminal title",
	);
	for (let index = 0; index < 256; index += 1) {
		reserveTerminal(WS, `tab-${index}`, `Terminal ${index}`);
	}
	expect(() => reserveTerminal(WS, "tab-over-limit", "Terminal")).toThrow(
		"Terminal tabs are limited to 256 per workspace",
	);
	expect(() => attachTerminal(WS, "tab-over-limit", "client-1")).toThrow(
		"Terminal tabs are limited to 256 per workspace",
	);
});

test("revival bounds the catalog and sanitizes durable identities", () => {
	saveTerminalSessions({
		[WS]: [
			{ tabKey: "", title: "Dropped" },
			{ tabKey: "x".repeat(501), title: "Dropped" },
			{ tabKey: "kept", title: "" },
		],
	});
	reviveTerminalSessions();
	expect(listTerminals(WS)).toEqual([{ tabKey: "kept", title: "Terminal" }]);

	resetTerminalState();
	saveTerminalSessions({
		[WS]: Array.from({ length: 300 }, (_, index) => ({
			tabKey: `tab-${index}`,
			title: `Terminal ${index}`,
		})),
	});
	reviveTerminalSessions();
	expect(listTerminals(WS)).toHaveLength(256);
	expect(listTerminals(WS).at(-1)?.tabKey).toBe("tab-255");
});

test("the tab list is the host's, in creation order", () => {
	attachTerminal(WS, "tab-a", "client-1", { title: "One" });
	attachTerminal(WS, "tab-b", "client-1", { title: "Two" });

	expect(listTerminals(WS)).toEqual([
		{ tabKey: "tab-a", title: "One" },
		{ tabKey: "tab-b", title: "Two" },
	]);
});

test("closing a tab removes it and reports closed", () => {
	attachTerminal(WS, "tab-a", "client-1");

	expect(closeTerminalTab(WS, "tab-a")).toEqual({ closed: true, busy: false });
	expect(listTerminals(WS)).toHaveLength(0);
});

test("closing an unknown tab is not an error and not busy", () => {
	expect(closeTerminalTab(WS, "never-existed")).toEqual({ closed: false, busy: false });
});

test("a shell with something running refuses to close until forced", async () => {
	const attached = attachTerminal(WS, "tab-a", "client-1");
	expect(attached.created).toBe(true);
	await Bun.sleep(600);
	writeTerminal(attached.id, "sleep 30\r", "client-1");
	await Bun.sleep(800);

	const refused = closeTerminalTab(WS, "tab-a");
	expect(refused).toEqual({ closed: false, busy: true });
	expect(listTerminals(WS)).toHaveLength(1);

	expect(closeTerminalTab(WS, "tab-a", true)).toEqual({ closed: true, busy: false });
	expect(listTerminals(WS)).toHaveLength(0);
});

test("a host restart gives the tabs back with fresh shells showing the old output", async () => {
	const first = attachTerminal(WS, "tab-a", "client-1", { title: "Kept" });
	await Bun.sleep(500);
	persistTerminalSessions();
	resetTerminalState();

	expect(listTerminals(WS)).toHaveLength(0);
	reviveTerminalSessions();
	expect(listTerminals(WS)).toEqual([{ tabKey: "tab-a", title: "Kept" }]);

	const revived = attachTerminal(WS, "tab-a", "client-1");
	expect(revived.created).toBe(true);
	expect(revived.id).not.toBe(first.id);
	expect(revived.replay ?? "").not.toBe("");
});

test("a revived recording is served once, not to every later attach", async () => {
	attachTerminal(WS, "tab-a", "client-1");
	await Bun.sleep(500);
	persistTerminalSessions();
	resetTerminalState();
	reviveTerminalSessions();

	const revived = attachTerminal(WS, "tab-a", "client-1");
	closeTerminalTab(WS, "tab-a", true);
	const fresh = attachTerminal(WS, "tab-a", "client-1");

	expect(revived.replay ?? "").not.toBe("");
	expect(fresh.replay ?? "").toBe("");
});

test("persisting writes nothing for a workspace whose tabs were all closed", () => {
	attachTerminal(WS, "tab-a", "client-1");
	closeTerminalTab(WS, "tab-a", true);
	persistTerminalSessions();
	resetTerminalState();
	reviveTerminalSessions();

	expect(listTerminals(WS)).toHaveLength(0);
});

test("only the attached client may drive a terminal", async () => {
	const attached = attachTerminal(WS, "tab-a", "client-1");
	await Bun.sleep(500);

	attachTerminal(WS, "tab-a", "client-2");
	writeTerminal(attached.id, "echo TR_FROM_DISPLACED\r", "client-1");
	resizeTerminal(attached.id, 5, 2, "client-1");
	await Bun.sleep(500);

	const seen = pushed
		.filter((frame) => frame.channel === "terminal.data")
		.map((frame) => (frame.data as { data: string }).data)
		.join("");
	expect(seen).not.toContain("TR_FROM_DISPLACED");

	attachTerminal(WS, "tab-a", "client-1");
	writeTerminal(attached.id, "echo TR_RECLAIMED\r", "client-1");
	await Bun.sleep(800);
	const afterReclaim = pushed
		.filter((frame) => frame.channel === "terminal.data")
		.map((frame) => (frame.data as { data: string }).data)
		.join("");
	expect(afterReclaim).toContain("TR_RECLAIMED");
});

test("opening and closing a tab broadcasts the new list", () => {
	const seen: unknown[] = [];
	setTerminalTabsPublisher((workspaceId, tabs) => seen.push({ workspaceId, tabs }));

	attachTerminal(WS, "tab-a", "client-1", { title: "One" });
	attachTerminal(WS, "tab-a", "client-1");
	expect(seen).toEqual([{ workspaceId: WS, tabs: [{ tabKey: "tab-a", title: "One" }] }]);

	closeTerminalTab(WS, "tab-a", true);
	expect(seen.at(-1)).toEqual({ workspaceId: WS, tabs: [] });
});

test("a displaced client that tries to type is told it is displaced", async () => {
	const attached = attachTerminal(WS, "tab-a", "client-1");
	await Bun.sleep(400);
	attachTerminal(WS, "tab-a", "client-2");
	pushed = [];

	writeTerminal(attached.id, "echo TR_LOST_NOTICE\r", "client-1");

	const told = pushed.filter((frame) => frame.channel === "terminal.detached");
	expect(told).toHaveLength(1);
	expect(told[0]?.clientKey).toBe("client-1");
	expect(told[0]?.data).toEqual({ workspaceId: WS, tabKey: "tab-a" });
});

test("the attached client is not told it is displaced", async () => {
	const attached = attachTerminal(WS, "tab-a", "client-1");
	await Bun.sleep(400);
	pushed = [];

	writeTerminal(attached.id, "echo TR_FINE\r", "client-1");
	resizeTerminal(attached.id, 100, 30, "client-1");

	expect(pushed.filter((frame) => frame.channel === "terminal.detached")).toHaveLength(0);
});

test("a tab keeps its last screen when its shell exits on its own", async () => {
	const first = attachTerminal(WS, "tab-a", "client-1");
	await Bun.sleep(400);
	writeTerminal(first.id, "echo TR_BEFORE_CRASH\r", "client-1");
	await Bun.sleep(600);
	writeTerminal(first.id, "exit\r", "client-1");
	await Bun.sleep(800);

	expect(listTerminals(WS)).toHaveLength(1);
	const next = attachTerminal(WS, "tab-a", "client-1");
	expect(next.created).toBe(true);
	expect(next.replay ?? "").toContain("TR_BEFORE_CRASH");
});

test("a dead tab's last screen survives a host restart", async () => {
	const first = attachTerminal(WS, "tab-a", "client-1");
	await Bun.sleep(400);
	writeTerminal(first.id, "echo TR_LAST_WORDS\r", "client-1");
	await Bun.sleep(600);
	writeTerminal(first.id, "exit\r", "client-1");
	await Bun.sleep(800);

	persistTerminalSessions();
	resetTerminalState();
	reviveTerminalSessions();

	expect(attachTerminal(WS, "tab-a", "client-1").replay ?? "").toContain("TR_LAST_WORDS");
});

describe("membership survives an ungraceful exit", () => {
	test("a tab closed before a crash does not come back", () => {
		attachTerminal(WS, "tab-a", "client-1");
		closeTerminalTab(WS, "tab-a", true);

		resetTerminalState();
		reviveTerminalSessions();

		expect(listTerminals(WS)).toHaveLength(0);
	});

	test("a tab opened before a crash is still there", () => {
		attachTerminal(WS, "tab-a", "client-1", { title: "Survivor" });

		resetTerminalState();
		reviveTerminalSessions();

		expect(listTerminals(WS)).toEqual([{ tabKey: "tab-a", title: "Survivor" }]);
	});

	test("archiving a workspace before a crash takes its tabs with it", () => {
		attachTerminal(WS, "tab-a", "client-1");
		closeWorkspaceTerminals(WS);

		resetTerminalState();
		reviveTerminalSessions();

		expect(listTerminals(WS)).toHaveLength(0);
	});
});
