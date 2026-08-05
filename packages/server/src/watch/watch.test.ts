import { afterEach, beforeEach, expect, test } from "bun:test";
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { WorkspaceFsChangedPayload } from "@thinkrail/contracts";
import { createCoalescer } from "./coalesce";
import {
	ensureWatch,
	isIgnoredPath,
	setRepoMetaPublisher,
	setWatchPublisher,
	stopAllWatches,
	stopWatch,
} from "./watch";

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

async function waitFor(check: () => boolean, timeoutMs = 3000): Promise<void> {
	const deadline = Date.now() + timeoutMs;
	while (!check()) {
		if (Date.now() > deadline) throw new Error("waitFor timed out");
		await sleep(25);
	}
}

// ---- coalesce.ts ----

test("coalescer dedupes and flushes one batch after the quiet gap", async () => {
	const flushes: { paths: string[]; truncated: boolean }[] = [];
	const c = createCoalescer({
		quietMs: 30,
		maxWaitMs: 500,
		maxPaths: 10,
		onFlush: (b) => flushes.push(b),
	});
	c.add("a.ts");
	c.add("b.ts");
	c.add("a.ts");
	await waitFor(() => flushes.length > 0);
	expect(flushes).toHaveLength(1);
	expect(flushes[0]?.paths.toSorted()).toEqual(["a.ts", "b.ts"]);
	expect(flushes[0]?.truncated).toBe(false);
	c.dispose();
});

test("coalescer max-wait flushes under continuous churn (quiet never reached)", async () => {
	const flushes: { paths: string[]; truncated: boolean }[] = [];
	const c = createCoalescer({
		quietMs: 60,
		maxWaitMs: 120,
		maxPaths: 1000,
		onFlush: (b) => flushes.push(b),
	});
	// Feed an event every 20ms for ~300ms: the 60ms quiet timer keeps resetting, so only the
	// 120ms max-wait timer can flush mid-stream.
	for (let i = 0; i < 15; i++) {
		c.add(`f${i}.ts`);
		await sleep(20);
	}
	expect(flushes.length).toBeGreaterThanOrEqual(1);
	c.dispose();
});

test("coalescer caps the batch (truncated) and treats a null path as wildcard", async () => {
	const flushes: { paths: string[]; truncated: boolean }[] = [];
	const c = createCoalescer({
		quietMs: 20,
		maxWaitMs: 500,
		maxPaths: 2,
		onFlush: (b) => flushes.push(b),
	});
	c.add("a.ts");
	c.add("b.ts");
	c.add("c.ts"); // over the cap
	await waitFor(() => flushes.length > 0);
	expect(flushes[0]?.paths.toSorted()).toEqual(["a.ts", "b.ts"]);
	expect(flushes[0]?.truncated).toBe(true);

	c.add(null); // unknown path → wildcard batch even with no paths
	await waitFor(() => flushes.length > 1);
	expect(flushes[1]).toEqual({ paths: [], truncated: true });
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
	c.add("a.ts");
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
});

afterEach(() => {
	stopAllWatches();
	setWatchPublisher(null);
	setRepoMetaPublisher(null);
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
	// shared by every worktree of the repo. This is the only watcher that ever looks here at all.
	//
	// The write below targets `packed-refs`, a genuine TOP-LEVEL git artifact (rewritten by `git gc` /
	// `fetch --prune` / `pack-refs`), not a synthetic path picked for convenience: it is deliberately NOT a
	// stand-in for a plain `git branch` (which only ever touches `refs/heads/<name>`, two levels down).
	// Measured directly (see `packages/server/src/watch/SPEC.md` and the task report): a non-recursive
	// `fs.watch` on darwin only reliably observes this dir's *direct children* — top-level writes fire
	// 10/10 in a clean sample, while a bare nested `refs/heads/<name>` write fires 0/N once the watcher has
	// settled, and even a real `git branch` (whose *reflog* write is nested too) only fired ~50% of the
	// time, via an unrelated top-level `HEAD.lock` mis-attribution. So this test exercises exactly what the
	// mechanism can deliver — top-level churn, fanned out to every open workspace of the one project,
	// never leaking a `.git` path — and does not claim more reliability for loose-ref creation than was
	// actually measured.
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

test("a fresh watcher publishes one wildcard startup nudge even with no fs activity", async () => {
	ensureWatch("ws1");
	await waitFor(() => payloads.length > 0, 2000);
	expect(payloads[0]).toEqual({ workspaceId: "ws1", paths: [], truncated: true });
	await sleep(300);
	expect(payloads).toHaveLength(1); // one-shot, not periodic
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
