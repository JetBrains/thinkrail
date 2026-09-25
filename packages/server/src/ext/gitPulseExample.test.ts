import { afterAll, beforeAll, describe, expect, test } from "bun:test";
import { existsSync, mkdirSync, mkdtempSync, realpathSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import type { WorkspaceRef } from "@thinkrail/ext";
import { createExtHost } from "./index";

const REPO = resolve(import.meta.dir, "../../../..");
const EXT = "git-pulse";

interface Pulse {
	state: string;
	path?: string;
	head?: { kind: string; name?: string; oid?: string };
	upstream?: { name: string; ahead: number; behind: number; gone: boolean };
	counts?: { staged: number; unstaged: number; untracked: number; conflicted: number };
	files?: { path: string; from?: string; kind: string; index: string; worktree: string }[];
	filesTotal?: number;
	stash?: number;
	commits?: { hash: string; short: string; subject: string; author: string; time: number }[];
}

const GIT_ENV = {
	...process.env,
	GIT_CONFIG_NOSYSTEM: "1",
	GIT_AUTHOR_NAME: "Pulse Test",
	GIT_AUTHOR_EMAIL: "pulse@thinkrail.test",
	GIT_COMMITTER_NAME: "Pulse Test",
	GIT_COMMITTER_EMAIL: "pulse@thinkrail.test",
};

const git = (cwd: string, ...args: string[]) => {
	const run = Bun.spawnSync(["git", "-c", "commit.gpgsign=false", ...args], {
		cwd,
		env: GIT_ENV,
	});
	if (run.exitCode !== 0) throw new Error(`git ${args.join(" ")}: ${run.stderr.toString()}`);
	return run.stdout.toString().trim();
};

const commit = (cwd: string, file: string, subject: string) => {
	writeFileSync(join(cwd, file), `${subject}\n`);
	git(cwd, "add", file);
	git(cwd, "commit", "-q", "-m", subject);
};

let base: string;
let repo: string;
let plain: string;
let detached: string;
let peer: string;
let sshMarker: string;

beforeAll(() => {
	base = realpathSync(mkdtempSync(join(tmpdir(), "git-pulse-ext-")));
	repo = join(base, "repo");
	plain = join(base, "plain");
	detached = join(base, "detached");
	peer = join(base, "peer");
	const remote = join(base, "remote.git");
	mkdirSync(repo);
	mkdirSync(plain);
	git(base, "init", "-q", "--bare", "-b", "main", remote);
	git(repo, "init", "-q", "-b", "feat/x");
	commit(repo, "a.txt", "first commit");
	commit(repo, "b.txt", "second commit");
	git(repo, "remote", "add", "origin", remote);
	git(repo, "push", "-q", "-u", "origin", "feat/x");
	commit(repo, "c.txt", "local only");
	git(base, "clone", "-q", "-b", "feat/x", remote, peer);
	commit(peer, "d.txt", "from a teammate");
	git(peer, "push", "-q", "origin", "feat/x");
	writeFileSync(join(repo, "a.txt"), "stashed change\n");
	git(repo, "stash", "-q");
	writeFileSync(join(repo, "b.txt"), "unstaged change\n");
	writeFileSync(join(repo, "staged.txt"), "staged\n");
	git(repo, "add", "staged.txt");
	git(repo, "mv", "c.txt", "renamed c.txt");
	writeFileSync(join(repo, "untracked.txt"), "new\n");
	git(base, "clone", "-q", "-b", "feat/x", remote, detached);
	git(detached, "checkout", "-q", "--detach", "HEAD~1");
	mkdirSync(join(detached, "build"));
	for (const name of ["x.txt", "y.txt", "z.txt"])
		writeFileSync(join(detached, "build", name), "x\n");
	sshMarker = join(base, "ssh-used");
	git(detached, "remote", "add", "far", "ssh://pulse.invalid/repo.git");
	git(detached, "config", "core.sshCommand", `sh -c 'touch "${sshMarker}"; exit 1'`);
});

afterAll(() => rmSync(base, { recursive: true, force: true }));

const workspace = (workspaceId: string, path: string): WorkspaceRef => ({
	workspaceId,
	projectId: "p1",
	name: workspaceId,
	branch: "",
	path,
});

const makeHost = () => {
	const workspaces = [
		workspace("w1", repo),
		workspace("w2", plain),
		workspace("w3", detached),
		workspace("w4", join(base, "missing")),
	];
	return createExtHost({
		userDir: join(base, "user"),
		storeDir: join(base, "store"),
		sessions: { list: () => [], get: () => undefined, stats: () => ({}) as never },
		workspaces: {
			list: () => workspaces,
			get: (id) => workspaces.find((each) => each.workspaceId === id),
		},
	});
};

type Host = ReturnType<typeof makeHost>;

const key = (workspaceId: string) => `${EXT}:pulse:${workspaceId}`;

const pulseOf = (host: Host, workspaceId: string) =>
	host.snapshot([key(workspaceId)])[key(workspaceId)] as Pulse | undefined;

const until = async (check: () => boolean, tries = 500) => {
	for (let i = 0; i < tries && !check(); i++) await Bun.sleep(10);
	expect(check()).toBe(true);
};

const ready = async (host: Host, workspaceId: string, state = "ready") => {
	await until(() => pulseOf(host, workspaceId)?.state === state);
	const pulse = pulseOf(host, workspaceId);
	if (!pulse) throw new Error("no pulse");
	return pulse;
};

let host: Host;

beforeAll(async () => {
	host = makeHost();
	await host.setProjectRoots([{ projectId: "repo", path: REPO }]);
	expect(host.get(EXT)).toMatchObject({ status: "active" });
}, 60_000);

afterAll(() => host.dispose());

describe("git-pulse example extension", () => {
	test("validates: manifest, both views build, dry factory run", async () => {
		const result = await host.validate(EXT);
		expect(result).toMatchObject({ ok: true });
	}, 60_000);

	test("reads nothing until a view watches a workspace", async () => {
		await Bun.sleep(50);
		expect(pulseOf(host, "w1")).toBeUndefined();
	});

	test("publishes branch, upstream, counts, files, stash, and commits for a watched workspace", async () => {
		const headBefore = git(repo, "rev-parse", "HEAD");
		host.setWatched("c1", [key("w1")]);
		const pulse = await ready(host, "w1");
		expect(pulse.head).toMatchObject({ kind: "branch", name: "feat/x" });
		expect(pulse.upstream).toEqual({ name: "origin/feat/x", ahead: 1, behind: 0, gone: false });
		expect(pulse.counts).toEqual({ staged: 2, unstaged: 1, untracked: 1, conflicted: 0 });
		expect(pulse.stash).toBe(1);
		expect(pulse.filesTotal).toBe(4);
		expect(pulse.files).toContainEqual({
			path: "renamed c.txt",
			from: "c.txt",
			kind: "tracked",
			index: "R",
			worktree: ".",
		});
		expect(pulse.files).toContainEqual({
			path: "untracked.txt",
			kind: "untracked",
			index: "?",
			worktree: "?",
		});
		expect(pulse.commits?.map((each) => each.subject)).toEqual([
			"local only",
			"second commit",
			"first commit",
		]);
		expect(pulse.commits?.[0]).toMatchObject({ author: "Pulse Test" });
		expect(pulse.commits?.[0]?.time).toBeGreaterThan(Date.now() - 600_000);
		expect(git(repo, "rev-parse", "HEAD")).toBe(headBefore);
	});

	test("fetch reports its result and the next pulse shows the teammate's commit as behind", async () => {
		const headBefore = git(repo, "rev-parse", "HEAD");
		const result = await host.invokeAction({ ext: EXT, id: "fetch", ctx: { workspaceId: "w1" } });
		expect(result).toMatchObject({ ok: true });
		await until(() => pulseOf(host, "w1")?.upstream?.behind === 1);
		expect(pulseOf(host, "w1")?.upstream).toMatchObject({ ahead: 1, behind: 1 });
		expect(git(repo, "rev-parse", "HEAD")).toBe(headBefore);
		expect(git(repo, "stash", "list")).toContain("stash@{0}");
	});

	test("a .git change refreshes before the next poll", async () => {
		writeFileSync(join(repo, "later.txt"), "later\n");
		git(repo, "add", "later.txt");
		await until(() => pulseOf(host, "w1")?.counts?.staged === 3, 250);
	});

	test("non-git, detached, and missing directories each get a clear state", async () => {
		host.setWatched("c2", [key("w2"), key("w3"), key("w4")]);
		expect(await ready(host, "w2", "not-git")).toEqual({ state: "not-git", path: plain });
		const detachedPulse = await ready(host, "w3");
		expect(detachedPulse.head).toMatchObject({ kind: "detached" });
		expect(detachedPulse.head?.oid).toBe(git(detached, "rev-parse", "HEAD"));
		expect(detachedPulse.upstream).toBeUndefined();
		expect(detachedPulse.filesTotal).toBe(1);
		expect(detachedPulse.files).toEqual([
			{ path: "build/", kind: "untracked", index: "?", worktree: "?" },
		]);
		expect((await ready(host, "w4", "error")).path).toBe(join(base, "missing"));
		const fetched = await host.invokeAction({ ext: EXT, id: "fetch", ctx: { workspaceId: "w2" } });
		expect(fetched).toMatchObject({ ok: false });
	});

	test("fetch keeps the repository's own core.sshCommand", async () => {
		const result = await host.invokeAction({ ext: EXT, id: "fetch", ctx: { workspaceId: "w3" } });
		expect(result).toMatchObject({ ok: false });
		expect(existsSync(sshMarker)).toBe(true);
	});

	test("the last view leaving stops polling and drops the channel", async () => {
		host.setWatched("c1", []);
		host.dropClient("c2");
		expect(pulseOf(host, "w1")).toBeUndefined();
		expect(pulseOf(host, "w2")).toBeUndefined();
		writeFileSync(join(repo, "after.txt"), "after\n");
		git(repo, "add", "after.txt");
		await Bun.sleep(600);
		expect(pulseOf(host, "w1")).toBeUndefined();
	});
});
