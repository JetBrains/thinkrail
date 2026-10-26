import { desktopInstallerPlatforms } from "./installCommands";
import type { CpuArchitecture, InstallPlatform } from "./installPlatform";

export type HeroDownload = {
	label: string;
	href: string;
	ariaLabel?: string;
};

function downloadHref(platformId: InstallPlatform, label: string): string {
	const download = desktopInstallerPlatforms
		.find((platform) => platform.id === platformId)
		?.downloads.find((item) => item.label === label);
	if (download === undefined) throw new Error(`missing desktop download ${platformId} ${label}`);
	return download.href;
}

export function heroDownloadTarget(
	platform: InstallPlatform | undefined,
	architecture: CpuArchitecture | undefined,
): HeroDownload {
	if (platform === "windows") {
		return {
			label: "Download for Windows",
			href: downloadHref("windows", "Download .zip"),
			ariaLabel: "Download for Windows: x64 (.zip)",
		};
	}
	if (platform === "linux") {
		const arm = architecture === "arm64";
		return {
			label: "Download for Linux",
			href: downloadHref("linux", arm ? "ARM64 .tar.gz" : "x64 .tar.gz"),
			ariaLabel: arm ? "Download for Linux: ARM64 (.tar.gz)" : "Download for Linux: x64 (.tar.gz)",
		};
	}
	if (platform === "macos") {
		return {
			label: "Download for Mac",
			href: downloadHref("macos", "Download .dmg"),
			ariaLabel: "Download for Mac: Apple Silicon (.dmg)",
		};
	}
	return {
		label: "Download",
		href: "#install",
	};
}
