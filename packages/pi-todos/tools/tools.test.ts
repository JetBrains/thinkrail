import { expect, test } from "bun:test";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type {
	AgentToolResult,
	ExtensionAPI,
	ExtensionContext,
	ToolDefinition,
} from "@earendil-works/pi-coding-agent";
import { TODO_STATUSES, TodoStore } from "../core/index.ts";
import { registerTodoTools } from "./index.ts";

// Capture the registered tool defs via a minimal fake ExtensionAPI, then drive their `execute` against a
// real temp cwd — the tools layer's integration surface (param plumbing, store writes, result shape).
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
	// The tools resolve their chat-scoped store via ctx.sessionManager.getSessionId().
	return tool.execute("call-1", params, undefined, undefined, {
		cwd,
		sessionManager: { getSessionId: () => "sess-test" },
	} as unknown as ExtensionContext);
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

test("registers the five todo tools", () => {
	expect([...tools.keys()].sort()).toEqual([
		"todo_add",
		"todo_list",
		"todo_remove",
		"todo_update",
		"todo_write",
	]);
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
		// The schema no longer offers a loose `todos` param at all.
		const schema = tools.get("todo_write")?.parameters as { properties?: Record<string, unknown> };
		expect(Object.keys(schema.properties ?? {})).toEqual(["groups"]);
	} finally {
		rmSync(cwd, { recursive: true, force: true });
	}
});

test("todo_add requires group or after — the agent cannot author loose items", async () => {
	const cwd = mkdtempSync(join(tmpdir(), "pi-todos-tools-"));
	try {
		expect(isError(await run("todo_add", { title: "loose?" }, cwd))).toBe(true);
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

function resultText(result: AgentToolResult<unknown>): string {
	return result.content
		.map((c) => (c.type === "text" ? c.text : ""))
		.filter(Boolean)
		.join("\n");
}

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

		// Flipping b to in_progress pauses a — and says so.
		const flipped = (await run(
			"todo_update",
			{ id: b.details.todo.id, status: "in_progress" },
			cwd,
		)) as AgentToolResult<{ paused: { id: string }[] }>;
		expect(flipped.details.paused.map((t) => t.id)).toEqual([a.details.todo.id]);
		expect(resultText(flipped)).toContain("paused:");

		// Marking b done suggests the next open step (a).
		const done = await run("todo_update", { id: b.details.todo.id, status: "done" }, cwd);
		expect(resultText(done)).toContain(`next: ${a.details.todo.id}`);
	} finally {
		rmSync(cwd, { recursive: true, force: true });
	}
});

test("todo_list renders groups first, then the user's loose lane last (a mid-task add queues after the current work)", async () => {
	const cwd = mkdtempSync(join(tmpdir(), "pi-todos-tools-"));
	try {
		await run("todo_add", { title: "agent step", group: "Refactor" }, cwd);
		// A user add (loose) comes through the host store, not the agent tools.
		new TodoStore(cwd, "sess-test").add({ title: "user ask", origin: "user" });

		const text = resultText(await run("todo_list", {}, cwd));
		const groupAt = text.indexOf("▸ Refactor");
		const headerAt = text.indexOf("Your requests:");
		const looseAt = text.indexOf("user ask");
		expect(groupAt).toBeGreaterThanOrEqual(0);
		expect(headerAt).toBeGreaterThan(groupAt); // the user's lane is rendered after the groups
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
		expect(resultText(idle)).toContain("▸ Fix login [pending 0/2]");
		expect(resultText(idle)).toContain("nothing is in_progress");

		await run("todo_update", { id: a.details.todo.id, status: "in_progress" }, cwd);
		const active = await run("todo_list", {}, cwd);
		expect(resultText(active)).toContain("▸ Fix login [active 0/2]");
		expect(resultText(active)).not.toContain("nothing is in_progress");

		await run("todo_update", { id: a.details.todo.id, status: "done" }, cwd);
		const half = await run("todo_list", {}, cwd);
		expect(resultText(half)).toContain("▸ Fix login [pending 1/2]");
	} finally {
		rmSync(cwd, { recursive: true, force: true });
	}
});

test("todo_add refuses an `after` anchor in the user's lane, and a re-plan keeps that lane intact", async () => {
	const cwd = mkdtempSync(join(tmpdir(), "pi-todos-tools-"));
	try {
		// The user's own item lives loose. Anchoring a step to it would splice an agent-origin item into
		// that lane — which `todo_write` then drops (it keeps only user or done items there), so the step
		// would appear in the user's requests and silently vanish on the next re-plan.
		const mine = new TodoStore(cwd, "sess-test").add({ title: "user ask", origin: "user" });
		const rejected = await run("todo_add", { title: "related step", after: mine.id }, cwd);
		expect(isError(rejected)).toBe(true);
		expect(resultText(rejected)).toContain("group");

		// Nothing was written: the user's lane still holds exactly their own item.
		const plan = new TodoStore(cwd, "sess-test").read();
		expect(plan.todos.map((t) => t.title)).toEqual(["user ask"]);
		expect(plan.groups).toHaveLength(0);

		// And the lane keeps its meaning across a re-plan: the user's item survives, agent steps are the
		// ones replaced.
		await run("todo_write", { groups: [{ title: "Task", todos: [{ title: "step" }] }] }, cwd);
		const after = new TodoStore(cwd, "sess-test").read();
		expect(after.todos.map((t) => t.title)).toEqual(["user ask"]);
		expect(after.groups[0]?.todos.map((t) => t.title)).toEqual(["step"]);
	} finally {
		rmSync(cwd, { recursive: true, force: true });
	}
});
