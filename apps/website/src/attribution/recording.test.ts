import { describe, expect, test } from "bun:test";
import { attributionStorageKey, readAttributionContext } from "./browserStorage";
import {
	initAttributionRecording,
	recordCurrentAttributionTouch,
	recordCurrentDownloadBridge,
} from "./recording";

const journeyId = "01890f47-75a3-4d8f-9a72-4f0e35be292b";
const nextJourneyId = "5f0c1a2b-3c4d-4e5f-8a6b-7c8d9e0f1a2b";

function fixture(initialJourney?: string, initialConsent?: boolean) {
	const values = new Map<string, string>();
	const calls: string[] = [];
	let currentJourney = initialJourney;
	let currentConsent = initialConsent;
	let listener: ((journeyId: string | undefined) => void) | undefined;
	let href = "https://thinkrail.ai/";
	let referrer = "";
	let bridgeGenerationCalls = 0;
	let failWrites = false;
	const storage = {
		getItem(key: string) {
			calls.push(`get:${key}`);
			return values.get(key) ?? null;
		},
		setItem(key: string, value: string) {
			calls.push(`set:${key}`);
			if (failWrites) throw new Error("quota exceeded");
			values.set(key, value);
		},
		removeItem(key: string) {
			calls.push(`remove:${key}`);
			values.delete(key);
		},
	};
	return {
		values,
		calls,
		dependencies: {
			currentJourneyId: () => currentJourney,
			currentMarketingConsent: () => currentConsent,
			subscribeJourney(next: (journeyId: string | undefined) => void) {
				listener = next;
				return () => {
					listener = undefined;
				};
			},
			storage: () => storage,
			href: () => href,
			referrer: () => referrer,
			generateBridgeId: () => {
				bridgeGenerationCalls += 1;
				return "AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA";
			},
			recordedJourneys: new Set<string>(),
		},
		bridgeGenerationCalls: () => bridgeGenerationCalls,
		setFailWrites(value: boolean) {
			failWrites = value;
		},
		setJourney(value: string | undefined, ...consent: [] | [boolean | undefined]) {
			currentJourney = value;
			currentConsent = consent.length === 0 ? value !== undefined : consent[0];
			listener?.(value);
		},
		setNavigation(nextHref: string, nextReferrer: string) {
			href = nextHref;
			referrer = nextReferrer;
		},
	};
}

describe("attribution recording consent timing", () => {
	test("does not record the initialization navigation when a journey appears later", () => {
		const page = fixture();
		page.values.set(attributionStorageKey, "stale");
		initAttributionRecording(page.dependencies);
		expect(page.values.has(attributionStorageKey)).toBeTrue();
		page.calls.length = 0;

		page.setJourney(journeyId);
		expect(page.calls).toEqual([]);
		page.setNavigation("https://thinkrail.ai/?utm_source=acted", "https://example.com/article");
		recordCurrentAttributionTouch(page.dependencies);
		expect(page.values.get(attributionStorageKey)).toContain('"source":"acted"');

		page.setJourney(undefined);
		expect(page.values.has(attributionStorageKey)).toBeFalse();
	});

	test("preserves stored attribution through unknown consent until known denial", () => {
		const page = fixture(journeyId, true);
		initAttributionRecording(page.dependencies);
		expect(page.values.has(attributionStorageKey)).toBeTrue();

		page.setJourney(undefined, undefined);
		expect(page.values.has(attributionStorageKey)).toBeTrue();

		page.setJourney(journeyId, true);
		expect(page.values.has(attributionStorageKey)).toBeTrue();
		expect(readAttributionContext(journeyId, page.dependencies.storage())).toMatchObject({
			first_touch: expect.objectContaining({ referrer_class: "direct" }),
		});

		page.setJourney(undefined, false);
		expect(page.values.has(attributionStorageKey)).toBeFalse();
	});

	test("clears stored attribution when consent is already denied", () => {
		const page = fixture(undefined, false);
		page.values.set(attributionStorageKey, "stale");

		initAttributionRecording(page.dependencies);

		expect(page.values.has(attributionStorageKey)).toBeFalse();
	});

	test("does not generate or store a download bridge without a consented journey", () => {
		const page = fixture(undefined, false);

		expect(recordCurrentDownloadBridge(page.dependencies)).toBeUndefined();
		expect(page.bridgeGenerationCalls()).toBe(0);
		expect(page.calls).toEqual([]);
	});

	test("records at initialization only when a journey already exists", () => {
		const page = fixture(journeyId, true);
		page.setNavigation("https://thinkrail.ai/?utm_campaign=returning", "");
		initAttributionRecording(page.dependencies);

		expect(page.values.get(attributionStorageKey)).toContain('"campaign":"returning"');
	});
});

describe("attribution recording per document", () => {
	test("records a page's navigation once, so later actions keep its download bridge", () => {
		const page = fixture(journeyId, true);
		page.setNavigation("https://thinkrail.ai/?utm_source=newsletter", "https://www.google.com/");
		initAttributionRecording(page.dependencies);
		const bridgeId = recordCurrentDownloadBridge(page.dependencies);
		const stored = page.values.get(attributionStorageKey);
		page.calls.length = 0;

		recordCurrentAttributionTouch(page.dependencies);
		recordCurrentAttributionTouch(page.dependencies);

		expect(bridgeId).toBeDefined();
		expect(page.calls).toEqual([]);
		expect(page.values.get(attributionStorageKey)).toBe(stored);
		expect(readAttributionContext(journeyId, page.dependencies.storage())?.bridge_id).toBe(
			bridgeId,
		);
	});

	test("records a later grant's navigation at its first action only", () => {
		const page = fixture();
		page.setNavigation("https://thinkrail.ai/?utm_source=newsletter", "");
		initAttributionRecording(page.dependencies);
		page.setJourney(journeyId);
		recordCurrentAttributionTouch(page.dependencies);
		const bridgeId = recordCurrentDownloadBridge(page.dependencies);
		page.calls.length = 0;

		recordCurrentAttributionTouch(page.dependencies);

		expect(bridgeId).toBeDefined();
		expect(page.calls).toEqual([]);
		expect(readAttributionContext(journeyId, page.dependencies.storage())?.bridge_id).toBe(
			bridgeId,
		);
	});

	test("records the page again for a new journey", () => {
		const page = fixture(journeyId, true);
		initAttributionRecording(page.dependencies);
		page.setJourney(undefined, false);
		page.setJourney(nextJourneyId, true);

		recordCurrentAttributionTouch(page.dependencies);

		expect(readAttributionContext(nextJourneyId, page.dependencies.storage())).toMatchObject({
			first_touch: expect.objectContaining({ referrer_class: "direct" }),
		});
	});

	test("retries a touch whose write failed", () => {
		const page = fixture(journeyId, true);
		page.setFailWrites(true);
		initAttributionRecording(page.dependencies);
		expect(page.values.has(attributionStorageKey)).toBeFalse();

		page.setFailWrites(false);
		recordCurrentAttributionTouch(page.dependencies);

		expect(page.values.has(attributionStorageKey)).toBeTrue();
	});
});
