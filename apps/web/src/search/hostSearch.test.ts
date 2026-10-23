import { describe, expect, test } from "bun:test";
import type { SearchGroup, SearchQueryResult, WsParams } from "@thinkrail/contracts";
import { createHostSearchController, HOST_SEARCH, type HostSearchState } from "./hostSearch";

type Deferred = {
	params: WsParams<"search.query">;
	resolve: (r: SearchQueryResult) => void;
	reject: () => void;
};

function harness() {
	const requests: Deferred[] = [];
	const emitted: HostSearchState[] = [];
	const timers: { run: () => void; ms: number; cancelled: boolean }[] = [];
	let generation = 1;
	const controller = createHostSearchController({
		request: (params) =>
			new Promise<SearchQueryResult>((resolve, reject) => {
				requests.push({ params, resolve, reject: () => reject(new Error("offline")) });
			}),
		generation: () => generation,
		emit: (state) => emitted.push(state),
		schedule: (run, ms) => {
			const timer = { run, ms, cancelled: false };
			timers.push(timer);
			return () => {
				timer.cancelled = true;
			};
		},
	});
	const fire = () => {
		const pending = timers.filter((timer) => !timer.cancelled);
		timers.length = 0;
		for (const timer of pending) timer.run();
	};
	const settle = () => new Promise<void>((resolve) => setTimeout(resolve, 0));
	return {
		controller,
		requests,
		emitted,
		timers,
		fire,
		settle,
		setGeneration: (next: number) => {
			generation = next;
		},
	};
}

const input = (text: string) => ({
	enabled: true,
	text,
	kinds: ["file" as const],
	context: { projectId: "p1" },
});

const group = (
	state: SearchGroup["state"] = "ready",
	ids: string[] = ["file:p1::a.ts"],
): SearchGroup => ({
	kind: "file",
	hits: ids.map((id) => ({
		id,
		kind: "file",
		title: id,
		tier: 1,
		score: 1,
		projectId: "p1",
		path: id,
	})),
	total: ids.length,
	state,
});

describe("host search controller", () => {
	test("debounces, keeps one request in flight and re-issues only the latest queued input", async () => {
		const h = harness();
		h.controller.update(input("re"));
		expect(h.emitted.at(-1)).toEqual({ groups: null, pending: true });
		expect(h.timers.at(-1)?.ms).toBe(HOST_SEARCH.debounceMs);
		h.fire();
		expect(h.requests).toHaveLength(1);
		expect(h.requests[0]?.params).toMatchObject({
			query: "re",
			kinds: ["file"],
			context: { projectId: "p1" },
		});

		h.controller.update(input("ref"));
		h.fire();
		h.controller.update(input("refr"));
		h.fire();
		expect(h.requests).toHaveLength(1);

		h.requests[0]?.resolve({ seq: h.requests[0].params.seq, groups: [group()] });
		await h.settle();
		expect(h.requests).toHaveLength(2);
		expect(h.requests[1]?.params.query).toBe("refr");
		expect(h.requests[1]?.params.seq).toBeGreaterThan(h.requests[0]?.params.seq ?? 0);
		expect(h.emitted.at(-1)).toEqual({ groups: null, pending: true });

		h.requests[1]?.resolve({ seq: h.requests[1].params.seq, groups: [group()] });
		await h.settle();
		expect(h.emitted.at(-1)).toEqual({ groups: [group()], pending: false });
	});

	test("a superseded or stale reply never paints, a failed request paints nothing and stops", async () => {
		const h = harness();
		h.controller.update(input("auth"));
		h.fire();
		h.requests[0]?.resolve({ seq: h.requests[0].params.seq, groups: [], superseded: true });
		await h.settle();
		expect(h.emitted.at(-1)).toEqual({ groups: null, pending: true });

		h.controller.update(input("auth"));
		expect(h.requests).toHaveLength(1);
		h.controller.update(input("other"));
		h.fire();
		h.requests[1]?.reject();
		await h.settle();
		expect(h.emitted.at(-1)).toEqual({ groups: [], pending: false });
		expect(h.timers.filter((timer) => !timer.cancelled)).toHaveLength(0);
	});

	test("a value-equal update never disturbs a pending debounce or poll, and dispose is not permanent", async () => {
		const h = harness();
		h.controller.update(input("re"));
		h.controller.update({ ...input("re") });
		h.fire();
		expect(h.requests.map((request) => request.params.query)).toEqual(["re"]);
		h.requests[0]?.resolve({ seq: h.requests[0].params.seq, groups: [group("indexing", [])] });
		await h.settle();
		expect(h.emitted.at(-1)?.pending).toBe(true);
		h.controller.update({ ...input("re") });
		h.fire();
		expect(h.requests).toHaveLength(2);

		h.controller.dispose();
		expect(h.emitted.at(-1)).toEqual({ groups: null, pending: false });
		h.controller.update(input("again"));
		h.fire();
		h.requests[1]?.resolve({ seq: h.requests[1].params.seq, groups: [group()] });
		await h.settle();
		expect(h.emitted.at(-1)).toEqual({ groups: null, pending: true });
		expect(h.requests).toHaveLength(3);
		h.requests[2]?.resolve({ seq: h.requests[2].params.seq, groups: [group()] });
		await h.settle();
		expect(h.emitted.at(-1)).toEqual({ groups: [group()], pending: false });
	});

	test("an indexing group polls until it is ready, a reconnect re-asks, an inactive input clears", async () => {
		const h = harness();
		h.controller.update(input("spec"));
		h.fire();
		h.requests[0]?.resolve({ seq: h.requests[0].params.seq, groups: [group("indexing", [])] });
		await h.settle();
		expect(h.emitted.at(-1)).toEqual({ groups: [group("indexing", [])], pending: true });
		expect(h.timers.at(-1)?.ms).toBe(HOST_SEARCH.indexingPollMs);
		h.fire();
		expect(h.requests).toHaveLength(2);
		h.requests[1]?.resolve({ seq: h.requests[1].params.seq, groups: [group("ready")] });
		await h.settle();
		expect(h.emitted.at(-1)).toEqual({ groups: [group("ready")], pending: false });

		h.setGeneration(2);
		h.controller.update(input("spec"));
		h.fire();
		expect(h.requests).toHaveLength(3);

		h.controller.update({ ...input("spec"), enabled: false });
		expect(h.emitted.at(-1)).toEqual({ groups: null, pending: false });
		h.requests[2]?.resolve({ seq: h.requests[2].params.seq, groups: [group("ready")] });
		await h.settle();
		expect(h.emitted.at(-1)).toEqual({ groups: null, pending: false });
	});
});
