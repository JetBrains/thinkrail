import type {
	SearchContext,
	SearchGroup,
	SearchKind,
	SearchPreviewResult,
	SearchPreviewTarget,
	SearchQueryResult,
	WsParams,
} from "@thinkrail/contracts";
import { useEffect, useState } from "react";
import { selectHostReachable, useAppStore } from "../store";
import { getTransport } from "../transport";
import { type Arrivals, NO_ARRIVALS, noteArrivals } from "./arrivals";

export const HOST_SEARCH = {
	debounceMs: 100,
	indexingPollMs: 300,
	slowIndexingPollMs: 1_000,
	fastIndexingPolls: 10,
	maxIndexingPolls: 37,
	quietRetryMs: [300, 600, 1_200],
} as const;

export interface HostSearchInput {
	readonly enabled: boolean;
	readonly text: string;
	readonly kinds: readonly SearchKind[];
	readonly context: SearchContext;
	readonly limit?: number;
}

export interface HostSearchState {
	readonly groups: readonly SearchGroup[] | null;
	readonly pending: boolean;
	readonly stale: boolean;
	readonly arrivals: Arrivals;
}

export const IDLE_HOST_SEARCH: HostSearchState = {
	groups: null,
	pending: false,
	stale: false,
	arrivals: NO_ARRIVALS,
};

export function sameHostInput(a: HostSearchInput, b: HostSearchInput): boolean {
	return (
		a.enabled === b.enabled &&
		a.text === b.text &&
		a.kinds.join(",") === b.kinds.join(",") &&
		a.context.projectId === b.context.projectId &&
		a.context.workspaceId === b.context.workspaceId &&
		a.limit === b.limit
	);
}

export function isActiveHostInput(input: HostSearchInput): boolean {
	return input.enabled && input.text.trim().length > 0 && input.kinds.length > 0;
}

export function mergeHostGroups(
	shown: readonly SearchGroup[] | null,
	reply: readonly SearchGroup[],
): SearchGroup[] {
	const answered = new Map(reply.map((group) => [group.kind, group]));
	const merged: SearchGroup[] = [];
	for (const group of shown ?? []) {
		const next = answered.get(group.kind);
		if (!next) {
			merged.push(group);
			continue;
		}
		answered.delete(group.kind);
		const ids = new Set(next.hits.map((hit) => hit.id));
		const hits = [...next.hits, ...group.hits.filter((hit) => !ids.has(hit.id))];
		merged.push({ ...next, hits, total: Math.max(next.total, hits.length) });
	}
	return [...merged, ...answered.values()];
}

function failedGroups(kinds: readonly SearchKind[]): SearchGroup[] {
	return kinds.map((kind) => ({ kind, hits: [], total: 0, state: "failed" }));
}

export type HostSearchReason =
	| { readonly kind: "failed" }
	| { readonly kind: "indexing" }
	| { readonly kind: "time" }
	| { readonly kind: "fileList"; readonly files: number };

export function hostSearchReasons(state: HostSearchState): HostSearchReason[] {
	if (!state.groups || state.stale) return [];
	const reasons: HostSearchReason[] = [];
	if (state.groups.some((group) => group.state === "failed")) reasons.push({ kind: "failed" });
	if (!state.pending && state.groups.some((group) => group.state === "indexing")) {
		reasons.push({ kind: "indexing" });
	}
	const files = state.groups.find((group) => group.cut?.fileList !== undefined)?.cut?.fileList;
	if (files !== undefined) reasons.push({ kind: "fileList", files });
	if (state.groups.some((group) => group.cut?.time)) reasons.push({ kind: "time" });
	return reasons;
}

export interface HostSearchControllerDeps {
	readonly request: (params: WsParams<"search.query">) => Promise<SearchQueryResult>;
	readonly emit: (state: HostSearchState) => void;
	readonly schedule?: (run: () => void, ms: number) => () => void;
}

