import { describe, expect, test } from "bun:test";
import type { PanelHost } from "@thinkrail/extension-api/web";
import type { SessionTraceResult, TraceEvent } from "@thinkrail/pi-session-insights/core";
import { loadDay } from "../day/api";
import { SOURCES, sessionRow } from "../fixtures.test";
import { llm, T0, turn } from "../trace/events.test";
import {
	type LoadedTrace,
	loadEvent,
	loadOverview,
	loadTimeline,
	loadTrace,
	PENDING,
	type Pending,
	searchTrace,
	VersionSkew,
} from "./api";
import { present } from "./hooks";

const EVENTS: TraceEvent[] = [
	turn("u1", 1, T0),
	llm("a1", "u1", T0, T0 + 1),
	turn("u2", 2, T0 + 2),
];

function page(
	cursor: number,
	size: number,
	revision: string,
	newerRevision = false,
): SessionTraceResult {
	const events = EVENTS.slice(cursor, cursor + size);
	const next = cursor + size < EVENTS.length ? cursor + size : null;
	return {
		apiVersion: 10,
		found: true,
		pending: false,
		meta: {
			revision,
			total: EVENTS.length,
			start: T0,
			end: T0 + 2,
			errors: 0,
			gaps: [],
			offBranch: 0,
		},
		cursor,
		next,
		events,
		newerRevision,
	};
}

function cursorOf(params: unknown): number {
	return typeof params === "object" && params !== null && "cursor" in params
		? Number(params.cursor)
		: 0;
}

function host(answer: (method: string, params: unknown) => unknown): {
	host: PanelHost;
	calls: { method: string; params: unknown }[];
} {
	const calls: { method: string; params: unknown }[] = [];
	return {
		calls,
		host: {
			query: async (method, params) => {
				calls.push({ method, params });
				return answer(method, params);
			},
			openChat: () => {},
			openPanel: () => {},
			renderToolCall: () => null,
			openFile: () => {},
			scope: { workspaceId: "w1", projectId: "p1" },
			hostProtocol: 130,
			hostApiVersion: 10,
		},
	};
}

function done(loaded: LoadedTrace | Pending | null): LoadedTrace {
	if (loaded === null || loaded === PENDING) throw new Error("the trace did not load");
	return loaded;
}

