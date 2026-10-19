import type { MergeMethod, MergePrResult } from "@thinkrail/contracts";
import {
	findBranchReviewOutcome,
	forgetOpenBranchReview,
	runProviderCommand,
} from "../branch-review";
import { git } from "../git";
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

function branchWorkspace(workspaceId: string, branch: string) {
	const ws = refreshedWorkspace(workspaceId, undefined);
	if (ws.branch !== branch) {
		throw new Error(
			`The checkout moved from "${branch}" to "${ws.branch}" — nothing was changed. Review the branch and try again.`,
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

async function assertBranchPr(
	cwd: string,
	params: ReviewActionParams,
	states: PrState[],
	run: PrCommandRunner,
): Promise<void> {
	const viewed = await run(cwd, [
		"gh",
		"pr",
		"view",
		String(params.number),
		"--json",
		"headRefName,state",
	]);
	if (!viewed.ok) throw ghFailure(`Couldn't read PR #${params.number}`, viewed);
	let pr: { headRefName?: unknown; state?: unknown };
	try {
		pr = JSON.parse(viewed.out) as typeof pr;
	} catch {
		throw new Error(`Couldn't read PR #${params.number}: gh answered something unexpected.`);
	}
	if (pr.headRefName !== params.branch) {
		throw new Error(
			`PR #${params.number} is no longer the pull request of "${params.branch}" — nothing was changed.`,
		);
	}
	if (!states.includes(String(pr.state) as PrState)) {
		throw new Error(
			`PR #${params.number} is ${String(pr.state).toLowerCase()} on GitHub now — refresh and try again.`,
		);
	}
}

async function mutate(
	params: ReviewActionParams,
	states: PrState[],
	command: (cwd: string) => string[],
	what: string,
	run: PrCommandRunner,
): Promise<string> {
	const ws = branchWorkspace(params.workspaceId, params.branch);
	const cwd = ws.worktreePath;
	try {
		await assertBranchPr(cwd, params, states, run);
		const result = await run(cwd, command(cwd), MUTATION_TIMEOUT_MS);
		if (!result.ok) throw ghFailure(what, result);
		return cwd;
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
		() => ["gh", "pr", "ready", String(params.number)],
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
		() => ["gh", "pr", "reopen", String(params.number)],
		`Couldn't reopen PR #${params.number}`,
		run,
	);
}

// Never `gh pr merge --delete-branch`: it also deletes the local branch and switches the checkout.
export async function mergePr(
	params: MergePrParams,
	run: PrCommandRunner = runProviderCommand,
): Promise<MergePrResult> {
	const cwd = await mutate(
		params,
		["OPEN"],
		(worktree) => {
			const head = git(worktree, ["rev-parse", "HEAD"]);
			if (!head.ok) throw new Error(`Couldn't read HEAD: ${head.err || "git failed"}`);
			return [
				"gh",
				"pr",
				"merge",
				String(params.number),
				MERGE_FLAGS[params.method],
				"--match-head-commit",
				head.out,
			];
		},
		`Couldn't merge PR #${params.number}`,
		run,
	);
	if (!params.deleteBranch) return { branchDeleted: false };
	try {
		const deleted = await deleteOrigin(cwd, params.branch);
		return deleted === true
			? { branchDeleted: true }
			: { branchDeleted: false, deleteError: deleted };
	} catch (err) {
		return {
			branchDeleted: false,
			deleteError: err instanceof Error ? err.message : String(err),
		};
	}
}

async function deleteOrigin(cwd: string, branch: string): Promise<true | string> {
	const pushed = await pushOrigin(cwd, ["origin", "--delete", branch]);
	forgetOpenBranchReview(cwd);
	if (!("err" in pushed)) return true;
	return /remote ref does not exist/i.test(pushed.err) ? true : pushed.err;
}

export async function deleteRemoteBranch(params: {
	workspaceId: string;
	branch: string;
}): Promise<void> {
	const ws = branchWorkspace(params.workspaceId, params.branch);
	if (onBaseBranch(ws)) {
		throw new Error(`"${ws.branch}" is this workspace's base branch — it is never deleted.`);
	}
	const review = await findBranchReviewOutcome(ws.worktreePath, ws.branch, { fresh: true });
	if (review.value && (review.value.state ?? "open") === "open") {
		throw new Error(
			`"${ws.branch}" still has an open ${review.value.kind === "pull-request" ? "PR" : "MR"} — deleting the branch would close it. Nothing was deleted.`,
		);
	}
	const deleted = await deleteOrigin(ws.worktreePath, ws.branch);
	if (deleted !== true) throw new Error(deleted);
}
