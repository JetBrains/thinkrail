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
import { TODO_STATUSES } from "../core/index.ts";
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
		const added = (await run("todo_add", { title: "Ship it" }, cwd)) as AgentToolResult<{
			todo: { id: string; status: string };
		}>;
		const id = added.details.todo.id;
		expect(added.details.todo.status).toBe("pending");

		const listed = (await run("todo_list", {}, cwd)) as AgentToolResult<{
			plan: { todos: unknown[] };
		}>;
		expect(listed.details.plan.todos).toHaveLength(1);

		const updated = (await run("todo_update", { id, status: "done" }, cwd)) as AgentToolResult<{
			todo: { status: string };
		}>;
		expect(updated.details.todo.status).toBe("done");

		const removed = await run("todo_remove", { id }, cwd);
		expect(isError(removed)).toBe(false);
		const listedAfter = (await run("todo_list", {}, cwd)) as AgentToolResult<{
			plan: { todos: unknown[] };
		}>;
		expect(listedAfter.details.plan.todos).toHaveLength(0);
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

test("todo_write replaces the plan with loose items + named groups", async () => {
	const cwd = mkdtempSync(join(tmpdir(), "pi-todos-tools-"));
	try {
		await run("todo_add", { title: "old item" }, cwd);
		const written = (await run(
			"todo_write",
			{
				todos: [{ title: "a", status: "in_progress" }, { title: "b" }],
				groups: [{ title: "Import", todos: [{ title: "parse" }] }],
			},
			cwd,
		)) as AgentToolResult<{ plan: { todos: { title: string }[]; groups: { title: string }[] } }>;
		expect(written.details.plan.todos.map((t) => t.title)).toEqual(["a", "b"]);
		expect(written.details.plan.groups.map((g) => g.title)).toEqual(["Import"]);
		const listed = (await run("todo_list", {}, cwd)) as AgentToolResult<{
			plan: { todos: { title: string }[]; groups: { title: string; todos: { title: string }[] }[] };
		}>;
		expect(listed.details.plan.todos.map((t) => t.title)).toEqual(["a", "b"]);
		expect(listed.details.plan.groups[0]?.todos.map((t) => t.title)).toEqual(["parse"]);
	} finally {
		rmSync(cwd, { recursive: true, force: true });
	}
});