export interface HostSearchController {
	update(input: HostSearchInput | null): void;
	connect(reachable: boolean, generation: number): void;
	observe(onScreen: ReadonlySet<string>, holdingSelection: boolean): void;
	dispose(): void;
}

const defaultSchedule = (run: () => void, ms: number) => {
	const timer = setTimeout(run, ms);
	return () => clearTimeout(timer);
};

function pollDelay(polls: number): number {
	return polls < HOST_SEARCH.fastIndexingPolls
		? HOST_SEARCH.indexingPollMs
		: HOST_SEARCH.slowIndexingPollMs;
}

function kindsIn(groups: readonly SearchGroup[], state: SearchGroup["state"]): SearchKind[] {
	return groups.filter((group) => group.state === state).map((group) => group.kind);
}

export function createHostSearchController(deps: HostSearchControllerDeps): HostSearchController {
	const schedule = deps.schedule ?? defaultSchedule;
	let current: HostSearchInput | null = null;
	let reachable = false;
	let generation = -1;
	let issued: { token: number; generation: number } | null = null;
	let tokens = 0;
	let inFlight = false;
	let queued: { input: HostSearchInput; kinds: readonly SearchKind[] } | null = null;
	let cancelDebounce: (() => void) | null = null;
	let cancelPoll: (() => void) | null = null;
	let coldPolls = 0;
	let quietRetries = 0;
	let shown: { groups: readonly SearchGroup[]; input: HostSearchInput } | null = null;
	let arrivals = NO_ARRIVALS;
	let observed: { onScreen: ReadonlySet<string>; holding: boolean } = {
		onScreen: new Set(),
		holding: false,
	};

	const cancelTimers = () => {
		cancelDebounce?.();
		cancelDebounce = null;
		cancelPoll?.();
		cancelPoll = null;
	};

	const emit = (groups: readonly SearchGroup[] | null, pending: boolean, stale: boolean) => {
		deps.emit({ groups, pending, stale, arrivals });
	};

	const show = (input: HostSearchInput, groups: readonly SearchGroup[], pending: boolean) => {
		shown = { groups, input };
		const landed = groups.flatMap((group) => group.hits.map((hit) => hit.id));
		arrivals = noteArrivals(arrivals, landed, observed.onScreen, observed.holding);
		emit(groups, pending, false);
	};

	const issue = async (
		request: HostSearchInput,
		kinds: readonly SearchKind[] = request.kinds,
	): Promise<void> => {
		if (inFlight) {
			queued = { input: request, kinds };
			return;
		}
		tokens += 1;
		const token = tokens;
		const asked = generation;
		issued = { token, generation: asked };
		inFlight = true;
		const result = await deps
			.request({
				query: request.text,
				kinds: [...kinds],
				context: request.context,
				...(request.limit === undefined ? {} : { limit: request.limit }),
			})
			.catch(() => null);
		inFlight = false;
		const next = queued;
		queued = null;
		if (next && reachable) {
			void issue(next.input, next.kinds);
			return;
		}
		if (!reachable || !issued || issued.token !== token || generation !== asked) return;
		if (current === null || !sameHostInput(current, request)) return;
		const previous = shown && sameHostInput(shown.input, request) ? shown.groups : null;
		const groups = mergeHostGroups(previous, result ? result.groups : failedGroups(kinds));
		const indexing = kindsIn(groups, "indexing");
		const refreshing = kindsIn(groups, "refreshing");
		const askCold = indexing.length > 0 && coldPolls < HOST_SEARCH.maxIndexingPolls;
		const quietDelay = HOST_SEARCH.quietRetryMs[quietRetries];
		const askQuiet = refreshing.length > 0 && quietDelay !== undefined;
		show(request, groups, askCold);
		if (!askCold && !askQuiet) return;
		const delay = askCold ? pollDelay(coldPolls) : (quietDelay ?? 0);
		if (askCold) coldPolls += 1;
		if (askQuiet) quietRetries += 1;
		const due = [...(askCold ? indexing : []), ...(askQuiet ? refreshing : [])];
		cancelPoll = schedule(() => {
			cancelPoll = null;
			if (issued?.token === token && reachable) void issue(request, due);
		}, delay);
	};

	const ask = (input: HostSearchInput) => {
		cancelDebounce = schedule(() => {
			cancelDebounce = null;
			void issue(input);
		}, HOST_SEARCH.debounceMs);
	};

	const update = (input: HostSearchInput | null): void => {
		const active = input !== null && isActiveHostInput(input);
		if (active && current && sameHostInput(current, input)) return;
		cancelTimers();
		queued = null;
		if (!active) {
			current = null;
			issued = null;
			shown = null;
			arrivals = NO_ARRIVALS;
			deps.emit(IDLE_HOST_SEARCH);
			return;
		}
		current = input;
		coldPolls = 0;
		quietRetries = 0;
		arrivals = NO_ARRIVALS;
		const stale = shown !== null && !sameHostInput(shown.input, input);
		emit(shown?.groups ?? null, reachable, stale);
		if (reachable) ask(input);
	};

	const connect = (nowReachable: boolean, nowGeneration: number): void => {
		const renewed = nowGeneration !== generation;
		reachable = nowReachable;
		generation = nowGeneration;
		if (!reachable) {
			cancelTimers();
			queued = null;
			if (current) {
				emit(shown?.groups ?? null, false, shown !== null && !sameHostInput(shown.input, current));
			}
			return;
		}
		if (!renewed || !current) return;
		issued = null;
		coldPolls = 0;
		quietRetries = 0;
		cancelTimers();
		emit(shown?.groups ?? null, true, shown !== null && !sameHostInput(shown.input, current));
		ask(current);
	};

	return {
		update,
		connect,
		observe: (onScreen, holding) => {
			observed = { onScreen, holding };
		},
		dispose: () => update(null),
	};
}

