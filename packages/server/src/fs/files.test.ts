import { afterEach, beforeEach, expect, test } from "bun:test";
import { mkdirSync, mkdtempSync, rmSync, symlinkSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, sep } from "node:path";
import { readableFileSize, readDir, readFile, workspaceRelativePath } from "./files";

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

test("readableFileSize answers a regular file's size and missing for what readFile would not serve", () => {
	mkdirSync(join(root, ".git"));
	writeFileSync(join(root, ".git", "HEAD"), "ref: refs/heads/main\n");
	writeFileSync(join(dataDir, "outside.txt"), "secret");
	expect(readableFileSize(root, "src/auth/login.ts")).toBe(11);
	expect(readableFileSize(root, "src/auth")).toBe("missing");
	expect(readableFileSize(root, "src/auth/gone.ts")).toBe("missing");
	expect(readableFileSize(root, "src/auth/login.ts/below")).toBe("missing");
	expect(readableFileSize(root, ".git/HEAD")).toBe("missing");
	expect(readableFileSize(root, "../outside.txt")).toBe("missing");
});

test.skipIf(process.platform === "win32")(
	"readableFileSize follows a symlink only as far as readFile does: inside the worktree it is the target's size, out of it or into .git it is missing",
	() => {
		mkdirSync(join(root, ".git"));
		writeFileSync(join(root, ".git", "config"), "[core]\n");
		writeFileSync(join(dataDir, "outside.txt"), "secret");
		symlinkSync(join(root, "src", "auth", "login.ts"), join(root, "inside-link.ts"));
		symlinkSync(join(dataDir, "outside.txt"), join(root, "outside-link.txt"));
		symlinkSync(join(root, ".git", "config"), join(root, "metadata-link"));
		symlinkSync(join(root, "src"), join(root, "dir-link"));
		symlinkSync(join(root, "nowhere.ts"), join(root, "dangling-link.ts"));
		symlinkSync(join(root, "loop-b"), join(root, "loop-a"));
		symlinkSync(join(root, "loop-a"), join(root, "loop-b"));

		expect(readableFileSize(root, "inside-link.ts")).toBe(11);
		expect(readFile("w1", "inside-link.ts").content).toBe("export {};\n");
		for (const path of ["outside-link.txt", "metadata-link", "dangling-link.ts", "loop-a"]) {
			expect(readableFileSize(root, path)).toBe("missing");
			expect(() => readFile("w1", path)).toThrow();
		}
		expect(readableFileSize(root, "dir-link")).toBe("missing");
	},
);
