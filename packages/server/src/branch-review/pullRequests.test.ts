import { afterEach, beforeEach, expect, test } from "bun:test";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { PullRequestFilter } from "@thinkrail/contracts";
import {
	getPullRequest,
	listPullRequestAuthors,
	listPullRequests,
	PULL_REQUEST_CACHE_TTL_MS,
	type PullRequestRunner,
	pullRequestSearch,
	pullRequestSizes,
} from "./pullRequests";

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

const ALL: PullRequestFilter = { scope: "all", drafts: true };

const node = (number: number, over: Record<string, unknown> = {}) => ({
	number,
	title: `PR ${number}`,
	url: `https://github.com/acme/app/pull/${number}`,
	state: "OPEN",
	isDraft: false,
	headRefName: `feature-${number}`,
	baseRefName: "main",
	updatedAt: "2026-11-18T10:00:00Z",
	author: { login: "octo" },
	reviewRequests: { nodes: [] },
	...over,
});

const searchAnswer = (nodes: unknown[], next?: string, viewer = "me") =>
	JSON.stringify({
		data: {
			viewer: { login: viewer },
			search: {
				pageInfo: { hasNextPage: next !== undefined, endCursor: next ?? null },
				nodes,
			},
		},
	});

function runner(answer: (command: string[]) => { ok: boolean; out: string }) {
	const calls: string[][] = [];
	const run: PullRequestRunner = async (_cwd, command) => {
		calls.push(command);
		return answer(command);
	};
	return { calls, run };
}

const flag = (command: string[] | undefined, name: string) => {
	const value = command?.find((arg) => arg.startsWith(`${name}=`));
	return value?.slice(name.length + 1);
};

test("the search names the repository and turns every filter into a GitHub qualifier", () => {
	expect(pullRequestSearch("acme/app", ALL, undefined)).toBe(
		"repo:acme/app is:pr is:open sort:updated-desc",
	);
	expect(
		pullRequestSearch("acme/app", { scope: "review-requested", drafts: false }, "  fix   login "),
	).toBe(
		"repo:acme/app is:pr is:open sort:updated-desc review-requested:@me draft:false fix login in:title",
	);
	expect(pullRequestSearch("acme/app", { scope: "mine", drafts: true, author: "ada" }, "")).toBe(
		"repo:acme/app is:pr is:open sort:updated-desc author:@me",
	);
	expect(pullRequestSearch("acme/app", { scope: "all", drafts: true, author: "ada" }, "")).toBe(
		"repo:acme/app is:pr is:open sort:updated-desc author:ada",
	);
	expect(pullRequestSearch("acme/app", { ...ALL, author: "x y:z" }, "")).not.toContain("x y");
});

test("typed words never add qualifiers or operators to the search", () => {
	expect(
		pullRequestSearch(
			"acme/app",
			ALL,
			'repo:other/app fix OR is:closed -login "quoted" NOT author:x',
		),
	).toBe("repo:acme/app is:pr is:open sort:updated-desc fix login quoted in:title");
	expect(pullRequestSearch("acme/app", ALL, "repo:x/y")).toBe(
		"repo:acme/app is:pr is:open sort:updated-desc",
	);
});

test("rows from another repository are dropped", async () => {
	const cwd = repo({ origin: "git@github.com:acme/app.git" });
	const { run } = runner(() => ({
		ok: true,
		out: searchAnswer([node(1), node(2, { url: "https://github.com/other/app/pull/2" })]),
	}));
	const page = await listPullRequests(cwd, { filter: ALL }, { run });
	expect(page.pullRequests.map((pr) => pr.number)).toEqual([1]);
});

test("a page comes from one GitHub search, without sizes, marking requests for the signed-in user", async () => {
	const cwd = repo({ origin: "git@github.com:acme/app.git" });
	const { calls, run } = runner(() => ({
		ok: true,
		out: searchAnswer(
			[
				node(9, { isDraft: true }),
				node(7, { reviewRequests: { nodes: [{ requestedReviewer: { login: "Me" } }] } }),
				{},
			],
			"CURSOR2",
		),
	}));

	const page = await listPullRequests(cwd, { filter: ALL, query: "settings" }, { run });

	expect(calls).toHaveLength(1);
	expect(calls[0]?.slice(0, 3)).toEqual(["gh", "api", "graphql"]);
	expect(flag(calls[0], "q")).toBe(
		"repo:acme/app is:pr is:open sort:updated-desc settings in:title",
	);
	expect(flag(calls[0], "query")).toContain("first: 20");
	expect(flag(calls[0], "after")).toBeUndefined();
	expect(page.nextCursor).toBe("CURSOR2");
	expect(page.pullRequests).toEqual([
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
			updatedAt: "2026-11-18T10:00:00Z",
			reviewRequested: false,
		},
		expect.objectContaining({ number: 7, reviewRequested: true }),
	]);
	expect(page.pullRequests[0]).not.toHaveProperty("size");
});

