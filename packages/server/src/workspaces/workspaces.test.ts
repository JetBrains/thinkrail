import { afterEach, beforeEach, expect, test } from "bun:test";
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { approveHook } from "./hooks";
import {
	createWorkspace,
	forgetWorkspace,
	listWorkspaces,
	reclaimWorktree,
	removeWorkspace,
	renameWorkspace,
	setWorkspacePublisher,
	type WorkspaceLifecycleEvent,
} from "./workspaces";

function gitOut(cwd: string, ...args: string[]): string {
	const r = Bun.spawnSync(["git", "-C", cwd, ...args], { stdout: "pipe", stderr: "ignore" });
	return new TextDecoder().decode(r.stdout).trim();
}

let dataDir: string;
let repo: string;
const savedDataDir = process.env.THINKRAIL_DATA_DIR;

function git(cwd: string, ...args: string[]): void {
	const result = Bun.spawnSync(["git", "-C", cwd, ...args], { stdout: "ignore", stderr: "ignore" });
	if (!result.success) throw new Error(`git ${args.join(" ")} failed`);
}

beforeEach(() => {
	dataDir = mkdtempSync(join(tmpdir(), "trpi-ws-test-"));
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
	setWorkspacePublisher(null); // never leak a test's lifecycle sink into the next
	rmSync(dataDir, { recursive: true, force: true });
	if (savedDataDir === undefined) delete process.env.THINKRAIL_DATA_DIR;
	else process.env.THINKRAIL_DATA_DIR = savedDataDir;
});

test("createWorkspace cuts a fresh branch from baseRef and records it as the base", async () => {
	// A second branch with its own commit, so "branched from here" is verifiable by commit sha.
	git(repo, "branch", "feature/base");
	git(repo, "switch", "feature/base");
	writeFileSync(join(repo, "feature.txt"), "feature\n");
	git(repo, "add", "-A");
	git(repo, "commit", "-m", "feature commit");
	git(repo, "switch", "main");
	const baseSha = gitOut(repo, "rev-parse", "feature/base");

	const ws = await createWorkspace("p1", undefined, "feature/base");
	expect(ws.baseBranch).toBe("feature/base");
	// The worktree's new branch was cut from feature/base's tip, not main's.
	expect(gitOut(ws.worktreePath, "rev-parse", "HEAD")).toBe(baseSha);
	// And it's its own fresh local branch (not a detached checkout of the base).
	expect(gitOut(ws.worktreePath, "rev-parse", "--abbrev-ref", "HEAD")).toBe(ws.branch);
	expect(ws.branch).not.toBe("feature/base");
});

test("createWorkspace branches off a locally-present remote ref without a network fetch", async () => {
	// A bare remote whose main is already fetched locally as origin/main. Create off origin/main must
	// branch from the local remote-tracking ref (no `git fetch` on the critical path).
	const remoteRepo = join(dataDir, "remote.git");
	git(repo, "init", "--bare", remoteRepo);
	git(repo, "remote", "add", "origin", remoteRepo);
	git(repo, "push", "origin", "main");
	git(repo, "fetch", "origin"); // origin/main now present locally
	const originSha = gitOut(repo, "rev-parse", "origin/main");

	const ws = await createWorkspace("p1", undefined, "origin/main");
	expect(ws.baseBranch).toBe("origin/main");
	expect(gitOut(ws.worktreePath, "rev-parse", "HEAD")).toBe(originSha);
	expect(gitOut(ws.worktreePath, "rev-parse", "--abbrev-ref", "HEAD")).toBe(ws.branch);
});

test("createWorkspace seeds a self-ignoring .thinkrail/context scratch dir kept out of git", async () => {
	const ws = await createWorkspace("p1");
	const gitignore = join(ws.worktreePath, ".thinkrail", "context", ".gitignore");
	expect(existsSync(gitignore)).toBe(true);
	expect(readFileSync(gitignore, "utf8")).toBe("*\n");

	// A temp doc written there is ignored by git — nothing to commit.
	writeFileSync(join(ws.worktreePath, ".thinkrail", "context", "TASK-x.md"), "scratch\n");
	expect(gitOut(ws.worktreePath, "check-ignore", ".thinkrail/context/TASK-x.md")).toBe(
		".thinkrail/context/TASK-x.md",
	);
	// The self-ignoring `.gitignore` (a lone `*`) matches itself too, so the whole dir is invisible to
	// `git status` — zero footprint, nothing accidentally committable.
	expect(gitOut(ws.worktreePath, "status", "--porcelain")).not.toContain(".thinkrail");
});

test("createWorkspace marks a user-named workspace renamed; an auto-named one stays eligible", async () => {
	const auto = await createWorkspace("p1");
	expect(auto.name).toBe("workspace-1");
	expect(auto.renamed).toBeUndefined();

	const named = await createWorkspace("p1", "My Feature");
	expect(named.name).toBe("My Feature"); // display name: casing preserved
	expect(named.branch).toBe("my-feature"); // branch: derived kebab slug
	expect(named.renamed).toBe(true);
});

