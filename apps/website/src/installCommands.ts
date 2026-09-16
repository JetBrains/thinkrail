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
		detail: "Apple Silicon",
		downloads: [
			{
				label: "Download .dmg",
				href: desktopDownload("thinkrail-desktop-darwin-arm64.dmg"),
			},
		],
	},
	{
		id: "windows",
		label: "Windows",
		detail: "Windows x64",
		downloads: [
			{
				label: "Download .zip",
				href: desktopDownload("thinkrail-desktop-windows-x64.zip"),
			},
		],
	},
	{
		id: "linux",
		label: "Linux",
		detail: "Ubuntu 24.04+",
		downloads: [
			{
				label: "x64 .tar.gz",
				href: desktopDownload("thinkrail-desktop-linux-x64.tar.gz"),
			},
			{
				label: "ARM64 .tar.gz",
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
