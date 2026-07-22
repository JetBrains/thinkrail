import { expect, test } from "bun:test";
import type { TodoItem, TodoPlan } from "@thinkrail/contracts";
import { planToMarkdown } from "./planMarkdown";

const item = (title: string, status: TodoItem["status"] = "pending"): TodoItem => ({
	id: `t_${title}`,
	title,
	status,
	origin: "agent",
	createdAt: "",
	updatedAt: "",
});

test("compiles groups + loose with a progress header and GFM checkboxes", () => {
	const plan: TodoPlan = {
		todos: [item("Add tests")],
		groups: [
			{
				id: "g1",
				title: "Auth",
				todos: [item("Scaffold module", "done"), item("Validate inputs")],
			},
			{ id: "g2", title: "Payments", todos: [item("Wire the route", "in_progress")] },
		],
	};
	expect(planToMarkdown(plan, "My chat")).toBe(
		[
			"# TODO — My chat",
			"",
			"Progress: 1/4",
			"",
			"## Auth",
			"- [x] Scaffold module",
			"- [ ] Validate inputs",
			"",
			"## Payments",
			"- [~] Wire the route",
			"",
			"### Other",
			"- [ ] Add tests",
			"",
		].join("\n"),
	);
});

test("loose-only plan lists items directly (no Other heading)", () => {
	const plan: TodoPlan = { todos: [item("a", "done"), item("b")], groups: [] };
	expect(planToMarkdown(plan, "c")).toBe(
		["# TODO — c", "", "Progress: 1/2", "", "- [x] a", "- [ ] b", ""].join("\n"),
	);
});

test("an empty plan renders a placeholder", () => {
	expect(planToMarkdown({ todos: [], groups: [] }, "c")).toBe(
		["# TODO — c", "", "Progress: 0/0", "", "_No items yet._", ""].join("\n"),
	);
});
