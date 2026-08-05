import { afterEach, beforeEach, expect, test } from "bun:test";
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { WorkspaceFsChangedPayload, WorkspaceSkillChange } from "@thinkrail/contracts";
import { createCoalescer } from "./coalesce";
import {
	ensureWatch,
	isIgnoredPath,
	setRepoMetaPublisher,
	setSkillPathClassifier,
	setWatchPublisher,
	stopAllWatches,
	stopWatch,
} from "./watch";

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

/** Run a real git command (fixture setup only — this module itself never shells out to `git`; see SPEC.md). */
function git(cwd: string, ...args: string[]): void {
	Bun.spawnSync(["git", "-C", cwd, ...args], { stdout: "ignore", stderr: "ignore" });
}

/** A real repo with one commit, so branches can be created off a real HEAD. */
function initRepo(dir: string): void {
	// `git -C <dir>` chdirs into `dir` before doing anything else, so `dir` must already exist —
	// `git init` normally creates it FOR you only when given as a trailing path argument, not via `-C`.
	mkdirSync(dir, { recursive: true });
	git(dir, "init", "-q", "-b", "main");
	git(
		dir,
		"-c",
		"user.email=e2e@example.com",
		"-c",
		"user.name=e2e",
		"commit",
		"--allow-empty",
		"-q",
		"-m",
		"init",
	);
}

async function waitFor(check: () => boolean, timeoutMs = 3000): Promise<void> {
	const deadline = Date.now() + timeoutMs;
	while (!check()) {
		if (Date.now() > deadline) throw new Error("waitFor timed out");
		await sleep(25);
	}
}

type CoalescedBatch = {
	paths: string[];
	truncated: boolean;
	skillChange: WorkspaceSkillChange;
};

// ---- coalesce.ts ----

test("coalescer dedupes and flushes one batch after the quiet gap", async () => {
	const flushes: CoalescedBatch[] = [];
	const c = createCoalescer({
		quietMs: 30,
		maxWaitMs: 500,
		maxPaths: 10,
		onFlush: (b) => flushes.push(b),
	});
	c.add("a.ts", "none");
	c.add("b.ts", "none");
	c.add("a.ts", "none");
	await waitFor(() => flushes.length > 0);
	expect(flushes).toHaveLength(1);
	expect(flushes[0]).toEqual({
		paths: ["a.ts", "b.ts"],
		truncated: false,
		skillChange: "none",
	});
	c.dispose();
});

test("coalescer max-wait flushes under continuous churn (quiet never reached)", async () => {
	const flushes: CoalescedBatch[] = [];
	const c = createCoalescer({
		quietMs: 60,
		maxWaitMs: 120,
		maxPaths: 1000,
		onFlush: (b) => flushes.push(b),
	});
	// Feed an event every 20ms for ~300ms: the 60ms quiet timer keeps resetting, so only the
	// 120ms max-wait timer can flush mid-stream.
	for (let i = 0; i < 15; i++) {
		c.add(`f${i}.ts`, "none");
		await sleep(20);
	}
	expect(flushes.length).toBeGreaterThanOrEqual(1);
	c.dispose();
});

test("coalescer separates generic truncation from skill evidence and keeps evidence beyond the cap", async () => {
	const flushes: CoalescedBatch[] = [];
	const c = createCoalescer({
		quietMs: 20,
		maxWaitMs: 500,
		maxPaths: 2,
		onFlush: (b) => flushes.push(b),
	});
	c.add("a.ts", "none");
	c.add("b.ts", "none");
	c.add("c.ts", "none"); // over the cap, but concretely non-skill
	await waitFor(() => flushes.length > 0);
	expect(flushes[0]).toEqual({
		paths: ["a.ts", "b.ts"],
		truncated: true,
		skillChange: "none",
	});

	c.add("d.ts", "none");
	c.add("e.ts", "none");
	c.add(".claude/skills/demo/SKILL.md", "detected"); // over-cap; evidence must survive
	await waitFor(() => flushes.length > 1);
	expect(flushes[1]).toEqual({
		paths: ["d.ts", "e.ts"],
		truncated: true,
		skillChange: "detected",
	});

	c.add(null, "unknown"); // unknown path → wildcard + conservative skill impact
	await waitFor(() => flushes.length > 2);
	expect(flushes[2]).toEqual({ paths: [], truncated: true, skillChange: "unknown" });
	c.dispose();
});

