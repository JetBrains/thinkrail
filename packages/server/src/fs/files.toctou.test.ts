import { afterEach, beforeEach, expect, test } from "bun:test";
import { mkdirSync, mkdtempSync, realpathSync, rmSync, symlinkSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { readDir, readFile, resolveWorktreeFile } from "./files";

const symlinkTest = test.skipIf(process.platform === "win32");

let dataDir: string;
let root: string;
let outsideDir: string;
const savedDataDir = process.env.THINKRAIL_DATA_DIR;

function registerWorkspace(id: string, worktreePath: string): void {
	writeFileSync(
		join(dataDir, "workspaces.json"),
		JSON.stringify([{ id, projectId: "p1", name: id, worktreePath, createdAt: 1 }]),
	);
}

beforeEach(() => {
	dataDir = mkdtempSync(join(tmpdir(), "trpi-toctou-test-"));
	process.env.THINKRAIL_DATA_DIR = dataDir;
	root = join(dataDir, "worktree");
	outsideDir = join(dataDir, "outside");
	mkdirSync(join(root, "subdir"), { recursive: true });
	mkdirSync(outsideDir, { recursive: true });
	writeFileSync(join(root, "safe.txt"), "safe content\n");
	writeFileSync(join(root, "subdir", "nested.txt"), "nested content\n");
	writeFileSync(join(outsideDir, "secret.txt"), "SECRET_API_KEY=sk-1234567890\n");
	registerWorkspace("w1", root);
});

afterEach(() => {
	rmSync(dataDir, { recursive: true, force: true });
	if (savedDataDir === undefined) delete process.env.THINKRAIL_DATA_DIR;
	else process.env.THINKRAIL_DATA_DIR = savedDataDir;
});

symlinkTest("readFile refuses a leaf symlink or a symlinked directory leaving the worktree", () => {
	symlinkSync(join(outsideDir, "secret.txt"), join(root, "evil-link"));
	symlinkSync(outsideDir, join(root, "outside-link"));
	expect(() => readFile("w1", "evil-link")).toThrow(/Path escapes the worktree/);
	expect(() => readFile("w1", "outside-link/secret.txt")).toThrow(/Path escapes the worktree/);
	expect(() => readFile("w1", "../outside/secret.txt")).toThrow(/Path escapes the worktree/);
});

symlinkTest("readFile still reads an in-worktree symlink through its resolved target", () => {
	symlinkSync(join(root, "safe.txt"), join(root, "internal-link"));
	expect(readFile("w1", "internal-link").content).toBe("safe content\n");
	expect(readFile("w1", "internal-link", { maxBytes: 64 }).content).toBe("safe content\n");
});

symlinkTest("a workspace whose root is a symlink keeps worktree-relative node paths", () => {
	const symlinkRoot = join(dataDir, "symlink-worktree");
	symlinkSync(root, symlinkRoot);
	registerWorkspace("w2", symlinkRoot);
	expect(readDir("w2", ".").map((node) => node.path)).toEqual(["subdir", "safe.txt"]);
	expect(readDir("w2", "subdir").map((node) => node.path)).toEqual(["subdir/nested.txt"]);
	expect(readFile("w2", "subdir/nested.txt").content).toBe("nested content\n");
});

symlinkTest("resolveWorktreeFile answers the canonical path and refuses an escape", () => {
	symlinkSync(join(outsideDir, "secret.txt"), join(root, "evil-link"));
	expect(resolveWorktreeFile("w1", "safe.txt")).toBe(realpathSync(join(root, "safe.txt")));
	expect(() => resolveWorktreeFile("w1", "evil-link")).toThrow(/Path escapes the worktree/);
	expect(() => resolveWorktreeFile("w1", "../../etc/passwd")).toThrow(/Path escapes the worktree/);
});