test("the next page passes the cursor, and the waiting scope marks every row requested", async () => {
	const cwd = repo({ origin: "git@github.com:acme/app.git" });
	const { calls, run } = runner(() => ({ ok: true, out: searchAnswer([node(3)]) }));
	const page = await listPullRequests(
		cwd,
		{ filter: { scope: "review-requested", drafts: true }, cursor: "C1" },
		{ run },
	);
	expect(flag(calls[0], "after")).toBe("C1");
	expect(page.nextCursor).toBeUndefined();
	expect(page.pullRequests[0]?.reviewRequested).toBe(true);
});

test("prefers the upstream GitHub remote, as gh does, and builds the base ref on it", async () => {
	const cwd = repo({
		origin: "git@github.com:me/app.git",
		upstream: "https://github.com/acme/app.git",
	});
	const { calls, run } = runner(() => ({
		ok: true,
		out: searchAnswer([node(3, { baseRefName: "release" })]),
	}));
	const page = await listPullRequests(cwd, { filter: ALL }, { run });
	expect(flag(calls[0], "q")).toStartWith("repo:acme/app ");
	expect(page.pullRequests[0]?.baseRef).toBe("upstream/release");
});

test("answers are kept for a minute per filter, query and cursor", async () => {
	const cwd = repo({ origin: "git@github.com:acme/app.git" });
	let clock = 1_000;
	const { calls, run } = runner(() => ({ ok: true, out: searchAnswer([node(1)]) }));
	const deps = { run, now: () => clock };
	await listPullRequests(cwd, { filter: ALL }, deps);
	await listPullRequests(cwd, { filter: ALL }, deps);
	expect(calls).toHaveLength(1);
	await listPullRequests(cwd, { filter: ALL, query: "x" }, deps);
	expect(calls).toHaveLength(2);
	clock += PULL_REQUEST_CACHE_TTL_MS;
	await listPullRequests(cwd, { filter: ALL }, deps);
	expect(calls).toHaveLength(3);
});

test("a repository with no GitHub remote is not-github and never runs gh", async () => {
	for (const remotes of [{}, { origin: "git@gitlab.com:acme/app.git" }]) {
		const { calls, run } = runner(() => ({ ok: true, out: searchAnswer([]) }));
		expect(await listPullRequests(repo(remotes), { filter: ALL }, { run })).toEqual({
			pullRequests: [],
			unavailable: "not-github",
		});
		expect(calls).toEqual([]);
	}
});

test("a failed search is named by the gh setup probe, or failed when gh looks usable", async () => {
	const cwd = repo({ origin: "git@github.com:acme/app.git" });
	const { run } = runner(() => ({ ok: false, out: "" }));
	for (const problem of ["missing", "unauthenticated"] as const) {
		expect(
			await listPullRequests(cwd, { filter: ALL }, { run, setupProblem: async () => problem }),
		).toEqual({ pullRequests: [], unavailable: problem });
	}
	expect(
		await listPullRequests(cwd, { filter: ALL }, { run, setupProblem: async () => null }),
	).toEqual({ pullRequests: [], unavailable: "failed" });
});

test("a malformed answer fails and is not kept", async () => {
	const cwd = repo({ origin: "git@github.com:acme/app.git" });
	for (const out of ["not json", "{}", searchAnswer([{ number: 4, state: "OPEN" }])]) {
		const { calls, run } = runner(() => ({ ok: true, out }));
		expect((await listPullRequests(cwd, { filter: ALL }, { run })).unavailable).toBe("failed");
		expect((await listPullRequests(cwd, { filter: ALL }, { run })).unavailable).toBe("failed");
		expect(calls).toHaveLength(2);
	}
});

