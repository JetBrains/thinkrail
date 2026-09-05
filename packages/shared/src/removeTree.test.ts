import { expect, test } from "bun:test";
import { existsSync, mkdirSync, mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { removeTree, removeTreeAfter } from "./removeTree";

function failing(
	code: string,
	until: number,
): { remove: (path: string) => void; calls: () => number } {
	let calls = 0;
	return {
		remove: () => {
			calls += 1;
			if (calls < until) throw Object.assign(new Error(`${code}: simulated`), { code });
		},
		calls: () => calls,
	};
}

test("removes a nested tree and tolerates a missing path", () => {
	const root = mkdtempSync(join(tmpdir(), "thinkrail-remove-tree-"));
	mkdirSync(join(root, "nested", "deeper"), { recursive: true });
	writeFileSync(join(root, "nested", "deeper", "file.txt"), "content");

	removeTree(root);
	expect(existsSync(root)).toBe(false);

	removeTree(root);
	expect(existsSync(root)).toBe(false);
});

test("retries a locked tree until the removal succeeds", () => {
	const attempt = failing("EBUSY", 3);

	removeTree("/does-not-matter", { remove: attempt.remove, delayMs: 1 });

	expect(attempt.calls()).toBe(3);
});

test("gives up on a tree that stays locked past the backoff", () => {
	const attempt = failing("EBUSY", Number.POSITIVE_INFINITY);

	expect(() =>
		removeTree("/does-not-matter", { remove: attempt.remove, attempts: 4, delayMs: 1 }),
	).toThrow("EBUSY: simulated");
	expect(attempt.calls()).toBe(4);
});

test("never retries a failure that a delay cannot resolve", () => {
	const attempt = failing("ENOTDIR", Number.POSITIVE_INFINITY);

	expect(() => removeTree("/does-not-matter", { remove: attempt.remove, delayMs: 1 })).toThrow(
		"ENOTDIR: simulated",
	);
	expect(attempt.calls()).toBe(1);
});

test("retries the Windows mapped-image lock and keeps EACCES fatal elsewhere", () => {
	const windows = failing("EACCES", 3);

	removeTree("/does-not-matter", { remove: windows.remove, delayMs: 1, platform: "win32" });

	expect(windows.calls()).toBe(3);

	const posix = failing("EACCES", Number.POSITIVE_INFINITY);

	expect(() =>
		removeTree("/does-not-matter", { remove: posix.remove, delayMs: 1, platform: "linux" }),
	).toThrow("EACCES: simulated");
	expect(posix.calls()).toBe(1);
});

test("teardown reports rather than replaces the failure already propagating", () => {
	const attempt = failing("ENOTDIR", Number.POSITIVE_INFINITY);
	const pending = new Error("the assertion that actually failed");

	expect(() =>
		removeTreeAfter("/does-not-matter", pending, { remove: attempt.remove, delayMs: 1 }),
	).not.toThrow();

	expect(() =>
		removeTreeAfter("/does-not-matter", undefined, { remove: attempt.remove, delayMs: 1 }),
	).toThrow("ENOTDIR: simulated");
});

test("waits between attempts instead of spinning", () => {
	const attempt = failing("EBUSY", 3);
	const started = Bun.nanoseconds();

	removeTree("/does-not-matter", { remove: attempt.remove, delayMs: 40 });

	expect((Bun.nanoseconds() - started) / 1_000_000).toBeGreaterThanOrEqual(100);
});
