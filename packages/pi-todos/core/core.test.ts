import { expect, test } from "bun:test";
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { flatItems, groupStatus, storeRel, type TodoGroup, TodoStore } from "./index.ts";

const SESSION = "sess-test";

function tempRoot(): string {
	return mkdtempSync(join(tmpdir(), "pi-todos-"));
}

function store(root: string): TodoStore {
	return new TodoStore(root, SESSION);
}

test("missing store reads as an empty plan", () => {
	const root = tempRoot();
	try {
		expect(store(root).read()).toEqual({ todos: [], groups: [] });
	} finally {
		rmSync(root, { recursive: true, force: true });
	}
});

test("add persists to the session file and assigns id + timestamps + pending status", () => {
	const root = tempRoot();
	try {
		const todo = store(root).add({ title: "Wire the route", note: "blocks demo" });
		expect(todo.id).toMatch(/^t_/);
		expect(todo.status).toBe("pending");
		expect(todo.createdAt).toBeTruthy();
		expect(existsSync(join(root, storeRel(SESSION)))).toBe(true);
		expect(store(root).list()).toHaveLength(1);
	} finally {
		rmSync(root, { recursive: true, force: true });
	}
});

test("titles are flattened to one line on add, update, and group", () => {
	const root = tempRoot();
	try {
		const s = store(root);
		const todo = s.add({ title: "Wire\nthe   route", group: "Big\nTask", origin: "user" });
		expect(todo.title).toBe("Wire the route");
		expect(s.read().groups[0]?.title).toBe("Big Task");
		const updated = s.update(todo.id, { title: "New\ttitle\nhere" });
		expect(updated?.todo.title).toBe("New title here");
	} finally {
		rmSync(root, { recursive: true, force: true });
	}
});

test("replaceAll reconciles a multi-line write against the flattened stored title", () => {
	const root = tempRoot();
	try {
		const s = store(root);
		s.add({ title: "Ship it", group: "Task" });
		const before = s.read().groups[0]?.todos[0];
		s.update(before?.id ?? "", { status: "done" });
		// A re-written plan whose title only differs by whitespace must MATCH (identity preserved, status kept).
		const plan = s.replaceAll({ groups: [{ title: "Task", todos: [{ title: "Ship\nit" }] }] });
		const after = plan.groups[0]?.todos[0];
		expect(after?.id).toBe(before?.id);
		expect(after?.status).toBe("done");
		expect(after?.title).toBe("Ship it");
	} finally {
		rmSync(root, { recursive: true, force: true });
	}
});

test("lists are isolated per session", () => {
	const root = tempRoot();
	try {
		new TodoStore(root, "sess-a").add({ title: "a-item" });
		expect(new TodoStore(root, "sess-b").list()).toHaveLength(0);
		expect(new TodoStore(root, "sess-a").list()).toHaveLength(1);
	} finally {
		rmSync(root, { recursive: true, force: true });
	}
});

test("update flips status and returns undefined for an unknown id", () => {
	const root = tempRoot();
	try {
		const s = store(root);
		const todo = s.add({ title: "Do a thing" });
		expect(s.update(todo.id, { status: "in_progress" })?.todo.status).toBe("in_progress");
		expect(s.update("nope", { status: "done" })).toBeUndefined();
	} finally {
		rmSync(root, { recursive: true, force: true });
	}
});

test("list filters by status", () => {
	const root = tempRoot();
	try {
		const s = store(root);
		const a = s.add({ title: "a" });
		s.add({ title: "b" });
		s.update(a.id, { status: "done" });
		expect(s.list("done")).toHaveLength(1);
		expect(s.list("pending")).toHaveLength(1);
		expect(s.list()).toHaveLength(2);
	} finally {
		rmSync(root, { recursive: true, force: true });
	}
});

test("remove returns whether the item existed", () => {
	const root = tempRoot();
	try {
		const s = store(root);
		const todo = s.add({ title: "x" });
		expect(s.remove(todo.id)).toBe(true);
		expect(s.remove(todo.id)).toBe(false);
		expect(s.list()).toHaveLength(0);
	} finally {
		rmSync(root, { recursive: true, force: true });
	}
});

