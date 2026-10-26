import {
	type SearchContext,
	TEXT_SEARCH_LIMITS,
	type TextSearchBatch,
	WS_CHANNELS,
} from "@thinkrail/contracts";
import { getTransport } from "../transport";
import {
	applyTextSearchBatch,
	beginTextSearch,
	clearTextSearch,
	effectiveCaseSensitive,
	failTextSearch,
} from "./state";

/** Seeded with the clock so a reloaded page never issues a `seq` the host has already seen from this client. */
let nextSeq = Date.now();
let unsubscribe: (() => void) | null = null;

function ensureSubscribed(): void {
	if (unsubscribe) return;
	unsubscribe = getTransport().subscribe(WS_CHANNELS.searchTextResults, (data) =>
		applyTextSearchBatch(data as TextSearchBatch),
	);
}

export function contextKeyOf(context: SearchContext): string {
	return `${context.projectId ?? ""}\u0000${context.workspaceId ?? ""}`;
}

export interface TextSearchRequest {
	query: string;
	caseSensitive: boolean;
	wholeWord: boolean;
	context: SearchContext;
}

let lastRequestKey = "";

export function requestKeyOf(request: TextSearchRequest): string {
	return JSON.stringify([
		request.query,
		request.caseSensitive,
		request.wholeWord,
		contextKeyOf(request.context),
	]);
}

export function wasRequested(key: string): boolean {
	return key === lastRequestKey;
}

export function runTextSearch(request: TextSearchRequest): void {
	lastRequestKey = requestKeyOf(request);
	if (request.query.trim().length < TEXT_SEARCH_LIMITS.minQuery) {
		clearTextSearch();
		return;
	}
	ensureSubscribed();
	const seq = nextSeq++;
	beginTextSearch(seq, contextKeyOf(request.context));
	void getTransport()
		.request("search.text", {
			seq,
			query: request.query.slice(0, TEXT_SEARCH_LIMITS.maxQuery),
			context: request.context,
			caseSensitive: effectiveCaseSensitive(request.query, request.caseSensitive),
			wholeWord: request.wholeWord,
		})
		.then((result) => {
			if (result.superseded) failTextSearch(seq);
		})
		.catch(() => {
			lastRequestKey = "";
			failTextSearch(seq);
		});
}
