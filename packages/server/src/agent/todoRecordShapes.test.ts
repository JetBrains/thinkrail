import { expect, test } from "bun:test";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type {
	AgentToolResult,
	ExtensionAPI,
	ExtensionToolContext,
	ToolDefinition,
} from "@earendil-works/pi-coding-agent";
import * as insights from "@thinkrail/ext-session-insights/server";
import todos from "pi-todos";
import type { Todo, TodoGroup, TodoPlan, TodoUpdateResult } from "pi-todos/core";
import { TODO_STATUSES } from "pi-todos/core";

function pinShapes(
	plan: TodoPlan,
	todo: Todo,
	group: TodoGroup,
	update: TodoUpdateResult,
): [insights.TodoPlanRecord, insights.TodoRecord, insights.TodoGroupRecord, insights.TodoRecord[]] {
	return [plan, todo, group, update.paused];
}

function details<T>(result: AgentToolResult<unknown>): T {
	return result.details as T;
}

function output(result: AgentToolResult<unknown>): string {
	return result.content.flatMap((block) => (block.type === "text" ? [block.text] : [])).join("\n");
}

test("the pi-todos result shapes and text lines session insights parses structurally hold", async () => {
	expect(typeof pinShapes).toBe("function");
	expect([...TODO_STATUSES]).toEqual([...insights.TODO_STATUSES]);
	const tools = new Map<string, ToolDefinition>();
	todos({
		registerTool: (tool: ToolDefinition) => tools.set(tool.name, tool),
		on: () => {},
	} as unknown as ExtensionAPI);
	expect([...tools.keys()].sort()).toEqual([...insights.TODO_TOOLS].sort());
	const cwd = mkdtempSync(join(tmpdir(), "todo-shapes-"));
	const run = (name: string, params: Record<string, unknown>) => {
		const tool = tools.get(name);
		if (!tool) throw new Error(`missing ${name}`);
		return tool.execute("call", params, undefined, undefined, {
			cwd,
			sessionManager: { getSessionId: () => "shapes" },
		} as unknown as ExtensionToolContext);
	};
	try {
		const written = await run("todo_write", {
			groups: [{ title: "Release", todos: [{ title: "Bump" }, { title: "Tag" }] }],
		});
		const plan = details<{ plan: insights.TodoPlanRecord }>(written).plan;
		const [bump, tag] = plan.groups[0]?.todos ?? [];
		if (!bump || !tag) throw new Error("todo_write wrote no steps");
		expect(plan.groups[0]?.id).toMatch(/^g_[0-9a-f]+$/);
		expect(bump).toMatchObject({ title: "Bump", status: "pending", origin: "agent" });
		expect(bump.id).toMatch(/^t_[0-9a-f]+$/);
		const lines = output(written).split("\n");
		expect(lines.some((line) => insights.TODO_TEXT_GROUP.test(line))).toBe(true);
		expect(
			lines
				.filter((line) => insights.TODO_TEXT_ITEM.test(line))
				.map((line) => insights.TODO_TEXT_ITEM.exec(line)?.[3]),
		).toEqual([bump.id, tag.id]);

		await run("todo_update", { id: bump.id, status: "in_progress" });
		const flipped = details<{ todo: insights.TodoRecord; paused: insights.TodoRecord[] }>(
			await run("todo_update", { id: tag.id, status: "in_progress" }),
		);
		expect(flipped.todo).toMatchObject({ id: tag.id, status: "in_progress" });
		expect(flipped.paused.map((todo) => todo.id)).toEqual([bump.id]);

		const added = details<{ todo: insights.TodoRecord }>(
			await run("todo_add", { title: "Loose idea" }),
		);
		expect(added.todo).toMatchObject({ title: "Loose idea", status: "pending" });
		const promoted = details<{ group: insights.TodoGroupRecord }>(
			await run("todo_promote", { id: added.todo.id }),
		);
		expect(promoted.group).toMatchObject({ id: added.todo.id, title: "Loose idea", todos: [] });

		expect(details<{ id: string }>(await run("todo_remove", { id: tag.id }))).toEqual({
			id: tag.id,
		});
		const listed = details<{ plan: insights.TodoPlanRecord }>(await run("todo_list", {})).plan;
		expect(listed.groups.flatMap((group) => group.todos.map((todo) => todo.id))).toEqual([bump.id]);
		const summary = await run("todo_plan_summary", { summary: "## Summary\nDone." });
		expect(output(summary)).toContain("Plan summary saved.");
	} finally {
		rmSync(cwd, { recursive: true, force: true });
	}
});
