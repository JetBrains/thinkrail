import { afterEach, beforeEach, expect, test } from "bun:test";
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { WorkspaceFsChangedPayload } from "@thinkrail/contracts";
import { createCoalescer } from "./coalesce";
import { ensureWatch, isIgnoredPath, setWatchPublisher, stopAllWatches, stopWatch } from "./watch";

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
