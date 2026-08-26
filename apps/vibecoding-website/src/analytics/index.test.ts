import { describe, expect, test } from "bun:test";
import { marketingAnalyticsConfig } from "./index";

describe("marketing analytics configuration", () => {
	test("enables the existing GTM container on the production hostname", () => {
		expect(marketingAnalyticsConfig("vibecoding.thinkrail.ai")).toEqual({
			containerId: "GTM-WDW2DZW4",
			scriptUrl: "https://www.googletagmanager.com/gtm.js?id=GTM-WDW2DZW4",
		});
	});

	test.each([
		"localhost",
		"127.0.0.1",
		"thinkrail-vibecoding.pages.dev",
		"pr-42.thinkrail-vibecoding.pages.dev",
		"www.vibecoding.thinkrail.ai",
	])("stays disabled on %s", (hostname) => {
		expect(marketingAnalyticsConfig(hostname)).toBeUndefined();
	});
});
