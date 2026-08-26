import { afterEach, describe, expect, test } from "bun:test";
import { createWebsiteAnalytics, type PostHogOptions } from "./index";

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

type ScriptStub = {
	src: string;
	async: boolean;
	crossOrigin: string;
	dataset: Record<string, string>;
	listeners: Map<string, () => void>;
	addEventListener(type: string, listener: () => void): void;
};

function restoreGlobal(name: "window" | "document", descriptor?: PropertyDescriptor): void {
	if (descriptor) {
		Object.defineProperty(globalThis, name, descriptor);
		return;
	}
	Reflect.deleteProperty(globalThis, name);
}

function installDom(hostname: string) {
	const scripts: ScriptStub[] = [];
	const postHogCalls: Array<{ projectKey: string; options: Record<string, unknown> }> = [];
	const analyticsWindow: {
		location: { hostname: string };
		posthog: {
			init(projectKey: string, options: Record<string, unknown>): void;
		};
		dataLayer?: Array<Record<string, unknown>>;
	} = {
		location: { hostname },
		posthog: {
			init(projectKey, options) {
				postHogCalls.push({ projectKey, options });
			},
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

	return { analyticsWindow, postHogCalls, scripts };
}

afterEach(() => {
	restoreGlobal("window", originalWindow);
	restoreGlobal("document", originalDocument);
});

describe("website analytics", () => {
	test("returns the shared vendor configuration only for the consuming production hostname", () => {
		const analytics = createWebsiteAnalytics({ productionHostname: "site.example" });

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

	test("does not touch the DOM outside production", () => {
		const dom = installDom("preview.example");
		const analytics = createWebsiteAnalytics({ productionHostname: "site.example" });

		analytics.init();

		expect(dom.scripts).toHaveLength(0);
		expect(dom.analyticsWindow.dataLayer).toBeUndefined();
	});

	test("loads PostHog and GTM once in production", () => {
		const dom = installDom("site.example");
		const analytics = createWebsiteAnalytics({ productionHostname: "site.example" });

		analytics.init();
		analytics.init();

		expect(dom.scripts).toHaveLength(2);
		const postHogScript = dom.scripts.find((script) => script.dataset.posthogProject);
		const gtmScript = dom.scripts.find((script) => script.dataset.gtmContainer);
		expect(postHogScript?.src).toBe("https://p.thinkrail.ai/static/array.js");
		expect(postHogScript?.crossOrigin).toBe("anonymous");
		expect(gtmScript?.src).toBe(expectedGtmScriptUrl);
		expect(dom.analyticsWindow.dataLayer).toHaveLength(1);

		postHogScript?.listeners.get("load")?.();
		expect(dom.postHogCalls).toEqual([
			{
				projectKey: expectedPostHogProjectKey,
				options: expectedPostHogOptions,
			},
		]);
	});
});
