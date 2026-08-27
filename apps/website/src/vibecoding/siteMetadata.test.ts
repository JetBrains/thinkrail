import { describe, expect, test } from "bun:test";
import { siteMetadata } from "./siteMetadata";

describe("vibecoding metadata", () => {
	test("uses the unified production route identity", () => {
		expect(new URL(siteMetadata.path, siteMetadata.origin).href).toBe(
			"https://thinkrail.ai/vibecoding/",
		);
		expect(new URL(siteMetadata.openGraphImagePath, siteMetadata.origin).href).toBe(
			"https://thinkrail.ai/vibecoding/og.png",
		);
		expect(siteMetadata.title).toContain("ThinkRail");
	});
});
