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

test("done attaches the delta of changes since the in_progress baseline", () => {
	const { store, root } = tempStore();
	try {
		const todo = store.add({ title: "step" });
		// in_progress: baseline is what was already changed (a.ts).
		store.update(todo.id, { status: "in_progress" });
		reconcileChangeArtifacts(store, root, SESSION, () => ["a.ts"]);
		expect(store.get(todo.id)?.artifacts).toBeUndefined();

		// done: the step also touched b.ts → only b.ts is attributed to the step.
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
		// The sidecar carries the snapshot — this is what survives a host restart.
		expect(readBaselines(root, SESSION)[todo.id]).toEqual({ paths: ["a.ts"], head: "head1" });

		// "Restart": a brand-new store instance over the same root computes the same delta.
		const store2 = new TodoStore(root, SESSION);
		store2.update(todo.id, { status: "done" });
		reconcileChangeArtifacts(store2, root, SESSION, () => ["a.ts", "b.ts"]);
		expect(store2.get(todo.id)?.artifacts).toEqual([{ kind: "change", path: "b.ts" }]);
		// Consumed baselines are dropped; an empty sidecar is removed, not left as `{}`.
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
		// With no observed window, every dirty path merely *looks* like this item's work — x.ts/y.ts could be
		// the user's WIP or a plan that predates the sidecar. Reportable, never committable.
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
		// done: the only new git-visible paths are app state (the todos file) + one real file.
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
		reconcileChangeArtifacts(store, root, SESSION, () => ["x.ts", "z.ts"]); // must not append z.ts
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
		reconcileChangeArtifacts(store, root, SESSION, () => ["a.ts"]); // nothing new
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
		reconcileChangeArtifacts(store, root, SESSION, () => ["already.ts"]); // baseline: foreign dirt
		store.update(todo.id, { status: "done" });
		// already.ts went clean again; the item's own work is src/foo.ts. The commit must name exactly that —
		// not "everything currently dirty" (which is what could absorb another window's work).
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

// Two items of ONE plan can't overlap — `pi-todos` keeps exactly one `in_progress` (the rest are demoted,
// and a demoted item's window is dropped). This pins that assumption, since the commit gate leans on it:
// only *other chats* can share the worktree.
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
		// A second chat in this workspace is mid-item: its sidecar records an open window.
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

		// Once the other chat's window closes, the same shape commits.
		sibling.update(siblingTodo.id, { status: "done" });
		reconcileChangeArtifacts(sibling, root, "sess-other", () => []); // drops its baseline
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
		// Our window opens first, alone — it records itself exclusive…
		const todo = store.add({ title: "step" });
		store.update(todo.id, { status: "in_progress" });
		reconcileChangeArtifacts(store, root, SESSION, () => []);
		expect(readBaselines(root, SESSION)[todo.id]?.shared).toBeUndefined();

		// …then a second chat starts an item beside it, which retroactively marks ours shared.
		const sibling = new TodoStore(root, "sess-other");
		const theirs = sibling.add({ title: "their step" });
		sibling.update(theirs.id, { status: "in_progress" });
		reconcileChangeArtifacts(sibling, root, "sess-other", () => []);
		expect(readBaselines(root, SESSION)[todo.id]?.shared).toBe(true);

		// Their window closes before ours does, so a "nothing open now" check would wave ours through — the
		// sticky flag is what remembers that the work interleaved.
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
		// Two exclusive windows recorded in earlier passes, both reaching this pass already `done` — the state a
		// host restart between the two reconciles leaves behind.
		writeBaselines(root, SESSION, {
			[first.id]: { paths: [], head: null },
			[second.id]: { paths: [], head: null },
		});

		// After the first commit the worktree holds only b.ts; a memo kept across the commit would hand the
		// second item a.ts as well — i.e. attribute already-committed work to it.
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
		expect(reads).toBe(2); // re-read after the commit, not memoized across it
		expect(committed).toEqual([["a.ts", "b.ts"], ["b.ts"]]);
	} finally {
		rmSync(root, { recursive: true, force: true });
	}
});

test("commit gate: foreign dirt still present at done → no commit, path-list fallback", () => {
	const { store, root } = tempStore();
	try {
		const todo = store.add({ title: "step" });
		// foreign.ts was already dirty at the baseline (a user WIP) and is *still* dirty at done.
		store.update(todo.id, { status: "in_progress" });
		reconcileChangeArtifacts(store, root, SESSION, () => ["foreign.ts"]);
		store.update(todo.id, { status: "done" });
		let called = false;
		const commit = () => {
			called = true;
			return { sha: "x" };
		};
		reconcileChangeArtifacts(store, root, SESSION, () => ["foreign.ts", "new.ts"], commit);
		expect(called).toBe(false); // gate blocks the commit — never sweeps foreign WIP
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
		reconcileChangeArtifacts(store, root, SESSION, () => ["foreign.ts"]); // baseline
		store.update(todo.id, { status: "done" });
		// foreign.ts is clean again by done (user committed/reverted it) → no foreign dirt left → commit.
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
		reconcileChangeArtifacts(store, root, SESSION, () => []); // window (clean start)
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

		// Re-open and re-work: a fresh baseline exists at the second done, so the old change set is replaced.
		store.update(todo.id, { status: "in_progress" });
		reconcileChangeArtifacts(store, root, SESSION, () => []); // baseline (clean start)
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

		// The item is removed while in_progress (a user pruning the plan) — its window must not outlive it,
		// or every later chat in this worktree would read it as "open" and fall back forever.
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
		// The UI's todo.remove path: only the removed item's window closes.
		dropItemBaseline(root, SESSION, "t1");
		expect(Object.keys(readBaselines(root, SESSION))).toEqual(["t2"]);
		dropItemBaseline(root, SESSION, "absent"); // idempotent no-op
		expect(Object.keys(readBaselines(root, SESSION))).toEqual(["t2"]);

		// The session.delete path: the deleted chat's sidecar dies with it — no permanently open foreign
		// window haunting the workspace's overlap checks.
		expect(otherSessionWindows(root, "sess-other")).toBe(true);
		removeSessionBaselines(root, SESSION);
		expect(existsSync(join(root, WORKSPACE_TODOS_DIR, `${SESSION}.baselines.json`))).toBe(false);
		expect(otherSessionWindows(root, "sess-other")).toBe(false);
		removeSessionBaselines(root, SESSION); // idempotent no-op
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
