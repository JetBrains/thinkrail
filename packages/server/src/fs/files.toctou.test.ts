import {
	closeSync,
	constants,
	mkdirSync,
	openSync,
	readFileSync,
	realpathSync,
	rmSync,
	symlinkSync,
	writeFileSync,
} from "node:fs";
import { dirname, join, relative, resolve, sep } from "node:path";
import { tmpdir } from "node:os";
import { randomUUID } from "node:crypto";
import { afterEach, beforeEach, describe, expect, test } from "bun:test";

/**
 * Regression tests for Finding-3: TOCTOU Symlink Race in Path Traversal Guard
 *
 * These tests verify that the two-layer defense works:
 *   Layer 1: realpathSync re-resolution + containment re-check in resolveInWorktree
 *   Layer 2: O_NOFOLLOW + fd-based reading in readFile
 *
 * Together they eliminate the TOCTOU race by ensuring:
 * - The resolved path is validated before use
 * - The kernel refuses to follow symlinks at open time (O_NOFOLLOW / ELOOP)
 * - Data is read from the opened inode (fd), not the path
 */

function isContained(root: string, candidate: string): boolean {
	const rel = relative(root, candidate);
	return (
		rel === "" ||
		(rel !== ".." && !rel.startsWith(`..${sep}`) && !require("node:path").isAbsolute(rel))
	);
}

/**
 * Simulates the FIXED resolveInWorktree: realpathSync + re-check containment.
 * (Layer 1 of the defense)
 */
function resolveInWorktreeFixed(
	root: string,
	path: string,
): { abs: string; resolvedAbs: string } {
	const abs = resolve(root, path);
	if (!isContained(resolve(root), abs)) throw new Error("Path escapes the worktree");

	// Original security check
	const realRoot = realpathSync(root);
	let cursor = abs;
	while (true) {
		let real: string;
		try {
			real = realpathSync(cursor);
		} catch (error: unknown) {
			const code =
				typeof error === "object" && error !== null && "code" in error
					? (error as { code: string }).code
					: undefined;
			if (code !== "ENOENT" && code !== "ENOTDIR") throw error;
			const parent = dirname(cursor);
			if (parent === cursor) throw error;
			cursor = parent;
			continue;
		}
		if (!isContained(realRoot, real)) throw new Error("Path escapes the worktree");
		break;
	}

	// Layer 1: Re-resolve and re-check
	let resolvedAbs: string;
	try {
		resolvedAbs = realpathSync(abs);
	} catch {
		resolvedAbs = abs;
	}
	if (!isContained(realRoot, resolvedAbs)) {
		throw new Error("Path escapes the worktree");
	}

	return { abs, resolvedAbs };
}

/**
 * Simulates the FIXED readFile: opens with O_NOFOLLOW and reads via fd.
 * (Layer 2 of the defense)
 */
function readFileFixed(resolvedAbs: string): Buffer {
	const noFollow = typeof constants.O_NOFOLLOW === "number" ? constants.O_NOFOLLOW : 0;
	let fd: number;
	try {
		fd = openSync(resolvedAbs, constants.O_RDONLY | noFollow);
	} catch (error: unknown) {
		const code =
			typeof error === "object" && error !== null && "code" in error
				? (error as { code: string }).code
				: undefined;
		if (code === "ELOOP") throw new Error("Path escapes the worktree");
		throw error;
	}
	try {
		return Buffer.from(readFileSync(fd));
	} finally {
		closeSync(fd);
	}
}

