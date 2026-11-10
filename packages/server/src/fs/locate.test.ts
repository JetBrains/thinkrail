import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import { mkdirSync, mkdtempSync, realpathSync, rmSync, symlinkSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { MAX_TERMINAL_PATH_CANDIDATES, MAX_TERMINAL_PATH_LENGTH } from "@thinkrail/contracts";
import { locateWorktreeEntries as locate } from "./files";

const locateWorktreeEntries = (
	workspaceId: string,
	candidates: readonly string[],
	bases: readonly string[],
	home?: string,
) => locate(workspaceId, candidates, async () => bases, home);

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
	test("names existing files and folders worktree-relative, and nothing else", async () => {
		expect(
			await locateWorktreeEntries(
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

	test("a path is looked up from each base in order, then the worktree root", async () => {
		const sub = join(root, "sub");
		expect(await locateWorktreeEntries("w1", ["y.py", "./y.py", "../launcher.py"], [sub])).toEqual([
			{ kind: "file", path: "sub/y.py" },
			{ kind: "file", path: "sub/y.py" },
			{ kind: "file", path: "launcher.py" },
		]);
		expect(await locateWorktreeEntries("w1", ["launcher.py"], [sub])).toEqual([
			{ kind: "file", path: "launcher.py" },
		]);
		expect(await locateWorktreeEntries("w1", ["y.py"], [])).toEqual([null]);
	});

	test("an absolute path inside the worktree is named; one outside never is", async () => {
		expect(
			await locateWorktreeEntries(
				"w1",
				[join(root, "sub", "y.py"), join(outside, "secret.txt"), outside, "/"],
				[],
			),
		).toEqual([{ kind: "file", path: "sub/y.py" }, null, null, null]);
	});

	test("climbing out of the worktree from a base is refused", async () => {
		expect(
			await locateWorktreeEntries(
				"w1",
				["../outside/secret.txt", "../../outside/secret.txt"],
				[join(root, "sub")],
			),
		).toEqual([null, null]);
	});

	test("a base outside the worktree cannot reach out, and falls back to the root", async () => {
		writeFileSync(join(root, "secret.txt"), "decoy\n");
		expect(await locateWorktreeEntries("w1", ["secret.txt"], [outside])).toEqual([
			{ kind: "file", path: "secret.txt" },
		]);
		rmSync(join(root, "secret.txt"));
		expect(await locateWorktreeEntries("w1", ["secret.txt"], [outside])).toEqual([null]);
	});

	test("~ expands to the home directory before containment is checked", async () => {
		expect(await locateWorktreeEntries("w1", ["~/sub/y.py", "~"], [], dataDir)).toEqual([
			null,
			null,
		]);
		expect(await locateWorktreeEntries("w1", ["~/sub/y.py", "~/src"], [], root)).toEqual([
			{ kind: "file", path: "sub/y.py" },
			{ kind: "dir", path: "src" },
		]);
		expect(await locateWorktreeEntries("w1", ["~/worktree/launcher.py"], [], dataDir)).toEqual([
			{ kind: "file", path: "launcher.py" },
		]);
	});

	test("git metadata and the worktree root itself are never answers", async () => {
		expect(await locateWorktreeEntries("w1", [".git/config", ".git", ".", "./", root], [])).toEqual(
			[null, null, null, null, null],
		);
	});

	test("a base reported in canonical form still matches the stored root", async () => {
		const canonicalSub = join(realpathSync(root), "sub");
		expect(await locateWorktreeEntries("w1", ["y.py"], [canonicalSub])).toEqual([
			{ kind: "file", path: "sub/y.py" },
		]);
	});

	test("relative bases are ignored rather than resolved against the host's cwd", async () => {
		expect(await locateWorktreeEntries("w1", ["y.py"], ["sub"])).toEqual([null]);
	});

	test("names with spaces are looked up as given", async () => {
		expect(await locateWorktreeEntries("w1", ["my file.ts"], [])).toEqual([
			{ kind: "file", path: "my file.ts" },
		]);
	});

	test("the shell is not asked for its directories when every path is anchored", async () => {
		let asked = 0;
		const bases = async () => {
			asked += 1;
			return [join(root, "sub")];
		};
		expect(
			await locate("w1", [join(root, "launcher.py"), "~/src", "/etc/hosts"], bases, root),
		).toEqual([{ kind: "file", path: "launcher.py" }, { kind: "dir", path: "src" }, null]);
		expect(asked).toBe(0);
		expect(await locate("w1", ["~/src", "y.py"], bases, root)).toEqual([
			{ kind: "dir", path: "src" },
			{ kind: "file", path: "sub/y.py" },
		]);
		expect(asked).toBe(1);
	});

	test("a base provider that fails leaves the worktree root", async () => {
		expect(
			await locate("w1", ["launcher.py", "y.py"], () => Promise.reject(new Error("probe failed"))),
		).toEqual([{ kind: "file", path: "launcher.py" }, null]);
	});

	test("an unknown workspace is an error", async () => {
		await expect(locateWorktreeEntries("nope", ["a.ts"], [])).rejects.toThrow("Unknown workspace");
	});

	test("malformed candidate lists are rejected", async () => {
		const reject = (candidates: unknown) =>
			expect(locateWorktreeEntries("w1", candidates as string[], [])).rejects.toThrow(
				"Invalid path candidates",
			);
		await reject("src");
		await reject([1]);
		await reject([""]);
		await reject(["x".repeat(MAX_TERMINAL_PATH_LENGTH + 1)]);
		await reject(Array.from({ length: MAX_TERMINAL_PATH_CANDIDATES + 1 }, () => "a.ts"));
		expect(
			await locateWorktreeEntries(
				"w1",
				Array.from({ length: MAX_TERMINAL_PATH_CANDIDATES }, () => "launcher.py"),
				[],
			),
		).toHaveLength(MAX_TERMINAL_PATH_CANDIDATES);
	});
});

const symlinkTest = process.platform === "win32" ? test.skip : test;

symlinkTest("a symlink is followed only while its target stays inside the worktree", async () => {
	symlinkSync(join(root, "src"), join(root, "srclink"));
	symlinkSync(outside, join(root, "escape"));
	symlinkSync(join(outside, "secret.txt"), join(root, "leak.txt"));
	expect(
		await locateWorktreeEntries(
			"w1",
			["srclink/auth/login.ts", "escape/secret.txt", "escape", "leak.txt"],
			[],
		),
	).toEqual([{ kind: "file", path: "srclink/auth/login.ts" }, null, null, null]);
});
