import { expect, test } from "bun:test";
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { storeRel, TodoStore } from "./index.ts";

const SESSION = "sess-test";

function tempRoot(): string {
	return mkdtempSync(join(tmpdir(), "pi-todos-"));
}

/** A store for the fixed test session under `root`. */
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
		// A fresh store instance sees the persisted item (file is the source of truth).
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
		expect(s.update(todo.id, { status: "in_progress" })?.status).toBe("in_progress");
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
		expect(s.list()).toHaveLength(3); // flat across loose + groups
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
		expect(importGroup?.todos.map((t) => t.title)).toContain("kept done"); // rejoins its group
		expect(plan.groups.find((g) => g.title === "Gone")).toBeUndefined(); // dropped group is gone
		expect(plan.todos.map((t) => t.title)).toContain("orphan done"); // its done item survives, loose
	} finally {
		rmSync(root, { recursive: true, force: true });
	}
});

test("literal \\uXXXX escapes in titles/notes/group names are decoded, not shown verbatim", () => {
	const root = tempRoot();
	try {
		const s = store(root);
		// A model double-escaped the backslash, so the arg is the literal 6-char text "Б…".
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
		// The human legitimately typed the literal escape text; decoding it would silently corrupt it.
		const todo = s.add({ title: "about \\u0041", note: "\\u0042", origin: "user" });
		expect(todo.title).toBe("about \\u0041");
		expect(todo.note).toBe("\\u0042");
		// A user-origin title stays verbatim through an update too.
		expect(s.update(todo.id, { title: "still \\u0043" })?.title).toBe("still \\u0043");
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
		expect(s.update(todo.id, { note: "" })?.note).toBeUndefined();
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
		// Simulate an already-persisted agent item carrying the literal escape gibberish.
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
		// A read decodes agent text; a subsequent write persists the decoded form.
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
		// A normal UUID-shaped id is fine.
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
		expect(s.update(todo.id, { status: "in_progress" })?.status).toBe("in_progress");
		expect(s.remove(todo.id)).toBe(true);
		expect(s.read().groups).toHaveLength(0); // the emptied group is pruned
	} finally {
		rmSync(root, { recursive: true, force: true });
	}
});

test("replaceAll preserves user items and done items, replacing only the agent's open items", () => {
	const root = tempRoot();
	try {
		const s = store(root);
		s.add({ title: "user task", origin: "user" });
		s.add({ title: "agent open" }); // agent + pending → replaced
		const done = s.add({ title: "agent finished" });
		s.update(done.id, { status: "done" });

		const titles = s.replaceAll({ todos: [{ title: "new plan item" }] }).todos.map((t) => t.title);
		expect(titles).toContain("new plan item");
		expect(titles).toContain("user task"); // user item survives a re-plan
		expect(titles).toContain("agent finished"); // done history survives
		expect(titles).not.toContain("agent open"); // the agent's open item is replaced
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