test("replaceAll overwrites the agent's open items with fresh ones", () => {
	const root = tempRoot();
	try {
		const s = store(root);
		s.add({ title: "old", group: "Task" });
		const plan = s.replaceAll({
			groups: [
				{ title: "Task", todos: [{ title: "step 1", status: "done" }, { title: "step 2" }] },
			],
		});
		const task = plan.groups.find((g) => g.title === "Task");
		expect(task?.todos).toHaveLength(2);
		expect(task?.todos[0]?.status).toBe("done");
		expect(task?.todos[1]?.status).toBe("pending");
		expect(s.list()).toHaveLength(2);
	} finally {
		rmSync(root, { recursive: true, force: true });
	}
});

test("replaceAll lays out named groups (created with fresh ids), preserving item order", () => {
	const root = tempRoot();
	try {
		const s = store(root);
		const plan = s.replaceAll({
			groups: [{ title: "Import", todos: [{ title: "parse" }, { title: "validate" }] }],
		});
		expect(plan.todos).toHaveLength(0);
		expect(plan.groups).toHaveLength(1);
		expect(plan.groups[0]?.id).toMatch(/^g_/);
		expect(plan.groups[0]?.title).toBe("Import");
		expect(plan.groups[0]?.todos.map((t) => t.title)).toEqual(["parse", "validate"]);
	} finally {
		rmSync(root, { recursive: true, force: true });
	}
});

test("add places an item into a named group (created if new) or loose", () => {
	const root = tempRoot();
	try {
		const s = store(root);
		s.add({ title: "loose" });
		s.add({ title: "grouped", group: "Auth" });
		s.add({ title: "grouped 2", group: "Auth" });
		const plan = s.read();
		expect(plan.todos.map((t) => t.title)).toEqual(["loose"]);
		expect(plan.groups).toHaveLength(1);
		expect(plan.groups[0]?.title).toBe("Auth");
		expect(plan.groups[0]?.todos).toHaveLength(2);
		expect(s.list()).toHaveLength(3);
		expect(s.list().map((t) => t.title)).toEqual(["grouped", "grouped 2", "loose"]);
	} finally {
		rmSync(root, { recursive: true, force: true });
	}
});

test("across a re-plan done items rejoin a matching group and a dropped group's done items stay grouped, never loose", () => {
	const root = tempRoot();
	try {
		const s = store(root);
		const kept = s.add({ title: "kept done", group: "Import" });
		const orphan = s.add({ title: "orphan done", group: "Gone" });
		s.update(kept.id, { status: "done" });
		s.update(orphan.id, { status: "done" });

		const plan = s.replaceAll({ groups: [{ title: "Import", todos: [{ title: "next step" }] }] });
		const importGroup = plan.groups.find((g) => g.title === "Import");
		expect(importGroup?.todos.map((t) => t.title)).toContain("kept done");
		const goneGroup = plan.groups.find((g) => g.title === "Gone");
		expect(goneGroup?.todos.map((t) => t.title)).toEqual(["orphan done"]);
		expect(plan.groups.map((g) => g.title)).toEqual(["Import", "Gone"]);
		expect(plan.todos.map((t) => t.title)).not.toContain("orphan done");
	} finally {
		rmSync(root, { recursive: true, force: true });
	}
});

test("re-plan carries both user and agent-pending loose items (shared raw-input queue)", () => {
	const root = tempRoot();
	try {
		const s = store(root);
		const userLoose = s.add({ title: "user request", origin: "user" });
		const agentLoose = s.add({ title: "agent note" });
		const agentDone = s.add({ title: "agent done", group: "Gone" });
		s.update(agentDone.id, { status: "done" });

		const plan = s.replaceAll({ groups: [{ title: "Fresh", todos: [{ title: "step" }] }] });
		expect(plan.todos.map((t) => t.id).sort()).toEqual([userLoose.id, agentLoose.id].sort());
		expect(plan.todos.map((t) => t.origin).sort()).toEqual(["agent", "user"]);
	} finally {
		rmSync(root, { recursive: true, force: true });
	}
});

test("re-plan parks a done agent loose item in Completed and keeps a pending one in the loose lane", () => {
	const root = tempRoot();
	try {
		const file = join(root, storeRel(SESSION));
		mkdirSync(dirname(file), { recursive: true });
		writeFileSync(
			file,
			JSON.stringify({
				version: 6,
				todos: [
					{ id: "t_legacy_done", title: "legacy agent done", status: "done", origin: "agent" },
					{ id: "t_legacy_open", title: "legacy agent open", status: "pending", origin: "agent" },
				],
				groups: [],
			}),
			"utf8",
		);
		const plan = store(root).replaceAll({
			groups: [{ title: "Fresh", todos: [{ title: "step" }] }],
		});
		expect(plan.todos.map((t) => t.title)).toEqual(["legacy agent open"]);
		const completed = plan.groups.find((g) => g.title === "Completed");
		expect(completed?.todos.map((t) => t.title)).toEqual(["legacy agent done"]);
	} finally {
		rmSync(root, { recursive: true, force: true });
	}
});

