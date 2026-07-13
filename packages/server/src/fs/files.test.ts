import { afterEach, beforeEach, expect, test } from "bun:test";
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createWorkspace } from "../workspaces";
import { readFile, writeFile } from "./files";

let dataDir: string;
let repo: string;
let wsId: string;
const savedDataDir = process.env.THINKRAIL_DATA_DIR;

function git(cwd: string, ...args: string[]): void {
	const r = Bun.spawnSync(["git", "-C", cwd, ...args], { stdout: "ignore", stderr: "ignore" });
	if (!r.success) throw new Error(`git ${args.join(" ")} failed`);
}

beforeEach(async () => {
	dataDir = mkdtempSync(join(tmpdir(), "trpi-fs-test-"));
	process.env.THINKRAIL_DATA_DIR = dataDir;
	repo = join(dataDir, "repo");
	mkdirSync(repo);
	git(repo, "init", "-b", "main");
	git(repo, "config", "user.email", "t@thinkrail.test");
	git(repo, "config", "user.name", "test");
	writeFileSync(join(repo, "README.md"), "# repo\n");
	git(repo, "add", "-A");
	git(repo, "commit", "-m", "init");
	writeFileSync(
		join(dataDir, "projects.json"),
		JSON.stringify([{ id: "p1", name: "repo", path: repo, slug: "repo", lastOpened: 1 }]),
	);
	wsId = (await createWorkspace("p1")).id;
});

afterEach(() => {
	rmSync(dataDir, { recursive: true, force: true });
	if (savedDataDir === undefined) delete process.env.THINKRAIL_DATA_DIR;
	else process.env.THINKRAIL_DATA_DIR = savedDataDir;
});

test("writeFile persists new content and readFile sees it", () => {
	writeFile(wsId, "README.md", "# changed\n");
	expect(readFile(wsId, "README.md").content).toBe("# changed\n");
});

test("writeFile refuses a path that escapes the worktree", () => {
	expect(() => writeFile(wsId, "../escape.txt", "x")).toThrow(/escapes the worktree/);
});

test("writeFile with matching ifMatchContent succeeds", () => {
	writeFile(wsId, "README.md", "# v2\n", "# repo\n");
	expect(readFile(wsId, "README.md").content).toBe("# v2\n");
});

test("writeFile with stale ifMatchContent throws and does not write", () => {
	expect(() => writeFile(wsId, "README.md", "# v2\n", "# STALE\n")).toThrow(/changed on disk/);
	expect(readFile(wsId, "README.md").content).toBe("# repo\n");
});
