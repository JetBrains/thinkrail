export type InstallPlatform = "macos" | "linux" | "windows";
export type WindowsShell = "powershell" | "cmd" | "wsl";

const installScriptUrls = {
	sh: "https://raw.githubusercontent.com/JetBrains/thinkrail/main/install.sh",
	powershell: "https://raw.githubusercontent.com/JetBrains/thinkrail/main/install.ps1",
} as const;

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

export const installPlatforms: ReadonlyArray<{ id: InstallPlatform; label: string }> = [
	{ id: "macos", label: "macOS" },
	{ id: "linux", label: "Linux" },
	{ id: "windows", label: "Windows" },
];

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
