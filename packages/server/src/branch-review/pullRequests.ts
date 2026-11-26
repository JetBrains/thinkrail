import type {
	GhSetupProblem,
	PullRequestAuthorPage,
	PullRequestFilter,
	PullRequestPage,
	PullRequestSize,
	PullRequestSizeEntry,
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
export type PullRequestListParams = { filter: PullRequestFilter; query?: string; cursor?: string };

type GithubRemote = { name: string; slug: string };

export const PULL_REQUEST_PAGE_SIZE = 20;
export const PULL_REQUEST_CACHE_TTL_MS = 60_000;
const MAX_SIZES = 50;
const VIEW_FIELDS =
	"number,title,author,state,isDraft,headRefName,baseRefName,url,additions,deletions,changedFiles,updatedAt";
const REMOTE_PREFERENCE = ["upstream", "github", "origin"];
const LOGIN = /^[A-Za-z0-9](?:[A-Za-z0-9-]{0,38})(?:\[bot\])?$/;
const SEARCH_QUERY = `query($q: String!, $after: String) {
  viewer { login }
  search(query: $q, type: ISSUE, first: ${PULL_REQUEST_PAGE_SIZE}, after: $after) {
    pageInfo { hasNextPage endCursor }
    nodes {
      ... on PullRequest {
        number title url state isDraft headRefName baseRefName updatedAt
        author { login }
        reviewRequests(first: 20) { nodes { requestedReviewer { ... on User { login } } } }
      }
    }
  }
}`;

const pageCache = new Map<string, { at: number; value: PullRequestPage }>();
const sizeCache = new Map<string, { at: number; value: PullRequestSize }>();

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

function record(value: unknown): Record<string, unknown> | null {
	return typeof value === "object" && value !== null ? (value as Record<string, unknown>) : null;
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

function size(row: Record<string, unknown>): PullRequestSize {
	return {
		additions: count(row.additions),
		deletions: count(row.deletions),
		changedFiles: count(row.changedFiles),
	};
}

function summary(
	item: unknown,
	remote: GithubRemote,
	reviewRequested: boolean,
	withSize: boolean,
): PullRequestSummary | null {
	const row = record(item);
	if (!row) return null;
	const number = row.number;
	if (typeof number !== "number" || !Number.isSafeInteger(number) || number <= 0) return null;
	const state = prState(row.state);
	const baseRefName = text(row.baseRefName);
	const url = text(row.url);
	if (!state || !baseRefName || !/^https:\/\/\S+$/.test(url)) return null;
	return {
		number,
		title: text(row.title),
		author: text(record(row.author)?.login),
		state,
		draft: row.isDraft === true,
		headRefName: text(row.headRefName),
		baseRefName,
		baseRef: `${remote.name}/${baseRefName}`,
		url,
		...(withSize ? { size: size(row) } : {}),
		updatedAt: text(row.updatedAt),
		reviewRequested,
	};
}

function parseJson(output: string): unknown {
	try {
		return JSON.parse(output);
	} catch {
		return undefined;
	}
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

const unavailable = (reason: PullRequestPage["unavailable"]): PullRequestPage => ({
	pullRequests: [],
	...(reason ? { unavailable: reason } : {}),
});

export function pullRequestSearch(
	slug: string,
	filter: PullRequestFilter,
	query: string | undefined,
): string {
	const parts = [`repo:${slug}`, "is:pr", "is:open", "sort:updated-desc"];
	if (filter.scope === "review-requested") parts.push("review-requested:@me");
	if (filter.scope === "mine") parts.push("author:@me");
	if (!filter.drafts) parts.push("draft:false");
	if (filter.author && LOGIN.test(filter.author)) parts.push(`author:${filter.author}`);
	const words = searchWords(query);
	if (words.length > 0) parts.push(...words, "in:title");
	return parts.join(" ");
}

const SEARCH_OPERATORS = new Set(["AND", "OR", "NOT"]);

function searchWords(query: string | undefined): string[] {
	return (query ?? "")
		.replace(/["\\]/g, " ")
		.split(/\s+/)
		.map((word) => word.replace(/^[-+]+/, ""))
		.filter((word) => word && !word.includes(":") && !SEARCH_OPERATORS.has(word));
}

function pruneExpired<V>(cache: Map<string, { at: number; value: V }>, now: number): void {
	for (const [key, entry] of cache) {
		if (now - entry.at >= PULL_REQUEST_CACHE_TTL_MS) cache.delete(key);
	}
}

function requestedOf(row: Record<string, unknown>, viewer: string): boolean {
	if (!viewer) return false;
	const nodes = record(row.reviewRequests)?.nodes;
	if (!Array.isArray(nodes)) return false;
	return nodes.some(
		(node) => text(record(record(node)?.requestedReviewer)?.login).toLowerCase() === viewer,
	);
}

function inRepository(url: string, slug: string): boolean {
	return url.toLowerCase().startsWith(`https://github.com/${slug.toLowerCase()}/pull/`);
}

function parsePage(
	output: string,
	remote: GithubRemote,
	filter: PullRequestFilter,
): PullRequestPage | null {
	const data = record(record(parseJson(output))?.data);
	const search = record(data?.search);
	const nodes = search?.nodes;
	if (!search || !Array.isArray(nodes)) return null;
	const viewer = text(record(data?.viewer)?.login).toLowerCase();
	const pullRequests: PullRequestSummary[] = [];
	for (const node of nodes) {
		const row = record(node);
		if (!row || row.number === undefined) continue;
		const requested = filter.scope === "review-requested" || requestedOf(row, viewer);
		const pr = summary(row, remote, requested, false);
		if (!pr) return null;
		if (!inRepository(pr.url, remote.slug)) continue;
		pullRequests.push(pr);
	}
	const pageInfo = record(search.pageInfo);
	const cursor = text(pageInfo?.endCursor);
	return {
		pullRequests,
		...(pageInfo?.hasNextPage === true && cursor ? { nextCursor: cursor } : {}),
	};
}

export async function listPullRequests(
	cwd: string,
	params: PullRequestListParams,
	deps: PullRequestDeps = {},
): Promise<PullRequestPage> {
	const now = deps.now ?? Date.now;
	const run = deps.run ?? runProviderCommand;
	const left = deadline(now);
	try {
		const remote = await githubRemote(cwd, left);
		if (remote === "failed") return unavailable("failed");
		if (remote === null) return unavailable("not-github");
		const q = pullRequestSearch(remote.slug, params.filter, params.query);
		const key = `${cwd}\u0000${q}\u0000${params.cursor ?? ""}`;
		const hit = pageCache.get(key);
		if (hit && now() - hit.at < PULL_REQUEST_CACHE_TTL_MS) return hit.value;
		const command = ["gh", "api", "graphql", "-f", `query=${SEARCH_QUERY}`, "-f", `q=${q}`];
		if (params.cursor) command.push("-f", `after=${params.cursor}`);
		const result = await run(cwd, command, left());
		if (!result.ok) {
			const problem = await problemWithin(deps.setupProblem ?? ghSetupProblem, left());
			return unavailable(problem ?? "failed");
		}
		const page = parsePage(result.out, remote, params.filter);
		if (!page) return unavailable("failed");
		pruneExpired(pageCache, now());
		pageCache.set(key, { at: now(), value: page });
		return page;
	} catch {
		return unavailable("failed");
	}
}

export const PULL_REQUEST_AUTHOR_PAGE_SIZE = 100;
const AUTHORS_QUERY = `query($q: String!, $after: String) {
  search(query: $q, type: ISSUE, first: ${PULL_REQUEST_AUTHOR_PAGE_SIZE}, after: $after) {
    pageInfo { hasNextPage endCursor }
    nodes { ... on PullRequest { author { login } } }
  }
}`;
const authorCache = new Map<string, { at: number; value: PullRequestAuthorPage }>();

export async function listPullRequestAuthors(
	cwd: string,
	cursor: string | undefined,
	deps: PullRequestDeps = {},
): Promise<PullRequestAuthorPage> {
	const now = deps.now ?? Date.now;
	const run = deps.run ?? runProviderCommand;
	const left = deadline(now);
	try {
		const remote = await githubRemote(cwd, left);
		if (remote === null || remote === "failed") return { authors: [] };
		const key = `${remote.slug}\u0000${cursor ?? ""}`;
		const hit = authorCache.get(key);
		if (hit && now() - hit.at < PULL_REQUEST_CACHE_TTL_MS) return hit.value;
		const q = `repo:${remote.slug} is:pr is:open sort:updated-desc`;
		const command = ["gh", "api", "graphql", "-f", `query=${AUTHORS_QUERY}`, "-f", `q=${q}`];
		if (cursor) command.push("-f", `after=${cursor}`);
		const result = await run(cwd, command, left());
		const search = result.ok ? record(record(record(parseJson(result.out))?.data)?.search) : null;
		const nodes = search?.nodes;
		if (!search || !Array.isArray(nodes)) return { authors: [] };
		const authors = [
			...new Set(
				nodes
					.map((node) => text(record(record(node)?.author)?.login))
					.filter((login) => login.length > 0),
			),
		];
		const pageInfo = record(search.pageInfo);
		const next = text(pageInfo?.endCursor);
		const value: PullRequestAuthorPage = {
			authors,
			...(pageInfo?.hasNextPage === true && next ? { nextCursor: next } : {}),
		};
		pruneExpired(authorCache, now());
		authorCache.set(key, { at: now(), value });
		return value;
	} catch {
		return { authors: [] };
	}
}

export async function pullRequestSizes(
	cwd: string,
	numbers: readonly number[],
	deps: PullRequestDeps = {},
): Promise<PullRequestSizeEntry[]> {
	const now = deps.now ?? Date.now;
	const run = deps.run ?? runProviderCommand;
	const left = deadline(now);
	const wanted = [...new Set(numbers)]
		.filter((number) => Number.isSafeInteger(number) && number > 0)
		.slice(0, MAX_SIZES);
	if (wanted.length === 0) return [];
	try {
		const remote = await githubRemote(cwd, left);
		if (remote === null || remote === "failed") return [];
		const cached = (number: number) => {
			const hit = sizeCache.get(`${remote.slug}#${number}`);
			return hit && now() - hit.at < PULL_REQUEST_CACHE_TTL_MS ? hit.value : null;
		};
		const missing = wanted.filter((number) => cached(number) === null);
		if (missing.length > 0) {
			const [owner = "", name = ""] = remote.slug.split("/");
			const fields = missing
				.map(
					(number) =>
						`p${number}: pullRequest(number: ${number}) { additions deletions changedFiles }`,
				)
				.join("\n");
			const query = `query($owner: String!, $name: String!) {\n  repository(owner: $owner, name: $name) {\n${fields}\n  }\n}`;
			const result = await run(
				cwd,
				[
					"gh",
					"api",
					"graphql",
					"-f",
					`query=${query}`,
					"-f",
					`owner=${owner}`,
					"-f",
					`name=${name}`,
				],
				left(),
			);
			const repository = result.ok
				? record(record(record(parseJson(result.out))?.data)?.repository)
				: null;
			pruneExpired(sizeCache, now());
			for (const number of missing) {
				const row = record(repository?.[`p${number}`]);
				if (row) sizeCache.set(`${remote.slug}#${number}`, { at: now(), value: size(row) });
			}
		}
		return wanted.flatMap((number) => {
			const value = cached(number);
			return value ? [{ number, ...value }] : [];
		});
	} catch {
		return [];
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
			["gh", "pr", "view", String(number), "--repo", remote.slug, "--json", VIEW_FIELDS],
			left(),
		);
		if (!viewed.ok) return null;
		return summary(parseJson(viewed.out), remote, false, true);
	} catch {
		return null;
	}
}
