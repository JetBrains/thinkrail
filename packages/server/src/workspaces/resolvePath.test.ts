import { afterEach, beforeEach, expect, test } from "bun:test";
import {
	existsSync,
	mkdirSync,
	mkdtempSync,
	realpathSync,
	rmSync,
	symlinkSync,
	writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { resolveWorkspacePath } from "./resolvePath";
import { listWorkspaceRecords } from "./workspaces";

const canSymlink = (() => {
	const probe = mkdtempSync(join(tmpdir(), "trpi-symlink-probe-"));
	try {
		symlinkSync(probe, join(probe, "link"));
		return true;
	} catch {
		return false;
	} finally {
		rmSync(probe, { recursive: true, force: true });
	}
})();

const tmpFoldsCase = (() => {
	const probe = mkdtempSync(join(tmpdir(), "trpi-case-probe-"));
	try {
		mkdirSync(join(probe, "CaseProbe"));
		return existsSync(join(probe, "caseprobe"));
	} finally {
		rmSync(probe, { recursive: true, force: true });
	}
})();

const linked = test.skipIf(!canSymlink);

let base: string;
let dataDir: string;
const savedDataDir = process.env.THINKRAIL_DATA_DIR;

interface Row {
	id: string;
	projectId: string;
	path: string;
	kind?: "default" | "external";
	deletionPending?: true;
}

function register(projects: { id: string; path: string; closed?: true }[], rows: Row[]): void {
	writeFileSync(
		join(dataDir, "projects.json"),
		JSON.stringify(
			projects.map((project, rank) => ({
				...project,
				name: project.id,
				slug: project.id,
				lastOpened: rank,
			})),
		),
	);
	writeFileSync(
		join(dataDir, "workspaces.json"),
		JSON.stringify(
			rows.map(({ path, ...row }) => ({
				...row,
				name: row.id,
				branch: row.id,
				baseBranch: "main",
				worktreePath: path,
			})),
		),
	);
}

function file(path: string): string {
	mkdirSync(dirname(path), { recursive: true });
	writeFileSync(path, "x\n");
	return path;
}

function project(id: string, path: string): Row {
	mkdirSync(path, { recursive: true });
	return { id: `${id}-default`, projectId: id, path, kind: "default" };
}

beforeEach(() => {
	base = realpathSync.native(mkdtempSync(join(tmpdir(), "trpi-resolve-path-")));
	dataDir = join(base, "data");
	process.env.THINKRAIL_DATA_DIR = dataDir;
	mkdirSync(dataDir);
});

afterEach(() => {
	rmSync(base, { recursive: true, force: true });
	if (savedDataDir === undefined) delete process.env.THINKRAIL_DATA_DIR;
	else process.env.THINKRAIL_DATA_DIR = savedDataDir;
});

linked(
	"a project opened through a symlinked folder owns the real path a tool reports",
	async () => {
		const real = join(base, "volume", "repo");
		const spelled = join(base, "code", "repo");
		mkdirSync(join(base, "volume"));
		symlinkSync(join(base, "volume"), join(base, "code"));
		register([{ id: "p1", path: spelled }], [project("p1", spelled)]);
		file(join(real, "src", "a.ts"));

		expect(await resolveWorkspacePath(join(real, "src", "a.ts"))).toEqual({
			workspaceId: "p1-default",
			projectId: "p1",
			relativePath: "src/a.ts",
		});
	},
);

linked("a project opened by its real path owns a path spelled through a symlink", async () => {
	const real = join(base, "volume", "repo");
	symlinkSync(join(base, "volume"), join(base, "code"));
	register([{ id: "p1", path: real }], [project("p1", real)]);
	file(join(real, "src", "a.ts"));

	expect(await resolveWorkspacePath(join(base, "code", "repo", "src", "a.ts"))).toMatchObject({
		workspaceId: "p1-default",
		relativePath: "src/a.ts",
	});
});

linked(
	"a /tmp-spelled worktree and a /private/tmp-spelled project both resolve from either spelling",
	async () => {
		const privateTmp = join(base, "private", "tmp");
		mkdirSync(privateTmp, { recursive: true });
		symlinkSync(privateTmp, join(base, "tmp"));
		const repo = join(privateTmp, "tr", "proj");
		const worktree = join(base, "tmp", "tr", "data", "worktrees", "proj", "workspace-1");
		register(
			[{ id: "p1", path: repo }],
			[project("p1", repo), { id: "wt", projectId: "p1", path: worktree }],
		);
		mkdirSync(worktree, { recursive: true });
		file(join(repo, "src", "a.ts"));
		file(join(worktree, "src", "b.ts"));

		for (const root of [join(base, "tmp"), privateTmp]) {
			expect(await resolveWorkspacePath(join(root, "tr", "proj", "src", "a.ts"))).toMatchObject({
				workspaceId: "p1-default",
				relativePath: "src/a.ts",
			});
			const inWorktree = join(
				root,
				"tr",
				"data",
				"worktrees",
				"proj",
				"workspace-1",
				"src",
				"b.ts",
			);
			expect(await resolveWorkspacePath(inWorktree)).toMatchObject({
				workspaceId: "wt",
				projectId: "p1",
				relativePath: "src/b.ts",
			});
		}
	},
);

test("the most specific open root wins, whichever project is listed first", async () => {
	const outer = join(base, "repo");
	const inner = join(outer, "packages", "app");
	register(
		[
			{ id: "outer", path: outer },
			{ id: "inner", path: inner },
		],
		[project("outer", outer), project("inner", inner)],
	);

	expect(await resolveWorkspacePath(file(join(inner, "src", "a.ts")))).toEqual({
		workspaceId: "inner-default",
		projectId: "inner",
		relativePath: "src/a.ts",
	});
	expect(await resolveWorkspacePath(file(join(outer, "src", "a.ts")))).toMatchObject({
		workspaceId: "outer-default",
		relativePath: "src/a.ts",
	});
});

linked("a missing file inside a root still names its workspace", async () => {
	const real = join(base, "volume", "repo");
	symlinkSync(join(base, "volume"), join(base, "code"));
	register([{ id: "p1", path: real }], [project("p1", real)]);

	expect(await resolveWorkspacePath(join(real, "gone", "deep", "a.ts"))).toMatchObject({
		workspaceId: "p1-default",
		relativePath: "gone/deep/a.ts",
	});
	expect(await resolveWorkspacePath(join(base, "code", "repo", "missing.ts"))).toMatchObject({
		workspaceId: "p1-default",
		relativePath: "missing.ts",
	});
});

test("a path outside every open workspace answers null", async () => {
	const repo = join(base, "repo");
	const closed = join(base, "closed");
	const doomed = join(base, "doomed");
	register(
		[
			{ id: "p1", path: repo },
			{ id: "p2", path: closed, closed: true },
		],
		[
			project("p1", repo),
			project("p2", closed),
			{ id: "doomed", projectId: "p1", path: doomed, deletionPending: true },
		],
	);
	mkdirSync(doomed);

	expect(await resolveWorkspacePath(file(join(base, "repo-other", "a.ts")))).toBeNull();
	expect(await resolveWorkspacePath(file(join(base, "elsewhere", "a.ts")))).toBeNull();
	expect(await resolveWorkspacePath(file(join(closed, "a.ts")))).toBeNull();
	expect(await resolveWorkspacePath(file(join(doomed, "a.ts")))).toBeNull();
});

test("refuses a relative path, a .. segment, the .git directory and a root itself", async () => {
	const repo = join(base, "repo");
	register([{ id: "p1", path: repo }], [project("p1", repo)]);
	file(join(repo, "a.ts"));
	file(join(repo, ".git", "config"));

	expect(await resolveWorkspacePath("repo/a.ts")).toBeNull();
	expect(await resolveWorkspacePath(`${repo}/src/../a.ts`)).toBeNull();
	expect(await resolveWorkspacePath(`${repo}/../repo/a.ts`)).toBeNull();
	expect(await resolveWorkspacePath(join(repo, ".git", "config"))).toBeNull();
	expect(await resolveWorkspacePath(repo)).toBeNull();
	expect(await resolveWorkspacePath(join(repo, "a.ts"))).toMatchObject({ relativePath: "a.ts" });
});

test.skipIf(!tmpFoldsCase)(
	"a case-insensitive filesystem matches a root spelled in another case",
	async () => {
		const repo = join(base, "Repo");
		register([{ id: "p1", path: repo }], [project("p1", repo)]);
		file(join(repo, "src", "a.ts"));

		expect(await resolveWorkspacePath(join(base, "REPO", "src", "a.ts"))).toMatchObject({
			workspaceId: "p1-default",
			relativePath: "src/a.ts",
		});
	},
);

test.skipIf(tmpFoldsCase)("a case-sensitive filesystem never folds a root's case", async () => {
	const repo = join(base, "Repo");
	register([{ id: "p1", path: repo }], [project("p1", repo)]);
	file(join(repo, "src", "a.ts"));

	expect(await resolveWorkspacePath(join(base, "REPO", "src", "a.ts"))).toBeNull();
});

test("an open project whose Default was never listed gets it ensured", async () => {
	const repo = join(base, "repo");
	mkdirSync(repo);
	for (const args of [
		["init", "-b", "main"],
		["commit", "--allow-empty", "-m", "init"],
	]) {
		const result = Bun.spawnSync(
			["git", "-C", repo, "-c", "user.email=t@thinkrail.test", "-c", "user.name=test", ...args],
			{ stdout: "ignore", stderr: "ignore" },
		);
		if (!result.success) throw new Error(`git ${args.join(" ")} failed`);
	}
	register([{ id: "p1", path: repo }], []);

	const found = await resolveWorkspacePath(file(join(repo, "src", "a.ts")));
	expect(found).toMatchObject({ projectId: "p1", relativePath: "src/a.ts" });
	expect(listWorkspaceRecords("p1").map(({ id, kind }) => ({ id, kind }))).toEqual([
		{ id: found?.workspaceId ?? "", kind: "default" },
	]);
});