test("coalescer does not call a duplicate retained path truncated at the cap", async () => {
	const flushes: CoalescedBatch[] = [];
	const c = createCoalescer({
		quietMs: 20,
		maxWaitMs: 500,
		maxPaths: 2,
		onFlush: (batch) => flushes.push(batch),
	});
	c.add("a.ts", "none");
	c.add("b.ts", "none");
	c.add("a.ts", "none");
	await waitFor(() => flushes.length > 0);
	expect(flushes[0]).toEqual({
		paths: ["a.ts", "b.ts"],
		truncated: false,
		skillChange: "none",
	});
	c.dispose();
});

test("coalescer dispose drops pending state without flushing", async () => {
	const flushes: unknown[] = [];
	const c = createCoalescer({
		quietMs: 20,
		maxWaitMs: 100,
		maxPaths: 10,
		onFlush: (b) => flushes.push(b),
	});
	c.add("a.ts", "none");
	c.dispose();
	await sleep(150);
	expect(flushes).toHaveLength(0);
});

// ---- ignore filter ----

test("isIgnoredPath skips .git and node_modules subtrees and .DS_Store noise", () => {
	expect(isIgnoredPath(".git/index.lock")).toBe(true);
	expect(isIgnoredPath("packages/web/node_modules/react/index.js")).toBe(true);
	expect(isIgnoredPath(".DS_Store")).toBe(true);
	expect(isIgnoredPath("docs/.DS_Store")).toBe(true);
	expect(isIgnoredPath("src/index.ts")).toBe(false);
	expect(isIgnoredPath("SPEC.md")).toBe(false);
	// `.git` stays fully blacked out for *paths* — its churn reaches the host only as the pathless
	// repo-metadata nudge (see the `setRepoMetaPublisher` test below).
	expect(isIgnoredPath(".git/HEAD")).toBe(true);
	expect(isIgnoredPath(".git/logs/HEAD")).toBe(true);
	// Similar names that are NOT the ignored segments stay live.
	expect(isIgnoredPath("src/gitignore-parser.ts")).toBe(false);
	expect(isIgnoredPath("my_node_modules_tool/a.ts")).toBe(false);
});

// ---- watch.ts (real fs.watch on a temp worktree) ----

let dataDir: string;
let worktree: string;
let payloads: WorkspaceFsChangedPayload[];
const savedDataDir = process.env.THINKRAIL_DATA_DIR;

beforeEach(() => {
	dataDir = mkdtempSync(join(tmpdir(), "trpi-watch-test-"));
	process.env.THINKRAIL_DATA_DIR = dataDir;
	worktree = join(dataDir, "worktree");
	mkdirSync(worktree);
	writeFileSync(
		join(dataDir, "workspaces.json"),
		JSON.stringify([
			{
				id: "ws1",
				projectId: "p1",
				name: "ws",
				branch: "b",
				worktreePath: worktree,
				baseBranch: "main",
			},
		]),
	);
	payloads = [];
	setWatchPublisher((p) => payloads.push(p));
	setSkillPathClassifier((path) => path.startsWith(".claude/skills/"));
});

afterEach(() => {
	stopAllWatches();
	setWatchPublisher(null);
	setRepoMetaPublisher(null);
	setSkillPathClassifier(null);
	rmSync(dataDir, { recursive: true, force: true });
	if (savedDataDir === undefined) delete process.env.THINKRAIL_DATA_DIR;
	else process.env.THINKRAIL_DATA_DIR = savedDataDir;
});

