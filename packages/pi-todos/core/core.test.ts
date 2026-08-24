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
		s.add({ title: "old" });
		const plan = s.replaceAll({
			todos: [{ title: "step 1", status: "done" }, { title: "step 2" }],
		});
		expect(plan.todos).toHaveLength(2);
		expect(plan.todos[0]?.status).toBe("done");
		expect(plan.todos[1]?.status).toBe("pending");
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
			todos: [{ title: "loose one" }],
			groups: [{ title: "Import", todos: [{ title: "parse" }, { title: "validate" }] }],
		});
		expect(plan.todos.map((t) => t.title)).toEqual(["loose one"]);
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

test("done items in a group rejoin it across a re-plan; a dropped group's done items fall to loose", () => {
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
		expect(plan.groups.find((g) => g.title === "Gone")).toBeUndefined();
		expect(plan.todos.map((t) => t.title)).toContain("orphan done");
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

test("update/remove find items inside a group by id", () => {
	const root = tempRoot();
	try {
		const s = store(root);
		const todo = s.add({ title: "grouped", group: "Auth" });
		expect(s.get(todo.id)?.title).toBe("grouped");
		expect(s.update(todo.id, { status: "in_progress" })?.todo.status).toBe("in_progress");
		expect(s.remove(todo.id)).toBe(true);
		expect(s.read().groups).toHaveLength(0);
	} finally {
		rmSync(root, { recursive: true, force: true });
	}
});

test("replaceAll preserves user items and done items, replacing only the agent's open items", () => {
	const root = tempRoot();
	try {
		const s = store(root);
		s.add({ title: "user task", origin: "user" });
		s.add({ title: "agent open" });
		const done = s.add({ title: "agent finished" });
		s.update(done.id, { status: "done" });

		const titles = s.replaceAll({ todos: [{ title: "new plan item" }] }).todos.map((t) => t.title);
		expect(titles).toContain("new plan item");
		expect(titles).toContain("user task");
		expect(titles).toContain("agent finished");
		expect(titles).not.toContain("agent open");
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
			todos: [{ title: "loose", status: "in_progress" }],
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
		expect(statuses).toEqual(["in_progress", "pending", "pending"]);
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

test("a version-3 file (pre-commit-kind) reads cleanly and upgrades to 4 on the next write", () => {
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
		store(root).add({ title: "new" });
		expect(JSON.parse(readFileSync(file, "utf8")).version).toBe(4);
	} finally {
		rmSync(root, { recursive: true, force: true });
	}
});
