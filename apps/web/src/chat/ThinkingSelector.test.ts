import { describe, expect, test } from "bun:test";
import { snapThinkingLevel } from "./ThinkingSelector";

// Pins the deliberate MIRROR of pi-ai `clampThinkingLevel`'s direction: keep when supported,
// else nearest supported upward first, then downward (see the helper's doc comment).
describe("snapThinkingLevel", () => {
	const opusLike = ["off", "low", "medium", "high", "xhigh"] as const;

	test("keeps a supported level", () => {
		expect(snapThinkingLevel(opusLike, "high")).toBe("high");
		expect(snapThinkingLevel(opusLike, "xhigh")).toBe("xhigh");
	});

	test("snaps upward first (minimal → low when minimal is unmapped)", () => {
		expect(snapThinkingLevel(opusLike, "minimal")).toBe("low");
	});

	test("snaps downward when nothing above is supported (max → xhigh)", () => {
		expect(snapThinkingLevel(opusLike, "max")).toBe("xhigh");
	});

	test('non-reasoning model (["off"]) always lands on off', () => {
		expect(snapThinkingLevel(["off"], "xhigh")).toBe("off");
		expect(snapThinkingLevel(["off"], "off")).toBe("off");
	});

	test("empty support set falls back to off", () => {
		expect(snapThinkingLevel([], "medium")).toBe("off");
	});
});
