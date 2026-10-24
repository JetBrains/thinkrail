import { expect, spyOn, test } from "bun:test";
import { existsSync, mkdtempSync, readFileSync, rmSync, statSync, writeFileSync } from "node:fs";
import * as fs from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type {
	AgentToolResult,
	ExtensionAPI,
	ExtensionToolContext,
	ToolDefinition,
} from "@earendil-works/pi-coding-agent";
import { createReadTool } from "@earendil-works/pi-coding-agent";
import { TODO_STATUSES, TodoStore } from "../core/index.ts";
import { registerTodoTools } from "./index.ts";

const tools = new Map<string, ToolDefinition>();
registerTodoTools({
	registerTool(tool: ToolDefinition) {
		tools.set(tool.name, tool);
	},
} as unknown as ExtensionAPI);

function run(
	name: string,
	params: Record<string, unknown>,
	cwd: string,
): Promise<AgentToolResult<unknown>> {
	const tool = tools.get(name);
	if (!tool) throw new Error(`missing tool: ${name}`);
	return tool.execute("call-1", params, undefined, undefined, {
		cwd,
		sessionManager: { getSessionId: () => "sess-test" },
	} as unknown as ExtensionToolContext);
}

function isError(result: AgentToolResult<unknown>): boolean {
	return typeof result.details === "object" && result.details !== null && "error" in result.details;
}

function paramEnum(toolName: string, prop: string): readonly string[] {
	const schema = tools.get(toolName)?.parameters as {
		properties?: Record<string, { enum?: string[] }>;
	};
	return schema.properties?.[prop]?.enum ?? [];
}

function text(result: AgentToolResult<unknown>): string {
	return result.content
		.filter((block) => block.type === "text")
		.map((block) => block.text)
		.join("\n");
}

test("todo_list pages a large plan without losing, repeating or changing items", async () => {
	const cwd = mkdtempSync(join(tmpdir(), "pi-todos-pages-"));
	try {
		const store = new TodoStore(cwd, "sess-test");
		const plan = store.replaceAll({
			groups: [
				{
					title: "Large task",
					todos: Array.from({ length: 240 }, (_, i) => ({
						title: `Step ${i} ${"x".repeat(1000)}`,
					})),
				},
			],
		});
		const found: string[] = [];
		let offset = 0;
		for (let page = 0; page < 20; page++) {
			const result = await run("todo_list", { offset }, cwd);
			expect(Buffer.byteLength(text(result))).toBeLessThanOrEqual(50 * 1024);
			found.push(...[...text(result).matchAll(/— (t_[a-f0-9]+)/g)].map((match) => match[1] ?? ""));
			const nextOffset = (result.details as { nextOffset?: number }).nextOffset;
			if (nextOffset === undefined) break;
			expect(nextOffset).toBeGreaterThan(offset);
			expect(text(result)).toContain(`offset: ${nextOffset}`);
			offset = nextOffset;
		}
		expect(found).toEqual(plan.groups.flatMap((group) => group.todos.map((todo) => todo.id)));
		expect(store.read()).toEqual(plan);
	} finally {
		rmSync(cwd, { recursive: true, force: true });
	}
});

test("a completion preserves oversized summary output without repeating the mutation", async () => {
	const cwd = mkdtempSync(join(tmpdir(), "pi-todos-output-"));
	let path: string | undefined;
	try {
		const store = new TodoStore(cwd, "sess-test");
		const todo = store.add({ title: "Finish" });
		const summary = "Previous work 🧪\n".repeat(4000).trim();
		store.setSummary(summary);
		const result = await run("todo_update", { id: todo.id, status: "done" }, cwd);
		expect(Buffer.byteLength(text(result))).toBeLessThanOrEqual(50 * 1024);
		expect(text(result).split("\n").length).toBeLessThanOrEqual(2000);
		path = (result.details as { output?: { fullOutputPath?: string } }).output?.fullOutputPath;
		expect(path).toBeDefined();
		if (!path) throw new Error("missing full output");
		const afterMutation = store.read();
		expect(readFileSync(path, "utf8")).toContain(summary.trim());
		const range = await createReadTool(cwd).execute("range", { path, offset: 3000, limit: 2 });
		expect(text(range)).toContain("Previous work 🧪");
		expect(Buffer.byteLength(text(range))).toBeLessThanOrEqual(50 * 1024);
		expect(store.read()).toEqual(afterMutation);
		expect(afterMutation.summary).toBe(summary);
		expect(afterMutation.todos[0]?.status).toBe("done");
		if (process.platform !== "win32") expect(statSync(path).mode & 0o777).toBe(0o600);
	} finally {
		if (path) rmSync(path, { force: true });
		rmSync(cwd, { recursive: true, force: true });
	}
});

