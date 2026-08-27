import { describe, expect, test } from "bun:test";
import { reviewerTermination } from "./reviewerSessionMonitor";

describe("reviewerTermination", () => {
	test.each([
		["pending", "no-verdict"],
		["stop", "no-verdict"],
		["toolUse", "no-verdict"],
		["deferred", "no-verdict"],
		["length", "crashed"],
		["error", "crashed"],
		["aborted", "aborted"],
	] as const)("stopReason %s → %p", (stopReason, verdict) => {
		expect(reviewerTermination({ stopReason })).toBe(verdict);
	});

	test("an error message is a crash regardless of the stop reason", () => {
		expect(reviewerTermination({ stopReason: "stop", errorMessage: "boom" })).toBe("crashed");
	});

	test("a missing settlement still reads as a verdict that never came", () => {
		expect(reviewerTermination(null)).toBe("no-verdict");
	});
});
