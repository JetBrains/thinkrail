import type { PullRequestListProblem, PullRequestSummary } from "@thinkrail/contracts";
import { useCallback, useEffect, useRef, useState } from "react";
import { getTransport } from "../transport";

export const REVIEW_PR_COMMAND = "/skill:reviewing-a-pr ";

/** What the dialog needs of a picked pull request; a full summary once `pr.list` / `pr.get` answered. */
export type PickedPullRequest = Pick<PullRequestSummary, "number" | "url" | "baseRef"> &
	Partial<PullRequestSummary>;

export type PullRequestListState =
	| { kind: "loading" }
	| { kind: "ready"; pullRequests: PullRequestSummary[] }
	| { kind: "unavailable"; reason: PullRequestListProblem };

export type PullRequestLookup =
	| { kind: "idle" }
	| { kind: "searching"; number: number }
	| { kind: "found"; pullRequest: PullRequestSummary }
	| { kind: "missing"; number: number };

const PULL_URL = /^https:\/\/github\.com\/[^/\s]+\/[^/\s]+\/pull\/(\d+)(?:[/?#]\S*)?$/i;
const LOOKUP_DELAY_MS = 250;

export function reviewKickoffText(url: string): string {
	return `${REVIEW_PR_COMMAND}${url}`;
}

/** The pull request a review kickoff names — how Edit & retry reopens a failed review in its mode. */
export function reviewKickoffPullRequest(text: string): { number: number; url: string } | null {
	if (!text.startsWith(REVIEW_PR_COMMAND)) return null;
	const url = text.slice(REVIEW_PR_COMMAND.length).trim();
	const number = pullRequestNumberOf(url);
	return number !== null && PULL_URL.test(url) ? { number, url } : null;
}

/** A pasted number (`1431`, `#1431`) or pull-request link, or `null` for ordinary search text. */
export function pullRequestNumberOf(query: string): number | null {
	const text = query.trim();
	const digits = /^#?(\d+)$/.exec(text)?.[1] ?? PULL_URL.exec(text)?.[1];
	if (!digits) return null;
	const number = Number(digits);
	return Number.isSafeInteger(number) && number > 0 ? number : null;
}

export function matchesPullRequest(pr: PullRequestSummary, query: string): boolean {
	const haystack = `#${pr.number} ${pr.title} ${pr.author} ${pr.headRefName}`.toLowerCase();
	return query
		.toLowerCase()
		.split(/\s+/)
		.filter(Boolean)
		.every((word) => haystack.includes(word));
}

export interface PullRequestRows {
	waiting: PullRequestSummary[];
	open: PullRequestSummary[];
	/** Asked by number and not among the open ones: looked up with `pr.get`. */
	lookupNumber: number | null;
}

export function pullRequestRows(
	pullRequests: readonly PullRequestSummary[],
	query: string,
): PullRequestRows {
	const number = pullRequestNumberOf(query);
	const shown =
		number !== null
			? pullRequests.filter((pr) => pr.number === number)
			: pullRequests.filter((pr) => matchesPullRequest(pr, query));
	return {
		waiting: shown.filter((pr) => pr.reviewRequested),
		open: shown.filter((pr) => !pr.reviewRequested),
		lookupNumber: number !== null && shown.length === 0 ? number : null,
	};
}

export function usePullRequestList(projectId: string | null): {
	state: PullRequestListState;
	retry: () => void;
} {
	const [state, setState] = useState<PullRequestListState>({ kind: "loading" });
	const generation = useRef(0);

	const load = useCallback((id: string) => {
		const mine = ++generation.current;
		setState({ kind: "loading" });
		void getTransport()
			.request("pr.list", { projectId: id })
			.then(
				(list): PullRequestListState =>
					list.unavailable
						? { kind: "unavailable", reason: list.unavailable }
						: { kind: "ready", pullRequests: list.pullRequests },
				(): PullRequestListState => ({ kind: "unavailable", reason: "failed" }),
			)
			.then((next) => {
				if (generation.current === mine) setState(next);
			});
	}, []);

	useEffect(() => {
		if (projectId) load(projectId);
		return () => {
			generation.current += 1;
		};
	}, [projectId, load]);

	const retry = useCallback(() => {
		if (projectId) load(projectId);
	}, [projectId, load]);

	return { state, retry };
}

export function getPullRequest(
	projectId: string,
	number: number,
): Promise<PullRequestSummary | null> {
	return getTransport()
		.request("pr.get", { projectId, number })
		.catch(() => null);
}

export function usePullRequestLookup(projectId: string | null, number: number | null) {
	const [lookup, setLookup] = useState<PullRequestLookup>({ kind: "idle" });

	useEffect(() => {
		if (!projectId || number === null) {
			setLookup({ kind: "idle" });
			return;
		}
		let cancelled = false;
		setLookup({ kind: "searching", number });
		const timer = setTimeout(() => {
			void getPullRequest(projectId, number).then((pullRequest) => {
				if (cancelled) return;
				setLookup(pullRequest ? { kind: "found", pullRequest } : { kind: "missing", number });
			});
		}, LOOKUP_DELAY_MS);
		return () => {
			cancelled = true;
			clearTimeout(timer);
		};
	}, [projectId, number]);

	return lookup;
}