test("sizes come from one aliased query for the numbers not already known", async () => {
	const cwd = repo({ origin: "git@github.com:acme/app.git" });
	const { calls, run } = runner((command) => {
		const query = flag(command, "query") ?? "";
		const data: Record<string, unknown> = {};
		for (const [, number] of query.matchAll(/p(\d+): pullRequest/g)) {
			data[`p${number}`] = { additions: Number(number) * 10, deletions: 1, changedFiles: 2 };
		}
		return { ok: true, out: JSON.stringify({ data: { repository: data } }) };
	});

	expect(await pullRequestSizes(cwd, [5, 5, 6, -1], { run })).toEqual([
		{ number: 5, additions: 50, deletions: 1, changedFiles: 2 },
		{ number: 6, additions: 60, deletions: 1, changedFiles: 2 },
	]);
	expect(calls).toHaveLength(1);
	expect(flag(calls[0], "owner")).toBe("acme");
	expect(flag(calls[0], "name")).toBe("app");
	await pullRequestSizes(cwd, [5, 7], { run });
	expect(calls).toHaveLength(2);
	expect(flag(calls[1], "query")).not.toContain("p5:");
	expect(flag(calls[1], "query")).toContain("p7:");
	expect(await pullRequestSizes(cwd, [], { run })).toEqual([]);
});

test("a failed size query leaves the sizes out", async () => {
	const cwd = repo({ origin: "git@github.com:acme/app.git" });
	const { run } = runner(() => ({ ok: false, out: "" }));
	expect(await pullRequestSizes(cwd, [11], { run })).toEqual([]);
});

test("gets one pull request in any state by number, with its size, or null", async () => {
	const cwd = repo({ origin: "https://github.com/acme/app" });
	const { calls, run } = runner((command) =>
		command[3] === "12"
			? {
					ok: true,
					out: JSON.stringify({
						...node(12, { state: "MERGED", author: null }),
						additions: 3,
						deletions: 2,
						changedFiles: 1,
					}),
				}
			: { ok: false, out: "" },
	);

	const merged = await getPullRequest(cwd, 12, { run });
	expect(calls[0]?.slice(0, 6)).toEqual(["gh", "pr", "view", "12", "--repo", "acme/app"]);
	expect(merged).toEqual(
		expect.objectContaining({
			number: 12,
			state: "merged",
			author: "",
			size: { additions: 3, deletions: 2, changedFiles: 1 },
		}),
	);
	expect(await getPullRequest(cwd, 13, { run })).toBeNull();
	expect(await getPullRequest(cwd, 0, { run })).toBeNull();
	expect(await getPullRequest(repo({}), 12, { run })).toBeNull();
});

test("authors of every open pull request come a hundred at a time, once each, with a cursor", async () => {
	const cwd = repo({ origin: "git@github.com:acme/app.git" });
	const { calls, run } = runner((command) => ({
		ok: true,
		out: JSON.stringify({
			data: {
				search: {
					pageInfo: { hasNextPage: flag(command, "after") === undefined, endCursor: "C2" },
					nodes: [
						{ author: { login: "ada" } },
						{ author: { login: "zed" } },
						{ author: { login: "ada" } },
						{ author: null },
						{},
					],
				},
			},
		}),
	}));
	const first = await listPullRequestAuthors(cwd, undefined, { run });
	expect(first).toEqual({ authors: ["ada", "zed"], nextCursor: "C2" });
	expect(flag(calls[0], "q")).toBe("repo:acme/app is:pr is:open sort:updated-desc");
	expect(flag(calls[0], "query")).toContain("first: 100");
	const second = await listPullRequestAuthors(cwd, "C2", { run });
	expect(flag(calls[1], "after")).toBe("C2");
	expect(second.nextCursor).toBeUndefined();
	await listPullRequestAuthors(cwd, undefined, { run });
	expect(calls).toHaveLength(2);
});

test("authors degrade to an empty page without a GitHub remote or on failure", async () => {
	const { calls, run } = runner(() => ({ ok: false, out: "" }));
	expect(await listPullRequestAuthors(repo({}), undefined, { run })).toEqual({ authors: [] });
	expect(calls).toEqual([]);
	expect(
		await listPullRequestAuthors(repo({ origin: "git@github.com:acme/fail.git" }), undefined, {
			run,
		}),
	).toEqual({ authors: [] });
});
