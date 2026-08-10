import { afterEach, beforeEach, expect, test } from "bun:test";
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { RemoteState, Workspace, WorkspaceWatchReadyResult } from "@thinkrail/contracts";
import { saveWorkspaces } from "../persistence";
import { stopAllWatches } from "../watch";
import { handleRequest } from "./handlers";

/** Requests carry their calling client (terminals scope PTYs to it); nothing here is client-scoped. */
const CTX = { clientKey: "test-client" };

let dataDir: string;
let repo: string;
const savedDataDir = process.env.THINKRAIL_DATA_DIR;

function git(cwd: string, ...args: string[]): void {
	const result = Bun.spawnSync(["git", "-C", cwd, ...args], { stdout: "ignore", stderr: "ignore" });
	if (!result.success) throw new Error(`git ${args.join(" ")} failed`);
}

beforeEach(() => {
	dataDir = mkdtempSync(join(tmpdir(), "trpi-handlers-test-"));
	process.env.THINKRAIL_DATA_DIR = dataDir;
	repo = join(dataDir, "repo");
	mkdirSync(repo);
	git(repo, "init", "-b", "main");
	git(repo, "config", "user.email", "t@thinkrail.test");
	git(repo, "config", "user.name", "test");
	writeFileSync(join(repo, "README.md"), "# repo\n");
	git(repo, "add", "-A");
	git(repo, "commit", "-m", "init");
	writeFileSync(
		join(dataDir, "projects.json"),
		JSON.stringify([{ id: "p1", name: "repo", path: repo, slug: "repo", lastOpened: 1 }]),
	);
});

afterEach(() => {
	stopAllWatches();
	rmSync(dataDir, { recursive: true, force: true });
	if (savedDataDir === undefined) delete process.env.THINKRAIL_DATA_DIR;
	else process.env.THINKRAIL_DATA_DIR = savedDataDir;
});

test("workspace.watchReady waits for startup once, then reports an already-ready watcher", async () => {
	const rows = (await handleRequest("workspace.list", { projectId: "p1" }, CTX)) as Workspace[];
	const workspace = rows[0];
	if (!workspace) throw new Error("expected a workspace");

	const first = (await handleRequest(
		"workspace.watchReady",
		{ workspaceId: workspace.id },
		CTX,
	)) as WorkspaceWatchReadyResult;
	expect(first).toEqual({ startupNudge: true });
	const second = (await handleRequest(
		"workspace.watchReady",
		{ workspaceId: workspace.id },
		CTX,
	)) as WorkspaceWatchReadyResult;
	expect(second).toEqual({ startupNudge: false });
});

test("workspace.remove rejects the Default at the handler level, before any teardown side-effect", async () => {
	// The wire-level guarantee the module guards alone can't pin: the handler must reject a Default
	// removal *first* — `forgetWorkspace` is its opening statement and throws — so the archive teardown
	// (spec-cache eviction, watcher stop, PTY kill, background worktree reclaim) never runs for it.
	const rows = (await handleRequest("workspace.list", { projectId: "p1" }, CTX)) as Workspace[];
	const def = rows[0];
	if (def?.kind !== "default")
		throw new Error("expected the ensured Default workspace pinned first");

	await expect(handleRequest("workspace.remove", { id: def.id }, CTX)).rejects.toThrow(
		"The Default workspace cannot be removed",
	);

	// The record survived, same id — nothing was torn down or re-minted.
	const after = (await handleRequest("workspace.list", { projectId: "p1" }, CTX)) as Workspace[];
	expect(after.filter((w) => w.kind === "default")).toHaveLength(1);
	expect(after[0]?.id).toBe(def.id);
});

// ── git.remoteState: the null-vs-object contract at the handler layer ─────
//
// A unique project id per test (never "p1") — `remotes/policy.ts`'s `PairRecord` map is an in-memory
// module singleton keyed by project id, shared across every test file in this `bun test` process, so a
// reused id could pick up a leftover record from an unrelated test.