test("errors keep their model-facing failure status when the message is oversized", async () => {
	const cwd = mkdtempSync(join(tmpdir(), "pi-todos-errors-"));
	try {
		for (const size of [7, 60000]) {
			const result = await run("todo_update", { id: "x".repeat(size) }, cwd);
			const path = (result.details as { output?: { fullOutputPath?: string } }).output
				?.fullOutputPath;
			try {
				expect(result.isError).toBe(true);
				expect(text(result)).toStartWith("Error:");
				expect(Buffer.byteLength(text(result))).toBeLessThanOrEqual(50 * 1024);
			} finally {
				if (path) rmSync(path, { force: true });
			}
		}
	} finally {
		rmSync(cwd, { recursive: true, force: true });
	}
});

test("todo pagination keeps filters, clamps limits and handles empty or invalid ranges", async () => {
	const cwd = mkdtempSync(join(tmpdir(), "pi-todos-ranges-"));
	try {
		const store = new TodoStore(cwd, "sess-test");
		store.replaceAll({
			groups: [
				{
					title: "Task",
					todos: Array.from({ length: 250 }, (_, i) => ({ title: `Step ${i}`, status: "done" })),
				},
			],
		});
		store.add({ title: "Not done" });
		const first = await run("todo_list", { status: "done", limit: 100000 }, cwd);
		expect((first.details as { nextOffset?: number }).nextOffset).toBe(200);
		expect(text(first)).toContain("status: done");
		const last = await run("todo_list", { status: "done", offset: 200 }, cwd);
		expect((last.details as { nextOffset?: number }).nextOffset).toBeUndefined();
		expect(text(last).split("\n")).toHaveLength(50);
		expect(text(last)).not.toContain("Not done");
		expect(text(await run("todo_list", { offset: 9999 }, cwd))).toContain("No more plan lines");
		expect(isError(await run("todo_list", { offset: -1 }, cwd))).toBe(true);
		expect(isError(await run("todo_list", { limit: 0 }, cwd))).toBe(true);
	} finally {
		rmSync(cwd, { recursive: true, force: true });
	}
});

test("a single enormous plan line still exposes continuation and its file can expire", async () => {
	const cwd = mkdtempSync(join(tmpdir(), "pi-todos-long-line-"));
	let path: string | undefined;
	try {
		const store = new TodoStore(cwd, "sess-test");
		const title = "🧪".repeat(20000);
		store.add({ title });
		store.add({ title: "Next item" });
		const result = await run("todo_list", {}, cwd);
		path = (result.details as { output?: { fullOutputPath?: string } }).output?.fullOutputPath;
		expect(Buffer.byteLength(text(result))).toBeLessThanOrEqual(50 * 1024);
		expect((result.details as { nextOffset?: number }).nextOffset).toBe(1);
		expect(text(result)).toContain("offset: 1");
		if (!path) throw new Error("missing full output");
		expect(readFileSync(path, "utf8")).toContain(title);
		expect(text(await run("todo_list", { offset: 1 }, cwd))).toContain("Next item");
		rmSync(path);
		await expect(createReadTool(cwd).execute("missing", { path })).rejects.toThrow();
		expect(store.read().todos).toHaveLength(2);
	} finally {
		if (path) rmSync(path, { force: true });
		rmSync(cwd, { recursive: true, force: true });
	}
});

