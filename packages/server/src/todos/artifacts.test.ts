import { expect, test } from "bun:test";
import { execFileSync } from "node:child_process";
import { existsSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { GitFileChange, Workspace } from "@thinkrail/contracts";
import { WORKSPACE_TODOS_DIR } from "@thinkrail/shared/paths";
import { STORE_DIR, storeRel, TodoStore } from "pi-todos/core";
import { saveWorkspaces } from "../persistence";
import {
	enqueueTodoMutation,
	maybeAttachChangeArtifacts,
	reconcileChangeArtifacts,
	unattributedChanges,
} from "./artifacts";
import {
	dropItemBaseline,
	otherSessionWindows,
	readBaselines,
	removeSessionBaselines,
	writeBaselines,
} from "./baselines";
import { removeTodo } from "./todos";

const SESSION = "sess-artifacts";
const STORE_PATH = storeRel(SESSION);

test("pi-todos STORE_DIR mirrors the shared WORKSPACE_TODOS_DIR", async () => {
	expect(STORE_DIR).toBe(WORKSPACE_TODOS_DIR);
});

test("the first queued mutation starts synchronously and reserves against re-entry", async () => {
	const gate = deferred<void>();
	const order: string[] = [];
	let second!: Promise<void>;
	const first = enqueueTodoMutation("queue-sync", () => {
		order.push("first");
		second = enqueueTodoMutation("queue-sync", () => {
			order.push("second");
		});
		return gate.promise;
	});

	expect(order).toEqual(["first"]);
	gate.resolve(undefined);
	await Promise.all([first, second]);
	expect(order).toEqual(["first", "second"]);
});

test("a newly active window is captured before a held queue or an earlier done item can yield", async () => {
	const dataDir = mkdtempSync(join(tmpdir(), "todos-capture-data-"));
	const worktree = mkdtempSync(join(tmpdir(), "todos-capture-wt-"));
	const prevDataDir = process.env.THINKRAIL_DATA_DIR;
	process.env.THINKRAIL_DATA_DIR = dataDir;
	try {
		execFileSync("git", ["init", "-b", "main"], { cwd: worktree, stdio: "ignore" });
		execFileSync(
			"git",
			["-c", "user.email=t@t", "-c", "user.name=t", "commit", "--allow-empty", "-m", "init"],
			{ cwd: worktree, stdio: "ignore" },
		);
		saveWorkspaces([
			{
				id: "ws-capture",
				projectId: "p1",
				name: "capture",
				branch: "main",
				baseBranch: "main",
				worktreePath: worktree,
				createdAt: 0,
			} as Workspace,
		]);
		const store = new TodoStore(worktree, SESSION);
		const done = store.add({ title: "earlier done" });
		store.update(done.id, { status: "done" });
		const active = store.add({ title: "active" });
		store.update(active.id, { status: "in_progress" });
		writeFileSync(join(worktree, "before.ts"), "before\n");

		const gate = deferred<void>();
		const blocker = enqueueTodoMutation("ws-capture", () => gate.promise);
		const reconcile = maybeAttachChangeArtifacts("ws-capture", SESSION);
		expect(readBaselines(worktree, SESSION)[active.id]?.paths).toEqual(["before.ts"]);
		writeFileSync(join(worktree, "after.ts"), "after\n");

		gate.resolve(undefined);
		await Promise.all([blocker, reconcile]);
		expect(readBaselines(worktree, SESSION)[active.id]?.paths).toEqual(["before.ts"]);
	} finally {
		if (prevDataDir === undefined) delete process.env.THINKRAIL_DATA_DIR;
		else process.env.THINKRAIL_DATA_DIR = prevDataDir;
		rmSync(dataDir, { recursive: true, force: true });
		rmSync(worktree, { recursive: true, force: true });
	}
});

function deferred<T>(): { promise: Promise<T>; resolve: (value: T) => void } {
	let resolve!: (value: T) => void;
	const promise = new Promise<T>((done) => {
		resolve = done;
	});
	return { promise, resolve };
}

function tempStore(): { store: TodoStore; root: string } {
	const root = mkdtempSync(join(tmpdir(), "server-todos-"));
	return { store: new TodoStore(root, SESSION), root };
}

test("done attaches the delta of changes since the in_progress baseline", async () => {
	const { store, root } = tempStore();
	try {
		const todo = store.add({ title: "step" });
		store.update(todo.id, { status: "in_progress" });
		await reconcileChangeArtifacts(store, root, SESSION, async () => ["a.ts"]);
		expect(store.get(todo.id)?.artifacts).toBeUndefined();

		store.update(todo.id, { status: "done" });
		await reconcileChangeArtifacts(store, root, SESSION, async () => ["a.ts", "b.ts"]);
		expect(store.get(todo.id)?.artifacts).toEqual([{ kind: "change", path: "b.ts" }]);
	} finally {
		rmSync(root, { recursive: true, force: true });
	}
});

test("an in-progress reconcile aborts when the item finishes during its git read", async () => {
	const { store, root } = tempStore();
	try {
		const todo = store.add({ title: "step" });
		store.update(todo.id, { status: "in_progress" });
		const changed = deferred<string[]>();
		const stale = reconcileChangeArtifacts(store, root, SESSION, () => changed.promise);
		store.update(todo.id, { status: "done" });
		changed.resolve(["work.ts"]);
		await stale;

		expect(readBaselines(root, SESSION)[todo.id]).toBeUndefined();
		expect(store.get(todo.id)?.artifacts).toBeUndefined();
		await reconcileChangeArtifacts(store, root, SESSION, async () => ["work.ts"]);
		expect(store.get(todo.id)?.artifacts).toEqual([{ kind: "change", path: "work.ts" }]);
	} finally {
		rmSync(root, { recursive: true, force: true });
	}
});

test("a done reconcile cannot commit an item reopened during its git read", async () => {
	const { store, root } = tempStore();
	try {
		const todo = store.add({ title: "step" });
		store.update(todo.id, { status: "in_progress" });
		await reconcileChangeArtifacts(store, root, SESSION, async () => []);
		store.update(todo.id, { status: "done" });
		const changed = deferred<string[]>();
		let committed = false;
		const stale = reconcileChangeArtifacts(
			store,
			root,
			SESSION,
			() => changed.promise,
			() => {
				committed = true;
				return { sha: "must-not-commit" };
			},
		);
		store.update(todo.id, { status: "in_progress" });
		changed.resolve(["work.ts"]);
		await stale;

		expect(committed).toBe(false);
		expect(store.get(todo.id)?.status).toBe("in_progress");
		expect(store.get(todo.id)?.artifacts).toBeUndefined();
		expect(readBaselines(root, SESSION)[todo.id]).toBeDefined();
	} finally {
		rmSync(root, { recursive: true, force: true });
	}
});

test("later plan drift cannot retain an earlier completed item's baseline", async () => {
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
		const firstRead = deferred<string[]>();
		const secondRead = deferred<string[]>();
		let reads = 0;
		const stale = reconcileChangeArtifacts(
			store,
			root,
			SESSION,
			() => (++reads === 1 ? firstRead.promise : secondRead.promise),
			() => ({ sha: "committed-first" }),
		);
		firstRead.resolve(["first.ts"]);
		while (reads < 2) await Promise.resolve();
		store.update(second.id, { status: "in_progress" });
		secondRead.resolve(["second.ts"]);
		await stale;

		const baselines = readBaselines(root, SESSION);
		expect(baselines[first.id]).toBeUndefined();
		expect(baselines[second.id]).toBeDefined();
		expect(store.get(first.id)?.artifacts).toEqual([
			{ kind: "commit", sha: "committed-first", label: "first" },
		]);
	} finally {
		rmSync(root, { recursive: true, force: true });
	}
});

