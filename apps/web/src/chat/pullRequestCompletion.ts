import {
	DEFAULT_PULL_REQUEST_FILTER,
	type PullRequestFilter,
	type PullRequestListProblem,
	type PullRequestSize,
	type PullRequestSummary,
} from "@thinkrail/contracts";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useAppStore } from "../store";
import { getTransport, rememberPullRequestFilter, supportsPullRequestReview } from "../transport";
import {
	isReferencedPullRequest,
	mergeAuthors,
	orderPullRequests,
	pullRequestReferenceOf,
} from "./pullRequestArguments";

export type PullRequestLookup =
	| { kind: "searching"; number: number }
	| { kind: "found"; pullRequest: PullRequestSummary }
	| { kind: "missing"; number: number };

export type PullRequestListing =
	| { kind: "loading" }
	| { kind: "ready" }
	| { kind: "unavailable"; reason: PullRequestListProblem };

export interface PullRequestAuthors {
	/** Everyone with an open pull request loaded so far, most recently active first. */
	names: string[];
	loading: boolean;
	hasMore: boolean;
	/** Load the first page if none is loaded yet, else the next one. */
	request: () => void;
}

export interface PullRequestCompletion {
	listing: PullRequestListing;
	/** What Enter picks, in display order: a looked-up PR alone, or the waiting rows then the rest. */
	items: PullRequestSummary[];
	waitingCount: number;
	lookup: PullRequestLookup | null;
	filter: PullRequestFilter;
	setFilter: (filter: PullRequestFilter) => void;
	authors: PullRequestAuthors;
	hasMore: boolean;
	/** Rows plus the Show more row the keyboard reaches when another page exists. */
	optionCount: number;
	/** The row at `index`; the Show more row loads the next page and returns `null`. */
	pick: (index: number) => PullRequestSummary | null;
	loadingMore: boolean;
	loadMore: () => void;
	retry: () => void;
}

const SEARCH_DELAY_MS = 250;

type Page = { rows: PullRequestSummary[]; next?: string };

const sizeKey = (projectId: string, number: number) => `${projectId}#${number}`;

function withSize(
	pr: PullRequestSummary,
	projectId: string | null,
	sizes: ReadonlyMap<string, PullRequestSize>,
) {
	const size = pr.size ?? (projectId ? sizes.get(sizeKey(projectId, pr.number)) : undefined);
	return size ? { ...pr, size } : pr;
}

/**
 * The pull requests a `/<command> <query>` argument offers; `query` is `null` while no such argument
 * is being typed, which keeps every request idle.
 */
