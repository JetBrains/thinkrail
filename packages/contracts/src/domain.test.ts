import { describe, expect, test } from "bun:test";
import { base64ByteLength, IMAGE_MAX_BYTES, isRetriedAttempt } from "./domain";

// The shared presentation/measurement contracts live here (next to isControlMessage), used by both the
// web client and the host — so their behavior is pinned where it's defined, not only transitively
// through each consumer's suites.

describe("isRetriedAttempt", () => {
	const failed = { role: "assistant", stopReason: "error" };
	const ok = { role: "assistant", stopReason: "stop" };
	const userMsg = { role: "user" };

	test("a failed assistant immediately followed by the retried assistant is superseded", () => {
		expect(isRetriedAttempt([userMsg, failed, ok], 1)).toBe(true);
	});

	test("a failed assistant followed by a user message is the run's terminal failure — visible", () => {
		expect(isRetriedAttempt([userMsg, failed, userMsg, ok], 1)).toBe(false);
	});

	test("a trailing failed assistant (nothing after it) stays visible", () => {
		expect(isRetriedAttempt([userMsg, failed], 1)).toBe(false);
	});

	test("a non-error assistant is never a retried attempt, even when another assistant follows", () => {
		expect(isRetriedAttempt([userMsg, ok, ok], 1)).toBe(false);
	});

	test("non-assistant roles and out-of-range indices are never retried attempts", () => {
		expect(isRetriedAttempt([userMsg, failed, ok], 0)).toBe(false);
		expect(isRetriedAttempt([userMsg, failed, ok], 7)).toBe(false);
	});

	test("an intervening toolResult breaks adjacency — pi's _prepareRetry re-runs the turn directly, so anything between the two means this was not a retry", () => {
		const toolResult = { role: "toolResult" };
		expect(isRetriedAttempt([userMsg, failed, toolResult, ok], 1)).toBe(false);
	});
});

describe("base64ByteLength", () => {
	test("counts decoded bytes across padding variants without decoding", () => {
		for (const text of ["", "a", "ab", "abc", "abcd", "hello world!", "\x00\x01\x02\xff"]) {
			const bytes = Buffer.from(text, "binary");
			expect(base64ByteLength(bytes.toString("base64"))).toBe(bytes.length);
		}
	});

	test("the shared provider ceiling is Anthropic's 5MB per-image limit", () => {
		expect(IMAGE_MAX_BYTES).toBe(5 * 1024 * 1024);
	});
});
