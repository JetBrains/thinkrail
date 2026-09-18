export type InstallPlatform = "macos" | "windows" | "linux";

type DesktopDownload = {
	architecture: string;
	label: string;
	href: string;
};

type InstallPlatformOption = {
	id: InstallPlatform;
	label: string;
	desktop: {
		detail: string;
		downloads: ReadonlyArray<DesktopDownload>;
	};
};

const stableDesktopReleaseUrl = "https://github.com/JetBrains/thinkrail/releases/latest/download";

const installPlatformOptions = {
	macos: {
		id: "macos",
		label: "macOS",
		desktop: {
			detail: "Apple Silicon",
			downloads: [
				{
					architecture: "Apple Silicon",
					label: "Download .dmg",
					href: `${stableDesktopReleaseUrl}/thinkrail-desktop-darwin-arm64.dmg`,
				},
			],
		},
	},
	windows: {
		id: "windows",
		label: "Windows",
		desktop: {
			detail: "Windows x64",
			downloads: [
				{
					architecture: "x64",
					label: "Download .zip",
					href: `${stableDesktopReleaseUrl}/thinkrail-desktop-windows-x64.zip`,
				},
			],
		},
	},
	linux: {
		id: "linux",
		label: "Linux",
		desktop: {
			detail: "Ubuntu 24.04+ · run ./installer",
			downloads: [
				{
					architecture: "x64",
					label: "x64 .tar.gz",
					href: `${stableDesktopReleaseUrl}/thinkrail-desktop-linux-x64.tar.gz`,
				},
				{
					architecture: "ARM64",
					label: "ARM64 .tar.gz",
					href: `${stableDesktopReleaseUrl}/thinkrail-desktop-linux-arm64.tar.gz`,
				},
			],
		},
	},
} as const satisfies Record<InstallPlatform, InstallPlatformOption>;

export const installPlatforms = [
	installPlatformOptions.macos,
	installPlatformOptions.windows,
	installPlatformOptions.linux,
] as const satisfies ReadonlyArray<InstallPlatformOption>;

export function getInstallPlatform(platform: InstallPlatform): InstallPlatformOption {
	return installPlatformOptions[platform];
}

export function directDesktopDownload(platform: InstallPlatform): DesktopDownload | undefined {
	const downloads = getInstallPlatform(platform).desktop.downloads;
	return downloads.length === 1 ? downloads[0] : undefined;
}

type PlatformNavigator = {
	platform: string;
	userAgent?: string;
	maxTouchPoints: number;
	userAgentData?: { platform?: string };
};

export function detectInstallPlatform(nav: PlatformNavigator): InstallPlatform | undefined {
	const platform = (nav.userAgentData?.platform || nav.platform || "").toLowerCase();
	const combined = `${platform} ${nav.userAgent ?? ""}`.toLowerCase();
	if (/android|iphone|ipad|ipod|cros/.test(combined)) return undefined;
	if (nav.maxTouchPoints > 1 && /mac/.test(platform)) return undefined;
	if (/win/.test(platform) || /windows/.test(combined)) return "windows";
	if (/mac/.test(platform)) return "macos";
	if (/linux|x11/.test(platform)) return "linux";
	return undefined;
}
