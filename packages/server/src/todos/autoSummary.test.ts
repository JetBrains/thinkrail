import { afterEach, beforeEach, expect, test } from "bun:test";
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { TodoStore } from "pi-todos/core";
import { setOneShotRunner } from "../assist";
import { previewPr } from "../pr/pr";
import { generateTodoSummary } from "./todos";

// generateTodoSummary: the host-side auto-draft of a completed plan's note when the agent left none.
// Uses the assist one-shot runner (stubbed) + a real TodoStore against a registered workspace.

let dataDir: string;
let repo: string;
const savedDataDir = process.env.THINKRAIL_DATA_DIR;
const SESSION = "sess-auto-summary";

beforeEach(() => {
	dataDir = mkdtempSync(join(tmpdir(), "trpi-todos-autosum-"));
	process.env.THINKRAIL_DATA_DIR = dataDir;
	repo = join(dataDir, "repo");
	mkdirSync(repo);
	writeFileSync(
		join(dataDir, "projects.json"),
		JSON.stringify([{ id: "p1", name: "repo", path: repo, slug: "repo", lastOpened: 1 }]),
	);
	writeFileSync(
		join(dataDir, "workspaces.json"),
		JSON.stringify([
			{
				id: "w1",
				projectId: "p1",
				name: "w1",
				branch: "main",
				worktreePath: repo,
				baseBranch: "main",
				createdAt: 1,
			},
		]),
	);
});

afterEach(() => {
	setOneShotRunner(null);
	rmSync(dataDir, { recursive: true, force: true });
	if (savedDataDir === undefined) delete process.env.THINKRAIL_DATA_DIR;
	else process.env.THINKRAIL_DATA_DIR = savedDataDir;
});

function seedDone(store: TodoStore): void {
	const a = store.add({ title: "Rework ranking" });
	store.update(a.id, { status: "done", summary: "EV ranking", verification: "pytest → 3 pass" });
	const b = store.add({ title: "Add logging" });
	store.update(b.id, { status: "done" });
}

test("generates and persists a PR-body summary when the completed plan has none", async () => {
	let seen = "";
	let seenSystem = "";
	const draft =
		"## Summary\n\nShipped the EV ranker end to end.\n\n" +
		"## Changes\n\n_no cross-cutting notes_\n\n" +
		"## Testing\n\n- pytest \u2192 3 pass";
	setOneShotRunner(async (req) => {
		seen = req.prompt;
		seenSystem = req.system ?? "";
		return { text: draft, model: { provider: "p", id: "m" } };
	});
	const store = new TodoStore(repo, SESSION);
	seedDone(store);

	const result = await generateTodoSummary({ workspaceId: "w1", sessionId: SESSION });
	expect(result.summary).toBe(draft);
	expect(new TodoStore(repo, SESSION).read().summary).toBe(draft);
	expect(seen).toContain("Rework ranking");
	expect(seen).toContain("verified: pytest");
	expect(seenSystem).toContain("## Summary");
	expect(seenSystem).toContain("## Changes");
	expect(seenSystem).toContain("## Testing");
});

test("discards the draft when the plan's step set changed during generation", async () => {
	const store = new TodoStore(repo, SESSION);
	seedDone(store);
	setOneShotRunner(async () => {
		// A concurrent edit lands while the model runs: a completed step is removed, leaving a DIFFERENT
		// (still all-done) set — the stale draft must not persist onto it.
		const s = new TodoStore(repo, SESSION);
		const first = s.read().todos[0];
		if (first) s.remove(first.id);
		return { text: "stale draft", model: { provider: "p", id: "m" } };
	});

	const result = await generateTodoSummary({ workspaceId: "w1", sessionId: SESSION });
	expect(result.summary).toBeNull();
	expect(new TodoStore(repo, SESSION).read().summary).toBeUndefined();
});

test("returns the existing note untouched and never calls the model", async () => {
	let called = false;
	setOneShotRunner(async () => {
		called = true;
		return { text: "nope", model: { provider: "p", id: "m" } };
	});
	const store = new TodoStore(repo, SESSION);
	seedDone(store);
	store.setSummary("Agent wrote this.");

	const result = await generateTodoSummary({ workspaceId: "w1", sessionId: SESSION });
	expect(result.summary).toBe("Agent wrote this.");
	expect(called).toBe(false);
});

test("returns null (no model call) when the plan is not fully done", async () => {
	let called = false;
	setOneShotRunner(async () => {
		called = true;
		return { text: "nope", model: { provider: "p", id: "m" } };
	});
	const store = new TodoStore(repo, SESSION);
	const a = store.add({ title: "Done step" });
	store.update(a.id, { status: "done" });
	store.add({ title: "Still open" });

	const result = await generateTodoSummary({ workspaceId: "w1", sessionId: SESSION });
	expect(result.summary).toBeNull();
	expect(called).toBe(false);
	expect(new TodoStore(repo, SESSION).read().summary).toBeUndefined();
});

test("previewPr drives summary generation on the host side so the PR body is never empty", async () => {
	const draft =
		"## Summary\n\nShipped end to end.\n\n" +
		"## Changes\n\n_no cross-cutting notes_\n\n" +
		"## Testing\n\n- pytest \u2192 3 pass";
	setOneShotRunner(async () => ({ text: draft, model: { provider: "p", id: "m" } }));
	const store = new TodoStore(repo, SESSION);
	seedDone(store);
	expect(new TodoStore(repo, SESSION).read().summary).toBeUndefined();

	const preview = await previewPr({ workspaceId: "w1", sessionId: SESSION });
	expect(new TodoStore(repo, SESSION).read().summary).toBe(draft);
	expect(preview.body).toContain("## Summary");
	expect(preview.body).toContain("## Testing");
});

test("a concurrent request shares the in-flight draft instead of getting null", async () => {
	let calls = 0;
	setOneShotRunner(async () => {
		calls += 1;
		await Bun.sleep(10);
		return { text: "One shared draft.", model: { provider: "p", id: "m" } };
	});
	const store = new TodoStore(repo, SESSION);
	seedDone(store);

	const [chat, plan] = await Promise.all([
		generateTodoSummary({ workspaceId: "w1", sessionId: SESSION }),
		generateTodoSummary({ workspaceId: "w1", sessionId: SESSION }),
	]);
	expect(chat.summary).toContain("One shared draft.");
	expect(chat.summary).toContain("## Changes");
	expect(chat.summary).toContain("## Testing");
	expect(plan.summary).toBe(chat.summary);
	expect(calls).toBe(1);
});
