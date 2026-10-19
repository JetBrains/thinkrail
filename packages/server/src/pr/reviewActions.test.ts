import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
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

function fakeGh(
	pr: { headRefName: string; state: string },
	mutation: { ok: boolean; out: string; err?: string } = { ok: true, out: "" },
) {
	const calls: Call[] = [];
	const run: PrCommandRunner = async (_cwd, command, timeoutMs) => {
		calls.push({ command, timeoutMs });
		if (command[2] === "view") return { ok: true, out: JSON.stringify(pr) };
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
	sh(repo, "remote", "add", "origin", remote);
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

describe("readyPr / reopenPr", () => {
	test("Ready checks the number still heads the branch, then mutates under the long timeout", async () => {
		const { run, calls } = fakeGh({ headRefName: "feature", state: "OPEN" });
		await readyPr(params, run);
		expect(calls.map((call) => call.command)).toEqual([
			["gh", "pr", "view", "12", "--json", "headRefName,state"],
			["gh", "pr", "ready", "12"],
		]);
		expect(calls[1]?.timeoutMs).toBe(60_000);
	});

	test("a number that now heads another branch changes nothing", async () => {
		const { run, calls } = fakeGh({ headRefName: "someone-else", state: "OPEN" });
		await expect(readyPr(params, run)).rejects.toThrow(/no longer the pull request of "feature"/);
		expect(calls).toHaveLength(1);
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
});

describe("mergePr", () => {
	test("merges exactly the shown head with the chosen method and keeps the branch by default", async () => {
		const { run, calls } = fakeGh({ headRefName: "feature", state: "OPEN" });
		const result = await mergePr({ ...params, method: "rebase", deleteBranch: false }, run);
		expect(result).toEqual({ branchDeleted: false });
		expect(calls[1]?.command).toEqual([
			"gh",
			"pr",
			"merge",
			"12",
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
			branchDeleted: true,
		});
		expect(sh(remote, "for-each-ref", "refs/heads/feature")).toBe("");
		expect(sh(repo, "rev-parse", "--abbrev-ref", "HEAD")).toBe("feature");
		expect(await mergePr({ ...params, method: "squash", deleteBranch: true }, run)).toEqual({
			branchDeleted: true,
		});
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
		await deleteRemoteBranch({ workspaceId: "w1", branch: "feature" });
		expect(sh(remote, "for-each-ref", "refs/heads/feature")).toBe("");
		expect(sh(repo, "rev-parse", "--verify", "refs/heads/feature")).not.toBe("");
	});

	test("never deletes the workspace's base branch", async () => {
		sh(repo, "switch", "-q", "main");
		seedWorkspaces([
			{ id: "w0", kind: "default", name: "Default", branch: "main", baseBranch: "main" },
		]);
		await expect(deleteRemoteBranch({ workspaceId: "w0", branch: "main" })).rejects.toThrow(
			/base branch/,
		);
		expect(sh(remote, "for-each-ref", "--format=%(refname)", "refs/heads/main")).toBe(
			"refs/heads/main",
		);
	});
});
