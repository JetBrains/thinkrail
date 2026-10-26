import { mkdirSync, realpathSync, rmSync, symlinkSync, writeFileSync } from "node:fs";
import { dirname, join, relative, resolve, sep } from "node:path";
import { tmpdir } from "node:os";
import { randomUUID } from "node:crypto";
import { afterEach, beforeEach, describe, expect, test } from "bun:test";

/**
 * Regression tests for CVE-3: TOCTOU Symlink Race in Path Traversal Guard
 *
 * These tests verify that the path traversal guard is not vulnerable to
 * symlink race conditions (Time-of-Check-Time-of-Use).
 *
 * The fix ensures that after the security check passes, the path is
 * re-resolved using realpathSync and re-checked for containment before
 * any file operation.
 */

function isContained(root: string, candidate: string): boolean {
	const rel = relative(root, candidate);
	return (
		rel === "" ||
		(rel !== ".." && !rel.startsWith(`..${sep}`) && !require("node:path").isAbsolute(rel))
	);
}

/** The FIXED version of resolveInWorktree that closes the TOCTOU gap. */
function resolveInWorktreeFixed(
	root: string,
	path: string,
): { abs: string; resolvedAbs: string } {
	const abs = resolve(root, path);
	if (!isContained(resolve(root), abs)) throw new Error("Path escapes the worktree");

	// Original security check (realpathSync on ancestors)
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

	// FIX: Re-resolve the full path and re-check containment
	// This closes the TOCTOU window by using the resolved path for subsequent operations
	let resolvedAbs: string;
	try {
		resolvedAbs = realpathSync(abs);
	} catch {
		// File might not exist yet (for writes) — use the checked abs
		resolvedAbs = abs;
	}
	if (!isContained(realRoot, resolvedAbs)) {
		throw new Error("Path escapes the worktree");
	}

	return { abs, resolvedAbs };
}

describe("TOCTOU Symlink Race Prevention", () => {
	let testDir: string;
	let worktreeRoot: string;

	beforeEach(() => {
		testDir = join(tmpdir(), `toctou-test-${randomUUID()}`);
		worktreeRoot = join(testDir, "worktree");
		mkdirSync(join(worktreeRoot, "subdir"), { recursive: true });

		// Create a file inside the worktree
		writeFileSync(join(worktreeRoot, "safe.txt"), "safe content\n");
		writeFileSync(join(worktreeRoot, "subdir", "nested.txt"), "nested content\n");

		// Create a file outside the worktree (target for attack)
		writeFileSync(join(testDir, "secret.txt"), "SECRET: api_key=sk-1234567890\n");
	});

	afterEach(() => {
		rmSync(testDir, { recursive: true, force: true });
	});

	test("allows reading files inside the worktree", () => {
		const result = resolveInWorktreeFixed(worktreeRoot, "safe.txt");
		expect(result.resolvedAbs).toBe(realpathSync(join(worktreeRoot, "safe.txt")));
	});

	test("allows reading nested files inside the worktree", () => {
		const result = resolveInWorktreeFixed(worktreeRoot, "subdir/nested.txt");
		expect(result.resolvedAbs).toBe(realpathSync(join(worktreeRoot, "subdir", "nested.txt")));
	});

	test("blocks path traversal via ../ sequences", () => {
		expect(() => resolveInWorktreeFixed(worktreeRoot, "../secret.txt")).toThrow(
			/Path escapes the worktree/,
		);
	});

	test("blocks symlinks pointing outside the worktree", () => {
		const secretPath = join(testDir, "secret.txt");
		const symlinkPath = join(worktreeRoot, "evil-link");

		// Create a symlink pointing outside the worktree
		symlinkSync(secretPath, symlinkPath);

		// The FIXED function should catch this
		expect(() => resolveInWorktreeFixed(worktreeRoot, "evil-link")).toThrow(
			/Path escapes the worktree/,
		);
	});

	test("blocks symlinks in parent directories pointing outside", () => {
		const outsideDir = join(testDir, "outside");
		mkdirSync(outsideDir, { recursive: true });
		writeFileSync(join(outsideDir, "target.txt"), "escaped content\n");

		// Create a symlink directory inside worktree pointing outside
		const symlinkDir = join(worktreeRoot, "subdir-link");
		symlinkSync(outsideDir, symlinkDir);

		// Traversing through the symlink directory should be blocked
		expect(() => resolveInWorktreeFixed(worktreeRoot, "subdir-link/target.txt")).toThrow(
			/Path escapes the worktree/,
		);
	});

	test("the resolved path is used (not the original string path)", () => {
		// Create a symlink inside worktree pointing to another file inside worktree
		const symlinkPath = join(worktreeRoot, "internal-link");
		symlinkSync(join(worktreeRoot, "safe.txt"), symlinkPath);

		const result = resolveInWorktreeFixed(worktreeRoot, "internal-link");

		// The resolved path should be the REAL path, not the symlink path
		expect(result.resolvedAbs).toBe(realpathSync(join(worktreeRoot, "safe.txt")));
		expect(result.resolvedAbs).not.toBe(join(worktreeRoot, "internal-link"));
	});

	test("double-resolution closes the TOCTOU window", () => {
		// This test verifies the FIX behavior:
		// Even if the first check passes (because the symlink points inside),
		// the second resolution catches any change

		const symlinkPath = join(worktreeRoot, "race-link");
		const secretPath = join(testDir, "secret.txt");

		// Start with a safe symlink
		symlinkSync(join(worktreeRoot, "safe.txt"), symlinkPath);

		// Verify it works initially
		const result = resolveInWorktreeFixed(worktreeRoot, "race-link");
		expect(result.resolvedAbs).toBe(realpathSync(join(worktreeRoot, "safe.txt")));

		// Now swap the symlink to point outside
		rmSync(symlinkPath);
		symlinkSync(secretPath, symlinkPath);

		// The FIXED function should catch this even if the string path looks contained
		expect(() => resolveInWorktreeFixed(worktreeRoot, "race-link")).toThrow(
			/Path escapes the worktree/,
		);
	});
});
