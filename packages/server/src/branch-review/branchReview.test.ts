import { afterEach, beforeEach, expect, test } from "bun:test";
import { mkdtempSync, renameSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
	detectReviewProvider,
	findOpenBranchReviewWithRunner,
	forgetOpenBranchReview,
	OPEN_BRANCH_REVIEW_CACHE_TTL_MS,
	providerFromRemoteUrl,
	reviewNumber,
} from "./branchReview";

const dirs: string[] = [];
const repositoryEnvironmentKeys = [
	"GIT_DIR",
	"GIT_WORK_TREE",
	"GIT_COMMON_DIR",
	"GIT_INDEX_FILE",
	"GIT_OBJECT_DIRECTORY",
	"GIT_ALTERNATE_OBJECT_DIRECTORIES",
	"GIT_NAMESPACE",
	"GIT_CONFIG_NOSYSTEM",
	"GIT_CONFIG_GLOBAL",
	"GIT_CONFIG_COUNT",
	"GIT_CONFIG_PARAMETERS",
	"GIT_CONFIG",
] as const;
const savedRepositoryEnvironment = new Map<string, string | undefined>();
for (const key of repositoryEnvironmentKeys) {
	savedRepositoryEnvironment.set(key, process.env[key]);
}

beforeEach(() => {
	for (const key of repositoryEnvironmentKeys) delete process.env[key];
	process.env.GIT_CONFIG_NOSYSTEM = "1";
	process.env.GIT_CONFIG_GLOBAL = process.platform === "win32" ? "NUL" : "/dev/null";
	process.env.GIT_CONFIG_COUNT = "0";
});

afterEach(() => {
	for (const dir of dirs.splice(0)) {
		forgetOpenBranchReview(dir);
		rmSync(dir, { recursive: true, force: true });
	}
	for (const key of repositoryEnvironmentKeys) {
		const value = savedRepositoryEnvironment.get(key);
		if (value === undefined) delete process.env[key];
		else process.env[key] = value;
	}
});

function runGit(cwd: string, ...args: string[]): void {
	const result = Bun.spawnSync(["git", "-C", cwd, ...args], {
		stderr: "pipe",
		env: process.env,
	});
	if (!result.success) throw new Error(new TextDecoder().decode(result.stderr));
}

function repo(remote: string): string {
	const cwd = mkdtempSync(join(tmpdir(), "thinkrail-branch-review-"));
	dirs.push(cwd);
	runGit(cwd, "init", "-q", "-b", "feature");
	runGit(cwd, "remote", "add", "origin", remote);
	return cwd;
}

test("recognizes hosted GitHub and GitLab remote URL forms only", () => {
	expect(providerFromRemoteUrl("https://github.com/acme/app.git")).toBe("github");
	expect(providerFromRemoteUrl("git@github.com:acme/app.git")).toBe("github");
	expect(providerFromRemoteUrl("ssh://git@gitlab.com/acme/app.git")).toBe("gitlab");
	expect(providerFromRemoteUrl("git@gitlab.internal:acme/app.git")).toBeNull();
	expect(providerFromRemoteUrl("/tmp/app.git")).toBeNull();
});

test("prefers the branch push remote", () => {
	const cwd = repo("https://github.com/acme/app.git");
	runGit(cwd, "remote", "add", "mirror", "https://gitlab.com/acme/app.git");
	runGit(cwd, "config", "branch.feature.pushRemote", "mirror");
	expect(detectReviewProvider(cwd, "feature")).toBe("gitlab");
});

test("queries an open GitHub PR for the explicit branch", async () => {
	const cwd = repo("git@github.com:acme/app.git");
	let command: string[] = [];
	const review = await findOpenBranchReviewWithRunner(cwd, "feature", async (_cwd, args) => {
		command = args;
		return { ok: true, out: '[{"number":214}]' };
	});

	expect(command).toEqual([
		"gh",
		"pr",
		"list",
		"--head",
		"feature",
		"--state",
		"open",
		"--json",
		"number",
		"--limit",
		"1",
	]);
	expect(review).toEqual({ kind: "pull-request", number: 214 });
});