test("reconcile: re-listing a step keeps its id, in_progress status and summary (no reset, no dup)", () => {
	const root = tempRoot();
	try {
		const s = store(root);
		const a = s.add({ title: "step a", group: "Task" });
		s.add({ title: "step b", group: "Task" });
		s.update(a.id, { status: "in_progress", summary: "halfway" });

		const plan = s.replaceAll({
			groups: [
				{
					title: "Task",
					todos: [{ title: "step a", status: "done" }, { title: "step b" }, { title: "step c" }],
				},
			],
		});
		const task = plan.groups.find((g) => g.title === "Task");
		const reA = task?.todos.find((t) => t.title === "step a");
		expect(reA?.id).toBe(a.id);
		expect(reA?.status).toBe("in_progress");
		expect(reA?.summary).toBe("halfway");
		expect(task?.todos.filter((t) => t.title === "step a")).toHaveLength(1);
		expect(task?.todos.map((t) => t.title)).toEqual(["step a", "step b", "step c"]);
	} finally {
		rmSync(root, { recursive: true, force: true });
	}
});

test("reconcile: an agent-open step omitted from the re-plan is dropped; a done one is preserved", () => {
	const root = tempRoot();
	try {
		const s = store(root);
		s.add({ title: "open step", group: "Task" });
		const done = s.add({ title: "done step", group: "Task" });
		s.update(done.id, { status: "done" });

		const plan = s.replaceAll({ groups: [{ title: "Task", todos: [{ title: "new step" }] }] });
		const task = plan.groups.find((g) => g.title === "Task");
		expect(task?.todos.map((t) => t.title)).toContain("new step");
		expect(task?.todos.map((t) => t.title)).toContain("done step");
		expect(task?.todos.map((t) => t.title)).not.toContain("open step");
	} finally {
		rmSync(root, { recursive: true, force: true });
	}
});

test("reconcile: duplicate step titles in a group are matched positionally", () => {
	const root = tempRoot();
	try {
		const s = store(root);
		const first = s.add({ title: "dup", group: "Task" });
		const second = s.add({ title: "dup", group: "Task" });
		s.update(first.id, { status: "in_progress" });
		s.update(second.id, { status: "done" });

		const plan = s.replaceAll({
			groups: [{ title: "Task", todos: [{ title: "dup" }, { title: "dup" }] }],
		});
		const task = plan.groups.find((g) => g.title === "Task");
		expect(task?.todos.map((t) => t.id)).toEqual([first.id, second.id]);
		expect(task?.todos.map((t) => t.status)).toEqual(["in_progress", "done"]);
	} finally {
		rmSync(root, { recursive: true, force: true });
	}
});

test("literal \\uXXXX escapes in titles/notes/group names are decoded, not shown verbatim", () => {
	const root = tempRoot();
	try {
		const s = store(root);
		const todo = s.add({
			title: "\\u0411\\u041b\\u041e\\u041a",
			note: "\\u043d\\u043e\\u0442\\u0435",
		});
		expect(todo.title).toBe("БЛОК");
		expect(todo.note).toBe("ноте");
		const plan = s.replaceAll({
			groups: [{ title: "\\u0413\\u0440\\u0443\\u043f\\u043f\\u0430", todos: [{ title: "ok" }] }],
		});
		expect(plan.groups[0]?.title).toBe("Группа");
	} finally {
		rmSync(root, { recursive: true, force: true });
	}
});

test("literal \\n/\\r/\\t in agent-authored summary/note is decoded to real whitespace (markdown render fix)", () => {
	const root = tempRoot();
	try {
		const s = store(root);
		// Agent-origin plan-level summary with literal \n sequences (LLM providers often leave them
		// un-decoded in tool-call strings) must come back out as real newlines so Markdown renders.
		s.setSummary("## Summary\\n\\nFirst line.\\n\\n- bullet\\n- bullet two");
		expect(s.read().summary).toBe("## Summary\n\nFirst line.\n\n- bullet\n- bullet two");
		// Also agent-origin per-item summary + note.
		const todo = s.add({ title: "step", note: "line one\\nline two" });
		expect(s.get(todo.id)?.note).toBe("line one\nline two");
		s.update(todo.id, { status: "done", summary: "Shipped.\\n\\nDetails." });
		expect(s.get(todo.id)?.summary).toBe("Shipped.\n\nDetails.");
	} finally {
		rmSync(root, { recursive: true, force: true });
	}
});

