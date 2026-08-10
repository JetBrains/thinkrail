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