test("failed output capture reports unavailable without retrying a successful mutation", async () => {
	const cwd = mkdtempSync(join(tmpdir(), "pi-todos-capture-failure-"));
	const keys = ["TMPDIR", "TMP", "TEMP"] as const;
	const original = keys.map((key) => process.env[key]);
	try {
		const notDirectory = join(cwd, "not-a-directory");
		writeFileSync(notDirectory, "fixture");
		for (const key of keys) process.env[key] = notDirectory;
		const result = await run("todo_add", { title: "x".repeat(60000) }, cwd);
		expect(isError(result)).toBe(false);
		expect(Buffer.byteLength(text(result))).toBeLessThanOrEqual(50 * 1024);
		expect(text(result)).toContain("Full output unavailable");
		expect(text(result)).toContain("do not repeat a mutation");
		expect(
			(
				result.details as {
					output?: { truncated: boolean; captureFailed?: boolean; fullOutputPath?: string };
				}
			).output,
		).toEqual({ truncated: true, captureFailed: true });
		expect(new TodoStore(cwd, "sess-test").read().todos).toHaveLength(1);
		const failed = await run("todo_update", { id: "x".repeat(60000) }, cwd);
		expect(failed.isError).toBe(true);
		expect(text(failed)).toStartWith("Error:");
		expect(text(failed)).toContain("Full output unavailable");
		expect(Buffer.byteLength(text(failed))).toBeLessThanOrEqual(50 * 1024);
	} finally {
		for (const [index, key] of keys.entries()) {
			const value = original[index];
			if (value === undefined) delete process.env[key];
			else process.env[key] = value;
		}
		rmSync(cwd, { recursive: true, force: true });
	}
});

test.each([
	"partial write",
	"collision",
	"cleanup failure",
] as const)("capture failure after %s preserves the mutation and cleans up only its own file", async (failure) => {
	const cwd = mkdtempSync(join(tmpdir(), "pi-todos-capture-ownership-"));
	const realOpen = fs.open;
	const realUnlink = fs.unlink;
	let path: string | undefined;
	let file: fs.FileHandle | undefined;
	const unlink = spyOn(fs, "unlink").mockImplementation(async (name) => {
		if (failure === "cleanup failure" && String(name) === path)
			throw new Error("Synthetic cleanup failure");
		return realUnlink(name);
	});
	const open = spyOn(fs, "open").mockImplementation(async (name, flags, mode) => {
		if (!String(name).includes("pi-todo-output-")) return realOpen(name, flags, mode);
		path = String(name);
		if (failure === "collision") writeFileSync(path, "existing output", { flag: "wx" });
		file = await realOpen(name, flags, mode);
		const write = file.writeFile.bind(file);
		file.writeFile = async () => {
			await write("PARTIAL");
			throw Object.assign(new Error("Synthetic disk-full failure"), { code: "ENOSPC" });
		};
		return file;
	});
	try {
		const result = await run("todo_add", { title: "x".repeat(60000) }, cwd);
		expect(result.isError).not.toBe(true);
		expect((result.details as { output: { captureFailed: boolean } }).output.captureFailed).toBe(
			true,
		);
		expect(new TodoStore(cwd, "sess-test").read().todos).toHaveLength(1);
		if (!path) throw new Error("missing capture attempt");
		expect(existsSync(path)).toBe(failure !== "partial write");
		if (failure === "collision") expect(readFileSync(path, "utf8")).toBe("existing output");
		if (file) await expect(file.stat()).rejects.toThrow();
	} finally {
		open.mockRestore();
		unlink.mockRestore();
		await file?.close().catch(() => {});
		if (path) rmSync(path, { force: true });
		rmSync(cwd, { recursive: true, force: true });
	}
});

