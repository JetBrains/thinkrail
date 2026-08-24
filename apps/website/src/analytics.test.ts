import { describe, expect, test } from "bun:test";
import { analyticsConfig } from "./analytics";

describe("analyticsConfig", () => {
	test("returns null off production — nothing loads on localhost/dev/preview/apex", () => {
		expect(analyticsConfig("localhost")).toBeNull();
		expect(analyticsConfig("127.0.0.1")).toBeNull();
		expect(analyticsConfig("jetbrains.github.io")).toBeNull();
	});

	test("on thinkrail.ai, uses a genuinely cookieless config that stores nothing", () => {
		const settings = analyticsConfig("thinkrail.ai");
		expect(settings).not.toBeNull();
		const config = settings?.config ?? {};
		expect(config.cookieless_mode).toBe("always");
		expect(config).not.toHaveProperty("persistence");
		expect(config.person_profiles).toBe("identified_only");
		expect(config.respect_dnt).toBe(true);
		expect(config.disable_session_recording).toBe(true);
		expect(settings?.key.startsWith("phc_")).toBe(true);
	});

	test("ingests through the first-party managed proxy, with ui_host still PostHog's app origin", () => {
		const config = analyticsConfig("thinkrail.ai")?.config ?? {};
		expect(config.api_host).toBe("https://p.thinkrail.ai");
		expect(config.ui_host).toBe("https://eu.posthog.com");
	});
});
