import { afterEach, beforeEach, expect, test } from "bun:test";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { getPullRequest, listPullRequests, type PullRequestRunner } from "./pullRequests";

const dirs: string[] = [];
const savedEnv = new Map<string, string | undefined>();
const ENV_KEYS = ["GIT_DIR", "GIT_WORK_TREE", "GIT_CONFIG_NOSYSTEM", "GIT_CONFIG_GLOBAL"] as const;

beforeEach(() => {
	for (const key of ENV_KEYS) savedEnv.set(key, process.env[key]);
	delete process.env.GIT_DIR;
	delete process.env.GIT_WORK_TREE;
	process.env.GIT_CONFIG_NOSYSTEM = "1";
	process.env.GIT_CONFIG_GLOBAL = process.platform === "win32" ? "NUL" : "/dev/null";
});

afterEach(() => {
	for (const dir of dirs.splice(0)) rmSync(dir, { recursive: true, force: true });
	for (const key of ENV_KEYS) {
		const value = savedEnv.get(key);
		if (value === undefined) delete process.env[key];
		else process.env[key] = value;
	}
});

function repo(remotes: Record<string, string>): string {
	const dir = mkdtempSync(join(tmpdir(), "thinkrail-prs-"));
	dirs.push(dir);
	const git = (...args: string[]) => {
		const result = Bun.spawnSync(["git", "-C", dir, ...args], { stderr: "pipe", env: process.env });
		if (!result.success) throw new Error(new TextDecoder().decode(result.stderr));
	};
	git("init", "-q");
	for (const [name, url] of Object.entries(remotes)) git("remote", "add", name, url);
	return dir;
}

const row = (number: number, over: Record<string, unknown> = {}) => ({
	number,
	title: `PR ${number}`,
	author: { login: "octo", name: "Octo" },
	state: "OPEN",
	isDraft: false,
	headRefName: `feature-${number}`,
	baseRefName: "main",
	url: `https://github.com/acme/app/pull/${number}`,
	additions: 10,
	deletions: 2,
	changedFiles: 3,
	updatedAt: "2026-11-18T10:00:00Z",
	...over,
});

function runner(answers: (command: string[]) => { ok: boolean; out: string }) {
	const calls: string[][] = [];
	const run: PullRequestRunner = async (_cwd, command) => {
		calls.push(command);
		return answers(command);
	};
	return { calls, run };
}

const isSearch = (command: string[]) => command.includes("--search");

test("lists open pull requests with the review-requested ones marked, in two parallel calls", async () => {
	const cwd = repo({ origin: "git@github.com:acme/app.git" });
	let inFlight = 0;
	let peak = 0;
	const calls: string[][] = [];
	const run: PullRequestRunner = async (_cwd, command) => {
		calls.push(command);
		inFlight += 1;
		peak = Math.max(peak, inFlight);
		await Bun.sleep(5);
		inFlight -= 1;
		return isSearch(command)
			? { ok: true, out: JSON.stringify([{ number: 7 }]) }
			: { ok: true, out: JSON.stringify([row(9, { isDraft: true }), row(7)]) };
	};

	const list = await listPullRequests(cwd, { run, setupProblem: async () => null });

	expect(peak).toBe(2);
	expect(calls).toContainEqual([
		"gh",
		"pr",
		"list",
		"--repo",
		"acme/app",
		"--state",
		"open",
		"--json",
		"number,title,author,state,isDraft,headRefName,baseRefName,url,additions,deletions,changedFiles,updatedAt",
		"--limit",
		"100",
	]);
	expect(calls).toContainEqual([
		"gh",
		"pr",
		"list",
		"--repo",
		"acme/app",
		"--state",
		"open",
		"--search",
		"review-requested:@me",
		"--json",
		"number",
		"--limit",
		"100",
	]);
	expect(list.unavailable).toBeUndefined();
	expect(list.pullRequests).toEqual([
		{
			number: 9,
			title: "PR 9",
			author: "octo",
			state: "open",
			draft: true,
			headRefName: "feature-9",
			baseRefName: "main",
			baseRef: "origin/main",
			url: "https://github.com/acme/app/pull/9",
			additions: 10,
			deletions: 2,
			changedFiles: 3,
			updatedAt: "2026-11-18T10:00:00Z",
			reviewRequested: false,
		},
		expect.objectContaining({ number: 7, draft: false, reviewRequested: true }),
	]);
});

