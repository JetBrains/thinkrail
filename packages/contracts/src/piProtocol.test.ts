import { describe, expect, test } from "bun:test";
import { assistantToolCallsAreExecutable } from "./piProtocol";

describe("assistantToolCallsAreExecutable", () => {
	test("rejects every Pi terminal that cannot execute tool calls", () => {
		for (const stopReason of ["error", "aborted", "length"]) {
			expect(assistantToolCallsAreExecutable(stopReason)).toBe(false);
		}
	});

	test("allows executable and in-flight assistant states", () => {
		for (const stopReason of [undefined, "toolUse", "stop"]) {
			expect(assistantToolCallsAreExecutable(stopReason)).toBe(true);
		}
	});
});
