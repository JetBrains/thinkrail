import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import { mkdirSync, mkdtempSync, realpathSync, rmSync, symlinkSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { MAX_TERMINAL_PATH_CANDIDATES, MAX_TERMINAL_PATH_LENGTH } from "@thinkrail/contracts";
import { locateWorktreeEntries } from "./files";

let dataDir: string;
let root: string;
let outside: string;
const savedDataDir = process.env.THINKRAIL_DATA_DIR;

beforeEach(() => {
	dataDir = mkdtempSync(join(tmpdir(), "trpi-fs-locate-"));
	process.env.THINKRAIL_DATA_DIR = dataDir;
	root = join(dataDir, "worktree");
	outside = join(dataDir, "outside");
	mkdirSync(join(root, "src", "auth"), { recursive: true });
	mkdirSync(join(root, "sub"), { recursive: true });
	mkdirSync(join(root, ".git"), { recursive: true });
	mkdirSync(outside);
	writeFileSync(join(root, "src", "auth", "login.ts"), "export {};\n");
	writeFileSync(join(root, "sub", "y.py"), "print(1)\n");
	writeFileSync(join(root, "launcher.py"), "print(1)\n");
	writeFileSync(join(root, "my file.ts"), "\n");
	writeFileSync(join(root, ".git", "config"), "[core]\n");
	writeFileSync(join(outside, "secret.txt"), "secret\n");
	writeFileSync(
		join(dataDir, "workspaces.json"),
		JSON.stringify([{ id: "w1", projectId: "p1", name: "w1", worktreePath: root, createdAt: 1 }]),
	);
});

afterEach(() => {
	rmSync(dataDir, { recursive: true, force: true });
	if (savedDataDir === undefined) delete process.env.THINKRAIL_DATA_DIR;
	else process.env.THINKRAIL_DATA_DIR = savedDataDir;
});

describe("locateWorktreeEntries", () => {
	test("names existing files and folders worktree-relative, and nothing else", () => {
		expect(
			locateWorktreeEntries(
				"w1",
				["src/auth/login.ts", "./src/auth", "launcher.py", "nope.ts"],
				[],
			),
		).toEqual([
			{ kind: "file", path: "src/auth/login.ts" },
			{ kind: "dir", path: "src/auth" },
			{ kind: "file", path: "launcher.py" },
			null,
		]);
	});

	test("a path is looked up from each base in order, then the worktree root", () => {
		const sub = join(root, "sub");
		expect(locateWorktreeEntries("w1", ["y.py", "./y.py", "../launcher.py"], [sub])).toEqual([
			{ kind: "file", path: "sub/y.py" },
			{ kind: "file", path: "sub/y.py" },
			{ kind: "file", path: "launcher.py" },
		]);
		expect(locateWorktreeEntries("w1", ["launcher.py"], [sub])).toEqual([
			{ kind: "file", path: "launcher.py" },
		]);
		expect(locateWorktreeEntries("w1", ["y.py"], [])).toEqual([null]);
	});

	test("an absolute path inside the worktree is named; one outside never is", () => {
		expect(
			locateWorktreeEntries(
				"w1",
				[join(root, "sub", "y.py"), join(outside, "secret.txt"), outside, "/"],
				[],
			),
		).toEqual([{ kind: "file", path: "sub/y.py" }, null, null, null]);
	});

	test("climbing out of the worktree from a base is refused", () => {
		expect(
			locateWorktreeEntries(
				"w1",
				["../outside/secret.txt", "../../outside/secret.txt"],
				[join(root, "sub")],
			),
		).toEqual([null, null]);
	});

	test("a base outside the worktree cannot reach out, and falls back to the root", () => {
		writeFileSync(join(root, "secret.txt"), "decoy\n");
		expect(locateWorktreeEntries("w1", ["secret.txt"], [outside])).toEqual([
			{ kind: "file", path: "secret.txt" },
		]);
		rmSync(join(root, "secret.txt"));
		expect(locateWorktreeEntries("w1", ["secret.txt"], [outside])).toEqual([null]);
	});

	test("~ expands to the home directory before containment is checked", () => {
		expect(locateWorktreeEntries("w1", ["~/sub/y.py", "~"], [], dataDir)).toEqual([null, null]);
		expect(locateWorktreeEntries("w1", ["~/sub/y.py", "~/src"], [], root)).toEqual([
			{ kind: "file", path: "sub/y.py" },
			{ kind: "dir", path: "src" },
		]);
		expect(locateWorktreeEntries("w1", ["~/worktree/launcher.py"], [], dataDir)).toEqual([
			{ kind: "file", path: "launcher.py" },
		]);
	});

	test("git metadata and the worktree root itself are never answers", () => {
		expect(locateWorktreeEntries("w1", [".git/config", ".git", ".", "./", root], [])).toEqual([
			null,
			null,
			null,
			null,
			null,
		]);
	});

	test("a base reported in canonical form still matches the stored root", () => {
		const canonicalSub = join(realpathSync(root), "sub");
		expect(locateWorktreeEntries("w1", ["y.py"], [canonicalSub])).toEqual([
			{ kind: "file", path: "sub/y.py" },
		]);
	});

	test("relative bases are ignored rather than resolved against the host's cwd", () => {
		expect(locateWorktreeEntries("w1", ["y.py"], ["sub"])).toEqual([null]);
	});

	test("names with spaces are looked up as given", () => {
		expect(locateWorktreeEntries("w1", ["my file.ts"], [])).toEqual([
			{ kind: "file", path: "my file.ts" },
		]);
	});

	test("an unknown workspace is an error", () => {
		expect(() => locateWorktreeEntries("nope", ["a.ts"], [])).toThrow("Unknown workspace");
	});

	test("malformed candidate lists are rejected", () => {
		const reject = (candidates: unknown) =>
			expect(() => locateWorktreeEntries("w1", candidates as string[], [])).toThrow(
				"Invalid path candidates",
			);
		reject("src");
		reject([1]);
		reject([""]);
		reject(["x".repeat(MAX_TERMINAL_PATH_LENGTH + 1)]);
		reject(Array.from({ length: MAX_TERMINAL_PATH_CANDIDATES + 1 }, () => "a.ts"));
		expect(
			locateWorktreeEntries(
				"w1",
				Array.from({ length: MAX_TERMINAL_PATH_CANDIDATES }, () => "launcher.py"),
				[],
			),
		).toHaveLength(MAX_TERMINAL_PATH_CANDIDATES);
	});
});

const symlinkTest = process.platform === "win32" ? test.skip : test;

symlinkTest("a symlink is followed only while its target stays inside the worktree", () => {
	symlinkSync(join(root, "src"), join(root, "srclink"));
	symlinkSync(outside, join(root, "escape"));
	symlinkSync(join(outside, "secret.txt"), join(root, "leak.txt"));
	expect(
		locateWorktreeEntries(
			"w1",
			["srclink/auth/login.ts", "escape/secret.txt", "escape", "leak.txt"],
			[],
		),
	).toEqual([{ kind: "file", path: "srclink/auth/login.ts" }, null, null, null]);
});