test("user-authored text is stored verbatim — \\uXXXX is NOT decoded for user input", () => {
	const root = tempRoot();
	try {
		const s = store(root);
		const todo = s.add({ title: "about \\u0041", note: "\\u0042", origin: "user" });
		expect(todo.title).toBe("about \\u0041");
		expect(todo.note).toBe("\\u0042");
		expect(s.update(todo.id, { title: "still \\u0043" })?.todo.title).toBe("still \\u0043");
	} finally {
		rmSync(root, { recursive: true, force: true });
	}
});

test("an empty-string note clears the note", () => {
	const root = tempRoot();
	try {
		const s = store(root);
		const todo = s.add({ title: "task", note: "context" });
		expect(todo.note).toBe("context");
		expect(s.update(todo.id, { note: "" })?.todo.note).toBeUndefined();
		expect(store(root).get(todo.id)?.note).toBeUndefined();
	} finally {
		rmSync(root, { recursive: true, force: true });
	}
});

test("an agent item stored with literal escapes self-heals on the next write", () => {
	const root = tempRoot();
	try {
		const file = join(root, storeRel(SESSION));
		mkdirSync(dirname(file), { recursive: true });
		writeFileSync(
			file,
			JSON.stringify({
				version: 2,
				todos: [
					{
						id: "t_old",
						title: "\\u0411\\u041b\\u041e\\u041a",
						status: "pending",
						origin: "agent",
					},
				],
				groups: [],
			}),
			"utf8",
		);
		const s = store(root);
		expect(s.get("t_old")?.title).toBe("БЛОК");
		s.update("t_old", { status: "done" });
		const raw = JSON.parse(readFileSync(file, "utf8")) as { todos: { title: string }[] };
		expect(raw.todos[0]?.title).toBe("БЛОК");
	} finally {
		rmSync(root, { recursive: true, force: true });
	}
});

test("a session id that could escape the store dir is rejected", () => {
	const root = tempRoot();
	try {
		expect(() => storeRel("../evil")).toThrow();
		expect(() => storeRel("a/b")).toThrow();
		expect(() => new TodoStore(root, "../../etc/passwd").read()).toThrow();
		expect(() => storeRel("018f-abc_DEF")).not.toThrow();
	} finally {
		rmSync(root, { recursive: true, force: true });
	}
});

test("add defaults origin to agent; the caller can mark it user", () => {
	const root = tempRoot();
	try {
		const s = store(root);
		expect(s.add({ title: "agent item" }).origin).toBe("agent");
		expect(s.add({ title: "user item", origin: "user" }).origin).toBe("user");
	} finally {
		rmSync(root, { recursive: true, force: true });
	}
});

test("update/remove find items inside a group by id, pruning a group that just lost its last item", () => {
	const root = tempRoot();
	try {
		const s = store(root);
		const todo = s.add({ title: "grouped", group: "Auth" });
		expect(s.get(todo.id)?.title).toBe("grouped");
		expect(s.update(todo.id, { status: "in_progress" })?.todo.status).toBe("in_progress");
		expect(s.remove(todo.id)).toBe(true);
		// A group that LOSES its last item in a remove is pruned: otherwise the user is stuck with a
		// ghost "planning\u2026" task they have no tool to delete. A promote-born empty group that was
		// ALREADY empty before this remove is left alone (covered by the next test).
		expect(s.read().groups).toEqual([]);
	} finally {
		rmSync(root, { recursive: true, force: true });
	}
});

test("remove preserves a promote-born empty group that was already empty before the call", () => {
	const root = tempRoot();
	try {
		const s = store(root);
		const parked = s.add({ title: "parked ask", origin: "user" });
		const grouped = s.add({ title: "other step", group: "Other" });
		s.promote(parked.id); // creates an empty group named "parked ask"
		expect(
			s
				.read()
				.groups.map((g) => g.title)
				.sort(),
		).toEqual(["Other", "parked ask"]);
		expect(s.remove(grouped.id)).toBe(true);
		// "Other" lost its last item \u2192 pruned; "parked ask" was already empty \u2192 preserved.
		expect(s.read().groups.map((g) => g.title)).toEqual(["parked ask"]);
	} finally {
		rmSync(root, { recursive: true, force: true });
	}
});

