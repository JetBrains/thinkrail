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

const symlinkTest = process.platform === "win32" ? test.skip : test;

symlinkTest("readDir classifies symlinks by target and refuses escaping ones", () => {
	mkdirSync(join(root, "real"));
	writeFileSync(join(root, "real", "a.ts"), "");
	mkdirSync(join(dataDir, "outside"));
	symlinkSync(join(root, "real"), join(root, "dirlink"));
	symlinkSync(join(root, "real", "a.ts"), join(root, "filelink"));
	symlinkSync(join(root, "missing"), join(root, "dangling"));
	symlinkSync(join(dataDir, "outside"), join(root, "escape"));
	const kinds = Object.fromEntries(readDir("w1", ".").map((n) => [n.name, n.kind]));
	expect(kinds).toMatchObject({
		real: "dir",
		dirlink: "dir",
		filelink: "file",
		dangling: "file",
		escape: "file",
	});
	expect(readDir("w1", "dirlink").map((n) => n.path)).toEqual(["dirlink/a.ts"]);
	expect(() => readDir("w1", "escape")).toThrow("escapes");
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

test("readFile with maxBytes reads at most the cap and refuses a larger file, contained as before", () => {
	writeFileSync(join(root, "exact.txt"), "12345");
	expect(readFile("w1", "exact.txt", { maxBytes: 5 }).content).toBe("12345");
	expect(readFile("w1", "exact.txt", { maxBytes: 6 }).meta.byteLength).toBe(5);
	expect(() => readFile("w1", "exact.txt", { maxBytes: 4 })).toThrow(
		expect.objectContaining({ code: "FILE_TOO_LARGE" }),
	);
	writeFileSync(join(root, "empty.txt"), "");
	expect(readFile("w1", "empty.txt", { maxBytes: 0 }).content).toBe("");
	expect(() => readFile("w1", "exact.txt", { maxBytes: 0 })).toThrow(
		expect.objectContaining({ code: "FILE_TOO_LARGE" }),
	);
	expect(() => readFile("w1", "exact.txt", { maxBytes: -1 })).toThrow("non-negative integer");
	expect(() => readFile("w1", "exact.txt", { maxBytes: 1.5 })).toThrow("non-negative integer");
	writeFileSync(join(dataDir, "outside.txt"), "secret");
	expect(() => readFile("w1", "../outside.txt", { maxBytes: 100 })).toThrow();
	const big = 200 * 1024;
	writeFileSync(join(root, "big.txt"), "y".repeat(big));
	expect(readFile("w1", "big.txt", { maxBytes: big }).meta.byteLength).toBe(big);
	expect(() => readFile("w1", "big.txt", { maxBytes: big - 1 })).toThrow(
		expect.objectContaining({ code: "FILE_TOO_LARGE" }),
	);
	writeFileSync(
		join(root, "picture.png"),
		Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
	);
	expect(readFile("w1", "picture.png", { maxBytes: 100 })).toMatchObject({
		content: "",
		meta: { text: false },
	});
});
