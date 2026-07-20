import { afterEach, beforeEach, expect, test } from "bun:test";
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { Project, Workspace, WorkspaceHookEvent } from "@thinkrail/contracts";
import {
	approveHook,
	runOnCreateHook,
	runOnDeleteHook,
	runPreMergeHook,
	setHookPublisher,
} from "./hooks";

let dataDir: string;
let worktree: string;
const savedDataDir = process.env.THINKRAIL_DATA_DIR;

const project: Project = { id: "p1", name: "repo", path: "/unused", slug: "repo", lastOpened: 0 };
let workspace: Workspace;

beforeEach(() => {
	dataDir = mkdtempSync(join(tmpdir(), "trpi-hooks-test-data-"));
	process.env.THINKRAIL_DATA_DIR = dataDir;
	worktree = mkdtempSync(join(tmpdir(), "trpi-hooks-test-wt-"));
	workspace = {
		id: "ws1",
		projectId: project.id,
		name: "ws1",
		branch: "ws1",
		worktreePath: worktree,
		baseBranch: "main",
	};
});

afterEach(() => {
	setHookPublisher(null);
	rmSync(dataDir, { recursive: true, force: true });
	rmSync(worktree, { recursive: true, force: true });
	if (savedDataDir === undefined) delete process.env.THINKRAIL_DATA_DIR;
	else process.env.THINKRAIL_DATA_DIR = savedDataDir;
});

function writeHookConfig(config: Record<string, string>): void {
	mkdirSync(join(worktree, ".thinkrail"), { recursive: true });
	writeFileSync(join(worktree, ".thinkrail", "hooks.json"), JSON.stringify(config));
}

test("a workspace with no .thinkrail/hooks.json runs no hook and emits nothing", async () => {
	const events: WorkspaceHookEvent[] = [];
	setHookPublisher((e) => events.push(e));
	await runOnDeleteHook(workspace, project);
	expect(events).toEqual([]);
});

test("an unapproved hook emits hookAwaitingApproval and does not run", async () => {
	writeHookConfig({ onDelete: "echo should-not-run" });
	const events: WorkspaceHookEvent[] = [];
	setHookPublisher((e) => events.push(e));
	await runOnDeleteHook(workspace, project);
	expect(events).toEqual([
		{
			kind: "hookAwaitingApproval",
			workspaceId: "ws1",
			hook: "onDelete",
			command: "echo should-not-run",
		},
	]);
});

test("an approved hook runs and emits started then succeeded", async () => {
	writeHookConfig({ onDelete: "true" });
	approveHook("p1", "onDelete", "true");
	const events: WorkspaceHookEvent[] = [];
	setHookPublisher((e) => events.push(e));
	await runOnDeleteHook(workspace, project);
	expect(events.map((e) => e.kind)).toEqual(["hookStarted", "hookSucceeded"]);
});

test("a failing approved hook emits hookFailed with the real exit code", async () => {
	writeHookConfig({ onDelete: "exit 3" });
	approveHook("p1", "onDelete", "exit 3");
	const events: WorkspaceHookEvent[] = [];
	setHookPublisher((e) => events.push(e));
	await runOnDeleteHook(workspace, project);
	expect(events).toEqual([
		{ kind: "hookStarted", workspaceId: "ws1", hook: "onDelete" },
		{ kind: "hookFailed", workspaceId: "ws1", hook: "onDelete", exitCode: 3 },
	]);
});

test("runOnCreateHook doesn't block — it returns before the hook has finished running", async () => {
	writeHookConfig({ onCreate: "sleep 0.2 && echo done" });
	approveHook("p1", "onCreate", "sleep 0.2 && echo done");
	const events: WorkspaceHookEvent[] = [];
	setHookPublisher((e) => events.push(e));
	runOnCreateHook(workspace, project); // not awaited on purpose — this is the behavior under test
	expect(events).toEqual([]); // nothing has run yet — the call returned synchronously
	await new Promise((resolve) => setTimeout(resolve, 400));
	// "echo done" genuinely writes to stdout, which the real runner streams through as a hookOutput event
	// between hookStarted and hookSucceeded — included here rather than expected away.
	expect(events.map((e) => e.kind)).toEqual(["hookStarted", "hookOutput", "hookSucceeded"]);
});

test("runPreMergeHook returns false when the command fails", async () => {
	writeHookConfig({ preMerge: "exit 1" });
	approveHook("p1", "preMerge", "exit 1");
	expect(await runPreMergeHook(workspace, project)).toBe(false);
});

test("runPreMergeHook returns true when the command succeeds", async () => {
	writeHookConfig({ preMerge: "true" });
	approveHook("p1", "preMerge", "true");
	expect(await runPreMergeHook(workspace, project)).toBe(true);
});

test("runPreMergeHook returns false (fail-closed) when the command is unapproved", async () => {
	writeHookConfig({ preMerge: "true" });
	expect(await runPreMergeHook(workspace, project)).toBe(false);
});
