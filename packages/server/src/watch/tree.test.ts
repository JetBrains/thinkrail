import { afterEach, beforeEach, expect, spyOn, test } from "bun:test";
import * as fs from "node:fs";
import { mkdirSync, mkdtempSync, renameSync, rmSync, symlinkSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { type TreeWatcher, watchTree } from "./tree";

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

async function waitFor(check: () => boolean, timeoutMs = 3000): Promise<void> {
	const deadline = Date.now() + timeoutMs;
	while (!check()) {
		if (Date.now() > deadline) throw new Error("waitFor timed out");
		await sleep(25);
	}
}

let root: string;
let events: (string | null)[];
let missed: string[];
let queried: string[];
let ignored: Set<string>;
let errors: number;
let checks: number;
let running: number;
let peakChecks: number;
let watcher: TreeWatcher | null;

beforeEach(() => {
	root = mkdtempSync(join(tmpdir(), "trpi-tree-test-"));
	events = [];
	missed = [];
	queried = [];
	ignored = new Set();
	errors = 0;
	checks = 0;
	running = 0;
	peakChecks = 0;
	watcher = null;
});

afterEach(() => {
	watcher?.close();
	rmSync(root, { recursive: true, force: true });
});

function put(relPath: string, text = "x"): void {
	mkdirSync(dirname(join(root, relPath)), { recursive: true });
	writeFileSync(join(root, relPath), text);
}

async function start(
	skipDir: (relPath: string) => boolean = () => false,
	at: string = root,
): Promise<void> {
	watcher = watchTree(at, {
		onEvent: (path) => events.push(path),
		onMissed: (path) => missed.push(path),
		onError: () => {
			errors += 1;
		},
		skipDir,
		ignoredDirs: async (paths) => {
			queried.push(...paths);
			checks += 1;
			running += 1;
			peakChecks = Math.max(peakChecks, running);
			await sleep(10);
			running -= 1;
			return new Set(paths.filter((path) => ignored.has(path)));
		},
	});
	await watcher.ready;
	await sleep(100);
}

const seen = (path: string) => events.includes(path);
const seenUnder = (dir: string) => events.some((path) => path?.startsWith(`${dir}/`));

test("folders the ignore check reports and skipped folders get no watcher", async () => {
	put("src/app/main.ts");
	put("tmp/run/1/out.txt");
	put("cache/blob.bin");
	ignored.add("tmp");
	await start((path) => path === "cache");

	expect(queried).toContain("tmp");
	expect(queried).toContain("src/app");
	expect(queried).not.toContain("cache");
	expect(queried.some((path) => path.startsWith("tmp/"))).toBe(false);

	put("tmp/run/1/out.txt", "y");
	put("cache/blob.bin", "y");
	put("src/app/main.ts", "y");
	await waitFor(() => seen("src/app/main.ts"));
	await sleep(200);
	expect(seenUnder("tmp")).toBe(false);
	expect(seenUnder("cache")).toBe(false);
	expect(errors).toBe(0);
});

test("a folder created after the walk is watched and reports what it already holds", async () => {
	await start();
	put("fresh/deep/first.ts");
	await waitFor(() => seen("fresh/deep/first.ts"));
	await sleep(100);
	put("fresh/deep/second.ts");
	await waitFor(() => seen("fresh/deep/second.ts"));
});

test("an ignore recheck during the first walk wins over that walk's older answer", async () => {
	put("dist/x.js");
	let releaseFirst: () => void = () => {};
	const firstHeld = new Promise<void>((resolve) => {
		releaseFirst = resolve;
	});
	let calls = 0;
	watcher = watchTree(root, {
		onEvent: (path) => events.push(path),
		onMissed: () => {},
		onError: () => {
			errors += 1;
		},
		skipDir: () => false,
		ignoredDirs: async (paths) => {
			calls += 1;
			if (calls === 1) {
				await firstHeld;
				return new Set(paths.filter((path) => path === "dist"));
			}
			return new Set();
		},
	});
	await waitFor(() => calls === 1);
	watcher.recheck();
	await sleep(50);
	releaseFirst();
	await watcher.ready;
	await waitFor(() => calls >= 2);
	await sleep(100);
	put("dist/x.js", "y");
	await waitFor(() => seen("dist/x.js"));
	expect(errors).toBe(0);
});

test("a new folder the ignore check reports stays unwatched", async () => {
	ignored.add("build");
	await start();
	mkdirSync(join(root, "build"));
	await waitFor(() => queried.includes("build"));
	await sleep(100);
	put("build/out.js");
	await sleep(300);
	expect(seenUnder("build")).toBe(false);
});

test.if(process.platform === "linux")(
	"a burst of new folders runs one ignore check at a time",
	async () => {
		await start();
		checks = 0;
		peakChecks = 0;
		for (let index = 0; index < 200; index++) put(`d${index}/src/a.ts`);
		await waitFor(() => seen("d199/src/a.ts"));
		await sleep(300);
		expect(peakChecks).toBe(1);
		expect(checks).toBeLessThan(50);
		events.length = 0;
		put("d100/src/a.ts", "y");
		await waitFor(() => seen("d100/src/a.ts"));
	},
);

test("a folder deleted and recreated under the same path is watched again", async () => {
	put("src/old.ts");
	await start();
	rmSync(join(root, "src"), { recursive: true });
	mkdirSync(join(root, "src"));
	await sleep(300);
	events.length = 0;
	put("src/new.ts");
	await waitFor(() => seen("src/new.ts"));
});

test.if(process.platform === "linux")(
	"a folder moved away drops the watchers and skipped folders below it",
	async () => {
		put("src/app/old.ts");
		put("src/tmp/out.txt");
		ignored.add("src/tmp");
		await start();
		renameSync(join(root, "src"), join(root, "moved"));
		await waitFor(() => seen("src") && seen("moved/app/old.ts"));
		put("src/app/new.ts");
		await waitFor(() => seen("src/app/new.ts"));
		await sleep(100);
		events.length = 0;
		put("moved/app/old.ts", "y");
		put("src/app/new.ts", "y");
		await waitFor(() => seen("moved/app/old.ts") && seen("src/app/new.ts"));
		await sleep(100);
		expect(events.filter((path) => path === "src/app/old.ts")).toEqual([]);
		queried.length = 0;
		watcher?.recheck();
		await sleep(100);
		expect(queried).not.toContain("src/tmp");
	},
);

test.if(process.platform === "linux")(
	"deleting most of a large tree does not block the event loop",
	async () => {
		for (let top = 0; top < 240; top++) {
			for (let sub = 0; sub < 100; sub++)
				mkdirSync(join(root, `t${top}`, `s${sub}`), { recursive: true });
		}
		await start();
		let maxLag = 0;
		let last = performance.now();
		const timer = setInterval(() => {
			const now = performance.now();
			maxLag = Math.max(maxLag, now - last - 5);
			last = now;
		}, 5);
		const tops = Array.from({ length: 80 }, (_, top) => `t${top}`);
		await Bun.spawn(["rm", "-rf", ...tops], { cwd: root }).exited;
		await waitFor(() => tops.every(seen));
		await sleep(500);
		clearInterval(timer);
		expect(maxLag).toBeLessThan(1000);
	},
	30_000,
);

async function twoLiveTrees(innerRoot: string, move = false): Promise<void> {
	put("sub/.git/HEAD", "ref: refs/heads/main\n");
	mkdirSync(join(root, "sub", "p", "in"), { recursive: true });
	const outer: (string | null)[] = [];
	const inner: (string | null)[] = [];
	let hold: Promise<void> | null = null;
	let release = () => {};
	const tree = (at: string, seenBy: (string | null)[], gated: boolean) =>
		watchTree(at, {
			onEvent: (path) => seenBy.push(path),
			onMissed: () => {},
			onError: () => {
				errors += 1;
			},
			skipDir: (path) => path.split("/").includes(".git"),
			ignoredDirs: async () => {
				if (gated && hold) await hold;
				return new Set<string>();
			},
		});
	const outerTree = tree(root, outer, false);
	const innerTree = tree(innerRoot, inner, true);
	try {
		await Promise.all([outerTree.ready, innerTree.ready]);
		hold = new Promise((resolve) => {
			release = resolve;
		});
		mkdirSync(join(root, "sub", "busy"));
		await waitFor(() => inner.includes("busy"));
		if (move) renameSync(join(root, "sub", "p"), join(root, "sub", "p.old"));
		else rmSync(join(root, "sub", "p"), { recursive: true });
		put("sub/p/in/seed");
		await waitFor(() => outer.includes("sub/p/in/seed"));
		inner.length = 0;
		release();
		await waitFor(() => inner.includes("p/in/seed"));
		outer.length = 0;
		inner.length = 0;
		writeFileSync(join(root, "sub", "p", "in", "f.ts"), "x");
		await waitFor(() => outer.includes("sub/p/in/f.ts") && inner.includes("p/in/f.ts"));
		expect(errors).toBe(0);
	} finally {
		release();
		outerTree.close();
		innerTree.close();
	}
}

test.if(process.platform === "linux")(
	"two live trees on one folder both watch it again after it is deleted and recreated",
	() => twoLiveTrees(join(root, "sub")),
);

test.if(process.platform === "linux")(
	"two live trees on one folder both watch it again after it is moved away and made again",
	() => twoLiveTrees(join(root, "sub"), true),
);

test.if(process.platform === "linux")(
	"two live trees on one folder match when one root is reached through a symlink",
	async () => {
		mkdirSync(join(root, "sub"));
		symlinkSync(join(root, "sub"), join(root, "link"));
		await twoLiveTrees(join(root, "link"));
	},
);

test("a closed tree leaves nothing that keeps the process alive", async () => {
	for (let index = 0; index < 300; index++) mkdirSync(join(root, `d${index}`));
	const script = `
		const { watchTree } = await import(${JSON.stringify(join(import.meta.dir, "tree.ts"))});
		const tree = watchTree(${JSON.stringify(root)}, {
			onEvent: () => {},
			onMissed: () => {},
			onError: () => {},
			skipDir: () => false,
			ignoredDirs: async () => new Set(),
		});
		await tree.ready;
		tree.close();
	`;
	const child = Bun.spawn([process.execPath, "-e", script], {
		stdout: "ignore",
		stderr: "inherit",
	});
	const exited = await Promise.race([child.exited.then(() => true), sleep(5000).then(() => false)]);
	if (!exited) child.kill();
	expect(exited).toBe(true);
	expect(child.exitCode).toBe(0);
}, 10_000);

function refuseNextWatch(): () => void {
	const watch = fs.watch;
	let refused = false;
	const spy = spyOn(fs, "watch").mockImplementation(((...args: Parameters<typeof fs.watch>) => {
		if (refused) return watch(...args);
		refused = true;
		throw Object.assign(new Error("no space left"), { code: "ENOSPC" });
	}) as typeof fs.watch);
	return () => spy.mockRestore();
}

test("a watch refused with ENOSPC closes watchers still waiting to close and retries, else throws", async () => {
	for (let index = 0; index < 10; index++)
		mkdirSync(join(root, "old", `d${index}`), { recursive: true });
	mkdirSync(join(root, "new"));
	mkdirSync(join(root, "last"));
	await start(undefined, join(root, "old"));
	watcher?.close();
	const restore = refuseNextWatch();
	try {
		await start(undefined, join(root, "new"));
	} finally {
		restore();
	}
	put("new/a.ts");
	await waitFor(() => seen("a.ts"));
	expect(errors).toBe(0);
	watcher?.close();
	for (let turn = 0; turn < 10; turn++) await new Promise((resolve) => setImmediate(resolve));
	const restoreLast = refuseNextWatch();
	try {
		expect(() =>
			watchTree(join(root, "last"), {
				onEvent: () => {},
				onMissed: () => {},
				onError: () => {},
				skipDir: () => false,
				ignoredDirs: async () => new Set(),
			}),
		).toThrow("no space left");
	} finally {
		restoreLast();
	}
});

test.if(process.platform === "linux")(
	"a watch refused with ENOSPC closes at most a few batches of waiting watchers",
	async () => {
		for (let index = 0; index < 2000; index++) {
			mkdirSync(join(root, "old", `d${index}`), { recursive: true });
		}
		mkdirSync(join(root, "new"));
		await start(undefined, join(root, "old"));
		watcher?.close();
		watcher = null;
		const probe = fs.watch(root);
		const close = spyOn(Object.getPrototypeOf(probe), "close");
		probe.close();
		const refuse = spyOn(fs, "watch").mockImplementation(() => {
			throw Object.assign(new Error("no space left"), { code: "ENOSPC" });
		});
		try {
			expect(() =>
				watchTree(join(root, "new"), {
					onEvent: () => {},
					onMissed: () => {},
					onError: () => {},
					skipDir: () => false,
					ignoredDirs: async () => new Set(),
				}),
			).toThrow("no space left");
			expect(close.mock.calls.length - 1).toBeLessThanOrEqual(4 * 256);
		} finally {
			refuse.mockRestore();
			close.mockRestore();
		}
		for (let turn = 0; turn < 20; turn++) await new Promise((resolve) => setImmediate(resolve));
	},
);

test.if(process.platform === "linux")(
	"a write just before another tree opens the same folder still reaches the first tree",
	async () => {
		put("p/in/keep.ts");
		await start();
		events.length = 0;
		put("p/in/before.ts");
		const other = watchTree(join(root, "p", "in"), {
			onEvent: () => {},
			onMissed: () => {},
			onError: () => {},
			skipDir: () => false,
			ignoredDirs: async () => new Set(),
		});
		try {
			await waitFor(() => seen("p/in/before.ts") || missed.includes("p/in"));
		} finally {
			other.close();
		}
	},
);

test.if(process.platform === "linux")(
	"a folder made just before another tree opens its parent is watched by the first tree",
	async () => {
		mkdirSync(join(root, "p", "in"), { recursive: true });
		await start();
		mkdirSync(join(root, "p", "in", "new"));
		const other = watchTree(join(root, "p", "in"), {
			onEvent: () => {},
			onMissed: () => {},
			onError: () => {},
			skipDir: () => false,
			ignoredDirs: async () => new Set(),
		});
		try {
			await other.ready;
			await waitFor(() => missed.includes("p/in"));
			await sleep(200);
			put("p/in/new/f.ts");
			await waitFor(() => seen("p/in/new/f.ts"));
		} finally {
			other.close();
		}
	},
);

test.if(process.platform === "linux")(
	"a tree whose parent folder is moved away and made again inside another tree keeps a live watch",
	async () => {
		mkdirSync(join(root, "p", "in", "x"), { recursive: true });
		await start();
		const other = watchTree(join(root, "p", "in"), {
			onEvent: () => {},
			onMissed: () => {},
			onError: () => {},
			skipDir: () => false,
			ignoredDirs: async () => new Set(),
		});
		try {
			await other.ready;
			renameSync(join(root, "p"), join(root, "p.old"));
			mkdirSync(join(root, "p", "in", "x"), { recursive: true });
			await waitFor(() => seen("p/in/x"));
			await sleep(200);
			put("p/in/x/f.ts");
			await waitFor(() => seen("p/in/x/f.ts"));
		} finally {
			other.close();
		}
	},
);

test("folders below a nested repository are never sent to the ignore check", async () => {
	put("sub/.git/HEAD", "ref: refs/heads/main\n");
	put("sub/out/x.txt");
	put("top/y.txt");
	await start((path) => path.split("/").includes(".git"));

	expect(queried).toContain("sub");
	expect(queried).toContain("top");
	expect(queried.some((path) => path.startsWith("sub/"))).toBe(false);
	put("sub/out/x.txt", "y");
	await waitFor(() => seen("sub/out/x.txt"));
});

test("a repository created after the walk keeps its folders out of the ignore check", async () => {
	put("sub/out/x.txt");
	ignored.add("sub/out");
	await start((path) => path.split("/").includes(".git"));
	expect(queried).toContain("sub/out");
	queried.length = 0;
	put("sub/.git/HEAD", "ref: refs/heads/main\n");
	await waitFor(() => seen("sub/.git"));
	watcher?.recheck();
	await waitFor(() => seen("sub/out/x.txt"));
	put("sub/new/y.txt");
	await waitFor(() => seen("sub/new/y.txt"));
	expect(queried.some((path) => path.startsWith("sub/"))).toBe(false);
});

test.if(process.platform === "linux")(
	"a new folder that arrives with a .gitignore edit is still watched",
	async () => {
		await start();
		put("a/x.ts");
		put("fresh/y.ts");
		put(".gitignore", "dist/\n");
		await waitFor(() => seen("fresh/y.ts"));
		events.length = 0;
		put("fresh/y.ts", "z");
		await waitFor(() => seen("fresh/y.ts"));
	},
);

test.if(process.platform === "linux")(
	"a .gitignore edit re-checks folders skipped as ignored",
	async () => {
		put("tmp/run/out.txt");
		ignored.add("tmp");
		await start();
		ignored.clear();
		queried.length = 0;
		put(".gitignore", "dist/\n");
		await waitFor(() => seen("tmp/run/out.txt"));
		expect(queried).toContain("tmp");
		events.length = 0;
		put("tmp/run/out.txt", "y");
		await waitFor(() => seen("tmp/run/out.txt"));
	},
);

test("a deleted ignored folder is not re-checked", async () => {
	put("run-1/out.txt");
	ignored.add("run-1");
	await start();
	rmSync(join(root, "run-1"), { recursive: true });
	await waitFor(() => seen("run-1"));
	await sleep(100);
	queried.length = 0;
	watcher?.recheck();
	await sleep(100);
	expect(queried).toEqual([]);
});

test("a symlinked root is followed", async () => {
	put("real/src/a.ts");
	symlinkSync(join(root, "real"), join(root, "link"));
	await start(undefined, join(root, "link"));
	put("real/src/a.ts", "y");
	await waitFor(() => seen("src/a.ts"));
});

test("an unwatchable root throws", () => {
	expect(() =>
		watchTree(join(root, "missing"), {
			onEvent: () => {},
			onMissed: () => {},
			onError: () => {},
			skipDir: () => false,
			ignoredDirs: async () => new Set(),
		}),
	).toThrow();
});