test("createWorkspace stamps hookCombineMode onto the record when given; omitted leaves it absent", async () => {
	const withMode = await createWorkspace("p1", undefined, undefined, "shared");
	expect(withMode.hookCombineMode).toBe("shared");
	// Persisted, not just returned — a reload sees the same value.
	expect(listWorkspaces("p1").find((w) => w.id === withMode.id)?.hookCombineMode).toBe("shared");

	const withoutMode = await createWorkspace("p1");
	expect(withoutMode.hookCombineMode).toBeUndefined();
	// Not merely `undefined` — the key itself must be absent (exactOptionalPropertyTypes discipline).
	expect(Object.hasOwn(withoutMode, "hookCombineMode")).toBe(false);
	expect(
		listWorkspaces("p1").find((w) => w.id === withoutMode.id)?.hookCombineMode,
	).toBeUndefined();
});

test("renameWorkspace moves the branch in place: record + git follow, the worktree dir does not", async () => {
	const ws = await createWorkspace("p1");
	const renamed = renameWorkspace(ws.id, "add login flow");

	expect(renamed.name).toBe("add login flow"); // display name (sanitized), decoupled from the branch
	expect(renamed.branch).toBe("add-login-flow"); // branch: derived kebab slug
	expect(renamed.renamed).toBe(true);
	expect(renamed.worktreePath).toBe(ws.worktreePath);
	// The worktree's HEAD followed the ref rename; the old branch is gone from the repo.
	expect(gitOut(ws.worktreePath, "rev-parse", "--abbrev-ref", "HEAD")).toBe("add-login-flow");
	expect(gitOut(repo, "for-each-ref", "--format=%(refname:short)", "refs/heads")).not.toContain(
		"workspace-1",
	);
	// And the record on disk agrees.
	expect(listWorkspaces("p1")[0]?.name).toBe("add login flow");
	expect(listWorkspaces("p1")[0]?.branch).toBe("add-login-flow");
});

test("renameWorkspace with lock:false renames name + branch but leaves renamed unset (provisional)", async () => {
	const ws = await createWorkspace("p1");
	const renamed = renameWorkspace(ws.id, "add login flow", { lock: false });

	expect(renamed.name).toBe("add login flow");
	expect(renamed.branch).toBe("add-login-flow");
	expect(renamed.renamed).toBeUndefined(); // still eligible for the agentic refinement
	expect(gitOut(ws.worktreePath, "rev-parse", "--abbrev-ref", "HEAD")).toBe("add-login-flow");
	expect(listWorkspaces("p1")[0]?.renamed).toBeUndefined();

	// A later default (lock) rename still moves the branch and now locks it.
	const locked = renameWorkspace(ws.id, "final name");
	expect(locked.name).toBe("final name");
	expect(locked.branch).toBe("final-name");
	expect(locked.renamed).toBe(true);
});

test("renameWorkspace suffixes on collision with an existing branch", async () => {
	git(repo, "branch", "add-login-flow");
	const ws = await createWorkspace("p1");
	const renamed = renameWorkspace(ws.id, "add login flow");
	// The branch is uniqued on collision; the display name stays clean (the chip disambiguates).
	expect(renamed.branch).toBe("add-login-flow-2");
	expect(renamed.name).toBe("add login flow");
});

test("renameWorkspace re-points siblings basing their diff on the old branch", async () => {
	const first = await createWorkspace("p1");
	const dependent = await createWorkspace("p1", "on top", first.branch);
	expect(dependent.baseBranch).toBe(first.branch);

	renameWorkspace(first.id, "core work");
	const after = listWorkspaces("p1");
	expect(after.find((w) => w.id === dependent.id)?.baseBranch).toBe("core-work");
	expect(after.find((w) => w.id === first.id)?.branch).toBe("core-work");
});

test("renameWorkspace throws on an unknown workspace", () => {
	expect(() => renameWorkspace("nope", "anything")).toThrow("Unknown workspace: nope");
});

test("renameWorkspace also suffixes when the candidate's worktree dir is occupied (branch free)", async () => {
	const first = await createWorkspace("p1");
	renameWorkspace(first.id, "real name"); // frees branch workspace-1; dir workspace-1 stays occupied

	const second = await createWorkspace("p1"); // dir-aware create lands on workspace-2
	const renamed = renameWorkspace(second.id, "workspace 1"); // branch free, dir taken → suffix
	expect(renamed.branch).toBe("workspace-1-2");
	expect(renamed.name).toBe("workspace 1"); // display name unaffected by the branch's dir-collision suffix
});

test("creating after a rename skips the freed name whose worktree dir is still occupied", async () => {
	const ws = await createWorkspace("p1");
	expect(ws.branch).toBe("workspace-1");
	renameWorkspace(ws.id, "real name");

	// Branch `workspace-1` is free again, but its dir is still this workspace's cwd — the next create
	// must not try to reuse it (`git worktree add` would fail on the existing directory).
	const next = await createWorkspace("p1");
	expect(next.branch).toBe("workspace-2");
	expect(next.worktreePath).not.toBe(ws.worktreePath);
	expect(existsSync(next.worktreePath)).toBe(true);
});