test("prefers the upstream GitHub remote, as gh does, and builds the base ref on it", async () => {
	const cwd = repo({
		origin: "git@github.com:me/app.git",
		upstream: "https://github.com/acme/app.git",
	});
	const { calls, run } = runner((command) => ({
		ok: true,
		out: isSearch(command) ? "[]" : JSON.stringify([row(3, { baseRefName: "release" })]),
	}));

	const list = await listPullRequests(cwd, { run });

	expect(calls.every((command) => command[4] === "acme/app")).toBe(true);
	expect(list.pullRequests[0]?.baseRef).toBe("upstream/release");
});

test("a repository with no GitHub remote is not-github and never runs gh", async () => {
	for (const remotes of [{}, { origin: "git@gitlab.com:acme/app.git" }]) {
		const { calls, run } = runner(() => ({ ok: true, out: "[]" }));
		expect(await listPullRequests(repo(remotes), { run })).toEqual({
			pullRequests: [],
			unavailable: "not-github",
		});
		expect(calls).toEqual([]);
	}
});

test("a failed listing is named by the gh setup probe, or failed when gh looks usable", async () => {
	const cwd = repo({ origin: "git@github.com:acme/app.git" });
	const { run } = runner(() => ({ ok: false, out: "" }));
	for (const problem of ["missing", "unauthenticated"] as const) {
		expect(await listPullRequests(cwd, { run, setupProblem: async () => problem })).toEqual({
			pullRequests: [],
			unavailable: problem,
		});
	}
	expect(await listPullRequests(cwd, { run, setupProblem: async () => null })).toEqual({
		pullRequests: [],
		unavailable: "failed",
	});
});

test("the setup probe never runs after a successful listing", async () => {
	const cwd = repo({ origin: "git@github.com:acme/app.git" });
	const { run } = runner(() => ({ ok: true, out: "[]" }));
	let probed = false;
	const list = await listPullRequests(cwd, {
		run,
		setupProblem: async () => {
			probed = true;
			return "unauthenticated";
		},
	});
	expect(list).toEqual({ pullRequests: [] });
	expect(probed).toBe(false);
});

test("a malformed listing fails; a failed review-requested listing only drops the marks", async () => {
	const cwd = repo({ origin: "git@github.com:acme/app.git" });
	for (const out of ["not json", "{}", JSON.stringify([{ number: "x" }])]) {
		const { run } = runner((command) => ({ ok: true, out: isSearch(command) ? "[]" : out }));
		expect((await listPullRequests(cwd, { run })).unavailable).toBe("failed");
	}
	const { run } = runner((command) =>
		isSearch(command) ? { ok: false, out: "" } : { ok: true, out: JSON.stringify([row(4)]) },
	);
	const list = await listPullRequests(cwd, { run });
	expect(list.unavailable).toBeUndefined();
	expect(list.pullRequests.map((pr) => [pr.number, pr.reviewRequested])).toEqual([[4, false]]);
});

test("every call shares one lookup budget", async () => {
	const cwd = repo({ origin: "git@github.com:acme/app.git" });
	let clock = 0;
	const budgets: number[] = [];
	const run: PullRequestRunner = async (_cwd, _command, timeoutMs) => {
		budgets.push(timeoutMs);
		return { ok: true, out: "[]" };
	};
	await listPullRequests(cwd, {
		run,
		now: () => {
			clock += 1_000;
			return clock;
		},
	});
	expect(budgets.length).toBe(2);
	for (const budget of budgets) expect(budget).toBeLessThan(8_000);
});

test("gets one pull request in any state by number, or null", async () => {
	const cwd = repo({ origin: "https://github.com/acme/app" });
	const { calls, run } = runner((command) =>
		command[3] === "12"
			? { ok: true, out: JSON.stringify(row(12, { state: "MERGED", author: null })) }
			: { ok: false, out: "" },
	);

	const merged = await getPullRequest(cwd, 12, { run });
	expect(calls[0]).toEqual([
		"gh",
		"pr",
		"view",
		"12",
		"--repo",
		"acme/app",
		"--json",
		"number,title,author,state,isDraft,headRefName,baseRefName,url,additions,deletions,changedFiles,updatedAt",
	]);
	expect(merged).toEqual(
		expect.objectContaining({ number: 12, state: "merged", author: "", reviewRequested: false }),
	);
	expect(await getPullRequest(cwd, 13, { run })).toBeNull();
	expect(await getPullRequest(cwd, 0, { run })).toBeNull();
	expect(await getPullRequest(repo({}), 12, { run })).toBeNull();
});
