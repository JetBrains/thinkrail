import { describe, expect, test } from "bun:test";
import type { WireModel } from "@thinkrail/contracts";
import { resolveAgainstCatalog } from "./useModelPreferences";

const model = (id: string, provider = "p", name = id): WireModel => ({
	id,
	name,
	provider,
	contextWindow: 1,
	reasoning: false,
	thinkingLevels: ["off"],
});

describe("resolveAgainstCatalog", () => {
	test("re-points stored snapshots to the live catalog objects, keeping the stored order", () => {
		const liveA = model("a", "p", "A live");
		const liveB = model("b", "p", "B live");
		const stored = [model("a", "p", "A stale"), model("b", "p", "B stale")];
		expect(resolveAgainstCatalog([liveB, liveA], stored)).toEqual([liveA, liveB]);
	});

	test("drops snapshots whose provider/id left the catalog", () => {
		const liveA = model("a");
		expect(
			resolveAgainstCatalog([liveA], [model("a", "other"), model("gone"), model("a")]),
		).toEqual([liveA]);
	});
});
