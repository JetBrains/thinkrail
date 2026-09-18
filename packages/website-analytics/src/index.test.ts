import { afterEach, describe, expect, test } from "bun:test";
import { createWebsiteAnalytics, type MarketingConsentAdapter, type PostHogOptions } from "./index";

const originalWindow = Object.getOwnPropertyDescriptor(globalThis, "window");
const originalDocument = Object.getOwnPropertyDescriptor(globalThis, "document");
const expectedPostHogProjectKey = "phc_AFJBcKraEUrfpTrSSMjBGXMHTusYudtFfxWqdevchy8X";
const expectedPostHogOptions: PostHogOptions = {
	api_host: "https://p.thinkrail.ai",
	ui_host: "https://eu.posthog.com",
	defaults: "2026-05-30",
	person_profiles: "identified_only",
	cookieless_mode: "always",
	respect_dnt: true,
	disable_session_recording: true,
};
const expectedGtmScriptUrl = "https://www.googletagmanager.com/gtm.js?id=GTM-WDW2DZW4";
const journeyStorageKey = "thinkrail_journey_id";
const existingJourneyId = "01890f47-75a3-4d8f-9a72-4f0e35be292b";
const newJourneyId = "4c1829b0-f3a7-4db7-b09c-c638fb394b4e";

const contentViewed = { content_key: "landing/readme" } as const;

type ScriptStub = {
	src: string;
	async: boolean;
	crossOrigin: string;
	dataset: Record<string, string>;
	listeners: Map<string, () => void>;
	addEventListener(type: string, listener: () => void): void;
};

type DomOptions = {
	storedJourney?: string | null;
	randomUuid?: string;
	storageAccessThrows?: boolean;
	storageGetThrows?: boolean;
	storageSetThrows?: boolean;
	cryptoThrows?: boolean;
	postHogInitThrows?: boolean;
};

function restoreGlobal(name: "window" | "document", descriptor?: PropertyDescriptor): void {
	if (descriptor) {
		Object.defineProperty(globalThis, name, descriptor);
		return;
	}
	Reflect.deleteProperty(globalThis, name);
}

function createConsent(...initial: [] | [boolean | undefined]) {
	let granted: boolean | undefined = initial.length === 0 ? false : initial[0];
	const listeners = new Set<() => void>();
	const activity: string[] = [];
	const adapter: MarketingConsentAdapter = {
		current() {
			activity.push("current");
			return granted;
		},
		subscribe(listener) {
			activity.push("subscribe");
			listeners.add(listener);
			return () => listeners.delete(listener);
		},
	};
	return {
		adapter,
		activity,
		set(value: boolean | undefined) {
			granted = value;
			for (const listener of listeners) listener();
		},
	};
}