test("remove of one item in a multi-item group leaves the group with its remaining items", () => {
	const root = tempRoot();
	try {
		const s = store(root);
		const first = s.add({ title: "a", group: "G" });
		const second = s.add({ title: "b", group: "G" });
		expect(s.remove(first.id)).toBe(true);
		expect(s.read().groups).toHaveLength(1);
		expect(s.read().groups[0]?.todos.map((t) => t.id)).toEqual([second.id]);
	} finally {
		rmSync(root, { recursive: true, force: true });
	}
});

test("replaceAll preserves user items and done items, replacing only the agent's open items", () => {
	const root = tempRoot();
	try {
		const s = store(root);
		s.add({ title: "user task", origin: "user" });
		s.add({ title: "agent open", group: "Task" });
		const done = s.add({ title: "agent finished", group: "Task" });
		s.update(done.id, { status: "done" });

		const plan = s.replaceAll({
			groups: [{ title: "Fresh", todos: [{ title: "new plan item" }] }],
		});
		const titles = flatItems(plan).map((t) => t.title);
		expect(titles).toContain("new plan item");
		expect(titles).toContain("user task");
		expect(titles).toContain("agent finished");
		expect(titles).not.toContain("agent open");
		expect(plan.todos.map((t) => t.title)).toEqual(["user task"]);
	} finally {
		rmSync(root, { recursive: true, force: true });
	}
});

test("a corrupt store file degrades to an empty list rather than throwing", () => {
	const root = tempRoot();
	try {
		const file = join(root, storeRel(SESSION));
		mkdirSync(dirname(file), { recursive: true });
		writeFileSync(file, "not json{", "utf8");
		expect(store(root).read()).toEqual({ todos: [], groups: [] });
	} finally {
		rmSync(root, { recursive: true, force: true });
	}
});

test("invalid items are dropped and unknown status coerces to pending", () => {
	const root = tempRoot();
	try {
		const file = join(root, storeRel(SESSION));
		mkdirSync(dirname(file), { recursive: true });
		writeFileSync(
			file,
			JSON.stringify({
				version: 1,
				todos: [{ id: "ok", title: "keep", status: "weird" }, { id: "bad-no-title" }, "garbage"],
			}),
			"utf8",
		);
		const plan = store(root).read();
		expect(plan.todos).toHaveLength(1);
		expect(plan.todos[0]?.status).toBe("pending");
	} finally {
		rmSync(root, { recursive: true, force: true });
	}
});

test("groupStatus derives the task lifecycle from the steps", () => {
	const root = tempRoot();
	try {
		const s = store(root);
		const a = s.add({ title: "step 1", group: "Task" });
		s.add({ title: "step 2", group: "Task" });
		const g = (): TodoGroup => {
			const grp = s.read().groups[0];
			if (!grp) throw new Error("group missing");
			return grp;
		};
		expect(groupStatus(g())).toBe("pending");
		s.update(a.id, { status: "in_progress" });
		expect(groupStatus(g())).toBe("active");
		s.update(a.id, { status: "done" });
		expect(groupStatus(g())).toBe("pending");
		for (const t of g().todos) s.update(t.id, { status: "done" });
		expect(groupStatus(g())).toBe("done");
	} finally {
		rmSync(root, { recursive: true, force: true });
	}
});

test("add with after inserts right after that item, inheriting its lane", () => {
	const root = tempRoot();
	try {
		const s = store(root);
		const g1 = s.add({ title: "one", group: "Task" });
		s.add({ title: "three", group: "Task" });
		const mid = s.add({ title: "two", after: g1.id, group: "ignored — after wins" });
		const group = s.read().groups[0];
		expect(group?.title).toBe("Task");
		expect(group?.todos.map((t) => t.title)).toEqual(["one", "two", "three"]);
		expect(mid.status).toBe("pending");

		const l1 = s.add({ title: "loose-a", origin: "user" });
		s.add({ title: "loose-c", origin: "user" });
		s.add({ title: "loose-b", after: l1.id });
		expect(s.read().todos.map((t) => t.title)).toEqual(["loose-a", "loose-b", "loose-c"]);
	} finally {
		rmSync(root, { recursive: true, force: true });
	}
});

