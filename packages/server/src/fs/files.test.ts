import { afterEach, beforeEach, expect, test } from "bun:test";
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, sep } from "node:path";
import { readDir, readFile, resolveWorktreeFile, workspaceRelativePath } from "./files";

let dataDir: string;
let root: string;
const savedDataDir = process.env.THINKRAIL_DATA_DIR;

beforeEach(() => {
	dataDir = mkdtempSync(join(tmpdir(), "trpi-fs-test-"));
	process.env.THINKRAIL_DATA_DIR = dataDir;
	root = join(dataDir, "worktree");
	mkdirSync(join(root, "src", "auth"), { recursive: true });
	writeFileSync(join(root, "src", "auth", "login.ts"), "export {};\n");
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

test("readDir reports worktree-relative paths with forward slashes on every platform", () => {
	expect(readDir("w1", ".").map((node) => node.path)).toEqual(["src"]);
	expect(readDir("w1", "src").map((node) => node.path)).toEqual(["src/auth"]);
	expect(readDir("w1", "src/auth").map((node) => node.path)).toEqual(["src/auth/login.ts"]);
});

test("workspaceRelativePath names a contained path worktree-relative with / separators", () => {
	expect(workspaceRelativePath(root, join(root, "src", "auth", "login.ts"))).toBe(
		"src/auth/login.ts",
	);
	expect(workspaceRelativePath(root, join("src", "auth", "login.ts"))).toBe("src/auth/login.ts");
	expect(workspaceRelativePath(root, "./src/../src/auth")).toBe("src/auth");
	expect(workspaceRelativePath(`${root}${sep}.`, "src")).toBe("src");
	expect(workspaceRelativePath(root, "..env")).toBe("..env");
	expect(workspaceRelativePath(root, ".")).toBe("");
});

test("workspaceRelativePath rejects a path outside the worktree", () => {
	expect(workspaceRelativePath(root, "../worktree-sibling/a.ts")).toBeNull();
	expect(workspaceRelativePath(root, join(dataDir, "elsewhere"))).toBeNull();
});

test("readFile and resolveWorktreeFile refuse .git and nested .git paths", () => {
	for (const candidate of [".git", ".git/config", "src/nested/.git/config"]) {
		expect(() => readFile("w1", candidate)).toThrow("The .git directory is not readable");
		expect(() => resolveWorktreeFile("w1", candidate)).toThrow(
			"The .git directory is not readable",
		);
	}
});

test("readDir refuses .git and filters it from listings", () => {
	expect(() => readDir("w1", ".git")).toThrow("The .git directory is not readable");

	mkdirSync(join(root, ".git"), { recursive: true });
	writeFileSync(join(root, ".gitignore"), "# ignore\n");

	const top = readDir("w1", ".").map((node) => node.name);
	expect(top).toContain("src");
	expect(top).toContain(".gitignore");
	expect(top).not.toContain(".git");
});

test.skipIf(process.platform !== "win32")(
	"readFile and resolveWorktreeFile refuse NTFS .git aliases on Windows",
	() => {
		const aliases = [
			".GIT",
			".GIT/config",
			".Git/HEAD",
			"GIT~1",
			"GIT~1/config",
			"git~1/HEAD",
			"GIT~2/config",
			".git.",
			".git./config",
			".git ",
			".git /config",
			".git::$INDEX_ALLOCATION",
			".git::$INDEX_ALLOCATION/config",
			"GIT~1::$INDEX_ALLOCATION",
			"src/nested/GIT~1/config",
			".GIT/nonexistent.txt",
			"GIT~1/nonexistent.txt",
		];
		for (const candidate of aliases) {
			expect(() => readFile("w1", candidate)).toThrow("The .git directory is not readable");
			expect(() => resolveWorktreeFile("w1", candidate)).toThrow(
				"The .git directory is not readable",
			);
		}
	},
);

test.skipIf(process.platform !== "win32")(
	"readDir refuses NTFS .git aliases on Windows and hides .git from root listings",
	() => {
		mkdirSync(join(root, ".git"), { recursive: true });
		writeFileSync(join(root, ".gitignore"), "# ignore\n");

		expect(() => readDir("w1", ".GIT")).toThrow("The .git directory is not readable");
		expect(() => readDir("w1", "GIT~1")).toThrow("The .git directory is not readable");
		expect(() => readDir("w1", ".git.")).toThrow("The .git directory is not readable");
		expect(() => readDir("w1", ".git ")).toThrow("The .git directory is not readable");

		const top = readDir("w1", ".").map((node) => node.name);
		expect(top).toContain("src");
		expect(top).toContain(".gitignore");
		expect(top).not.toContain(".git");
	},
);