function installDom(hostname: string, options: DomOptions = {}) {
	const scripts: ScriptStub[] = [];
	const vendorCalls: Array<{
		method: string;
		value?: unknown;
		properties?: Record<string, unknown>;
	}> = [];
	const storageCalls: string[] = [];
	const registeredProperties: Record<string, unknown> = {};
	const values = new Map<string, string>();
	if (options.storedJourney !== undefined && options.storedJourney !== null) {
		values.set(journeyStorageKey, options.storedJourney);
	}
	const storage = {
		getItem(key: string) {
			storageCalls.push(`get:${key}`);
			if (options.storageGetThrows) throw new Error("get failed");
			return values.get(key) ?? null;
		},
		setItem(key: string, value: string) {
			storageCalls.push(`set:${key}:${value}`);
			if (options.storageSetThrows) throw new Error("set failed");
			values.set(key, value);
		},
		removeItem(key: string) {
			storageCalls.push(`remove:${key}`);
			values.delete(key);
		},
	};
	const location = { hostname };
	const analyticsWindow: {
		location: { hostname: string };
		posthog?: {
			init(projectKey: string, postHogOptions: PostHogOptions): void;
			capture(event: string, properties: Record<string, unknown>): void;
			register(properties: Record<string, unknown>): void;
			unregister(property: string): void;
		};
		dataLayer?: Array<Record<string, unknown>>;
		readonly localStorage: typeof storage;
		readonly crypto: { randomUUID(): string };
	} = {
		location,
		get localStorage() {
			if (options.storageAccessThrows) throw new Error("storage unavailable");
			return storage;
		},
		get crypto() {
			return {
				randomUUID() {
					if (options.cryptoThrows) throw new Error("crypto unavailable");
					return options.randomUuid ?? newJourneyId;
				},
			};
		},
	};
	const analyticsDocument = {
		querySelector(selector: string) {
			if (selector.includes("data-posthog-project")) {
				return scripts.find((script) => script.dataset.posthogProject) ?? null;
			}
			if (selector.includes("data-gtm-container")) {
				return scripts.find((script) => script.dataset.gtmContainer) ?? null;
			}
			return null;
		},
		createElement() {
			const script: ScriptStub = {
				src: "",
				async: false,
				crossOrigin: "",
				dataset: {},
				listeners: new Map(),
				addEventListener(type, listener) {
					this.listeners.set(type, listener);
				},
			};
			return script;
		},
		head: {
			appendChild(script: ScriptStub) {
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

	function loadPostHog(): void {
		analyticsWindow.posthog = {
			init(projectKey, postHogOptions) {
				vendorCalls.push({ method: "init", value: projectKey, properties: postHogOptions });
				if (options.postHogInitThrows) throw new Error("init failed");
			},
			capture(event, properties) {
				vendorCalls.push({
					method: "capture",
					value: event,
					properties: { ...registeredProperties, ...properties },
				});
			},
			register(properties) {
				Object.assign(registeredProperties, properties);
				vendorCalls.push({ method: "register", properties });
			},
			unregister(property) {
				delete registeredProperties[property];
				vendorCalls.push({ method: "unregister", value: property });
			},
		};
		const script = scripts.find((candidate) => candidate.dataset.posthogProject);
		script?.listeners.get("load")?.();
	}

	function failPostHogScript(): void {
		const script = scripts.find((candidate) => candidate.dataset.posthogProject);
		script?.listeners.get("error")?.();
	}

	return {
		analyticsWindow,
		failPostHogScript,
		loadPostHog,
		scripts,
		storageCalls,
		values,
		vendorCalls,
	};
}

afterEach(() => {
	restoreGlobal("window", originalWindow);
	restoreGlobal("document", originalDocument);
});

describe("website analytics", () => {
	test("returns the shared vendor configuration only for the consuming production hostname", () => {
		const consent = createConsent();
		const analytics = createWebsiteAnalytics({
			productionHostname: "site.example",
			marketingConsent: consent.adapter,
		});

		expect(analytics.configurationForHostname("localhost")).toBeUndefined();
		expect(analytics.configurationForHostname("www.site.example")).toBeUndefined();
		expect(analytics.configurationForHostname("site.example")).toEqual({
			postHog: {
				projectKey: expectedPostHogProjectKey,
				scriptUrl: "https://p.thinkrail.ai/static/array.js",
				options: expectedPostHogOptions,
			},
			gtm: {
				containerId: "GTM-WDW2DZW4",
				scriptUrl: expectedGtmScriptUrl,
			},
		});
	});

	test("never queues, subscribes, accesses storage, or loads vendors outside the exact host", () => {
		const dom = installDom("preview.example", { storedJourney: existingJourneyId });
		const consent = createConsent(true);
		const analytics = createWebsiteAnalytics({
			productionHostname: "site.example",
			marketingConsent: consent.adapter,
		});

		analytics.capture("content_viewed", contentViewed);
		analytics.init();
		dom.analyticsWindow.location.hostname = "site.example";
		analytics.init();
		dom.loadPostHog();

		expect(consent.activity).toEqual(["subscribe", "current"]);
		expect(dom.storageCalls).toEqual([`get:${journeyStorageKey}`]);
		expect(dom.vendorCalls.filter(({ method }) => method === "capture")).toHaveLength(0);
	});

	test("subscribes to consent before loading PostHog and GTM, and loads each vendor once", () => {
		const dom = installDom("site.example");
		const consent = createConsent();
		const analytics = createWebsiteAnalytics({
			productionHostname: "site.example",
			marketingConsent: consent.adapter,
		});

		analytics.init();
		analytics.init();

		expect(consent.activity).toEqual(["subscribe", "current"]);
		expect(dom.scripts).toHaveLength(2);
		const postHogScript = dom.scripts.find((script) => script.dataset.posthogProject);
		const gtmScript = dom.scripts.find((script) => script.dataset.gtmContainer);
		expect(postHogScript?.src).toBe("https://p.thinkrail.ai/static/array.js");
		expect(postHogScript?.crossOrigin).toBe("anonymous");
		expect(gtmScript?.src).toBe(expectedGtmScriptUrl);
		expect(dom.analyticsWindow.dataLayer).toHaveLength(1);

		dom.loadPostHog();
		expect(dom.vendorCalls).toEqual([
			{
				method: "init",
				value: expectedPostHogProjectKey,
				properties: expectedPostHogOptions,
			},
		]);
	});

	test("queues captures until PostHog loads and does not retroactively enrich them on grant", () => {
		const dom = installDom("site.example");
		const consent = createConsent();
		const analytics = createWebsiteAnalytics({
			productionHostname: "site.example",
			marketingConsent: consent.adapter,
		});

		analytics.init();
		analytics.capture("content_viewed", contentViewed);
		consent.set(true);
		dom.loadPostHog();
		analytics.capture("content_viewed", { content_key: "landing/why" });

		expect(dom.vendorCalls).toEqual([
			expect.objectContaining({ method: "init" }),
			{
				method: "capture",
				value: "content_viewed",
				properties: { content_key: "landing/readme" },
			},
			{ method: "register", properties: { journey_id: newJourneyId } },
			{
				method: "capture",
				value: "content_viewed",
				properties: { content_key: "landing/why", journey_id: newJourneyId },
			},
		]);
	});

	test("removes queued enrichment when consent is withdrawn before flush", () => {
		const dom = installDom("site.example", { storedJourney: existingJourneyId });
		const consent = createConsent(true);
		const analytics = createWebsiteAnalytics({
			productionHostname: "site.example",
			marketingConsent: consent.adapter,
		});

		analytics.init();
		analytics.capture("content_viewed", contentViewed);
		consent.set(false);
		dom.loadPostHog();

		expect(dom.values.has(journeyStorageKey)).toBeFalse();
		expect(dom.storageCalls).toEqual([`get:${journeyStorageKey}`, `remove:${journeyStorageKey}`]);
		expect(dom.vendorCalls.find(({ method }) => method === "capture")).toEqual({
			method: "capture",
			value: "content_viewed",
			properties: { content_key: "landing/readme" },
		});
	});

	test("registers an existing valid ID and unregisters and removes it on withdrawal", () => {
		const dom = installDom("site.example", { storedJourney: existingJourneyId });
		const consent = createConsent(true);
		const analytics = createWebsiteAnalytics({
			productionHostname: "site.example",
			marketingConsent: consent.adapter,
		});

		analytics.init();
		dom.loadPostHog();
		consent.set(false);

		expect(dom.storageCalls).toEqual([`get:${journeyStorageKey}`, `remove:${journeyStorageKey}`]);
		expect(dom.vendorCalls).toContainEqual({
			method: "register",
			properties: { journey_id: existingJourneyId },
		});
		expect(dom.vendorCalls).toContainEqual({ method: "unregister", value: "journey_id" });
	});

	test("creates and registers a journey when consent is granted after PostHog loads", () => {
		const dom = installDom("site.example");
		const consent = createConsent();
		const analytics = createWebsiteAnalytics({
			productionHostname: "site.example",
			marketingConsent: consent.adapter,
		});

		analytics.init();
		dom.loadPostHog();
		consent.set(true);
		analytics.capture("content_viewed", contentViewed);

		expect(dom.vendorCalls).toContainEqual({
			method: "register",
			properties: { journey_id: newJourneyId },
		});
		expect(dom.vendorCalls.at(-1)).toEqual({
			method: "capture",
			value: "content_viewed",
			properties: { ...contentViewed, journey_id: newJourneyId },
		});
	});

	test("does not read or create journey state while consent is denied", () => {
		const dom = installDom("site.example");
		const consent = createConsent();
		const analytics = createWebsiteAnalytics({
			productionHostname: "site.example",
			marketingConsent: consent.adapter,
		});

		analytics.init();
		analytics.capture("content_viewed", contentViewed);
		dom.loadPostHog();

		expect(dom.storageCalls).toEqual([`remove:${journeyStorageKey}`]);
		expect(dom.vendorCalls.find(({ method }) => method === "capture")?.properties).toEqual(
			contentViewed,
		);
	});

	test("captures closed CTA and bridge-less download properties without journey enrichment", () => {
		const dom = installDom("site.example");
		const consent = createConsent(false);
		const analytics = createWebsiteAnalytics({
			productionHostname: "site.example",
			marketingConsent: consent.adapter,
		});

		analytics.init();
		analytics.capture("install_cta_clicked", {
			content_key: "landing",
			cta_location: "hero",
			install_method: "desktop",
		});
		analytics.capture("download_started", {
			content_key: "landing",
			cta_location: "hero",
			platform: "macos",
			architecture: "arm64",
			artifact: "dmg",
		});
		dom.loadPostHog();

		expect(
			dom.vendorCalls
				.filter(({ method }) => method === "capture")
				.map(({ value, properties }) => ({ event: value, properties })),
		).toEqual([
			{
				event: "install_cta_clicked",
				properties: {
					content_key: "landing",
					cta_location: "hero",
					install_method: "desktop",
				},
			},
			{
				event: "download_started",
				properties: {
					content_key: "landing",
					cta_location: "hero",
					platform: "macos",
					architecture: "arm64",
					artifact: "dmg",
				},
			},
		]);
	});

	test("clears a stale journey after unresolved consent becomes denied", () => {
		const dom = installDom("site.example", { storedJourney: existingJourneyId });
		const consent = createConsent(undefined);
		const analytics = createWebsiteAnalytics({
			productionHostname: "site.example",
			marketingConsent: consent.adapter,
		});

		analytics.init();
		expect(dom.storageCalls).toHaveLength(0);

		consent.set(false);
		expect(dom.storageCalls).toEqual([`remove:${journeyStorageKey}`]);
		expect(dom.values.has(journeyStorageKey)).toBeFalse();

		consent.set(true);
		expect(dom.values.get(journeyStorageKey)).toBe(newJourneyId);
		expect(dom.storageCalls).toEqual([
			`remove:${journeyStorageKey}`,
			`get:${journeyStorageKey}`,
			`set:${journeyStorageKey}:${newJourneyId}`,
		]);
	});

	test.each([
		["missing", null],
		["invalid", "not-a-uuid"],
	] as const)("creates and persists a random journey ID when the stored value is %s", (_, stored) => {
		const dom = installDom("site.example", { storedJourney: stored, randomUuid: newJourneyId });
		const consent = createConsent(true);
		const analytics = createWebsiteAnalytics({
			productionHostname: "site.example",
			marketingConsent: consent.adapter,
		});

		analytics.init();
		dom.loadPostHog();

		expect(dom.values.get(journeyStorageKey)).toBe(newJourneyId);
		expect(dom.vendorCalls).toContainEqual({
			method: "register",
			properties: { journey_id: newJourneyId },
		});
	});

	test("bounds the pre-load queue and keeps the most recent captures", () => {
		const dom = installDom("site.example");
		const consent = createConsent();
		const analytics = createWebsiteAnalytics({
			productionHostname: "site.example",
			marketingConsent: consent.adapter,
		});

		analytics.init();
		for (let index = 0; index < 105; index += 1) {
			analytics.capture("content_viewed", { content_key: `content/${index}` });
		}
		dom.loadPostHog();

		const captures = dom.vendorCalls.filter(({ method }) => method === "capture");
		expect(captures).toHaveLength(100);
		expect(captures[0]?.properties).toEqual({ content_key: "content/5" });
		expect(captures.at(-1)?.properties).toEqual({ content_key: "content/104" });
	});

	test.each([
		["script load", {}, true],
		["PostHog initialization", { postHogInitThrows: true }, false],
	] as const)("clears and disables queuing after %s failure", (_, options, scriptFailure) => {
		const dom = installDom("site.example", options);
		const consent = createConsent();
		const analytics = createWebsiteAnalytics({
			productionHostname: "site.example",
			marketingConsent: consent.adapter,
		});

		analytics.init();
		analytics.capture("content_viewed", { content_key: "queued" });
		if (scriptFailure) dom.failPostHogScript();
		else dom.loadPostHog();
		analytics.capture("content_viewed", { content_key: "after-failure" });
		if (scriptFailure) dom.loadPostHog();

		expect(dom.vendorCalls.filter(({ method }) => method === "capture")).toHaveLength(0);
	});

	test.each([
		["storage getter", { storageAccessThrows: true }],
		["storage read", { storageGetThrows: true }],
		["storage write", { storageSetThrows: true }],
		["crypto", { cryptoThrows: true }],
		["invalid generated UUID", { randomUuid: "not-a-uuid" }],
	] as const)("fails closed for %s failures while preserving cookieless capture", (_, failure) => {
		const dom = installDom("site.example", failure);
		const consent = createConsent(true);
		const analytics = createWebsiteAnalytics({
			productionHostname: "site.example",
			marketingConsent: consent.adapter,
		});

		analytics.init();
		analytics.capture("content_viewed", contentViewed);
		dom.loadPostHog();

		expect(dom.vendorCalls.some(({ method }) => method === "register")).toBeFalse();
		expect(dom.vendorCalls.find(({ method }) => method === "capture")?.properties).toEqual(
			contentViewed,
		);
	});
});
