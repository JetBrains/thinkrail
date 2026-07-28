import { expect, test } from "bun:test";
import type { TodoItem, TodoPlan } from "@thinkrail/contracts";
import { openTodoCount } from "./todos";

let n = 0;
function item(status: TodoItem["status"]): TodoItem {
	n += 1;
	return {
		id: `t-${n}`,
		title: `item ${n}`,
		status,
		origin: "agent",
		createdAt: "",
		updatedAt: "",
	};
}

function plan(todos: TodoItem[], groups: TodoPlan["groups"] = []): TodoPlan {
	return { todos, groups };
}

test("an empty plan (no todo file yet) counts 0", () => {
	expect(openTodoCount(plan([]))).toBe(0);
});

test("pending and in_progress count as open; done doesn't", () => {
	expect(openTodoCount(plan([item("pending"), item("in_progress"), item("done")]))).toBe(2);
});

test("grouped items count alongside loose ones", () => {
	const p = plan(
		[item("done")],
		[
			{
				id: "g-a",
				title: "task A",
				status: "pending",
				todos: [item("pending"), item("done")],
			},
			{ id: "g-b", title: "task B", status: "active", todos: [item("in_progress")] },
		],
	);
	expect(openTodoCount(p)).toBe(2);
});

test("an all-done plan counts 0", () => {
	expect(
		openTodoCount(
			plan([item("done")], [{ id: "g", title: "task", status: "done", todos: [item("done")] }]),
		),
	).toBe(0);
});
