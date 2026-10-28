import { describe, expect, test } from "bun:test";
import type { SearchGroup, SearchQueryResult, WsParams } from "@thinkrail/contracts";
import {
	createHostPreviewLoader,
	createHostSearchController,
	HOST_SEARCH,
	type HostSearchState,
	hostSearchStatus,
	mergeHostGroups,
} from "./hostSearch";

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

const input = (text: string, kinds: SearchGroup["kind"][] = ["file"]) => ({
	enabled: true,
	text,
	kinds,
	context: { projectId: "p1" },
});

const group = (
	state: SearchGroup["state"] = "ready",
	ids: string[] = ["file:p1::a.ts"],
	kind: SearchGroup["kind"] = "file",
): SearchGroup => ({
	kind,
	hits: ids.map((id) => ({
		id,
		kind,
		title: id,
		tier: 1,
		score: 1,
		projectId: "p1",
		path: id,
	})),
	total: ids.length,
	state,
});

const shownState = (groups: SearchGroup[] | null, pending: boolean, stale = false) => ({
	groups,
	pending,
	stale,
});

describe("host search controller", () => {
	test("debounces, keeps one request in flight and re-issues only the latest queued input", async () => {
		const h = harness();
		h.controller.update(input("re"));
		expect(h.emitted.at(-1)).toEqual(shownState(null, true));
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
		expect(h.emitted.at(-1)).toEqual(shownState(null, true));

		h.requests[1]?.resolve({ seq: h.requests[1].params.seq, groups: [group()] });
		await h.settle();
		expect(h.emitted.at(-1)).toEqual(shownState([group()], false));

		h.controller.update(input("refre"));
		expect(h.emitted.at(-1)).toEqual(shownState([group()], true, true));
		h.fire();
		h.requests[2]?.resolve({
			seq: h.requests[2].params.seq,
			groups: [group("ready", ["file:p1::b.ts"])],
		});
		await h.settle();
		expect(h.emitted.at(-1)).toEqual(shownState([group("ready", ["file:p1::b.ts"])], false));
	});

	test("a superseded latest reply ends empty instead of pending forever, a stale reply never paints, a failed request says so and stops", async () => {
		const h = harness();
		h.controller.update(input("auth"));
		h.fire();
		h.requests[0]?.resolve({ seq: h.requests[0].params.seq, groups: [], superseded: true });
		await h.settle();
		expect(h.emitted.at(-1)).toEqual(shownState([], false));

		h.controller.update(input("auth"));
		expect(h.requests).toHaveLength(1);
		h.controller.update(input("other"));
		h.fire();
		h.requests[1]?.reject();
		await h.settle();
		const failed = h.emitted.at(-1) as HostSearchState;
		expect(failed).toEqual(
			shownState([{ kind: "file", hits: [], total: 0, state: "failed" }], false),
		);
		expect(hostSearchStatus(failed)).toBe("failed");
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
		expect(h.emitted.at(-1)).toEqual(shownState(null, false));
		h.controller.update(input("again"));
		h.fire();
		h.requests[1]?.resolve({ seq: h.requests[1].params.seq, groups: [group()] });
		await h.settle();
		expect(h.emitted.at(-1)).toEqual(shownState(null, true));
		expect(h.requests).toHaveLength(3);
		h.requests[2]?.resolve({ seq: h.requests[2].params.seq, groups: [group()] });
		await h.settle();
		expect(h.emitted.at(-1)).toEqual(shownState([group()], false));
	});

	test("an indexing group polls until it is ready, a reconnect re-asks, an inactive input clears", async () => {
		const h = harness();
		h.controller.update(input("spec"));
		h.fire();
		h.requests[0]?.resolve({ seq: h.requests[0].params.seq, groups: [group("indexing", [])] });
		await h.settle();
		expect(h.emitted.at(-1)).toEqual(shownState([group("indexing", [])], true));
		expect(h.timers.at(-1)?.ms).toBe(HOST_SEARCH.indexingPollMs);
		h.fire();
		expect(h.requests).toHaveLength(2);
		h.requests[1]?.resolve({ seq: h.requests[1].params.seq, groups: [group("ready")] });
		await h.settle();
		expect(h.emitted.at(-1)).toEqual(shownState([group("ready")], false));

		h.setGeneration(2);
		h.controller.update(input("spec"));
		h.fire();
		expect(h.requests).toHaveLength(3);

		h.controller.update({ ...input("spec"), enabled: false });
		expect(h.emitted.at(-1)).toEqual(shownState(null, false));
		h.requests[2]?.resolve({ seq: h.requests[2].params.seq, groups: [group("ready")] });
		await h.settle();
		expect(h.emitted.at(-1)).toEqual(shownState(null, false));
	});

	test("a poll asks only the kinds still indexing and keeps every row the previous page showed", async () => {
		const h = harness();
		h.controller.update(input("auth", ["file", "spec"]));
		h.fire();
		h.requests[0]?.resolve({
			seq: h.requests[0].params.seq,
			groups: [group("indexing", ["a", "b"]), group("ready", ["s"], "spec")],
		});
		await h.settle();
		h.fire();
		expect(h.requests[1]?.params.kinds).toEqual(["file"]);
		h.requests[1]?.resolve({
			seq: h.requests[1].params.seq,
			groups: [{ ...group("ready", ["c", "a"]), total: 40 }],
		});
		await h.settle();
		const last = h.emitted.at(-1);
		expect(last?.pending).toBe(false);
		expect(last?.groups?.map((shown) => [shown.kind, shown.hits.map((hit) => hit.id)])).toEqual([
			["file", ["c", "a", "b"]],
			["spec", ["s"]],
		]);
		expect(last?.groups?.[0]?.total).toBe(40);
	});

	test("polling slows down after the first polls and stops after its window, saying the search is still indexing", async () => {
		const h = harness();
		h.controller.update(input("big"));
		h.fire();
		const delays: number[] = [];
		for (let poll = 0; poll <= HOST_SEARCH.maxIndexingPolls; poll += 1) {
			const request = h.requests.at(-1);
			request?.resolve({ seq: request.params.seq, groups: [group("indexing", [])] });
			await h.settle();
			const timer = h.timers.at(-1);
			if (timer && !timer.cancelled) delays.push(timer.ms);
			h.fire();
		}
		expect(delays).toHaveLength(HOST_SEARCH.maxIndexingPolls);
		expect(delays[0]).toBe(HOST_SEARCH.indexingPollMs);
		expect(delays.at(-1)).toBe(HOST_SEARCH.slowIndexingPollMs);
		const last = h.emitted.at(-1) as HostSearchState;
		expect(last.pending).toBe(false);
		expect(hostSearchStatus(last)).toBe("indexing");
	});
});

