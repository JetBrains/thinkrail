import type { MergeMethod, MergePrResult } from "@thinkrail/contracts";
import {
	findBranchReviewOutcome,
	forgetOpenBranchReview,
	githubSlug,
	runProviderCommand,
} from "../branch-review";
import { git, gitAsync, originUrls, remoteRefOidAsync, throwOnTimeout } from "../git";
import {
	MUTATION_TIMEOUT_MS,
	onBaseBranch,
	type PrCommandRunner,
	pushOrigin,
	refreshedWorkspace,
} from "./pr";

export interface ReviewActionParams {
	workspaceId: string;
	branch: string;
	number: number;
}

export interface MergePrParams extends ReviewActionParams {
	method: MergeMethod;
	deleteBranch: boolean;
}

type PrState = "OPEN" | "CLOSED" | "MERGED";

const MERGE_FLAGS: Record<MergeMethod, string> = {
	squash: "--squash",
	merge: "--merge",
	rebase: "--rebase",
};

const HEAD_FIELDS = "headRepositoryOwner,headRepository";

function branchWorkspace(workspaceId: string, branch: string) {
	const ws = refreshedWorkspace(workspaceId, undefined);
	if (ws.branch !== branch) {
		throw new Error(
			`The checkout moved from "${branch}" to "${ws.branch}" — nothing was changed. Review the branch and try again.`,
		);
	}
	if (onBaseBranch(ws)) {
		throw new Error(
			`"${ws.branch}" is this workspace's base branch — it has no pull request of its own. Nothing was changed.`,
		);
	}
	return ws;
}

function ghFailure(what: string, result: { out: string; err?: string }): Error {
	const detail = result.err || result.out;
	return new Error(
		detail
			? `${what}: ${detail}`
			: `${what}: gh didn't finish — check the pull request on GitHub before trying again.`,
	);
}

function headSlug(pr: Record<string, unknown>): string {
	const owner = pr.headRepositoryOwner as { login?: unknown } | null | undefined;
	const repo = pr.headRepository as { name?: unknown } | null | undefined;
	const login = typeof owner?.login === "string" ? owner.login : "";
	const name = typeof repo?.name === "string" ? repo.name : "";
	return `${login}/${name}`.toLowerCase();
}

async function pushRepository(cwd: string): Promise<string | null> {
	const origin = (await originUrls(cwd)).push;
	return origin ? githubSlug(origin) : null;
}

async function viewPr(cwd: string, slug: string, number: number, run: PrCommandRunner) {
	const viewed = await run(cwd, [
		"gh",
		"pr",
		"view",
		String(number),
		"--repo",
		slug,
		"--json",
		`headRefName,state,${HEAD_FIELDS}`,
	]);
	if (!viewed.ok) throw ghFailure(`Couldn't read PR #${number}`, viewed);
	try {
		const pr = JSON.parse(viewed.out) as Record<string, unknown>;
		return { headRefName: pr.headRefName, state: String(pr.state) as PrState, head: headSlug(pr) };
	} catch {
		throw new Error(`Couldn't read PR #${number}: gh answered something unexpected.`);
	}
}

/** `null` when gh could not answer — never read as "no open PR". */
async function headsOpenPr(
	cwd: string,
	slug: string,
	branch: string,
	run: PrCommandRunner,
): Promise<boolean | null> {
	const listed = await run(cwd, [
		"gh",
		"pr",
		"list",
		"--repo",
		slug,
		"--head",
		branch,
		"--state",
		"open",
		"--json",
		`number,${HEAD_FIELDS}`,
		"--limit",
		"20",
	]);
	if (!listed.ok) return null;
	try {
		const rows: unknown = JSON.parse(listed.out);
		if (!Array.isArray(rows)) return null;
		return rows.some(
			(row) =>
				typeof row === "object" &&
				row !== null &&
				headSlug(row as Record<string, unknown>) === slug.toLowerCase(),
		);
	} catch {
		return null;
	}
}

async function mutate(
	params: ReviewActionParams,
	states: PrState[],
	command: (cwd: string, slug: string) => string[],
	what: string,
	run: PrCommandRunner,
): Promise<{ cwd: string; slug: string }> {
	const ws = branchWorkspace(params.workspaceId, params.branch);
	const cwd = ws.worktreePath;
	try {
		const slug = await pushRepository(cwd);
		if (!slug) {
			throw new Error("This workspace's origin isn't a GitHub repository — nothing was changed.");
		}
		const pr = await viewPr(cwd, slug, params.number, run);
		if (pr.headRefName !== params.branch || pr.head !== slug.toLowerCase()) {
			throw new Error(
				`PR #${params.number} is not the pull request of ${slug}:${params.branch} — nothing was changed.`,
			);
		}
		if (!states.includes(pr.state)) {
			throw new Error(
				`PR #${params.number} is ${pr.state.toLowerCase()} on GitHub now — refresh and try again.`,
			);
		}
		const result = await run(cwd, command(cwd, slug), MUTATION_TIMEOUT_MS);
		if (!result.ok) throw ghFailure(what, result);
		return { cwd, slug };
	} finally {
		forgetOpenBranchReview(cwd);
	}
}

