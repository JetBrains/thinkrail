import { afterEach, beforeEach, expect, test } from "bun:test";
import { existsSync, mkdtempSync, realpathSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { listProjects, setProjectPublisher } from "../projects";
import { DEMO_APP_DIR, demoProjectPath, ensureDemoProject, removeDemoFiles } from "./demo";

function gitOut(cwd: string, ...args: string[]): string {
	const r = Bun.spawnSync(["git", "-C", cwd, ...args], { stdout: "pipe", stderr: "ignore" });
	return new TextDecoder().decode(r.stdout).trim();
}

let dataDir: string;
const savedDataDir = process.env.THINKRAIL_DATA_DIR;

beforeEach(() => {
	dataDir = mkdtempSync(join(tmpdir(), "trpi-demo-test-"));
	process.env.THINKRAIL_DATA_DIR = dataDir;
});

afterEach(() => {
	setProjectPublisher(null);
	rmSync(dataDir, { recursive: true, force: true });
	if (savedDataDir === undefined) delete process.env.THINKRAIL_DATA_DIR;
	else process.env.THINKRAIL_DATA_DIR = savedDataDir;
});

test("demoProjectPath is dataDir/demo/to-do-app, never under worktrees", () => {
	expect(demoProjectPath()).toBe(join(dataDir, "demo", DEMO_APP_DIR));
});

test("ensureDemoProject copies the template, inits a real repo, and opens it", () => {
	const project = ensureDemoProject();

	expect(project.path).toBe(realpathSync(demoProjectPath()));
	expect(project.name).toBe("To Do App");
	expect(project.slug).toBe("to-do-app");
	expect(existsSync(join(demoProjectPath(), "index.html"))).toBe(true);
	expect(existsSync(join(demoProjectPath(), "src", "app.js"))).toBe(true);
	expect(gitOut(demoProjectPath(), "rev-parse", "HEAD")).not.toBe("");
	const tracked = gitOut(demoProjectPath(), "ls-tree", "-r", "HEAD", "--name-only");
	expect(tracked).toContain("index.html");
	expect(tracked).toContain("SPEC.md");
	expect(listProjects().map((p) => p.id)).toEqual([project.id]);
});

test("ensureDemoProject is idempotent — a second call reopens the same project", () => {
	const first = ensureDemoProject();
	const second = ensureDemoProject();

	expect(second.id).toBe(first.id);
	expect(listProjects()).toHaveLength(1);
});

test("removeDemoFiles deletes the user-local copy", () => {
	ensureDemoProject();
	expect(existsSync(demoProjectPath())).toBe(true);

	removeDemoFiles();
	expect(existsSync(demoProjectPath())).toBe(false);
});
