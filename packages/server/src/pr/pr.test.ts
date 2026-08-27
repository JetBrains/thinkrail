import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import { chmodSync, mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { delimiter, join } from "node:path";
import type { TodoPlan } from "@thinkrail/contracts";
import { findOpenBranchReview, forgetOpenBranchReview } from "../branch-review";
import {
	compareQuickPullUrl,
	ghPrFlow,
	githubSlug,
	isPushAuthFailure,
	openPr,
	type PrCommandRunner,
	pushGitEnv,
} from "./pr";
import { renderPrBody } from "./prBody";

const plan: TodoPlan = {
	todos: [],
	summary: "FloodWait handling shipped end to end.",
	groups: [
		{
			id: "g1",
			title: "Ship FloodWait handling",
			status: "done",
			todos: [
				{
					id: "t1",
					title: "Implement FloodWait handling",
					status: "done",
					origin: "agent",
					summary: "Added throttling and fallback.",
					verification: "bun test — 12 pass",
					artifacts: [{ kind: "commit", sha: "abc1234def", label: "x" }],
					review: { state: "reviewed", revision: 1 },
					createdAt: "2026-01-01T00:00:00Z",
					updatedAt: "2026-01-01T00:00:00Z",
				},
				{
					id: "t2",
					title: "Implement parser",
					status: "done",
					origin: "agent",
					artifacts: [{ kind: "commit", sha: "fff9999aaa", label: "y" }],
					review: { state: "changes_requested", revision: 1, feedback: "fix it" },
					createdAt: "2026-01-01T00:00:00Z",
					updatedAt: "2026-01-01T00:00:00Z",
				},
			],
		},
	],
};

describe("renderPrBody", () => {
	test("renders summary, grouped steps with sha + verification, and the review trail", () => {
		const body = renderPrBody(plan);
		expect(body).toContain("FloodWait handling shipped end to end.");
		expect(body).toContain("### Ship FloodWait handling");
		expect(body).toContain("- [x] **Implement FloodWait handling** (`abc1234`)");
		expect(body).toContain("Verified: bun test — 12 pass");
		expect(body).toContain("Review: 1/2 steps reviewed in ThinkRail.");
	});

	test("an empty plan renders empty", () => {
		expect(renderPrBody({ todos: [], groups: [] })).toBe("");
	});
});

describe("githubSlug", () => {
	test.each([
		["https://github.com/acme/widgets.git", "acme/widgets"],
		["https://github.com/acme/widgets", "acme/widgets"],
		["git@github.com:acme/widgets.git", "acme/widgets"],
		["ssh://git@github.com/acme/widgets", "acme/widgets"],
		["https://gitlab.com/acme/widgets.git", null],
		["/tmp/some/bare/repo.git", null],
	])("%s → %p", (url, slug) => {
		expect(githubSlug(url)).toBe(slug);
	});
});

describe("isPushAuthFailure", () => {
	test.each([
		[
			"git@github.com: Permission denied (publickey).\nfatal: Could not read from remote repository.",
			true,
		],
		["fatal: could not read Username for 'https://github.com': terminal prompts disabled", true],
		["fatal: Authentication failed for 'https://github.com/acme/widgets.git/'", true],
		["Host key verification failed.\nfatal: Could not read from remote repository.", true],
		["error: failed to push some refs to 'origin' (non-fast-forward)", false],
		["fatal: unable to access 'https://github.com/x.git/': Could not resolve host", false],
	])("%s → %p", (stderr, isAuth) => {
		expect(isPushAuthFailure(stderr)).toBe(isAuth);
	});
});

describe("pushGitEnv", () => {
	test("forces prompt-free git, English git messages without touching hook encoding, batch-mode ssh", () => {
		const env = pushGitEnv({ PATH: "/bin", LC_ALL: "ru_RU.UTF-8" }, false);
		expect(env.GIT_TERMINAL_PROMPT).toBe("0");
		expect(env.LC_MESSAGES).toBe("C");
		expect("LC_ALL" in env).toBe(false);
		expect(env.LC_CTYPE).toBe("ru_RU.UTF-8");
		expect(pushGitEnv({ LC_ALL: "C", LC_CTYPE: "en_US.UTF-8" }, false).LC_CTYPE).toBe(
			"en_US.UTF-8",
		);
		expect(env.GIT_SSH_COMMAND).toBe("ssh -oBatchMode=yes");
	});

	test("never overrides the user's own ssh command — env vars or core.sshCommand config", () => {
		expect(pushGitEnv({ GIT_SSH_COMMAND: "ssh -i /key" }, false).GIT_SSH_COMMAND).toBe(
			"ssh -i /key",
		);
		expect(pushGitEnv({ GIT_SSH: "/usr/bin/myssh" }, false).GIT_SSH_COMMAND).toBeUndefined();
		expect(pushGitEnv({}, true).GIT_SSH_COMMAND).toBeUndefined();
	});
});

describe("compareQuickPullUrl", () => {
	test("prefills title and body and strips the origin/ base prefix", () => {
		const url = compareQuickPullUrl("acme/widgets", "origin/main", "feat/x", "My title", "Body");
		expect(url).toStartWith("https://github.com/acme/widgets/compare/main...feat%2Fx?");
		expect(url).toContain("quick_pull=1");
		expect(url).toContain("title=My+title");
		expect(url).toContain("body=Body");
	});

	test("caps the body for URL-length safety and omits it when empty", () => {
		const long = compareQuickPullUrl("a/b", "main", "x", "t", "y".repeat(10_000));
		expect(long.length).toBeLessThan(6_000);
		expect(compareQuickPullUrl("a/b", "main", "x", "t", "")).not.toContain("body=");
	});
});

function runner(
	responses: Record<string, { ok: boolean; out: string } | { ok: boolean; out: string }[]>,
): {
	run: PrCommandRunner;
	calls: string[][];
	timeouts: (number | undefined)[];
} {
	const calls: string[][] = [];
	const timeouts: (number | undefined)[] = [];
	const run: PrCommandRunner = (_cwd, command, timeoutMs) => {
		calls.push(command);
		timeouts.push(timeoutMs);
		const key = command.slice(0, 3).join(" ");
		const entry = responses[key];
		const response = Array.isArray(entry) ? (entry.shift() ?? { ok: false, out: "" }) : entry;
		return Promise.resolve(response ?? { ok: false, out: "" });
	};
	return { run, calls, timeouts };
}

const input = { slug: "acme/widgets", base: "main", title: "My title", body: "The body" };

describe("ghPrFlow", () => {
	test("no existing PR → gh pr create, url + number parsed from output", async () => {
		const { run, calls } = runner({
			"gh pr list": { ok: true, out: "[]" },
			"gh pr create": { ok: true, out: "warning\nhttps://github.com/acme/widgets/pull/7" },
		});
		const outcome = await ghPrFlow("/w", "feat/x", input, run);
		expect(outcome).toEqual({
			action: "created",
			review: { kind: "pull-request", number: 7 },
			url: "https://github.com/acme/widgets/pull/7",
		});
		const create = calls.find((c) => c[2] === "create");
		expect(create).toContain("--head");
		expect(create).toContain("feat/x");
		expect(create).not.toContain("--draft");
	});

	test("a non-default workspace base reaches gh pr create — never the repo default branch", async () => {
		const { run, calls } = runner({
			"gh pr list": { ok: true, out: "[]" },
			"gh pr create": { ok: true, out: "https://github.com/acme/widgets/pull/12" },
		});
		await ghPrFlow("/w", "feat/x", { ...input, base: "release/x" }, run);
		const create = calls.find((c) => c[2] === "create");
		expect(create?.slice(create.indexOf("--base"), create.indexOf("--base") + 2)).toEqual([
			"--base",
			"release/x",
		]);
	});

	test("draft flag reaches gh pr create", async () => {
		const { run, calls } = runner({
			"gh pr list": { ok: true, out: "[]" },
			"gh pr create": { ok: true, out: "https://github.com/acme/widgets/pull/8" },
		});
		await ghPrFlow("/w", "feat/x", { ...input, draft: true }, run);
		expect(calls.find((c) => c[2] === "create")).toContain("--draft");
	});

	test("existing open PR → gh pr edit refreshes the body, action updated + bodyRefreshed", async () => {
		const { run, calls, timeouts } = runner({
			"gh pr list": { ok: true, out: '[{"number": 5}]' },
			"gh pr edit": { ok: true, out: "" },
		});
		const outcome = await ghPrFlow("/w", "feat/x", input, run);
		expect(outcome).toEqual({
			action: "updated",
			review: { kind: "pull-request", number: 5 },
			url: "https://github.com/acme/widgets/pull/5",
			bodyRefreshed: true,
		});
		const edit = calls.find((c) => c[2] === "edit");
		expect(edit?.[3]).toBe("5");
		expect(edit).not.toContain("--title");
		expect(edit).toContain("The body");
		expect(calls.some((c) => c[2] === "create")).toBe(false);
		// Mutations get the long timeout; the read-only list keeps the runner's default.
		expect(timeouts[0]).toBeUndefined();
		expect(timeouts[1]).toBe(60_000);
	});

	test("an edited title reaches gh pr edit; an untouched one never clobbers a GitHub-side rename", async () => {
		const { run, calls } = runner({
			"gh pr list": { ok: true, out: '[{"number": 5}]' },
			"gh pr edit": { ok: true, out: "" },
		});
		await ghPrFlow("/w", "feat/x", { ...input, titleEdited: true }, run);
		const edit = calls.find((c) => c[2] === "edit");
		expect(edit).toContain("--title");
		expect(edit).toContain("My title");
	});

	test("a failed gh pr edit is reported, not claimed — bodyRefreshed false", async () => {
		const { run } = runner({
			"gh pr list": { ok: true, out: '[{"number": 5}]' },
			"gh pr edit": { ok: false, out: "" },
		});
		const outcome = await ghPrFlow("/w", "feat/x", input, run);
		expect(outcome?.action).toBe("updated");
		expect(outcome?.bodyRefreshed).toBe(false);
	});

	test("gh unavailable (every command fails) → null, the caller falls back to compare", async () => {
		const { run } = runner({});
		expect(await ghPrFlow("/w", "feat/x", input, run)).toBeNull();
	});

	test("a failed create whose PR exists server-side is found by the re-check — never a duplicate", async () => {
		const { run } = runner({
			"gh pr list": [
				{ ok: true, out: "[]" },
				{ ok: true, out: '[{"number": 9}]' },
			],
			"gh pr create": { ok: false, out: "" },
		});
		const outcome = await ghPrFlow("/w", "feat/x", input, run);
		expect(outcome).toEqual({
			action: "created",
			review: { kind: "pull-request", number: 9 },
			url: "https://github.com/acme/widgets/pull/9",
		});
	});

	test("create output without a PR url and no PR on re-check → null", async () => {
		const { run } = runner({
			"gh pr list": { ok: true, out: "[]" },
			"gh pr create": { ok: true, out: "something went sideways" },
		});
		expect(await ghPrFlow("/w", "feat/x", input, run)).toBeNull();
	});

	test("the existing-PR lookup filters by BOTH --head and --base — a same-head PR to a different base is never edited", async () => {
		const { run, calls } = runner({
			"gh pr list": { ok: true, out: "[]" },
			"gh pr create": { ok: true, out: "https://github.com/acme/widgets/pull/11" },
		});
		await ghPrFlow("/w", "feat/x", { ...input, base: "release/x" }, run);
		const list = calls.find((c) => c[2] === "list");
		expect(list?.slice(list.indexOf("--head"), list.indexOf("--head") + 2)).toEqual([
			"--head",
			"feat/x",
		]);
		expect(list?.slice(list.indexOf("--base"), list.indexOf("--base") + 2)).toEqual([
			"--base",
			"release/x",
		]);
	});

	test("the failed-create re-check ALSO filters by --base, not just --head", async () => {
		const { run, calls } = runner({
			"gh pr list": [
				{ ok: true, out: "[]" },
				{ ok: true, out: '[{"number": 9}]' },
			],
			"gh pr create": { ok: false, out: "" },
		});
		const outcome = await ghPrFlow("/w", "feat/x", { ...input, base: "release/x" }, run);
		expect(outcome?.review).toEqual({ kind: "pull-request", number: 9 });
		const listCalls = calls.filter((c) => c[2] === "list");
		expect(listCalls).toHaveLength(2);
		for (const list of listCalls) {
			expect(list.slice(list.indexOf("--base"), list.indexOf("--base") + 2)).toEqual([
				"--base",
				"release/x",
			]);
		}
	});
});

describe("openPr — invalidates the open-review cache", () => {
	let dataDir: string;
	let repo: string;
	let remote: string;
	let reviewMode: string;
	const environmentKeys = [
		"THINKRAIL_DATA_DIR",
		"THINKRAIL_GH_OFFLINE",
		"THINKRAIL_TEST_REVIEW_MODE",
		"PATH",
		"HOME",
		"XDG_CONFIG_HOME",
		"GIT_CONFIG_NOSYSTEM",
		"GIT_CONFIG_GLOBAL",
		"GIT_CONFIG_COUNT",
		"GIT_CONFIG_KEY_0",
		"GIT_CONFIG_VALUE_0",
		"GIT_CONFIG_KEY_1",
		"GIT_CONFIG_VALUE_1",
		"GIT_CONFIG_PARAMETERS",
		"GIT_CONFIG",
		"GIT_ALLOW_PROTOCOL",
		"GIT_TEMPLATE_DIR",
		"GIT_DIR",
		"GIT_WORK_TREE",
		"GIT_COMMON_DIR",
		"GIT_INDEX_FILE",
		"GIT_OBJECT_DIRECTORY",
		"GIT_ALTERNATE_OBJECT_DIRECTORIES",
		"GIT_NAMESPACE",
		"PATHEXT",
	] as const;
	const savedEnvironment = new Map<string, string | undefined>();
	for (const key of environmentKeys) savedEnvironment.set(key, process.env[key]);

	const sh = (cwd: string, ...args: string[]) => {
		const result = Bun.spawnSync(["git", "-C", cwd, ...args], {
			stdout: "ignore",
			stderr: "pipe",
			env: process.env,
		});
		if (!result.success) throw new Error(new TextDecoder().decode(result.stderr));
	};

	beforeEach(() => {
		dataDir = mkdtempSync(join(tmpdir(), "trpi-pr-cache-"));
		repo = join(dataDir, "repo");
		remote = join(dataDir, "remote.git");
		const bin = join(dataDir, "bin");
		const home = join(dataDir, "home");
		const hooks = join(dataDir, "hooks");
		const template = join(dataDir, "template");
		reviewMode = join(dataDir, "review-mode");
		for (const path of [repo, remote, bin, home, hooks, template]) mkdirSync(path);
		for (const key of [
			"GIT_CONFIG_PARAMETERS",
			"GIT_CONFIG",
			"GIT_DIR",
			"GIT_WORK_TREE",
			"GIT_COMMON_DIR",
			"GIT_INDEX_FILE",
			"GIT_OBJECT_DIRECTORY",
			"GIT_ALTERNATE_OBJECT_DIRECTORIES",
			"GIT_NAMESPACE",
		]) {
			delete process.env[key];
		}

		process.env.THINKRAIL_DATA_DIR = dataDir;
		process.env.THINKRAIL_TEST_REVIEW_MODE = reviewMode;
		process.env.PATH = `${bin}${delimiter}${savedEnvironment.get("PATH") ?? ""}`;
		process.env.HOME = home;
		process.env.XDG_CONFIG_HOME = join(home, ".config");
		process.env.GIT_CONFIG_NOSYSTEM = "1";
		process.env.GIT_CONFIG_GLOBAL = process.platform === "win32" ? "NUL" : "/dev/null";
		process.env.GIT_CONFIG_COUNT = "2";
		process.env.GIT_CONFIG_KEY_0 = "commit.gpgSign";
		process.env.GIT_CONFIG_VALUE_0 = "false";
		process.env.GIT_CONFIG_KEY_1 = "core.hooksPath";
		process.env.GIT_CONFIG_VALUE_1 = hooks;
		process.env.GIT_ALLOW_PROTOCOL = "file";
		process.env.GIT_TEMPLATE_DIR = template;
		if (process.platform === "win32") {
			const pathExtensions = savedEnvironment.get("PATHEXT") ?? ".COM;.EXE;.BAT;.CMD";
			process.env.PATHEXT = pathExtensions.toUpperCase().split(";").includes(".CMD")
				? pathExtensions
				: `${pathExtensions};.CMD`;
		}
		delete process.env.THINKRAIL_GH_OFFLINE;

		sh(repo, "init", "-q", "-b", "main");
		sh(repo, "config", "user.email", "t@thinkrail.test");
		sh(repo, "config", "user.name", "test");
		writeFileSync(join(repo, "README.md"), "# repo\n");
		sh(repo, "add", "-A");
		sh(repo, "commit", "-q", "-m", "init");
		sh(repo, "switch", "-q", "-c", "feature");
		writeFileSync(join(repo, "feature.txt"), "feature\n");
		sh(repo, "add", "-A");
		sh(repo, "commit", "-q", "-m", "feature");
		sh(remote, "init", "-q", "--bare");
		sh(repo, "remote", "add", "origin", "https://github.com/acme/widgets.git");
		sh(repo, "remote", "set-url", "--push", "origin", remote);

		writeFileSync(reviewMode, "closed\n");
		if (process.platform === "win32") {
			writeFileSync(
				join(bin, "gh.cmd"),
				'@echo off\r\nset /p MODE=<"%THINKRAIL_TEST_REVIEW_MODE%"\r\nif "%MODE%"=="open" (\r\n  echo [{"number":7}]\r\n) else (\r\n  echo []\r\n)\r\n',
			);
		} else {
			const gh = join(bin, "gh");
			writeFileSync(
				gh,
				"#!/bin/sh\nif [ \"$(cat \"$THINKRAIL_TEST_REVIEW_MODE\")\" = \"open\" ]; then\n  printf '%s\\n' '[{\"number\":7}]'\nelse\n  printf '%s\\n' '[]'\nfi\n",
			);
			chmodSync(gh, 0o755);
		}

		writeFileSync(
			join(dataDir, "projects.json"),
			JSON.stringify([{ id: "p1", name: "repo", path: repo, slug: "repo", lastOpened: 1 }]),
		);
		writeFileSync(
			join(dataDir, "workspaces.json"),
			JSON.stringify([
				{
					id: "w1",
					projectId: "p1",
					name: "Feature",
					branch: "feature",
					baseBranch: "main",
					worktreePath: repo,
					createdAt: 1,
				},
			]),
		);
	});

	afterEach(() => {
		forgetOpenBranchReview(repo);
		rmSync(dataDir, { recursive: true, force: true });
		for (const key of environmentKeys) {
			const value = savedEnvironment.get(key);
			if (value === undefined) delete process.env[key];
			else process.env[key] = value;
		}
	});

	test("a successful push clears a settled answer even when gh is offline", async () => {
		expect(await findOpenBranchReview(repo, "feature")).toBeNull();
		writeFileSync(reviewMode, "open\n");
		process.env.THINKRAIL_GH_OFFLINE = "1";

		const result = await openPr({
			workspaceId: "w1",
			sessionId: "s1",
			title: "Feature",
			body: "Body",
		});
		expect(result.action).toBe("compare");
		expect(await findOpenBranchReview(repo, "feature")).toEqual({
			kind: "pull-request",
			number: 7,
		});
	});

	test("an ambiguous gh mutation clears a null cached concurrently with the attempt", async () => {
		expect(await findOpenBranchReview(repo, "feature")).toBeNull();
		const run: PrCommandRunner = async (_cwd, command) => {
			if (command[2] === "create") {
				expect(await findOpenBranchReview(repo, "feature")).toBeNull();
				writeFileSync(reviewMode, "open\n");
				return { ok: true, out: "ambiguous" };
			}
			return { ok: true, out: "[]" };
		};

		const result = await openPr(
			{ workspaceId: "w1", sessionId: "s1", title: "Feature", body: "Body" },
			run,
			async () => null,
		);
		expect(result.action).toBe("compare");
		expect(await findOpenBranchReview(repo, "feature")).toEqual({
			kind: "pull-request",
			number: 7,
		});
	});

	test("a successful non-GitHub push clears an answer before the pushed return", async () => {
		expect(await findOpenBranchReview(repo, "feature")).toBeNull();
		sh(repo, "remote", "set-url", "origin", remote);
		const result = await openPr({ workspaceId: "w1", sessionId: "s1" }, async () => {
			throw new Error("a non-GitHub push must not run gh");
		});
		expect(result.action).toBe("pushed");

		sh(repo, "remote", "set-url", "origin", "https://github.com/acme/widgets.git");
		writeFileSync(reviewMode, "open\n");
		expect(await findOpenBranchReview(repo, "feature")).toEqual({
			kind: "pull-request",
			number: 7,
		});
	});
});

describe("openPr — rejects when the branch is its own base (never push straight to it)", () => {
	let dataDir: string;
	const savedDataDir = process.env.THINKRAIL_DATA_DIR;

	function seedWorkspace(overrides: Partial<{ kind: "default" | "external"; baseBranch: string }>) {
		writeFileSync(
			join(dataDir, "projects.json"),
			JSON.stringify([{ id: "p1", name: "repo", path: "/repo", slug: "repo", lastOpened: 1 }]),
		);
		writeFileSync(
			join(dataDir, "workspaces.json"),
			JSON.stringify([
				{
					id: "w1",
					projectId: "p1",
					name: "w1",
					branch: "main",
					baseBranch: "main",
					worktreePath: "/repo",
					createdAt: 1,
					...overrides,
				},
			]),
		);
	}

	beforeEach(() => {
		dataDir = mkdtempSync(join(tmpdir(), "trpi-pr-"));
		process.env.THINKRAIL_DATA_DIR = dataDir;
	});

	afterEach(() => {
		rmSync(dataDir, { recursive: true, force: true });
		if (savedDataDir === undefined) delete process.env.THINKRAIL_DATA_DIR;
		else process.env.THINKRAIL_DATA_DIR = savedDataDir;
	});

	// Never reaches the runner: proves the rejection lands before the origin check / push, not after a
	// failed one — a `run` that gets called at all is itself a failure of this test.
	const neverRun: PrCommandRunner = () => {
		throw new Error("openPr must not shell out once branch === base");
	};

	test("the Default workspace on the repository's default branch (branch === baseBranch)", async () => {
		seedWorkspace({ kind: "default" });
		await expect(
			openPr({ workspaceId: "w1", sessionId: "s1" }, neverRun, async () => null),
		).rejects.toThrow(/is this workspace's base branch/);
	});

	test("an external (adopted) workspace sitting on its base, base stored with the origin/ prefix", async () => {
		seedWorkspace({ kind: "external", baseBranch: "origin/main" });
		await expect(
			openPr({ workspaceId: "w1", sessionId: "s1" }, neverRun, async () => null),
		).rejects.toThrow(/is this workspace's base branch/);
	});

	test("a genuine feature branch is NOT rejected by this guard — it fails later, on the missing remote", async () => {
		writeFileSync(
			join(dataDir, "projects.json"),
			JSON.stringify([{ id: "p1", name: "repo", path: "/repo", slug: "repo", lastOpened: 1 }]),
		);
		writeFileSync(
			join(dataDir, "workspaces.json"),
			JSON.stringify([
				{
					id: "w1",
					projectId: "p1",
					name: "w1",
					branch: "feat/x",
					baseBranch: "main",
					worktreePath: "/nonexistent-repo-for-this-test",
					createdAt: 1,
				},
			]),
		);
		let error: unknown;
		try {
			await openPr({ workspaceId: "w1", sessionId: "s1" }, neverRun, async () => null);
		} catch (err) {
			error = err;
		}
		expect(error).toBeDefined();
		expect(String(error)).not.toMatch(/is this workspace's base branch/);
	});

	test("a stale persisted branch on a Default workspace is refreshed to the live checkout before use — a terminal switch back to base is never missed", async () => {
		const repo = mkdtempSync(join(tmpdir(), "trpi-pr-live-"));
		const sh = (...args: string[]) => {
			const result = Bun.spawnSync(["git", "-C", repo, ...args], {
				stdout: "ignore",
				stderr: "ignore",
			});
			if (!result.success) throw new Error(`git ${args.join(" ")} failed`);
		};
		sh("init", "-b", "main");
		sh("config", "user.email", "t@thinkrail.test");
		sh("config", "user.name", "test");
		writeFileSync(join(repo, "README.md"), "# repo\n");
		sh("add", "-A");
		sh("commit", "-m", "init");

		// The persisted record is stale — it still says "feature/a" from before the user switched the
		// checkout back to "main" (== baseBranch) in a terminal. Without a live refresh, openPr would
		// use "feature/a" and neither push to nor guard against the branch actually checked out.
		writeFileSync(
			join(dataDir, "projects.json"),
			JSON.stringify([{ id: "p1", name: "repo", path: repo, slug: "repo", lastOpened: 1 }]),
		);
		writeFileSync(
			join(dataDir, "workspaces.json"),
			JSON.stringify([
				{
					id: "w1",
					projectId: "p1",
					name: "w1",
					kind: "default",
					branch: "feature/a",
					baseBranch: "main",
					worktreePath: repo,
					createdAt: 1,
				},
			]),
		);

		await expect(
			openPr({ workspaceId: "w1", sessionId: "s1" }, neverRun, async () => null),
		).rejects.toThrow(/is this workspace's base branch/);
	});
});
