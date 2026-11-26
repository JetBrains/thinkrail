import { afterEach, beforeEach, expect, test } from "bun:test";
import {
	existsSync,
	mkdirSync,
	mkdtempSync,
	readdirSync,
	readFileSync,
	realpathSync,
	rmSync,
	utimesSync,
	writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { basename, dirname, join } from "node:path";
import { previewRefPaths } from "./refPreview";

const ROOTS = [".agents/skills", ".claude/skills", ".pi/prompts"];

let dataDir: string;
let repo: string;
const savedDataDir = process.env.THINKRAIL_DATA_DIR;

function git(cwd: string, ...args: string[]): string {
	const result = Bun.spawnSync(["git", "-C", cwd, ...args], { stdout: "pipe", stderr: "pipe" });
	if (!result.success) throw new Error(`git ${args.join(" ")} failed: ${result.stderr}`);
	return new TextDecoder().decode(result.stdout).trim();
}

function write(path: string, content: string) {
	mkdirSync(dirname(path), { recursive: true });
	writeFileSync(path, content);
}

function commitAll(message: string) {
	git(repo, "add", "-A");
	git(repo, "commit", "-m", message);
}

beforeEach(() => {
	dataDir = realpathSync.native(mkdtempSync(join(tmpdir(), "trpi-ref-preview-")));
	process.env.THINKRAIL_DATA_DIR = dataDir;
	repo = join(dataDir, "repo");
	mkdirSync(repo);
	git(repo, "init", "-b", "main");
	git(repo, "config", "user.email", "t@thinkrail.test");
	git(repo, "config", "user.name", "test");
	git(repo, "config", "commit.gpgsign", "false");
	write(join(repo, "README.md"), "# repo\n");
	commitAll("init");
});

afterEach(() => {
	rmSync(dataDir, { recursive: true, force: true });
	if (savedDataDir === undefined) delete process.env.THINKRAIL_DATA_DIR;
	else process.env.THINKRAIL_DATA_DIR = savedDataDir;
});

const project = () => ({ id: "p1", path: repo });

test("a preview holds the roots as they are at the ref, not the current checkout", async () => {
	git(repo, "switch", "-c", "next");
	write(join(repo, ".agents/skills/upgrade/SKILL.md"), "---\nname: upgrade\n---\n");
	write(join(repo, ".pi/prompts/ship.md"), "ship it\n");
	write(join(repo, "src/app.ts"), "export {};\n");
	commitAll("add skill");
	git(repo, "switch", "main");
	write(join(repo, ".claude/skills/local/SKILL.md"), "---\nname: local\n---\n");

	const dir = await previewRefPaths(project(), "next", ROOTS);

	expect(dir).not.toBeNull();
	if (!dir) return;
	expect(readFileSync(join(dir, ".agents/skills/upgrade/SKILL.md"), "utf8")).toContain("upgrade");
	expect(readFileSync(join(dir, ".pi/prompts/ship.md"), "utf8")).toBe("ship it\n");
	expect(existsSync(join(dir, ".claude/skills"))).toBe(false);
	expect(existsSync(join(dir, "src"))).toBe(false);
	expect(existsSync(join(dir, ".git"))).toBe(true);
	expect(existsSync(join(dir, ".git", "index"))).toBe(false);
	expect(git(repo, "status", "--porcelain")).toBe("?? .claude/");
});

test("a remote base resolves through its tracking ref, never a same-named local branch", async () => {
	const upstream = join(dataDir, "upstream");
	git(dataDir, "clone", "-q", repo, upstream);
	git(upstream, "config", "user.email", "t@thinkrail.test");
	git(upstream, "config", "user.name", "test");
	write(join(upstream, ".agents/skills/remote/SKILL.md"), "---\nname: remote\n---\n");
	git(upstream, "add", "-A");
	git(upstream, "commit", "-m", "remote skill");
	git(repo, "remote", "add", "origin", upstream);
	git(repo, "fetch", "-q", "origin");
	git(repo, "branch", "origin/main", "main");

	const dir = await previewRefPaths(project(), "origin/main", ROOTS);

	expect(dir && existsSync(join(dir, ".agents/skills/remote/SKILL.md"))).toBe(true);
});

test("the same commit reuses one preview and an unknown or unsafe ref yields none", async () => {
	const first = await previewRefPaths(project(), "main", ROOTS);
	const again = await previewRefPaths(project(), "HEAD", ROOTS);
	expect(first).not.toBeNull();
	expect(again).toBe(first);
	expect(await previewRefPaths(project(), "missing", ROOTS)).toBeNull();
	expect(await previewRefPaths(project(), "--output=x", ROOTS)).toBeNull();
});

test("previews beyond the newest few, and orphaned staging folders, are pruned once idle", async () => {
	const previewOf = async (i: number) => {
		write(join(repo, `file-${i}.txt`), `${i}\n`);
		commitAll(`c${i}`);
		return (await previewRefPaths(project(), "main", ROOTS)) ?? "";
	};
	const first = await previewOf(0);
	const root = dirname(first);
	for (let i = 1; i < 6; i++) await previewOf(i);
	expect(readdirSync(root).length).toBe(6);

	mkdirSync(join(root, "orphan.tmp-1"));
	const idle = new Date(Date.now() - 60 * 60_000);
	for (const name of readdirSync(root)) utimesSync(join(root, name), idle, idle);
	await previewRefPaths(project(), first.slice(root.length + 1), ROOTS);
	const newest = await previewOf(6);

	const kept = readdirSync(root);
	expect(kept.length).toBe(4);
	expect(kept).toContain(basename(newest));
	expect(kept).toContain(basename(first));
	expect(kept).not.toContain("orphan.tmp-1");
});
