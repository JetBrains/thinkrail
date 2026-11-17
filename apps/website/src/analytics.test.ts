import { afterAll, describe, expect, test } from "bun:test";
import {
	analyticsConfig,
	captureAnalytics,
	createSiteAnalytics,
	currentJourneyId,
	initAnalytics,
	websitePostHogEnabled,
} from "./analytics";
import { initAnalyticsEvents } from "./analyticsEvents";

const originalWindow = Object.getOwnPropertyDescriptor(globalThis, "window");
const originalDocument = Object.getOwnPropertyDescriptor(globalThis, "document");
const desktopUrl =
	"https://github.com/JetBrains/thinkrail/releases/latest/download/thinkrail-desktop-darwin-arm64.dmg";

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

function installBrowser(consent: { hasResponse: boolean; marketing: boolean }) {
	const activity: string[] = [];
	const storageCalls: string[] = [];
	const postHogCalls: string[] = [];
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
		location: { hostname: "thinkrail.ai", href: "https://thinkrail.ai/" },
		Cookiebot: {
			get hasResponse() {
				activity.push("read:hasResponse");
				return consent.hasResponse;
			},
			consent: {
				get marketing() {
					activity.push("read:marketing");
					return consent.marketing;
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
		posthog: {
			init() {
				postHogCalls.push("init");
			},
			capture(event: string) {
				postHogCalls.push(`capture:${event}`);
			},
			register() {
				postHogCalls.push("register");
			},
			unregister() {
				postHogCalls.push("unregister");
			},
		},
		addEventListener(type: string, listener: () => void) {
			activity.push(`subscribe:${type}`);
			listeners.set(type, listener);
		},
		removeEventListener(type: string) {
			listeners.delete(type);
		},
	};
	const analyticsDocument = {
		referrer: "",
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

	return { activity, listeners, postHogCalls, scripts, storageCalls };
}

describe("website analytics configuration", () => {
	test("website PostHog is switched off, leaving GTM on the exact production hostname", () => {
		const configuration = analyticsConfig("thinkrail.ai");
		expect(websitePostHogEnabled).toBeFalse();
		expect(configuration?.postHog).toBeUndefined();
		expect(configuration?.gtm).toBeDefined();
		expect(captureAnalytics).toBeFunction();
	});

	test("the switch restores the shared PostHog stack on the exact production hostname", () => {
		const configuration = createSiteAnalytics(true).configurationForHostname("thinkrail.ai");
		expect(configuration?.postHog).toBeDefined();
		expect(configuration?.gtm).toBeDefined();
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
		expect(createSiteAnalytics(true).configurationForHostname(hostname)).toBeUndefined();
	});

	test("distinguishes unresolved Cookiebot state from grant and denial", () => {
		const consent = { hasResponse: false, marketing: false };
		const browser = installBrowser(consent);

		createSiteAnalytics(true).init();

		expect(browser.activity).toEqual([
			"subscribe:CookiebotOnConsentReady",
			"subscribe:CookiebotOnAccept",
			"subscribe:CookiebotOnDecline",
			"read:hasResponse",
		]);
		expect(browser.storageCalls).toHaveLength(0);
		expect(browser.scripts).toHaveLength(2);

		browser.listeners.get("CookiebotOnConsentReady")?.();
		expect(browser.storageCalls).toHaveLength(0);

		consent.hasResponse = true;
		consent.marketing = true;
		browser.listeners.get("CookiebotOnAccept")?.();
		expect(browser.storageCalls).toEqual([
			"get:thinkrail_journey_id",
			"set:thinkrail_journey_id:4c1829b0-f3a7-4db7-b09c-c638fb394b4e",
		]);

		consent.marketing = false;
		browser.listeners.get("CookiebotOnDecline")?.();
		expect(browser.storageCalls.at(-1)).toBe("remove:thinkrail_journey_id");
	});
});

describe("website analytics while PostHog is switched off", () => {
	test("loads only GTM and never reads Cookiebot or journey storage", () => {
		const browser = installBrowser({ hasResponse: true, marketing: true });

		initAnalytics();

		expect(browser.scripts.map(({ dataset }) => dataset)).toEqual([
			{ gtmContainer: "GTM-WDW2DZW4" },
		]);
		expect(browser.activity).toEqual([]);
		expect(browser.storageCalls).toEqual([]);
		expect(currentJourneyId()).toBeUndefined();
	});

	test("a desktop download proceeds without an event, a bridge, or journey storage", () => {
		const browser = installBrowser({ hasResponse: true, marketing: true });
		const listeners = new Map<string, EventListener>();
		const analyticsDocument = {
			addEventListener(type: string, listener: EventListener) {
				listeners.set(type, listener);
			},
		};
		const anchor = {
			closest: (selector: string) =>
				selector === "a[href]" || selector === "#readme" ? anchor : null,
			getAttribute: (name: string) => (name === "href" ? desktopUrl : null),
		};
		let prevented = false;

		initAnalytics();
		initAnalyticsEvents(analyticsDocument, "/");
		listeners.get("click")?.({
			type: "click",
			button: 0,
			target: anchor,
			preventDefault() {
				prevented = true;
			},
		} as unknown as Event);

		expect(listeners.has("click")).toBeTrue();
		expect(prevented).toBeFalse();
		expect(browser.postHogCalls).toEqual([]);
		expect(browser.storageCalls).toEqual([]);
	});
});
