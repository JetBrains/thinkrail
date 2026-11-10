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
let rejectModelSelection = false;
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
	validatePromptModelSelection: (_sessionId: string, _selection: unknown) => {
		if (rejectModelSelection) throw new Error("Unsupported reasoning level for scheduled model.");
	},
}));
mock.module("../persistence", () => ({ dataDir: () => dataPath }));
mock.module("../log", () => ({ logger: () => ({ error: () => {} }) }));
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
	rejectModelSelection = false;
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

test("a retried create stays idempotent after delivery and restart", async () => {
	const input = {
		id: "already-delivered",
		workspaceId: "workspace",
		sessionId: "chat-a",
		text: "once",
		dueAt,
	};
	createScheduledPrompt(input);

	jest.advanceTimersByTime(60_000);
	await flushMicrotasks();
	expect(delivered).toEqual(["chat-a:once"]);

	stopScheduledPrompts();
	startScheduledPrompts(() => {});
	const retry = createScheduledPrompt(input);
	expect(retry.status).toBe("accepted");
	expect(listScheduledPrompts("workspace")).toHaveLength(0);
	expect(() => createScheduledPrompt({ ...input, text: "different content" })).toThrow(
		"Scheduled prompt id already exists.",
	);
	jest.advanceTimersByTime(60_000);
	await flushMicrotasks();
	expect(delivered).toEqual(["chat-a:once"]);
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

test("revalidates a preserved model selection when an update omits it", () => {
	const modelSelection = {
		model: { provider: "openai", id: "gpt-4.1" },
		thinkingLevel: "low" as const,
	};
	createScheduledPrompt({
		id: "pinned",
		workspaceId: "workspace",
		sessionId: "chat-a",
		text: "pinned schedule",
		dueAt,
		modelSelection,
	});
	rejectModelSelection = true;

	expect(() => updateScheduledPrompt("pinned", "workspace", dueAt, "edited schedule")).toThrow(
		"Unsupported reasoning level for scheduled model.",
	);
	expect(listScheduledPrompts("workspace")).toMatchObject([
		{ text: "pinned schedule", modelSelection },
	]);
});

test("accepts image-only scheduled prompts on create and edit", () => {
	const images = [{ type: "image" as const, data: "AA==", mimeType: "image/png" }];
	const created = createScheduledPrompt({
		id: "image-only",
		workspaceId: "workspace",
		sessionId: "chat-a",
		text: "",
		images,
		dueAt,
	});
	expect(created).toMatchObject({ text: "", images, status: "scheduled" });

	const updated = updateScheduledPrompt("image-only", "workspace", dueAt, "", images);
	expect(updated).toMatchObject({ text: "", images, status: "scheduled" });
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
		JSON.parse(readFileSync(file, "utf8")).records.map(
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

test("preserves unreadable storage and disables schedule operations", () => {
	const file = join(dataPath, "scheduled-prompts.json");
	const invalidJson = "[{";
	writeFileSync(file, invalidJson);
	stopScheduledPrompts();
	startScheduledPrompts(() => {});

	expect(() => listScheduledPrompts("workspace")).toThrow(
		expect.objectContaining({ code: "SCHEDULED_PROMPTS_STORAGE_UNAVAILABLE" }),
	);
	expect(() =>
		createScheduledPrompt({
			id: "must-not-overwrite",
			workspaceId: "workspace",
			sessionId: "chat-a",
			text: "new schedule",
			dueAt,
		}),
	).toThrow(expect.objectContaining({ code: "SCHEDULED_PROMPTS_STORAGE_UNAVAILABLE" }));
	expect(readFileSync(file, "utf8")).toBe(invalidJson);
});

test("preserves parseable storage with malformed records and disables schedule operations", () => {
	const file = join(dataPath, "scheduled-prompts.json");
	const malformedRecords = '[null,{"id":"missing-fields"}]';
	writeFileSync(file, malformedRecords);
	stopScheduledPrompts();
	startScheduledPrompts(() => {});

	expect(() => listScheduledPrompts("workspace")).toThrow(
		expect.objectContaining({ code: "SCHEDULED_PROMPTS_STORAGE_UNAVAILABLE" }),
	);
	expect(() =>
		createScheduledPrompt({
			id: "must-not-overwrite",
			workspaceId: "workspace",
			sessionId: "chat-a",
			text: "new schedule",
			dueAt,
		}),
	).toThrow(expect.objectContaining({ code: "SCHEDULED_PROMPTS_STORAGE_UNAVAILABLE" }));
	expect(readFileSync(file, "utf8")).toBe(malformedRecords);
});
