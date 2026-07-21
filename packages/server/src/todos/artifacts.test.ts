import { beforeEach, expect, test } from "bun:test";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { WORKSPACE_TODOS_DIR } from "@thinkrail/shared/paths";
import { STORE_DIR, storeRel, TodoStore } from "pi-todos/core";
import { __resetArtifactBaselines, reconcileChangeArtifacts } from "./artifacts";

const SESSION = "sess-artifacts";
// The store's own file — a git-visible app-state path the reconcile must never attribute as a change.
const STORE_PATH = storeRel(SESSION);

// The pi-free `pi-todos/core` can't import `@thinkrail/shared` (it stays vanilla-`pi`-installable), so it
// mirrors the todos path locally. Shared is the host-side source of truth; this pins the two in step so a
// change to one that forgets the other fails here rather than silently splitting the store location.
test("pi-todos STORE_DIR mirrors the shared WORKSPACE_TODOS_DIR", () => {
	expect(STORE_DIR).toBe(WORKSPACE_TODOS_DIR);
});

function tempStore(): { store: TodoStore; root: string } {
	const root = mkdtempSync(join(tmpdir(), "server-todos-"));
	return { store: new TodoStore(root, SESSION), root };
}

beforeEach(() => __resetArtifactBaselines());

test("done attaches the delta of changes since the in_progress baseline", () => {
	const { store, root } = tempStore();
	try {
		const todo = store.add({ title: "step" });
		// in_progress: baseline is what was already changed (a.ts).
		store.update(todo.id, { status: "in_progress" });
		reconcileChangeArtifacts(store, SESSION, () => ["a.ts"]);
		expect(store.get(todo.id)?.artifacts).toBeUndefined();

		// done: the step also touched b.ts → only b.ts is attributed to the step.
		store.update(todo.id, { status: "done" });
		reconcileChangeArtifacts(store, SESSION, () => ["a.ts", "b.ts"]);
		expect(store.get(todo.id)?.artifacts).toEqual([{ kind: "change", path: "b.ts" }]);
	} finally {
		rmSync(root, { recursive: true, force: true });
	}
});

test("no baseline (direct pending→done) falls back to the whole current change set", () => {
	const { store, root } = tempStore();
	try {
		const todo = store.add({ title: "step" });
		store.update(todo.id, { status: "done" });
		reconcileChangeArtifacts(store, SESSION, () => ["x.ts", "y.ts"]);
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
		reconcileChangeArtifacts(store, SESSION, () => [STORE_PATH]);
		// done: the only new git-visible paths are app state (the todos file) + one real file.
		store.update(todo.id, { status: "done" });
		reconcileChangeArtifacts(store, SESSION, () => [STORE_PATH, ".thinkrail", "src/impl.ts"]);
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
		reconcileChangeArtifacts(store, SESSION, () => [STORE_PATH]);
		expect(store.get(todo.id)?.artifacts).toBeUndefined();
	} finally {
		rmSync(root, { recursive: true, force: true });
	}
});

test("reconcile is idempotent — a done item already carrying a change is left untouched", () => {
	const { store, root } = tempStore();
	try {
		const todo = store.add({ title: "step" });
		store.update(todo.id, { status: "done" });
		reconcileChangeArtifacts(store, SESSION, () => ["x.ts"]);
		reconcileChangeArtifacts(store, SESSION, () => ["x.ts", "z.ts"]); // must not append z.ts
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
		reconcileChangeArtifacts(store, SESSION, () => ["impl.ts"]);
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
		reconcileChangeArtifacts(store, SESSION, () => ["a.ts"]);
		store.update(todo.id, { status: "done" });
		reconcileChangeArtifacts(store, SESSION, () => ["a.ts"]); // nothing new
		expect(store.get(todo.id)?.artifacts).toBeUndefined();
	} finally {
		rmSync(root, { recursive: true, force: true });
	}
});