export async function readyPr(
	params: ReviewActionParams,
	run: PrCommandRunner = runProviderCommand,
): Promise<void> {
	await mutate(
		params,
		["OPEN"],
		(_cwd, slug) => ["gh", "pr", "ready", String(params.number), "--repo", slug],
		`Couldn't mark PR #${params.number} ready`,
		run,
	);
}

export async function reopenPr(
	params: ReviewActionParams,
	run: PrCommandRunner = runProviderCommand,
): Promise<void> {
	await mutate(
		params,
		["CLOSED"],
		(_cwd, slug) => ["gh", "pr", "reopen", String(params.number), "--repo", slug],
		`Couldn't reopen PR #${params.number}`,
		run,
	);
}

// Never `gh pr merge --delete-branch`: it also deletes the local branch and switches the checkout.
export async function mergePr(
	params: MergePrParams,
	run: PrCommandRunner = runProviderCommand,
): Promise<MergePrResult> {
	let mergedHead = "";
	const { cwd, slug } = await mutate(
		params,
		["OPEN"],
		(worktree, repo) => {
			const head = git(worktree, ["rev-parse", "HEAD"]);
			if (!head.ok) throw new Error(`Couldn't read HEAD: ${head.err || "git failed"}`);
			mergedHead = head.out;
			return [
				"gh",
				"pr",
				"merge",
				String(params.number),
				"--repo",
				repo,
				MERGE_FLAGS[params.method],
				"--match-head-commit",
				head.out,
			];
		},
		`Couldn't merge PR #${params.number}`,
		run,
	);
	const after = await viewPr(cwd, slug, params.number, run).catch(() => null);
	const merged = after?.state === "MERGED";
	if (!merged || !params.deleteBranch) return { merged, branchDeleted: false };
	try {
		const stillOpen = await headsOpenPr(cwd, slug, params.branch, run);
		if (stillOpen !== false) {
			return {
				merged,
				branchDeleted: false,
				deleteError:
					stillOpen === null
						? "couldn't confirm that no other pull request still uses it."
						: "another open pull request still uses it.",
			};
		}
		const deleted = await deleteOrigin(cwd, params.branch, mergedHead);
		return deleted === true
			? { merged, branchDeleted: true }
			: { merged, branchDeleted: false, deleteError: deleted };
	} catch (err) {
		return {
			merged,
			branchDeleted: false,
			deleteError: err instanceof Error ? err.message : String(err),
		};
	}
}

async function remoteHasRef(cwd: string, ref: string): Promise<boolean> {
	const target = (await originUrls(cwd)).push ?? "origin";
	const listed = await gitAsync(cwd, ["ls-remote", "--end-of-options", target, ref], {
		network: true,
	});
	return !listed.ok || listed.out.trim() !== "";
}

async function deleteOrigin(cwd: string, branch: string, expected: string): Promise<true | string> {
	const ref = `refs/heads/${branch}`;
	const pushed = await pushOrigin(cwd, [
		`--force-with-lease=${ref}:${expected}`,
		"origin",
		"--delete",
		ref,
	]);
	forgetOpenBranchReview(cwd);
	if (!("err" in pushed)) return true;
	if (/remote ref does not exist/i.test(pushed.err)) return true;
	if (!/stale info/i.test(pushed.err)) return pushed.err;
	if (!(await remoteHasRef(cwd, ref))) return true;
	return `origin/${branch} moved since this checkout last saw it — fetch and review it first. Nothing was deleted.`;
}

async function assertNoOpenReview(
	cwd: string,
	branch: string,
	run: PrCommandRunner,
): Promise<void> {
	const slug = await pushRepository(cwd);
	const open = slug
		? await headsOpenPr(cwd, slug, branch, run)
		: await findBranchReviewOutcome(cwd, branch, { fresh: true }).then((review) =>
				review.reliable ? review.value !== null && (review.value.state ?? "open") === "open" : null,
			);
	if (open === null) {
		throw new Error(
			`Couldn't confirm that "${branch}" has no open pull request — nothing was deleted. Try again in a moment.`,
		);
	}
	if (open) {
		throw new Error(
			`"${branch}" still has an open pull request — deleting the branch would close it. Nothing was deleted.`,
		);
	}
}

export async function deleteRemoteBranch(
	params: { workspaceId: string; branch: string },
	run: PrCommandRunner = runProviderCommand,
): Promise<void> {
	const ws = branchWorkspace(params.workspaceId, params.branch);
	await assertNoOpenReview(ws.worktreePath, ws.branch, run);
	const tip = await remoteRefOidAsync(ws.worktreePath, `origin/${ws.branch}`);
	if (!tip) {
		throw new Error(
			`Couldn't tell which commit origin/${ws.branch} points at — refresh and try again. Nothing was deleted.`,
		);
	}
	const contained = throwOnTimeout(
		git(ws.worktreePath, ["merge-base", "--is-ancestor", tip, "HEAD"]),
		`check origin/${ws.branch} against this checkout`,
		"Nothing was deleted.",
	);
	if (!contained.ok) {
		throw new Error(
			`origin/${ws.branch} has commits this checkout doesn't — integrate or review them first. Nothing was deleted.`,
		);
	}
	const deleted = await deleteOrigin(ws.worktreePath, ws.branch, tip);
	if (deleted !== true) throw new Error(deleted);
}