test("add with an unknown after id throws (nothing written)", () => {
	const root = tempRoot();
	try {
		const s = store(root);
		s.add({ title: "existing", group: "Task" });
		expect(() => s.add({ title: "orphan", after: "t_nope" })).toThrow('No TODO with id "t_nope"');
		expect(s.list()).toHaveLength(1);
	} finally {
		rmSync(root, { recursive: true, force: true });
	}
});

test("setting in_progress auto-demotes the previous in_progress and reports it as paused", () => {
	const root = tempRoot();
	try {
		const s = store(root);
		const a = s.add({ title: "step a", group: "Task" });
		const b = s.add({ title: "step b", group: "Task" });
		const loose = s.add({ title: "user ask", origin: "user" });
		s.update(a.id, { status: "in_progress" });

		const result = s.update(b.id, { status: "in_progress" });
		expect(result?.todo.status).toBe("in_progress");
		expect(result?.paused.map((t) => t.id)).toEqual([a.id]);
		expect(s.get(a.id)?.status).toBe("pending");

		s.update(loose.id, { status: "in_progress" });
		const again = s.update(a.id, { status: "in_progress" });
		expect(again?.paused.map((t) => t.id)).toEqual([loose.id]);

		const rename = s.update(b.id, { title: "step b2" });
		expect(rename?.paused).toEqual([]);
		expect(s.get(a.id)?.status).toBe("in_progress");
	} finally {
		rmSync(root, { recursive: true, force: true });
	}
});

test("replaceAll re-establishes one in_progress across the MERGED plan, not just the fresh part", () => {
	const root = tempRoot();
	try {
		const s = store(root);
		const mine = s.add({ title: "user ask", origin: "user" });
		s.update(mine.id, { status: "in_progress" });

		s.replaceAll({
			groups: [{ title: "Task", todos: [{ title: "step", status: "in_progress" }] }],
		});

		const inProgress = flatItems(s.read()).filter((t) => t.status === "in_progress");
		expect(inProgress).toHaveLength(1);
		expect(inProgress[0]?.title).toBe("step");
		expect(s.get(mine.id)?.status).toBe("pending");
	} finally {
		rmSync(root, { recursive: true, force: true });
	}
});

test("replaceAll keeps only the first in_progress of a fresh plan (direct API: `todo_write` sends groups only)", () => {
	const root = tempRoot();
	try {
		const s = store(root);
		const plan = s.replaceAll({
			groups: [
				{
					title: "Task",
					todos: [
						{ title: "one", status: "in_progress" },
						{ title: "two", status: "in_progress" },
					],
				},
			],
		});
		const statuses = flatItems(plan).map((t) => t.status);
		expect(statuses).toEqual(["in_progress", "pending"]);
		expect(flatItems(plan)[0]?.title).toBe("one");
	} finally {
		rmSync(root, { recursive: true, force: true });
	}
});

test("artifact sanitize is per-kind: a commit needs a sha, every other kind a path", () => {
	const root = tempRoot();
	try {
		const todo = store(root).add({
			title: "step",
			artifacts: [
				{ kind: "commit", sha: "abc123", label: "step" },
				{ kind: "commit" },
				{ kind: "change", path: "src/a.ts" },
				{ kind: "change" },
			],
		});
		expect(store(root).get(todo.id)?.artifacts).toEqual([
			{ kind: "commit", sha: "abc123", label: "step" },
			{ kind: "change", path: "src/a.ts" },
		]);
	} finally {
		rmSync(root, { recursive: true, force: true });
	}
});

test("a version-3 file (pre-commit-kind) reads cleanly and upgrades to the current version on the next write", () => {
	const root = tempRoot();
	try {
		const file = join(root, storeRel(SESSION));
		mkdirSync(dirname(file), { recursive: true });
		writeFileSync(
			file,
			JSON.stringify({
				version: 3,
				todos: [
					{
						id: "t_old",
						title: "old step",
						status: "done",
						origin: "agent",
						artifacts: [{ kind: "change", path: "a.ts" }],
						createdAt: "2024-01-01T00:00:00Z",
						updatedAt: "2024-01-01T00:00:00Z",
					},
				],
				groups: [],
			}),
		);
		expect(store(root).get("t_old")?.artifacts).toEqual([{ kind: "change", path: "a.ts" }]);
		store(root).add({ title: "new" }); // any write upgrades the file version
		expect(JSON.parse(readFileSync(file, "utf8")).version).toBe(6);
	} finally {
		rmSync(root, { recursive: true, force: true });
	}
});

