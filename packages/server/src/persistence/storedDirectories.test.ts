import { afterEach, beforeEach, expect, test } from "bun:test";
import { mkdtempSync, readFileSync, realpathSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, relative, resolve, sep } from "node:path";
import { dataDir, loadProjects, loadWorkspaces, saveProjects, saveWorkspaces } from "./persistence";

let root: string;
const savedDataDir = process.env.THINKRAIL_DATA_DIR;

beforeEach(() => {
	root = realpathSync(mkdtempSync(join(tmpdir(), "trpi-stored-dirs-")));
	process.env.THINKRAIL_DATA_DIR = root;
});

afterEach(() => {
	rmSync(root, { recursive: true, force: true });
	if (savedDataDir === undefined) delete process.env.THINKRAIL_DATA_DIR;
	else process.env.THINKRAIL_DATA_DIR = savedDataDir;
});

function unresolvedSpellings(dir: string): string[] {
	return [`${dir}${sep}.${sep}`, dir.split(sep).join("/")];
}

function project(path: unknown) {
	return { id: "p", name: "repo", path, slug: "repo", lastOpened: 1 };
}

function workspace(worktreePath: unknown) {
	return {
		id: "w",
		projectId: "p",
		kind: "default",
		name: "Default",
		branch: "main",
		worktreePath,
		baseBranch: "main",
	};
}

test("a stored directory loads in the host's resolved spelling, however it was written", () => {
	const dir = join(root, "repo");
	for (const spelling of unresolvedSpellings(dir)) {
		writeFileSync(join(root, "projects.json"), JSON.stringify([project(spelling)]));
		writeFileSync(join(root, "workspaces.json"), JSON.stringify([workspace(spelling)]));

		expect(loadProjects()[0]?.path).toBe(resolve(dir));
		expect(loadWorkspaces()[0]?.worktreePath).toBe(resolve(dir));
	}
});

test("the next save persists the healed spelling", () => {
	const dir = join(root, "repo");
	const [spelling] = unresolvedSpellings(dir);
	writeFileSync(join(root, "projects.json"), JSON.stringify([project(spelling)]));
	writeFileSync(join(root, "workspaces.json"), JSON.stringify([workspace(spelling)]));

	saveProjects(loadProjects());
	saveWorkspaces(loadWorkspaces());

	expect(JSON.parse(readFileSync(join(root, "projects.json"), "utf8"))[0].path).toBe(resolve(dir));
	expect(JSON.parse(readFileSync(join(root, "workspaces.json"), "utf8"))[0].worktreePath).toBe(
		resolve(dir),
	);
});

test("a value that is not an absolute path on this host is left as stored", () => {
	const foreign = process.platform === "win32" ? "relative/repo" : "C:\\Users\\me\\repo";
	writeFileSync(
		join(root, "projects.json"),
		JSON.stringify([project(foreign), { id: "no-path", name: "x", slug: "x", lastOpened: 1 }]),
	);
	writeFileSync(join(root, "workspaces.json"), JSON.stringify([workspace(foreign)]));

	const [stored, pathless] = loadProjects();
	expect(stored?.path).toBe(foreign);
	expect(pathless?.path).toBeUndefined();
	expect(loadWorkspaces()[0]?.worktreePath).toBe(foreign);
});

test("a relative THINKRAIL_DATA_DIR still names one absolute data directory", () => {
	process.env.THINKRAIL_DATA_DIR = relative(process.cwd(), root);
	expect(dataDir()).toBe(root);
});
