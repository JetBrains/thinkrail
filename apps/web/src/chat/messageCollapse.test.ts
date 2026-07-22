import { describe, expect, it } from "bun:test";
import { MESSAGE_COLLAPSE_LIMIT, shouldCollapseMessage } from "./messageCollapse";

describe("shouldCollapseMessage", () => {
	const long = "x".repeat(MESSAGE_COLLAPSE_LIMIT + 1);
	const atLimit = "x".repeat(MESSAGE_COLLAPSE_LIMIT);

	it("collapses an earlier message longer than the limit", () => {
		expect(shouldCollapseMessage(long, false)).toBe(true);
	});

	it("never collapses the last message, however long", () => {
		expect(shouldCollapseMessage(long, true)).toBe(false);
	});

	it("does not collapse a message at or under the limit", () => {
		expect(shouldCollapseMessage(atLimit, false)).toBe(false);
		expect(shouldCollapseMessage("short", false)).toBe(false);
	});
});
