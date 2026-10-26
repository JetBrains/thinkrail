import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import {
	constants,
	mkdirSync,
	mkdtempSync,
	realpathSync,
	rmSync,
	symlinkSync,
	writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { readDir, readFile, resolveWorktreeFile } from "./files";

/**
 * Regression tests for Finding-3: TOCTOU Symlink Race in Path Traversal Guard
 *
 * These tests exercise the PRODUCTION code (readFile, readDir, resolveWorktreeFile)
 * against real filesystem symlinks. They follow the same test-harness pattern as
 * files.test.ts: set THINKRAIL_DATA_DIR, write a workspaces.json, and call the
 * actual exported functions.
 *
 * The two-layer defense is:
 *   Layer 1 (resolveInWorktree): realpathSync re-resolution + containment re-check
 *   Layer 2 (readFile):          openSync(O_NOFOLLOW) + readFileSync(fd)
 */

let dataDir: string;
let root: string;
let outsideDir: string;
const savedDataDir = process.env.THINKRAIL_DATA_DIR;

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

	writeFileSync(
		join(dataDir, "workspaces.json"),
		JSON.stringify([
			{ id: "w1", projectId: "p1", name: "w1", worktreePath: root, createdAt: 1 },
		]),
	);
});

afterEach(() => {
	rmSync(dataDir, { recursive: true, force: true });
	if (savedDataDir === undefined) delete process.env.THINKRAIL_DATA_DIR;
	else process.env.THINKRAIL_DATA_DIR = savedDataDir;
});

describe("Production readFile: TOCTOU symlink protection", () => {
	test("reads regular files inside the worktree", () => {
		const result = readFile("w1", "safe.txt");
		expect(result.content).toBe("safe content\n");
		expect(result.meta.text).toBe(true);
	});

	test("reads nested files inside the worktree", () => {
		const result = readFile("w1", "subdir/nested.txt");
		expect(result.content).toBe("nested content\n");
	});

	test("blocks symlinks pointing outside the worktree", () => {
		symlinkSync(join(outsideDir, "secret.txt"), join(root, "evil-link"));
		expect(() => readFile("w1", "evil-link")).toThrow(/Path escapes the worktree/);
	});

	test("blocks ../ path traversal", () => {
		expect(() => readFile("w1", "../outside/secret.txt")).toThrow(
			/Path escapes the worktree/,
		);
	});

	test("blocks symlink directories pointing outside the worktree", () => {
		symlinkSync(outsideDir, join(root, "outside-link"));
		expect(() => readFile("w1", "outside-link/secret.txt")).toThrow(
			/Path escapes the worktree/,
		);
	});

	test("allows internal symlinks within the worktree", () => {
		symlinkSync(join(root, "safe.txt"), join(root, "internal-link"));
		// O_NOFOLLOW at the leaf will block even internal symlinks — this is
		// a defense-in-depth tradeoff. The realpathSync pass resolves the
		// symlink first, so the fd is opened on the resolved path (no symlink).
		const result = readFile("w1", "internal-link");
		expect(result.content).toBe("safe content\n");
	});
});

describe("Production readDir: symlink-root regression", () => {
	test("produces valid relative paths when root is NOT a symlink", () => {
		const entries = readDir("w1", ".");
		const paths = entries.map((e) => e.path);
		// Should contain "safe.txt" and "subdir" with forward-slash relative paths
		expect(paths).toContain("safe.txt");
		expect(paths).toContain("subdir");
		// No path should start with ..
		for (const p of paths) {
			expect(p.startsWith("..")).toBe(false);
		}
	});

	test("produces valid relative paths when root IS a symlink", () => {
		// Create a symlink to the worktree and register it as a workspace
		const symlinkRoot = join(dataDir, "symlink-worktree");
		symlinkSync(root, symlinkRoot);

		writeFileSync(
			join(dataDir, "workspaces.json"),
			JSON.stringify([
				{ id: "w2", projectId: "p2", name: "w2", worktreePath: symlinkRoot, createdAt: 2 },
			]),
		);

		const entries = readDir("w2", ".");
		const paths = entries.map((e) => e.path);

		// Paths must be valid worktree-relative, not escaped via ../
		expect(paths).toContain("safe.txt");
		expect(paths).toContain("subdir");
		for (const p of paths) {
			expect(p.startsWith("..")).toBe(false);
		}
	});

	test("nested readDir through symlink-root also produces valid paths", () => {
		const symlinkRoot = join(dataDir, "symlink-worktree");
		symlinkSync(root, symlinkRoot);

		writeFileSync(
			join(dataDir, "workspaces.json"),
			JSON.stringify([
				{ id: "w2", projectId: "p2", name: "w2", worktreePath: symlinkRoot, createdAt: 2 },
			]),
		);

		const entries = readDir("w2", "subdir");
		const paths = entries.map((e) => e.path);

		expect(paths).toContain("subdir/nested.txt");
		for (const p of paths) {
			expect(p.startsWith("..")).toBe(false);
		}
	});
});

describe("Production resolveWorktreeFile: symlink protection", () => {
	test("resolves regular files to their real path", () => {
		const resolved = resolveWorktreeFile("w1", "safe.txt");
		expect(resolved).toBe(realpathSync(join(root, "safe.txt")));
	});

	test("blocks symlinks pointing outside the worktree", () => {
		symlinkSync(join(outsideDir, "secret.txt"), join(root, "evil-link"));
		expect(() => resolveWorktreeFile("w1", "evil-link")).toThrow(
			/Path escapes the worktree/,
		);
	});

	test("blocks path traversal", () => {
		expect(() => resolveWorktreeFile("w1", "../../etc/passwd")).toThrow(
			/Path escapes the worktree/,
		);
	});
});

describe("O_NOFOLLOW kernel-level defense (Layer 2)", () => {
	test("O_NOFOLLOW is available on this platform", () => {
		// This test documents whether O_NOFOLLOW is available.
		// On Linux/macOS it should be a positive integer.
		// On Windows it is undefined (Layer 1 is the defense).
		const noFollow = constants.O_NOFOLLOW;
		if (process.platform === "win32") {
			expect(noFollow).toBeUndefined();
		} else {
			expect(typeof noFollow).toBe("number");
			expect(noFollow).toBeGreaterThan(0);
		}
	});
});
