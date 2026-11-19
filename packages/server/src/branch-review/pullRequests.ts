import type {
	GhSetupProblem,
	PullRequestList,
	PullRequestState,
	PullRequestSummary,
} from "@thinkrail/contracts";
import { gitAsync } from "../git";
import { ghSetupProblem } from "../github";
import { githubSlug, LOOKUP_TIMEOUT_MS, runProviderCommand } from "./branchReview";

type CommandResult = { ok: boolean; out: string; err?: string };
export type PullRequestRunner = (
	cwd: string,
	command: string[],
	timeoutMs: number,
) => Promise<CommandResult>;
export type PullRequestDeps = {
	run?: PullRequestRunner;
	setupProblem?: () => Promise<GhSetupProblem | null>;
	now?: () => number;
};

type GithubRemote = { name: string; slug: string };

const LIST_LIMIT = "100";
const SUMMARY_FIELDS =
	"number,title,author,state,isDraft,headRefName,baseRefName,url,additions,deletions,changedFiles,updatedAt";
const REVIEW_REQUESTED_SEARCH = "review-requested:@me";
const REMOTE_PREFERENCE = ["upstream", "github", "origin"];

function deadline(now: () => number): () => number {
	const end = now() + LOOKUP_TIMEOUT_MS;
	return () => Math.max(1, end - now());
}

async function githubRemote(
	cwd: string,
	left: () => number,
): Promise<GithubRemote | null | "failed"> {
	const listed = await gitAsync(cwd, ["remote"], { timeoutMs: left() });
	if (!listed.ok) return "failed";
	const names = listed.out.split("\n").filter(Boolean);
	const ordered = [
		...REMOTE_PREFERENCE.filter((name) => names.includes(name)),
		...names.filter((name) => !REMOTE_PREFERENCE.includes(name)),
	];
	for (const name of ordered) {
		const url = await gitAsync(cwd, ["remote", "get-url", name], { timeoutMs: left() });
		const slug = url.ok ? githubSlug(url.out) : null;
		if (slug) return { name, slug };
	}
	return null;
}

function text(value: unknown): string {
	return typeof value === "string" ? value : "";
}

function count(value: unknown): number {
	return typeof value === "number" && Number.isSafeInteger(value) && value >= 0 ? value : 0;
}

function prState(value: unknown): PullRequestState | null {
	switch (text(value).toUpperCase()) {
		case "OPEN":
			return "open";
		case "MERGED":
			return "merged";
		case "CLOSED":
			return "closed";
		default:
			return null;
	}
}

function summary(
	item: unknown,
	remote: GithubRemote,
	requested: ReadonlySet<number>,
): PullRequestSummary | null {
	if (typeof item !== "object" || item === null) return null;
	const row = item as Record<string, unknown>;
	const number = row.number;
	if (typeof number !== "number" || !Number.isSafeInteger(number) || number <= 0) return null;
	const state = prState(row.state);
	const baseRefName = text(row.baseRefName);
	const url = text(row.url);
	if (!state || !baseRefName || !/^https:\/\/\S+$/.test(url)) return null;
	const author = row.author as Record<string, unknown> | null | undefined;
	return {
		number,
		title: text(row.title),
		author: text(author?.login),
		state,
		draft: row.isDraft === true,
		headRefName: text(row.headRefName),
		baseRefName,
		baseRef: `${remote.name}/${baseRefName}`,
		url,
		additions: count(row.additions),
		deletions: count(row.deletions),
		changedFiles: count(row.changedFiles),
		updatedAt: text(row.updatedAt),
		reviewRequested: requested.has(number),
	};
}

function parseJson(output: string): unknown {
	try {
		return JSON.parse(output);
	} catch {
		return undefined;
	}
}

function requestedNumbers(result: CommandResult): Set<number> {
	const rows = result.ok ? parseJson(result.out) : undefined;
	if (!Array.isArray(rows)) return new Set();
	return new Set(
		rows
			.map((row) => (typeof row === "object" && row !== null ? row.number : undefined))
			.filter((number): number is number => typeof number === "number"),
	);
}

async function problemWithin(
	probe: () => Promise<GhSetupProblem | null>,
	timeoutMs: number,
): Promise<GhSetupProblem | null> {
	let timer: ReturnType<typeof setTimeout> | undefined;
	const expired = new Promise<null>((resolve) => {
		timer = setTimeout(() => resolve(null), timeoutMs);
	});
	try {
		return await Promise.race([probe().catch(() => null), expired]);
	} finally {
		clearTimeout(timer);
	}
}

const unavailable = (reason: PullRequestList["unavailable"]): PullRequestList => ({
	pullRequests: [],
	...(reason ? { unavailable: reason } : {}),
});

export async function listPullRequests(
	cwd: string,
	deps: PullRequestDeps = {},
): Promise<PullRequestList> {
	const run = deps.run ?? runProviderCommand;
	const left = deadline(deps.now ?? Date.now);
	try {
		const remote = await githubRemote(cwd, left);
		if (remote === "failed") return unavailable("failed");
		if (remote === null) return unavailable("not-github");
		const list = ["gh", "pr", "list", "--repo", remote.slug, "--state", "open"];
		const [all, requested] = await Promise.all([
			run(cwd, [...list, "--json", SUMMARY_FIELDS, "--limit", LIST_LIMIT], left()),
			run(
				cwd,
				[...list, "--search", REVIEW_REQUESTED_SEARCH, "--json", "number", "--limit", LIST_LIMIT],
				left(),
			),
		]);
		if (!all.ok) {
			const problem = await problemWithin(deps.setupProblem ?? ghSetupProblem, left());
			return unavailable(problem ?? "failed");
		}
		const rows = parseJson(all.out);
		if (!Array.isArray(rows)) return unavailable("failed");
		const reviewRequested = requestedNumbers(requested);
		const pullRequests: PullRequestSummary[] = [];
		for (const item of rows) {
			const pr = summary(item, remote, reviewRequested);
			if (!pr) return unavailable("failed");
			pullRequests.push(pr);
		}
		return { pullRequests };
	} catch {
		return unavailable("failed");
	}
}

export async function getPullRequest(
	cwd: string,
	number: number,
	deps: PullRequestDeps = {},
): Promise<PullRequestSummary | null> {
	if (!Number.isSafeInteger(number) || number <= 0) return null;
	const run = deps.run ?? runProviderCommand;
	const left = deadline(deps.now ?? Date.now);
	try {
		const remote = await githubRemote(cwd, left);
		if (remote === null || remote === "failed") return null;
		const viewed = await run(
			cwd,
			["gh", "pr", "view", String(number), "--repo", remote.slug, "--json", SUMMARY_FIELDS],
			left(),
		);
		if (!viewed.ok) return null;
		return summary(parseJson(viewed.out), remote, new Set());
	} catch {
		return null;
	}
}