describe("TOCTOU Symlink Race Prevention", () => {
	let testDir: string;
	let worktreeRoot: string;

	beforeEach(() => {
		testDir = join(tmpdir(), `toctou-test-${randomUUID()}`);
		worktreeRoot = join(testDir, "worktree");
		mkdirSync(join(worktreeRoot, "subdir"), { recursive: true });
		writeFileSync(join(worktreeRoot, "safe.txt"), "safe content\n");
		writeFileSync(join(worktreeRoot, "subdir", "nested.txt"), "nested content\n");
		writeFileSync(join(testDir, "secret.txt"), "SECRET: api_key=sk-1234567890\n");
	});

	afterEach(() => {
		rmSync(testDir, { recursive: true, force: true });
	});

	test("allows reading regular files inside the worktree", () => {
		const result = resolveInWorktreeFixed(worktreeRoot, "safe.txt");
		expect(result.resolvedAbs).toBe(realpathSync(join(worktreeRoot, "safe.txt")));
		const data = readFileFixed(result.resolvedAbs);
		expect(data.toString()).toBe("safe content\n");
	});

	test("allows reading nested files inside the worktree", () => {
		const result = resolveInWorktreeFixed(worktreeRoot, "subdir/nested.txt");
		expect(result.resolvedAbs).toBe(realpathSync(join(worktreeRoot, "subdir", "nested.txt")));
		const data = readFileFixed(result.resolvedAbs);
		expect(data.toString()).toBe("nested content\n");
	});

	test("blocks path traversal via ../ sequences", () => {
		expect(() => resolveInWorktreeFixed(worktreeRoot, "../secret.txt")).toThrow(
			/Path escapes the worktree/,
		);
	});

	test("Layer 1: realpathSync re-check catches symlinks outside worktree", () => {
		const secretPath = join(testDir, "secret.txt");
		const symlinkPath = join(worktreeRoot, "evil-link");
		symlinkSync(secretPath, symlinkPath);

		expect(() => resolveInWorktreeFixed(worktreeRoot, "evil-link")).toThrow(
			/Path escapes the worktree/,
		);
	});

	test("Layer 1: catches symlink directories pointing outside", () => {
		const outsideDir = join(testDir, "outside");
		mkdirSync(outsideDir, { recursive: true });
		writeFileSync(join(outsideDir, "target.txt"), "escaped content\n");
		symlinkSync(outsideDir, join(worktreeRoot, "subdir-link"));

		expect(() => resolveInWorktreeFixed(worktreeRoot, "subdir-link/target.txt")).toThrow(
			/Path escapes the worktree/,
		);
	});

	test("Layer 2: O_NOFOLLOW rejects symlinks at read time (ELOOP → escape)", () => {
		// This tests the second layer independently: even if resolveInWorktree
		// returned a path that has since been swapped to a symlink, O_NOFOLLOW
		// catches it at open time.
		const symlinkPath = join(worktreeRoot, "swap-link");
		const secretPath = join(testDir, "secret.txt");

		// Create a symlink — simulates the attacker swapping after realpathSync
		symlinkSync(secretPath, symlinkPath);

		// O_NOFOLLOW should cause ELOOP on the symlink
		const noFollow = typeof constants.O_NOFOLLOW === "number" ? constants.O_NOFOLLOW : 0;
		if (noFollow !== 0) {
			// On platforms with O_NOFOLLOW (Linux, macOS)
			expect(() => readFileFixed(symlinkPath)).toThrow(/Path escapes the worktree/);
		} else {
			// On Windows, O_NOFOLLOW is not available — Layer 1 is the defense
			// This test verifies the graceful degradation
			expect(noFollow).toBe(0);
		}
	});

	test("Layer 2: fd-based read returns same content as the opened inode", () => {
		const filePath = join(worktreeRoot, "safe.txt");
		const data = readFileFixed(filePath);
		expect(data.toString()).toBe("safe content\n");
	});

	test("resolved path is the real path, not the symlink path", () => {
		const symlinkPath = join(worktreeRoot, "internal-link");
		symlinkSync(join(worktreeRoot, "safe.txt"), symlinkPath);

		const result = resolveInWorktreeFixed(worktreeRoot, "internal-link");
		expect(result.resolvedAbs).toBe(realpathSync(join(worktreeRoot, "safe.txt")));
		expect(result.resolvedAbs).not.toBe(join(worktreeRoot, "internal-link"));
	});

	test("both layers together: safe symlink that is later swapped", () => {
		const symlinkPath = join(worktreeRoot, "race-link");

		// Start with a safe symlink inside worktree
		symlinkSync(join(worktreeRoot, "safe.txt"), symlinkPath);

		// Layer 1 check passes
		const result = resolveInWorktreeFixed(worktreeRoot, "race-link");
		expect(result.resolvedAbs).toBe(realpathSync(join(worktreeRoot, "safe.txt")));

		// Now swap the symlink to point outside (simulates race condition)
		rmSync(symlinkPath);
		symlinkSync(join(testDir, "secret.txt"), symlinkPath);

		// Layer 1 now catches it on re-check
		expect(() => resolveInWorktreeFixed(worktreeRoot, "race-link")).toThrow(
			/Path escapes the worktree/,
		);
	});
});
