import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import { chmodSync, mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { delimiter, join } from "node:path";
import { setSyncGitTimeoutForTests } from "../git";
import type { PrCommandRunner } from "./pr";
import { deleteRemoteBranch, mergePr, readyPr, reopenPr } from "./reviewActions";

const ISOLATED_GIT_ENV = {
	GIT_CONFIG_NOSYSTEM: "1",
	GIT_CONFIG_GLOBAL: process.platform === "win32" ? "NUL" : "/dev/null",
	GIT_CONFIG_COUNT: "1",
	GIT_CONFIG_KEY_0: "commit.gpgSign",
	GIT_CONFIG_VALUE_0: "false",
	GIT_ALLOW_PROTOCOL: "file",
} as const;

const saved = new Map<string, string | undefined>();
for (const key of ["THINKRAIL_DATA_DIR", ...Object.keys(ISOLATED_GIT_ENV)]) {
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

type Call = { command: string[]; timeoutMs: number | undefined };
type FakePr = {
	headRefName: string;
	state: string;
	owner?: string;
	queued?: boolean;
	openHeads?: string[];
	listFails?: boolean;
};

function fakeGh(
	pr: FakePr,
	mutation: { ok: boolean; out: string; err?: string } = { ok: true, out: "" },
) {
	const calls: Call[] = [];
	const run: PrCommandRunner = async (_cwd, command, timeoutMs) => {
		calls.push({ command, timeoutMs });
		if (command[2] === "view") {
			return {
				ok: true,
				out: JSON.stringify({
					headRefName: pr.headRefName,
					state: pr.state,
					headRepositoryOwner: { login: pr.owner ?? "acme" },
					headRepository: { name: "app" },
				}),
			};
		}
		if (command[2] === "list") {
			if (pr.listFails) return { ok: false, out: "" };
			const rows = (pr.openHeads ?? []).map((owner, index) => ({
				number: 40 + index,
				headRepositoryOwner: { login: owner },
				headRepository: { name: "app" },
			}));
			return { ok: true, out: JSON.stringify(rows) };
		}
		if (command[2] === "merge" && mutation.ok && !pr.queued) pr.state = "MERGED";
		return mutation;
	};
	return { run, calls };
}

beforeEach(() => {
	dataDir = mkdtempSync(join(tmpdir(), "trpi-review-actions-"));
	repo = join(dataDir, "repo");
	remote = join(dataDir, "remote.git");
	mkdirSync(repo);
	mkdirSync(remote);
	process.env.THINKRAIL_DATA_DIR = dataDir;
	Object.assign(process.env, ISOLATED_GIT_ENV);
	sh(repo, "init", "-q", "-b", "main");
	sh(repo, "config", "user.email", "t@thinkrail.test");
	sh(repo, "config", "user.name", "test");
	commit("README.md", "init");
	sh(repo, "switch", "-q", "-c", "feature");
	commit("a.txt", "Add the ship segment");
	sh(remote, "init", "-q", "--bare");
	sh(repo, "remote", "add", "origin", "git@github.com:acme/app.git");
	sh(repo, "config", `url.${remote}.insteadOf`, "git@github.com:acme/app.git");
	sh(repo, "push", "-q", "origin", "main", "feature");
	seedWorkspaces([{ id: "w1", name: "Feature", branch: "feature", baseBranch: "main" }]);
});

afterEach(() => {
	rmSync(dataDir, { recursive: true, force: true });
	for (const [key, value] of saved) {
		if (value === undefined) delete process.env[key];
		else process.env[key] = value;
	}
});

const params = { workspaceId: "w1", branch: "feature", number: 12 };
const closed: FakePr = { headRefName: "feature", state: "CLOSED" };

describe("readyPr / reopenPr", () => {
	test("Ready checks the number still heads the branch, then mutates under the long timeout", async () => {
		const { run, calls } = fakeGh({ headRefName: "feature", state: "OPEN" });
		await readyPr(params, run);
		expect(calls.map((call) => call.command)).toEqual([
			[
				"gh",
				"pr",
				"view",
				"12",
				"--repo",
				"acme/app",
				"--json",
				"headRefName,state,headRepositoryOwner,headRepository",
			],
			["gh", "pr", "ready", "12", "--repo", "acme/app"],
		]);
		expect(calls[1]?.timeoutMs).toBe(60_000);
	});

	test("a number that heads another branch, or a fork's same-named one, changes nothing", async () => {
		const other = fakeGh({ headRefName: "someone-else", state: "OPEN" });
		await expect(readyPr(params, other.run)).rejects.toThrow(
			/not the pull request of acme\/app:feature/,
		);
		expect(other.calls).toHaveLength(1);
		const fork = fakeGh({ headRefName: "feature", state: "OPEN", owner: "contributor" });
		await expect(readyPr(params, fork.run)).rejects.toThrow(/nothing was changed/);
		expect(fork.calls).toHaveLength(1);
	});

	test("the workspace's base branch has no PR to act on", async () => {
		sh(repo, "switch", "-q", "main");
		seedWorkspaces([
			{ id: "w0", kind: "default", name: "Default", branch: "main", baseBranch: "main" },
		]);
		const { run, calls } = fakeGh({ headRefName: "main", state: "OPEN", owner: "contributor" });
		await expect(readyPr({ workspaceId: "w0", branch: "main", number: 12 }, run)).rejects.toThrow(
			/base branch/,
		);
		expect(calls).toHaveLength(0);
	});

	test("Reopen needs a closed PR and reports gh's own reason when GitHub refuses", async () => {
		const open = fakeGh({ headRefName: "feature", state: "OPEN" });
		await expect(reopenPr(params, open.run)).rejects.toThrow(/is open on GitHub now/);
		expect(open.calls).toHaveLength(1);

		const refused = fakeGh(
			{ headRefName: "feature", state: "CLOSED" },
			{ ok: false, out: "", err: "could not reopen: the head branch was deleted" },
		);
		await expect(reopenPr(params, refused.run)).rejects.toThrow(
			"Couldn't reopen PR #12: could not reopen: the head branch was deleted",
		);
	});

	test("a checkout that moved off the branch never asks gh", async () => {
		sh(repo, "switch", "-q", "main");
		seedWorkspaces([
			{ id: "w1", kind: "default", name: "Default", branch: "feature", baseBranch: "main" },
		]);
		const { run, calls } = fakeGh({ headRefName: "feature", state: "OPEN" });
		await expect(readyPr(params, run)).rejects.toThrow(/moved from "feature" to "main"/);
		expect(calls).toHaveLength(0);
	});

	test.skipIf(process.platform === "win32")(
		"a branch read that times out never asks gh, instead of trusting the stored branch",
		async () => {
			sh(repo, "switch", "-q", "main");
			seedWorkspaces([
				{ id: "w1", kind: "default", name: "Default", branch: "feature", baseBranch: "main" },
			]);
			const { run, calls } = fakeGh({ headRefName: "feature", state: "OPEN" });
			const bin = join(dataDir, "bin");
			mkdirSync(bin, { recursive: true });
			writeFileSync(
				join(bin, "git"),
				`#!/bin/sh\ncase " $* " in *" symbolic-ref "*) sleep 30;; esac\nexec ${JSON.stringify(Bun.which("git"))} "$@"\n`,
			);
			chmodSync(join(bin, "git"), 0o755);
			const path = process.env.PATH;
			process.env.PATH = `${bin}${delimiter}${path ?? ""}`;
			setSyncGitTimeoutForTests(2_000);
			try {
				await expect(readyPr(params, run)).rejects.toThrow(
					expect.objectContaining({ code: "GIT_TIMEOUT" }),
				);
			} finally {
				setSyncGitTimeoutForTests(undefined);
				process.env.PATH = path;
			}
			expect(calls).toHaveLength(0);
		},
	);
});

describe("mergePr", () => {
	test("merges exactly the shown head with the chosen method and keeps the branch by default", async () => {
		const { run, calls } = fakeGh({ headRefName: "feature", state: "OPEN" });
		const result = await mergePr({ ...params, method: "rebase", deleteBranch: false }, run);
		expect(result).toEqual({ merged: true, branchDeleted: false });
		expect(calls[1]?.command).toEqual([
			"gh",
			"pr",
			"merge",
			"12",
			"--repo",
			"acme/app",
			"--rebase",
			"--match-head-commit",
			sh(repo, "rev-parse", "HEAD"),
		]);
		expect(sh(remote, "for-each-ref", "--format=%(refname)", "refs/heads/feature")).toBe(
			"refs/heads/feature",
		);
		expect(sh(repo, "rev-parse", "--abbrev-ref", "HEAD")).toBe("feature");
	});

	test("deleting the branch removes only origin's copy; an already-deleted one counts as deleted", async () => {
		const { run } = fakeGh({ headRefName: "feature", state: "OPEN" });
		expect(await mergePr({ ...params, method: "squash", deleteBranch: true }, run)).toEqual({
			merged: true,
			branchDeleted: true,
		});
		expect(sh(remote, "for-each-ref", "refs/heads/feature")).toBe("");
		expect(sh(repo, "rev-parse", "--abbrev-ref", "HEAD")).toBe("feature");
		const again = fakeGh({ headRefName: "feature", state: "OPEN" });
		expect(await mergePr({ ...params, method: "squash", deleteBranch: true }, again.run)).toEqual({
			merged: true,
			branchDeleted: true,
		});
	});

	test("a PR GitHub only queued keeps its branch, so the queue cannot lose it", async () => {
		const { run } = fakeGh({ headRefName: "feature", state: "OPEN", queued: true });
		expect(await mergePr({ ...params, method: "squash", deleteBranch: true }, run)).toEqual({
			merged: false,
			branchDeleted: false,
		});
		expect(sh(remote, "for-each-ref", "--format=%(refname)", "refs/heads/feature")).toBe(
			"refs/heads/feature",
		);
	});

	test("a refused merge surfaces gh's reason and deletes nothing", async () => {
		const { run } = fakeGh(
			{ headRefName: "feature", state: "OPEN" },
			{ ok: false, out: "", err: "Pull request is not mergeable" },
		);
		await expect(mergePr({ ...params, method: "merge", deleteBranch: true }, run)).rejects.toThrow(
			"Couldn't merge PR #12: Pull request is not mergeable",
		);
		expect(sh(remote, "for-each-ref", "--format=%(refname)", "refs/heads/feature")).toBe(
			"refs/heads/feature",
		);
	});
});

describe("deleteRemoteBranch", () => {
	test("deletes origin's branch and leaves the local one", async () => {
		const { run, calls } = fakeGh({ headRefName: "feature", state: "CLOSED", openHeads: ["fork"] });
		await deleteRemoteBranch({ workspaceId: "w1", branch: "feature" }, run);
		expect(calls[0]?.command.slice(0, 7)).toEqual([
			"gh",
			"pr",
			"list",
			"--repo",
			"acme/app",
			"--head",
			"feature",
		]);
		expect(sh(remote, "for-each-ref", "refs/heads/feature")).toBe("");
		expect(sh(repo, "rev-parse", "--verify", "refs/heads/feature")).not.toBe("");
	});

	test("never deletes the workspace's base branch", async () => {
		sh(repo, "switch", "-q", "main");
		seedWorkspaces([
			{ id: "w0", kind: "default", name: "Default", branch: "main", baseBranch: "main" },
		]);
		await expect(
			deleteRemoteBranch({ workspaceId: "w0", branch: "main" }, fakeGh(closed).run),
		).rejects.toThrow(/base branch/);
		expect(sh(remote, "for-each-ref", "--format=%(refname)", "refs/heads/main")).toBe(
			"refs/heads/main",
		);
	});
});

function teammatePush(file: string): string {
	const other = join(dataDir, `teammate-${file}`);
	Bun.spawnSync(["git", "clone", "-q", "--branch", "feature", remote, other], { env: process.env });
	sh(other, "config", "user.email", "t@thinkrail.test");
	sh(other, "config", "user.name", "teammate");
	writeFileSync(join(other, file), "teammate\n");
	sh(other, "add", "-A");
	sh(other, "commit", "-q", "-m", "teammate");
	sh(other, "push", "-q", "origin", "feature");
	return sh(other, "rev-parse", "HEAD");
}

describe("remote deletion is leased to the tip this checkout saw", () => {
	test("a commit pushed after the merge keeps the branch and is reported", async () => {
		const { run } = fakeGh({ headRefName: "feature", state: "OPEN" });
		const pushed = { tip: "" };
		const racing: PrCommandRunner = async (cwd, command, timeoutMs) => {
			const result = await run(cwd, command, timeoutMs);
			if (command[2] === "merge") pushed.tip = teammatePush("late.txt");
			return result;
		};
		const result = await mergePr({ ...params, method: "squash", deleteBranch: true }, racing);
		expect(result).toMatchObject({ merged: true, branchDeleted: false });
		expect(result.deleteError).toMatch(/moved since this checkout last saw it/);
		expect(sh(remote, "rev-parse", "refs/heads/feature")).toBe(pushed.tip);
	});

	test("a standalone deletion refuses a remote that moved or holds commits HEAD lacks", async () => {
		const tip = teammatePush("unseen.txt");
		await expect(
			deleteRemoteBranch({ workspaceId: "w1", branch: "feature" }, fakeGh(closed).run),
		).rejects.toThrow(/moved since this checkout last saw it/);
		expect(sh(remote, "rev-parse", "refs/heads/feature")).toBe(tip);
		sh(repo, "fetch", "-q", "origin");
		await expect(
			deleteRemoteBranch({ workspaceId: "w1", branch: "feature" }, fakeGh(closed).run),
		).rejects.toThrow(/has commits this checkout doesn't/);
		expect(sh(remote, "rev-parse", "refs/heads/feature")).toBe(tip);
	});
});

describe("the open-PR check before a deletion asks the push repository itself", () => {
	test("an open PR from this branch in the push repository blocks the deletion", async () => {
		const { run } = fakeGh({ ...closed, openHeads: ["acme"] });
		await expect(deleteRemoteBranch({ workspaceId: "w1", branch: "feature" }, run)).rejects.toThrow(
			/still has an open pull request/,
		);
		expect(sh(remote, "for-each-ref", "--format=%(refname)", "refs/heads/feature")).toBe(
			"refs/heads/feature",
		);
	});

	test("an unanswered check deletes nothing", async () => {
		const { run } = fakeGh({ ...closed, listFails: true });
		await expect(deleteRemoteBranch({ workspaceId: "w1", branch: "feature" }, run)).rejects.toThrow(
			/Couldn't confirm/,
		);
		expect(sh(remote, "for-each-ref", "--format=%(refname)", "refs/heads/feature")).toBe(
			"refs/heads/feature",
		);
	});

	test("after a merge, another open PR from the branch keeps it on origin", async () => {
		const { run } = fakeGh({ headRefName: "feature", state: "OPEN", openHeads: ["acme"] });
		const result = await mergePr({ ...params, method: "squash", deleteBranch: true }, run);
		expect(result).toEqual({
			merged: true,
			branchDeleted: false,
			deleteError: "another open pull request still uses it.",
		});
		expect(sh(remote, "for-each-ref", "--format=%(refname)", "refs/heads/feature")).toBe(
			"refs/heads/feature",
		);
	});
});
