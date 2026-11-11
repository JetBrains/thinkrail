import { afterEach, beforeEach, expect, test } from "bun:test";
import {
	mkdirSync,
	mkdtempSync,
	readdirSync,
	readFileSync,
	renameSync,
	rmSync,
	writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { WorkspaceFsChangedPayload, WorkspaceSkillChange } from "@thinkrail/contracts";
import { createCoalescer } from "./coalesce";
import {
	ensureWatch,
	isIgnoredPath,
	setIgnoredPathsResolver,
	setRepoMetaPublisher,
	setSkillPathClassifier,
	setWatchPublisher,
	setWatchStartedPublisher,
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
	c.add("c.ts", "none");
	await waitFor(() => flushes.length > 0);
	expect(flushes[0]).toEqual({
		paths: ["a.ts", "b.ts"],
		truncated: true,
		skillChange: "none",
	});

	c.add("d.ts", "none");
	c.add("e.ts", "none");
	c.add(".claude/skills/demo/SKILL.md", "detected");
	await waitFor(() => flushes.length > 1);
	expect(flushes[1]).toEqual({
		paths: ["d.ts", "e.ts"],
		truncated: true,
		skillChange: "detected",
	});

	c.add(null, "unknown");
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

test("isIgnoredPath skips .git and node_modules subtrees and .DS_Store noise", () => {
	expect(isIgnoredPath(".git/index.lock")).toBe(true);
	expect(isIgnoredPath("packages/web/node_modules/react/index.js")).toBe(true);
	expect(isIgnoredPath(".DS_Store")).toBe(true);
	expect(isIgnoredPath("docs/.DS_Store")).toBe(true);
	expect(isIgnoredPath("src/index.ts")).toBe(false);
	expect(isIgnoredPath("SPEC.md")).toBe(false);
	expect(isIgnoredPath(".git/HEAD")).toBe(true);
	expect(isIgnoredPath(".git/logs/HEAD")).toBe(true);
	expect(isIgnoredPath("src/gitignore-parser.ts")).toBe(false);
	expect(isIgnoredPath("my_node_modules_tool/a.ts")).toBe(false);
});

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
	setWatchStartedPublisher(null);
	setSkillPathClassifier(null);
	setIgnoredPathsResolver(null);
	rmSync(dataDir, { recursive: true, force: true });
	if (savedDataDir === undefined) delete process.env.THINKRAIL_DATA_DIR;
	else process.env.THINKRAIL_DATA_DIR = savedDataDir;
});

test("a watched worktree publishes a debounced fsChanged batch for a new file", async () => {
	void ensureWatch("ws1");
	void ensureWatch("ws1");
	await sleep(100);
	writeFileSync(join(worktree, "hello.ts"), "export {};\n");
	await waitFor(() => payloads.length > 0);
	expect(payloads[0]?.workspaceId).toBe("ws1");
	expect(payloads[0]?.truncated).toBe(false);
	expect(payloads[0]?.paths).toContain("hello.ts");
	expect(payloads[0]?.skillChange).toBe("none");
});

test("a watched project-skill path carries detected evidence", async () => {
	mkdirSync(join(worktree, ".claude", "skills", "demo"), { recursive: true });
	void ensureWatch("ws1");
	await sleep(100);
	writeFileSync(join(worktree, ".claude", "skills", "demo", "SKILL.md"), "# Demo\n");
	await waitFor(() => payloads.some((payload) => payload.skillChange === "detected"));
	expect(
		payloads.some((payload) => payload.paths.some((path) => path.includes(".claude/skills"))),
	).toBe(true);
});

test("a missing classifier degrades a concrete event to unknown", async () => {
	setSkillPathClassifier(null);
	void ensureWatch("ws1");
	await sleep(100);
	writeFileSync(join(worktree, "unclassified.ts"), "export {};\n");
	await waitFor(() => payloads.some((payload) => payload.paths.includes("unclassified.ts")));
	expect(payloads.find((payload) => payload.paths.includes("unclassified.ts"))?.skillChange).toBe(
		"unknown",
	);
});

