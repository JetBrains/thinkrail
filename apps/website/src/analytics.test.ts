import { afterAll, describe, expect, test } from "bun:test";
import { analyticsConfig, captureAnalytics, initAnalytics } from "./analytics";

const originalWindow = Object.getOwnPropertyDescriptor(globalThis, "window");
const originalDocument = Object.getOwnPropertyDescriptor(globalThis, "document");

function restoreGlobal(name: "window" | "document", descriptor?: PropertyDescriptor): void {
	if (descriptor) {
		Object.defineProperty(globalThis, name, descriptor);
		return;
	}
	Reflect.deleteProperty(globalThis, name);
}

afterAll(() => {
	restoreGlobal("window", originalWindow);
	restoreGlobal("document", originalDocument);
});

describe("website analytics configuration", () => {
	test("enables the shared analytics stack on the exact production hostname", () => {
		const configuration = analyticsConfig("thinkrail.ai");
		expect(configuration?.postHog).toBeDefined();
		expect(configuration?.gtm).toBeDefined();
		expect(captureAnalytics).toBeFunction();
	});

	test.each([
		"localhost",
		"127.0.0.1",
		"jetbrains.github.io",
		"thinkrail-website.pages.dev",
		"pr-42.thinkrail-website.pages.dev",
		"www.thinkrail.ai",
		"vibecoding.thinkrail.ai",
	])("stays disabled on %s", (hostname) => {
		expect(analyticsConfig(hostname)).toBeUndefined();
	});

	test("distinguishes unresolved Cookiebot state from grant and denial", () => {
		let hasResponse = false;
		let marketing = false;
		const activity: string[] = [];
		const storageCalls: string[] = [];
		const listeners = new Map<string, () => void>();
		const scripts: Array<{ dataset: Record<string, string> }> = [];
		const storage = {
			getItem(key: string) {
				storageCalls.push(`get:${key}`);
				return null;
			},
			setItem(key: string, value: string) {
				storageCalls.push(`set:${key}:${value}`);
			},
			removeItem(key: string) {
				storageCalls.push(`remove:${key}`);
			},
		};
		const analyticsWindow = {
			location: { hostname: "thinkrail.ai" },
			Cookiebot: {
				get hasResponse() {
					activity.push("read:hasResponse");
					return hasResponse;
				},
				consent: {
					get marketing() {
						activity.push("read:marketing");
						return marketing;
					},
				},
			},
			localStorage: storage,
			crypto: {
				randomUUID() {
					return "4c1829b0-f3a7-4db7-b09c-c638fb394b4e";
				},
			},
			dataLayer: undefined,
			addEventListener(type: string, listener: () => void) {
				activity.push(`subscribe:${type}`);
				listeners.set(type, listener);
			},
			removeEventListener(type: string) {
				listeners.delete(type);
			},
		};
		const analyticsDocument = {
			querySelector() {
				return null;
			},
			createElement() {
				return {
					src: "",
					async: false,
					crossOrigin: "",
					dataset: {} as Record<string, string>,
					addEventListener() {},
				};
			},
			head: {
				appendChild(script: { dataset: Record<string, string> }) {
					scripts.push(script);
				},
			},
		};

		Object.defineProperty(globalThis, "window", {
			configurable: true,
			value: analyticsWindow,
		});
		Object.defineProperty(globalThis, "document", {
			configurable: true,
			value: analyticsDocument,
		});

		initAnalytics();

		expect(activity).toEqual([
			"subscribe:CookiebotOnConsentReady",
			"subscribe:CookiebotOnAccept",
			"subscribe:CookiebotOnDecline",
			"read:hasResponse",
		]);
		expect(storageCalls).toHaveLength(0);
		expect(scripts).toHaveLength(2);

		listeners.get("CookiebotOnConsentReady")?.();
		expect(storageCalls).toHaveLength(0);

		hasResponse = true;
		marketing = true;
		listeners.get("CookiebotOnAccept")?.();
		expect(storageCalls).toEqual([
			"get:thinkrail_journey_id",
			"set:thinkrail_journey_id:4c1829b0-f3a7-4db7-b09c-c638fb394b4e",
		]);

		marketing = false;
		listeners.get("CookiebotOnDecline")?.();
		expect(storageCalls.at(-1)).toBe("remove:thinkrail_journey_id");
	});
});
