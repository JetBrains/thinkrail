import type { TerminalWindowsShell } from "@thinkrail/contracts";

const WINDOWS_SHELL_BINARY: Record<Exclude<TerminalWindowsShell, "auto">, string> = {
	pwsh: "pwsh.exe",
	powershell: "powershell.exe",
	cmd: "cmd.exe",
};

const WINDOWS_SHELL_NAME: Record<Exclude<TerminalWindowsShell, "auto">, string> = {
	pwsh: "PowerShell 7",
	powershell: "Windows PowerShell",
	cmd: "Command Prompt",
};

export type WhichFn = (bin: string) => string | null;

export const defaultWhich: WhichFn = (bin) =>
	Bun.which(bin, { PATH: process.env.PATH ?? "" }) ?? null;

export function terminalShell(
	platform: string,
	env: Record<string, string | undefined>,
	preference: TerminalWindowsShell = "auto",
	which: WhichFn = defaultWhich,
): string {
	if (env.SHELL) return env.SHELL;
	if (platform !== "win32") return "/bin/bash";
	if (preference !== "auto") return WINDOWS_SHELL_BINARY[preference];
	return which("pwsh.exe") ?? "powershell.exe";
}

export function terminalShellStartFailure(
	platform: string,
	env: Record<string, string | undefined>,
	preference: TerminalWindowsShell = "auto",
): string {
	if (env.SHELL) {
		return "Couldn’t start the shell configured by SHELL. Fix or clear SHELL in the host environment, restart ThinkRail, then retry.";
	}
	if (platform !== "win32") {
		return "Couldn’t start the configured shell. Check the host’s shell installation, then retry.";
	}
	if (preference === "auto") {
		return "Couldn’t start the automatically selected Windows shell. Check the host’s shell installation, or choose another shell in Settings → Terminal, then retry.";
	}
	return `Couldn’t start ${WINDOWS_SHELL_NAME[preference]} (${WINDOWS_SHELL_BINARY[preference]}). Make sure it is installed and available to ThinkRail. Restart ThinkRail after installation or PATH changes, or choose another shell in Settings → Terminal, then retry.`;
}

export function terminalShellArgs(platform: string): string[] {
	return platform === "darwin" ? ["-l"] : [];
}