test("a watched worktree publishes a debounced fsChanged batch for a new file", async () => {
	ensureWatch("ws1");
	ensureWatch("ws1"); // idempotent
	await sleep(100); // let the platform watcher register before the write
	writeFileSync(join(worktree, "hello.ts"), "export {};\n");
	await waitFor(() => payloads.length > 0);
	expect(payloads[0]?.workspaceId).toBe("ws1");
	expect(payloads[0]?.truncated).toBe(false);
	expect(payloads[0]?.paths).toContain("hello.ts");
	expect(payloads[0]?.skillChange).toBe("none");
});

test("a watched project-skill path carries detected evidence", async () => {
	mkdirSync(join(worktree, ".claude", "skills", "demo"), { recursive: true });
	ensureWatch("ws1");
	await sleep(100);
	writeFileSync(join(worktree, ".claude", "skills", "demo", "SKILL.md"), "# Demo\n");
	await waitFor(() => payloads.some((payload) => payload.skillChange === "detected"));
	expect(
		payloads.some((payload) => payload.paths.some((path) => path.includes(".claude/skills"))),
	).toBe(true);
});

test("a missing classifier degrades a concrete event to unknown", async () => {
	setSkillPathClassifier(null);
	ensureWatch("ws1");
	await sleep(100);
	writeFileSync(join(worktree, "unclassified.ts"), "export {};\n");
	await waitFor(() => payloads.some((payload) => payload.paths.includes("unclassified.ts")));
	expect(payloads.find((payload) => payload.paths.includes("unclassified.ts"))?.skillChange).toBe(
		"unknown",
	);
});

test("a .git write nudges the repo-meta sink without ever becoming an fsChanged path", async () => {
	const nudges: string[] = [];
	setRepoMetaPublisher((id) => nudges.push(id));
	ensureWatch("ws1");
	await sleep(100);

	// Stand in for git's plumbing churn (a `git switch` between content-identical branches writes only
	// here): the worktree's content never changes, so this is the ONLY signal the branch may have moved.
	mkdirSync(join(worktree, ".git"), { recursive: true });
	writeFileSync(join(worktree, ".git", "HEAD"), "ref: refs/heads/live\n");
	writeFileSync(join(worktree, ".git", "index"), "x\n");

	await waitFor(() => nudges.length > 0);
	expect(nudges).toEqual(["ws1"]); // debounced: one nudge for the burst
	// …and nothing under `.git` ever leaks into a client-facing batch.
	await sleep(600);
	expect(payloads.filter((p) => p.paths.some((x) => x.includes(".git")))).toHaveLength(0);

	// A stopped watcher's pending nudge is dropped, and later churn stays silent.
	stopWatch("ws1");
	writeFileSync(join(worktree, ".git", "HEAD"), "ref: refs/heads/other\n");
	await sleep(600);
	expect(nudges).toEqual(["ws1"]);
});

test("a linked worktree's git metadata lives outside the root — its churn still nudges the sink", async () => {
	// The shape every workspace this app creates has: `.git` is a *file* pointing at the parent repo's
	// `.git/worktrees/<name>`, so a `git commit` in this worktree writes NOTHING under the watched root.
	const metaDir = join(dataDir, "repo", ".git", "worktrees", "ws");
	mkdirSync(metaDir, { recursive: true });
	writeFileSync(join(metaDir, "HEAD"), "ref: refs/heads/b\n");
	writeFileSync(join(worktree, ".git"), `gitdir: ${metaDir}\n`);

	const nudges: string[] = [];
	setRepoMetaPublisher((id) => nudges.push(id));
	ensureWatch("ws1");
	await sleep(100);

	// Stand in for the commit: HEAD moves, the index is rewritten, the worktree is byte-identical.
	writeFileSync(join(metaDir, "HEAD"), "ref: refs/heads/b2\n");
	writeFileSync(join(metaDir, "index"), "x\n");

	await waitFor(() => nudges.length > 0);
	expect(nudges).toEqual(["ws1"]); // debounced: one nudge for the burst
	expect(payloads.filter((p) => p.paths.length > 0)).toHaveLength(0); // no path ever leaks

	// Stopping the watcher closes the metadata stream too — later churn is silent.
	stopWatch("ws1");
	await sleep(50);
	writeFileSync(join(metaDir, "HEAD"), "ref: refs/heads/b3\n");
	await sleep(600);
	expect(nudges).toEqual(["ws1"]);
});

