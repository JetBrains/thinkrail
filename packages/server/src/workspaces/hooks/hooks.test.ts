import { afterEach, beforeEach, expect, test } from "bun:test";
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { HookName, Project, Workspace, WorkspaceHookEvent } from "@thinkrail/contracts";
import {
	loadHookOverrides,
	loadWorkspaces,
	saveHookOverrides,
	saveWorkspaces,
} from "../../persistence";
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

/** Writes the Shared tier as a legacy flat `.thinkrail/hooks.json` (back-compat shape) — `combineMode`
 * defaults to `"both"`, which is all these tests need; `config.test.ts` covers the versioned shape itself. */
function writeHookConfig(config: Record<string, string>): void {
	mkdirSync(join(worktree, ".thinkrail"), { recursive: true });
	writeFileSync(join(worktree, ".thinkrail", "hooks.json"), JSON.stringify(config));
}

/** Writes the Shared tier's `hook` as a `{ script }` entry (same legacy flat shape as `writeHookConfig`,
 * just with a script-object value instead of a bare string) — `scriptPath` is intentionally never created
 * on disk when the test wants a "missing script" entry. */
function writeScriptHook(hook: HookName, scriptPath: string): void {
	mkdirSync(join(worktree, ".thinkrail"), { recursive: true });
	writeFileSync(
		join(worktree, ".thinkrail", "hooks.json"),
		JSON.stringify({ [hook]: { script: scriptPath } }),
	);
}

/** Sets this project's Local (host-local, never committed) tier for one hook to an inline command. */
function setLocalHook(hook: HookName, command: string): void {
	const all = loadHookOverrides();
	saveHookOverrides({ ...all, [project.id]: { ...all[project.id], [hook]: command } });
}

/** The persisted per-source status map for one hook on `workspace`'s saved record — `undefined` when the
 * record itself is missing, or absent whenever the hook has no recorded status yet. */
function hookStatusOf(hook: HookName) {
	return loadWorkspaces().find((w) => w.id === "ws1")?.hookStatus?.[hook];
}

/** Drops every ephemeral `hookOutput` event — a real `echo`'s stdout chunking isn't deterministic (one
 * chunk vs. several), so ordering assertions key on the state-transition events only. */
function withoutOutput(events: WorkspaceHookEvent[]) {
	return events
		.filter((e) => e.kind !== "hookOutput")
		.map((e) => ({ kind: e.kind, source: e.source }));
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
			workspaceName: "ws1",
			projectId: "p1",
			hook: "onDelete",
			source: "shared",
			command: "echo should-not-run",
		},
	]);
});

test("an approved hook runs and emits started then succeeded", async () => {
	writeHookConfig({ onDelete: "true" });
	approveHook("p1", "onDelete", "shared", "true");
	const events: WorkspaceHookEvent[] = [];
	setHookPublisher((e) => events.push(e));
	await runOnDeleteHook(workspace, project);
	expect(events).toEqual([
		{
			kind: "hookStarted",
			workspaceId: "ws1",
			workspaceName: "ws1",
			projectId: "p1",
			hook: "onDelete",
			source: "shared",
			command: "true",
		},
		{
			kind: "hookSucceeded",
			workspaceId: "ws1",
			workspaceName: "ws1",
			projectId: "p1",
			hook: "onDelete",
			source: "shared",
			command: "true",
		},
	]);
});

test("a failing approved hook emits hookFailed with the real exit code", async () => {
	writeHookConfig({ onDelete: "exit 3" });
	approveHook("p1", "onDelete", "shared", "exit 3");
	const events: WorkspaceHookEvent[] = [];
	setHookPublisher((e) => events.push(e));
	await runOnDeleteHook(workspace, project);
	expect(events).toEqual([
		{
			kind: "hookStarted",
			workspaceId: "ws1",
			workspaceName: "ws1",
			projectId: "p1",
			hook: "onDelete",
			source: "shared",
			command: "exit 3",
		},
		{
			kind: "hookFailed",
			workspaceId: "ws1",
			workspaceName: "ws1",
			projectId: "p1",
			hook: "onDelete",
			source: "shared",
			command: "exit 3",
			exitCode: 3,
		},
	]);
});

