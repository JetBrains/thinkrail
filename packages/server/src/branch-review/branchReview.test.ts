import { afterEach, expect, test } from "bun:test";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
	detectReviewProvider,
	findOpenBranchReviewWithRunner,
	providerFromRemoteUrl,
	reviewNumber,
} from "./branchReview";

const dirs: string[] = [];
afterEach(() => {
	for (const dir of dirs.splice(0)) rmSync(dir, { recursive: true, force: true });
});

function repo(remote: string): string {
	const cwd = mkdtempSync(join(tmpdir(), "thinkrail-branch-review-"));
	dirs.push(cwd);
	for (const args of [
		["init", "-q", "-b", "feature"],
		["remote", "add", "origin", remote],
	]) {
		const result = Bun.spawnSync(["git", "-C", cwd, ...args], { stderr: "pipe" });
		if (!result.success) throw new Error(new TextDecoder().decode(result.stderr));
	}
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
	Bun.spawnSync(["git", "-C", cwd, "remote", "add", "mirror", "https://gitlab.com/acme/app.git"]);
	Bun.spawnSync(["git", "-C", cwd, "config", "branch.feature.pushRemote", "mirror"]);
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

test("unavailable and malformed lookup results degrade to no review", async () => {
	const cwd = repo("https://github.com/acme/app.git");
	expect(
		await findOpenBranchReviewWithRunner(cwd, "feature", async () => ({ ok: false, out: "" })),
	).toBeNull();
	expect(
		await findOpenBranchReviewWithRunner(cwd, "feature", async () => ({
			ok: true,
			out: "not json",
		})),
	).toBeNull();
	expect(reviewNumber("[]", "number")).toBeNull();
	expect(reviewNumber('[{"number":0}]', "number")).toBeNull();
});
