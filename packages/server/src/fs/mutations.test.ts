import { afterEach, beforeEach, expect, test } from "bun:test";
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { setTrashImplementationForTests } from "../trash";
import { copyWorkspaceFile, deleteWorkspaceFile } from "./mutations";

let dataDir: string;
let root: string;
const savedDataDir = process.env.THINKRAIL_DATA_DIR;

beforeEach(() => {
	dataDir = mkdtempSync(join(tmpdir(), "trpi-fs-mutations-"));
	process.env.THINKRAIL_DATA_DIR = dataDir;
	root = join(dataDir, "worktree");
	mkdirSync(join(root, "src"), { recursive: true });
	writeFileSync(join(root, "src", "note.bin"), new Uint8Array([0, 1, 2, 255]));
	writeFileSync(
		join(dataDir, "workspaces.json"),
		JSON.stringify([{ id: "w1", projectId: "p1", name: "w1", worktreePath: root, createdAt: 1 }]),
	);
	setTrashImplementationForTests(async (input) => {
		if (typeof input !== "string") throw new Error("expected one path");
		rmSync(input);
	});
});

afterEach(() => {
	setTrashImplementationForTests(undefined);
	rmSync(dataDir, { recursive: true, force: true });
	if (savedDataDir === undefined) delete process.env.THINKRAIL_DATA_DIR;
	else process.env.THINKRAIL_DATA_DIR = savedDataDir;
});

test("copyWorkspaceFile copies bytes and chooses a non-destructive sibling name", async () => {
	expect(
		await copyWorkspaceFile({
			sourceWorkspaceId: "w1",
			sourcePath: "src/note.bin",
			destinationWorkspaceId: "w1",
			destinationDirectory: "src",
		}),
	).toEqual({ path: "src/note copy.bin" });
	expect([...readFileSync(join(root, "src", "note copy.bin"))]).toEqual([0, 1, 2, 255]);

	expect(
		await copyWorkspaceFile({
			sourceWorkspaceId: "w1",
			sourcePath: "src/note.bin",
			destinationWorkspaceId: "w1",
			destinationDirectory: "src",
		}),
	).toEqual({ path: "src/note copy 2.bin" });
});

test("file mutations reject escapes and non-file sources", async () => {
	await expect(
		copyWorkspaceFile({
			sourceWorkspaceId: "w1",
			sourcePath: "../outside",
			destinationWorkspaceId: "w1",
			destinationDirectory: ".",
		}),
	).rejects.toThrow("Path escapes the worktree");
	await expect(deleteWorkspaceFile("w1", "src")).rejects.toThrow("Only regular files");
});

test("deleteWorkspaceFile moves the claimed file through the trash implementation", async () => {
	await deleteWorkspaceFile("w1", "src/note.bin");
	expect(existsSync(join(root, "src", "note.bin"))).toBe(false);
});

test("deleteWorkspaceFile restores the path when trashing fails", async () => {
	setTrashImplementationForTests(async () => {
		throw new Error("trash unavailable");
	});
	await expect(deleteWorkspaceFile("w1", "src/note.bin")).rejects.toThrow("trash unavailable");
	expect([...readFileSync(join(root, "src", "note.bin"))]).toEqual([0, 1, 2, 255]);
});
