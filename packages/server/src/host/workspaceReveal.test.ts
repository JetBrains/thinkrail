import { afterEach, beforeEach, expect, test } from "bun:test";
import { mkdirSync, mkdtempSync, rmSync, symlinkSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { CodedError } from "@thinkrail/shared/codedError";
import { revealItemInFileManager } from "../editors";
import { revealWorkspace } from "./workspaceReveal";

let dataDir: string;
let root: string;
let calls: string[][];
const savedDataDir = process.env.THINKRAIL_DATA_DIR;

beforeEach(() => {
	dataDir = mkdtempSync(join(tmpdir(), "thinkrail-workspace-reveal-"));
	process.env.THINKRAIL_DATA_DIR = dataDir;
	root = join(dataDir, "worktree");
	mkdirSync(join(root, "src", "nested"), { recursive: true });
	mkdirSync(join(root, ".git"));
	writeFileSync(join(root, "src", "nested", "artifact 日本語.txt"), "artifact\n");
	writeFileSync(join(root, ".git", "config"), "metadata\n");
	writeFileSync(
		join(dataDir, "workspaces.json"),
		JSON.stringify([{ id: "w1", projectId: "p1", name: "w1", worktreePath: root, createdAt: 1 }]),
	);
	calls = [];
});

afterEach(() => {
	rmSync(dataDir, { recursive: true, force: true });
	if (savedDataDir === undefined) delete process.env.THINKRAIL_DATA_DIR;
	else process.env.THINKRAIL_DATA_DIR = savedDataDir;
});

function reveal(path: string): void {
	revealItemInFileManager(path, (cmd) => calls.push(cmd), "darwin");
}

function expectRevealFailure(path: string): void {
	try {
		revealWorkspace({ id: "w1", path }, reveal);
		throw new Error("Expected selected-item reveal to fail");
	} catch (error) {
		expect(error).toBeInstanceOf(CodedError);
		if (!(error instanceof CodedError)) throw error;
		expect(error.code).toBe("FILE_REVEAL_FAILED");
	}
	expect(calls).toEqual([]);
}

test("reveals the requested existing file or directory within its workspace", () => {
	for (const path of ["src/nested/artifact 日本語.txt", "src/nested"]) {
		expect(revealWorkspace({ id: "w1", path }, reveal)).toEqual({ ok: true });
	}
	expect(calls).toEqual([
		["open", "-R", join(root, "src", "nested", "artifact 日本語.txt")],
		["open", "-R", join(root, "src", "nested")],
	]);
});

test("omitted path retains the existing workspace-folder action", () => {
	const folders: string[] = [];
	expect(revealWorkspace({ id: "w1" }, reveal, (path) => folders.push(path))).toEqual({
		ok: true,
	});
	expect(folders).toEqual([root]);
	expect(calls).toEqual([]);
});

test("rejects empty and absolute paths before launching", () => {
	for (const path of ["", join(root, "src", "nested")]) expectRevealFailure(path);
});

test("does not open an ancestor or root when the target is missing", () => {
	expectRevealFailure("src/gone.txt");
});

test("rejects escaping paths and git metadata", () => {
	for (const path of ["../outside", ".git", ".git/config", "src/../../outside"]) {
		expectRevealFailure(path);
	}
});

test("rejects a symlink directory that leaves the workspace", () => {
	const outside = join(dataDir, "outside");
	mkdirSync(outside);
	writeFileSync(join(outside, "artifact.txt"), "outside\n");
	symlinkSync(outside, join(root, "escape"), process.platform === "win32" ? "junction" : "dir");
	expectRevealFailure("escape/artifact.txt");
});

test("classifies launch failures as FILE_REVEAL_FAILED", () => {
	expect(() =>
		revealWorkspace({ id: "w1", path: "src/nested" }, () => {
			throw new Error("No launcher installed");
		}),
	).toThrow(expect.objectContaining({ code: "FILE_REVEAL_FAILED" }));
});
