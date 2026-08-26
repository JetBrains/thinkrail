import { describe, expect, test } from "bun:test";
import { analyticsConfig } from "./analytics";

describe("website analytics configuration", () => {
	test("enables the shared analytics stack on the exact production hostname", () => {
		const configuration = analyticsConfig("thinkrail.ai");
		expect(configuration?.postHog).toBeDefined();
		expect(configuration?.gtm).toBeDefined();
	});

	test.each([
		"localhost",
		"127.0.0.1",
		"jetbrains.github.io",
		"www.thinkrail.ai",
		"vibecoding.thinkrail.ai",
	])("stays disabled on %s", (hostname) => {
		expect(analyticsConfig(hostname)).toBeUndefined();
	});
});