test("a .git write nudges the repo-meta sink without ever becoming an fsChanged path", async () => {
	const nudges: string[] = [];
	const started: string[] = [];
	setRepoMetaPublisher((id) => nudges.push(id));
	setWatchStartedPublisher((id) => started.push(`${id}:${nudges.length}`));
	void ensureWatch("ws1");
	void ensureWatch("ws1");
	expect(started).toEqual(["ws1:0"]);
	await sleep(100);

	mkdirSync(join(worktree, ".git"), { recursive: true });
	writeFileSync(join(worktree, ".git", "HEAD"), "ref: refs/heads/live\n");
	writeFileSync(join(worktree, ".git", "index"), "x\n");

	await waitFor(() => nudges.length > 0);
	expect(nudges).toEqual(["ws1"]);
	await sleep(600);
	expect(payloads.filter((p) => p.paths.some((x) => x.includes(".git")))).toHaveLength(0);

	stopWatch("ws1");
	writeFileSync(join(worktree, ".git", "HEAD"), "ref: refs/heads/other\n");
	await sleep(600);
	expect(nudges).toEqual(["ws1"]);
});

test("transient git lock files do not nudge repo metadata", async () => {
	const nudges: string[] = [];
	setRepoMetaPublisher((id) => nudges.push(id));
	mkdirSync(join(worktree, ".git"), { recursive: true });
	void ensureWatch("ws1");
	await sleep(100);

	writeFileSync(join(worktree, ".git", "index.lock"), "x\n");
	await sleep(100);
	rmSync(join(worktree, ".git", "index.lock"));
	mkdirSync(join(worktree, ".git", "refs", "heads"), { recursive: true });
	await sleep(600);
	expect(nudges).toHaveLength(0);

	writeFileSync(join(worktree, ".git", "HEAD"), "ref: refs/heads/live\n");
	await waitFor(() => nudges.length > 0);
	expect(nudges).toEqual(["ws1"]);
});

test("a throwing repo-meta or fsChanged subscriber never escapes the watcher's timers", async () => {
	const escaped: unknown[] = [];
	const onUncaught = (error: unknown) => escaped.push(error);
	process.on("uncaughtException", onUncaught);
	try {
		const nudges: string[] = [];
		setRepoMetaPublisher((id) => {
			nudges.push(id);
			throw new Error(`Unknown workspace: ${id}`);
		});
		setWatchPublisher((payload) => {
			payloads.push(payload);
			throw new Error("subscriber failed");
		});
		void ensureWatch("ws1");
		await waitFor(() => payloads.length > 0);
		writeFileSync(join(worktree, "after.ts"), "export {};\n");
		await waitFor(() => payloads.some((payload) => payload.paths.includes("after.ts")));
		mkdirSync(join(worktree, ".git"), { recursive: true });
		writeFileSync(join(worktree, ".git", "HEAD"), "ref: refs/heads/one\n");
		await waitFor(() => nudges.length === 1);
		await sleep(400);
		writeFileSync(join(worktree, ".git", "HEAD"), "ref: refs/heads/two\n");
		await waitFor(() => nudges.length === 2);
		expect(escaped).toEqual([]);
	} finally {
		process.off("uncaughtException", onUncaught);
	}
}, 15_000);

test("a watch-started publisher that throws leaves no half-registered watcher behind", async () => {
	let calls = 0;
	setWatchStartedPublisher(() => {
		calls += 1;
		if (calls === 1) throw new Error("seed failed");
	});
	expect(await ensureWatch("ws1")).toEqual({ startupNudge: true });
	expect(calls).toBe(1);
	const ready = ensureWatch("ws1");
	expect(calls).toBe(2);
	expect(await ready).toEqual({ startupNudge: true });
	expect(await ensureWatch("ws1")).toEqual({ startupNudge: false });
});

test("a linked worktree's git metadata lives outside the root — its churn still nudges the sink", async () => {
	const metaDir = join(dataDir, "repo", ".git", "worktrees", "ws");
	mkdirSync(metaDir, { recursive: true });
	writeFileSync(join(metaDir, "HEAD"), "ref: refs/heads/b\n");
	writeFileSync(join(worktree, ".git"), `gitdir: ${metaDir}\n`);

	const nudges: string[] = [];
	setRepoMetaPublisher((id) => nudges.push(id));
	void ensureWatch("ws1");
	await sleep(100);

	writeFileSync(join(metaDir, "HEAD"), "ref: refs/heads/b2\n");
	writeFileSync(join(metaDir, "index"), "x\n");

	await waitFor(() => nudges.length > 0);
	expect(nudges).toEqual(["ws1"]);
	expect(payloads.filter((p) => p.paths.length > 0)).toHaveLength(0);

	stopWatch("ws1");
	await sleep(50);
	writeFileSync(join(metaDir, "HEAD"), "ref: refs/heads/b3\n");
	await sleep(600);
	expect(nudges).toEqual(["ws1"]);
});

