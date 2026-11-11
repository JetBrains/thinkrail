import { expect, test } from "bun:test";
import type { DeviceWireClient } from "@thinkrail/remote-client";
import { type Settled, shownLoaded } from "./useHostRequest";

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
