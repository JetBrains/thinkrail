import { describe, expect, test } from "bun:test";
import { detectInstallPlatform, installCommand, installCommands } from "./installCommands";

describe("install commands", () => {
	test("uses the shell-native command for each target", () => {
		expect(installCommand("macos", "powershell")).toBe(installCommands.macos);
		expect(installCommand("linux", "cmd")).toBe(installCommands.linux);
		expect(installCommand("windows", "powershell")).toBe(
			"irm https://raw.githubusercontent.com/JetBrains/thinkrail/main/install.ps1 | iex",
		);
		expect(installCommand("windows", "cmd")).toBe(
			'powershell -c "irm https://raw.githubusercontent.com/JetBrains/thinkrail/main/install.ps1 | iex"',
		);
		expect(installCommand("windows", "wsl")).toBe(installCommands.linux);
	});
});

describe("platform detection", () => {
	test("recognizes supported desktop platforms", () => {
		expect(detectInstallPlatform({ platform: "MacIntel", maxTouchPoints: 0 })).toBe("macos");
		expect(detectInstallPlatform({ platform: "Linux x86_64", maxTouchPoints: 0 })).toBe("linux");
		expect(detectInstallPlatform({ platform: "Win32", maxTouchPoints: 0 })).toBe("windows");
	});

	test("does not guess for mobile and touch-first Apple devices", () => {
		expect(
			detectInstallPlatform({
				platform: "Linux armv8l",
				userAgent: "Mozilla/5.0 Android",
				maxTouchPoints: 5,
			}),
		).toBeUndefined();
		expect(
			detectInstallPlatform({
				platform: "MacIntel",
				userAgent: "Mozilla/5.0 iPad",
				maxTouchPoints: 5,
			}),
		).toBeUndefined();
	});
});