test("forgetWorkspace drops the record + returns it, but leaves the worktree for a separate reclaim", async () => {
	const ws = await createWorkspace("p1");
	expect(listWorkspaces("p1")).toHaveLength(1);

	// forgetWorkspace removes the record synchronously (gone from the list) and hands back the record…
	const forgotten = forgetWorkspace(ws.id);
	expect(forgotten?.id).toBe(ws.id);
	expect(listWorkspaces("p1")).toHaveLength(0);
	// …but the worktree is still registered with git (the slow reclaim runs separately, e.g. backgrounded).
	const before = Bun.spawnSync(["git", "-C", repo, "worktree", "list"], { stdout: "pipe" });
	expect(new TextDecoder().decode(before.stdout)).toContain(ws.worktreePath);

	// reclaimWorktree then removes it from git + disk.
	await reclaimWorktree(forgotten as NonNullable<typeof forgotten>);
	const after = Bun.spawnSync(["git", "-C", repo, "worktree", "list"], { stdout: "pipe" });
	expect(new TextDecoder().decode(after.stdout)).not.toContain(ws.worktreePath);

	// A second forget (double-archive) is a no-op returning null.
	expect(forgetWorkspace(ws.id)).toBeNull();
});

test("membership mutations emit lifecycle events through the injected publisher", async () => {
	const events: WorkspaceLifecycleEvent[] = [];
	setWorkspacePublisher((e) => events.push(e));

	const ws = await createWorkspace("p1"); // auto-named workspace-1
	renameWorkspace(ws.id, "my feature"); // → branch my-feature
	expect(forgetWorkspace(ws.id)).not.toBeNull();
	expect(forgetWorkspace(ws.id)).toBeNull(); // unknown now → no further event

	expect(events.map((e) => e.kind)).toEqual(["created", "updated", "removed"]);
	expect(events[0]).toMatchObject({ kind: "created", workspace: { id: ws.id, projectId: "p1" } });
	expect(events[1]).toMatchObject({
		kind: "updated",
		workspace: { id: ws.id, name: "my feature", branch: "my-feature" },
	});
	expect(events[2]).toEqual({ kind: "removed", projectId: "p1", id: ws.id });
});

test("a null publisher makes lifecycle emits silent no-ops", async () => {
	setWorkspacePublisher(null);
	const ws = await createWorkspace("p1");
	await expect(removeWorkspace(ws.id)).resolves.toBeUndefined();
	expect(listWorkspaces("p1")).toHaveLength(0);
});

test("removeWorkspace cleans up even when the worktree dir is already gone", async () => {
	const ws = await createWorkspace("p1");
	expect(listWorkspaces("p1")).toHaveLength(1);

	// Simulate drift: delete the worktree dir behind git's back so `git worktree remove` can't.
	rmSync(ws.worktreePath, { recursive: true, force: true });

	await expect(removeWorkspace(ws.id)).resolves.toBeUndefined();
	expect(listWorkspaces("p1")).toHaveLength(0);

	// git's worktree registration is pruned — no orphan left behind.
	const list = Bun.spawnSync(["git", "-C", repo, "worktree", "list"], { stdout: "pipe" });
	expect(new TextDecoder().decode(list.stdout)).not.toContain(ws.worktreePath);
});

test("onDelete hook runs before the worktree directory is actually removed", async () => {
	const ws = await createWorkspace("p1");
	const command = `test -d "${ws.worktreePath}" && touch "${dataDir}/onDelete-ran"`;
	mkdirSync(join(ws.worktreePath, ".thinkrail"), { recursive: true });
	writeFileSync(
		join(ws.worktreePath, ".thinkrail", "hooks.json"),
		JSON.stringify({ onDelete: command }),
	);
	approveHook("p1", "onDelete", "shared", command);

	await reclaimWorktree(ws);

	expect(existsSync(join(dataDir, "onDelete-ran"))).toBe(true); // saw the worktree while it still existed
	expect(existsSync(ws.worktreePath)).toBe(false); // and the worktree is gone afterward
});

test("onCreate hook runs in the background and doesn't block createWorkspace's return", async () => {
	// Commit a slow onCreate hook to the base branch first, so it's already checked out the moment the new
	// worktree is created.
	const command = `sleep 0.5 && touch "${dataDir}/onCreate-ran"`;
	mkdirSync(join(repo, ".thinkrail"), { recursive: true });
	writeFileSync(join(repo, ".thinkrail", "hooks.json"), JSON.stringify({ onCreate: command }));
	git(repo, "add", "-A");
	git(repo, "commit", "-m", "add onCreate hook");
	approveHook("p1", "onCreate", "shared", command);

	const start = Date.now();
	const ws = await createWorkspace("p1");
	expect(Date.now() - start).toBeLessThan(500); // returned well before the 0.5s hook could have finished
	expect(existsSync(join(dataDir, "onCreate-ran"))).toBe(false); // hook hasn't finished yet

	await new Promise((resolve) => setTimeout(resolve, 700));
	expect(existsSync(join(dataDir, "onCreate-ran"))).toBe(true); // …but it did finish, in the background
	expect(ws.id).toBeTruthy();
});
