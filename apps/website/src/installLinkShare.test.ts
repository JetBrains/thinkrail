import { describe, expect, test } from "bun:test";
import { installShareUrl, isMobileDevice, shareInstallLink } from "./installLinkShare";

describe("isMobileDevice", () => {
	test.each([
		{ platform: "Linux armv8l", userAgent: "Mozilla/5.0 (Linux; Android 15)" },
		{ platform: "iPhone", userAgent: "Mozilla/5.0 (iPhone; CPU iPhone OS 18_0 like Mac OS X)" },
		{ platform: "MacIntel", userAgent: "Mozilla/5.0 (Macintosh)", maxTouchPoints: 5 },
		{ userAgentDataPlatform: "Android" },
	])("recognizes a phone or tablet %#", (hints) => {
		expect(isMobileDevice(hints)).toBe(true);
	});

	test.each([
		{ platform: "MacIntel", userAgent: "Mozilla/5.0 (Macintosh)", maxTouchPoints: 0 },
		{ platform: "Win32", userAgent: "Mozilla/5.0 (Windows NT 10.0)", maxTouchPoints: 10 },
		{ platform: "Linux x86_64", userAgent: "Mozilla/5.0 (X11; CrOS x86_64)" },
		{},
	])("leaves desktops and unknown devices alone %#", (hints) => {
		expect(isMobileDevice(hints)).toBe(false);
	});
});

describe("installShareUrl", () => {
	test("replaces the query and fragment with the share campaign and install anchor", () => {
		expect(installShareUrl("https://thinkrail.ai/?utm_source=reddit&gclid=abc#why", "readme")).toBe(
			"https://thinkrail.ai/?utm_source=send_to_computer&utm_medium=share#readme",
		);
		expect(installShareUrl("https://thinkrail.ai/vibecoding/", "quick-start")).toBe(
			"https://thinkrail.ai/vibecoding/?utm_source=send_to_computer&utm_medium=share#quick-start",
		);
	});
});

describe("shareInstallLink", () => {
	const url = "https://thinkrail.ai/?utm_source=send_to_computer&utm_medium=share#readme";

	test("prefers the native share sheet", async () => {
		const shared: unknown[] = [];
		const result = await shareInstallLink(
			{
				share: async (data) => {
					shared.push(data);
				},
			},
			url,
		);
		expect(result).toBe("shared");
		expect(shared).toEqual([{ title: "ThinkRail", text: "Install ThinkRail on my computer", url }]);
	});

	test("treats a dismissed share sheet as cancelled without copying", async () => {
		const copied: string[] = [];
		const result = await shareInstallLink(
			{
				share: async () => {
					throw new DOMException("dismissed", "AbortError");
				},
				clipboard: { writeText: async (text) => void copied.push(text) },
			},
			url,
		);
		expect(result).toBe("cancelled");
		expect(copied).toEqual([]);
	});

	test("falls back to copying when sharing is unavailable or fails", async () => {
		const copied: string[] = [];
		const clipboard = { writeText: async (text: string) => void copied.push(text) };
		expect(await shareInstallLink({ clipboard }, url)).toBe("copied");
		expect(
			await shareInstallLink(
				{
					share: async () => {
						throw new DOMException("blocked", "NotAllowedError");
					},
					clipboard,
				},
				url,
			),
		).toBe("copied");
		expect(copied).toEqual([url, url]);
	});

	test("reports failure when neither sharing nor copying works", async () => {
		expect(await shareInstallLink({}, url)).toBe("failed");
		expect(
			await shareInstallLink(
				{
					clipboard: {
						writeText: async () => {
							throw new Error("denied");
						},
					},
				},
				url,
			),
		).toBe("failed");
	});
});
