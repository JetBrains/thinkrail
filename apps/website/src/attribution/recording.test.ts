import { describe, expect, test } from "bun:test";
import { attributionStorageKey } from "./browserStorage";
import {
	initAttributionRecording,
	recordCurrentAttributionTouch,
	recordCurrentDownloadBridge,
} from "./recording";

const journeyId = "01890f47-75a3-4d8f-9a72-4f0e35be292b";

function fixture(initialJourney?: string, initialConsent?: boolean) {
	const values = new Map<string, string>();
	const calls: string[] = [];
	let currentJourney = initialJourney;
	let currentConsent = initialConsent;
	let listener: ((journeyId: string | undefined) => void) | undefined;
	let href = "https://thinkrail.ai/";
	let referrer = "";
	let bridgeGenerationCalls = 0;
	const storage = {
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
		},
		bridgeGenerationCalls: () => bridgeGenerationCalls,
		setJourney(value: string | undefined, consent = value !== undefined) {
			currentJourney = value;
			currentConsent = consent;
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
		initAttributionRecording("landing", page.dependencies);
		expect(page.values.has(attributionStorageKey)).toBeTrue();
		page.calls.length = 0;

		page.setJourney(journeyId);
		expect(page.calls).toEqual([]);
		page.setNavigation("https://thinkrail.ai/?utm_source=acted", "https://example.com/article");
		recordCurrentAttributionTouch("landing", page.dependencies);
		expect(page.values.get(attributionStorageKey)).toContain('"source":"acted"');

		page.setJourney(undefined);
		expect(page.values.has(attributionStorageKey)).toBeFalse();
	});

	test("clears stored attribution when consent is already denied", () => {
		const page = fixture(undefined, false);
		page.values.set(attributionStorageKey, "stale");

		initAttributionRecording("landing", page.dependencies);

		expect(page.values.has(attributionStorageKey)).toBeFalse();
	});

	test("does not generate or store a download bridge without a consented journey", () => {
		const page = fixture(undefined, false);

		expect(recordCurrentDownloadBridge("landing", page.dependencies)).toBeUndefined();
		expect(page.bridgeGenerationCalls()).toBe(0);
		expect(page.calls).toEqual([]);
	});

	test("records at initialization only when a journey already exists", () => {
		const page = fixture(journeyId, true);
		page.setNavigation("https://thinkrail.ai/?utm_campaign=returning", "");
		initAttributionRecording("landing", page.dependencies);

		expect(page.values.get(attributionStorageKey)).toContain('"campaign":"returning"');
	});
});
