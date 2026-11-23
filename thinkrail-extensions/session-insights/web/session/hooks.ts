import type { PanelHost } from "@thinkrail/extension-api/web";
import type { SessionSummaryResult, TraceEvent } from "@thinkrail/pi-session-insights/core";
import { useEffect, useMemo, useRef, useState } from "react";
import type { ChildTraces } from "../trace/TraceExplorer";
import { type Query, useKeyedQuery } from "../useKeyedQuery";
import { type LoadedTrace, loadOverview, loadTrace, PENDING, type Pending } from "./api";

export type Loadable<T> =
	| { kind: "loading" }
	| { kind: "ready"; value: T }
	| { kind: "missing" }
	| { kind: "version" }
	| { kind: "failed" };

/**
 * A query whose `null` answer means the host does not have the session (any more); a `PENDING` one
 * (its index has not reached the session yet) still reads as loading while it is asked again.
 */
export function present<T>(query: Query<T | Pending | null>): Loadable<T> {
	if (query.kind !== "ready") return query;
	if (query.value === PENDING) return { kind: "loading" };
	return query.value === null ? { kind: "missing" } : { kind: "ready", value: query.value };
}

function isPending(value: unknown): boolean {
	return value === PENDING;
}

export function useSummary(
	host: PanelHost,
	sessionId: string,
	attempt: number,
): Loadable<SessionSummaryResult> {
	return present(
		useKeyedQuery(
			`${sessionId}:${attempt}`,
			(signal) => loadOverview(host, sessionId, signal),
			isPending,
		),
	);
}

/** The trace, paged in; every page shows as it arrives. */
export function useTrace(
	host: PanelHost,
	sessionId: string,
	attempt: number,
): Loadable<LoadedTrace> {
	return present(
		useKeyedQuery<LoadedTrace | Pending | null>(
			`${sessionId}:${attempt}`,
			(signal, progress) => loadTrace(host, sessionId, signal, progress),
			isPending,
		),
	);
}

/**
 * A revision-keyed query result, asked for once `revision` is known (`null`: not yet, or the section
 * was never opened) and kept until it changes; `load` answers `null` for a session the host lacks.
 */
export function useRevisioned<T>(
	sessionId: string,
	revision: string | null,
	attempt: number,
	load: (signal: AbortSignal) => Promise<T | null>,
): Loadable<T> {
	return present(
		useKeyedQuery(revision === null ? null : `${sessionId}:${revision}:${attempt}`, load),
	);
}

type ChildState =
	| { kind: "loading" }
	| { kind: "ready"; events: readonly TraceEvent[] }
	| { kind: "failed" };

/**
 * Subagent transcripts loaded on demand when a subagent row is expanded. A failed one loads again on
 * the next expand; loads still running when the panel goes away are aborted.
 */
export function useChildTraces(host: PanelHost, sessionId: string, available: ReadonlySet<string>) {
	const [states, setStates] = useState<ReadonlyMap<string, ChildState>>(new Map());
	const controllers = useRef(new Map<string, AbortController>());
	useEffect(() => {
		const running = controllers.current;
		return () => {
			for (const controller of running.values()) controller.abort();
			running.clear();
		};
	}, []);
	const load = (childId: string) => {
		const state = states.get(childId);
		if (state && state.kind !== "failed") return;
		setStates((current) => new Map(current).set(childId, { kind: "loading" }));
		const controller = new AbortController();
		controllers.current.set(childId, controller);
		const settle = (next: ChildState) => {
			if (controller.signal.aborted) return;
			controllers.current.delete(childId);
			setStates((current) => new Map(current).set(childId, next));
		};
		loadTrace(host, sessionId, controller.signal, () => {}, childId).then(
			(trace) =>
				settle(
					trace && trace !== PENDING ? { kind: "ready", events: trace.events } : { kind: "failed" },
				),
			() => settle({ kind: "failed" }),
		);
	};
	const { ready, loading } = useMemo(() => {
		const done = new Map<string, readonly TraceEvent[]>();
		const busy = new Set<string>();
		for (const [childId, state] of states) {
			if (state.kind === "ready") done.set(childId, state.events);
			else if (state.kind === "loading") busy.add(childId);
		}
		return { ready: done, loading: busy };
	}, [states]);
	const loaded = useMemo(() => new Set(ready.keys()), [ready]);
	const children: ChildTraces = { available, loaded, loading, load };
	return { ready, children };
}
