import { afterEach, beforeEach, expect, test } from "bun:test";
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { TodoStore } from "pi-todos/core";
import { setOneShotRunner } from "../assist";
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

test("generates and persists a summary when the completed plan has none", async () => {
	let seen = "";
	setOneShotRunner(async (req) => {
		seen = req.prompt;
		return { text: "Shipped the EV ranker end to end.", model: { provider: "p", id: "m" } };
	});
	const store = new TodoStore(repo, SESSION);
	seedDone(store);

	const result = await generateTodoSummary({ workspaceId: "w1", sessionId: SESSION });
	expect(result.summary).toBe("Shipped the EV ranker end to end.");
	expect(new TodoStore(repo, SESSION).read().summary).toBe("Shipped the EV ranker end to end.");
	expect(seen).toContain("Rework ranking");
	expect(seen).toContain("verified: pytest");
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
