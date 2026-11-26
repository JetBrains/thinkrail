import type { PanelHost } from "@thinkrail/extension-api/web";
import type {
	DigestProgress,
	IndexState,
	ListProject,
	ParsedSearch,
	SearchFacets,
	SearchHit,
	SearchVocabulary,
	SessionRef,
	SessionsListScope,
	SessionsSearchResult,
} from "@thinkrail/pi-session-insights/core";
import { useEffect, useEffectEvent, useReducer } from "react";
import { type ListFailure, listFailure } from "../load";
import { VersionSkew } from "../session/api";
import { loadSearch } from "./api";

/** A session's events received so far, in the order the server sent them. */
export interface SearchGroupView {
	session: SessionRef;
	matches: number;
	shown: number;
	events: readonly SearchHit[];
	more: string | null;
}

/**
 * `idle`: nothing to look for; `loading`: no answer yet; `scanning`: answers keep coming; `more`: a page
 * is full; `done`: every session was read; `cancelled`: the user stopped the scan.
 */
export type SearchPhase =
	| "idle"
	| "loading"
	| "scanning"
	| "more"
	| "done"
	| "cancelled"
	| "error"
	| "version";

interface Request {
	seq: number;
	query: string;
	scope: SessionsListScope;
	cursor: string | null;
	facets: boolean;
	/** The session a group's `more` was asked for. */
	group: string | null;
}

export interface SearchState {
	seq: number;
	query: string;
	scope: SessionsListScope;
	phase: SearchPhase;
	failure: ListFailure | null;
	parsed: ParsedSearch | null;
	groups: readonly SearchGroupView[];
	projects: readonly ListProject[];
	total: SessionsSearchResult["total"] | null;
	scanned: SessionsSearchResult["scanned"] | null;
	facets: SearchFacets | null;
	vocabulary: SearchVocabulary | null;
	index: IndexState | null;
	digests: DigestProgress | null;
	next: string | null;
	stopping: boolean;
	pending: Request | null;
	/** Sessions whose `more` is on its way. */
	loadingMore: readonly string[];
}

export type SearchAction =
	| { type: "query"; query: string; scope: SessionsListScope }
	| { type: "answer"; request: Request; result: SessionsSearchResult }
	| { type: "failed"; request: Request; error: unknown }
	| { type: "stop" }
	| { type: "resume" }
	| { type: "next" }
	| { type: "more"; sessionId: string };

function start(state: SearchState, query: string, scope: SessionsListScope): SearchState {
	const seq = state.seq + 1;
	return {
		...state,
		seq,
		query,
		scope,
		phase: query.trim() ? "loading" : "idle",
		failure: null,
		parsed: null,
		groups: [],
		total: null,
		scanned: null,
		facets: null,
		next: null,
		stopping: false,
		loadingMore: [],
		pending: { seq, query, scope, cursor: null, facets: true, group: null },
	};
}

function merged(
	groups: readonly SearchGroupView[],
	result: SessionsSearchResult,
): readonly SearchGroupView[] {
	const out = [...groups];
	for (const group of result.groups) {
		const session = result.sessions[group.session];
		if (!session) continue;
		const at = out.findIndex((existing) => existing.session.sessionId === session.sessionId);
		const existing = at >= 0 ? out[at] : undefined;
		const view: SearchGroupView = {
			session,
			matches: group.matches,
			shown: group.shown,
			events: existing ? [...existing.events, ...group.events] : group.events,
			more: group.more,
		};
		if (at >= 0) out[at] = view;
		else out.push(view);
	}
	return out;
}

function phaseOf(result: SessionsSearchResult, query: string): SearchPhase {
	const nothing = result.query.terms.length === 0 && result.query.filters.length === 0;
	if (!query.trim() || nothing) return "idle";
	if (result.status === "done") return "done";
	if (result.status === "more") return "more";
	return "scanning";
}

