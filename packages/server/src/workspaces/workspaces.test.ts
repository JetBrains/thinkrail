import { afterEach, beforeEach, expect, test } from "bun:test";
import {
	existsSync,
	mkdirSync,
	mkdtempSync,
	readFileSync,
	realpathSync,
	rmSync,
	symlinkSync,
	writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
	completeInitialTerminalReservation,
	createWorkspace,
	ensureWorkspaceScratchDir,
	forgetWorkspace,
	listExistingWorktrees,
	listWorkspaceRecords,
	listWorkspaces,
	openExistingWorktree,
	reclaimWorktree,
	refreshUserOwnedWorkspace,
	removeWorkspace,
	renameWorkspace,
	setWorkspaceDiffBase,
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

function worktrees(projectId = "p1") {
	return listWorkspaces(projectId).filter((w) => w.kind !== "default");
}

beforeEach(() => {
	dataDir = realpathSync(mkdtempSync(join(tmpdir(), "trpi-ws-test-")));
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
	setWorkspacePublisher(null);
	rmSync(dataDir, { recursive: true, force: true });
	if (savedDataDir === undefined) delete process.env.THINKRAIL_DATA_DIR;
	else process.env.THINKRAIL_DATA_DIR = savedDataDir;
});

test("createWorkspace cuts a fresh branch from baseRef and records it as the base", async () => {
	git(repo, "branch", "feature/base");
	git(repo, "switch", "feature/base");
	writeFileSync(join(repo, "feature.txt"), "feature\n");
	git(repo, "add", "-A");
	git(repo, "commit", "-m", "feature commit");
	git(repo, "switch", "main");
	const baseSha = gitOut(repo, "rev-parse", "feature/base");

	const ws = await createWorkspace("p1", undefined, "feature/base");
	expect(ws.baseBranch).toBe("feature/base");
	expect(ws.initialTerminalPending).toBe(true);
	expect(gitOut(ws.worktreePath, "rev-parse", "HEAD")).toBe(baseSha);
	expect(gitOut(ws.worktreePath, "rev-parse", "--abbrev-ref", "HEAD")).toBe(ws.branch);
	expect(ws.branch).not.toBe("feature/base");
});

test("the retired eligibility marker never gains initial-terminal provisioning on read", async () => {
	const ws = await createWorkspace("p1");
	const file = join(dataDir, "workspaces.json");
	const records = JSON.parse(readFileSync(file, "utf8")) as Array<Record<string, unknown>>;
	const record = records.find((candidate) => candidate.id === ws.id);
	if (!record) throw new Error("missing workspace record");
	delete record.initialTerminalPending;
	record.initialTerminalEligible = true;
	writeFileSync(file, JSON.stringify(records));

	expect(listWorkspaceRecords("p1").find((candidate) => candidate.id === ws.id)).not.toHaveProperty(
		"initialTerminalPending",
	);
	expect(listWorkspaces("p1").find((candidate) => candidate.id === ws.id)).not.toHaveProperty(
		"initialTerminalPending",
	);
});

test("completing initial-terminal reservation clears the durable marker exactly once", async () => {
	const workspace = await createWorkspace("p1");
	const events: WorkspaceLifecycleEvent[] = [];
	setWorkspacePublisher((event) => events.push(event));

	const completed = completeInitialTerminalReservation(workspace.id);
	const repeated = completeInitialTerminalReservation(workspace.id);

	expect(completed).not.toHaveProperty("initialTerminalPending");
	expect(repeated).not.toHaveProperty("initialTerminalPending");
	expect(events).toEqual([{ kind: "updated", workspace: completed }]);
	expect(
		listWorkspaceRecords("p1").find((candidate) => candidate.id === workspace.id),
	).not.toHaveProperty("initialTerminalPending");
});

test("createWorkspace branches off a locally-present remote ref without a network fetch", async () => {
	const remoteRepo = join(dataDir, "remote.git");
	git(repo, "init", "--bare", remoteRepo);
	git(repo, "remote", "add", "origin", remoteRepo);
	git(repo, "push", "origin", "main");
	git(repo, "fetch", "origin");
	const originSha = gitOut(repo, "rev-parse", "origin/main");

	const ws = await createWorkspace("p1", undefined, "origin/main");
	expect(ws.baseBranch).toBe("origin/main");
	expect(gitOut(ws.worktreePath, "rev-parse", "HEAD")).toBe(originSha);
	expect(gitOut(ws.worktreePath, "rev-parse", "--abbrev-ref", "HEAD")).toBe(ws.branch);
});

test("createWorkspace checks out the remote-tracking ref, not a local branch of the same name", async () => {
	const remoteRepo = join(dataDir, "remote.git");
	git(repo, "init", "--bare", remoteRepo);
	git(repo, "remote", "add", "origin", remoteRepo);
	git(repo, "push", "origin", "main");
	git(repo, "fetch", "origin");
	const originSha = gitOut(repo, "rev-parse", "refs/remotes/origin/main");

	writeFileSync(join(repo, "decoy.md"), "decoy\n");
	git(repo, "add", "-A");
	git(repo, "commit", "-m", "decoy");
	git(repo, "update-ref", "refs/heads/origin/main", "HEAD");
	expect(gitOut(repo, "rev-parse", "refs/heads/origin/main")).not.toBe(originSha);

	const ws = await createWorkspace("p1", undefined, "origin/main");

	expect(ws.baseBranch).toBe("origin/main");
	expect(gitOut(ws.worktreePath, "rev-parse", "HEAD")).toBe(originSha);
});

test("createWorkspace fails with git's own words when the base fetch fails", async () => {
	git(repo, "remote", "add", "origin", join(dataDir, "missing.git"));

	const create = createWorkspace("p1", undefined, "origin/main");

	await expect(create).rejects.toThrow(/Could not fetch origin\/main/);
	await expect(create).rejects.toThrow(/does not appear to be a git repository/);
	expect(existsSync(join(dataDir, "worktrees", "repo"))).toBe(false);
	expect(worktrees()).toHaveLength(0);
});

test("createWorkspace names the refspec when a fetch succeeds without landing the ref", async () => {
	const remoteRepo = join(dataDir, "narrow.git");
	git(repo, "init", "--bare", remoteRepo);
	git(repo, "remote", "add", "origin", remoteRepo);
	git(repo, "push", "origin", "main");
	git(repo, "push", "origin", "main:release");
	git(repo, "config", "remote.origin.fetch", "+refs/heads/main:refs/remotes/origin/main");
	git(repo, "update-ref", "-d", "refs/remotes/origin/release");

	const message = await createWorkspace("p1", undefined, "origin/release").then(
		() => "resolved",
		(error: Error) => error.message,
	);

	expect(message).toContain("check remote.origin.fetch");
	expect(message).not.toContain("FETCH_HEAD");
	expect(worktrees()).toHaveLength(0);
});

test("createWorkspace leaves the new branch with no upstream", async () => {
	const remoteRepo = join(dataDir, "remote.git");
	git(repo, "init", "--bare", remoteRepo);
	git(repo, "remote", "add", "origin", remoteRepo);
	git(repo, "push", "origin", "main");
	git(repo, "fetch", "origin");

	const ws = await createWorkspace("p1", undefined, "origin/main");
	expect(gitOut(repo, "config", "--get", `branch.${ws.branch}.merge`)).toBe("");
	expect(gitOut(repo, "config", "--get", `branch.${ws.branch}.remote`)).toBe("");
	expect(gitOut(ws.worktreePath, "rev-parse", "HEAD")).toBe(
		gitOut(repo, "rev-parse", "origin/main"),
	);
});

test("listExistingWorktrees shows unattached branch and detached checkouts only", async () => {
	const external = join(dataDir, "existing auth checkout");
	git(repo, "worktree", "add", external, "-b", "feature/auth", "main");
	const detached = join(dataDir, "detached checkout");
	git(repo, "worktree", "add", "--detach", detached, "main");
	const managed = await createWorkspace("p1");

	const candidates = listExistingWorktrees("p1");
	expect(candidates).toContainEqual({
		path: external,
		branch: "feature/auth",
		status: "available",
	});
	expect(candidates).toContainEqual({ path: detached, status: "detached" });
	expect(candidates.some((candidate) => candidate.path === repo)).toBe(false);
	expect(candidates.some((candidate) => candidate.path === managed.worktreePath)).toBe(false);
});

test("openExistingWorktree adopts idempotently and removal never reclaims the checkout", () => {
	const external = join(dataDir, "existing auth checkout");
	git(repo, "worktree", "add", external, "-b", "feature/auth", "main");
	writeFileSync(join(external, "staged.txt"), "keep staged\n");
	git(external, "add", "staged.txt");
	writeFileSync(join(external, "README.md"), "# repo\nkeep unstaged\n");
	writeFileSync(join(external, "uncommitted.txt"), "keep untracked\n");
	const before = {
		status: gitOut(external, "status", "--porcelain=v1", "-z"),
		branch: gitOut(external, "symbolic-ref", "--short", "HEAD"),
		head: gitOut(external, "rev-parse", "HEAD"),
		registry: gitOut(repo, "worktree", "list", "--porcelain", "-z"),
	};
	const expectCheckoutUnchanged = () => {
		expect(gitOut(external, "status", "--porcelain=v1", "-z")).toBe(before.status);
		expect(gitOut(external, "symbolic-ref", "--short", "HEAD")).toBe(before.branch);
		expect(gitOut(external, "rev-parse", "HEAD")).toBe(before.head);
		expect(gitOut(repo, "worktree", "list", "--porcelain", "-z")).toBe(before.registry);
	};
	const events: WorkspaceLifecycleEvent[] = [];
	setWorkspacePublisher((event) => events.push(event));

	const workspace = openExistingWorktree("p1", external);
	expect(workspace).toMatchObject({
		projectId: "p1",
		kind: "external",
		name: "existing auth checkout",
		branch: "feature/auth",
		worktreePath: external,
		baseBranch: "main",
		renamed: true,
		initialTerminalPending: true,
	});
	expect(events).toEqual([{ kind: "created", workspace }]);
	expect(listExistingWorktrees("p1")).toHaveLength(0);
	expectCheckoutUnchanged();

	expect(openExistingWorktree("p1", external).id).toBe(workspace.id);
	expect(events).toHaveLength(1);
	expect(() => renameWorkspace(workspace.id, "hands off")).toThrow(
		"An existing worktree cannot be renamed by ThinkRail",
	);

	removeWorkspace(workspace.id);
	expect(listWorkspaceRecords("p1").some((candidate) => candidate.id === workspace.id)).toBe(false);
	expect(readFileSync(join(external, "uncommitted.txt"), "utf8")).toBe("keep untracked\n");
	expectCheckoutUnchanged();
	expect(gitOut(repo, "show-ref", "--verify", "refs/heads/feature/auth")).not.toBe("");
});

test("openExistingWorktree rejects detached and unrelated paths", () => {
	const detached = join(dataDir, "detached checkout");
	git(repo, "worktree", "add", "--detach", detached, "main");
	expect(() => openExistingWorktree("p1", detached)).toThrow(
		"Detached HEAD worktrees cannot be opened; create a branch first",
	);

	const unrelated = join(dataDir, "unrelated");
	mkdirSync(unrelated);
	expect(() => openExistingWorktree("p1", unrelated)).toThrow(
		"The selected path is not a registered worktree of this project",
	);
});

test("existing worktrees represented by another project are rejected before its Default exists", () => {
	const external = join(dataDir, "existing auth checkout");
	git(repo, "worktree", "add", external, "-b", "feature/auth", "main");
	writeFileSync(
		join(dataDir, "projects.json"),
		JSON.stringify([
			{ id: "p1", name: "repo", path: repo, slug: "repo", lastOpened: 1 },
			{ id: "p2", name: "external", path: external, slug: "external", lastOpened: 2 },
		]),
	);
	expect(listWorkspaceRecords("p2")).toHaveLength(0);
	expect(listExistingWorktrees("p1").some((candidate) => candidate.path === external)).toBe(false);
	expect(() => openExistingWorktree("p1", external)).toThrow(
		"This worktree is already open under another ThinkRail project",
	);
});

test("external workspace branch metadata converges on refresh and list", () => {
	const external = join(dataDir, "existing auth checkout");
	git(repo, "worktree", "add", external, "-b", "feature/auth", "main");
	const workspace = openExistingWorktree("p1", external);
	listWorkspaces("p1");
	const events: WorkspaceLifecycleEvent[] = [];
	setWorkspacePublisher((event) => events.push(event));

	git(external, "switch", "-c", "feature/live");
	refreshUserOwnedWorkspace(workspace.id);
	expect(events).toEqual([
		{
			kind: "updated",
			workspace: { ...workspace, branch: "feature/live" },
		},
	]);

	events.length = 0;
	git(external, "switch", "-c", "feature/list-refresh");
	const listed = listWorkspaces("p1").find((candidate) => candidate.id === workspace.id);
	expect(listed?.branch).toBe("feature/list-refresh");
	expect(listed?.name).toBe("existing auth checkout");
	expect(listed?.baseBranch).toBe("main");
	expect(events).toHaveLength(1);

	events.length = 0;
	rmSync(external, { recursive: true, force: true });
	refreshUserOwnedWorkspace(workspace.id);
	expect(events).toHaveLength(0);
	expect(
		listWorkspaceRecords("p1").find((candidate) => candidate.id === workspace.id)?.branch,
	).toBe("feature/list-refresh");
});

test("createWorkspace seeds a self-ignoring .thinkrail/context scratch dir kept out of git", async () => {
	const ws = await createWorkspace("p1");
	const gitignore = join(ws.worktreePath, ".thinkrail", "context", ".gitignore");
	expect(existsSync(gitignore)).toBe(true);
	expect(readFileSync(gitignore, "utf8")).toBe("*\n");

	writeFileSync(join(ws.worktreePath, ".thinkrail", "context", "TASK-x.md"), "scratch\n");
	expect(gitOut(ws.worktreePath, "check-ignore", ".thinkrail/context/TASK-x.md")).toBe(
		".thinkrail/context/TASK-x.md",
	);
	expect(gitOut(ws.worktreePath, "status", "--porcelain")).not.toContain(".thinkrail");
});

test("ensureWorkspaceScratchDir never clobbers an existing .gitignore (the Default workspace is the user's repo)", async () => {
	const contextDir = join(repo, ".thinkrail", "context");
	mkdirSync(contextDir, { recursive: true });
	const gitignore = join(contextDir, ".gitignore");
	writeFileSync(gitignore, "# mine\n!keep.md\n");

	const def = (await listWorkspaces("p1")).find((w) => w.kind === "default");
	expect(def?.worktreePath).toBe(repo);
	if (def) ensureWorkspaceScratchDir(def);

	expect(readFileSync(gitignore, "utf8")).toBe("# mine\n!keep.md\n");

	rmSync(gitignore);
	if (def) ensureWorkspaceScratchDir(def);
	expect(readFileSync(gitignore, "utf8")).toBe("*\n");
});

test("createWorkspace marks a user-named workspace renamed; an auto-named one stays eligible", async () => {
	const auto = await createWorkspace("p1");
	expect(auto.name).toBe("workspace-1");
	expect(auto.renamed).toBeUndefined();

	const named = await createWorkspace("p1", "My Feature");
	expect(named.name).toBe("My Feature");
	expect(named.branch).toBe("my-feature");
	expect(named.renamed).toBe(true);
});

test("renameWorkspace moves the branch in place: record + git follow, the worktree dir does not", async () => {
	const ws = await createWorkspace("p1");
	const renamed = renameWorkspace(ws.id, "add login flow");

	expect(renamed.name).toBe("add login flow");
	expect(renamed.branch).toBe("add-login-flow");
	expect(renamed.renamed).toBe(true);
	expect(renamed.worktreePath).toBe(ws.worktreePath);
	expect(gitOut(ws.worktreePath, "rev-parse", "--abbrev-ref", "HEAD")).toBe("add-login-flow");
	expect(gitOut(repo, "for-each-ref", "--format=%(refname:short)", "refs/heads")).not.toContain(
		"workspace-1",
	);
	expect(worktrees()[0]?.name).toBe("add login flow");
	expect(worktrees()[0]?.branch).toBe("add-login-flow");
});

test("renameWorkspace with lock:false renames name + branch but leaves renamed unset (provisional)", async () => {
	const ws = await createWorkspace("p1");
	const renamed = renameWorkspace(ws.id, "add login flow", { lock: false });

	expect(renamed.name).toBe("add login flow");
	expect(renamed.branch).toBe("add-login-flow");
	expect(renamed.renamed).toBeUndefined();
	expect(gitOut(ws.worktreePath, "rev-parse", "--abbrev-ref", "HEAD")).toBe("add-login-flow");
	expect(worktrees()[0]?.renamed).toBeUndefined();

	const locked = renameWorkspace(ws.id, "final name");
	expect(locked.name).toBe("final name");
	expect(locked.branch).toBe("final-name");
	expect(locked.renamed).toBe(true);
});

test("renameWorkspace suffixes on collision with an existing branch", async () => {
	git(repo, "branch", "add-login-flow");
	const ws = await createWorkspace("p1");
	const renamed = renameWorkspace(ws.id, "add login flow");
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

test("setWorkspaceDiffBase re-points the diff target, leaving creation provenance alone", async () => {
	const events: WorkspaceLifecycleEvent[] = [];
	setWorkspacePublisher((e) => events.push(e));
	const ws = await createWorkspace("p1");
	git(repo, "branch", "release");

	const pointed = setWorkspaceDiffBase(ws.id, "release");
	expect(pointed.diffBase).toBe("release");
	expect(pointed.baseBranch).toBe(ws.baseBranch);
	expect(listWorkspaceRecords("p1")[0]?.diffBase).toBe("release");
	expect(events.at(-1)).toMatchObject({ kind: "updated", workspace: { diffBase: "release" } });

	expect(setWorkspaceDiffBase(ws.id, null).diffBase).toBeUndefined();
	expect(setWorkspaceDiffBase(ws.id, ws.baseBranch).diffBase).toBeUndefined();
	expect(() => setWorkspaceDiffBase(ws.id, "   ")).toThrow(/must be a ref/);
	expect(() => setWorkspaceDiffBase("nope", "release")).toThrow("Unknown workspace: nope");
});

test("renameWorkspace re-points a sibling whose diff TARGET was the renamed branch", async () => {
	const first = await createWorkspace("p1");
	const dependent = await createWorkspace("p1");
	setWorkspaceDiffBase(dependent.id, first.branch);

	renameWorkspace(first.id, "core work");
	expect(listWorkspaceRecords("p1").find((w) => w.id === dependent.id)?.diffBase).toBe("core-work");
});

test("renameWorkspace broadcasts every record it re-pointed, not only the target", async () => {
	const first = await createWorkspace("p1");
	const basedOn = await createWorkspace("p1", "on top", first.branch);
	const targeting = await createWorkspace("p1");
	setWorkspaceDiffBase(targeting.id, first.branch);
	const untouched = await createWorkspace("p1");

	const events: WorkspaceLifecycleEvent[] = [];
	setWorkspacePublisher((e) => events.push(e));
	renameWorkspace(first.id, "core work");

	const updated = events.filter((e) => e.kind === "updated").map((e) => e.workspace);
	expect(updated.map((w) => w.id).sort()).toEqual([first.id, basedOn.id, targeting.id].sort());
	expect(updated.find((w) => w.id === basedOn.id)?.baseBranch).toBe("core-work");
	expect(updated.find((w) => w.id === targeting.id)?.diffBase).toBe("core-work");
	expect(updated.some((w) => w.id === untouched.id)).toBe(false);
});

test("an option-shaped ref is refused at both mutation doors", async () => {
	const ws = await createWorkspace("p1");
	expect(() => setWorkspaceDiffBase(ws.id, "--output=/tmp/thinkrail-pwn")).toThrow(
		/usable git ref/,
	);
	await expect(createWorkspace("p1", "pwn", "--output=/tmp/thinkrail-pwn")).rejects.toThrow(
		/usable git ref/,
	);
	expect(setWorkspaceDiffBase(ws.id, "gone-branch").diffBase).toBe("gone-branch");
});

test("createWorkspace validates the RESOLVED base — including the one it reads off the repo's HEAD", async () => {
	const probe = join(dataDir, "head-pwn-probe.txt");
	git(repo, "update-ref", `refs/heads/--output=${probe}`, "HEAD");
	git(repo, "symbolic-ref", "HEAD", `refs/heads/--output=${probe}`);

	await expect(createWorkspace("p1")).rejects.toThrow(/usable git ref/);
	expect(existsSync(probe)).toBe(false);
});

test("createWorkspace rejects a closed project — a stale or rogue client can't create behind the rail's back", async () => {
	writeFileSync(
		join(dataDir, "projects.json"),
		JSON.stringify([
			{ id: "p1", name: "repo", path: repo, slug: "repo", lastOpened: 1, closed: true },
		]),
	);
	await expect(createWorkspace("p1")).rejects.toThrow(/Unknown project/);
});

test("renameWorkspace throws on an unknown workspace", () => {
	expect(() => renameWorkspace("nope", "anything")).toThrow("Unknown workspace: nope");
});

test("renameWorkspace also suffixes when the candidate's worktree dir is occupied (branch free)", async () => {
	const first = await createWorkspace("p1");
	renameWorkspace(first.id, "real name");

	const second = await createWorkspace("p1");
	const renamed = renameWorkspace(second.id, "workspace 1");
	expect(renamed.branch).toBe("workspace-1-2");
	expect(renamed.name).toBe("workspace 1");
});

test("creating after a rename skips the freed name whose worktree dir is still occupied", async () => {
	const ws = await createWorkspace("p1");
	expect(ws.branch).toBe("workspace-1");
	renameWorkspace(ws.id, "real name");

	const next = await createWorkspace("p1");
	expect(next.branch).toBe("workspace-2");
	expect(next.worktreePath).not.toBe(ws.worktreePath);
	expect(existsSync(next.worktreePath)).toBe(true);
});

test("forgetWorkspace drops the record + returns it, but leaves the worktree for a separate reclaim", async () => {
	const ws = await createWorkspace("p1");
	expect(worktrees()).toHaveLength(1);

	const forgotten = forgetWorkspace(ws.id);
	expect(forgotten?.id).toBe(ws.id);
	expect(worktrees()).toHaveLength(0);
	const before = Bun.spawnSync(["git", "-C", repo, "worktree", "list"], { stdout: "pipe" });
	expect(new TextDecoder().decode(before.stdout)).toContain(ws.worktreePath);

	reclaimWorktree(forgotten as NonNullable<typeof forgotten>);
	const after = Bun.spawnSync(["git", "-C", repo, "worktree", "list"], { stdout: "pipe" });
	expect(new TextDecoder().decode(after.stdout)).not.toContain(ws.worktreePath);

	expect(forgetWorkspace(ws.id)).toBeNull();
});

test("membership mutations emit lifecycle events through the injected publisher", async () => {
	const events: WorkspaceLifecycleEvent[] = [];
	setWorkspacePublisher((e) => events.push(e));

	const ws = await createWorkspace("p1");
	renameWorkspace(ws.id, "my feature");
	expect(forgetWorkspace(ws.id)).not.toBeNull();
	expect(forgetWorkspace(ws.id)).toBeNull();

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
	expect(() => removeWorkspace(ws.id)).not.toThrow();
	expect(worktrees()).toHaveLength(0);
});

test("removeWorkspace cleans up even when the worktree dir is already gone", async () => {
	const ws = await createWorkspace("p1");
	expect(worktrees()).toHaveLength(1);

	rmSync(ws.worktreePath, { recursive: true, force: true });

	expect(() => removeWorkspace(ws.id)).not.toThrow();
	expect(worktrees()).toHaveLength(0);

	const list = Bun.spawnSync(["git", "-C", repo, "worktree", "list"], { stdout: "pipe" });
	expect(new TextDecoder().decode(list.stdout)).not.toContain(ws.worktreePath);
});

test("listWorkspaces ensures exactly one Default workspace, pinned first, with folder-truth fields", async () => {
	const first = listWorkspaces("p1");
	const def = first[0];
	expect(def?.kind).toBe("default");
	expect(def?.name).toBe("Default");
	expect(def?.worktreePath).toBe(repo);
	expect(def?.branch).toBe("main");
	expect(def?.baseBranch).toBe("main");
	expect(def?.renamed).toBe(true);
	expect(def?.initialTerminalPending).toBe(true);

	const again = listWorkspaces("p1");
	expect(again.filter((w) => w.kind === "default")).toHaveLength(1);
	expect(again[0]?.id).toBe(def?.id);

	await createWorkspace("p1");
	const rows = listWorkspaces("p1");
	expect(rows[0]?.kind).toBe("default");
	expect(rows).toHaveLength(2);
});

test("the Default workspace's branch and base refresh from the folder on each list", async () => {
	const remoteRepo = join(dataDir, "remote.git");
	git(repo, "init", "--bare", remoteRepo);
	git(repo, "remote", "add", "origin", remoteRepo);
	git(repo, "push", "origin", "main");
	git(repo, "fetch", "origin");

	expect(listWorkspaces("p1")[0]?.baseBranch).toBe("origin/main");

	const events: WorkspaceLifecycleEvent[] = [];
	setWorkspacePublisher((e) => events.push(e));
	git(repo, "switch", "-c", "feature/x");
	const def = listWorkspaces("p1")[0];
	expect(def?.branch).toBe("feature/x");
	expect(def?.baseBranch).toBe("origin/main");
	expect(events).toHaveLength(1);
	expect(events[0]).toMatchObject({
		kind: "updated",
		workspace: { branch: "feature/x", kind: "default" },
	});

	listWorkspaces("p1");
	expect(events).toHaveLength(1);

	writeFileSync(join(repo, "new.txt"), "one\ntwo\n");
	git(repo, "add", "-A");
	git(repo, "commit", "-m", "feature work");
	expect(listWorkspaces("p1")[0]?.diffStats?.added).toBe(2);

	git(repo, "switch", "main");
	writeFileSync(join(repo, "upstream.txt"), "a\nb\nc\n");
	git(repo, "add", "-A");
	git(repo, "commit", "-m", "upstream work");
	git(repo, "switch", "feature/x");
	expect(listWorkspaces("p1")[0]?.diffStats).toEqual({ added: 2, removed: 0 });
});

test("refreshUserOwnedWorkspace re-syncs and publishes Default drift off the list path", async () => {
	listWorkspaces("p1");
	const def = listWorkspaceRecords("p1").find((w) => w.kind === "default");
	if (!def) throw new Error("expected the ensured Default workspace");
	const worktree = await createWorkspace("p1", "Iso");

	const events: WorkspaceLifecycleEvent[] = [];
	setWorkspacePublisher((e) => events.push(e));

	refreshUserOwnedWorkspace(def.id);
	expect(events).toHaveLength(0);

	git(repo, "switch", "-c", "feature/live");
	refreshUserOwnedWorkspace(def.id);
	expect(events).toEqual([
		{ kind: "updated", workspace: { ...def, branch: "feature/live", baseBranch: "feature/live" } },
	]);
	expect(listWorkspaceRecords("p1").find((w) => w.id === def.id)?.branch).toBe("feature/live");

	refreshUserOwnedWorkspace(worktree.id);
	refreshUserOwnedWorkspace("nope");
	expect(events).toHaveLength(1);
});

test("the Default workspace is non-removable and non-renamable — loud server-side guards", () => {
	const def = listWorkspaces("p1")[0];
	if (!def) throw new Error("expected the ensured Default workspace");

	expect(() => forgetWorkspace(def.id)).toThrow("The Default workspace cannot be removed");
	expect(() => removeWorkspace(def.id)).toThrow("The Default workspace cannot be removed");
	expect(() => renameWorkspace(def.id, "anything")).toThrow(
		"The Default workspace cannot be renamed",
	);
	reclaimWorktree(def);
	expect(existsSync(join(repo, "README.md"))).toBe(true);
	expect(listWorkspaces("p1")[0]?.id).toBe(def.id);
});

test("duplicate Default records (out-of-band corruption) collapse to the oldest", () => {
	const def = listWorkspaces("p1")[0];
	if (!def) throw new Error("expected the ensured Default workspace");

	const raw = JSON.parse(readFileSync(join(dataDir, "workspaces.json"), "utf8"));
	raw.push({ ...def, id: "dupe" });
	writeFileSync(join(dataDir, "workspaces.json"), JSON.stringify(raw));

	const events: WorkspaceLifecycleEvent[] = [];
	setWorkspacePublisher((e) => events.push(e));
	const rows = listWorkspaces("p1");
	expect(rows.filter((w) => w.kind === "default")).toHaveLength(1);
	expect(rows[0]?.id).toBe(def.id);
	expect(events).toEqual([{ kind: "removed", projectId: "p1", id: "dupe" }]);
});

test("a concurrent list's Default-ensure survives createWorkspace's awaited fallback fetch", async () => {
	const remoteRepo = join(dataDir, "remote.git");
	git(repo, "init", "--bare", remoteRepo);
	git(repo, "remote", "add", "origin", remoteRepo);
	git(repo, "push", "origin", "main");
	git(repo, "push", "origin", "main:feature-x");
	git(repo, "update-ref", "-d", "refs/remotes/origin/feature-x");

	const pending = createWorkspace("p1", undefined, "origin/feature-x");
	const def = listWorkspaces("p1")[0];
	expect(def?.kind).toBe("default");

	const ws = await pending;
	expect(ws.baseBranch).toBe("origin/feature-x");
	const rows = listWorkspaces("p1");
	expect(rows.filter((w) => w.kind === "default")).toHaveLength(1);
	expect(rows[0]?.id).toBe(def?.id);
	expect(rows).toHaveLength(2);
});

test("ensureWorkspaceScratchDir refuses a missing workspace root instead of resurrecting it", async () => {
	const ws = await createWorkspace("p1");
	rmSync(ws.worktreePath, { recursive: true, force: true });
	expect(() => ensureWorkspaceScratchDir(ws)).toThrow("Workspace directory is missing");
	expect(existsSync(ws.worktreePath)).toBe(false);
});

test("ensureWorkspaceScratchDir never follows symlinks — the checkout controls these paths", () => {
	const def = listWorkspaces("p1")[0];
	if (!def) throw new Error("expected the ensured Default workspace");
	const outside = join(dataDir, "outside");
	mkdirSync(outside);

	symlinkSync(outside, join(repo, ".thinkrail"));
	expect(() => ensureWorkspaceScratchDir(def)).toThrow("not a real directory");
	expect(existsSync(join(outside, "context"))).toBe(false);
	rmSync(join(repo, ".thinkrail"));

	mkdirSync(join(repo, ".thinkrail", "context"), { recursive: true });
	const planted = join(outside, "planted");
	symlinkSync(planted, join(repo, ".thinkrail", "context", ".gitignore"));
	expect(() => ensureWorkspaceScratchDir(def)).not.toThrow();
	expect(existsSync(planted)).toBe(false);
});

test("reclaimWorktree refuses a record pointing at the project folder even without the kind flag", () => {
	const def = listWorkspaces("p1")[0];
	if (!def) throw new Error("expected the ensured Default workspace");
	const { kind: _dropped, ...corrupt } = def;
	reclaimWorktree(corrupt);
	expect(existsSync(join(repo, "README.md"))).toBe(true);
});

test("an unborn repo's Default never persists the literal HEAD as its base", () => {
	const bare = join(dataDir, "unborn");
	mkdirSync(bare);
	git(bare, "init", "-b", "main");
	const projects = JSON.parse(readFileSync(join(dataDir, "projects.json"), "utf8"));
	projects.push({ id: "p2", name: "unborn", path: bare, slug: "unborn", lastOpened: 1 });
	writeFileSync(join(dataDir, "projects.json"), JSON.stringify(projects));

	const def = listWorkspaces("p2")[0];
	expect(def?.branch).toBe("main");
	expect(def?.baseBranch).toBe("main");
});

test("ensuring the Default emits created once; listing never writes into the project folder", () => {
	const events: WorkspaceLifecycleEvent[] = [];
	setWorkspacePublisher((e) => events.push(e));

	listWorkspaces("p1");
	listWorkspaces("p1");
	expect(events.map((e) => e.kind)).toEqual(["created"]);

	expect(existsSync(join(repo, ".thinkrail"))).toBe(false);
	const def = listWorkspaces("p1")[0];
	if (!def) throw new Error("expected the ensured Default workspace");
	ensureWorkspaceScratchDir(def);
	expect(readFileSync(join(repo, ".thinkrail", "context", ".gitignore"), "utf8")).toBe("*\n");
	expect(gitOut(repo, "status", "--porcelain")).not.toContain(".thinkrail");
});

test("includeDiffStats: false keeps membership/order/Default ensure while skipping the diff-stat fan-out", async () => {
	const events: WorkspaceLifecycleEvent[] = [];
	setWorkspacePublisher((e) => events.push(e));

	const ws = await createWorkspace("p1", "Iso");
	writeFileSync(join(ws.worktreePath, "work.txt"), "one\ntwo\n");
	git(ws.worktreePath, "add", "-A");
	git(ws.worktreePath, "commit", "-m", "branch work");

	const light = listWorkspaces("p1", { includeDiffStats: false });
	expect(light.map((w) => w.kind ?? "worktree")).toEqual(["default", "worktree"]);
	expect(events.map((e) => e.kind)).toContain("created");
	expect(light.every((w) => w.diffStats === undefined)).toBe(true);

	for (const full of [listWorkspaces("p1"), listWorkspaces("p1", { includeDiffStats: true })]) {
		expect(full.map((w) => w.id)).toEqual(light.map((w) => w.id));
		expect(full.find((w) => w.id === ws.id)?.diffStats).toEqual({ added: 2, removed: 0 });
	}
});
