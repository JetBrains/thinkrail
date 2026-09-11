import { describe, expect, it } from "bun:test";
import { desktopInstallerPlatforms, installCommands, windowsShellLabels } from "./installCommands";

const INSTALL_PS1_URL = "https://raw.githubusercontent.com/JetBrains/thinkrail/main/install.ps1";
const RELEASE_DOWNLOAD_URL = "https://github.com/JetBrains/thinkrail/releases/latest/download";

describe("desktop installers", () => {
	it("publishes the stable desktop aliases in platform order", () => {
		expect(desktopInstallerPlatforms.map((platform) => platform.label)).toEqual([
			"macOS",
			"Windows",
			"Linux",
		]);
		expect(desktopInstallerPlatforms.flatMap((platform) => platform.downloads)).toEqual([
			{
				label: "Download .dmg",
				detail: "Apple Silicon · .dmg · Stable",
				href: `${RELEASE_DOWNLOAD_URL}/thinkrail-desktop-darwin-arm64.dmg`,
			},
			{
				label: "Download .zip",
				detail: "Windows x64 · unzip and run Setup",
				href: `${RELEASE_DOWNLOAD_URL}/thinkrail-desktop-windows-x64.zip`,
			},
			{
				label: "Download x64",
				detail: "Linux x64 · Ubuntu 24.04+ · .tar.gz",
				href: `${RELEASE_DOWNLOAD_URL}/thinkrail-desktop-linux-x64.tar.gz`,
			},
			{
				label: "Download ARM64",
				detail: "Linux ARM64 · Ubuntu 24.04+ · .tar.gz",
				href: `${RELEASE_DOWNLOAD_URL}/thinkrail-desktop-linux-arm64.tar.gz`,
			},
		]);
		expect(
			desktopInstallerPlatforms.find((platform) => platform.id === "linux")?.downloads,
		).toHaveLength(2);
	});
});

describe("Windows install commands", () => {
	it("runs the installer directly in PowerShell", () => {
		expect(installCommands.windows.powershell).toBe(`irm ${INSTALL_PS1_URL} | iex`);
	});

	it("launches PowerShell from Command Prompt", () => {
		expect(installCommands.windows.cmd).toBe(`powershell -c "irm ${INSTALL_PS1_URL} | iex"`);
	});

	it("uses the approved Command Prompt label", () => {
		expect(windowsShellLabels.cmd).toBe("Command Prompt (cmd)");
	});
});