test("a linked worktree's transient git lock does not nudge repo metadata", async () => {
	const metaDir = join(dataDir, "repo", ".git", "worktrees", "ws");
	mkdirSync(metaDir, { recursive: true });
	writeFileSync(join(metaDir, "HEAD"), "ref: refs/heads/b\n");
	writeFileSync(join(worktree, ".git"), `gitdir: ${metaDir}\n`);

	const nudges: string[] = [];
	setRepoMetaPublisher((id) => nudges.push(id));
	void ensureWatch("ws1");
	await sleep(100);

	writeFileSync(join(metaDir, "index.lock"), "x\n");
	rmSync(join(metaDir, "index.lock"));
	await sleep(600);
	expect(nudges).toHaveLength(0);

	writeFileSync(join(metaDir, "HEAD"), "ref: refs/heads/b2\n");
	await waitFor(() => nudges.length > 0);
	expect(nudges).toEqual(["ws1"]);
});

test("a linked worktree's nested reflog update nudges repo metadata", async () => {
	const metaDir = join(dataDir, "repo", ".git", "worktrees", "ws");
	mkdirSync(join(metaDir, "logs"), { recursive: true });
	writeFileSync(join(metaDir, "HEAD"), "ref: refs/heads/b\n");
	writeFileSync(join(metaDir, "logs", "HEAD"), "initial\n");
	writeFileSync(join(worktree, ".git"), `gitdir: ${metaDir}\n`);

	const nudges: string[] = [];
	setRepoMetaPublisher((id) => nudges.push(id));
	void ensureWatch("ws1");
	await sleep(100);

	writeFileSync(join(metaDir, "HEAD.lock"), "ref: refs/heads/b2\n");
	writeFileSync(join(metaDir, "logs", "HEAD"), "initial\nupdated\n");
	rmSync(join(metaDir, "HEAD.lock"));

	await waitFor(() => nudges.length > 0);
	expect(nudges).toEqual(["ws1"]);
});

test("a linked worktree's nested submodule git dirs never nudge repo metadata", async () => {
	const metaDir = join(dataDir, "repo", ".git", "worktrees", "ws");
	const objects = join(metaDir, "modules", "sub", "objects");
	mkdirSync(objects, { recursive: true });
	mkdirSync(join(metaDir, "logs"), { recursive: true });
	writeFileSync(join(metaDir, "HEAD"), "ref: refs/heads/b\n");
	writeFileSync(join(worktree, ".git"), `gitdir: ${metaDir}\n`);

	const nudges: string[] = [];
	setRepoMetaPublisher((id) => nudges.push(id));
	void ensureWatch("ws1");
	await sleep(100);

	mkdirSync(join(objects, "ab"));
	writeFileSync(join(objects, "ab", "cdef"), "blob\n");
	writeFileSync(join(metaDir, "modules", "sub", "HEAD"), "ref: refs/heads/sub\n");
	await sleep(600);
	expect(nudges).toHaveLength(0);
});

test("ignored churn (node_modules) never publishes", async () => {
	void ensureWatch("ws1");
	await sleep(100);
	mkdirSync(join(worktree, "node_modules"));
	await sleep(50);
	writeFileSync(join(worktree, "node_modules", "pkg.js"), "x\n");
	await sleep(600);
	expect(payloads.filter((p) => p.paths.some((x) => x.includes("node_modules")))).toHaveLength(0);
});

