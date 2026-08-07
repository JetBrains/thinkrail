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
			"## Auth — 1/2",
			"- [x] Scaffold module",
			"- [ ] Validate inputs",
			"",
			"## Payments — 0/1",
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

test("a committed done item renders its short sha + per-file commit-scope diff links", () => {
	const done: TodoItem = {
		...item("Implement foo", "done"),
		// The commit artifact's `files` is the host's `todo.list` decoration (derived from git, never stored).
		artifacts: [
			{
				kind: "commit",
				sha: "abc1234def567",
				label: "Implement foo",
				files: ["src/foo.ts", "src/bar baz.ts"],
			},
		],
	};
	const plan: TodoPlan = { todos: [done], groups: [] };
	expect(planToMarkdown(plan, "c")).toBe(
		[
			"# TODO — c",
			"",
			"Progress: 1/1",
			"",
			"- [x] Implement foo `abc1234`",
			"    - [src/foo.ts](thinkrail-diff:abc1234def567:src%2Ffoo.ts)",
			"    - [src/bar baz.ts](thinkrail-diff:abc1234def567:src%2Fbar%20baz.ts)",
			"",
		].join("\n"),
	);
});

test("a fallback done item (change artifacts, no commit) links at branch scope (empty sha)", () => {
	const done: TodoItem = {
		...item("Fix bar", "done"),
		artifacts: [{ kind: "change", path: "src/bar.ts" }],
	};
	expect(planToMarkdown({ todos: [done], groups: [] }, "c")).toBe(
		[
			"# TODO — c",
			"",
			"Progress: 1/1",
			"",
			"- [x] Fix bar",
			"    - [src/bar.ts](thinkrail-diff::src%2Fbar.ts)",
			"",
		].join("\n"),
	);
});

test("a commit artifact without decorated files (unresolvable sha) degrades to a plain row", () => {
	const done: TodoItem = {
		...item("Old step", "done"),
		artifacts: [{ kind: "commit", sha: "deadbeef", label: "Old step" }],
	};
	expect(planToMarkdown({ todos: [done], groups: [] }, "c")).toBe(
		["# TODO — c", "", "Progress: 1/1", "", "- [x] Old step", ""].join("\n"),
	);
});