describe("loadTrace", () => {
	test("pages until the last cursor and hands every growing prefix on", async () => {
		const fake = host((_, params) => page(cursorOf(params), 2, "r1"));
		const seen: number[] = [];
		const loaded = done(
			await loadTrace(fake.host, "s1", new AbortController().signal, (trace) =>
				seen.push(trace.events.length),
			),
		);
		expect(loaded?.events.map((event) => event.id)).toEqual(["u1", "a1", "u2"]);
		expect(loaded?.complete).toBe(true);
		expect(loaded?.newer).toBe(false);
		expect(seen).toEqual([2, 3]);
		expect(fake.calls.map((call) => call.params)).toEqual([
			{ sessionId: "s1", cursor: 0, limit: 2000 },
			{ sessionId: "s1", cursor: 2, limit: 2000, revision: "r1" },
		]);
	});

	test("a live session pages its pinned revision to the end and says a newer one exists", async () => {
		const fake = host((_, params) => page(cursorOf(params), 2, "r1", cursorOf(params) > 0));
		const loaded = done(await loadTrace(fake.host, "s1", new AbortController().signal, () => {}));
		expect(loaded?.events.map((event) => event.id)).toEqual(["u1", "a1", "u2"]);
		expect(loaded?.complete).toBe(true);
		expect(loaded?.newer).toBe(true);
		expect(fake.calls).toHaveLength(2);
	});

	test("restarts from the first page when the host no longer keeps the pinned revision", async () => {
		let served = 0;
		const fake = host((_, params) => {
			served += 1;
			return page(cursorOf(params), 2, served >= 2 ? "r2" : "r1");
		});
		const loaded = done(await loadTrace(fake.host, "s1", new AbortController().signal, () => {}));
		expect(loaded?.meta.revision).toBe("r2");
		expect(fake.calls.map((call) => cursorOf(call.params))).toEqual([0, 2, 0, 2]);
	});

	test("a session the host no longer has resolves to null; another payload version rejects", async () => {
		const missing = host(() => ({ ...page(0, 2, "r1"), found: false, meta: null }));
		expect(await loadTrace(missing.host, "s1", new AbortController().signal, () => {})).toBeNull();
		const indexing = host(() => ({ ...page(0, 2, "r1"), found: false, pending: true, meta: null }));
		expect(await loadTrace(indexing.host, "s1", new AbortController().signal, () => {})).toBe(
			PENDING,
		);
		const skewed = host(() => ({ ...page(0, 2, "r1"), apiVersion: 1 }));
		await expect(
			loadTrace(skewed.host, "s1", new AbortController().signal, () => {}),
		).rejects.toBeInstanceOf(VersionSkew);
		await expect(
			loadEvent(skewed.host, "s1", "e1", new AbortController().signal),
		).rejects.toBeInstanceOf(VersionSkew);
		const search = host(() => ({
			apiVersion: 10,
			found: true,
			revision: "r1",
			ids: ["a1"],
			truncated: false,
		}));
		expect((await searchTrace(search.host, "s1", "abc", new AbortController().signal)).ids).toEqual(
			["a1"],
		);
	});

	test("the timeline and the day ask their queries and refuse another payload version", async () => {
		const timeline = host(() => ({
			apiVersion: 10,
			found: false,
			timeline: null,
			sources: SOURCES,
		}));
		expect(await loadTimeline(timeline.host, "s1", new AbortController().signal)).toMatchObject({
			found: false,
		});
		expect(timeline.calls).toEqual([{ method: "session.timeline", params: { sessionId: "s1" } }]);
		const day = host(() => ({
			apiVersion: 10,
			days: [],
			sessions: [],
			hours: [],
			sources: SOURCES,
		}));
		await loadDay(day.host, { kind: "all" }, null, new AbortController().signal);
		await loadDay(day.host, { kind: "all" }, "2026-11-03", new AbortController().signal);
		expect(day.calls.map((call) => call.params)).toEqual([
			{ scope: { kind: "all" } },
			{ scope: { kind: "all" }, day: "2026-11-03" },
		]);
		const skewed = host(() => ({ apiVersion: 2, found: true, timeline: null, sources: SOURCES }));
		await expect(
			loadTimeline(skewed.host, "s1", new AbortController().signal),
		).rejects.toBeInstanceOf(VersionSkew);
		await expect(
			loadDay(skewed.host, { kind: "all" }, null, new AbortController().signal),
		).rejects.toBeInstanceOf(VersionSkew);
	});
});

describe("a session the host's index has not reached yet", () => {
	const READY = { phase: "ready" as const, indexed: 1, total: 1 };
	const COLD = { phase: "cold" as const, indexed: 0, total: 3 };
	const summary = (pending: boolean, state = pending ? COLD : READY) => ({
		apiVersion: 10,
		state,
		session: null,
		pending,
		sources: SOURCES,
	});

	test("reads as pending, not as gone, until the index is ready", async () => {
		const signal = new AbortController().signal;
		expect(await loadOverview(host(() => summary(true)).host, "s1", signal)).toBe(PENDING);
		expect(await loadOverview(host(() => summary(false)).host, "s1", signal)).toBeNull();
		const session = {
			...sessionRow("s1"),
			projectName: null,
			wallMs: { value: 0, origin: "counted" as const },
		};
		const shown = { ...summary(false), session };
		expect(await loadOverview(host(() => shown).host, "s1", signal)).toBe(shown);
	});

	test("a pending answer keeps the section loading; only a final one says the session is gone", () => {
		expect(present({ kind: "ready", value: PENDING })).toEqual({ kind: "loading" });
		expect(present({ kind: "ready", value: null })).toEqual({ kind: "missing" });
		expect(present({ kind: "ready", value: 1 })).toEqual({ kind: "ready", value: 1 });
		expect(present({ kind: "failed" })).toEqual({ kind: "failed" });
	});
});