test("baselines persist on disk — a fresh process (new read) still sees the window", async () => {
	const { store, root } = tempStore();
	try {
		const todo = store.add({ title: "step" });
		store.update(todo.id, { status: "in_progress" });
		await reconcileChangeArtifacts(
			store,
			root,
			SESSION,
			async () => ["a.ts"],
			undefined,
			() => "head1",
		);
		expect(readBaselines(root, SESSION)[todo.id]).toEqual({ paths: ["a.ts"], head: "head1" });

		const store2 = new TodoStore(root, SESSION);
		store2.update(todo.id, { status: "done" });
		await reconcileChangeArtifacts(store2, root, SESSION, async () => ["a.ts", "b.ts"]);
		expect(store2.get(todo.id)?.artifacts).toEqual([{ kind: "change", path: "b.ts" }]);
		expect(existsSync(join(root, WORKSPACE_TODOS_DIR, `${SESSION}.baselines.json`))).toBe(false);
	} finally {
		rmSync(root, { recursive: true, force: true });
	}
});

test("no baseline (direct pending→done) reports the current set but NEVER commits it", async () => {
	const { store, root } = tempStore();
	try {
		const todo = store.add({ title: "step" });
		store.update(todo.id, { status: "done" });
		let called = false;
		await reconcileChangeArtifacts(
			store,
			root,
			SESSION,
			async () => ["x.ts", "y.ts"],
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

test("app-state paths (.thinkrail/…) are never attributed — the todos JSON is not a produced change", async () => {
	const { store, root } = tempStore();
	try {
		const todo = store.add({ title: "step" });
		store.update(todo.id, { status: "in_progress" });
		await reconcileChangeArtifacts(store, root, SESSION, async () => [STORE_PATH]);
		store.update(todo.id, { status: "done" });
		await reconcileChangeArtifacts(store, root, SESSION, async () => [
			STORE_PATH,
			".thinkrail",
			"src/impl.ts",
		]);
		expect(store.get(todo.id)?.artifacts).toEqual([{ kind: "change", path: "src/impl.ts" }]);
	} finally {
		rmSync(root, { recursive: true, force: true });
	}
});

test("a done item whose only changes are app-state paths attaches nothing", async () => {
	const { store, root } = tempStore();
	try {
		const todo = store.add({ title: "planning step" });
		store.update(todo.id, { status: "done" });
		await reconcileChangeArtifacts(store, root, SESSION, async () => [STORE_PATH]);
		expect(store.get(todo.id)?.artifacts).toBeUndefined();
	} finally {
		rmSync(root, { recursive: true, force: true });
	}
});

test("reconcile is idempotent — a done item already carrying a change set is left untouched", async () => {
	const { store, root } = tempStore();
	try {
		const todo = store.add({ title: "step" });
		store.update(todo.id, { status: "done" });
		await reconcileChangeArtifacts(store, root, SESSION, async () => ["x.ts"]);
		await reconcileChangeArtifacts(store, root, SESSION, async () => ["x.ts", "z.ts"]);
		expect(store.get(todo.id)?.artifacts).toEqual([{ kind: "change", path: "x.ts" }]);
	} finally {
		rmSync(root, { recursive: true, force: true });
	}
});

test("change artifacts merge with (never replace) the agent's file/spec artifacts", async () => {
	const { store, root } = tempStore();
	try {
		const todo = store.add({
			title: "step",
			artifacts: [{ kind: "spec", path: "SPEC.md", specId: "s1" }],
		});
		store.update(todo.id, { status: "done" });
		await reconcileChangeArtifacts(store, root, SESSION, async () => ["impl.ts"]);
		expect(store.get(todo.id)?.artifacts).toEqual([
			{ kind: "spec", path: "SPEC.md", specId: "s1" },
			{ kind: "change", path: "impl.ts" },
		]);
	} finally {
		rmSync(root, { recursive: true, force: true });
	}
});

test("done with no changes beyond the baseline attaches nothing", async () => {
	const { store, root } = tempStore();
	try {
		const todo = store.add({ title: "step" });
		store.update(todo.id, { status: "in_progress" });
		await reconcileChangeArtifacts(store, root, SESSION, async () => ["a.ts"]);
		store.update(todo.id, { status: "done" });
		await reconcileChangeArtifacts(store, root, SESSION, async () => ["a.ts"]);
		expect(store.get(todo.id)?.artifacts).toBeUndefined();
	} finally {
		rmSync(root, { recursive: true, force: true });
	}
});

test("done commits the window: one commit artifact (the sha), and only the item's delta paths", async () => {
	const { store, root } = tempStore();
	try {
		const todo = store.add({ title: "step" });
		store.update(todo.id, { status: "in_progress" });
		await reconcileChangeArtifacts(store, root, SESSION, async () => ["already.ts"]);
		store.update(todo.id, { status: "done" });
		const seen: string[][] = [];
		await reconcileChangeArtifacts(
			store,
			root,
			SESSION,
			async () => ["src/foo.ts"],
			({ paths, subject }) => {
				seen.push(paths);
				expect(subject).toBe("step");
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

test("only the first commitSubject line is committed; the title stays the artifact label", async () => {
	const { store, root } = tempStore();
	try {
		const todo = store.add({ title: "Newest-first chat order" });
		store.update(todo.id, { status: "in_progress" });
		await reconcileChangeArtifacts(store, root, SESSION, async () => []);
		store.update(todo.id, {
			status: "done",
			commitSubject: "feat(web): add newest-first chat order\n\nGenerated explanation",
		});
		const subjects: string[] = [];
		await reconcileChangeArtifacts(
			store,
			root,
			SESSION,
			async () => ["src/foo.ts"],
			({ subject }) => {
				subjects.push(subject);
				return { sha: "sha-subject" };
			},
		);
		expect(subjects).toEqual(["feat(web): add newest-first chat order"]);
		expect(store.get(todo.id)?.artifacts).toEqual([
			{ kind: "commit", sha: "sha-subject", label: "Newest-first chat order" },
		]);
	} finally {
		rmSync(root, { recursive: true, force: true });
	}
});

test("one plan never has two open windows — starting an item demotes the previous one", async () => {
	const { store, root } = tempStore();
	try {
		const first = store.add({ title: "first" });
		const second = store.add({ title: "second" });
		store.update(first.id, { status: "in_progress" });
		await reconcileChangeArtifacts(store, root, SESSION, async () => []);
		store.update(second.id, { status: "in_progress" });
		await reconcileChangeArtifacts(store, root, SESSION, async () => []);

		expect(store.get(first.id)?.status).toBe("pending");
		expect(Object.keys(readBaselines(root, SESSION))).toEqual([second.id]);
	} finally {
		rmSync(root, { recursive: true, force: true });
	}
});

test("commit gate: another CHAT's open window in the same worktree → no commit, path-list fallback", async () => {
	const { store, root } = tempStore();
	try {
		const sibling = new TodoStore(root, "sess-other");
		const siblingTodo = sibling.add({ title: "their step" });
		sibling.update(siblingTodo.id, { status: "in_progress" });
		await reconcileChangeArtifacts(sibling, root, "sess-other", async () => []);

		const todo = store.add({ title: "step" });
		store.update(todo.id, { status: "in_progress" });
		await reconcileChangeArtifacts(store, root, SESSION, async () => []);
		store.update(todo.id, { status: "done" });
		let called = false;
		await reconcileChangeArtifacts(
			store,
			root,
			SESSION,
			async () => ["mine.ts"],
			() => {
				called = true;
				return { sha: "nope" };
			},
		);
		expect(called).toBe(false);
		expect(store.get(todo.id)?.artifacts).toEqual([{ kind: "change", path: "mine.ts" }]);

		sibling.update(siblingTodo.id, { status: "done" });
		await reconcileChangeArtifacts(sibling, root, "sess-other", async () => []);
		store.update(todo.id, { status: "in_progress" });
		await reconcileChangeArtifacts(store, root, SESSION, async () => []);
		store.update(todo.id, { status: "done" });
		await reconcileChangeArtifacts(
			store,
			root,
			SESSION,
			async () => ["mine.ts"],
			() => ({ sha: "sha-exclusive" }),
		);
		expect(store.get(todo.id)?.artifacts).toEqual([
			{ kind: "commit", sha: "sha-exclusive", label: "step" },
		]);
	} finally {
		rmSync(root, { recursive: true, force: true });
	}
});

test("commit gate: a window that overlapped another chat is never committed, even after the other closes", async () => {
	const { store, root } = tempStore();
	try {
		const todo = store.add({ title: "step" });
		store.update(todo.id, { status: "in_progress" });
		await reconcileChangeArtifacts(store, root, SESSION, async () => []);
		expect(readBaselines(root, SESSION)[todo.id]?.shared).toBeUndefined();

		const sibling = new TodoStore(root, "sess-other");
		const theirs = sibling.add({ title: "their step" });
		sibling.update(theirs.id, { status: "in_progress" });
		await reconcileChangeArtifacts(sibling, root, "sess-other", async () => []);
		expect(readBaselines(root, SESSION)[todo.id]?.shared).toBe(true);

		sibling.update(theirs.id, { status: "done" });
		await reconcileChangeArtifacts(sibling, root, "sess-other", async () => []);
		store.update(todo.id, { status: "done" });
		let called = false;
		await reconcileChangeArtifacts(
			store,
			root,
			SESSION,
			async () => ["a.ts"],
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

test("two committable items in one pass: the second's delta is re-read, never the first's committed paths", async () => {
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
		await reconcileChangeArtifacts(
			store,
			root,
			SESSION,
			async () => (++reads === 1 ? ["a.ts", "b.ts"] : ["b.ts"]),
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

test("commit gate: foreign dirt still present at done → no commit, path-list fallback", async () => {
	const { store, root } = tempStore();
	try {
		const todo = store.add({ title: "step" });
		store.update(todo.id, { status: "in_progress" });
		await reconcileChangeArtifacts(store, root, SESSION, async () => ["foreign.ts"]);
		store.update(todo.id, { status: "done" });
		let called = false;
		const commit = () => {
			called = true;
			return { sha: "x" };
		};
		await reconcileChangeArtifacts(
			store,
			root,
			SESSION,
			async () => ["foreign.ts", "new.ts"],
			commit,
		);
		expect(called).toBe(false);
		expect(store.get(todo.id)?.artifacts).toEqual([{ kind: "change", path: "new.ts" }]);
	} finally {
		rmSync(root, { recursive: true, force: true });
	}
});

test("commit gate: foreign dirt resolved by done → commit proceeds", async () => {
	const { store, root } = tempStore();
	try {
		const todo = store.add({ title: "step" });
		store.update(todo.id, { status: "in_progress" });
		await reconcileChangeArtifacts(store, root, SESSION, async () => ["foreign.ts"]);
		store.update(todo.id, { status: "done" });
		await reconcileChangeArtifacts(
			store,
			root,
			SESSION,
			async () => ["new.ts"],
			() => ({ sha: "sha9" }),
		);
		expect(store.get(todo.id)?.artifacts).toEqual([{ kind: "commit", sha: "sha9", label: "step" }]);
	} finally {
		rmSync(root, { recursive: true, force: true });
	}
});

test("re-done APPENDS the new commit (revision history), keeping the agent's spec/file artifacts", async () => {
	const { store, root } = tempStore();
	try {
		const todo = store.add({
			title: "step",
			artifacts: [{ kind: "spec", path: "SPEC.md", specId: "s1" }],
		});
		store.update(todo.id, { status: "in_progress" });
		await reconcileChangeArtifacts(store, root, SESSION, async () => []);
		store.update(todo.id, { status: "done" });
		await reconcileChangeArtifacts(
			store,
			root,
			SESSION,
			async () => ["a.ts"],
			() => ({ sha: "sha1" }),
		);
		expect(store.get(todo.id)?.artifacts).toEqual([
			{ kind: "spec", path: "SPEC.md", specId: "s1" },
			{ kind: "commit", sha: "sha1", label: "step" },
		]);

		store.update(todo.id, { status: "in_progress" });
		await reconcileChangeArtifacts(store, root, SESSION, async () => []);
		store.update(todo.id, { status: "done" });
		await reconcileChangeArtifacts(
			store,
			root,
			SESSION,
			async () => ["b.ts"],
			() => ({ sha: "sha2" }),
		);
		expect(store.get(todo.id)?.artifacts).toEqual([
			{ kind: "spec", path: "SPEC.md", specId: "s1" },
			{ kind: "commit", sha: "sha1", label: "step" },
			{ kind: "commit", sha: "sha2", label: "step" },
		]);
	} finally {
		rmSync(root, { recursive: true, force: true });
	}
});

test("an orphan baseline (its item removed from the plan) is pruned by the next reconcile", async () => {
	const { store, root } = tempStore();
	try {
		const todo = store.add({ title: "step" });
		store.update(todo.id, { status: "in_progress" });
		await reconcileChangeArtifacts(store, root, SESSION, async () => []);
		expect(readBaselines(root, SESSION)[todo.id]).toBeDefined();

		store.remove(todo.id);
		await reconcileChangeArtifacts(store, root, SESSION, async () => []);
		expect(readBaselines(root, SESSION)[todo.id]).toBeUndefined();
		expect(otherSessionWindows(root, "sess-other")).toBe(false);
	} finally {
		rmSync(root, { recursive: true, force: true });
	}
});

test("dropItemBaseline closes one removed item's window; removeSessionBaselines drops the whole sidecar", async () => {
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

test("a pending reset drops the persisted baseline", async () => {
	const { store, root } = tempStore();
	try {
		const todo = store.add({ title: "step" });
		store.update(todo.id, { status: "in_progress" });
		await reconcileChangeArtifacts(store, root, SESSION, async () => ["a.ts"]);
		expect(readBaselines(root, SESSION)[todo.id]).toBeDefined();
		store.update(todo.id, { status: "pending" });
		await reconcileChangeArtifacts(store, root, SESSION, async () => ["a.ts"]);
		expect(readBaselines(root, SESSION)[todo.id]).toBeUndefined();
	} finally {
		rmSync(root, { recursive: true, force: true });
	}
});

test("a UI removal landing during an in-flight reconcile leaves no orphan window", async () => {
	const dataDir = mkdtempSync(join(tmpdir(), "todos-race-data-"));
	const worktree = mkdtempSync(join(tmpdir(), "todos-race-wt-"));
	const prevDataDir = process.env.THINKRAIL_DATA_DIR;
	process.env.THINKRAIL_DATA_DIR = dataDir;
	try {
		execFileSync("git", ["init", "-b", "main"], { cwd: worktree, stdio: "ignore" });
		execFileSync(
			"git",
			["-c", "user.email=t@t", "-c", "user.name=t", "commit", "--allow-empty", "-m", "init"],
			{ cwd: worktree, stdio: "ignore" },
		);
		saveWorkspaces([
			{
				id: "ws-todo-race",
				projectId: "p1",
				name: "race",
				branch: "main",
				baseBranch: "main",
				worktreePath: worktree,
				createdAt: 0,
			} as Workspace,
		]);
		writeFileSync(join(worktree, "dirty.ts"), "work\n");
		const store = new TodoStore(worktree, SESSION);
		const todo = store.add({ title: "step" });
		store.update(todo.id, { status: "in_progress" });

		const reconcile = maybeAttachChangeArtifacts("ws-todo-race", SESSION);
		expect(readBaselines(worktree, SESSION)[todo.id]?.paths).toEqual(["dirty.ts"]);
		await new Promise((resolve) => setTimeout(resolve, 0));
		const removal = removeTodo({ workspaceId: "ws-todo-race", sessionId: SESSION, id: todo.id });
		await Promise.all([reconcile, removal]);

		expect(store.get(todo.id)).toBeUndefined();
		expect(readBaselines(worktree, SESSION)[todo.id]).toBeUndefined();
		expect(otherSessionWindows(worktree, "sess-other")).toBe(false);
	} finally {
		if (prevDataDir === undefined) delete process.env.THINKRAIL_DATA_DIR;
		else process.env.THINKRAIL_DATA_DIR = prevDataDir;
		rmSync(dataDir, { recursive: true, force: true });
		rmSync(worktree, { recursive: true, force: true });
	}
});

test("unattributedChanges keeps only what no item claims — change paths and app state drop", async () => {
	const { store, root } = tempStore();
	try {
		const todo = store.add({ title: "step" });
		store.update(todo.id, { status: "done" });
		await reconcileChangeArtifacts(store, root, SESSION, async () => ["claimed.ts"]);
		const rows: GitFileChange[] = [
			{ path: "claimed.ts", status: "modified" },
			{ path: "loose.ts", status: "modified" },
			{ path: ".thinkrail/context/todos/x.json", status: "modified" },
		];
		expect(unattributedChanges(rows, store.read(), readBaselines(root, SESSION))).toEqual([
			{ path: "loose.ts", status: "modified" },
		]);
	} finally {
		rmSync(root, { recursive: true, force: true });
	}
});

test("unattributedChanges: an open window keeps only its baseline's pre-existing dirt", async () => {
	const { store, root } = tempStore();
	try {
		const todo = store.add({ title: "step" });
		store.update(todo.id, { status: "in_progress" });
		await reconcileChangeArtifacts(store, root, SESSION, async () => ["preexisting.ts"]);
		const rows: GitFileChange[] = [
			{ path: "preexisting.ts", status: "modified" },
			{ path: "in-flight.ts", status: "modified" },
		];
		expect(unattributedChanges(rows, store.read(), readBaselines(root, SESSION))).toEqual([
			{ path: "preexisting.ts", status: "modified" },
		]);
	} finally {
		rmSync(root, { recursive: true, force: true });
	}
});

test("unattributedChanges: with no items and no windows, everything dirty is unattributed", () => {
	const { store, root } = tempStore();
	try {
		const rows: GitFileChange[] = [{ path: "anything.ts", status: "untracked" }];
		expect(unattributedChanges(rows, store.read(), readBaselines(root, SESSION))).toEqual(rows);
	} finally {
		rmSync(root, { recursive: true, force: true });
	}
});