test("registers the seven todo tools", () => {
	expect([...tools.keys()].sort()).toEqual([
		"todo_add",
		"todo_list",
		"todo_plan_summary",
		"todo_promote",
		"todo_remove",
		"todo_update",
		"todo_write",
	]);
});

test("todo_promote turns a loose user ask into a group of its own (same id, same title) in one atomic call", async () => {
	const cwd = mkdtempSync(join(tmpdir(), "pi-todos-tools-"));
	try {
		const mine = new TodoStore(cwd, "sess-test").add({ title: "fix auth bug", origin: "user" });
		const promoted = (await run("todo_promote", { id: mine.id }, cwd)) as AgentToolResult<{
			group: { id: string; title: string; todos: unknown[] };
		}>;
		expect(isError(promoted)).toBe(false);
		expect(promoted.details.group.id).toBe(mine.id);
		expect(promoted.details.group.title).toBe("fix auth bug");
		expect(promoted.details.group.todos).toEqual([]);

		const plan = new TodoStore(cwd, "sess-test").read();
		expect(plan.todos).toEqual([]);
		expect(plan.groups).toHaveLength(1);
		expect(plan.groups[0]?.id).toBe(mine.id);

		const first = (await run(
			"todo_add",
			{ title: "reproduce the bug", group: "fix auth bug" },
			cwd,
		)) as AgentToolResult<{ todo: { id: string } }>;
		await run("todo_update", { id: first.details.todo.id, status: "in_progress" }, cwd);
		const live = new TodoStore(cwd, "sess-test").read();
		expect(live.groups[0]?.todos).toHaveLength(1);
		expect(live.groups[0]?.todos[0]?.status).toBe("in_progress");
	} finally {
		rmSync(cwd, { recursive: true, force: true });
	}
});

test("todo_promote accepts a title override and errors on an unknown or already-grouped id", async () => {
	const cwd = mkdtempSync(join(tmpdir(), "pi-todos-tools-"));
	try {
		const mine = new TodoStore(cwd, "sess-test").add({ title: "raw ask", origin: "user" });
		const renamed = (await run(
			"todo_promote",
			{ id: mine.id, title: "Fix the auth bug" },
			cwd,
		)) as AgentToolResult<{ group: { title: string } }>;
		expect(renamed.details.group.title).toBe("Fix the auth bug");

		expect(isError(await run("todo_promote", { id: "t_nope" }, cwd))).toBe(true);

		const step = (await run(
			"todo_add",
			{ title: "step", group: "Fix the auth bug" },
			cwd,
		)) as AgentToolResult<{ todo: { id: string } }>;
		const refused = await run("todo_promote", { id: step.details.todo.id }, cwd);
		expect(isError(refused)).toBe(true);
	} finally {
		rmSync(cwd, { recursive: true, force: true });
	}
});

test("finite-vocabulary param schemas derive their enum from the core tuples", () => {
	expect(paramEnum("todo_update", "status")).toEqual([...TODO_STATUSES]);
	expect(paramEnum("todo_list", "status")).toEqual([...TODO_STATUSES]);
});

test("add → list → update → remove round-trips through the store", async () => {
	const cwd = mkdtempSync(join(tmpdir(), "pi-todos-tools-"));
	try {
		const added = (await run(
			"todo_add",
			{ title: "Ship it", group: "Task" },
			cwd,
		)) as AgentToolResult<{
			todo: { id: string; status: string };
		}>;
		const id = added.details.todo.id;
		expect(added.details.todo.status).toBe("pending");

		const listed = (await run("todo_list", {}, cwd)) as AgentToolResult<{
			plan: { groups: { todos: unknown[] }[] };
		}>;
		expect(listed.details.plan.groups[0]?.todos).toHaveLength(1);

		const updated = (await run("todo_update", { id, status: "done" }, cwd)) as AgentToolResult<{
			todo: { status: string };
		}>;
		expect(updated.details.todo.status).toBe("done");

		const removed = await run("todo_remove", { id }, cwd);
		expect(isError(removed)).toBe(false);
		const listedAfter = (await run("todo_list", {}, cwd)) as AgentToolResult<{
			plan: { todos: unknown[]; groups: unknown[] };
		}>;
		expect(listedAfter.details.plan.todos).toHaveLength(0);
		expect(listedAfter.details.plan.groups).toHaveLength(0);
	} finally {
		rmSync(cwd, { recursive: true, force: true });
	}
});