test("runOnCreateHook doesn't block — it returns before the hook has finished running", async () => {
	writeHookConfig({ onCreate: "sleep 0.2 && echo done" });
	approveHook("p1", "onCreate", "shared", "sleep 0.2 && echo done");
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
	approveHook("p1", "preMerge", "shared", "exit 1");
	expect(await runPreMergeHook(workspace, project)).toBe(false);
});

test("runPreMergeHook returns true when the command succeeds", async () => {
	writeHookConfig({ preMerge: "true" });
	approveHook("p1", "preMerge", "shared", "true");
	expect(await runPreMergeHook(workspace, project)).toBe(true);
});

test("runPreMergeHook returns false (fail-closed) when the command is unapproved", async () => {
	writeHookConfig({ preMerge: "true" });
	expect(await runPreMergeHook(workspace, project)).toBe(false);
});

test("an unapproved hook persists hookStatus: awaitingApproval onto the workspace record", async () => {
	writeHookConfig({ onDelete: "echo should-not-run" });
	saveWorkspaces([workspace]);
	await runOnDeleteHook(workspace, project);
	expect(hookStatusOf("onDelete")).toEqual({
		shared: { state: "awaitingApproval", command: "echo should-not-run" },
	});
});

test("a succeeding approved hook persists hookStatus: succeeded, replacing the prior state", async () => {
	writeHookConfig({ onDelete: "true" });
	approveHook("p1", "onDelete", "shared", "true");
	saveWorkspaces([workspace]);
	await runOnDeleteHook(workspace, project);
	expect(hookStatusOf("onDelete")).toEqual({ shared: { state: "succeeded", command: "true" } });
});

test("a failing approved hook persists hookStatus: failed with the real exit code", async () => {
	writeHookConfig({ onDelete: "exit 3" });
	approveHook("p1", "onDelete", "shared", "exit 3");
	saveWorkspaces([workspace]);
	await runOnDeleteHook(workspace, project);
	expect(hookStatusOf("onDelete")).toEqual({
		shared: { state: "failed", command: "exit 3", exitCode: 3 },
	});
});

test("persisting hookStatus for a workspace whose record is already gone is a silent no-op", async () => {
	writeHookConfig({ onDelete: "true" });
	approveHook("p1", "onDelete", "shared", "true");
	// Deliberately never saved to workspaces.json — mirrors an archived-mid-run workspace.
	await expect(runOnDeleteHook(workspace, project)).resolves.toBeUndefined();
	expect(loadWorkspaces()).toEqual([]);
});

test("hookStatus is set per-hook — persisting onDelete's status doesn't touch onCreate's", async () => {
	writeHookConfig({ onCreate: "true", onDelete: "true" });
	approveHook("p1", "onCreate", "shared", "true");
	approveHook("p1", "onDelete", "shared", "true");
	saveWorkspaces([workspace]);
	runOnCreateHook(workspace, project);
	await new Promise((resolve) => setTimeout(resolve, 200));
	await runOnDeleteHook(workspace, project);
	expect(hookStatusOf("onCreate")).toEqual({ shared: { state: "succeeded", command: "true" } });
	expect(hookStatusOf("onDelete")).toEqual({ shared: { state: "succeeded", command: "true" } });
});

test("a succeeding hook persists its command onto hookStatus too, not just on awaitingApproval", async () => {
	writeHookConfig({ onDelete: "true" });
	approveHook("p1", "onDelete", "shared", "true");
	saveWorkspaces([workspace]);
	await runOnDeleteHook(workspace, project);
	expect(hookStatusOf("onDelete")).toEqual({ shared: { state: "succeeded", command: "true" } });
});

// --- combine-mode "both": ordered, per-source, stop-on-first --------------------------------

test("combine-mode both runs the shared entry then the local entry, in order, when both are approved", async () => {
	writeHookConfig({ preMerge: "echo a" });
	setLocalHook("preMerge", "echo b");
	approveHook("p1", "preMerge", "shared", "echo a");
	approveHook("p1", "preMerge", "local", "echo b");
	saveWorkspaces([workspace]);
	const events: WorkspaceHookEvent[] = [];
	setHookPublisher((e) => events.push(e));

	expect(await runPreMergeHook(workspace, project)).toBe(true);

	expect(withoutOutput(events)).toEqual([
		{ kind: "hookStarted", source: "shared" },
		{ kind: "hookSucceeded", source: "shared" },
		{ kind: "hookStarted", source: "local" },
		{ kind: "hookSucceeded", source: "local" },
	]);
	expect(hookStatusOf("preMerge")).toEqual({
		shared: { state: "succeeded", command: "echo a" },
		local: { state: "succeeded", command: "echo b" },
	});
});

