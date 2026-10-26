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
	maxIndexingPolls: 20,
} as const;

/** Seeded with the clock so a reloaded page never issues a `seq` the host has already seen from this client. */
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
}

export const IDLE_HOST_SEARCH: HostSearchState = { groups: null, pending: false };

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

export interface HostSearchControllerDeps {
	readonly request: (params: WsParams<"search.query">) => Promise<SearchQueryResult>;
	readonly generation: () => number;
	readonly emit: (state: HostSearchState) => void;
	readonly schedule?: (run: () => void, ms: number) => () => void;
	readonly nextSeq?: () => number;
}

export interface HostSearchController {
	/** The palette's current query; `null` or an inactive input clears the host results. */
	update(input: HostSearchInput | null): void;
	dispose(): void;
}

const defaultSchedule = (run: () => void, ms: number) => {
	const timer = setTimeout(run, ms);
	return () => clearTimeout(timer);
};

export function createHostSearchController(deps: HostSearchControllerDeps): HostSearchController {
	const schedule = deps.schedule ?? defaultSchedule;
	const seqOf = deps.nextSeq ?? (() => nextSeq++);
	let current: { input: HostSearchInput; generation: number } | null = null;
	let issued: { seq: number; generation: number } | null = null;
	let inFlight = false;
	let queued: HostSearchInput | null = null;
	let cancelDebounce: (() => void) | null = null;
	let cancelPoll: (() => void) | null = null;
	let polls = 0;
	let shown: readonly SearchGroup[] | null = null;

	const emit = (state: HostSearchState) => {
		shown = state.groups;
		deps.emit(state);
	};

	const issue = async (request: HostSearchInput): Promise<void> => {
		if (inFlight) {
			queued = request;
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
				kinds: [...request.kinds],
				context: request.context,
				...(request.limit === undefined ? {} : { limit: request.limit }),
			})
			.catch(() => null);
		inFlight = false;
		const next = queued;
		queued = null;
		if (next) {
			void issue(next);
			return;
		}
		if (!issued || issued.seq !== seq || deps.generation() !== generation) return;
		if (current === null || !sameHostInput(current.input, request)) return;
		if (result === null || result.superseded) {
			emit({ groups: [], pending: false });
			return;
		}
		const indexing = result.groups.some((group) => group.state === "indexing");
		const keepPolling = indexing && polls < HOST_SEARCH.maxIndexingPolls;
		emit({ groups: result.groups, pending: keepPolling });
		if (keepPolling) {
			polls += 1;
			cancelPoll = schedule(() => {
				cancelPoll = null;
				if (issued?.seq === seq) void issue(request);
			}, HOST_SEARCH.indexingPollMs);
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
			emit(IDLE_HOST_SEARCH);
			return;
		}
		current = { input, generation };
		polls = 0;
		emit({ groups: shown, pending: true });
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

/** One per open palette: a preview is re-read the next time the palette opens, and a failed read is never kept. */
export function createHostPreviewLoader(
	request: (target: SearchPreviewTarget) => Promise<SearchPreviewResult> = (target) =>
		getTransport().request("search.preview", target),
): HostPreviewLoader {
	const cache = new Map<string, Promise<SearchPreviewResult>>();
	return {
		load(target) {
			const key = JSON.stringify(target);
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
