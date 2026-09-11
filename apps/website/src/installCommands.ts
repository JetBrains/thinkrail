const installScriptUrls = {
	sh: "https://raw.githubusercontent.com/JetBrains/thinkrail/main/install.sh",
	powershell: "https://raw.githubusercontent.com/JetBrains/thinkrail/main/install.ps1",
} as const;

const releaseDownloadBase = "https://github.com/JetBrains/thinkrail/releases/latest/download";
const desktopDownload = (asset: string) => `${releaseDownloadBase}/${asset}`;
const unix = `curl -fsSL ${installScriptUrls.sh} | bash`;
const powershell = `irm ${installScriptUrls.powershell} | iex`;

export const desktopInstallerPlatforms = [
	{
		id: "macos",
		label: "macOS",
		product: "ThinkRail for macOS",
		downloads: [
			{
				label: "Download .dmg",
				detail: "Apple Silicon · .dmg · Stable",
				href: desktopDownload("thinkrail-desktop-darwin-arm64.dmg"),
			},
		],
	},
	{
		id: "windows",
		label: "Windows",
		product: "ThinkRail for Windows",
		downloads: [
			{
				label: "Download .zip",
				detail: "Windows x64 · unzip and run Setup",
				href: desktopDownload("thinkrail-desktop-windows-x64.zip"),
			},
		],
	},
	{
		id: "linux",
		label: "Linux",
		product: "ThinkRail for Linux",
		downloads: [
			{
				label: "Download x64",
				detail: "Linux x64 · Ubuntu 24.04+ · .tar.gz",
				href: desktopDownload("thinkrail-desktop-linux-x64.tar.gz"),
			},
			{
				label: "Download ARM64",
				detail: "Linux ARM64 · Ubuntu 24.04+ · .tar.gz",
				href: desktopDownload("thinkrail-desktop-linux-arm64.tar.gz"),
			},
		],
	},
] as const;

export const installCommands = {
	macos: unix,
	linux: unix,
	windows: {
		powershell,
		cmd: `powershell -c "${powershell}"`,
		wsl: unix,
	},
} as const;

export const windowsShellLabels = {
	powershell: "PowerShell",
	cmd: "Command Prompt (cmd)",
	wsl: "WSL",
} as const;