test("todo_update on an unknown id returns an error result", async () => {
	const cwd = mkdtempSync(join(tmpdir(), "pi-todos-tools-"));
	try {
		expect(isError(await run("todo_update", { id: "missing", status: "done" }, cwd))).toBe(true);
		expect(isError(await run("todo_remove", { id: "missing" }, cwd))).toBe(true);
	} finally {
		rmSync(cwd, { recursive: true, force: true });
	}
});

test("todo_write lays out a groups-only plan (no loose lane for the agent)", async () => {
	const cwd = mkdtempSync(join(tmpdir(), "pi-todos-tools-"));
	try {
		await run("todo_add", { title: "old item", group: "Old" }, cwd);
		const written = (await run(
			"todo_write",
			{
				groups: [
					{ title: "Import", todos: [{ title: "parse", status: "in_progress" }] },
					{ title: "Export", todos: [{ title: "serialize" }] },
				],
			},
			cwd,
		)) as AgentToolResult<{ plan: { todos: unknown[]; groups: { title: string }[] } }>;
		expect(written.details.plan.todos).toHaveLength(0);
		expect(written.details.plan.groups.map((g) => g.title)).toEqual(["Import", "Export"]);
		const schema = tools.get("todo_write")?.parameters as { properties?: Record<string, unknown> };
		expect(Object.keys(schema.properties ?? {})).toEqual(["groups"]);
	} finally {
		rmSync(cwd, { recursive: true, force: true });
	}
});

test("todo_write reconciles a re-listed plan without resetting progress or nudging", async () => {
	const cwd = mkdtempSync(join(tmpdir(), "pi-todos-tools-"));
	try {
		await run(
			"todo_write",
			{ groups: [{ title: "Task", todos: [{ title: "step a" }, { title: "step b" }] }] },
			cwd,
		);
		const listed = (await run("todo_list", {}, cwd)) as AgentToolResult<{
			plan: { groups: { todos: { id: string; title: string }[] }[] };
		}>;
		const stepA = listed.details.plan.groups[0]?.todos.find((t) => t.title === "step a");
		if (!stepA) throw new Error("step a not found");
		await run("todo_update", { id: stepA.id, status: "in_progress" }, cwd);

		const replan = (await run(
			"todo_write",
			{
				groups: [
					{
						title: "Task",
						todos: [{ title: "step a" }, { title: "step b" }, { title: "step c" }],
					},
				],
			},
			cwd,
		)) as AgentToolResult<{
			plan: { groups: { todos: { id: string; title: string; status: string }[] }[] };
		}>;
		const reconciled = replan.details.plan.groups[0]?.todos ?? [];
		const reA = reconciled.find((t) => t.title === "step a");
		expect(reA?.id).toBe(stepA.id);
		expect(reA?.status).toBe("in_progress");
		expect(reconciled.map((t) => t.title)).toEqual(["step a", "step b", "step c"]);
	} finally {
		rmSync(cwd, { recursive: true, force: true });
	}
});

test("todo_add drops a loose item when both group and after are omitted (the shared raw-input queue)", async () => {
	const cwd = mkdtempSync(join(tmpdir(), "pi-todos-tools-"));
	try {
		const loose = (await run("todo_add", { title: "raw note" }, cwd)) as AgentToolResult<{
			todo: { id: string; origin: string };
		}>;
		expect(isError(loose)).toBe(false);
		expect(loose.details.todo.origin).toBe("agent");
		const plan = new TodoStore(cwd, "sess-test").read();
		expect(plan.todos.map((t) => t.title)).toEqual(["raw note"]);
		expect(plan.groups).toHaveLength(0);
		expect(isError(await run("todo_add", { title: "orphan", after: "t_nope" }, cwd))).toBe(true);
	} finally {
		rmSync(cwd, { recursive: true, force: true });
	}
});