test("item summary/verification/commitSubject: set with done, cleared by empty string, sanitized on read", () => {
	const root = tempRoot();
	try {
		const todo = store(root).add({ title: "Implement FloodWait handling" });
		store(root).update(todo.id, {
			status: "done",
			summary: "Added throttling and fallback for failed batch sends.",
			verification: "bun test src/todos — 34 pass",
			commitSubject: "fix(sender): back off and retry on FloodWait",
		});
		expect(store(root).get(todo.id)?.summary).toBe(
			"Added throttling and fallback for failed batch sends.",
		);
		expect(store(root).get(todo.id)?.verification).toBe("bun test src/todos — 34 pass");
		expect(store(root).get(todo.id)?.commitSubject).toBe(
			"fix(sender): back off and retry on FloodWait",
		);
		store(root).update(todo.id, { summary: "", verification: "", commitSubject: "" });
		expect(store(root).get(todo.id)?.summary).toBeUndefined();
		expect(store(root).get(todo.id)?.verification).toBeUndefined();
		expect(store(root).get(todo.id)?.commitSubject).toBeUndefined();
	} finally {
		rmSync(root, { recursive: true, force: true });
	}
});

test("reopening a done item clears its stale completion fields but keeps the plan summary", () => {
	const root = tempRoot();
	try {
		const s = store(root);
		const todo = s.add({ title: "Implement FloodWait handling" });
		s.update(todo.id, {
			status: "done",
			summary: "Added throttling and fallback for failed batch sends.",
			verification: "bun test src/todos — 34 pass",
			commitSubject: "fix(sender): back off and retry on FloodWait",
		});
		s.setSummary("All tasks landed; e2e suite green.");

		s.update(todo.id, { status: "in_progress" });

		expect(s.get(todo.id)?.summary).toBeUndefined();
		expect(s.get(todo.id)?.verification).toBeUndefined();
		expect(s.get(todo.id)?.commitSubject).toBeUndefined();
		// The plan-level summary survives the re-open (stale) so the UI can show "Updating…" and the next
		// completion can extend it; only display/export gate it out.
		expect(s.read().summary).toBe("All tasks landed; e2e suite green.");

		s.update(todo.id, {
			status: "done",
			summary: "Retried with the corrected backoff window.",
			verification: "bun test src/todos — 35 pass",
			commitSubject: "fix(sender): widen the FloodWait backoff window",
		});
		expect(s.get(todo.id)?.summary).toBe("Retried with the corrected backoff window.");
		expect(s.get(todo.id)?.verification).toBe("bun test src/todos — 35 pass");
		expect(s.get(todo.id)?.commitSubject).toBe("fix(sender): widen the FloodWait backoff window");
	} finally {
		rmSync(root, { recursive: true, force: true });
	}
});

test("reopen and re-done in one patch keeps the freshly supplied summary/verification", () => {
	const root = tempRoot();
	try {
		const s = store(root);
		const todo = s.add({ title: "step" });
		s.update(todo.id, { status: "done", summary: "old claim", verification: "old check" });
		s.update(todo.id, {
			status: "pending",
			summary: "new claim",
			verification: "new check",
		});
		expect(s.get(todo.id)?.summary).toBe("new claim");
		expect(s.get(todo.id)?.verification).toBe("new check");
	} finally {
		rmSync(root, { recursive: true, force: true });
	}
});

test("plan summary: setSummary round-trips, empty clears, survives item edits, dropped by replaceAll", () => {
	const root = tempRoot();
	try {
		const todo = store(root).add({ title: "step" });
		store(root).setSummary("All tasks landed; e2e suite green.");
		expect(store(root).read().summary).toBe("All tasks landed; e2e suite green.");
		store(root).update(todo.id, { status: "done" });
		expect(store(root).read().summary).toBe("All tasks landed; e2e suite green.");
		store(root).replaceAll({ groups: [{ title: "next task", todos: [{ title: "a" }] }] });
		expect(store(root).read().summary).toBeUndefined();
		store(root).setSummary("v2");
		store(root).setSummary("   ");
		expect(store(root).read().summary).toBeUndefined();
	} finally {
		rmSync(root, { recursive: true, force: true });
	}
});

