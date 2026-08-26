import { describe, expect, test } from "bun:test";
import { siteMetadata } from "./siteMetadata";

describe("site metadata", () => {
	test("uses the production vibecoding identity", () => {
		expect(siteMetadata.origin).toBe("https://vibecoding.thinkrail.ai");
		expect(new URL(siteMetadata.openGraphImagePath, siteMetadata.origin).href).toBe(
			"https://vibecoding.thinkrail.ai/og.png",
		);
		expect(siteMetadata.title).toContain("ThinkRail");
	});
});