test("the project repo's own shared git dir nudges every currently-watched workspace of that project", async () => {
	// The project's OWN git dir — a real directory (never a gitfile pointer, unlike a linked worktree's),
	// shared by every worktree of the repo. This is the only watcher pair that ever looks here at all.
	//
	// The write below targets `packed-refs`, a genuine TOP-LEVEL git artifact (rewritten by `git gc` /
	// `fetch --prune` / `pack-refs`) — the non-recursive `<gitDir>` watch's job. The recursive `refs/`
	// sub-watch (the OTHER half of the pair, covering loose refs like a plain `git branch`) is exercised on
	// its own, with real git commands, in the "reliably nudges" test below.
	const repoDir = join(dataDir, "repo");
	mkdirSync(join(repoDir, ".git", "refs", "heads"), { recursive: true });
	writeFileSync(
		join(dataDir, "projects.json"),
		JSON.stringify([
			{ id: "p1", name: "repo", path: repoDir, slug: "repo", lastOpened: Date.now() },
		]),
	);
	// A second workspace of the SAME project — many workspaces, one repo, is the whole point of this watcher:
	// it must not become a per-workspace watcher, so one write should nudge both.
	const worktree2 = join(dataDir, "worktree2");
	mkdirSync(worktree2);
	writeFileSync(
		join(dataDir, "workspaces.json"),
		JSON.stringify([
			{
				id: "ws1",
				projectId: "p1",
				name: "ws",
				branch: "b",
				worktreePath: worktree,
				baseBranch: "main",
			},
			{
				id: "ws2",
				projectId: "p1",
				name: "ws2",
				branch: "b2",
				worktreePath: worktree2,
				baseBranch: "main",
			},
		]),
	);

	const nudges: string[] = [];
	setRepoMetaPublisher((id) => nudges.push(id));
	ensureWatch("ws1");
	ensureWatch("ws2");
	await sleep(150);

	writeFileSync(
		join(repoDir, ".git", "packed-refs"),
		"# pack-refs with: peeled fully-peeled sorted \n",
	);

	await waitFor(() => nudges.length >= 2);
	expect(nudges.toSorted()).toEqual(["ws1", "ws2"]); // one repo, fanned out to both open workspaces
	// …and, as always, no `.git` path ever leaks into a client-facing batch.
	await sleep(600);
	expect(payloads.filter((p) => p.paths.some((x) => x.includes(".git")))).toHaveLength(0);
});

