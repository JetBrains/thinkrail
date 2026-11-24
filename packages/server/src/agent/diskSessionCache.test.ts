import { afterEach, expect, test } from "bun:test";
import {
	mkdtempSync,
	readFileSync,
	renameSync,
	rmSync,
	statSync,
	utimesSync,
	writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { DiskSessionCache, type DiskSessionSnapshot } from "./diskSessionCache";

const directories: string[] = [];

afterEach(() => {
	for (const directory of directories.splice(0))
		rmSync(directory, { recursive: true, force: true });
});

function fixture() {
	const directory = mkdtempSync(join(tmpdir(), "disk-session-cache-"));
	directories.push(directory);
	const path = join(directory, "session.jsonl");
	writeFileSync(path, "first");
	let loads = 0;
	const load = (): DiskSessionSnapshot => {
		loads++;
		return { entries: [], title: readFileSync(path, "utf8"), lastActivityAt: 0 };
	};
	return { directory, path, load, loads: () => loads };
}

test("unchanged files reuse their snapshot and changed sizes are read again", () => {
	const file = fixture();
	const cache = new DiskSessionCache();
	expect(cache.read(file.path, file.load).title).toBe("first");
	expect(cache.read(file.path, file.load).title).toBe("first");
	expect(file.loads()).toBe(1);
	writeFileSync(file.path, "a longer new title");
	expect(cache.read(file.path, file.load).title).toBe("a longer new title");
	expect(file.loads()).toBe(2);
});

test("same-size rewrites with a restored mtime invalidate through ctime", () => {
	const file = fixture();
	const cache = new DiskSessionCache();
	utimesSync(file.path, 1_000, 1_000);
	const before = statSync(file.path, { bigint: true });
	cache.read(file.path, file.load);
	writeFileSync(file.path, "other");
	utimesSync(file.path, 1_000, 1_000);
	const after = statSync(file.path, { bigint: true });
	expect(after.size).toBe(before.size);
	expect(after.mtimeNs).toBe(before.mtimeNs);
	expect(after.ctimeNs).not.toBe(before.ctimeNs);
	expect(cache.read(file.path, file.load).title).toBe("other");
	expect(file.loads()).toBe(2);
});

test("atomic replacement is observed even with the same size and mtime", () => {
	const file = fixture();
	const cache = new DiskSessionCache();
	utimesSync(file.path, 1_000, 1_000);
	cache.read(file.path, file.load);
	const replacement = join(file.directory, "replacement.jsonl");
	writeFileSync(replacement, "other");
	utimesSync(replacement, 1_000, 1_000);
	renameSync(replacement, file.path);
	expect(cache.read(file.path, file.load).title).toBe("other");
	expect(file.loads()).toBe(2);
});

test("missing files fail instead of returning a cached snapshot and recreation is read", () => {
	const file = fixture();
	const cache = new DiskSessionCache();
	cache.read(file.path, file.load);
	rmSync(file.path);
	expect(() => cache.read(file.path, file.load)).toThrow("ENOENT");
	writeFileSync(file.path, "again");
	expect(cache.read(file.path, file.load).title).toBe("again");
	expect(file.loads()).toBe(2);
});

test("failed and concurrently changed reads never become reusable snapshots", () => {
	const file = fixture();
	const cache = new DiskSessionCache();
	let failures = 0;
	const fail = (): never => {
		failures++;
		throw new Error("fixture parse failure");
	};
	for (let attempt = 0; attempt < 2; attempt++) {
		expect(() => cache.read(file.path, fail)).toThrow("fixture parse failure");
	}
	expect(failures).toBe(2);
	const beforeWrite = cache.read(file.path, () => {
		const snapshot = file.load();
		writeFileSync(file.path, "changed during parse");
		return snapshot;
	});
	expect(beforeWrite.title).toBe("first");
	expect(cache.read(file.path, file.load).title).toBe("changed during parse");
	cache.read(file.path, file.load);
	expect(file.loads()).toBe(2);
});

test("the entry limit evicts the least recently read snapshot", () => {
	const a = fixture();
	const b = fixture();
	const c = fixture();
	const cache = new DiskSessionCache(2);
	cache.read(a.path, a.load);
	cache.read(b.path, b.load);
	cache.read(a.path, a.load);
	cache.read(c.path, c.load);
	cache.read(a.path, a.load);
	expect(a.loads()).toBe(1);
	cache.read(b.path, b.load);
	expect(b.loads()).toBe(2);
});

test("the character limit evicts by total weight and never admits an oversized snapshot", () => {
	const a = fixture();
	const b = fixture();
	const large = fixture();
	const oneSize = JSON.stringify({ entries: [], title: "first", lastActivityAt: 0 }).length;
	const cache = new DiskSessionCache(10, oneSize);
	cache.read(a.path, a.load);
	cache.read(b.path, b.load);
	cache.read(a.path, a.load);
	expect(a.loads()).toBe(2);
	writeFileSync(large.path, "oversized".repeat(oneSize));
	cache.read(large.path, large.load);
	cache.read(large.path, large.load);
	expect(large.loads()).toBe(2);
	cache.read(a.path, a.load);
	expect(a.loads()).toBe(2);
});

test("directory pruning, explicit forgetting and disposal release their own snapshots", () => {
	const a = fixture();
	const b = fixture();
	const other = fixture();
	const cache = new DiskSessionCache();
	const sibling = join(a.directory, "other.jsonl");
	writeFileSync(sibling, "sibling");
	cache.read(a.path, a.load);
	cache.read(sibling, b.load);
	cache.read(other.path, other.load);
	cache.retainDirectory(a.directory, new Set([a.path]));
	cache.read(a.path, a.load);
	cache.read(other.path, other.load);
	cache.read(sibling, b.load);
	expect(a.loads()).toBe(1);
	expect(other.loads()).toBe(1);
	expect(b.loads()).toBe(2);
	cache.forget(a.path);
	cache.read(a.path, a.load);
	expect(a.loads()).toBe(2);
	cache.clear();
	cache.read(other.path, other.load);
	expect(other.loads()).toBe(2);
});