test("todo_add with after inserts mid-group (after wins over group)", async () => {
	const cwd = mkdtempSync(join(tmpdir(), "pi-todos-tools-"));
	try {
		const first = (await run("todo_add", { title: "one", group: "Task" }, cwd)) as AgentToolResult<{
			todo: { id: string };
		}>;
		await run("todo_add", { title: "three", group: "Task" }, cwd);
		await run("todo_add", { title: "two", after: first.details.todo.id, group: "Elsewhere" }, cwd);
		const listed = (await run("todo_list", {}, cwd)) as AgentToolResult<{
			plan: { groups: { title: string; todos: { title: string }[] }[] };
		}>;
		expect(listed.details.plan.groups.map((g) => g.title)).toEqual(["Task"]);
		expect(listed.details.plan.groups[0]?.todos.map((t) => t.title)).toEqual([
			"one",
			"two",
			"three",
		]);
	} finally {
		rmSync(cwd, { recursive: true, force: true });
	}
});

test("todo_update reports paused items and suggests the next step after done", async () => {
	const cwd = mkdtempSync(join(tmpdir(), "pi-todos-tools-"));
	try {
		const a = (await run("todo_add", { title: "step a", group: "Task" }, cwd)) as AgentToolResult<{
			todo: { id: string };
		}>;
		const b = (await run("todo_add", { title: "step b", group: "Task" }, cwd)) as AgentToolResult<{
			todo: { id: string };
		}>;
		await run("todo_update", { id: a.details.todo.id, status: "in_progress" }, cwd);

		const flipped = (await run(
			"todo_update",
			{ id: b.details.todo.id, status: "in_progress" },
			cwd,
		)) as AgentToolResult<{ paused: { id: string }[] }>;
		expect(flipped.details.paused.map((t) => t.id)).toEqual([a.details.todo.id]);
		expect(text(flipped)).toContain("paused:");

		const done = await run("todo_update", { id: b.details.todo.id, status: "done" }, cwd);
		expect(text(done)).toContain(`next: ${a.details.todo.id}`);
	} finally {
		rmSync(cwd, { recursive: true, force: true });
	}
});

test("todo_list renders groups first, then the loose queue last (a mid-task add queues after the current work)", async () => {
	const cwd = mkdtempSync(join(tmpdir(), "pi-todos-tools-"));
	try {
		await run("todo_add", { title: "agent step", group: "Refactor" }, cwd);
		new TodoStore(cwd, "sess-test").add({ title: "user ask", origin: "user" });

		const output = text(await run("todo_list", {}, cwd));
		const groupAt = output.indexOf("▸ Refactor");
		const headerAt = output.indexOf("Loose queue:");
		const looseAt = output.indexOf("user ask");
		expect(groupAt).toBeGreaterThanOrEqual(0);
		expect(headerAt).toBeGreaterThan(groupAt);
		expect(looseAt).toBeGreaterThan(headerAt);
	} finally {
		rmSync(cwd, { recursive: true, force: true });
	}
});

test("todo_list renders group-first with derived status + progress, and nudges when nothing is in progress", async () => {
	const cwd = mkdtempSync(join(tmpdir(), "pi-todos-tools-"));
	try {
		const a = (await run(
			"todo_add",
			{ title: "step a", group: "Fix login" },
			cwd,
		)) as AgentToolResult<{
			todo: { id: string };
		}>;
		await run("todo_add", { title: "step b", group: "Fix login" }, cwd);

		const idle = await run("todo_list", {}, cwd);
		expect(text(idle)).toContain("▸ Fix login [pending 0/2]");
		expect(text(idle)).toContain("nothing is in_progress");

		await run("todo_update", { id: a.details.todo.id, status: "in_progress" }, cwd);
		const active = await run("todo_list", {}, cwd);
		expect(text(active)).toContain("▸ Fix login [active 0/2]");
		expect(text(active)).not.toContain("nothing is in_progress");

		await run("todo_update", { id: a.details.todo.id, status: "done" }, cwd);
		const half = await run("todo_list", {}, cwd);
		expect(text(half)).toContain("▸ Fix login [pending 1/2]");
	} finally {
		rmSync(cwd, { recursive: true, force: true });
	}
});