test("queries an open GitLab MR for the explicit branch", async () => {
	const cwd = repo("https://gitlab.com/acme/app.git");
	let command: string[] = [];
	const review = await findOpenBranchReviewWithRunner(cwd, "feature", async (_cwd, args) => {
		command = args;
		return { ok: true, out: '[{"iid":73}]' };
	});

	expect(command).toEqual([
		"glab",
		"mr",
		"list",
		"--source-branch",
		"feature",
		"--output",
		"json",
		"--per-page",
		"1",
	]);
	expect(review).toEqual({ kind: "merge-request", number: 73 });
});

test("failed and malformed lookups degrade to null without being cached", async () => {
	const cwd = repo("https://github.com/acme/app.git");
	let calls = 0;
	const run = async () => {
		calls += 1;
		if (calls === 1) throw new Error("unavailable");
		if (calls === 2) return { ok: false, out: "" };
		if (calls === 3) return { ok: true, out: "not json" };
		return { ok: true, out: '[{"number":9}]' };
	};

	expect(await findOpenBranchReviewWithRunner(cwd, "feature", run)).toBeNull();
	expect(await findOpenBranchReviewWithRunner(cwd, "feature", run)).toBeNull();
	expect(await findOpenBranchReviewWithRunner(cwd, "feature", run)).toBeNull();
	expect(await findOpenBranchReviewWithRunner(cwd, "feature", run)).toEqual({
		kind: "pull-request",
		number: 9,
	});
	expect(await findOpenBranchReviewWithRunner(cwd, "feature", run)).toEqual({
		kind: "pull-request",
		number: 9,
	});
	expect(calls).toBe(4);
	expect(reviewNumber("[]", "number")).toBeNull();
	expect(reviewNumber('[{"number":0}]', "number")).toBeNull();
});

test("a failed repository inspection is retried after the worktree recovers", async () => {
	const cwd = repo("git@github.com:acme/app.git");
	const gitDir = join(cwd, ".git");
	const unavailable = join(cwd, ".git-unavailable");
	let calls = 0;
	const run = async () => {
		calls += 1;
		return { ok: true, out: '[{"number":11}]' };
	};

	renameSync(gitDir, unavailable);
	try {
		expect(await findOpenBranchReviewWithRunner(cwd, "feature", run)).toBeNull();
	} finally {
		renameSync(unavailable, gitDir);
	}
	expect(await findOpenBranchReviewWithRunner(cwd, "feature", run)).toEqual({
		kind: "pull-request",
		number: 11,
	});
	expect(calls).toBe(1);
});

test("a valid empty answer is cached while a fresh read bypasses it", async () => {
	const cwd = repo("git@github.com:acme/app.git");
	let calls = 0;
	const run = async () => {
		calls += 1;
		return { ok: true, out: calls === 1 ? "[]" : '[{"number":7}]' };
	};

	expect(await findOpenBranchReviewWithRunner(cwd, "feature", run)).toBeNull();
	expect(await findOpenBranchReviewWithRunner(cwd, "feature", run)).toBeNull();
	expect(calls).toBe(1);
	expect(await findOpenBranchReviewWithRunner(cwd, "feature", run, { fresh: true })).toEqual({
		kind: "pull-request",
		number: 7,
	});
	expect(await findOpenBranchReviewWithRunner(cwd, "feature", run)).toEqual({
		kind: "pull-request",
		number: 7,
	});
	expect(calls).toBe(2);
});

test("concurrent and repeated lookups share one provider call", async () => {
	const cwd = repo("git@github.com:acme/app.git");
	let calls = 0;
	let release: (() => void) | undefined;
	const run = async () => {
		calls += 1;
		await new Promise<void>((resolve) => {
			release = resolve;
		});
		return { ok: true, out: '[{"number":7}]' };
	};

	const first = findOpenBranchReviewWithRunner(cwd, "feature", run);
	const concurrent = findOpenBranchReviewWithRunner(cwd, "feature", run, { fresh: true });
	expect(calls).toBe(1);
	release?.();
	expect(await first).toEqual({ kind: "pull-request", number: 7 });
	expect(await concurrent).toEqual({ kind: "pull-request", number: 7 });
	expect(await findOpenBranchReviewWithRunner(cwd, "feature", run)).toEqual({
		kind: "pull-request",
		number: 7,
	});
	expect(calls).toBe(1);
});