test("promote lifts a loose item into a group of its own, keeping its id as the group id", () => {
	const root = tempRoot();
	try {
		const s = store(root);
		const loose = s.add({ title: "fix auth bug", origin: "user" });
		const result = s.promote(loose.id);
		expect(result.ok).toBe(true);
		const group = result.ok ? result.group : undefined;
		expect(group?.id).toBe(loose.id);
		expect(group?.title).toBe("fix auth bug");
		expect(group?.todos).toEqual([]);
		const plan = s.read();
		expect(plan.todos).toEqual([]);
		expect(plan.groups).toHaveLength(1);
		expect(plan.groups[0]?.id).toBe(loose.id);
	} finally {
		rmSync(root, { recursive: true, force: true });
	}
});

test("promote accepts a title override, flattens it, and decodes agent escapes", () => {
	const root = tempRoot();
	try {
		const s = store(root);
		const loose = s.add({ title: "raw ask", origin: "user" });
		const result = s.promote(loose.id, "Fix \\u2705 bug\nnow");
		expect(result.ok).toBe(true);
		const group = result.ok ? result.group : undefined;
		expect(group?.title).toBe("Fix \u2705 bug now");
	} finally {
		rmSync(root, { recursive: true, force: true });
	}
});

test("promote refuses when its title collides with an existing group \u2014 the loose item is left in place", () => {
	const root = tempRoot();
	try {
		const s = store(root);
		const existing = s.add({ title: "step", group: "Fix auth" });
		const loose = s.add({ title: "fix auth", origin: "user" });
		// Silently merging the loose item into the pre-existing group would make the ask vanish
		// (same-title merge adds no step), so promote must reject and leave the loose item untouched
		// so the caller can retry with a disambiguating override.
		const col = s.promote(loose.id, "Fix auth");
		expect(col.ok).toBe(false);
		expect(col.ok || col.reason).toBe("title-collision");
		const plan = s.read();
		expect(plan.todos.map((t) => t.id)).toEqual([loose.id]);
		expect(plan.groups).toHaveLength(1);
		expect(plan.groups[0]?.todos.map((t) => t.id)).toEqual([existing.id]);
	} finally {
		rmSync(root, { recursive: true, force: true });
	}
});

test("promote refuses an empty or whitespace-only override \u2014 a blank group is unaddressable", () => {
	const root = tempRoot();
	try {
		const s = store(root);
		const loose = s.add({ title: "ask", origin: "user" });
		// A blank group would have no title for `todo_add group:` to target. The loose item stays
		// put so a follow-up promote with a real title still works.
		const emp1 = s.promote(loose.id, "");
		expect(emp1.ok).toBe(false);
		expect(emp1.ok || emp1.reason).toBe("empty-title");
		const emp2 = s.promote(loose.id, "   \n\t  ");
		expect(emp2.ok).toBe(false);
		expect(emp2.ok || emp2.reason).toBe("empty-title");
		expect(s.read().todos.map((t) => t.id)).toEqual([loose.id]);
		expect(s.read().groups).toEqual([]);
		// A real override still works afterwards.
		const okr = s.promote(loose.id, "Real title");
		expect(okr.ok).toBe(true);
		const group = okr.ok ? okr.group : undefined;
		expect(group?.title).toBe("Real title");
	} finally {
		rmSync(root, { recursive: true, force: true });
	}
});

test("promote refuses an id that is a grouped step (already in a group), not a loose item", () => {
	const root = tempRoot();
	try {
		const s = store(root);
		const step = s.add({ title: "step", group: "Task" });
		const gs = s.promote(step.id);
		expect(gs.ok).toBe(false);
		expect(gs.ok || gs.reason).toBe("grouped-step");
		// Plan unchanged.
		expect(s.read().groups[0]?.todos.map((t) => t.id)).toEqual([step.id]);
	} finally {
		rmSync(root, { recursive: true, force: true });
	}
});

test("promote returns undefined for an unknown id and writes nothing", () => {
	const root = tempRoot();
	try {
		const s = store(root);
		s.add({ title: "something", origin: "user" });
		const before = s.read();
		const un = s.promote("t_nope");
		expect(un.ok).toBe(false);
		expect(un.ok || un.reason).toBe("unknown-id");
		expect(s.read()).toEqual(before);
	} finally {
		rmSync(root, { recursive: true, force: true });
	}
});