/** The search job's client side: requests to send, answers merged by session. Exported for tests. */
export function searchReducer(state: SearchState, action: SearchAction): SearchState {
	switch (action.type) {
		case "query":
			return start(state, action.query, action.scope);
		case "answer": {
			const { request, result } = action;
			if (request.seq !== state.seq) return state;
			if (result.status === "superseded") return state;
			if (result.status === "expired") return start(state, state.query, state.scope);
			const loadingMore = state.loadingMore.filter((id) => id !== request.group);
			const base: SearchState = {
				...state,
				parsed: result.query,
				groups: merged(state.groups, result),
				projects: result.projects.length > 0 ? result.projects : state.projects,
				facets: result.facets,
				vocabulary: result.vocabulary ?? state.vocabulary,
				index: result.state,
				digests: result.digests,
				loadingMore,
			};
			if (request.group !== null) return { ...base, pending: null };
			const phase = phaseOf(result, state.query);
			const scanning = phase === "scanning" && result.next !== null;
			return {
				...base,
				total: result.total,
				scanned: result.scanned,
				next: result.next,
				phase: scanning && state.stopping ? "cancelled" : phase,
				stopping: false,
				pending:
					scanning && !state.stopping
						? { ...request, cursor: result.next, facets: false, group: null }
						: null,
			};
		}
		case "failed": {
			if (action.request.seq !== state.seq) return state;
			if (action.request.group !== null)
				return {
					...state,
					pending: null,
					loadingMore: state.loadingMore.filter((id) => id !== action.request.group),
				};
			return {
				...state,
				phase: action.error instanceof VersionSkew ? "version" : "error",
				failure: action.error instanceof VersionSkew ? null : listFailure(action.error),
				pending: null,
				stopping: false,
			};
		}
		case "stop":
			return state.phase === "scanning" || state.phase === "loading"
				? { ...state, stopping: true }
				: state;
		case "resume":
		case "next":
			if (!state.next || state.pending) return state;
			return {
				...state,
				phase: "scanning",
				pending: {
					seq: state.seq,
					query: state.query,
					scope: state.scope,
					cursor: state.next,
					facets: false,
					group: null,
				},
			};
		case "more": {
			const group = state.groups.find(
				(candidate) => candidate.session.sessionId === action.sessionId,
			);
			if (!group?.more || state.pending) return state;
			return {
				...state,
				loadingMore: [...state.loadingMore, action.sessionId],
				pending: {
					seq: state.seq,
					query: state.query,
					scope: state.scope,
					cursor: group.more,
					facets: false,
					group: action.sessionId,
				},
			};
		}
	}
}

export function initialSearch(scope: SessionsListScope): SearchState {
	return {
		seq: 0,
		query: "",
		scope,
		phase: "idle",
		failure: null,
		parsed: null,
		groups: [],
		projects: [],
		total: null,
		scanned: null,
		facets: null,
		vocabulary: null,
		index: null,
		digests: null,
		next: null,
		stopping: false,
		pending: null,
		loadingMore: [],
	};
}

const DEBOUNCE_MS = 200;

export interface SearchControls {
	state: SearchState;
	stop: () => void;
	resume: () => void;
	loadMore: () => void;
	showMore: (sessionId: string) => void;
	retry: () => void;
}

/**
 * Drives the panel's search job: a query (debounced, trailing spaces dropped so the server's spans still
 * index the field's text) starts a new `seq`, answers that ran out of time
 * are followed at once until a page is full, the scan ends or the user stops it; `next` loads the
 * following page and a session's `more` the rest of its events. Only while `active`.
 */
export function useSearch(
	host: PanelHost,
	client: string,
	scope: SessionsListScope,
	query: string,
	active: boolean,
): SearchControls {
	const [state, dispatch] = useReducer(searchReducer, scope, initialSearch);
	const scopeKey = scope.kind === "all" ? "all" : `project:${scope.projectId}`;
	const typed = query.trimEnd();
	const restart = useEffectEvent(() => dispatch({ type: "query", query: typed, scope }));
	useEffect(() => {
		if (!active) return;
		const timer = setTimeout(restart, DEBOUNCE_MS);
		return () => clearTimeout(timer);
	}, [active, typed, scopeKey]);
	const pending = state.pending;
	useEffect(() => {
		if (!pending) return;
		const controller = new AbortController();
		loadSearch(
			host,
			{
				scope: pending.scope,
				client,
				seq: pending.seq,
				query: pending.query,
				...(pending.facets ? { facets: true } : {}),
				...(pending.cursor ? { cursor: pending.cursor } : {}),
			},
			controller.signal,
		).then(
			(result) => {
				if (!controller.signal.aborted) dispatch({ type: "answer", request: pending, result });
			},
			(error: unknown) => {
				if (!controller.signal.aborted) dispatch({ type: "failed", request: pending, error });
			},
		);
		return () => controller.abort();
	}, [client, host, pending]);
	return {
		state,
		stop: () => dispatch({ type: "stop" }),
		resume: () => dispatch({ type: "resume" }),
		loadMore: () => dispatch({ type: "next" }),
		showMore: (sessionId) => dispatch({ type: "more", sessionId }),
		retry: () => dispatch({ type: "query", query: typed, scope }),
	};
}
