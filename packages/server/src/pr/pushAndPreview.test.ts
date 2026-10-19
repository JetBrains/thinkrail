import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import { mkdirSync, mkdtempSync, rmSync, symlinkSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { commitsAheadOf } from "../git";
import {
	discoverTemplates,
	gitlabNewMrUrl,
	gitlabProject,
	openPr,
	prDraftInput,
	previewPr,
	pushBranch,
} from "./pr";

const ISOLATED_GIT_ENV = {
	GIT_CONFIG_NOSYSTEM: "1",
	GIT_CONFIG_GLOBAL: process.platform === "win32" ? "NUL" : "/dev/null",
	GIT_CONFIG_COUNT: "1",
	GIT_CONFIG_KEY_0: "commit.gpgSign",
	GIT_CONFIG_VALUE_0: "false",
	GIT_ALLOW_PROTOCOL: "file",
} as const;

const saved = new Map<string, string | undefined>();
for (const key of [
	"THINKRAIL_DATA_DIR",
	"THINKRAIL_GH_OFFLINE",
	...Object.keys(ISOLATED_GIT_ENV),
]) {
	saved.set(key, process.env[key]);
}

let dataDir: string;
let repo: string;
let remote: string;

function sh(cwd: string, ...args: string[]): string {
	const result = Bun.spawnSync(["git", "-C", cwd, ...args], { env: process.env });
	if (!result.success) throw new Error(new TextDecoder().decode(result.stderr));
	return new TextDecoder().decode(result.stdout).trim();
}

function commit(file: string, message: string): void {
	writeFileSync(join(repo, file), `${message}\n`);
	sh(repo, "add", "-A");
	sh(repo, "commit", "-q", "-m", message);
}

function seedWorkspaces(rows: Record<string, unknown>[]): void {
	writeFileSync(
		join(dataDir, "projects.json"),
		JSON.stringify([{ id: "p1", name: "repo", path: repo, slug: "repo", lastOpened: 1 }]),
	);
	writeFileSync(
		join(dataDir, "workspaces.json"),
		JSON.stringify(
			rows.map((row) => ({ projectId: "p1", worktreePath: repo, createdAt: 1, ...row })),
		),
	);
}

beforeEach(() => {
	dataDir = mkdtempSync(join(tmpdir(), "trpi-push-preview-"));
	repo = join(dataDir, "repo");
	remote = join(dataDir, "remote.git");
	mkdirSync(repo);
	mkdirSync(remote);
	process.env.THINKRAIL_DATA_DIR = dataDir;
	process.env.THINKRAIL_GH_OFFLINE = "1";
	Object.assign(process.env, ISOLATED_GIT_ENV);
	sh(repo, "init", "-q", "-b", "main");
	sh(repo, "config", "user.email", "t@thinkrail.test");
	sh(repo, "config", "user.name", "test");
	commit("README.md", "init");
	sh(repo, "switch", "-q", "-c", "feature");
	commit("a.txt", "Add the ship segment");
	commit("b.txt", "Wire the push action");
	sh(remote, "init", "-q", "--bare");
	sh(repo, "remote", "add", "origin", remote);
	seedWorkspaces([{ id: "w1", name: "Feature", branch: "feature", baseBranch: "main" }]);
});

afterEach(() => {
	rmSync(dataDir, { recursive: true, force: true });
	for (const [key, value] of saved) {
		if (value === undefined) delete process.env[key];
		else process.env[key] = value;
	}
});

describe("commitsAheadOf", () => {
	test("counts the commits HEAD has over the base; an unresolvable or unsafe base is zero", async () => {
		expect(await commitsAheadOf(repo, "main")).toBe(2);
		expect(await commitsAheadOf(repo, "no-such-base")).toBe(0);
		expect(await commitsAheadOf(repo, "--all")).toBe(0);
	});
});

describe("pushBranch", () => {
	test("publishes the workspace branch to origin without touching any PR", async () => {
		writeFileSync(join(repo, "dirty.txt"), "uncommitted\n");
		const result = await pushBranch({ workspaceId: "w1" });
		expect(result).toEqual({ dirtyFiles: 1 });
		expect(sh(remote, "rev-parse", "refs/heads/feature")).toBe(sh(repo, "rev-parse", "HEAD"));
		expect(sh(repo, "rev-parse", "--abbrev-ref", "feature@{upstream}")).toBe("origin/feature");
	});

	test("refuses a branch that is its own base until the caller confirms it", async () => {
		sh(repo, "switch", "-q", "main");
		commit("c.txt", "Straight onto main");
		seedWorkspaces([
			{ id: "w0", kind: "default", name: "Default", branch: "main", baseBranch: "main" },
		]);
		await expect(pushBranch({ workspaceId: "w0" })).rejects.toThrow(/base branch/);
		expect(sh(remote, "for-each-ref", "refs/heads")).toBe("");
		await pushBranch({ workspaceId: "w0", confirmBase: true });
		expect(sh(remote, "rev-parse", "refs/heads/main")).toBe(sh(repo, "rev-parse", "HEAD"));
	});

	test("a repository without origin names the missing remote", async () => {
		sh(repo, "remote", "remove", "origin");
		await expect(pushBranch({ workspaceId: "w1" })).rejects.toThrow(/no 'origin' remote/);
	});
});

describe("previewPr sources and template discovery", () => {
	function writeTemplate(path: string, text: string): void {
		mkdirSync(join(repo, path, ".."), { recursive: true });
		writeFileSync(join(repo, path), text);
	}

	test("without a session the body defaults to the commit subjects, oldest first", async () => {
		const preview = await previewPr({ workspaceId: "w1" });
		expect(preview).toEqual({
			title: "feature",
			body: "- Add the ship segment\n- Wire the push action",
			templates: [],
			planAvailable: false,
			source: "commits",
		});
	});

	test("a chat without plan items defaults to commits but still offers its adopted-commit plan body", async () => {
		const preview = await previewPr({ workspaceId: "w1", sessionId: "s1" });
		expect(preview).toMatchObject({ planAvailable: true, source: "commits" });
		const plan = await previewPr({ workspaceId: "w1", sessionId: "s1", source: "plan" });
		expect(plan.body).toContain("## Committed outside the plan");
	});

	test("discovers GitHub and GitLab templates in a stable order and reads the chosen one", async () => {
		writeTemplate(".github/PULL_REQUEST_TEMPLATE.md", "## Problem\n\n## Approach\n");
		writeTemplate(".github/PULL_REQUEST_TEMPLATE/bugfix.md", "## Bug\n");
		writeTemplate("docs/pull_request_template.md", "## Docs\n");
		writeTemplate(".gitlab/merge_request_templates/Default.md", "## MR\n");
		writeTemplate(".github/PULL_REQUEST_TEMPLATE/notes.txt", "not markdown");
		const expected = [
			".github/PULL_REQUEST_TEMPLATE.md",
			"docs/pull_request_template.md",
			".github/PULL_REQUEST_TEMPLATE/bugfix.md",
			".gitlab/merge_request_templates/Default.md",
		];
		expect(await discoverTemplates(repo)).toEqual(expected);

		const first = await previewPr({ workspaceId: "w1", source: "template" });
		expect(first.body).toBe("## Problem\n\n## Approach");
		expect(first.templates).toEqual(expected);
		const chosen = await previewPr({
			workspaceId: "w1",
			source: "template",
			template: ".github/PULL_REQUEST_TEMPLATE/bugfix.md",
		});
		expect(chosen.body).toBe("## Bug");
		const unknown = await previewPr({ workspaceId: "w1", source: "template", template: "../x.md" });
		expect(unknown.body).toBe("");
	});

	test("a template reached through a symlink out of the worktree is never listed", async () => {
		const outside = join(dataDir, "outside");
		mkdirSync(outside);
		writeFileSync(join(outside, "pull_request_template.md"), "## Secret\n");
		symlinkSync(outside, join(repo, "docs"));
		expect(await discoverTemplates(repo)).toEqual([]);
	});

	test("the empty source is empty and the title honours an explicit one", async () => {
		expect(
			await previewPr({ workspaceId: "w1", source: "empty", title: " Ship it " }),
		).toMatchObject({
			title: "Ship it",
			body: "",
		});
	});
});

describe("openPr keeps its body source apart from the analytics source", () => {
	test("a plan-page push with no body still renders a body instead of an empty one", async () => {
		sh(repo, "remote", "set-url", "origin", "https://gitlab.com/acme/widgets.git");
		sh(repo, "remote", "set-url", "--push", "origin", remote);
		const wireParams = { workspaceId: "w1", source: "plan_page" };
		const result = await openPr(wireParams);
		expect(result.action).toBe("compare");
		expect(new URL(result.compareUrl ?? "").searchParams.get("merge_request[description]")).toBe(
			"- Add the ship segment\n- Wire the push action",
		);
	});
});

describe("prDraftInput", () => {
	test("gathers commits, a diff stat, and the requested template for the one-shot draft", async () => {
		mkdirSync(join(repo, ".github"));
		writeFileSync(join(repo, ".github", "pull_request_template.md"), "## Why\n");
		const input = await prDraftInput({
			workspaceId: "w1",
			template: ".github/pull_request_template.md",
		});
		expect(input.branch).toBe("feature");
		expect(input.base).toBe("main");
		expect(input.commits).toEqual(["Add the ship segment", "Wire the push action"]);
		expect(input.diffStat).toContain("a.txt");
		expect(input.diffStat).toContain("b.txt");
		expect(input.template).toBe("## Why");
		expect(input.plan).toBeUndefined();
	});
});

describe("gitlab new-MR hand-off", () => {
	test("project paths keep nested groups and the URL prefills source, target, title, description", () => {
		expect(gitlabProject("git@gitlab.com:acme/tools/widgets.git")).toBe("acme/tools/widgets");
		expect(gitlabProject("https://gitlab.com/acme/widgets")).toBe("acme/widgets");
		expect(gitlabProject("https://github.com/acme/widgets")).toBeNull();
		const url = new URL(gitlabNewMrUrl("acme/widgets", "origin/main", "feature", "Ship", "Body"));
		expect(url.origin + url.pathname).toBe("https://gitlab.com/acme/widgets/-/merge_requests/new");
		expect(url.searchParams.get("merge_request[source_branch]")).toBe("feature");
		expect(url.searchParams.get("merge_request[target_branch]")).toBe("main");
		expect(url.searchParams.get("merge_request[title]")).toBe("Ship");
		expect(url.searchParams.get("merge_request[description]")).toBe("Body");
	});
});
