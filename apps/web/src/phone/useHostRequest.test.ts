import { expect, test } from "bun:test";
import type { DeviceWireClient } from "@thinkrail/remote-client";
import {
	cachedFor,
	prefetchHostRequest,
	pushedProjectId,
	type Settled,
	shownLoaded,
} from "./useHostRequest";

const a = {} as DeviceWireClient;
const b = {} as DeviceWireClient;
const settled = (over: Partial<Settled<string[]>> = {}): Settled<string[]> => ({
	client: a,
	key: "k1",
	request: "r1",
	loaded: { kind: "ready", value: ["one"] },
	...over,
});

test("a refresh of the same read keeps its rows on screen", () => {
	expect(shownLoaded(settled(), a, "k1", "r2", undefined)).toEqual({
		kind: "ready",
		value: ["one"],
	});
});

test("other params or another computer never show the previous read's rows: that read's cache, else a loader", () => {
	expect(shownLoaded(settled(), a, "k2", "r3", undefined)).toEqual({ kind: "loading" });
	expect(shownLoaded(settled(), b, "k1", "r3", undefined)).toEqual({ kind: "loading" });
	expect(shownLoaded(settled(), a, "k2", "r3", { value: ["two"] })).toEqual({
		kind: "ready",
		value: ["two"],
	});
	expect(
		shownLoaded(settled({ loaded: { kind: "failed", reason: "x" } }), a, "k2", "r3", undefined),
	).toEqual({ kind: "loading" });
});

test("a failure stays until the read is issued again, which loads instead of keeping the error", () => {
	const failed = settled({ loaded: { kind: "failed", reason: "boom" } });
	expect(shownLoaded(failed, a, "k1", "r1", undefined)).toEqual({ kind: "failed", reason: "boom" });
	expect(shownLoaded(failed, a, "k1", "r2", undefined)).toEqual({ kind: "loading" });
});

test("nothing settled yet starts from the cache, so returning never flashes a loader", () => {
	expect(shownLoaded(null, a, "k1", "r1", { value: ["cached"] })).toEqual({
		kind: "ready",
		value: ["cached"],
	});
	expect(shownLoaded(null, a, "k1", "r1", undefined)).toEqual({ kind: "loading" });
});

test("a workspace push names its project, whether it carries the workspace or a removed one's ids", () => {
	expect(pushedProjectId({ id: "w1", projectId: "p1", name: "main" })).toBe("p1");
	expect(pushedProjectId({ projectId: "p2", id: "w2" })).toBe("p2");
	expect(pushedProjectId({ id: "p3", name: "project" })).toBeUndefined();
	expect(pushedProjectId(null)).toBeUndefined();
});

test("a prefetched read is what the screen then opens on, and a slow or failed one gives up quietly", async () => {
	const answering = { request: async () => ["p1"] } as unknown as DeviceWireClient;
	await prefetchHostRequest(answering, "project.list", {}, 1_000);
	const key = JSON.stringify({ method: "project.list", params: {} });
	expect(shownLoaded(null, answering, key, "", cachedFor(answering, key))).toEqual({
		kind: "ready",
		value: ["p1"],
	});

	const silent = { request: () => new Promise(() => {}) } as unknown as DeviceWireClient;
	const started = Date.now();
	await prefetchHostRequest(silent, "project.list", {}, 20);
	expect(Date.now() - started).toBeLessThan(500);

	const failing = {
		request: async () => Promise.reject(new Error("x")),
	} as unknown as DeviceWireClient;
	await expect(prefetchHostRequest(failing, "project.list", {}, 1_000)).resolves.toBeUndefined();
});