test.if(process.platform === "linux")(
	"on Linux the root .git stays watched when the resolver would ignore it",
	async () => {
		mkdirSync(join(worktree, ".git", "refs", "heads"), { recursive: true });
		mkdirSync(join(worktree, ".git", "reftable"));
		const asked: string[] = [];
		setIgnoredPathsResolver(async (_root, paths) => {
			asked.push(...paths);
			return new Set(paths);
		});
		const nudges: string[] = [];
		setRepoMetaPublisher((id) => nudges.push(id));
		await ensureWatch("ws1");
		expect(asked.filter((path) => path.split("/")[0] === ".git")).toEqual([]);
		writeFileSync(join(worktree, ".git", "HEAD"), "ref: refs/heads/next\n");
		await waitFor(() => nudges.length > 0);
		nudges.length = 0;
		writeFileSync(join(worktree, ".git", "refs", "heads", "next"), "0\n");
		await waitFor(() => nudges.length > 0);
		nudges.length = 0;
		writeFileSync(join(worktree, ".git", "reftable", "tables.list"), "0\n");
		await waitFor(() => nudges.length > 0);
	},
);

test.if(process.platform === "linux")(
	"on Linux a commit inside a submodule nudges the repo-meta sink",
	async () => {
		const git = (cwd: string, ...args: string[]) => {
			const result = Bun.spawnSync([
				"git",
				"-C",
				cwd,
				"-c",
				"user.email=t@t",
				"-c",
				"user.name=t",
				"-c",
				"commit.gpgsign=false",
				"-c",
				"protocol.file.allow=always",
				...args,
			]);
			if (!result.success) throw new Error(result.stderr.toString());
		};
		const repo = (dir: string) => {
			mkdirSync(dir, { recursive: true });
			git(dir, "init", "-q");
			git(dir, "commit", "-q", "--allow-empty", "-m", "init");
		};
		const leaf = join(dataDir, "leaf");
		const nest = join(dataDir, "nest");
		repo(leaf);
		repo(nest);
		git(nest, "submodule", "add", "-q", leaf, "inner");
		git(nest, "commit", "-q", "-m", "inner");
		repo(worktree);
		git(worktree, "submodule", "add", "-q", leaf, "sub");
		git(worktree, "submodule", "add", "-q", leaf, "libs/foo");
		git(worktree, "submodule", "add", "-q", nest, "nest");
		git(worktree, "submodule", "update", "-q", "--init", "--recursive");
		const nudges: string[] = [];
		setRepoMetaPublisher((id) => nudges.push(id));
		await ensureWatch("ws1");
		for (const path of ["sub", "libs/foo", "nest/inner"]) {
			await sleep(400);
			nudges.length = 0;
			git(join(worktree, path), "commit", "-q", "--allow-empty", "-m", path);
			await waitFor(() => nudges.length > 0);
		}
	},
	20_000,
);

test.if(process.platform === "linux")(
	"on Linux a git metadata change re-checks folders skipped as ignored",
	async () => {
		mkdirSync(join(worktree, ".git", "info"), { recursive: true });
		mkdirSync(join(worktree, "dist"));
		writeFileSync(join(worktree, "dist", "index.js"), "x\n");
		const ignored = new Set(["dist"]);
		setIgnoredPathsResolver(async (_root, paths) => new Set(paths.filter((p) => ignored.has(p))));
		const nudges: string[] = [];
		setRepoMetaPublisher((id) => nudges.push(id));
		await ensureWatch("ws1");
		ignored.clear();
		writeFileSync(join(worktree, ".git", "info", "exclude"), "\n");
		await waitFor(() => nudges.length > 0);
		await waitFor(() => payloads.some((p) => p.paths.includes("dist/index.js")));
		await sleep(100);
		payloads.length = 0;
		writeFileSync(join(worktree, "dist", "index.js"), "y\n");
		await waitFor(() => payloads.some((p) => p.paths.includes("dist/index.js")));
	},
);

test.if(process.platform === "linux")(
	"on Linux readiness waits until every folder is watched",
	async () => {
		mkdirSync(join(worktree, "a", "b", "c"), { recursive: true });
		setIgnoredPathsResolver(async () => {
			await sleep(400);
			return new Set();
		});
		await ensureWatch("ws1");
		payloads.length = 0;
		writeFileSync(join(worktree, "a", "b", "c", "x.ts"), "x\n");
		await waitFor(() => payloads.some((p) => p.paths.includes("a/b/c/x.ts")));
	},
);

function inotifyWatches(): number {
	let count = 0;
	for (const fd of readdirSync("/proc/self/fdinfo")) {
		try {
			const info = readFileSync(`/proc/self/fdinfo/${fd}`, "utf8");
			count += info.split("\n").filter((line) => line.startsWith("inotify wd:")).length;
		} catch {}
	}
	return count;
}

