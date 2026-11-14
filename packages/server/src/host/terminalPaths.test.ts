import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import { mkdirSync, mkdtempSync, realpathSync, rmSync, symlinkSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { MAX_TERMINAL_PATH_CANDIDATES, MAX_TERMINAL_PATH_LENGTH } from "@thinkrail/contracts";
import { listWorkspaceRecords } from "../workspaces";
import { locateTerminalPaths, resolveTerminalPaths } from "./terminalPaths";

let dataDir: string;
let root: string;
let other: string;
let outside: string;
const savedDataDir = process.env.THINKRAIL_DATA_DIR;

function file(path: string, content = "x\n"): void {
	mkdirSync(dirname(path), { recursive: true });
	writeFileSync(path, content);
}

function locate(
	candidates: readonly string[],
	cwds: readonly string[] | (() => Promise<readonly string[]>) = [],
	home = join(dataDir, "home"),
) {
	return locateTerminalPaths(
		{ workspaceId: "w1", cwds: typeof cwds === "function" ? cwds : async () => cwds },
		candidates,
		home,
	);
}

const found = (kind: "file" | "dir", relPath: string) => ({ kind, relPath });
const none = { kind: null, relPath: null };

beforeEach(() => {
	dataDir = mkdtempSync(join(tmpdir(), "trpi-terminal-paths-"));
	process.env.THINKRAIL_DATA_DIR = dataDir;
	root = join(dataDir, "repo");
	other = join(dataDir, "worktrees", "w2");
	outside = join(dataDir, "outside");
	file(join(root, "src", "auth", "login.ts"));
	file(join(root, "sub", "y.py"));
	file(join(root, "launcher.py"));
	file(join(root, "my file.ts"));
	file(join(root, ".git", "config"));
	file(join(other, "only-there.ts"));
	file(join(outside, "secret.txt"));
	writeFileSync(
		join(dataDir, "projects.json"),
		JSON.stringify([{ id: "p1", name: "repo", path: root, slug: "repo", lastOpened: 1 }]),
	);
	writeFileSync(
		join(dataDir, "workspaces.json"),
		JSON.stringify([
			{ id: "w1", projectId: "p1", name: "w1", kind: "default", worktreePath: root, createdAt: 1 },
			{ id: "w2", projectId: "p1", name: "w2", worktreePath: other, createdAt: 2 },
		]),
	);
});

afterEach(() => {
	rmSync(dataDir, { recursive: true, force: true });
	if (savedDataDir === undefined) delete process.env.THINKRAIL_DATA_DIR;
	else process.env.THINKRAIL_DATA_DIR = savedDataDir;
});

describe("locateTerminalPaths", () => {
	test("names existing files and folders worktree-relative, and nothing else", async () => {
		expect(
			await locate(["src/auth/login.ts", "./src/auth", "launcher.py", "my file.ts", "nope.ts"]),
		).toEqual([
			found("file", "src/auth/login.ts"),
			found("dir", "src/auth"),
			found("file", "launcher.py"),
			found("file", "my file.ts"),
			none,
		]);
	});

	test("a relative path is looked up from each working directory in order, then the root", async () => {
		const sub = join(root, "sub");
		expect(await locate(["y.py", "./y.py", "../launcher.py", "launcher.py"], [sub])).toEqual([
			found("file", "sub/y.py"),
			found("file", "sub/y.py"),
			found("file", "launcher.py"),
			found("file", "launcher.py"),
		]);
		expect(await locate(["y.py"])).toEqual([none]);
	});

	test("an absolute path inside the worktree is named; one outside never is", async () => {
		expect(
			await locate([join(root, "sub", "y.py"), join(outside, "secret.txt"), outside, "/"]),
		).toEqual([found("file", "sub/y.py"), none, none, none]);
	});

	test("climbing out of the worktree from a working directory is refused", async () => {
		expect(
			await locate(["../outside/secret.txt", "../../outside/secret.txt"], [join(root, "sub")]),
		).toEqual([none, none]);
	});

	test("a path another workspace owns is out of scope, even from a directory inside it", async () => {
		expect(await locate([join(other, "only-there.ts")])).toEqual([none]);
		file(join(root, "only-there.ts"));
		expect(await locate(["only-there.ts"], [other])).toEqual([found("file", "only-there.ts")]);
		rmSync(join(root, "only-there.ts"));
		expect(await locate(["only-there.ts"], [other])).toEqual([none]);
	});

	test("a project opened inside the worktree owns its own paths", async () => {
		const nested = join(root, "packages", "app");
		file(join(nested, "index.ts"));
		writeFileSync(
			join(dataDir, "projects.json"),
			JSON.stringify([
				{ id: "p1", name: "repo", path: root, slug: "repo", lastOpened: 1 },
				{ id: "p2", name: "app", path: nested, slug: "app", lastOpened: 2 },
			]),
		);
		expect(await locate(["packages/app/index.ts", "packages"])).toEqual([
			none,
			found("dir", "packages"),
		]);
		expect(listWorkspaceRecords("p2")).toEqual([]);
	});

	test("~ expands to the home directory before ownership is checked", async () => {
		expect(await locate(["~/sub/y.py", "~"], [], dataDir)).toEqual([none, none]);
		expect(await locate(["~/sub/y.py", "~/src"], [], root)).toEqual([
			found("file", "sub/y.py"),
			found("dir", "src"),
		]);
		expect(await locate(["~/repo/launcher.py"], [], dataDir)).toEqual([
			found("file", "launcher.py"),
		]);
	});

	test("git metadata and the worktree root itself are never answers", async () => {
		expect(await locate([".git/config", ".git", ".", "./", root])).toEqual([
			none,
			none,
			none,
			none,
			none,
		]);
	});

	test("a working directory reported in canonical form still matches the stored root", async () => {
		expect(await locate(["y.py"], [join(realpathSync(root), "sub")])).toEqual([
			found("file", "sub/y.py"),
		]);
	});

	test("relative working directories are ignored rather than resolved against the host's", async () => {
		expect(await locate(["y.py"], ["sub"])).toEqual([none]);
	});

	test("the shell is not asked for its directories when every path is anchored", async () => {
		let asked = 0;
		const cwds = async () => {
			asked += 1;
			return [join(root, "sub")];
		};
		expect(await locate([join(root, "launcher.py"), "~/src", "/etc/hosts"], cwds, root)).toEqual([
			found("file", "launcher.py"),
			found("dir", "src"),
			none,
		]);
		expect(asked).toBe(0);
		expect(await locate(["~/src", "y.py"], cwds, root)).toEqual([
			found("dir", "src"),
			found("file", "sub/y.py"),
		]);
		expect(asked).toBe(1);
	});

	test("a working-directory probe that fails leaves the worktree root", async () => {
		expect(
			await locate(["launcher.py", "y.py"], () => Promise.reject(new Error("probe failed"))),
		).toEqual([found("file", "launcher.py"), none]);
	});

	test("an unknown workspace is an error", async () => {
		await expect(
			locateTerminalPaths({ workspaceId: "nope", cwds: async () => [] }, ["a.ts"]),
		).rejects.toThrow("Unknown workspace");
	});
});

const symlinkTest = process.platform === "win32" ? test.skip : test;

symlinkTest("a symlink is followed only while its target stays in the workspace", async () => {
	symlinkSync(join(root, "src"), join(root, "srclink"));
	symlinkSync(outside, join(root, "escape"));
	symlinkSync(join(outside, "secret.txt"), join(root, "leak.txt"));
	symlinkSync(other, join(root, "elsewhere"));
	expect(
		await locate([
			"srclink/auth/login.ts",
			"escape/secret.txt",
			"escape",
			"leak.txt",
			"elsewhere/only-there.ts",
		]),
	).toEqual([found("file", "src/auth/login.ts"), none, none, none, none]);
});

describe("resolveTerminalPaths", () => {
	test("malformed candidate lists are rejected before any lookup", async () => {
		const reject = (candidates: unknown) =>
			expect(resolveTerminalPaths("never-attached", candidates)).rejects.toThrow(
				"Invalid path candidates",
			);
		await reject("src");
		await reject([1]);
		await reject([""]);
		await reject(["x".repeat(MAX_TERMINAL_PATH_LENGTH + 1)]);
		await reject(Array.from({ length: MAX_TERMINAL_PATH_CANDIDATES + 1 }, () => "a.ts"));
	});

	test("a well-formed list for an unknown terminal is an error", async () => {
		await expect(
			resolveTerminalPaths(
				"never-attached",
				Array.from({ length: MAX_TERMINAL_PATH_CANDIDATES }, () =>
					"x".repeat(MAX_TERMINAL_PATH_LENGTH),
				),
			),
		).rejects.toThrow("Unknown terminal");
	});
});