test("todo_add refuses an `after` anchor pointing at a loose item (promote, don’t grow siblings)", async () => {
	const cwd = mkdtempSync(join(tmpdir(), "pi-todos-tools-"));
	try {
		const mine = new TodoStore(cwd, "sess-test").add({ title: "user ask", origin: "user" });
		const rejected = await run("todo_add", { title: "related step", after: mine.id }, cwd);
		expect(isError(rejected)).toBe(true);
		expect(text(rejected)).toContain("promoted");

		const plan = new TodoStore(cwd, "sess-test").read();
		expect(plan.todos.map((t) => t.title)).toEqual(["user ask"]);
		expect(plan.groups).toHaveLength(0);

		await run("todo_write", { groups: [{ title: "Task", todos: [{ title: "step" }] }] }, cwd);
		const after = new TodoStore(cwd, "sess-test").read();
		expect(after.todos.map((t) => t.title)).toEqual(["user ask"]);
		expect(after.groups[0]?.todos.map((t) => t.title)).toEqual(["step"]);
	} finally {
		rmSync(cwd, { recursive: true, force: true });
	}
});

test("done-with-summary stores it and the last done nudges todo_plan_summary; the tool sets the plan note", async () => {
	const cwd = mkdtempSync(join(tmpdir(), "pi-todos-tools-"));
	try {
		const added = (await run(
			"todo_add",
			{ title: "Implement handling", group: "Task" },
			cwd,
		)) as AgentToolResult<{ todo: { id: string } }>;
		const done = await run(
			"todo_update",
			{ id: added.details.todo.id, status: "done", summary: "Added throttling. Tests pass." },
			cwd,
		);
		const store = new TodoStore(cwd, "sess-test");
		expect(store.get(added.details.todo.id)?.summary).toBe("Added throttling. Tests pass.");
		// The whole plan just completed → the in-band nudge asks for the overall summary.
		expect(done.content[0]?.type === "text" ? done.content[0].text : "").toContain(
			"todo_plan_summary",
		);

		const set = await run("todo_plan_summary", { summary: "Task landed; suite green." }, cwd);
		expect(isError(set)).toBe(false);
		expect(store.read().summary).toBe("Task landed; suite green.");
	} finally {
		rmSync(cwd, { recursive: true, force: true });
	}
});

test("re-completing a plan that gained new work echoes the surviving summary and asks to extend it", async () => {
	const cwd = mkdtempSync(join(tmpdir(), "pi-todos-tools-"));
	try {
		const first = (await run(
			"todo_add",
			{ title: "First step", group: "Task" },
			cwd,
		)) as AgentToolResult<{ todo: { id: string } }>;
		await run("todo_update", { id: first.details.todo.id, status: "done" }, cwd);
		await run("todo_plan_summary", { summary: "First step shipped." }, cwd);

		// New work arrives (an add never drops the surviving plan summary), then finishes.
		const second = (await run(
			"todo_add",
			{ title: "Second step", group: "Task" },
			cwd,
		)) as AgentToolResult<{ todo: { id: string } }>;
		const done = await run("todo_update", { id: second.details.todo.id, status: "done" }, cwd);
		const text = done.content[0]?.type === "text" ? done.content[0].text : "";
		// The nudge echoes the surviving note and asks to extend it, not rewrite from scratch.
		expect(text).toContain("EXTEND");
		expect(text).toContain("First step shipped.");
	} finally {
		rmSync(cwd, { recursive: true, force: true });
	}
});
