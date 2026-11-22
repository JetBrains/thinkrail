import type { PullRequestSummary } from "@thinkrail/contracts";

export const REVIEW_PULL_REQUEST_PROMPT = "/skill:reviewing-a-pr ";

const PULL_URL = /^https:\/\/github\.com\/([^/\s]+\/[^/\s]+)\/pull\/(\d+)(?:[/?#]\S*)?$/i;

export interface PullRequestReference {
	number: number;
	/** `owner/repo`, lower-cased, when the reference was a link. */
	repository: string | null;
}

export function pullRequestReferenceOf(text: string): PullRequestReference | null {
	const trimmed = text.trim();
	const link = PULL_URL.exec(trimmed);
	const digits = /^#?(\d+)$/.exec(trimmed)?.[1] ?? link?.[2];
	if (!digits) return null;
	const number = Number(digits);
	if (!Number.isSafeInteger(number) || number <= 0) return null;
	return { number, repository: link?.[1]?.toLowerCase() ?? null };
}

export function isReferencedPullRequest(
	pr: Pick<PullRequestSummary, "number" | "url">,
	reference: PullRequestReference,
): boolean {
	if (pr.number !== reference.number) return false;
	if (reference.repository === null) return true;
	return PULL_URL.exec(pr.url)?.[1]?.toLowerCase() === reference.repository;
}

/** The argument is complete once a pull-request reference is followed by whitespace (a focus note may follow). */
export function isPullRequestArgumentComplete(query: string): boolean {
	const first = /^(\S+)\s/.exec(query)?.[1];
	return first !== undefined && pullRequestReferenceOf(first) !== null;
}

/** Waiting-for-review rows first, the rest after, each in GitHub's order. */
export function orderPullRequests(rows: readonly PullRequestSummary[]): PullRequestSummary[] {
	return [...rows.filter((pr) => pr.reviewRequested), ...rows.filter((pr) => !pr.reviewRequested)];
}

export function authorsOf(rows: readonly PullRequestSummary[], current?: string): string[] {
	const authors = new Set(rows.map((pr) => pr.author).filter(Boolean));
	if (current) authors.add(current);
	return [...authors].sort((a, b) => a.localeCompare(b));
}
