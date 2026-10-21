import { afterEach, beforeEach, expect, test } from "bun:test";
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

test("ignoredPaths splits long listings and reports nothing outside a repository", async () => {
	const dir = repo();
	const many = Array.from({ length: 1500 }, (_, index) => `src/${"n".repeat(20)}-${index}.log`);
	expect((await ignoredPaths(dir, many)).size).toBe(1500);
	const plain = join(root, "plain");
	mkdirSync(plain);
	expect(await ignoredPaths(plain, ["a.log"])).toEqual(new Set());
});
