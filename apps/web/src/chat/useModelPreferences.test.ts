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
		const live = [model("b", "p", "B live"), model("a", "p", "A live")];
		const stored = [model("a", "p", "A stale"), model("b", "p", "B stale")];
		expect(resolveAgainstCatalog(live, stored)).toEqual([live[1], live[0]]);
	});

	test("drops snapshots whose provider/id left the catalog", () => {
		const live = [model("a")];
		expect(resolveAgainstCatalog(live, [model("a", "other"), model("gone"), model("a")])).toEqual([
			live[0],
		]);
	});
});