test("a plain `git branch` in one worktree reliably nudges the project signal via the recursive refs/ watch", async () => {
	// This is the scenario the whole watcher exists for, exercised with a REAL git repo and REAL `git branch`
	// commands — not a synthetic stand-in. `refs/heads/<name>` is what a plain `git branch` writes, and it is
	// two levels below `<gitDir>`, out of reach of the non-recursive `<gitDir>` watch on its own (measured:
	// ~50% hit rate there, every hit mis-attributed to an unrelated `HEAD.lock` rename — see SPEC.md). The
	// recursive watch rooted at `<gitDir>/refs` is what actually closes the gap.
	//
	// Five independent branches, waited on one at a time: a regression back to non-recursive-on-`.git` only
	// would have roughly a (1 - 0.5^5) ≈ 97% chance of missing at least one of these and failing on a
	// `waitFor` timeout — this is not a coin-flip-tolerant assertion.
	const repoDir = join(dataDir, "repo");
	initRepo(repoDir);
	writeFileSync(
		join(dataDir, "projects.json"),
		JSON.stringify([
			{ id: "p1", name: "repo", path: repoDir, slug: "repo", lastOpened: Date.now() },
		]),
	);

	const nudges: string[] = [];
	setRepoMetaPublisher((id) => nudges.push(id));
	ensureWatch("ws1"); // ws1's projectId is "p1" (see the shared beforeEach fixture)
	await sleep(150);

	for (let i = 0; i < 5; i++) {
		const before = nudges.length;
		git(repoDir, "branch", `newbranch-${i}`); // the write lands only in the shared repo dir, not in worktree
		await waitFor(() => nudges.length > before);
	}
	expect(nudges.length).toBeGreaterThanOrEqual(5);
	// …and, as always, no `.git` path ever leaks into a client-facing batch.
	await sleep(600);
	expect(payloads.filter((p) => p.paths.some((x) => x.includes(".git")))).toHaveLength(0);
});

test("the project refs/ watcher tolerates refs/ being absent at first — no sticky failure", async () => {
	// `refs/` can genuinely not exist yet when the project is first watched (this repo has none at all,
	// unlike a normal `git init`, which pre-creates `refs/heads` and `refs/tags` empty) — and, more
	// realistically, a repo whose refs are fully packed can have a sparse or absent loose-refs tree. Either
	// way this must degrade the same way every other failed watcher start in this module does: retried on
	// the next `ensureWatch`, never permanently given up on.
	const repoDir = join(dataDir, "repo");
	mkdirSync(join(repoDir, ".git"), { recursive: true }); // a `.git` dir with no `refs/` subtree at all
	writeFileSync(
		join(dataDir, "projects.json"),
		JSON.stringify([
			{ id: "p1", name: "repo", path: repoDir, slug: "repo", lastOpened: Date.now() },
		]),
	);

	const nudges: string[] = [];
	setRepoMetaPublisher((id) => nudges.push(id));
	ensureWatch("ws1"); // refs/ doesn't exist yet — must not throw, must not disable the watcher permanently
	await sleep(150);

	// refs/ appears later (e.g. the repo's first branch is about to be created) — the next `ensureWatch`
	// (host calls this on every workspace read) must notice and start watching it, not stay silent forever.
	mkdirSync(join(repoDir, ".git", "refs", "heads"), { recursive: true });
	ensureWatch("ws1");
	await sleep(150);

	writeFileSync(
		join(repoDir, ".git", "refs", "heads", "late"),
		"0000000000000000000000000000000000000000\n",
	);
	await waitFor(() => nudges.length > 0);
	expect(nudges).toEqual(["ws1"]);
});

test("the project git-dir watcher self-heals on inode change (dir deleted and recreated)", async () => {
	const repoDir = join(dataDir, "repo");
	mkdirSync(join(repoDir, ".git"), { recursive: true });
	writeFileSync(
		join(dataDir, "projects.json"),
		JSON.stringify([
			{ id: "p1", name: "repo", path: repoDir, slug: "repo", lastOpened: Date.now() },
		]),
	);

	const nudges: string[] = [];
	setRepoMetaPublisher((id) => nudges.push(id));
	ensureWatch("ws1"); // ws1's projectId is "p1" (see the shared beforeEach fixture)
	await sleep(150);

	// Recreate the shared git dir out from under the live watcher (same path, new inode) — the exact shape
	// every other self-healing watcher in this module handles (e.g. the worktree-root test above).
	rmSync(join(repoDir, ".git"), { recursive: true, force: true });
	mkdirSync(join(repoDir, ".git"));
	ensureWatch("ws1"); // detects the inode change → tears down + re-creates the project watcher
	await sleep(150);
	nudges.length = 0;

	writeFileSync(join(repoDir, ".git", "HEAD"), "ref: refs/heads/reborn\n");
	await waitFor(() => nudges.length > 0);
	expect(nudges).toEqual(["ws1"]);
});