test.if(process.platform === "linux")(
	"on Linux skipped and ignored folders hold no inotify watch, and stop releases them",
	async () => {
		for (const dir of [
			"src",
			"node_modules/a/b",
			"tmp/x/y",
			".git/objects/ab",
			".git/logs/refs",
			".git/refs/heads",
			".git/modules/sub/objects/ab",
			".git/modules/libs/foo/logs/refs",
			".git/modules/libs/foo/refs/heads",
			"sub/.git/objects/cd",
		]) {
			mkdirSync(join(worktree, dir), { recursive: true });
		}
		const asked: string[] = [];
		setIgnoredPathsResolver(async (root, paths) => {
			expect(root).toBe(worktree);
			asked.push(...paths);
			return new Set(paths.filter((path) => path === "tmp"));
		});
		const before = inotifyWatches();
		expect(await ensureWatch("ws1")).toEqual({ startupNudge: true });
		expect(asked).toContain("tmp");
		expect(inotifyWatches() - before).toBe(12);
		payloads.length = 0;
		writeFileSync(join(worktree, "tmp", "x", "out.txt"), "x\n");
		mkdirSync(join(worktree, "src", "node_modules", "pkg"), { recursive: true });
		mkdirSync(join(worktree, "late", "node_modules", "pkg"), { recursive: true });
		writeFileSync(join(worktree, "late", "x.ts"), "x\n");
		await waitFor(() => payloads.some((p) => p.paths.includes("late/x.ts")));
		await sleep(400);
		expect(inotifyWatches() - before).toBe(13);
		expect(payloads.some((p) => p.paths.some((x) => x.startsWith("tmp/")))).toBe(false);
		stopWatch("ws1");
		await waitFor(() => inotifyWatches() === before);
	},
);

test.if(process.platform === "linux")(
	"on Linux a nested workspace's start makes the outer one refetch without a skill change",
	async () => {
		const inner = join(worktree, "p", "in");
		mkdirSync(inner, { recursive: true });
		writeFileSync(
			join(dataDir, "workspaces.json"),
			JSON.stringify(
				[
					{ id: "ws1", path: worktree },
					{ id: "ws2", path: inner },
				].map(({ id, path }) => ({
					id,
					projectId: "p1",
					name: id,
					branch: id,
					worktreePath: path,
					baseBranch: "main",
				})),
			),
		);
		await ensureWatch("ws1");
		payloads.length = 0;
		writeFileSync(join(inner, "before.ts"), "x\n");
		void ensureWatch("ws2");
		const outer = () => payloads.filter((p) => p.workspaceId === "ws1");
		await waitFor(() => outer().some((p) => p.truncated || p.paths.includes("p/in/before.ts")));
		expect(outer().map((p) => p.skillChange)).not.toContain("unknown");
	},
);

test.if(process.platform === "linux")(
	"on Linux an outer workspace's start makes a nested one refetch its skill folders as a skill change",
	async () => {
		const inner = join(worktree, "p", "in");
		mkdirSync(join(inner, ".claude", "skills", "s"), { recursive: true });
		writeFileSync(
			join(dataDir, "workspaces.json"),
			JSON.stringify(
				[
					{ id: "ws1", path: worktree },
					{ id: "ws2", path: inner },
				].map(({ id, path }) => ({
					id,
					projectId: "p1",
					name: id,
					branch: id,
					worktreePath: path,
					baseBranch: "main",
				})),
			),
		);
		await ensureWatch("ws2");
		payloads.length = 0;
		void ensureWatch("ws1");
		await waitFor(() =>
			payloads.some((p) => p.workspaceId === "ws2" && p.truncated && p.skillChange === "detected"),
		);
	},
);

test.if(process.platform === "linux")(
	"on Linux stopping a large watcher releases its inotify watches over several turns",
	async () => {
		for (let top = 0; top < 30; top++) {
			for (let sub = 0; sub < 100; sub++) {
				mkdirSync(join(worktree, `t${top}`, `s${sub}`), { recursive: true });
			}
		}
		const before = inotifyWatches();
		await ensureWatch("ws1");
		const watched = inotifyWatches() - before;
		expect(watched).toBe(3031);
		stopWatch("ws1");
		await new Promise((resolve) => setImmediate(resolve));
		const left = inotifyWatches() - before;
		expect(left).toBeGreaterThan(0);
		expect(left).toBeLessThan(watched);
		await waitFor(() => inotifyWatches() === before);
	},
);

