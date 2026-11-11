import { afterEach, beforeEach, expect, spyOn, test } from "bun:test";
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { ignoredPaths } from "./ignored";

let root: string;

beforeEach(() => {
	root = mkdtempSync(join(tmpdir(), "trpi-ignored-test-"));
});

afterEach(() => {
	rmSync(root, { recursive: true, force: true });
});

function repo(): string {
	const dir = join(root, "repo");
	mkdirSync(join(dir, "dist", "sub"), { recursive: true });
	mkdirSync(join(dir, "src"), { recursive: true });
	writeFileSync(join(dir, ".gitignore"), "dist/\n*.log\n");
	writeFileSync(join(dir, "dist", "sub", "a.js"), "");
	writeFileSync(join(dir, "src", "x.log"), "");
	writeFileSync(join(dir, "src", "y.ts"), "");
	const init = Bun.spawnSync(["git", "init", "-q", dir]);
	if (!init.success) throw new Error("git init failed");
	return dir;
}

test("ignoredPaths reports ignored folders, files and everything inside an ignored folder", async () => {
	const dir = repo();
	const ignored = await ignoredPaths(dir, [
		"dist",
		"src",
		"src/x.log",
		"src/y.ts",
		"dist/sub/a.js",
	]);
	expect([...ignored].sort()).toEqual(["dist", "dist/sub/a.js", "src/x.log"]);
	expect(await ignoredPaths(dir, ["src", "src/y.ts"])).toEqual(new Set());
});

test("ignoredPaths checks a wide batch in one git process when few paths match a rule", async () => {
	const dir = repo();
	const spawn = Bun.spawn;
	let runs = 0;
	let running = 0;
	let peak = 0;
	const spy = spyOn(Bun, "spawn").mockImplementation(((...args: Parameters<typeof Bun.spawn>) => {
		const proc = spawn(...args);
		runs += 1;
		running += 1;
		peak = Math.max(peak, running);
		void proc.exited.then(() => {
			running -= 1;
		});
		return proc;
	}) as typeof Bun.spawn);
	try {
		const many = Array.from(
			{ length: 3000 },
			(_, index) => `src/${"n".repeat(50)}-${index}.${index % 300 === 0 ? "log" : "ts"}`,
		);
		expect((await ignoredPaths(dir, many)).size).toBe(10);
	} finally {
		spy.mockRestore();
	}
	expect(runs).toBe(2);
	expect(peak).toBe(1);
});

test("ignoredPaths reports every match when the matches need several git runs", async () => {
	const dir = repo();
	const many = Array.from({ length: 1500 }, (_, index) => `src/${"n".repeat(20)}-${index}.log`);
	expect((await ignoredPaths(dir, many)).size).toBe(1500);
});

test("ignoredPaths reads a .gitignore that a sparse checkout keeps only in the index", async () => {
	const run = (cwd: string, ...args: string[]) => {
		const result = Bun.spawnSync(["git", "-C", cwd, ...args]);
		if (!result.success) throw new Error(result.stderr.toString());
	};
	const main = join(root, "sparse");
	const linked = join(root, "sparse-linked");
	mkdirSync(join(main, "packages", "a"), { recursive: true });
	mkdirSync(join(main, "packages", "b", "src"), { recursive: true });
	writeFileSync(join(main, "packages", "a", "x"), "");
	writeFileSync(join(main, "packages", "b", "src", "y"), "");
	writeFileSync(join(main, "packages", "b", ".gitignore"), "dist/\n");
	run(root, "init", "-q", main);
	run(main, "add", "-A");
	run(
		main,
		"-c",
		"user.email=t@t",
		"-c",
		"user.name=t",
		"-c",
		"commit.gpgsign=false",
		"commit",
		"-qm",
		"i",
	);
	run(main, "worktree", "add", "-q", linked);
	writeFileSync(join(linked, ".git"), "gitdir: ../sparse/.git/worktrees/sparse-linked\n");
	for (const tree of [linked, main]) {
		run(tree, "sparse-checkout", "set", "packages/a");
		mkdirSync(join(tree, "packages", "b", "dist"), { recursive: true });
		expect([...(await ignoredPaths(tree, ["packages/b/dist", "packages/a"]))]).toEqual([
			"packages/b/dist",
		]);
	}
});

test("ignoredPaths reports nothing outside a repository", async () => {
	const plain = join(root, "plain");
	mkdirSync(plain);
	expect(await ignoredPaths(plain, ["a.log"])).toEqual(new Set());
});

test("ignoredPaths does not report a folder that holds a tracked file", async () => {
	const dir = repo();
	writeFileSync(join(dir, "dist", "keep.js"), "");
	const add = Bun.spawnSync(["git", "-C", dir, "add", "-f", "dist/keep.js"]);
	if (!add.success) throw new Error("git add failed");
	const ignored = await ignoredPaths(dir, ["dist", "dist/keep.js", "dist/sub"]);
	expect([...ignored]).toEqual(["dist/sub"]);
});

test.skipIf(process.platform === "win32")(
	"ignoredPaths reads a name like pathspec magic as a plain path",
	async () => {
		const dir = repo();
		for (const name of [":!x", ":(glob)y"]) mkdirSync(join(dir, name));
		writeFileSync(join(dir, ".gitignore"), "dist/\n:!x/\n");
		const ignored = await ignoredPaths(dir, [":!x", ":(glob)y", "dist", "src"]);
		expect([...ignored].sort()).toEqual([":!x", "dist"]);
	},
);

test("a path git refuses fails only its own batch of the index check", async () => {
	const dir = repo();
	const gitlink = Bun.spawnSync([
		"git",
		"-C",
		dir,
		"update-index",
		"--add",
		"--cacheinfo",
		`160000,${"1".repeat(40)},sub`,
	]);
	if (!gitlink.success) throw new Error("git update-index failed");
	const paths = [
		"sub/inside.log",
		...Array.from({ length: 1_500 }, (_, index) => `src/file-${index}.log`),
		"src/last.log",
	];
	const ignored = await ignoredPaths(dir, paths);
	expect(ignored.has("sub/inside.log")).toBe(false);
	expect(ignored.has("src/file-0.log")).toBe(false);
	expect(ignored.has("src/last.log")).toBe(true);
});

for (const [label, path] of [
	["quote", 'src/a"b.log'],
	["tab", "src/a\tb.log"],
	["newline", "src/a\nb.log"],
	["backslash", "src/a\\b.log"],
	["control character", "src/a\u0001b.log"],
	["non-ASCII", "src/ä·日本.log"],
	["pathspec magic", ":(glob)literal.log"],
] as const) {
	test(`ignoredPaths preserves a literal filename containing ${label}`, async () => {
		const dir = repo();
		expect(await ignoredPaths(dir, [path, "src/y.ts"])).toEqual(new Set([path]));
	});
}