describe("host search results", () => {
	test("a reply for the shown input keeps the rows its page left out and the groups it did not answer", () => {
		expect(
			mergeHostGroups(
				[group("ready", ["a", "b"]), group("ready", ["s"], "spec")],
				[group("ready", ["c", "a"])],
			).map((merged) => [merged.kind, merged.hits.map((hit) => hit.id), merged.total]),
		).toEqual([
			["file", ["c", "a", "b"], 3],
			["spec", ["s"], 1],
		]);
		expect(mergeHostGroups(null, [group()])).toEqual([group()]);
	});

	test("the palette is told about a failed, still-indexing or cut-short search, never about rows from an earlier input", () => {
		const state = (groups: SearchGroup[], pending = false, stale = false) =>
			hostSearchStatus({ groups, pending, stale });
		expect(state([group("ready")])).toBeNull();
		expect(state([group("truncated"), group("failed", [], "spec")])).toBe("failed");
		expect(state([group("indexing")])).toBe("indexing");
		expect(state([group("indexing")], true)).toBeNull();
		expect(state([group("truncated")])).toBe("truncated");
		expect(state([group("failed")], false, true)).toBeNull();
	});
});

describe("host previews", () => {
	test("a preview is read once per connection, and a failed read is asked again", async () => {
		let generation = 1;
		let fail = true;
		const asked: string[] = [];
		const loader = createHostPreviewLoader(
			async (target) => {
				asked.push(`${generation}:${target.sessionId}`);
				if (fail) throw new Error("offline");
				return { kind: "transcript", title: "t", messages: [], truncated: false };
			},
			() => generation,
		);
		const target = { kind: "chat" as const, sessionId: "s1", messageIndex: 2, anchorText: "the" };
		expect(await loader.load(target)).toEqual({ kind: "unavailable", reason: "missing" });
		fail = false;
		await loader.load(target);
		await loader.load(target);
		generation = 2;
		await loader.load(target);
		expect(asked).toEqual(["1:s1", "1:s1", "2:s1"]);
	});
});
