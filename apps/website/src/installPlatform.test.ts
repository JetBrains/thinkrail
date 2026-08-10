import { describe, expect, test } from "bun:test";
import { detectInstallPlatform } from "./installPlatform";

describe("detectInstallPlatform", () => {
	test("prefers the user-agent data platform", () => {
		expect(
			detectInstallPlatform({
				userAgentDataPlatform: "Windows",
				platform: "MacIntel",
				userAgent: "Mozilla/5.0",
			}),
		).toBe("windows");
	});

	test.each([
		[{ platform: "MacIntel" }, "macos"],
		[{ platform: "Linux x86_64" }, "linux"],
		[{ platform: "Win32" }, "windows"],
		[{ platform: "X11" }, "linux"],
	] as const)("maps desktop browser hints %#", (hints, expected) => {
		expect(detectInstallPlatform(hints)).toBe(expected);
	});

	test.each([
		{ platform: "Linux armv8l", userAgent: "Mozilla/5.0 (Linux; Android 15)" },
		{ platform: "iPhone", userAgent: "Mozilla/5.0 (iPhone; CPU iPhone OS 18_0 like Mac OS X)" },
		{ platform: "MacIntel", userAgent: "Mozilla/5.0 (Macintosh)", maxTouchPoints: 5 },
		{ platform: "Linux x86_64", userAgent: "Mozilla/5.0 (X11; CrOS x86_64)" },
		{ platform: "Plan9" },
	] as const)("does not claim an unsupported or ambiguous platform %#", (hints) => {
		expect(detectInstallPlatform(hints)).toBeUndefined();
	});
});