export function usePullRequestCompletion(
	projectId: string | null,
	query: string | null,
): PullRequestCompletion | null {
	const supported = useAppStore((s) => supportsPullRequestReview(s.protocolVersion));
	const remembered = useAppStore((s) => (projectId ? s.pullRequestFilters[projectId] : undefined));
	const enabled = supported && projectId !== null && query !== null;
	const [chosen, setChosen] = useState<{
		projectId: string | null;
		filter: PullRequestFilter;
	} | null>(null);
	const filter =
		chosen?.projectId === projectId ? chosen.filter : (remembered ?? DEFAULT_PULL_REQUEST_FILTER);
	const reference = query === null ? null : pullRequestReferenceOf(query);
	const words = query !== null && reference === null ? query.trim() : "";

	const [listing, setListing] = useState<PullRequestListing>({ kind: "loading" });
	const [pages, setPages] = useState<Page[]>([]);
	const [loadingMore, setLoadingMore] = useState(false);
	const [sizes, setSizes] = useState<ReadonlyMap<string, PullRequestSize>>(new Map());
	const [lookup, setLookup] = useState<PullRequestLookup | null>(null);
	const [attempt, setAttempt] = useState(0);
	const generation = useRef(0);

	const fetchSizes = useCallback((id: string, rows: readonly PullRequestSummary[]) => {
		const numbers = rows.filter((pr) => !pr.size).map((pr) => pr.number);
		if (numbers.length === 0) return;
		const mine = generation.current;
		void getTransport()
			.request("pr.sizes", { projectId: id, numbers })
			.then((entries) => {
				if (generation.current !== mine) return;
				setSizes((current) => {
					const next = new Map(current);
					for (const { number, ...size } of entries) next.set(sizeKey(id, number), size);
					return next;
				});
			})
			.catch(() => {});
	}, []);

	const filterKey = JSON.stringify(filter);
	const hasReference = reference !== null;
	useEffect(() => {
		if (!enabled || !projectId || hasReference) return;
		const mine = ++generation.current;
		setListing({ kind: "loading" });
		setPages([]);
		setLoadingMore(false);
		const pageFilter = JSON.parse(filterKey) as PullRequestFilter;
		const timer = setTimeout(
			() => {
				void getTransport()
					.request("pr.list", {
						projectId,
						filter: pageFilter,
						...(words ? { query: words } : {}),
					})
					.then(
						(page) => {
							if (generation.current !== mine) return;
							if (page.unavailable) {
								setListing({ kind: "unavailable", reason: page.unavailable });
								return;
							}
							setPages([
								{ rows: page.pullRequests, ...(page.nextCursor ? { next: page.nextCursor } : {}) },
							]);
							setListing({ kind: "ready" });
							fetchSizes(projectId, page.pullRequests);
						},
						() => {
							if (generation.current === mine)
								setListing({ kind: "unavailable", reason: "failed" });
						},
					);
			},
			words ? SEARCH_DELAY_MS : 0,
		);
		return () => {
			clearTimeout(timer);
			generation.current += 1;
		};
	}, [enabled, projectId, hasReference, words, filterKey, attempt, fetchSizes]);

	const referenceKey = reference ? `${reference.number}\u0000${reference.repository ?? ""}` : "";
	useEffect(() => {
		if (!enabled || !projectId || !referenceKey) {
			setLookup(null);
			return;
		}
		const [numberText = "", repository = ""] = referenceKey.split("\u0000");
		const wanted = { number: Number(numberText), repository: repository || null };
		let cancelled = false;
		setLookup({ kind: "searching", number: wanted.number });
		const timer = setTimeout(() => {
			void getTransport()
				.request("pr.get", { projectId, number: wanted.number })
				.catch(() => null)
				.then((pr) => {
					if (cancelled) return;
					setLookup(
						pr && isReferencedPullRequest(pr, wanted)
							? { kind: "found", pullRequest: pr }
							: { kind: "missing", number: wanted.number },
					);
				});
		}, SEARCH_DELAY_MS);
		return () => {
			cancelled = true;
			clearTimeout(timer);
		};
	}, [enabled, projectId, referenceKey]);

	const next = pages.at(-1)?.next;
	const loadMore = useCallback(() => {
		if (!projectId || !next || loadingMore) return;
		const mine = generation.current;
		setLoadingMore(true);
		void getTransport()
			.request("pr.list", {
				projectId,
				filter: JSON.parse(filterKey) as PullRequestFilter,
				...(words ? { query: words } : {}),
				cursor: next,
			})
			.then(
				(page) => {
					if (generation.current !== mine || page.unavailable) return;
					setPages((current) => [
						...current,
						{ rows: page.pullRequests, ...(page.nextCursor ? { next: page.nextCursor } : {}) },
					]);
					fetchSizes(projectId, page.pullRequests);
				},
				() => {},
			)
			.finally(() => {
				if (generation.current === mine) setLoadingMore(false);
			});
	}, [projectId, next, loadingMore, filterKey, words, fetchSizes]);

	const setFilter = useCallback(
		(nextFilter: PullRequestFilter) => {
			setChosen({ projectId, filter: nextFilter });
			if (projectId) rememberPullRequestFilter(projectId, nextFilter);
		},
		[projectId],
	);

	const retry = useCallback(() => setAttempt((count) => count + 1), []);

	const rows = useMemo(
		() =>
			orderPullRequests(pages.flatMap((page) => page.rows)).map((pr) =>
				withSize(pr, projectId, sizes),
			),
		[pages, sizes, projectId],
	);

	const authors = usePullRequestAuthors(enabled ? projectId : null, filter.author, attempt);

	if (!enabled) return null;
	const found = lookup?.kind === "found" ? lookup.pullRequest : null;
	const items = reference ? (found ? [found] : []) : rows;
	const hasMore = !reference && next !== undefined;
	return {
		listing: reference ? { kind: "ready" } : listing,
		items,
		waitingCount: reference ? 0 : rows.filter((pr) => pr.reviewRequested).length,
		lookup: reference ? lookup : null,
		filter,
		setFilter,
		authors,
		hasMore,
		optionCount: items.length + (hasMore ? 1 : 0),
		pick: (index) => {
			if (hasMore && index === items.length) {
				loadMore();
				return null;
			}
			return items[index] ?? null;
		},
		loadingMore,
		loadMore,
		retry,
	};
}

type AuthorState = {
	key: string | null;
	pages: string[][];
	next: string | null | undefined;
};

function usePullRequestAuthors(
	projectId: string | null,
	current: string | undefined,
	attempt: number,
): PullRequestAuthors {
	const key = projectId ? `${projectId}\u0000${attempt}` : null;
	const [state, setState] = useState<AuthorState>({ key, pages: [], next: undefined });
	if (state.key !== key) setState({ key, pages: [], next: undefined });
	const own: AuthorState = state.key === key ? state : { key, pages: [], next: undefined };
	const [loading, setLoading] = useState(false);
	const inFlight = useRef<string | null>(null);

	const request = useCallback(() => {
		if (!projectId || !key || own.next === null) return;
		const cursor = own.next;
		const requestKey = `${key}\u0000${cursor ?? ""}`;
		if (inFlight.current === requestKey) return;
		inFlight.current = requestKey;
		setLoading(true);
		const settle = (apply: (base: AuthorState) => AuthorState) =>
			setState((previous) =>
				previous.key !== key || previous.next !== cursor ? previous : apply(previous),
			);
		void getTransport()
			.request("pr.authors", { projectId, ...(cursor ? { cursor } : {}) })
			.then(
				(page) =>
					settle((base) => ({
						key,
						pages: [...base.pages, page.authors],
						next: page.nextCursor ?? null,
					})),
				() => settle((base) => ({ ...base, next: null })),
			)
			.finally(() => {
				if (inFlight.current === requestKey) inFlight.current = null;
				setLoading(false);
			});
	}, [projectId, key, own.next]);

	const names = useMemo(() => mergeAuthors(own.pages, current), [own.pages, current]);
	return { names, loading, hasMore: own.next !== null, request };
}