test("cache keys isolate branches and worktrees while invalidation clears one worktree", async () => {
	const cwd = repo("git@github.com:acme/app.git");
	const other = repo("git@github.com:acme/other.git");
	let calls = 0;
	const run = async () => {
		calls += 1;
		return { ok: true, out: `[{"number":${calls}}]` };
	};

	expect((await findOpenBranchReviewWithRunner(cwd, "feature", run))?.number).toBe(1);
	expect((await findOpenBranchReviewWithRunner(cwd, "other", run))?.number).toBe(2);
	expect((await findOpenBranchReviewWithRunner(other, "feature", run))?.number).toBe(3);
	expect((await findOpenBranchReviewWithRunner(cwd, "feature", run))?.number).toBe(1);
	expect((await findOpenBranchReviewWithRunner(cwd, "other", run))?.number).toBe(2);
	expect((await findOpenBranchReviewWithRunner(other, "feature", run))?.number).toBe(3);
	expect(calls).toBe(3);

	forgetOpenBranchReview(cwd);
	expect((await findOpenBranchReviewWithRunner(cwd, "feature", run))?.number).toBe(4);
	expect((await findOpenBranchReviewWithRunner(cwd, "other", run))?.number).toBe(5);
	expect((await findOpenBranchReviewWithRunner(other, "feature", run))?.number).toBe(3);
	expect(calls).toBe(5);
});

test("settled answers expire exactly one TTL after settlement", async () => {
	const cwd = repo("git@github.com:acme/app.git");
	let calls = 0;
	let time = 1_000;
	let release: ((result: { ok: boolean; out: string }) => void) | undefined;
	const run = () => {
		calls += 1;
		if (calls > 1) return Promise.resolve({ ok: true, out: `[{"number":${calls}}]` });
		return new Promise<{ ok: boolean; out: string }>((resolve) => {
			release = resolve;
		});
	};
	const options = { now: () => time };

	const pending = findOpenBranchReviewWithRunner(cwd, "feature", run, options);
	time += OPEN_BRANCH_REVIEW_CACHE_TTL_MS * 2;
	release?.({ ok: true, out: '[{"number":1}]' });
	expect((await pending)?.number).toBe(1);
	time += OPEN_BRANCH_REVIEW_CACHE_TTL_MS - 1;
	expect((await findOpenBranchReviewWithRunner(cwd, "feature", run, options))?.number).toBe(1);
	time += 1;
	expect((await findOpenBranchReviewWithRunner(cwd, "feature", run, options))?.number).toBe(2);
	expect(calls).toBe(2);
});

test("a superseded lookup cannot overwrite a newer settled answer", async () => {
	const cwd = repo("git@github.com:acme/app.git");
	const releases: Array<(result: { ok: boolean; out: string }) => void> = [];
	let calls = 0;
	const run = () => {
		calls += 1;
		return new Promise<{ ok: boolean; out: string }>((resolve) => releases.push(resolve));
	};

	const stale = findOpenBranchReviewWithRunner(cwd, "feature", run);
	forgetOpenBranchReview(cwd);
	const fresh = findOpenBranchReviewWithRunner(cwd, "feature", run);
	releases[1]?.({ ok: true, out: '[{"number":2}]' });
	expect(await fresh).toEqual({ kind: "pull-request", number: 2 });
	releases[0]?.({ ok: true, out: '[{"number":1}]' });
	expect(await stale).toEqual({ kind: "pull-request", number: 2 });
	expect(await findOpenBranchReviewWithRunner(cwd, "feature", run)).toEqual({
		kind: "pull-request",
		number: 2,
	});
	expect(calls).toBe(2);
});

test("a superseded lookup joins the newer in-flight generation", async () => {
	const cwd = repo("git@github.com:acme/app.git");
	const releases: Array<(result: { ok: boolean; out: string }) => void> = [];
	const run = () => new Promise<{ ok: boolean; out: string }>((resolve) => releases.push(resolve));

	const stale = findOpenBranchReviewWithRunner(cwd, "feature", run);
	forgetOpenBranchReview(cwd);
	const fresh = findOpenBranchReviewWithRunner(cwd, "feature", run);
	let staleSettled = false;
	void stale.then(() => {
		staleSettled = true;
	});
	releases[0]?.({ ok: true, out: '[{"number":1}]' });
	await Promise.resolve();
	await Promise.resolve();
	expect(staleSettled).toBe(false);
	releases[1]?.({ ok: true, out: '[{"number":2}]' });
	expect(await stale).toEqual({ kind: "pull-request", number: 2 });
	expect(await fresh).toEqual({ kind: "pull-request", number: 2 });
});
