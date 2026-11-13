import { afterEach, beforeEach, expect, mock, spyOn, test } from "bun:test";
import * as fs from "node:fs";
import {
	chmodSync,
	existsSync,
	lstatSync,
	mkdirSync,
	mkdtempSync,
	readdirSync,
	readFileSync,
	readlinkSync,
	realpathSync,
	renameSync,
	rmSync,
	symlinkSync,
	writeFileSync,
} from "node:fs";
import * as fsPromises from "node:fs/promises";
import { tmpdir } from "node:os";
import { basename, join } from "node:path";
import { setTrashImplementationForTests } from "../trash";
import {
	copyName,
	copyWorktreeEntry,
	deleteWorktreeEntry,
	MAX_COPY_ENTRIES,
	moveWorktreeEntry,
	renameWorktreeEntry,
} from "./mutations";

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
	dataDir = realpathSync(mkdtempSync(join(tmpdir(), "trpi-fs-mutations-")));
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
	mock.restore();
	setTrashImplementationForTests(undefined);
	rmSync(dataDir, { recursive: true, force: true });
	if (savedDataDir === undefined) delete process.env.THINKRAIL_DATA_DIR;
	else process.env.THINKRAIL_DATA_DIR = savedDataDir;
});

type Hookable = typeof fs | typeof fsPromises;

function hook<T extends Hookable>(
	module: T,
	name: keyof T,
	path: string,
	fire: <V>(value: V) => V,
): void {
	const real = module[name] as (...args: unknown[]) => unknown;
	const spy = spyOn(module, name);
	spy.mockImplementation(((...args: unknown[]) => {
		const result = real.apply(module, args);
		if (args[0] !== path) return result;
		return result instanceof Promise ? result.then(fire) : fire(result);
	}) as Parameters<typeof spy.mockImplementation>[0]);
}

function afterFirstCall(
	path: string,
	act: () => void,
	sync: keyof typeof fs,
	async?: keyof typeof fsPromises,
): void {
	let done = false;
	const fire = <V>(value: V): V => {
		if (!done) {
			done = true;
			act();
		}
		return value;
	};
	hook(fs, sync, path, fire);
	if (async) hook(fsPromises, async, path, fire);
}

function replaceWithLink(path: string, target: string): void {
	renameSync(path, `${path}-moved`);
	symlinkSync(target, path);
}

test("copyName adds ' copy' then ' copy N' before a file's extension, never inside a folder's name", () => {
	expect(copyName("x.ts", "file", 0)).toBe("x.ts");
	expect(copyName("x.ts", "file", 1)).toBe("x copy.ts");
	expect(copyName("x.ts", "file", 2)).toBe("x copy 2.ts");
	expect(copyName(".env", "file", 1)).toBe(".env copy");
	expect(copyName("Makefile", "symlink", 3)).toBe("Makefile copy 3");
	expect(copyName("my.folder", "dir", 1)).toBe("my.folder copy");
});

