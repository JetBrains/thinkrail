import { afterAll, afterEach, beforeEach, expect, jest, mock, test } from "bun:test";
import { existsSync, mkdtempSync, readFileSync, rmdirSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

const dataPath = mkdtempSync(join(tmpdir(), "thinkrail-scheduler-test-"));
const delivered: string[] = [];
const running = new Set<string>();
let releaseFirst: (() => void) | undefined;
let firstGate: Promise<void> | undefined;
let holdNextAttach = false;
let releaseAttach: (() => void) | undefined;
let attachGate: Promise<void> | undefined;
process.env.THINKRAIL_DATA_DIR = dataPath;

mock.module("../agent", () => ({
	ensureSessionAttached: async () => {
		if (!holdNextAttach) return;
		holdNextAttach = false;
		await attachGate;
	},
	getSessionWorkspaceId: () => "workspace",
	scheduleFollowUpSession: async (sessionId: string, text: string) => {
		delivered.push(`${sessionId}:${text}`);
		if (text === "A") await firstGate;
	},
	acceptScheduledFollowUpSession: async (sessionId: string, text: string) => {
		delivered.push(`${sessionId}:${text}`);
		if (text === "reject") throw new Error("before acceptance");
		if (text === "A") {
			running.add(sessionId);
			void firstGate?.then(() => running.delete(sessionId));
		}
		return true;
	},
	validatePromptModelSelection: () => {},
}));
mock.module("../persistence", () => ({ dataDir: () => dataPath }));
mock.module("../workspaces", () => ({ getWorkspace: () => ({ worktreePath: dataPath }) }));

const {
	createScheduledPrompt,
	cancelScheduledPrompt,
	listScheduledPrompts,
	startScheduledPrompts,
	stopScheduledPrompts,
	updateScheduledPrompt,
} = await import("./index");

const now = 1_800_000_000_000;
const dueAt = now + 60_000;

beforeEach(() => {
	jest.useFakeTimers();
	jest.setSystemTime(now);
	delivered.length = 0;
	running.clear();
	let release!: () => void;
	firstGate = new Promise<void>((resolve) => (release = resolve));
	releaseFirst = release;
	holdNextAttach = false;
	let releaseHeldAttach!: () => void;
	attachGate = new Promise<void>((resolve) => (releaseHeldAttach = resolve));
	releaseAttach = releaseHeldAttach;
	stopScheduledPrompts();
	const file = join(dataPath, "scheduled-prompts.json");
	if (existsSync(file)) rmSync(file);
	startScheduledPrompts(() => {});
});

afterEach(() => {
	stopScheduledPrompts();
	jest.useRealTimers();
});

afterAll(() => {
	rmSync(join(dataPath, "scheduled-prompts.json"), { force: true });
	rmdirSync(dataPath);
});

async function flushMicrotasks(): Promise<void> {
	for (let index = 0; index < 20; index++) await Promise.resolve();
}

test("keeps delivering other chats while an accepted run is still working", async () => {
	createScheduledPrompt({
		id: "a",
		workspaceId: "workspace",
		sessionId: "chat-a",
		text: "A",
		dueAt,
	});
	createScheduledPrompt({
		id: "b",
		workspaceId: "workspace",
		sessionId: "chat-b",
		text: "B",
		dueAt: dueAt + 60_000,
	});

	jest.advanceTimersByTime(60_000);
	await flushMicrotasks();
	expect(delivered).toEqual(["chat-a:A"]);
	expect(running.has("chat-a")).toBe(true);
	jest.advanceTimersByTime(60_000);
	await flushMicrotasks();
	expect(delivered).toEqual(["chat-a:A", "chat-b:B"]);
	expect(running.has("chat-a")).toBe(true);

	releaseFirst?.();
	await flushMicrotasks();
	expect(listScheduledPrompts("workspace")).toHaveLength(0);
});

test("orders equal due times by the most recent save and preserves that order after restart", async () => {
	createScheduledPrompt({
		id: "a",
		workspaceId: "workspace",
		sessionId: "chat-a",
		text: "A",
		dueAt,
	});
	createScheduledPrompt({
		id: "b",
		workspaceId: "workspace",
		sessionId: "chat-a",
		text: "B",
		dueAt,
	});
	expect(listScheduledPrompts("workspace").map(({ id }) => id)).toEqual(["a", "b"]);

	updateScheduledPrompt("a", "workspace", dueAt, "A edited");
	expect(listScheduledPrompts("workspace").map(({ id }) => id)).toEqual(["b", "a"]);

	stopScheduledPrompts();
	startScheduledPrompts(() => {});
	expect(listScheduledPrompts("workspace").map(({ id }) => id)).toEqual(["b", "a"]);
	jest.advanceTimersByTime(60_000);
	await flushMicrotasks();
	expect(delivered).toEqual(["chat-a:B", "chat-a:A edited"]);
	expect(listScheduledPrompts("workspace")).toHaveLength(0);
});

test("rechecks an edited or cancelled record before its serialized handoff", async () => {
	holdNextAttach = true;
	for (const [id, text] of [
		["a", "A"],
		["b", "B"],
		["c", "C"],
	] as const) {
		createScheduledPrompt({ id, workspaceId: "workspace", sessionId: "chat-a", text, dueAt });
	}
	jest.advanceTimersByTime(60_000);
	await flushMicrotasks();
	updateScheduledPrompt("b", "workspace", dueAt + 60_000, "B postponed");
	cancelScheduledPrompt("c", "workspace");
	releaseAttach?.();
	await flushMicrotasks();
	expect(delivered).toEqual(["chat-a:A"]);
	expect(listScheduledPrompts("workspace").map(({ id }) => id)).toEqual(["b"]);

	jest.advanceTimersByTime(60_000);
	await flushMicrotasks();
	expect(delivered).toEqual(["chat-a:A", "chat-a:B postponed"]);
});

test("migrates legacy records in creation order", async () => {
	const file = join(dataPath, "scheduled-prompts.json");
	writeFileSync(
		file,
		JSON.stringify([
			{
				id: "older",
				workspaceId: "workspace",
				sessionId: "chat-a",
				text: "A",
				dueAt,
				createdAt: 10,
				status: "scheduled",
			},
			{
				id: "newer",
				workspaceId: "workspace",
				sessionId: "chat-a",
				text: "B",
				dueAt,
				createdAt: 20,
				status: "scheduled",
			},
		]),
	);
	startScheduledPrompts(() => {});
	expect(listScheduledPrompts("workspace").map(({ id }) => id)).toEqual(["older", "newer"]);
	expect(
		JSON.parse(readFileSync(file, "utf8")).map(
			({ savedOrder }: { savedOrder: number }) => savedOrder,
		),
	).toEqual([1, 2]);
});

test("keeps a rejected delivery failed and does not retry it after restart", async () => {
	createScheduledPrompt({
		id: "reject",
		workspaceId: "workspace",
		sessionId: "chat-a",
		text: "reject",
		dueAt,
	});
	jest.advanceTimersByTime(60_000);
	await flushMicrotasks();
	expect(listScheduledPrompts("workspace")).toMatchObject([
		{ id: "reject", status: "failed", error: "before acceptance" },
	]);
	expect(delivered).toEqual(["chat-a:reject"]);

	stopScheduledPrompts();
	startScheduledPrompts(() => {});
	await flushMicrotasks();
	expect(listScheduledPrompts("workspace")).toMatchObject([{ id: "reject", status: "failed" }]);
	expect(delivered).toEqual(["chat-a:reject"]);
});

test("marks uncertain in-flight records failed after restart without redelivery", async () => {
	const file = join(dataPath, "scheduled-prompts.json");
	writeFileSync(
		file,
		JSON.stringify([
			{
				id: "uncertain",
				workspaceId: "workspace",
				sessionId: "chat-a",
				text: "already dispatched",
				dueAt,
				createdAt: now,
				savedOrder: 1,
				status: "delivering",
			},
		]),
	);
	stopScheduledPrompts();
	startScheduledPrompts(() => {});
	await flushMicrotasks();
	expect(listScheduledPrompts("workspace")).toMatchObject([
		{
			id: "uncertain",
			status: "failed",
			error: "Delivery outcome uncertain after restart; review before retrying.",
		},
	]);
	expect(delivered).toEqual([]);
});
