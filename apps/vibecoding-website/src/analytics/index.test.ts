import { describe, expect, test } from "bun:test";
import { marketingAnalyticsConfig } from "./index";

describe("vibecoding website analytics configuration", () => {
	test("enables the shared analytics stack on the exact production hostname", () => {
		const configuration = marketingAnalyticsConfig("vibecoding.thinkrail.ai");
		expect(configuration?.postHog).toBeDefined();
		expect(configuration?.gtm).toBeDefined();
	});

	test.each([
		"localhost",
		"127.0.0.1",
		"thinkrail-vibecoding.pages.dev",
		"pr-42.thinkrail-vibecoding.pages.dev",
		"www.vibecoding.thinkrail.ai",
		"thinkrail.ai",
	])("stays disabled on %s", (hostname) => {
		expect(marketingAnalyticsConfig(hostname)).toBeUndefined();
	});
});
