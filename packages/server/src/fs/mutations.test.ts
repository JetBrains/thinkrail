import { afterEach, beforeEach, expect, test } from "bun:test";
import {
	existsSync,
	lstatSync,
	mkdirSync,
	mkdtempSync,
	readdirSync,
	readFileSync,
	readlinkSync,
	rmSync,
	symlinkSync,
	writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { basename, join } from "node:path";
import { setTrashImplementationForTests } from "../trash";
import { copyName, copyWorktreeEntry, deleteWorktreeEntry, MAX_COPY_ENTRIES } from "./mutations";

let dataDir: string;
let root: string;
let other: string;
let outside: string;
let trashed: string[];
const savedDataDir = process.env.THINKRAIL_DATA_DIR;

function copy(sourcePath: string, destinationDirectory: string, destinationWorkspaceId = "w1") {
	return copyWorktreeEntry({
		sourceWorkspaceId: "w1",
		sourcePath,
		destinationWorkspaceId,
		destinationDirectory,
	});
}

beforeEach(() => {
	dataDir = mkdtempSync(join(tmpdir(), "trpi-fs-mutations-"));
	process.env.THINKRAIL_DATA_DIR = dataDir;
	root = join(dataDir, "worktree");
	other = join(dataDir, "other");
	outside = join(dataDir, "outside");
	mkdirSync(join(root, "src"), { recursive: true });
	mkdirSync(other);
	mkdirSync(outside);
	writeFileSync(join(root, "src", "note.bin"), new Uint8Array([0, 1, 2, 255]));
	writeFileSync(join(outside, "secret.txt"), "secret");
	writeFileSync(
		join(dataDir, "workspaces.json"),
		JSON.stringify([
			{ id: "w1", projectId: "p1", name: "w1", worktreePath: root, createdAt: 1 },
			{ id: "w2", projectId: "p1", name: "w2", worktreePath: other, createdAt: 2 },
		]),
	);
	trashed = [];
	setTrashImplementationForTests(async (input) => {
		if (typeof input !== "string") throw new Error("expected one path");
		trashed.push(basename(input));
		rmSync(input, { recursive: true });
	});
});

afterEach(() => {
	setTrashImplementationForTests(undefined);
	rmSync(dataDir, { recursive: true, force: true });
	if (savedDataDir === undefined) delete process.env.THINKRAIL_DATA_DIR;
	else process.env.THINKRAIL_DATA_DIR = savedDataDir;
});

test("copyName adds ' copy' then ' copy N' before a file's extension, never inside a folder's name", () => {
	expect(copyName("x.ts", "file", 0)).toBe("x.ts");
	expect(copyName("x.ts", "file", 1)).toBe("x copy.ts");
	expect(copyName("x.ts", "file", 2)).toBe("x copy 2.ts");
	expect(copyName(".env", "file", 1)).toBe(".env copy");
	expect(copyName("Makefile", "symlink", 3)).toBe("Makefile copy 3");
	expect(copyName("my.folder", "dir", 1)).toBe("my.folder copy");
});

test("copyWorktreeEntry copies bytes under the first free name and never overwrites", async () => {
	expect(await copy("src/note.bin", "src")).toEqual({
		path: "src/note copy.bin",
		written: ["src/note copy.bin"],
	});
	expect([...readFileSync(join(root, "src", "note copy.bin"))]).toEqual([0, 1, 2, 255]);
	writeFileSync(join(root, "src", "note copy 2.bin"), "kept");

	expect((await copy("src/note.bin", "src")).path).toBe("src/note copy 3.bin");
	expect((await copy("src/note.bin", ".")).path).toBe("note.bin");
	expect(readFileSync(join(root, "src", "note copy 2.bin"), "utf8")).toBe("kept");
});

test("a folder copy recreates its tree, skips nested .git, and keeps links verbatim", async () => {
	mkdirSync(join(root, "pkg", "deep", "deeper"), { recursive: true });
	mkdirSync(join(root, "pkg", ".git"));
	writeFileSync(join(root, "pkg", ".git", "HEAD"), "ref");
	writeFileSync(join(root, "pkg", "deep", "deeper", "leaf.txt"), "leaf");
	symlinkSync(join(outside, "secret.txt"), join(root, "pkg", "escape"));

	const result = await copy("pkg", ".", "w2");
	expect(result.path).toBe("pkg");
	expect(result.written.sort()).toEqual(
		["pkg", "pkg/deep", "pkg/deep/deeper", "pkg/deep/deeper/leaf.txt", "pkg/escape"].sort(),
	);
	expect(readFileSync(join(other, "pkg", "deep", "deeper", "leaf.txt"), "utf8")).toBe("leaf");
	expect(existsSync(join(other, "pkg", ".git"))).toBe(false);
	expect(lstatSync(join(other, "pkg", "escape")).isSymbolicLink()).toBe(true);
	expect(readlinkSync(join(other, "pkg", "escape"))).toBe(join(outside, "secret.txt"));
	expect(existsSync(join(root, "pkg", "deep", "deeper", "leaf.txt"))).toBe(true);
});

test("pasting a folder into itself copies a finite snapshot", async () => {
	writeFileSync(join(root, "src", "a.txt"), "a");
	expect((await copy("src", "src")).path).toBe("src/src");
	expect(readdirSync(join(root, "src", "src")).sort()).toEqual(["a.txt", "note.bin"]);
	expect((await copy("src", ".")).path).toBe("src copy");
	expect(readdirSync(join(root, "src copy")).sort()).toEqual(["a.txt", "note.bin", "src"]);
});

test("a folder past the entry bound is refused before anything is written", async () => {
	mkdirSync(join(root, "big"));
	for (let index = 0; index <= MAX_COPY_ENTRIES; index += 1) {
		writeFileSync(join(root, "big", `${index}`), "");
	}
	const failure = await copy("big", ".").catch((error: unknown) => error);
	expect(failure).toMatchObject({ code: "COPY_TOO_LARGE" });
	expect(existsSync(join(root, "big copy"))).toBe(false);
});

test("copies are refused outside the worktrees, into .git, of the root, and into a file", async () => {
	symlinkSync(outside, join(root, "out"));
	await expect(copy("../outside/secret.txt", ".")).rejects.toThrow("Path escapes the worktree");
	await expect(copy(join(outside, "secret.txt"), ".")).rejects.toThrow("Path escapes the worktree");
	await expect(copy("out/secret.txt", ".")).rejects.toThrow("Path escapes the worktree");
	await expect(copy("src/note.bin", "out")).rejects.toThrow("Path escapes the worktree");
	await expect(copy("src/note.bin", "../outside")).rejects.toThrow("Path escapes the worktree");
	await expect(copy("src/note.bin", ".git")).rejects.toThrow(".git");
	await expect(copy(".", "src")).rejects.toThrow("Path escapes the worktree");
	await expect(copy("src", "src/note.bin")).rejects.toThrow("not a folder");
	expect(readdirSync(outside)).toEqual(["secret.txt"]);
});

test("deleteWorktreeEntry trashes a claimed file or folder, and only the link of a symlink", async () => {
	symlinkSync(join(outside, "secret.txt"), join(root, "link"));
	expect(await deleteWorktreeEntry("w1", "src/note.bin")).toEqual({
		path: "src/note.bin",
		directory: false,
	});
	expect(await deleteWorktreeEntry("w1", "link")).toEqual({ path: "link", directory: false });
	expect(await deleteWorktreeEntry("w1", "./src")).toEqual({ path: "src", directory: true });
	expect(trashed.every((name) => /^\.thinkrail-delete-[0-9a-f-]{36}$/.test(name))).toBe(true);
	expect(trashed).toHaveLength(3);
	expect(readdirSync(root)).toEqual([]);
	expect(readFileSync(join(outside, "secret.txt"), "utf8")).toBe("secret");
});

test("deletes are refused for the root, .git, and escapes", async () => {
	mkdirSync(join(root, ".git"));
	await expect(deleteWorktreeEntry("w1", ".")).rejects.toThrow("Path escapes the worktree");
	await expect(deleteWorktreeEntry("w1", "src/..")).rejects.toThrow("Path escapes the worktree");
	await expect(deleteWorktreeEntry("w1", root)).rejects.toThrow("Path escapes the worktree");
	await expect(deleteWorktreeEntry("w1", ".git")).rejects.toThrow(".git");
	await expect(deleteWorktreeEntry("w1", "../outside")).rejects.toThrow("Path escapes");
	expect(trashed).toEqual([]);
	expect(existsSync(join(root, ".git"))).toBe(true);
	expect(existsSync(outside)).toBe(true);
});

test("a failed trash restores the deleted file or folder", async () => {
	setTrashImplementationForTests(async () => {
		throw new Error("trash unavailable");
	});
	await expect(deleteWorktreeEntry("w1", "src/note.bin")).rejects.toThrow("trash unavailable");
	expect([...readFileSync(join(root, "src", "note.bin"))]).toEqual([0, 1, 2, 255]);
	await expect(deleteWorktreeEntry("w1", "src")).rejects.toThrow("trash unavailable");
	expect(readdirSync(join(root, "src"))).toEqual(["note.bin"]);
	expect(readdirSync(root)).toEqual(["src"]);
});
