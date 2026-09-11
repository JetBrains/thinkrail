export type InstallPlatform = "macos" | "windows" | "linux";
export type WindowsShell = "powershell" | "cmd" | "wsl";

type DesktopDownload = {
	architecture: string;
	format: string;
	label: string;
	href: string;
};

type InstallPlatformOption = {
	id: InstallPlatform;
	label: string;
	desktop: {
		title: string;
		detail: string;
		downloads: ReadonlyArray<DesktopDownload>;
	};
};

const installScriptUrls = {
	sh: "https://raw.githubusercontent.com/JetBrains/thinkrail/main/install.sh",
	powershell: "https://raw.githubusercontent.com/JetBrains/thinkrail/main/install.ps1",
} as const;

const stableDesktopReleaseUrl = "https://github.com/JetBrains/thinkrail/releases/latest/download";

const unix = `curl -fsSL ${installScriptUrls.sh} | bash`;
const powershell = `irm ${installScriptUrls.powershell} | iex`;

export const installCommands = {
	macos: unix,
	linux: unix,
	windows: {
		powershell,
		cmd: `powershell -c "${powershell}"`,
		wsl: unix,
	},
} as const;

export const installPlatforms = [
	{
		id: "macos",
		label: "macOS",
		desktop: {
			title: "ThinkRail for macOS",
			detail: "Apple Silicon · Stable signed .dmg",
			downloads: [
				{
					architecture: "Apple Silicon",
					format: ".dmg",
					label: "Download Apple Silicon",
					href: `${stableDesktopReleaseUrl}/thinkrail-desktop-darwin-arm64.dmg`,
				},
			],
		},
	},
	{
		id: "windows",
		label: "Windows",
		desktop: {
			title: "ThinkRail for Windows",
			detail: "x64 · Stable .zip with Setup and its payload",
			downloads: [
				{
					architecture: "x64",
					format: ".zip",
					label: "Download x64",
					href: `${stableDesktopReleaseUrl}/thinkrail-desktop-windows-x64.zip`,
				},
			],
		},
	},
	{
		id: "linux",
		label: "Linux",
		desktop: {
			title: "ThinkRail for Linux",
			detail: "Ubuntu 24.04+ · Extract .tar.gz, then run the installer",
			downloads: [
				{
					architecture: "x64",
					format: ".tar.gz",
					label: "Download x64",
					href: `${stableDesktopReleaseUrl}/thinkrail-desktop-linux-x64.tar.gz`,
				},
				{
					architecture: "ARM64",
					format: ".tar.gz",
					label: "Download ARM64",
					href: `${stableDesktopReleaseUrl}/thinkrail-desktop-linux-arm64.tar.gz`,
				},
			],
		},
	},
] as const satisfies ReadonlyArray<InstallPlatformOption>;

export const windowsShells: ReadonlyArray<{
	id: WindowsShell;
	label: string;
	accessibleLabel: string;
}> = [
	{ id: "powershell", label: "PowerShell", accessibleLabel: "PowerShell" },
	{ id: "cmd", label: "CMD", accessibleLabel: "Command Prompt (cmd)" },
	{ id: "wsl", label: "WSL", accessibleLabel: "Windows Subsystem for Linux" },
];

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

export function installCommand(platform: InstallPlatform, shell: WindowsShell): string {
	if (platform !== "windows") return installCommands[platform];
	return installCommands.windows[shell];
}
