import { describe, expect, test } from "bun:test";
import {
	MATCH_TIER,
	type SearchGroup,
	type SearchHit,
	type SearchQueryResult,
	type WsParams,
} from "@thinkrail/contracts";
import {
	createHostPreviewLoader,
	createHostSearchController,
	HOST_SEARCH,
	type HostSearchState,
	hostSearchReasons,
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
	const controller = createHostSearchController({
		request: (params) =>
			new Promise<SearchQueryResult>((resolve, reject) => {
				requests.push({ params, resolve, reject: () => reject(new Error("offline")) });
			}),
		emit: (state) => emitted.push(state),
		schedule: (run, ms) => {
			const timer = { run, ms, cancelled: false };
			timers.push(timer);
			return () => {
				timer.cancelled = true;
			};
		},
	});
	controller.connect(true, 1);
	const fire = () => {
		const pending = timers.filter((timer) => !timer.cancelled);
		timers.length = 0;
		for (const timer of pending) timer.run();
	};
	const settle = () => new Promise<void>((resolve) => setTimeout(resolve, 0));
	const last = () => emitted.at(-1) as HostSearchState;
	const shown = () => last().groups?.map((group) => [group.kind, group.hits.map((hit) => hit.id)]);
	return { controller, requests, emitted, timers, fire, settle, last, shown };
}

const input = (text: string, kinds: SearchGroup["kind"][] = ["file"]) => ({
	enabled: true,
	text,
	kinds,
	context: { projectId: "p1" },
});

const hitOf = (kind: SearchGroup["kind"], id: string): SearchHit => {
	const base = {
		id,
		title: id,
		tier: MATCH_TIER.prefix,
		score: 1,
		projectId: "p1",
		workspaceId: "w1",
	};
	switch (kind) {
		case "file":
			return { ...base, kind, path: id };
		case "spec":
			return { ...base, kind, path: id, specId: id, size: 1 };
		case "plan":
			return { ...base, kind, sessionId: id };
		case "transcript":
			return { ...base, kind, sessionId: id, messageIndex: 0, anchorText: id };
	}
};

const group = (
	state: SearchGroup["state"] = "ready",
	ids: string[] = ["file:p1::a.ts"],
	kind: SearchGroup["kind"] = "file",
): SearchGroup => ({ kind, hits: ids.map((id) => hitOf(kind, id)), total: ids.length, state });