test("copyWorktreeEntry copies bytes and mode under the first free name and never overwrites", async () => {
	chmodSync(join(root, "src", "note.bin"), 0o750);
	expect(await copy("src/note.bin", "src")).toEqual({
		path: "src/note copy.bin",
		written: ["src/note copy.bin"],
	});
	expect([...readFileSync(join(root, "src", "note copy.bin"))]).toEqual([0, 1, 2, 255]);
	expect(lstatSync(join(root, "src", "note copy.bin")).mode & 0o777).toBe(0o750);
	const large = new Uint8Array(300 * 1024).map((_, index) => index % 251);
	writeFileSync(join(root, "src", "large.bin"), large);
	await copy("src/large.bin", ".");
	expect(readFileSync(join(root, "large.bin")).equals(large)).toBe(true);
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
	await expect(copy("src/note.bin", "src/missing")).rejects.toMatchObject({ code: "ENOENT" });
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

test("a delete whose folder turns into an outside link after validation never trashes outside", async () => {
	writeFileSync(join(root, "src", "secret.txt"), "intended");
	afterFirstCall(
		join(root, "src"),
		() => replaceWithLink(join(root, "src"), outside),
		"realpathSync",
	);

	const failure = await deleteWorktreeEntry("w1", "src/secret.txt").catch(
		(error: unknown) => error,
	);

	expect(failure).toMatchObject({ code: "ENTRY_CHANGED" });
	expect(trashed).toEqual([]);
	expect(readdirSync(outside)).toEqual(["secret.txt"]);
	expect(readFileSync(join(outside, "secret.txt"), "utf8")).toBe("secret");
	expect(readFileSync(join(root, "src-moved", "secret.txt"), "utf8")).toBe("intended");
});

test("a paste whose destination turns into an outside link after validation writes nothing outside", async () => {
	mkdirSync(join(root, "dest"));
	afterFirstCall(
		join(root, "dest"),
		() => replaceWithLink(join(root, "dest"), outside),
		"realpathSync",
	);

	const failure = await copy("src/note.bin", "dest").catch((error: unknown) => error);

	expect(failure).toMatchObject({ code: "ENTRY_CHANGED" });
	expect(readdirSync(outside)).toEqual(["secret.txt"]);
});

test("a paste whose destination turns into an outside link once the copy is created writes no bytes", async () => {
	const destination = join(root, "dest");
	mkdirSync(destination);
	afterFirstCall(
		join(destination, "note.bin"),
		() => replaceWithLink(destination, outside),
		"openSync",
		"open",
	);

	const failure = await copy("src/note.bin", "dest").catch((error: unknown) => error);

	expect(failure).toMatchObject({ code: "ENTRY_CHANGED" });
	expect(readdirSync(outside)).toEqual(["secret.txt"]);
	expect(readFileSync(join(root, "dest-moved", "note.bin"))).toHaveLength(0);
});

test("a folder paste whose new copy turns into an outside link stops and keeps what it wrote", async () => {
	mkdirSync(join(root, "dest"));
	mkdirSync(join(root, "pkg"));
	writeFileSync(join(root, "pkg", "a.txt"), "a");
	const created = join(root, "dest", "pkg");
	afterFirstCall(created, () => replaceWithLink(created, outside), "mkdirSync", "mkdir");

	const failure = await copy("pkg", "dest").catch((error: unknown) => error);

	expect(failure).toMatchObject({ code: "ENTRY_CHANGED" });
	expect(readdirSync(outside)).toEqual(["secret.txt"]);
	expect(existsSync(join(root, "dest", "pkg-moved"))).toBe(true);
});

test("a copied file replaced by an outside link after it was examined never copies outside bytes", async () => {
	const source = join(root, "src", "a.txt");
	writeFileSync(source, "a");
	const replace = () => {
		rmSync(source);
		symlinkSync(join(outside, "secret.txt"), source);
	};
	afterFirstCall(source, replace, "lstatSync", "lstat");

	const failure = await copy("src/a.txt", "src").catch((error: unknown) => error);

	expect(failure).toMatchObject({ code: "ENTRY_CHANGED" });
	expect(readdirSync(join(root, "src")).sort()).toEqual(["a.txt", "note.bin"]);
});

test("a copied folder whose subfolder turns into an outside link mid-copy never copies outside bytes", async () => {
	mkdirSync(join(root, "pkg", "sub"), { recursive: true });
	writeFileSync(join(root, "pkg", "sub", "secret.txt"), "inside");
	const sub = join(root, "pkg", "sub");
	afterFirstCall(
		join(root, "pkg copy", "sub"),
		() => replaceWithLink(sub, outside),
		"mkdirSync",
		"mkdir",
	);

	const failure = await copy("pkg", ".").catch((error: unknown) => error);

	expect(failure).toMatchObject({ code: "ENTRY_CHANGED" });
	expect(readdirSync(join(root, "pkg copy", "sub"))).toEqual([]);
	expect(readFileSync(join(root, "pkg", "sub-moved", "secret.txt"), "utf8")).toBe("inside");
});

test("renameWorktreeEntry renames in place and never replaces another entry", () => {
	writeFileSync(join(root, "src", "a.md"), "a");
	writeFileSync(join(root, "src", "b.md"), "b");
	expect(renameWorktreeEntry("w1", "src/a.md", "c.md")).toEqual({
		from: "src/a.md",
		path: "src/c.md",
		directory: false,
		written: ["src/c.md"],
	});
	expect(readFileSync(join(root, "src", "c.md"), "utf8")).toBe("a");
	expect(() => renameWorktreeEntry("w1", "src/c.md", "b.md")).toThrow("already exists");
	for (const name of ["", ".", "..", ".git", "x/y", "x\\y"])
		expect(() => renameWorktreeEntry("w1", "src/c.md", name)).toThrow();
	expect(renameWorktreeEntry("w1", "src", "lib")).toMatchObject({ path: "lib", directory: true });
	expect(existsSync(join(root, "lib", "c.md"))).toBe(true);
});

test("moveWorktreeEntry moves within and across workspaces without overwriting", async () => {
	writeFileSync(join(root, "src", "a.md"), "a");
	mkdirSync(join(root, "docs"));
	expect(
		await moveWorktreeEntry({
			sourceWorkspaceId: "w1",
			sourcePath: "src/a.md",
			destinationWorkspaceId: "w1",
			destinationDirectory: "docs",
		}),
	).toEqual({ from: "src/a.md", path: "docs/a.md", directory: false, written: ["docs/a.md"] });
	expect(existsSync(join(root, "src", "a.md"))).toBe(false);
	const same = await moveWorktreeEntry({
		sourceWorkspaceId: "w1",
		sourcePath: "docs/a.md",
		destinationWorkspaceId: "w1",
		destinationDirectory: "docs",
	});
	expect(same).toMatchObject({ path: "docs/a.md", written: [] });
	writeFileSync(join(other, "a.md"), "theirs");
	await expect(
		moveWorktreeEntry({
			sourceWorkspaceId: "w1",
			sourcePath: "docs/a.md",
			destinationWorkspaceId: "w2",
			destinationDirectory: ".",
		}),
	).rejects.toThrow("already exists");
	rmSync(join(other, "a.md"));
	await moveWorktreeEntry({
		sourceWorkspaceId: "w1",
		sourcePath: "docs/a.md",
		destinationWorkspaceId: "w2",
		destinationDirectory: ".",
	});
	expect(readFileSync(join(other, "a.md"), "utf8")).toBe("a");
	await expect(
		moveWorktreeEntry({
			sourceWorkspaceId: "w1",
			sourcePath: "docs",
			destinationWorkspaceId: "w1",
			destinationDirectory: "docs",
		}),
	).rejects.toThrow("into itself");
	mkdirSync(join(root, "docs", "inner"));
	await expect(
		moveWorktreeEntry({
			sourceWorkspaceId: "w1",
			sourcePath: "docs",
			destinationWorkspaceId: "w1",
			destinationDirectory: "docs/inner",
		}),
	).rejects.toThrow("into itself");
});
