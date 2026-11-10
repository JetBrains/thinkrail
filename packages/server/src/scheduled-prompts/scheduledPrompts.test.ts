import { describe, expect, test } from "bun:test";
import { isValidScheduledDueAt } from "./index";

describe("scheduled prompt due time", () => {
	const now = 1_800_000_000_000;

	test("accepts only future whole-minute timestamps", () => {
		expect(isValidScheduledDueAt(now + 60_000, now)).toBe(true);
		expect(isValidScheduledDueAt(now + 60_001, now)).toBe(false);
		expect(isValidScheduledDueAt(now, now)).toBe(false);
		expect(isValidScheduledDueAt(now - 60_000, now)).toBe(false);
		expect(isValidScheduledDueAt(Number.MAX_SAFE_INTEGER + 1, now)).toBe(false);
	});
});