test("unknown workspace and stopWatch are safe no-ops; stopped watchers stay silent", async () => {
	void ensureWatch("nope");
	void ensureWatch("ws1");
	await sleep(100);
	stopWatch("ws1");
	stopWatch("ws1");
	writeFileSync(join(worktree, "after-stop.ts"), "x\n");
	await sleep(1000);
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
	expect(payloads).toHaveLength(1);
});

test("stopping before readiness settles callers conservatively without a late publish", async () => {
	const ready = ensureWatch("ws1");
	stopWatch("ws1");
	expect(await ready).toEqual({ startupNudge: true });
	await sleep(1000);
	expect(payloads).toHaveLength(0);
});

test("a deleted-and-recreated worktree root (same path, new inode) is re-watched on the next read", async () => {
	mkdirSync(join(worktree, "src"));
	await ensureWatch("ws1");
	mkdirSync(`${worktree}-next/src`, { recursive: true });
	rmSync(worktree, { recursive: true, force: true });
	renameSync(`${worktree}-next`, worktree);
	await ensureWatch("ws1");
	payloads.length = 0;
	writeFileSync(join(worktree, "reborn.ts"), "x\n");
	writeFileSync(join(worktree, "src", "deep.ts"), "x\n");
	await waitFor(() =>
		["reborn.ts", "src/deep.ts"].every((path) => payloads.some((p) => p.paths.includes(path))),
	);
});

function seedWorkspaces(ids: string[]): Map<string, string> {
	const roots = new Map<string, string>();
	for (const id of ids) {
		const root = join(dataDir, `worktree-${id}`);
		mkdirSync(root, { recursive: true });
		roots.set(id, root);
	}
	writeFileSync(
		join(dataDir, "workspaces.json"),
		JSON.stringify(
			ids.map((id) => ({
				id,
				projectId: "p1",
				name: id,
				branch: id,
				worktreePath: roots.get(id),
				baseBranch: "main",
			})),
		),
	);
	return roots;
}

const isSettled = (promise: Promise<unknown>): Promise<boolean> =>
	Promise.race([promise.then(() => true), sleep(10).then(() => false)]);

test("prewarm-only watchers are globally capped: the oldest is evicted, real watchers never are", async () => {
	const prewarmIds = Array.from({ length: 9 }, (_, i) => `p${i + 1}`);
	seedWorkspaces(["real1", ...prewarmIds]);
	const realReady = ensureWatch("real1");
	const readies = new Map(
		prewarmIds.slice(0, 8).map((id) => [id, ensureWatch(id, { prewarm: true })]),
	);
	expect(await isSettled(realReady)).toBe(false);
	for (const ready of readies.values()) expect(await isSettled(ready)).toBe(false);

	void ensureWatch("p9", { prewarm: true });
	const evicted = readies.get("p1");
	if (!evicted) throw new Error("missing p1 readiness");
	expect(await evicted).toEqual({ startupNudge: true });
	expect(await isSettled(readies.get("p2") ?? Promise.resolve())).toBe(false);
	expect(await isSettled(realReady)).toBe(false);
});

test("a real read promotes a prewarmed watcher out of prewarm eviction", async () => {
	const prewarmIds = Array.from({ length: 10 }, (_, i) => `p${i + 1}`);
	seedWorkspaces(prewarmIds);
	const promoted = ensureWatch("p1", { prewarm: true });
	expect(ensureWatch("p1")).toBe(promoted);
	const readies = new Map(
		prewarmIds.slice(1, 9).map((id) => [id, ensureWatch(id, { prewarm: true })]),
	);
	expect(await isSettled(promoted)).toBe(false);

	void ensureWatch("p10", { prewarm: true });
	expect(await isSettled(readies.get("p2") ?? Promise.resolve())).toBe(true);
	expect(await isSettled(promoted)).toBe(false);
	expect(await isSettled(readies.get("p3") ?? Promise.resolve())).toBe(false);
});