export function useHostSearch(input: HostSearchInput): {
	readonly state: HostSearchState;
	readonly observe: HostSearchController["observe"];
} {
	const generation = useAppStore((s) => s.welcomeGeneration);
	const reachable = useAppStore(selectHostReachable);
	const [state, setState] = useState<HostSearchState>(IDLE_HOST_SEARCH);
	const [controller] = useState(() =>
		createHostSearchController({
			request: (params) => getTransport().request("search.query", params),
			emit: setState,
		}),
	);
	useEffect(() => () => controller.dispose(), [controller]);
	useEffect(() => {
		controller.update(input);
	}, [controller, input]);
	useEffect(() => {
		controller.connect(reachable, generation);
	}, [controller, reachable, generation]);
	return { state, observe: controller.observe };
}

export interface HostPreviewLoader {
	load(target: SearchPreviewTarget): Promise<SearchPreviewResult>;
}

const PREVIEW_CACHE_LIMIT = 50;

export function createHostPreviewLoader(
	request: (target: SearchPreviewTarget) => Promise<SearchPreviewResult> = (target) =>
		getTransport().request("search.preview", target),
	generation: () => number = () => useAppStore.getState().welcomeGeneration,
): HostPreviewLoader {
	const cache = new Map<string, Promise<SearchPreviewResult>>();
	return {
		load(target) {
			const key = `${generation()}:${JSON.stringify(target)}`;
			const cached = cache.get(key);
			if (cached) return cached;
			const promise = request(target).then(
				(result) => {
					if (result.kind !== "transcript") cache.delete(key);
					return result;
				},
				(): SearchPreviewResult => {
					cache.delete(key);
					return { kind: "unavailable" };
				},
			);
			cache.set(key, promise);
			if (cache.size > PREVIEW_CACHE_LIMIT) {
				const oldest = cache.keys().next().value;
				if (oldest !== undefined) cache.delete(oldest);
			}
			return promise;
		},
	};
}
