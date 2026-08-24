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

export const windowsShellLabels = {
	powershell: "PowerShell",
	cmd: "Command Prompt (cmd)",
	wsl: "WSL",
} as const;