test("combine-mode both stops before the local entry when the shared entry fails, and reports not ok", async () => {
	writeHookConfig({ preMerge: "exit 1" });
	setLocalHook("preMerge", "echo should-not-run");
	approveHook("p1", "preMerge", "shared", "exit 1");
	approveHook("p1", "preMerge", "local", "echo should-not-run");
	saveWorkspaces([workspace]);
	const events: WorkspaceHookEvent[] = [];
	setHookPublisher((e) => events.push(e));

	expect(await runPreMergeHook(workspace, project)).toBe(false);

	expect(withoutOutput(events)).toEqual([
		{ kind: "hookStarted", source: "shared" },
		{ kind: "hookFailed", source: "shared" },
	]);
	// The local entry never started: no event tagged "local", and no persisted status for it either.
	expect(events.some((e) => e.source === "local")).toBe(false);
	expect(hookStatusOf("preMerge")).toEqual({
		shared: { state: "failed", command: "exit 1", exitCode: 1 },
	});
});

test("combine-mode both halts at an unapproved shared entry and never starts the local entry", async () => {
	writeHookConfig({ preMerge: "echo a" });
	setLocalHook("preMerge", "echo b");
	approveHook("p1", "preMerge", "local", "echo b"); // local is approved; shared deliberately is not
	saveWorkspaces([workspace]);
	const events: WorkspaceHookEvent[] = [];
	setHookPublisher((e) => events.push(e));

	expect(await runPreMergeHook(workspace, project)).toBe(false);

	expect(events).toEqual([
		{
			kind: "hookAwaitingApproval",
			workspaceId: "ws1",
			workspaceName: "ws1",
			projectId: "p1",
			hook: "preMerge",
			source: "shared",
			command: "echo a",
		},
	]);
	expect(hookStatusOf("preMerge")).toEqual({
		shared: { state: "awaitingApproval", command: "echo a" },
	});
});

test("a missing script entry emits hookFailed (exitCode -1) and halts before the local entry", async () => {
	writeScriptHook("onDelete", ".thinkrail/hooks/does-not-exist.sh");
	setLocalHook("onDelete", "echo should-not-run");
	approveHook("p1", "onDelete", "local", "echo should-not-run");
	saveWorkspaces([workspace]);
	const events: WorkspaceHookEvent[] = [];
	setHookPublisher((e) => events.push(e));

	await runOnDeleteHook(workspace, project);

	expect(events).toEqual([
		{
			kind: "hookFailed",
			workspaceId: "ws1",
			workspaceName: "ws1",
			projectId: "p1",
			hook: "onDelete",
			source: "shared",
			command: "script: .thinkrail/hooks/does-not-exist.sh",
			exitCode: -1,
		},
	]);
	// The local entry never started: no event tagged "local", and no persisted status for it either.
	expect(events.some((e) => e.source === "local")).toBe(false);
	expect(hookStatusOf("onDelete")).toEqual({
		shared: {
			state: "failed",
			command: "script: .thinkrail/hooks/does-not-exist.sh",
			exitCode: -1,
		},
	});
});

test("persisting one source's hookStatus preserves the sibling source's prior status", async () => {
	writeHookConfig({ onDelete: "true" });
	setLocalHook("onDelete", "true");
	approveHook("p1", "onDelete", "shared", "true");
	approveHook("p1", "onDelete", "local", "true");
	saveWorkspaces([workspace]);

	// Run Shared only first (mode "shared" — Local is not even resolved).
	workspace.hookCombineMode = "shared";
	await runOnDeleteHook(workspace, project);
	expect(hookStatusOf("onDelete")).toEqual({ shared: { state: "succeeded", command: "true" } });

	// Now run Local only — Shared's already-persisted status must survive untouched.
	workspace.hookCombineMode = "local";
	await runOnDeleteHook(workspace, project);
	expect(hookStatusOf("onDelete")).toEqual({
		shared: { state: "succeeded", command: "true" },
		local: { state: "succeeded", command: "true" },
	});
});
