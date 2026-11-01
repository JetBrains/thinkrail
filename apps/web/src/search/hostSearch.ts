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
import { useAppStore } from "../store";
import { getTransport } from "../transport";

export const HOST_SEARCH = {
	debounceMs: 100,
	indexingPollMs: 300,
	slowIndexingPollMs: 1_000,
	fastIndexingPolls: 10,
	maxIndexingPolls: 37,
} as const;

let nextSeq = Date.now();

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
}

export const IDLE_HOST_SEARCH: HostSearchState = { groups: null, pending: false, stale: false };

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

export type HostSearchStatus = "failed" | "indexing" | "truncated";

export function hostSearchStatus(state: HostSearchState): HostSearchStatus | null {
	if (!state.groups || state.stale) return null;
	const states = new Set(state.groups.map((group) => group.state));
	if (states.has("failed")) return "failed";
	if (!state.pending && states.has("indexing")) return "indexing";
	if (states.has("truncated")) return "truncated";
	return null;
}

export interface HostSearchControllerDeps {
	readonly request: (params: WsParams<"search.query">) => Promise<SearchQueryResult>;
	readonly generation: () => number;
	readonly emit: (state: HostSearchState) => void;
	readonly schedule?: (run: () => void, ms: number) => () => void;
	readonly nextSeq?: () => number;
}

export interface HostSearchController {
	update(input: HostSearchInput | null): void;
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

export function createHostSearchController(deps: HostSearchControllerDeps): HostSearchController {
	const schedule = deps.schedule ?? defaultSchedule;
	const seqOf = deps.nextSeq ?? (() => nextSeq++);
	let current: { input: HostSearchInput; generation: number } | null = null;
	let issued: { seq: number; generation: number } | null = null;
	let inFlight = false;
	let queued: { input: HostSearchInput; kinds: readonly SearchKind[] } | null = null;
	let cancelDebounce: (() => void) | null = null;
	let cancelPoll: (() => void) | null = null;
	let polls = 0;
	let shown: { groups: readonly SearchGroup[]; input: HostSearchInput } | null = null;

	const show = (input: HostSearchInput, groups: readonly SearchGroup[], pending: boolean) => {
		shown = { groups, input };
		deps.emit({ groups, pending, stale: false });
	};

	const issue = async (
		request: HostSearchInput,
		kinds: readonly SearchKind[] = request.kinds,
	): Promise<void> => {
		if (inFlight) {
			queued = { input: request, kinds };
			return;
		}
		const seq = seqOf();
		const generation = deps.generation();
		issued = { seq, generation };
		inFlight = true;
		const result = await deps
			.request({
				seq,
				query: request.text,
				kinds: [...kinds],
				context: request.context,
				...(request.limit === undefined ? {} : { limit: request.limit }),
			})
			.catch(() => null);
		inFlight = false;
		const next = queued;
		queued = null;
		if (next) {
			void issue(next.input, next.kinds);
			return;
		}
		if (!issued || issued.seq !== seq || deps.generation() !== generation) return;
		if (current === null || !sameHostInput(current.input, request)) return;
		if (result?.superseded) {
			show(request, [], false);
			return;
		}
		const previous = shown && sameHostInput(shown.input, request) ? shown.groups : null;
		const groups = mergeHostGroups(previous, result ? result.groups : failedGroups(kinds));
		const indexing = groups
			.filter((group) => group.state === "indexing")
			.map((group) => group.kind);
		const keepPolling = indexing.length > 0 && polls < HOST_SEARCH.maxIndexingPolls;
		show(request, groups, keepPolling);
		if (keepPolling) {
			const delay = pollDelay(polls);
			polls += 1;
			cancelPoll = schedule(() => {
				cancelPoll = null;
				if (issued?.seq === seq) void issue(request, indexing);
			}, delay);
		}
	};

	const update = (input: HostSearchInput | null): void => {
		const generation = deps.generation();
		const active = input !== null && isActiveHostInput(input);
		if (
			active &&
			current &&
			current.generation === generation &&
			sameHostInput(current.input, input)
		) {
			return;
		}
		cancelDebounce?.();
		cancelDebounce = null;
		cancelPoll?.();
		cancelPoll = null;
		if (!active) {
			current = null;
			issued = null;
			queued = null;
			shown = null;
			deps.emit(IDLE_HOST_SEARCH);
			return;
		}
		current = { input, generation };
		polls = 0;
		deps.emit({
			groups: shown?.groups ?? null,
			pending: true,
			stale: shown !== null && !sameHostInput(shown.input, input),
		});
		cancelDebounce = schedule(() => {
			cancelDebounce = null;
			void issue(input);
		}, HOST_SEARCH.debounceMs);
	};

	return { update, dispose: () => update(null) };
}

export function useHostSearch(input: HostSearchInput): HostSearchState {
	const generation = useAppStore((s) => s.welcomeGeneration);
	const [state, setState] = useState<HostSearchState>(IDLE_HOST_SEARCH);
	const [controller] = useState(() =>
		createHostSearchController({
			request: (params) => getTransport().request("search.query", params),
			generation: () => useAppStore.getState().welcomeGeneration,
			emit: setState,
		}),
	);
	useEffect(() => () => controller.dispose(), [controller]);
	useEffect(() => {
		controller.update(input);
	}, [controller, input, generation]);
	return state;
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
			const promise = request(target).catch((): SearchPreviewResult => {
				cache.delete(key);
				return { kind: "unavailable", reason: "missing" };
			});
			cache.set(key, promise);
			if (cache.size > PREVIEW_CACHE_LIMIT) {
				const oldest = cache.keys().next().value;
				if (oldest !== undefined) cache.delete(oldest);
			}
			return promise;
		},
	};
}
