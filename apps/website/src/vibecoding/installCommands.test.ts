import { describe, expect, test } from "bun:test";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { InstallPicker } from "./InstallPicker";
import {
	detectInstallPlatform,
	installCommand,
	installCommands,
	installPlatforms,
} from "./installCommands";

function occurrences(source: string, value: string): number {
	return source.split(value).length - 1;
}

function renderedText(value: string): string {
	return renderToStaticMarkup(createElement("span", null, value)).slice(6, -7);
}

describe("desktop install model", () => {
	test("keeps desktop platforms in the approved tab order", () => {
		expect(installPlatforms.map((platform) => platform.id)).toEqual(["macos", "windows", "linux"]);
	});

	test("pins every stable download to its versionless public release alias", () => {
		expect(
			installPlatforms.flatMap((platform) =>
				platform.desktop.downloads.map((download) => download.href),
			),
		).toEqual([
			"https://github.com/JetBrains/thinkrail/releases/latest/download/thinkrail-desktop-darwin-arm64.dmg",
			"https://github.com/JetBrains/thinkrail/releases/latest/download/thinkrail-desktop-windows-x64.zip",
			"https://github.com/JetBrains/thinkrail/releases/latest/download/thinkrail-desktop-linux-x64.tar.gz",
			"https://github.com/JetBrains/thinkrail/releases/latest/download/thinkrail-desktop-linux-arm64.tar.gz",
		]);
	});

	test("offers both Linux architectures without choosing between them", () => {
		const linux = installPlatforms.find((platform) => platform.id === "linux");
		expect(linux?.desktop.downloads.map((download) => download.architecture)).toEqual([
			"x64",
			"ARM64",
		]);
	});
});

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

describe("server-rendered install picker", () => {
	test("renders every desktop link and CLI command in each picker", () => {
		const markup = renderToStaticMarkup(
			createElement(
				"div",
				null,
				createElement(InstallPicker, { context: "Quick start" }),
				createElement(InstallPicker, { context: "Next step" }),
			),
		);

		for (const platform of installPlatforms) {
			for (const download of platform.desktop.downloads) {
				expect(occurrences(markup, `href="${download.href}"`)).toBe(2);
			}
		}

		const commands = [
			installCommands.macos,
			installCommands.linux,
			installCommands.windows.powershell,
			installCommands.windows.cmd,
			installCommands.windows.wsl,
		];
		for (const command of commands) {
			expect(occurrences(markup, renderedText(command))).toBeGreaterThanOrEqual(2);
		}

		expect(markup).toContain('aria-label="Quick start: macOS install options"');
		expect(markup).toContain('aria-label="Next step: macOS install options"');
		const ids = Array.from(markup.matchAll(/\sid="([^"]+)"/g), (match) => match[1]);
		expect(new Set(ids).size).toBe(ids.length);
	});
});

describe("platform detection", () => {
	test("recognizes supported desktop platforms without inferring Linux architecture", () => {
		expect(detectInstallPlatform({ platform: "MacIntel", maxTouchPoints: 0 })).toBe("macos");
		expect(detectInstallPlatform({ platform: "Linux x86_64", maxTouchPoints: 0 })).toBe("linux");
		expect(detectInstallPlatform({ platform: "Linux aarch64", maxTouchPoints: 0 })).toBe("linux");
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