test("ignored churn (node_modules) never publishes", async () => {
	ensureWatch("ws1");
	await sleep(100);
	mkdirSync(join(worktree, "node_modules"));
	await sleep(50);
	writeFileSync(join(worktree, "node_modules", "pkg.js"), "x\n");
	// The mkdir of node_modules itself is also filtered (its own rel path hits the ignored segment).
	await sleep(600); // beyond quiet+max windows
	expect(payloads.filter((p) => p.paths.some((x) => x.includes("node_modules")))).toHaveLength(0);
});

test("unknown workspace and stopWatch are safe no-ops; stopped watchers stay silent", async () => {
	ensureWatch("nope"); // unknown → no-op, no throw
	ensureWatch("ws1");
	await sleep(100);
	stopWatch("ws1");
	stopWatch("ws1"); // idempotent
	writeFileSync(join(worktree, "after-stop.ts"), "x\n");
	await sleep(1000); // past the startup-nudge window too — stop must cancel the pending nudge
	expect(payloads).toHaveLength(0);
});

test("a fresh watcher shares readiness, publishes its wildcard first, then reports already-ready", async () => {
	const order: string[] = [];
	setWatchPublisher((payload) => {
		payloads.push(payload);
		order.push("publish");
	});
	const first = ensureWatch("ws1");
	const second = ensureWatch("ws1");
	expect(second).toBe(first);
	const settled = first.then((result) => {
		order.push("ready");
		return result;
	});

	await sleep(100);
	expect(order).toEqual([]);
	expect(await settled).toEqual({ startupNudge: true });
	expect(payloads).toEqual([
		{ workspaceId: "ws1", paths: [], truncated: true, skillChange: "unknown" },
	]);
	expect(order).toEqual(["publish", "ready"]);
	expect(await ensureWatch("ws1")).toEqual({ startupNudge: false });
	await sleep(300);
	expect(payloads).toHaveLength(1); // one-shot, not periodic
});

test("stopping before readiness settles callers conservatively without a late publish", async () => {
	const ready = ensureWatch("ws1");
	stopWatch("ws1");
	expect(await ready).toEqual({ startupNudge: true });
	await sleep(1000);
	expect(payloads).toHaveLength(0);
});

test("a deleted-and-recreated worktree root (same path, new inode) is re-watched on the next read", async () => {
	ensureWatch("ws1");
	await sleep(100);
	rmSync(worktree, { recursive: true, force: true });
	mkdirSync(worktree);
	ensureWatch("ws1"); // detects the inode change → tears down + re-creates
	await sleep(100);
	payloads.length = 0; // ignore teardown churn + the first watcher's nudge
	writeFileSync(join(worktree, "reborn.ts"), "x\n");
	await waitFor(() => payloads.some((p) => p.paths.includes("reborn.ts") || p.truncated), 3000);
	expect(payloads.some((p) => p.workspaceId === "ws1")).toBe(true);
});

test("a watcher whose workspace record is gone is reaped on the next ensureWatch", async () => {
	ensureWatch("ws1");
	await sleep(100);
	// Replace persistence with a different workspace (ws1 forgotten out-of-band, its dir still exists).
	const worktree2 = join(dataDir, "worktree2");
	mkdirSync(worktree2);
	writeFileSync(
		join(dataDir, "workspaces.json"),
		JSON.stringify([
			{
				id: "ws2",
				projectId: "p1",
				name: "ws2",
				branch: "b2",
				worktreePath: worktree2,
				baseBranch: "main",
			},
		]),
	);
	ensureWatch("ws2"); // reaps the zombie ws1 watcher
	await sleep(100);
	payloads.length = 0;
	writeFileSync(join(worktree, "zombie.ts"), "x\n");
	await sleep(1000); // past quiet + max-wait + ws1's (cancelled) nudge
	expect(payloads.filter((p) => p.workspaceId === "ws1")).toHaveLength(0);
});
