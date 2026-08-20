import { expect, test } from "bun:test";
import { existsSync, mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { WORKSPACE_TODOS_DIR } from "@thinkrail/shared/paths";
import { STORE_DIR, storeRel, TodoStore } from "pi-todos/core";
import { reconcileChangeArtifacts } from "./artifacts";
import {
	dropItemBaseline,
	otherSessionWindows,
	readBaselines,
	removeSessionBaselines,
	writeBaselines,
} from "./baselines";

const SESSION = "sess-artifacts";
const STORE_PATH = storeRel(SESSION);

test("pi-todos STORE_DIR mirrors the shared WORKSPACE_TODOS_DIR", () => {
	expect(STORE_DIR).toBe(WORKSPACE_TODOS_DIR);
});

function tempStore(): { store: TodoStore; root: string } {
	const root = mkdtempSync(join(tmpdir(), "server-todos-"));
	return { store: new TodoStore(root, SESSION), root };
}

test("done attaches the delta of changes since the in_progress baseline", () => {
	const { store, root } = tempStore();
	try {
		const todo = store.add({ title: "step" });
		store.update(todo.id, { status: "in_progress" });
		reconcileChangeArtifacts(store, root, SESSION, () => ["a.ts"]);
		expect(store.get(todo.id)?.artifacts).toBeUndefined();

		store.update(todo.id, { status: "done" });
		reconcileChangeArtifacts(store, root, SESSION, () => ["a.ts", "b.ts"]);
		expect(store.get(todo.id)?.artifacts).toEqual([{ kind: "change", path: "b.ts" }]);
	} finally {
		rmSync(root, { recursive: true, force: true });
	}
});

test("baselines persist on disk — a fresh process (new read) still sees the window", () => {
	const { store, root } = tempStore();
	try {
		const todo = store.add({ title: "step" });
		store.update(todo.id, { status: "in_progress" });
		reconcileChangeArtifacts(
			store,
			root,
			SESSION,
			() => ["a.ts"],
			undefined,
			() => "head1",
		);
		expect(readBaselines(root, SESSION)[todo.id]).toEqual({ paths: ["a.ts"], head: "head1" });

		const store2 = new TodoStore(root, SESSION);
		store2.update(todo.id, { status: "done" });
		reconcileChangeArtifacts(store2, root, SESSION, () => ["a.ts", "b.ts"]);
		expect(store2.get(todo.id)?.artifacts).toEqual([{ kind: "change", path: "b.ts" }]);
		expect(existsSync(join(root, WORKSPACE_TODOS_DIR, `${SESSION}.baselines.json`))).toBe(false);
	} finally {
		rmSync(root, { recursive: true, force: true });
	}
});

test("no baseline (direct pending→done) reports the current set but NEVER commits it", () => {
	const { store, root } = tempStore();
	try {
		const todo = store.add({ title: "step" });
		store.update(todo.id, { status: "done" });
		let called = false;
		reconcileChangeArtifacts(
			store,
			root,
			SESSION,
			() => ["x.ts", "y.ts"],
			() => {
				called = true;
				return { sha: "must-not-happen" };
			},
		);
		expect(called).toBe(false);
		expect(store.get(todo.id)?.artifacts).toEqual([
			{ kind: "change", path: "x.ts" },
			{ kind: "change", path: "y.ts" },
		]);
	} finally {
		rmSync(root, { recursive: true, force: true });
	}
});

test("app-state paths (.thinkrail/…) are never attributed — the todos JSON is not a produced change", () => {
	const { store, root } = tempStore();
	try {
		const todo = store.add({ title: "step" });
		store.update(todo.id, { status: "in_progress" });
		reconcileChangeArtifacts(store, root, SESSION, () => [STORE_PATH]);
		store.update(todo.id, { status: "done" });
		reconcileChangeArtifacts(store, root, SESSION, () => [STORE_PATH, ".thinkrail", "src/impl.ts"]);
		expect(store.get(todo.id)?.artifacts).toEqual([{ kind: "change", path: "src/impl.ts" }]);
	} finally {
		rmSync(root, { recursive: true, force: true });
	}
});

test("a done item whose only changes are app-state paths attaches nothing", () => {
	const { store, root } = tempStore();
	try {
		const todo = store.add({ title: "planning step" });
		store.update(todo.id, { status: "done" });
		reconcileChangeArtifacts(store, root, SESSION, () => [STORE_PATH]);
		expect(store.get(todo.id)?.artifacts).toBeUndefined();
	} finally {
		rmSync(root, { recursive: true, force: true });
	}
});

test("reconcile is idempotent — a done item already carrying a change set is left untouched", () => {
	const { store, root } = tempStore();
	try {
		const todo = store.add({ title: "step" });
		store.update(todo.id, { status: "done" });
		reconcileChangeArtifacts(store, root, SESSION, () => ["x.ts"]);
		reconcileChangeArtifacts(store, root, SESSION, () => ["x.ts", "z.ts"]);
		expect(store.get(todo.id)?.artifacts).toEqual([{ kind: "change", path: "x.ts" }]);
	} finally {
		rmSync(root, { recursive: true, force: true });
	}
});

test("change artifacts merge with (never replace) the agent's file/spec artifacts", () => {
	const { store, root } = tempStore();
	try {
		const todo = store.add({
			title: "step",
			artifacts: [{ kind: "spec", path: "SPEC.md", specId: "s1" }],
		});
		store.update(todo.id, { status: "done" });
		reconcileChangeArtifacts(store, root, SESSION, () => ["impl.ts"]);
		expect(store.get(todo.id)?.artifacts).toEqual([
			{ kind: "spec", path: "SPEC.md", specId: "s1" },
			{ kind: "change", path: "impl.ts" },
		]);
	} finally {
		rmSync(root, { recursive: true, force: true });
	}
});

test("done with no changes beyond the baseline attaches nothing", () => {
	const { store, root } = tempStore();
	try {
		const todo = store.add({ title: "step" });
		store.update(todo.id, { status: "in_progress" });
		reconcileChangeArtifacts(store, root, SESSION, () => ["a.ts"]);
		store.update(todo.id, { status: "done" });
		reconcileChangeArtifacts(store, root, SESSION, () => ["a.ts"]);
		expect(store.get(todo.id)?.artifacts).toBeUndefined();
	} finally {
		rmSync(root, { recursive: true, force: true });
	}
});

test("done commits the window: one commit artifact (the sha), and only the item's delta paths", () => {
	const { store, root } = tempStore();
	try {
		const todo = store.add({ title: "step" });
		store.update(todo.id, { status: "in_progress" });
		reconcileChangeArtifacts(store, root, SESSION, () => ["already.ts"]);
		store.update(todo.id, { status: "done" });
		const seen: string[][] = [];
		reconcileChangeArtifacts(
			store,
			root,
			SESSION,
			() => ["src/foo.ts"],
			({ paths, title, todoId }) => {
				seen.push(paths);
				expect(title).toBe("step");
				expect(todoId).toBe(todo.id);
				return { sha: "abc1234def" };
			},
		);
		expect(seen).toEqual([["src/foo.ts"]]);
		expect(store.get(todo.id)?.artifacts).toEqual([
			{ kind: "commit", sha: "abc1234def", label: "step" },
		]);
	} finally {
		rmSync(root, { recursive: true, force: true });
	}
});

test("one plan never has two open windows — starting an item demotes the previous one", () => {
	const { store, root } = tempStore();
	try {
		const first = store.add({ title: "first" });
		const second = store.add({ title: "second" });
		store.update(first.id, { status: "in_progress" });
		reconcileChangeArtifacts(store, root, SESSION, () => []);
		store.update(second.id, { status: "in_progress" });
		reconcileChangeArtifacts(store, root, SESSION, () => []);

		expect(store.get(first.id)?.status).toBe("pending");
		expect(Object.keys(readBaselines(root, SESSION))).toEqual([second.id]);
	} finally {
		rmSync(root, { recursive: true, force: true });
	}
});

test("commit gate: another CHAT's open window in the same worktree → no commit, path-list fallback", () => {
	const { store, root } = tempStore();
	try {
		const sibling = new TodoStore(root, "sess-other");
		const siblingTodo = sibling.add({ title: "their step" });
		sibling.update(siblingTodo.id, { status: "in_progress" });
		reconcileChangeArtifacts(sibling, root, "sess-other", () => []);

		const todo = store.add({ title: "step" });
		store.update(todo.id, { status: "in_progress" });
		reconcileChangeArtifacts(store, root, SESSION, () => []);
		store.update(todo.id, { status: "done" });
		let called = false;
		reconcileChangeArtifacts(
			store,
			root,
			SESSION,
			() => ["mine.ts"],
			() => {
				called = true;
				return { sha: "nope" };
			},
		);
		expect(called).toBe(false);
		expect(store.get(todo.id)?.artifacts).toEqual([{ kind: "change", path: "mine.ts" }]);

		sibling.update(siblingTodo.id, { status: "done" });
		reconcileChangeArtifacts(sibling, root, "sess-other", () => []);
		store.update(todo.id, { status: "in_progress" });
		reconcileChangeArtifacts(store, root, SESSION, () => []);
		store.update(todo.id, { status: "done" });
		reconcileChangeArtifacts(
			store,
			root,
			SESSION,
			() => ["mine.ts"],
			() => ({ sha: "sha-exclusive" }),
		);
		expect(store.get(todo.id)?.artifacts).toEqual([
			{ kind: "commit", sha: "sha-exclusive", label: "step" },
		]);
	} finally {
		rmSync(root, { recursive: true, force: true });
	}
});

test("commit gate: a window that overlapped another chat is never committed, even after the other closes", () => {
	const { store, root } = tempStore();
	try {
		const todo = store.add({ title: "step" });
		store.update(todo.id, { status: "in_progress" });
		reconcileChangeArtifacts(store, root, SESSION, () => []);
		expect(readBaselines(root, SESSION)[todo.id]?.shared).toBeUndefined();

		const sibling = new TodoStore(root, "sess-other");
		const theirs = sibling.add({ title: "their step" });
		sibling.update(theirs.id, { status: "in_progress" });
		reconcileChangeArtifacts(sibling, root, "sess-other", () => []);
		expect(readBaselines(root, SESSION)[todo.id]?.shared).toBe(true);

		sibling.update(theirs.id, { status: "done" });
		reconcileChangeArtifacts(sibling, root, "sess-other", () => []);
		store.update(todo.id, { status: "done" });
		let called = false;
		reconcileChangeArtifacts(
			store,
			root,
			SESSION,
			() => ["a.ts"],
			() => {
				called = true;
				return { sha: "nope" };
			},
		);
		expect(called).toBe(false);
		expect(store.get(todo.id)?.artifacts).toEqual([{ kind: "change", path: "a.ts" }]);
	} finally {
		rmSync(root, { recursive: true, force: true });
	}
});

test("two committable items in one pass: the second's delta is re-read, never the first's committed paths", () => {
	const { store, root } = tempStore();
	try {
		const first = store.add({ title: "first" });
		const second = store.add({ title: "second" });
		store.update(first.id, { status: "done" });
		store.update(second.id, { status: "done" });
		writeBaselines(root, SESSION, {
			[first.id]: { paths: [], head: null },
			[second.id]: { paths: [], head: null },
		});

		let reads = 0;
		const committed: string[][] = [];
		reconcileChangeArtifacts(
			store,
			root,
			SESSION,
			() => (++reads === 1 ? ["a.ts", "b.ts"] : ["b.ts"]),
			({ paths }) => {
				committed.push(paths);
				return { sha: `sha-${committed.length}` };
			},
		);
		expect(reads).toBe(2);
		expect(committed).toEqual([["a.ts", "b.ts"], ["b.ts"]]);
	} finally {
		rmSync(root, { recursive: true, force: true });
	}
});

test("commit gate: foreign dirt still present at done → no commit, path-list fallback", () => {
	const { store, root } = tempStore();
	try {
		const todo = store.add({ title: "step" });
		store.update(todo.id, { status: "in_progress" });
		reconcileChangeArtifacts(store, root, SESSION, () => ["foreign.ts"]);
		store.update(todo.id, { status: "done" });
		let called = false;
		const commit = () => {
			called = true;
			return { sha: "x" };
		};
		reconcileChangeArtifacts(store, root, SESSION, () => ["foreign.ts", "new.ts"], commit);
		expect(called).toBe(false);
		expect(store.get(todo.id)?.artifacts).toEqual([{ kind: "change", path: "new.ts" }]);
	} finally {
		rmSync(root, { recursive: true, force: true });
	}
});

test("commit gate: foreign dirt resolved by done → commit proceeds", () => {
	const { store, root } = tempStore();
	try {
		const todo = store.add({ title: "step" });
		store.update(todo.id, { status: "in_progress" });
		reconcileChangeArtifacts(store, root, SESSION, () => ["foreign.ts"]);
		store.update(todo.id, { status: "done" });
		reconcileChangeArtifacts(
			store,
			root,
			SESSION,
			() => ["new.ts"],
			() => ({ sha: "sha9" }),
		);
		expect(store.get(todo.id)?.artifacts).toEqual([{ kind: "commit", sha: "sha9", label: "step" }]);
	} finally {
		rmSync(root, { recursive: true, force: true });
	}
});

test("re-done replaces the old commit/change artifacts, keeping the agent's spec/file artifacts", () => {
	const { store, root } = tempStore();
	try {
		const todo = store.add({
			title: "step",
			artifacts: [{ kind: "spec", path: "SPEC.md", specId: "s1" }],
		});
		store.update(todo.id, { status: "in_progress" });
		reconcileChangeArtifacts(store, root, SESSION, () => []);
		store.update(todo.id, { status: "done" });
		reconcileChangeArtifacts(
			store,
			root,
			SESSION,
			() => ["a.ts"],
			() => ({ sha: "sha1" }),
		);
		expect(store.get(todo.id)?.artifacts).toEqual([
			{ kind: "spec", path: "SPEC.md", specId: "s1" },
			{ kind: "commit", sha: "sha1", label: "step" },
		]);

		store.update(todo.id, { status: "in_progress" });
		reconcileChangeArtifacts(store, root, SESSION, () => []);
		store.update(todo.id, { status: "done" });
		reconcileChangeArtifacts(
			store,
			root,
			SESSION,
			() => ["b.ts"],
			() => ({ sha: "sha2" }),
		);
		expect(store.get(todo.id)?.artifacts).toEqual([
			{ kind: "spec", path: "SPEC.md", specId: "s1" },
			{ kind: "commit", sha: "sha2", label: "step" },
		]);
	} finally {
		rmSync(root, { recursive: true, force: true });
	}
});

test("an orphan baseline (its item removed from the plan) is pruned by the next reconcile", () => {
	const { store, root } = tempStore();
	try {
		const todo = store.add({ title: "step" });
		store.update(todo.id, { status: "in_progress" });
		reconcileChangeArtifacts(store, root, SESSION, () => []);
		expect(readBaselines(root, SESSION)[todo.id]).toBeDefined();

		store.remove(todo.id);
		reconcileChangeArtifacts(store, root, SESSION, () => []);
		expect(readBaselines(root, SESSION)[todo.id]).toBeUndefined();
		expect(otherSessionWindows(root, "sess-other")).toBe(false);
	} finally {
		rmSync(root, { recursive: true, force: true });
	}
});

test("dropItemBaseline closes one removed item's window; removeSessionBaselines drops the whole sidecar", () => {
	const { root } = tempStore();
	try {
		writeBaselines(root, SESSION, {
			t1: { paths: [], head: null },
			t2: { paths: ["a.ts"], head: "h1" },
		});
		dropItemBaseline(root, SESSION, "t1");
		expect(Object.keys(readBaselines(root, SESSION))).toEqual(["t2"]);
		dropItemBaseline(root, SESSION, "absent");
		expect(Object.keys(readBaselines(root, SESSION))).toEqual(["t2"]);

		expect(otherSessionWindows(root, "sess-other")).toBe(true);
		removeSessionBaselines(root, SESSION);
		expect(existsSync(join(root, WORKSPACE_TODOS_DIR, `${SESSION}.baselines.json`))).toBe(false);
		expect(otherSessionWindows(root, "sess-other")).toBe(false);
		removeSessionBaselines(root, SESSION);
	} finally {
		rmSync(root, { recursive: true, force: true });
	}
});

test("a pending reset drops the persisted baseline", () => {
	const { store, root } = tempStore();
	try {
		const todo = store.add({ title: "step" });
		store.update(todo.id, { status: "in_progress" });
		reconcileChangeArtifacts(store, root, SESSION, () => ["a.ts"]);
		expect(readBaselines(root, SESSION)[todo.id]).toBeDefined();
		store.update(todo.id, { status: "pending" });
		reconcileChangeArtifacts(store, root, SESSION, () => ["a.ts"]);
		expect(readBaselines(root, SESSION)[todo.id]).toBeUndefined();
	} finally {
		rmSync(root, { recursive: true, force: true });
	}
});
