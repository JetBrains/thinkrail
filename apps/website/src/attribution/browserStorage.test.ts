import { describe, expect, test } from "bun:test";
import {
	attributionLifetimeMs,
	attributionStorageKey,
	bridgeIdPattern,
	classifyReferrer,
	createBridgeId,
	readAttributionContext,
	readStoredAttributionContext,
	recordAttributionTouch,
	storeLatestAttributionBridge,
	touchFromNavigation,
} from ".";

const journeyA = "01890f47-75a3-4d8f-9a72-4f0e35be292b";
const journeyB = "4c1829b0-f3a7-4db7-b09c-c638fb394b4e";
const bridgeA = "AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA";
const bridgeB = "BBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBA";
const now = 2_000_000_000_000;

function memoryStorage() {
	const values = new Map<string, string>();
	const calls: string[] = [];
	return {
		values,
		calls,
		getItem(key: string) {
			calls.push(`get:${key}`);
			return values.get(key) ?? null;
		},
		setItem(key: string, value: string) {
			calls.push(`set:${key}`);
			values.set(key, value);
		},
		removeItem(key: string) {
			calls.push(`remove:${key}`);
			values.delete(key);
		},
	};
}

describe("attribution touch normalization", () => {
	test("retains only bounded normalized campaign fields and a closed referrer class", () => {
		const touch = touchFromNavigation(
			`https://thinkrail.ai/?utm_source=%20News%00Letter%20&utm_medium=email&utm_campaign=${"x".repeat(140)}&utm_content=hero&utm_term=secret&gclid=raw`,
			"https://www.google.com/search?q=thinkrail",
			"landing",
			now,
		);

		expect(touch).toEqual({
			source: "NewsLetter",
			medium: "email",
			campaign: "x".repeat(128),
			content: "hero",
			referrer_class: "search",
			landing_content_key: "landing",
			touched_at: now,
			policy_version: 1,
		});
		expect(JSON.stringify(touch)).not.toContain("utm_term");
		expect(JSON.stringify(touch)).not.toContain("gclid");
		expect(JSON.stringify(touch)).not.toContain("google.com");
	});

	test.each([
		["", "direct"],
		["https://thinkrail.ai/blog/", "internal"],
		["https://linkedin.com/feed", "social"],
		["https://example.com/post", "referral"],
		["not a URL", "referral"],
	] as const)("classifies %s without retaining its domain as %s", (referrer, expected) => {
		expect(classifyReferrer(referrer)).toBe(expected);
	});
});

describe("attribution browser storage", () => {
	test("generates canonical 32-byte base64url bridge IDs", () => {
		const bridgeId = createBridgeId();
		expect(bridgeId).toHaveLength(43);
		expect(bridgeIdPattern.test(bridgeId ?? "")).toBeTrue();
	});

	test("keeps first touch, advances last touch, and resets on journey change", () => {
		const storage = memoryStorage();
		recordAttributionTouch(
			journeyA,
			"landing",
			"https://thinkrail.ai/?utm_source=first",
			"",
			storage,
			now,
		);
		const context = recordAttributionTouch(
			journeyA,
			"blog/index",
			"https://thinkrail.ai/blog/?utm_source=last",
			"https://thinkrail.ai/",
			storage,
			now + 1,
		);
		expect(context?.first_touch.source).toBe("first");
		expect(context?.last_touch.source).toBe("last");

		recordAttributionTouch(
			journeyB,
			"vibecoding",
			"https://thinkrail.ai/vibecoding/",
			"",
			storage,
			now + 2,
		);
		const reset = readAttributionContext(journeyB, storage, now + 2);
		expect(reset?.first_touch.landing_content_key).toBe("vibecoding");
		expect(reset?.last_touch.landing_content_key).toBe("vibecoding");
		expect(storage.values.get(attributionStorageKey)).not.toContain(journeyA);
	});

	test("preserves an acquisition last touch across untagged internal and direct navigation", () => {
		const storage = memoryStorage();
		recordAttributionTouch(
			journeyA,
			"landing",
			"https://thinkrail.ai/?utm_source=newsletter",
			"https://example.com/article",
			storage,
			now,
		);
		recordAttributionTouch(
			journeyA,
			"blog/index",
			"https://thinkrail.ai/blog/",
			"https://thinkrail.ai/",
			storage,
			now + 1,
		);
		recordAttributionTouch(
			journeyA,
			"blog/thinkrail-sdd",
			"https://thinkrail.ai/blog/thinkrail-sdd/",
			"",
			storage,
			now + 2,
		);

		const preserved = readAttributionContext(journeyA, storage, now + 2);
		expect(preserved?.last_touch.source).toBe("newsletter");
		expect(preserved?.last_touch.touched_at).toBe(now);
	});

	test("updates last touch for external and UTM-tagged navigation", () => {
		const storage = memoryStorage();
		recordAttributionTouch(journeyA, "landing", "https://thinkrail.ai/", "", storage, now);
		recordAttributionTouch(
			journeyA,
			"blog/index",
			"https://thinkrail.ai/blog/",
			"https://www.google.com/search?q=thinkrail",
			storage,
			now + 1,
		);
		expect(readAttributionContext(journeyA, storage, now + 1)?.last_touch.referrer_class).toBe(
			"search",
		);

		recordAttributionTouch(
			journeyA,
			"vibecoding",
			"https://thinkrail.ai/vibecoding/?utm_campaign=launch",
			"https://thinkrail.ai/blog/",
			storage,
			now + 2,
		);
		const tagged = readAttributionContext(journeyA, storage, now + 2)?.last_touch;
		expect(tagged?.campaign).toBe("launch");
		expect(tagged?.referrer_class).toBe("internal");
	});

	test("replaces only the latest download bridge", () => {
		const storage = memoryStorage();
		recordAttributionTouch(
			journeyA,
			"landing",
			"https://thinkrail.ai/?utm_source=newsletter",
			"",
			storage,
			now,
		);
		const before = readStoredAttributionContext(storage, now);
		if (before === undefined) throw new Error("expected an attribution context");

		expect(storeLatestAttributionBridge(journeyA, storage, () => bridgeA, now)).toBe(bridgeA);
		expect(storeLatestAttributionBridge(journeyA, storage, () => bridgeB, now)).toBe(bridgeB);
		const after = readStoredAttributionContext(storage, now);

		expect(after).toEqual({ ...before, bridge_id: bridgeB });
		expect(after?.first_touch).toEqual(before?.first_touch);
		expect(after?.last_touch).toEqual(before?.last_touch);
	});

	test("reads a validated unexpired stored context without a separate journey source", () => {
		const storage = memoryStorage();
		recordAttributionTouch(journeyA, "landing", "https://thinkrail.ai/", "", storage, now);
		expect(readStoredAttributionContext(storage, now)).toEqual({
			journey_id: journeyA,
			first_touch: expect.any(Object),
			last_touch: expect.any(Object),
		});
		expect(readStoredAttributionContext(storage, now + attributionLifetimeMs + 1)).toBeUndefined();
	});

	test("does not access storage without a current consented journey", () => {
		const storage = memoryStorage();
		expect(readAttributionContext(undefined, storage, now)).toBeUndefined();
		expect(storage.calls).toEqual([]);
	});

	test("expires and removes context after thirty days", () => {
		const storage = memoryStorage();
		recordAttributionTouch(journeyA, "landing", "https://thinkrail.ai/", "", storage, now);
		expect(
			readAttributionContext(journeyA, storage, now + attributionLifetimeMs + 1),
		).toBeUndefined();
		expect(storage.values.has(attributionStorageKey)).toBeFalse();
	});
});
