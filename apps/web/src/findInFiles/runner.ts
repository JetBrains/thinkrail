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
	useFindInFiles,
} from "./state";

/** Seeded with the clock so a reloaded page never issues a `seq` the host has already seen from this client. */
let nextSeq = Date.now();
let unsubscribe: (() => void) | null = null;

function ensureSubscribed(): void {
	if (unsubscribe) return;
	unsubscribe = getTransport().subscribe(WS_CHANNELS.searchTextResults, (data) => {
		const batch = data as TextSearchBatch;
		if (applyTextSearchBatch(batch) && batch.done?.reason === "failed") forgetRequest();
	});
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

let lastRequest = { key: "", connection: -1 };

function forgetRequest(): void {
	lastRequest = { key: "", connection: -1 };
}

export function requestKeyOf(request: TextSearchRequest): string {
	return JSON.stringify([
		request.query,
		request.caseSensitive,
		request.wholeWord,
		contextKeyOf(request.context),
	]);
}

export function wasRequested(key: string, connection: number): boolean {
	if (key !== lastRequest.key) return false;
	return connection === lastRequest.connection || !useFindInFiles.getState().searching;
}

export function runTextSearch(request: TextSearchRequest, connection: number): void {
	lastRequest = { key: requestKeyOf(request), connection };
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
			forgetRequest();
			failTextSearch(seq);
		});
}