describe("host search controller", () => {
	test("debounces, keeps one request in flight, and drops a queued input the user typed past", async () => {
		const h = harness();
		h.controller.update(input("a"));
		expect(h.last()).toMatchObject({ groups: null, pending: true, stale: false });
		expect(h.timers.at(-1)?.ms).toBe(HOST_SEARCH.debounceMs);
		h.fire();
		h.controller.update(input("ab"));
		h.fire();
		h.controller.update(input("abc"));
		h.requests[0]?.resolve({ groups: [group()] });
		await h.settle();
		expect(h.requests.map((request) => request.params.query)).toEqual(["a"]);
		h.fire();
		expect(h.requests.map((request) => request.params.query)).toEqual(["a", "abc"]);
		h.requests[1]?.resolve({ groups: [group()] });
		await h.settle();
		expect(h.last()).toMatchObject({ pending: false, stale: false });
		expect(h.shown()).toEqual([["file", ["file:p1::a.ts"]]]);

		h.controller.update(input("abcd"));
		expect(h.last()).toMatchObject({ pending: true, stale: true });
		h.fire();
		h.requests[2]?.resolve({ groups: [group("ready", ["file:p1::b.ts"])] });
		await h.settle();
		expect(h.shown()).toEqual([["file", ["file:p1::b.ts"]]]);
	});

	test("a reply to an input the user typed past never paints, and a failed request says so and stops", async () => {
		const h = harness();
		h.controller.update(input("auth"));
		h.fire();
		h.controller.update(input("other"));
		h.fire();
		h.requests[0]?.resolve({ groups: [group()] });
		await h.settle();
		expect(h.last()).toMatchObject({ groups: null, pending: true });
		expect(h.requests.map((request) => request.params.query)).toEqual(["auth", "other"]);
		h.requests[1]?.reject();
		await h.settle();
		expect(h.last().groups).toEqual([{ kind: "file", hits: [], total: 0, state: "failed" }]);
		expect(hostSearchReasons(h.last())).toEqual([{ kind: "failed" }]);
		expect(h.timers.filter((timer) => !timer.cancelled)).toHaveLength(0);
	});

	test("a value-equal update never disturbs a pending debounce or poll, and dispose is not permanent", async () => {
		const h = harness();
		h.controller.update(input("re"));
		h.controller.update({ ...input("re") });
		h.fire();
		expect(h.requests.map((request) => request.params.query)).toEqual(["re"]);
		h.requests[0]?.resolve({ groups: [group("indexing", [])] });
		await h.settle();
		expect(h.last().pending).toBe(true);
		h.controller.update({ ...input("re") });
		h.fire();
		expect(h.requests).toHaveLength(2);

		h.controller.dispose();
		expect(h.last()).toMatchObject({ groups: null, pending: false });
		h.controller.update(input("again"));
		h.fire();
		h.requests[1]?.resolve({ groups: [group()] });
		await h.settle();
		expect(h.last()).toMatchObject({ groups: null, pending: true });
		h.requests[2]?.resolve({ groups: [group()] });
		await h.settle();
		expect(h.shown()).toEqual([["file", ["file:p1::a.ts"]]]);
	});

	test("an indexing group polls until it is ready, a new welcome re-asks, an inactive input clears", async () => {
		const h = harness();
		h.controller.update(input("spec"));
		h.fire();
		h.requests[0]?.resolve({ groups: [group("indexing", [])] });
		await h.settle();
		expect(h.last()).toMatchObject({ pending: true });
		expect(h.timers.at(-1)?.ms).toBe(HOST_SEARCH.indexingPollMs);
		h.fire();
		h.requests[1]?.resolve({ groups: [group("ready")] });
		await h.settle();
		expect(h.last()).toMatchObject({ pending: false });

		h.controller.connect(true, 2);
		h.fire();
		expect(h.requests).toHaveLength(3);

		h.controller.update({ ...input("spec"), enabled: false });
		expect(h.last()).toMatchObject({ groups: null, pending: false });
		h.requests[2]?.resolve({ groups: [group("ready")] });
		await h.settle();
		expect(h.last()).toMatchObject({ groups: null, pending: false });
	});

	test("a poll asks only the kinds still indexing and keeps every row the previous page showed", async () => {
		const h = harness();
		h.controller.update(input("auth", ["file", "spec"]));
		h.fire();
		h.requests[0]?.resolve({
			groups: [group("indexing", ["a", "b"]), group("ready", ["s"], "spec")],
		});
		await h.settle();
		h.fire();
		expect(h.requests[1]?.params.kinds).toEqual(["file"]);
		h.requests[1]?.resolve({ groups: [{ ...group("ready", ["c", "a"]), total: 40 }] });
		await h.settle();
		expect(h.last().pending).toBe(false);
		expect(h.shown()).toEqual([
			["file", ["c", "a", "b"]],
			["spec", ["s"]],
		]);
		expect(h.last().groups?.[0]?.total).toBe(40);
	});

	test("cold polling slows down after the first polls and stops after its window, saying the search is still indexing", async () => {
		const h = harness();
		h.controller.update(input("big"));
		h.fire();
		const delays: number[] = [];
		for (let poll = 0; poll <= HOST_SEARCH.maxIndexingPolls; poll += 1) {
			h.requests.at(-1)?.resolve({ groups: [group("indexing", [])] });
			await h.settle();
			const timer = h.timers.at(-1);
			if (timer && !timer.cancelled) delays.push(timer.ms);
			h.fire();
		}
		expect(delays).toHaveLength(HOST_SEARCH.maxIndexingPolls);
		expect(delays[0]).toBe(HOST_SEARCH.indexingPollMs);
		expect(delays.at(-1)).toBe(HOST_SEARCH.slowIndexingPollMs);
		expect(h.last().pending).toBe(false);
		expect(hostSearchReasons(h.last())).toEqual([{ kind: "indexing" }]);
	});

	test("a refreshing group is re-asked quietly a few times, then the page stands", async () => {
		const h = harness();
		h.controller.update(input("big"));
		h.fire();
		const delays: number[] = [];
		for (let reply = 0; reply <= HOST_SEARCH.quietRetryMs.length; reply += 1) {
			h.requests.at(-1)?.resolve({ groups: [group("refreshing")] });
			await h.settle();
			expect(h.last().pending).toBe(false);
			const timer = h.timers.at(-1);
			if (timer && !timer.cancelled) delays.push(timer.ms);
			h.fire();
		}
		expect(delays).toEqual([...HOST_SEARCH.quietRetryMs]);
		expect(h.requests).toHaveLength(HOST_SEARCH.quietRetryMs.length + 1);
		expect(hostSearchReasons(h.last())).toEqual([]);
	});

	test("a cold group and a refreshing one poll together, each within its own allowance", async () => {
		const h = harness();
		h.controller.update(input("mix", ["file", "spec"]));
		h.fire();
		h.requests[0]?.resolve({ groups: [group("refreshing"), group("indexing", [], "spec")] });
		await h.settle();
		expect(h.last().pending).toBe(true);
		expect(h.timers.at(-1)?.ms).toBe(HOST_SEARCH.indexingPollMs);
		h.fire();
		expect(h.requests[1]?.params.kinds).toEqual(["spec", "file"]);
		for (let reply = 1; reply < 5; reply += 1) {
			h.requests.at(-1)?.resolve({ groups: [group("refreshing"), group("indexing", [], "spec")] });
			await h.settle();
			h.fire();
		}
		expect(h.requests.at(-1)?.params.kinds).toEqual(["spec"]);
	});

	test("a quiet re-ask answered indexing moves to the cold schedule", async () => {
		const h = harness();
		h.controller.update(input("move"));
		h.fire();
		h.requests[0]?.resolve({ groups: [group("refreshing")] });
		await h.settle();
		expect(h.last().pending).toBe(false);
		expect(h.timers.at(-1)?.ms).toBe(HOST_SEARCH.quietRetryMs[0]);
		h.fire();
		h.requests[1]?.resolve({ groups: [group("indexing", [])] });
		await h.settle();
		expect(h.last().pending).toBe(true);
		expect(h.timers.at(-1)?.ms).toBe(HOST_SEARCH.indexingPollMs);
	});

	test("a request replayed across a reconnect never paints, and the welcome's re-ask waits for it", async () => {
		const h = harness();
		h.controller.update(input("auth"));
		h.fire();
		h.controller.connect(false, 1);
		h.controller.connect(true, 2);
		h.fire();
		expect(h.requests).toHaveLength(1);
		h.requests[0]?.resolve({ groups: [group("ready", ["old"])] });
		await h.settle();
		expect(h.last().groups).toBeNull();
		expect(h.requests).toHaveLength(2);
		h.requests[1]?.resolve({ groups: [group("ready", ["new"])] });
		await h.settle();
		expect(h.shown()).toEqual([["file", ["new"]]]);
	});

	test("offline, the rows stay, nothing is asked and nothing late paints; a new welcome re-asks once and merges", async () => {
		const h = harness();
		h.controller.update(input("auth"));
		h.fire();
		h.requests[0]?.resolve({ groups: [group("ready", ["a"])] });
		await h.settle();
		h.controller.update(input("auth2"));
		h.fire();
		h.controller.connect(false, 1);
		expect(h.last()).toMatchObject({ pending: false, stale: true });
		expect(h.shown()).toEqual([["file", ["a"]]]);
		h.requests[1]?.resolve({ groups: [group("ready", ["late"])] });
		await h.settle();
		expect(h.shown()).toEqual([["file", ["a"]]]);
		h.controller.update(input("auth3"));
		h.fire();
		expect(h.requests).toHaveLength(2);

		h.controller.connect(true, 2);
		expect(h.last()).toMatchObject({ pending: true });
		h.fire();
		expect(h.requests.map((request) => request.params.query)).toEqual(["auth", "auth2", "auth3"]);
		h.requests[2]?.resolve({ groups: [group("ready", ["b"])] });
		await h.settle();
		expect(h.last()).toMatchObject({ pending: false, stale: false });
		expect(h.shown()).toEqual([["file", ["b"]]]);
	});

	test("rows landing while a selection is held are marked late in the same state that shows them", async () => {
		const h = harness();
		h.controller.update(input("auth"));
		h.fire();
		h.requests[0]?.resolve({ groups: [group("indexing", ["a"])] });
		await h.settle();
		expect(h.last().arrivals.late.size).toBe(0);
		h.controller.observe(new Set(["a"]), true);
		h.fire();
		h.requests[1]?.resolve({ groups: [group("ready", ["a", "b"])] });
		await h.settle();
		expect([...h.last().arrivals.late]).toEqual([["b", 1]]);
		h.controller.update(input("other"));
		expect(h.last().arrivals.late.size).toBe(0);
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

	test("the palette is told every reason a settled search may be incomplete, never about rows from an earlier input", () => {
		const reasons = (groups: SearchGroup[], pending = false, stale = false) =>
			hostSearchReasons({
				groups,
				pending,
				stale,
				arrivals: { late: new Map(), cohort: 0, listed: new Set() },
			}).map((reason) => (reason.kind === "fileList" ? `fileList:${reason.files}` : reason.kind));
		expect(reasons([group("ready")])).toEqual([]);
		const timeCut = { ...group("ready"), cut: { time: true as const } };
		const capped = { ...group("refreshing"), cut: { time: true as const, fileList: 128_000 } };
		expect(reasons([timeCut, group("failed", [], "spec")])).toEqual(["failed", "time"]);
		expect(reasons([group("indexing")])).toEqual(["indexing"]);
		expect(reasons([group("indexing")], true)).toEqual([]);
		expect(reasons([capped])).toEqual(["fileList:128000", "time"]);
		expect(reasons([group("failed")], false, true)).toEqual([]);
	});
});

describe("host previews", () => {
	test("a transcript preview is read once per connection; a miss or a failure is asked again", async () => {
		let generation = 1;
		let answer: "fail" | "missing" | "found" = "fail";
		const asked: string[] = [];
		let ready = true;
		const loader = createHostPreviewLoader(
			async (target) => {
				asked.push(`${generation}:${target.sessionId}`);
				if (answer === "fail") throw new Error("offline");
				return answer === "missing"
					? { kind: "unavailable" }
					: { kind: "transcript", title: "t", messages: [] };
			},
			() => generation,
			() => ready,
		);
		const target = { kind: "chat" as const, sessionId: "s1", messageIndex: 2, anchorText: "the" };
		expect(await loader.load(target)).toEqual({ kind: "unavailable" });
		answer = "missing";
		expect(await loader.load(target)).toEqual({ kind: "unavailable" });
		answer = "found";
		await loader.load(target);
		await loader.load(target);
		generation = 2;
		await loader.load(target);
		expect(asked).toEqual(["1:s1", "1:s1", "1:s1", "2:s1"]);
		ready = false;
		generation = 3;
		expect(await loader.load(target)).toEqual({ kind: "unavailable" });
		expect(asked).toHaveLength(4);
	});
});
