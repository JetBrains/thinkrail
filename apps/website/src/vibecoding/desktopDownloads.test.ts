import { describe, expect, test } from "bun:test";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { CallToAction, desktopCtaAction } from "./CallToAction";
import { detectInstallPlatform, directDesktopDownload, installPlatforms } from "./desktopDownloads";
import { HeroQuickStart } from "./HeroQuickStart";

function occurrences(source: string, value: string): number {
	return source.split(value).length - 1;
}

describe("desktop install model", () => {
	test("keeps compact desktop options in the approved tab order", () => {
		expect(installPlatforms.map((platform) => platform.id)).toEqual(["macos", "windows", "linux"]);
		expect(installPlatforms.map((platform) => platform.desktop.detail)).toEqual([
			"Apple Silicon",
			"Windows x64",
			"Ubuntu 24.04+ · run ./installer",
		]);
		expect(
			installPlatforms.flatMap((platform) =>
				platform.desktop.downloads.map((download) => download.label),
			),
		).toEqual(["Download .dmg", "Download .zip", "x64 .tar.gz", "ARM64 .tar.gz"]);
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
		expect(directDesktopDownload("macos")?.architecture).toBe("Apple Silicon");
		expect(directDesktopDownload("windows")?.architecture).toBe("x64");
		expect(directDesktopDownload("linux")).toBeUndefined();
	});
});

describe("desktop CTA", () => {
	test("downloads direct artifacts and routes unresolved choices to Quick start", () => {
		expect(desktopCtaAction("macos")).toEqual({
			label: "Download for macOS",
			href: installPlatforms[0].desktop.downloads[0]?.href,
			detail: "Apple Silicon",
			showAllPlatforms: true,
		});
		expect(desktopCtaAction("windows")).toEqual({
			label: "Download for Windows",
			href: installPlatforms[1].desktop.downloads[0]?.href,
			detail: "x64",
			showAllPlatforms: true,
		});
		expect(desktopCtaAction("linux")).toEqual({
			label: "Download for Linux",
			href: "#quick-start",
			detail: undefined,
			showAllPlatforms: false,
		});
		expect(desktopCtaAction(null)).toEqual({
			label: "View desktop downloads",
			href: "#quick-start",
			detail: undefined,
			showAllPlatforms: false,
		});
	});
});

describe("server-rendered install controls", () => {
	test("keeps every desktop link discoverable without command-line controls or a second picker", () => {
		const markup = renderToStaticMarkup(
			createElement("div", null, createElement(HeroQuickStart), createElement(CallToAction)),
		);

		for (const platform of installPlatforms) {
			for (const download of platform.desktop.downloads) {
				expect(occurrences(markup, `href="${download.href}"`)).toBe(1);
			}
		}

		expect(occurrences(markup, 'aria-label="Choose your operating system"')).toBe(1);
		expect(markup).toContain('aria-label="macOS desktop downloads"');
		expect(markup).not.toContain("<details");
		expect(markup).not.toContain("Browser UI via command line");
		expect(markup).not.toContain("raw.githubusercontent.com/JetBrains/thinkrail");
		expect(markup).toContain('href="#quick-start"');
		expect(markup).toContain("View desktop downloads");
		expect(markup).not.toContain("All platforms");
		expect(markup).not.toContain(">TR<");
		expect(markup).not.toContain("Stable signed");
		expect(markup).not.toContain("CLI-only host");

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
