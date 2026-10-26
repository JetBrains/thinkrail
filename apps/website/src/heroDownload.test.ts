import { describe, expect, test } from "bun:test";
import { heroDownloadTarget } from "./heroDownload";

const release = "https://github.com/JetBrains/thinkrail/releases/latest/download";

describe("heroDownloadTarget", () => {
	test("downloads the Apple Silicon disk image on macOS", () => {
		expect(heroDownloadTarget("macos", "x64")).toEqual({
			label: "Download for Mac",
			href: `${release}/thinkrail-desktop-darwin-arm64.dmg`,
			ariaLabel: "Download for Mac: Apple Silicon (.dmg)",
		});
	});

	test("downloads the Windows zip", () => {
		expect(heroDownloadTarget("windows", undefined).href).toBe(
			`${release}/thinkrail-desktop-windows-x64.zip`,
		);
	});

	test("downloads the matching Linux archive when the CPU is known", () => {
		expect(heroDownloadTarget("linux", "arm64").href).toBe(
			`${release}/thinkrail-desktop-linux-arm64.tar.gz`,
		);
		expect(heroDownloadTarget("linux", "x64").href).toBe(
			`${release}/thinkrail-desktop-linux-x64.tar.gz`,
		);
	});

	test("downloads the Linux x64 archive when the CPU is unknown", () => {
		expect(heroDownloadTarget("linux", undefined).ariaLabel).toBe(
			"Download for Linux: x64 (.tar.gz)",
		);
	});

	test("scrolls to the install section when the desktop is unknown", () => {
		expect(heroDownloadTarget(undefined, undefined)).toEqual({
			label: "Download",
			href: "#install",
		});
	});
});
