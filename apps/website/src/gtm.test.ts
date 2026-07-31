import { describe, expect, test } from "bun:test";
import { gtmConfig } from "./gtm";

describe("gtmConfig", () => {
	test("returns null off production — nothing loads on localhost/dev/preview/apex", () => {
		expect(gtmConfig("localhost")).toBeNull();
		expect(gtmConfig("127.0.0.1")).toBeNull();
		expect(gtmConfig("jetbrains.github.io")).toBeNull();
	});

	test("on thinkrail.ai, loads the GTM container script", () => {
		const settings = gtmConfig("thinkrail.ai");
		expect(settings).not.toBeNull();
		expect(settings?.id).toBe("GTM-WDW2DZW4");
		expect(settings?.src).toBe("https://www.googletagmanager.com/gtm.js?id=GTM-WDW2DZW4");
	});
});
