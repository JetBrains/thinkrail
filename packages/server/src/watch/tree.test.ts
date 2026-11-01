import { afterEach, beforeEach, expect, test } from "bun:test";
import { mkdirSync, mkdtempSync, rmSync, symlinkSync, writeFileSync } from "node:fs";
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
let queried: string[];
let ignored: Set<string>;
let errors: number;
let watcher: TreeWatcher | null;

beforeEach(() => {
	root = mkdtempSync(join(tmpdir(), "trpi-tree-test-"));
	events = [];
	queried = [];
	ignored = new Set();
	errors = 0;
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
		onError: () => {
			errors += 1;
		},
		skipDir,
		ignoredDirs: async (paths) => {
			queried.push(...paths);
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

test("a .gitignore edit re-checks folders skipped as ignored", async () => {
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
});

test("a deleted ignored folder is not re-checked", async () => {
	put("run-1/out.txt");
	ignored.add("run-1");
	await start();
	rmSync(join(root, "run-1"), { recursive: true });
	await waitFor(() => seen("run-1"));
	await sleep(100);
	queried.length = 0;
	watcher?.recheck();
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
			onError: () => {},
			skipDir: () => false,
			ignoredDirs: async () => new Set(),
		}),
	).toThrow();
});
