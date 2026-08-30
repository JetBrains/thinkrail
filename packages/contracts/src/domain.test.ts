import { describe, expect, test } from "bun:test";
import {
	ACCEPTED_IMAGE_TYPES,
	base64EncodedLength,
	DEFAULT_CONFIG,
	IMAGE_MAX_BASE64_BYTES,
	isDelegationRunDetails,
	isRetriedAttempt,
	REQUEST_IMAGE_BASE64_BUDGET,
} from "./domain";

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

describe("config defaults", () => {
	test("the shared custom layout-preset catalog starts empty", () => {
		expect(DEFAULT_CONFIG.customLayoutPresets).toEqual([]);
	});

	test("the composer grows to half the chat by default", () => {
		expect(DEFAULT_CONFIG).toHaveProperty("composerGrowthLimit", "half-chat");
	});
});

describe("image payload ceiling", () => {
	test("base64EncodedLength matches the real encoded length across quantum boundaries", () => {
		for (const n of [0, 1, 2, 3, 4, 5, 100, 3 * 1024]) {
			expect(base64EncodedLength(n)).toBe(Buffer.alloc(n).toString("base64").length);
		}
	});

	test("the shared ceiling is pi's 4.5MB encoded-base64 cap (headroom under Anthropic's 5MB API limit)", () => {
		expect(IMAGE_MAX_BASE64_BYTES).toBe(4.5 * 1024 * 1024);
	});

	test("the request-wide image budget leaves headroom under Anthropic's 32MB per-request cap", () => {
		expect(REQUEST_IMAGE_BASE64_BUDGET).toBe(24 * 1024 * 1024);
		expect(REQUEST_IMAGE_BASE64_BUDGET).toBeLessThan(32 * 1024 * 1024);
		expect(REQUEST_IMAGE_BASE64_BUDGET).toBeGreaterThan(IMAGE_MAX_BASE64_BYTES * 4);
	});

	test("the provider-accepted media types are exactly png/jpeg/gif/webp", () => {
		expect([...ACCEPTED_IMAGE_TYPES].sort()).toEqual([
			"image/gif",
			"image/jpeg",
			"image/png",
			"image/webp",
		]);
	});
});

describe("isDelegationRunDetails", () => {
	const usage = {
		input: 1,
		output: 2,
		cacheRead: 0,
		cacheWrite: 0,
		cost: 0.01,
		turns: 1,
		contextTokens: 3,
	};
	const valid = {
		childSessionId: "child-1",
		task: "map the repo",
		status: "completed",
		usage,
		durationMs: 42,
	};

	test("accepts a complete details shape", () => {
		expect(
			isDelegationRunDetails({
				...valid,
				roleName: "researcher",
				roleSource: "builtin",
				model: "provider/model",
				activity: "reading",
			}),
		).toBe(true);
	});

	test("rejects a status outside the closed union", () => {
		expect(isDelegationRunDetails({ ...valid, status: "done" })).toBe(false);
	});

	test("rejects an empty usage object", () => {
		expect(isDelegationRunDetails({ ...valid, usage: {} })).toBe(false);
	});

	test("rejects a missing durationMs and non-numeric usage fields", () => {
		const { durationMs: _durationMs, ...noDuration } = valid;
		expect(isDelegationRunDetails(noDuration)).toBe(false);
		expect(isDelegationRunDetails({ ...valid, usage: { ...usage, cost: "0.01" } })).toBe(false);
	});

	test("rejects every optional display field when present with a non-string value", () => {
		for (const field of ["roleName", "roleSource", "model", "activity"]) {
			expect(isDelegationRunDetails({ ...valid, [field]: { malformed: true } })).toBe(false);
		}
	});
});
