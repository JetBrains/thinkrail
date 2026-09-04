import { expect, test } from "bun:test";
import { ACTIVITY_PROTOCOL_VERSION } from "@thinkrail/contracts";
import { supportsSessionActivity } from "./wireTransport";

test("a host at or beyond the activity version supports the layer", () => {
	expect(supportsSessionActivity(ACTIVITY_PROTOCOL_VERSION)).toBe(true);
	expect(supportsSessionActivity(ACTIVITY_PROTOCOL_VERSION + 1)).toBe(true);
});

test("an older host and a pre-welcome connection do not, so the client clears rather than keeps glyphs", () => {
	expect(supportsSessionActivity(ACTIVITY_PROTOCOL_VERSION - 1)).toBe(false);
	expect(supportsSessionActivity(null)).toBe(false);
});