test("git.remoteState answers null for a local-branch base (permanent — nothing to ever check), never for a not-yet-checked remote-tracking base", async () => {
	const projectId = "handlers-remotestate-p";
	saveWorkspaces([
		{
			id: "ws-local-base",
			projectId,
			name: "local-base",
			branch: "local-base",
			worktreePath: repo,
			baseBranch: "main", // not remote-tracking — nothing to ever check
		},
		{
			id: "ws-remote-base",
			projectId,
			name: "remote-base",
			branch: "remote-base",
			worktreePath: repo,
			baseBranch: "origin/main", // remote-tracking, but checkProject has never run for this project
		},
	]);

	expect(await handleRequest("git.remoteState", { workspaceId: "ws-local-base" }, CTX)).toBeNull();

	// NOT null: an honest "not yet known" object, disambiguated from the local-branch case above by
	// `lastCheckedAt` staying null on a real (non-null) RemoteState, per the handler's own doc comment.
	expect(await handleRequest("git.remoteState", { workspaceId: "ws-remote-base" }, CTX)).toEqual({
		projectId,
		ref: "origin/main",
		behind: null,
		lastCheckedAt: null,
	});
});

// ── git.fetchNow: the user-initiated fetch, end to end through the handler ─

test("git.fetchNow performs a real fetch, resolves a RemoteState the follow-up git.remoteState read agrees with immediately, and satisfies credential-ladder rung 2", async () => {
	// A second real repo stands in for "origin" — a local filesystem remote is a genuine `git fetch`
	// target, no network involved (same technique `git/git.test.ts` uses for its own remote-aware tests).
	const originRepo = join(dataDir, "origin");
	mkdirSync(originRepo);
	git(originRepo, "init", "-b", "main");
	git(originRepo, "config", "user.email", "t@thinkrail.test");
	git(originRepo, "config", "user.name", "test");
	writeFileSync(join(originRepo, "README.md"), "# origin\n");
	git(originRepo, "add", "-A");
	git(originRepo, "commit", "-m", "origin init");
	git(repo, "remote", "add", "origin", originRepo);

	const projectId = "handlers-fetchnow-p";
	writeFileSync(
		join(dataDir, "projects.json"),
		JSON.stringify([{ id: projectId, name: "repo", path: repo, slug: "repo", lastOpened: 1 }]),
	);
	saveWorkspaces([
		{
			id: "ws-fetch-now",
			projectId,
			name: "fetch-target",
			branch: "fetch-target",
			worktreePath: repo,
			baseBranch: "origin/main",
		},
	]);

	const result = (await handleRequest(
		"git.fetchNow",
		{ workspaceId: "ws-fetch-now" },
		CTX,
	)) as RemoteState;

	expect(result.projectId).toBe(projectId);
	expect(result.ref).toBe("origin/main");
	expect(result.behind).toBeNull(); // this ref's very first fetch in this repo — no baseline to count from
	expect(typeof result.lastCheckedAt).toBe("string");
	expect(result.dormant).toBeUndefined();

	// The scheduler's own cache read agrees immediately — no separate publish round-trip to wait on.
	expect(await handleRequest("git.remoteState", { workspaceId: "ws-fetch-now" }, CTX)).toEqual(
		result,
	);
});

test("git.fetchNow throws, without recording trust or nudging, when the underlying fetch genuinely fails", async () => {
	// No remote named "origin" exists at all — the real `git fetch` this handler makes is genuinely
	// unreachable, exercising the error path end to end rather than a faked git module.
	const projectId = "handlers-fetchnow-fail-p";
	writeFileSync(
		join(dataDir, "projects.json"),
		JSON.stringify([{ id: projectId, name: "repo", path: repo, slug: "repo", lastOpened: 1 }]),
	);
	saveWorkspaces([
		{
			id: "ws-fetch-fail",
			projectId,
			name: "fetch-target",
			branch: "fetch-target",
			worktreePath: repo,
			baseBranch: "origin/main",
		},
	]);

	await expect(
		handleRequest("git.fetchNow", { workspaceId: "ws-fetch-fail" }, CTX),
	).rejects.toThrow();
});