test("re-prewarming an alive prewarm-only watcher refreshes its eviction recency", async () => {
	const prewarmIds = Array.from({ length: 9 }, (_, i) => `p${i + 1}`);
	seedWorkspaces(prewarmIds);
	const first = ensureWatch("p1", { prewarm: true });
	const readies = new Map(
		prewarmIds.slice(1, 8).map((id) => [id, ensureWatch(id, { prewarm: true })]),
	);
	expect(ensureWatch("p1", { prewarm: true })).toBe(first);

	void ensureWatch("p9", { prewarm: true });
	expect(await isSettled(readies.get("p2") ?? Promise.resolve())).toBe(true);
	expect(await isSettled(first)).toBe(false);
});

test("a watcher whose workspace record is gone is reaped on the next ensureWatch", async () => {
	void ensureWatch("ws1");
	await sleep(100);
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
	void ensureWatch("ws2");
	await sleep(100);
	payloads.length = 0;
	writeFileSync(join(worktree, "zombie.ts"), "x\n");
	await sleep(1000);
	expect(payloads.filter((p) => p.workspaceId === "ws1")).toHaveLength(0);
});

function git(cwd: string, ...args: string[]): void {
	const result = Bun.spawnSync(["git", "-C", cwd, ...args], { stdout: "ignore", stderr: "pipe" });
	if (!result.success)
		throw new Error(`git ${args.join(" ")} failed: ${new TextDecoder().decode(result.stderr)}`);
}

function commitIn(cwd: string, name: string): void {
	writeFileSync(join(cwd, name), `${name}\n`);
	git(cwd, "add", name);
	git(cwd, "commit", "-q", "-m", name);
}

function seedRepoWithRemote(): string {
	const repo = join(dataDir, "source-repo");
	git(dataDir, "init", "-q", "-b", "main", repo);
	git(repo, "config", "user.name", "ThinkRail Test");
	git(repo, "config", "user.email", "test@thinkrail.test");
	git(repo, "config", "commit.gpgsign", "false");
	commitIn(repo, "README.md");
	git(dataDir, "init", "-q", "--bare", join(dataDir, "remote.git"));
	git(repo, "remote", "add", "origin", join(dataDir, "remote.git"));
	rmSync(worktree, { recursive: true, force: true });
	return repo;
}

test("a linked worktree push refreshes remote metadata, and only for its own branch", async () => {
	const repo = seedRepoWithRemote();
	git(repo, "worktree", "add", "-q", "-b", "feature/issue1009", worktree);
	const nudges: string[] = [];
	setRepoMetaPublisher((id) => nudges.push(id));
	await ensureWatch("ws1");

	git(worktree, "push", "-q", "-u", "origin", "HEAD");
	await waitFor(() => nudges.length > 0, 4000);

	commitIn(worktree, "next.txt");
	await sleep(550);
	nudges.length = 0;
	git(worktree, "push", "-q");
	await waitFor(() => nudges.length > 0, 4000);

	nudges.length = 0;
	git(repo, "branch", "feature/unrelated");
	git(repo, "push", "-q", "origin", "feature/unrelated");
	await sleep(700);
	expect(nudges).toHaveLength(0);

	stopWatch("ws1");
	commitIn(worktree, "third.txt");
	git(worktree, "push", "-q");
	await sleep(700);
	expect(nudges).toHaveLength(0);
}, 15_000);

test("a push without an upstream refreshes remote metadata across pack-refs and a branch switch", async () => {
	const repo = seedRepoWithRemote();
	git(repo, "push", "-q", "origin", "main");
	git(repo, "worktree", "add", "-q", "--no-track", "-b", "feat", worktree, "main");
	const nudges: string[] = [];
	setRepoMetaPublisher((id) => nudges.push(id));
	await ensureWatch("ws1");
	const settle = async (step: () => void) => {
		step();
		await sleep(550);
		nudges.length = 0;
	};
	const pushNudges = async () => {
		git(worktree, "push", "-q", "origin", "HEAD");
		await waitFor(() => nudges.length > 0, 4000);
		expect(nudges).toEqual(["ws1"]);
	};

	await pushNudges();
	await settle(() => commitIn(worktree, "next.txt"));
	git(repo, "pack-refs", "--all");
	await pushNudges();
	await settle(() => commitIn(worktree, "again.txt"));
	await pushNudges();
	await settle(() => git(worktree, "switch", "-q", "-c", "other"));
	await pushNudges();
}, 20_000);
